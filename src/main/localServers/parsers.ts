/*
 * Local Servers — pure parsing + matching helpers.
 *
 * No I/O here: every function takes strings/objects and returns data, so the
 * bulk of the feature's logic is unit-testable without spawning `lsof`/`ps`
 * (mirrors `parseOllamaMemoryPsOutput` in OllamaProvider.ts).
 */

import type { LocalServerWorkspace } from './types'

/** Parsed listening-socket info for one pid. */
export interface ListenInfo {
  command: string
  ports: number[]
}

/** Extract a TCP port from an lsof network address: `*:3000`, `127.0.0.1:3000`,
 * `[::1]:3000`, `localhost:5173`. Returns null when there's no valid port. */
export function extractPortFromLsofName(name: string): number | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  // Established sockets render as `local->remote`; LISTEN sockets won't, but
  // guard anyway by taking the local side.
  const local = trimmed.split('->')[0]
  const colon = local.lastIndexOf(':')
  if (colon === -1) return null
  const portText = local.slice(colon + 1).trim()
  if (!/^\d+$/.test(portText)) return null
  const port = Number(portText)
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null
  return port
}

/**
 * Parse `lsof -nP -iTCP -sTCP:LISTEN -Fpcn` field output into pid → ListenInfo.
 * Field lines are prefixed by type: `p<pid>`, `c<command>`, `n<addr>`.
 */
export function parseMacLsofListen(stdout: string): Map<number, ListenInfo> {
  const map = new Map<number, { command: string; ports: Set<number> }>()
  let pid: number | null = null
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw) continue
    const tag = raw[0]
    const value = raw.slice(1)
    if (tag === 'p') {
      const next = Number(value)
      pid = Number.isFinite(next) ? next : null
      if (pid != null && !map.has(pid)) map.set(pid, { command: '', ports: new Set() })
    } else if (tag === 'c' && pid != null) {
      const entry = map.get(pid)
      if (entry) entry.command = value.trim()
    } else if (tag === 'n' && pid != null) {
      const port = extractPortFromLsofName(value)
      if (port != null) map.get(pid)?.ports.add(port)
    }
  }
  const result = new Map<number, ListenInfo>()
  for (const [key, entry] of map) {
    if (entry.ports.size === 0) continue
    result.set(key, { command: entry.command, ports: [...entry.ports].sort((a, b) => a - b) })
  }
  return result
}

/** Parse `lsof -a -p <pids> -d cwd -Fpn` field output into pid → cwd path. */
export function parseMacLsofCwd(stdout: string): Map<number, string> {
  const map = new Map<number, string>()
  let pid: number | null = null
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw) continue
    const tag = raw[0]
    const value = raw.slice(1)
    if (tag === 'p') {
      const next = Number(value)
      pid = Number.isFinite(next) ? next : null
    } else if (tag === 'n' && pid != null) {
      const path = value.trim()
      if (path) map.set(pid, path)
    }
  }
  return map
}

export interface CommandInfo {
  command: string
  ppid?: number
  rssBytes?: number
}

/** Parse `ps -axo pid=,ppid=,rss=,command=` into pid → ppid + full argv + RSS. */
export function parseProcessCommandList(stdout: string): Map<number, CommandInfo> {
  const map = new Map<number, CommandInfo>()
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const rssKb = Number(match[3])
    const command = match[4].trim()
    if (!Number.isFinite(pid)) continue
    map.set(pid, {
      command,
      ppid: Number.isFinite(ppid) ? ppid : undefined,
      rssBytes: Number.isFinite(rssKb) && rssKb > 0 ? Math.round(rssKb * 1024) : undefined
    })
  }
  return map
}

/**
 * Walk a pid's ancestor chain (self → parent → …) up to `maxHops`, returning
 * the first ancestor pid found in `targets` (e.g. tracked spawn pids), or null.
 * Used to attribute a listening process to the agent shell that launched it,
 * since the listener is usually a descendant of the tracked command.
 */
export function findTrackedAncestor(
  pid: number,
  ppidByPid: Map<number, number>,
  targets: Set<number>,
  maxHops = 8
): number | null {
  let current: number | undefined = pid
  for (let hop = 0; hop <= maxHops && current != null && current > 0; hop += 1) {
    if (targets.has(current)) return current
    const next: number | undefined = ppidByPid.get(current)
    if (next == null || next === current) break
    current = next
  }
  return null
}

/** Parse Windows `netstat -ano` into pid → listening ports. */
export function parseNetstatListen(stdout: string): Map<number, number[]> {
  const ports = new Map<number, Set<number>>()
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || !/^TCP/i.test(line)) continue
    if (!/LISTENING/i.test(line)) continue
    const cols = line.split(/\s+/)
    // TCP  <local>  <foreign>  LISTENING  <pid>
    const local = cols[1] || ''
    const pid = Number(cols[cols.length - 1])
    const port = extractPortFromLsofName(local)
    if (!Number.isFinite(pid) || pid <= 0 || port == null) continue
    if (!ports.has(pid)) ports.set(pid, new Set())
    ports.get(pid)?.add(port)
  }
  const result = new Map<number, number[]>()
  for (const [pid, set] of ports) result.set(pid, [...set].sort((a, b) => a - b))
  return result
}

