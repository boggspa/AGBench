/*
 * Windows local-server detector.
 *
 * Windows process cwd isn't cheaply available, so we can't scope detected
 * servers by workspace path the way macOS does. Instead we enumerate listening
 * ports (`netstat -ano`), image names (`tasklist`), and the pid→ppid tree
 * (`wmic`), then surface ONLY listeners whose ancestor chain includes a process
 * TaskWraith tracked (an agent spawn) — preserving the strict-scoping safety
 * property. Pure parsers live in ./parsers; the command runner is injectable.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  deriveServerName,
  findTrackedAncestor,
  parseNetstatListen,
  parseTasklist,
  parseWmicProcessParents,
  pickPrimaryPort
} from './parsers'
import type {
  LocalServerDetector,
  LocalServerDetectorContext,
  LocalServerEntry,
  LocalServersSnapshot
} from './types'
import type { CommandRunner } from './MacDetector'

const execFileAsync = promisify(execFile)

const defaultRunner: CommandRunner = async (command, args) => {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: 4_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    })
    return String(stdout)
  } catch {
    return ''
  }
}

export class WindowsDetector implements LocalServerDetector {
  readonly platform: NodeJS.Platform = 'win32'
  private run: CommandRunner

  constructor(run: CommandRunner = defaultRunner) {
    this.run = run
  }

  async detect(ctx: LocalServerDetectorContext): Promise<LocalServersSnapshot> {
    const sampledAt = new Date().toISOString()
    const tracked = ctx.tracked || []
    if (tracked.length === 0) {
      // Nothing tracked → nothing we can safely attribute on Windows.
      return { sampledAt, servers: [], platform: this.platform, detectionAvailable: true }
    }

    const netstatOut = await this.run('netstat', ['-ano'])
    const portsByPid = parseNetstatListen(netstatOut)
    if (portsByPid.size === 0) {
      return { sampledAt, servers: [], platform: this.platform, detectionAvailable: true }
    }

    const [tasklistOut, wmicOut] = await Promise.all([
      this.run('tasklist', ['/FO', 'CSV', '/NH']),
      this.run('wmic', ['process', 'get', 'ParentProcessId,ProcessId', '/format:csv'])
    ])
    const imageByPid = parseTasklist(tasklistOut)
    const ppidByPid = parseWmicProcessParents(wmicOut)
    const trackedByPid = new Map(tracked.map((t) => [t.pid, t]))
    const trackedPids = new Set(trackedByPid.keys())

    const ownPid = process.pid
    const servers: LocalServerEntry[] = []
    for (const [pid, ports] of portsByPid) {
      if (pid === ownPid) continue
      const ancestorPid = findTrackedAncestor(pid, ppidByPid, trackedPids)
      if (ancestorPid == null) continue // strict scoping: agent-tracked only on Windows
      const spawn = trackedByPid.get(ancestorPid)
      const command = imageByPid.get(pid) || spawn?.provider || ''
      servers.push({
        id: String(pid),
        pid,
        name: deriveServerName(command) || 'server',
        command,
        ports,
        primaryPort: pickPrimaryPort(ports),
        workspacePath: spawn?.workspacePath,
        origin: 'agent-spawned',
        pgid: spawn?.pgid,
        chatId: spawn?.chatId,
        runId: spawn?.runId,
        provider: spawn?.provider,
        startedAt: spawn?.startedAt
      })
    }
    return { sampledAt, servers, platform: this.platform, detectionAvailable: true }
  }
}
