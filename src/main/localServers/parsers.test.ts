import { describe, it, expect } from 'vitest'
import {
  deriveServerName,
  extractPortFromLsofName,
  findTrackedAncestor,
  isPathInside,
  matchWorkspaceForCwd,
  parseMacLsofCwd,
  parseMacLsofListen,
  parseNetstatListen,
  parseProcessCommandList,
  parseTasklist,
  parseWmicProcessParents,
  pickPrimaryPort
} from './parsers'

describe('extractPortFromLsofName', () => {
  it('parses the common listen address shapes', () => {
    expect(extractPortFromLsofName('*:3000')).toBe(3000)
    expect(extractPortFromLsofName('127.0.0.1:5173')).toBe(5173)
    expect(extractPortFromLsofName('[::1]:8080')).toBe(8080)
    expect(extractPortFromLsofName('localhost:4321')).toBe(4321)
  })
  it('takes the local side of an established socket', () => {
    expect(extractPortFromLsofName('127.0.0.1:3000->127.0.0.1:55012')).toBe(3000)
  })
  it('rejects garbage / out-of-range', () => {
    expect(extractPortFromLsofName('no-port-here')).toBeNull()
    expect(extractPortFromLsofName('*:0')).toBeNull()
    expect(extractPortFromLsofName('*:99999')).toBeNull()
    expect(extractPortFromLsofName('')).toBeNull()
  })
})

describe('parseMacLsofListen', () => {
  it('groups ports by pid and drops pids with no port', () => {
    const stdout = [
      'p4111',
      'cnode',
      'n*:3000',
      'n127.0.0.1:3000',
      'p4222',
      'cvite',
      'n*:5173',
      'p4333', // a process record with no listening n line
      'csomething'
    ].join('\n')
    const map = parseMacLsofListen(stdout)
    expect(map.get(4111)).toEqual({ command: 'node', ports: [3000] })
    expect(map.get(4222)).toEqual({ command: 'vite', ports: [5173] })
    expect(map.has(4333)).toBe(false)
  })
})

describe('parseMacLsofCwd', () => {
  it('maps pid to its cwd path', () => {
    const stdout = ['p4111', 'fcwd', 'n/Users/me/projects/app', 'p4222', 'fcwd', 'n/tmp'].join('\n')
    const map = parseMacLsofCwd(stdout)
    expect(map.get(4111)).toBe('/Users/me/projects/app')
    expect(map.get(4222)).toBe('/tmp')
  })
})

describe('parseProcessCommandList', () => {
  it('parses pid, ppid, rss (KB→bytes), and full command', () => {
    const stdout = [
      ' 4111 4090 102400 node /Users/me/app/node_modules/.bin/next dev',
      ' 4222    1    512 /sbin/launchd'
    ].join('\n')
    const map = parseProcessCommandList(stdout)
    expect(map.get(4111)).toEqual({
      command: 'node /Users/me/app/node_modules/.bin/next dev',
      ppid: 4090,
      rssBytes: 102400 * 1024
    })
    expect(map.get(4222)?.ppid).toBe(1)
    expect(map.get(4222)?.command).toBe('/sbin/launchd')
  })
})

describe('findTrackedAncestor', () => {
  // 5000 (npm, tracked) → 5001 (node next dev, listener)
  const ppid = new Map<number, number>([
    [5001, 5000],
    [5000, 4000],
    [4000, 1]
  ])
  it('finds a tracked ancestor up the chain', () => {
    expect(findTrackedAncestor(5001, ppid, new Set([5000]))).toBe(5000)
    expect(findTrackedAncestor(5001, ppid, new Set([4000]))).toBe(4000)
  })
  it('returns the pid itself when it is tracked', () => {
    expect(findTrackedAncestor(5000, ppid, new Set([5000]))).toBe(5000)
  })
  it('returns null when no ancestor is tracked', () => {
    expect(findTrackedAncestor(5001, ppid, new Set([9999]))).toBeNull()
  })
})