/** Parse Windows `tasklist /FO CSV /NH` into pid → image name. */
export function parseTasklist(stdout: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const cols = line.split('","').map((c) => c.replace(/^"|"$/g, ''))
    if (cols.length < 2) continue
    const image = cols[0]
    const pid = Number(cols[1])
    if (!Number.isFinite(pid) || !image) continue
    map.set(pid, image)
  }
  return map
}

/** Parse `wmic process get ParentProcessId,ProcessId /format:csv` → pid → ppid. */
export function parseWmicProcessParents(stdout: string): Map<number, number> {
  const map = new Map<number, number>()
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const cols = line.split(',')
    if (cols.length < 3) continue
    // Node,ParentProcessId,ProcessId
    const ppid = Number(cols[1])
    const pid = Number(cols[2])
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue
    map.set(pid, ppid)
  }
  return map
}

/** Known dev-server signatures, checked in order against the full command line. */
const SERVER_NAME_MATCHERS: Array<{ test: RegExp; label: string }> = [
  { test: /\bnext(-server|\s+dev)?\b/, label: 'next dev' },
  { test: /\bvite\b/, label: 'vite' },
  { test: /\bwebpack(-dev-server)?\b|\bwebpack\s+serve\b/, label: 'webpack' },
  { test: /\bnodemon\b/, label: 'nodemon' },
  { test: /\bvitest\b/, label: 'vitest' },
  { test: /\bastro\b/, label: 'astro dev' },
  { test: /\bremix\b/, label: 'remix dev' },
  { test: /\bnest\b.*\bstart\b/, label: 'nest start' },
  { test: /\bng\s+serve\b|@angular/, label: 'ng serve' },
  { test: /\breact-scripts\b/, label: 'react-scripts' },
  { test: /\b(npm|pnpm|yarn|bun)\b.*\b(run\s+)?(dev|start|serve)\b/, label: 'npm run dev' },
  { test: /\bhttp-server\b|\bserve\b/, label: 'static server' }
]

/** Derive a short human label for a server from its command line. */
export function deriveServerName(command: string): string {
  const lower = command.toLowerCase()
  for (const matcher of SERVER_NAME_MATCHERS) {
    if (matcher.test.test(lower)) return matcher.label
  }
  // Fallback: "node <script-basename>" for a bare node invocation, else the
  // basename of the first token.
  const tokens = command.trim().split(/\s+/)
  const first = tokens[0] || command
  const firstBase = first.split(/[\\/]/).filter(Boolean).pop() || first
  if (/^node$/i.test(firstBase) && tokens[1]) {
    const scriptBase = tokens[1].split(/[\\/]/).filter(Boolean).pop()
    if (scriptBase) return `node ${scriptBase}`
  }
  return firstBase
}

/** Normalize a path for cross-platform containment comparison. */
function normalizePathForCompare(input: string, caseInsensitive: boolean): string {
  let p = input.replace(/\\/g, '/').replace(/\/+$/, '')
  if (caseInsensitive) p = p.toLowerCase()
  return p
}

/** True when `child` is the same as, or nested inside, `parent` (segment-boundary). */
export function isPathInside(child: string, parent: string, caseInsensitive: boolean): boolean {
  const c = normalizePathForCompare(child, caseInsensitive)
  const p = normalizePathForCompare(parent, caseInsensitive)
  if (!c || !p) return false
  if (c === p) return true
  return c.startsWith(p + '/')
}

/**
 * Find the deepest workspace whose path contains `cwd`. Case-insensitive on
 * darwin/win32. Returns null when no workspace contains the cwd — the caller
 * uses that to DROP unrelated processes (the core safety scoping).
 */
export function matchWorkspaceForCwd(
  cwd: string | undefined,
  workspaces: LocalServerWorkspace[],
  platform: NodeJS.Platform = process.platform
): LocalServerWorkspace | null {
  if (!cwd) return null
  const caseInsensitive = platform === 'darwin' || platform === 'win32'
  let best: LocalServerWorkspace | null = null
  let bestLen = -1
  for (const ws of workspaces) {
    if (!ws.path) continue
    if (isPathInside(cwd, ws.path, caseInsensitive) && ws.path.length > bestLen) {
      best = ws
      bestLen = ws.path.length
    }
  }
  return best
}

/** Common dev ports preferred when a server listens on several. */
const PREFERRED_PORTS = [3000, 5173, 5174, 4321, 4200, 8080, 8000, 3001, 1420, 19000, 6006]

/** Choose the most "dev-server-like" port to surface as the primary. */
export function pickPrimaryPort(ports: number[]): number | undefined {
  if (!ports.length) return undefined
  for (const preferred of PREFERRED_PORTS) {
    if (ports.includes(preferred)) return preferred
  }
  return [...ports].sort((a, b) => a - b)[0]
}