describe('parseNetstatListen (Windows)', () => {
  it('extracts pid → listening ports, ignoring non-LISTENING rows', () => {
    const stdout = [
      'Active Connections',
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       1234',
      '  TCP    [::]:5173              [::]:0                 LISTENING       5678',
      '  TCP    127.0.0.1:55012        127.0.0.1:3000         ESTABLISHED     4321'
    ].join('\r\n')
    const map = parseNetstatListen(stdout)
    expect(map.get(1234)).toEqual([3000])
    expect(map.get(5678)).toEqual([5173])
    expect(map.has(4321)).toBe(false)
  })
})

describe('parseTasklist (Windows)', () => {
  it('maps pid → image name from CSV', () => {
    const stdout = ['"node.exe","1234","Console","1","102,400 K"', '"svchost.exe","5","Services","0","8,000 K"'].join('\r\n')
    const map = parseTasklist(stdout)
    expect(map.get(1234)).toBe('node.exe')
    expect(map.get(5)).toBe('svchost.exe')
  })
})

describe('parseWmicProcessParents (Windows)', () => {
  it('maps pid → ppid from the wmic CSV', () => {
    const stdout = ['Node,ParentProcessId,ProcessId', 'HOST,5000,5001', 'HOST,4000,5000'].join('\r\n')
    const map = parseWmicProcessParents(stdout)
    expect(map.get(5001)).toBe(5000)
    expect(map.get(5000)).toBe(4000)
  })
})

describe('deriveServerName', () => {
  it('recognises common dev servers', () => {
    expect(deriveServerName('node /app/node_modules/.bin/next dev')).toBe('next dev')
    expect(deriveServerName('node /app/node_modules/vite/bin/vite.js')).toBe('vite')
    expect(deriveServerName('npm run dev')).toBe('npm run dev')
    expect(deriveServerName('node nodemon server.js')).toBe('nodemon')
    expect(deriveServerName('node /app/server.js')).toBe('node server.js')
  })
  it('falls back to the first-token basename', () => {
    expect(deriveServerName('/usr/local/bin/caddy run')).toBe('caddy')
  })
})

describe('isPathInside', () => {
  it('respects segment boundaries', () => {
    expect(isPathInside('/ws/app', '/ws/app', false)).toBe(true)
    expect(isPathInside('/ws/app/src', '/ws/app', false)).toBe(true)
    expect(isPathInside('/ws/app-other', '/ws/app', false)).toBe(false)
    expect(isPathInside('/elsewhere', '/ws/app', false)).toBe(false)
  })
  it('is case-insensitive when asked, and normalizes separators/trailing slashes', () => {
    expect(isPathInside('/WS/App/Src', '/ws/app', true)).toBe(true)
    expect(isPathInside('C:\\ws\\app\\src', 'C:\\ws\\app\\', true)).toBe(true)
  })
})

describe('matchWorkspaceForCwd', () => {
  const workspaces = [
    { id: 'a', path: '/ws/app' },
    { id: 'b', path: '/ws/app/packages/api' },
    { id: 'c', path: '/ws/other' }
  ]
  it('returns the deepest matching workspace', () => {
    expect(matchWorkspaceForCwd('/ws/app/packages/api/src', workspaces, 'linux')?.id).toBe('b')
    expect(matchWorkspaceForCwd('/ws/app/web', workspaces, 'linux')?.id).toBe('a')
  })
  it('returns null for a cwd outside every workspace (the safety drop)', () => {
    expect(matchWorkspaceForCwd('/ws/app-other', workspaces, 'linux')).toBeNull()
    expect(matchWorkspaceForCwd(undefined, workspaces, 'linux')).toBeNull()
  })
})

describe('pickPrimaryPort', () => {
  it('prefers common dev ports, else the lowest', () => {
    expect(pickPrimaryPort([8080, 3000, 51000])).toBe(3000)
    expect(pickPrimaryPort([9229, 5173])).toBe(5173)
    expect(pickPrimaryPort([40001, 40002])).toBe(40001)
    expect(pickPrimaryPort([])).toBeUndefined()
  })
})
