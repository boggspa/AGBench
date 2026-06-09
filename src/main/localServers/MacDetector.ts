/*
 * macOS local-server detector.
 *
 * Enumerates LISTENing TCP sockets via `lsof`, resolves each owning process's
 * cwd + full argv, and keeps only those whose cwd is under a registered
 * workspace (or that TaskWraith itself spawned). Thin glue over the pure
 * parsers in ./parsers — the command runner is injectable for tests.
 */

import { execFile } from 'child_process'
import { realpathSync } from 'fs'
import { promisify } from 'util'
import { formatLocalServerWorkspaceLabel } from '../../shared/localServerWorkspaceLabel'
import {
  deriveServerName,
  findTrackedAncestor,
  matchWorkspaceForCwd,
  parseMacLsofCwd,
  parseMacLsofListen,
  parseProcessCommandList,
  pickPrimaryPort
} from './parsers'
import type {
  LocalServerDetector,
  LocalServerDetectorContext,
  LocalServerEntry,
  LocalServersSnapshot,
  TrackedSpawn
} from './types'

const execFileAsync = promisify(execFile)

/** Runs a command and resolves its stdout, or '' on any failure (timeout, ENOENT). */
export type CommandRunner = (command: string, args: string[]) => Promise<string>

const defaultRunner: CommandRunner = async (command, args) => {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: 3_000,
      maxBuffer: 4 * 1024 * 1024
    })
    return String(stdout)
  } catch {
    return ''
  }
}

export class MacDetector implements LocalServerDetector {
  readonly platform: NodeJS.Platform = 'darwin'
  private run: CommandRunner

  constructor(run: CommandRunner = defaultRunner) {
    this.run = run
  }

  async detect(ctx: LocalServerDetectorContext): Promise<LocalServersSnapshot> {
    const sampledAt = new Date().toISOString()
    const trackedByPid = new Map<number, TrackedSpawn>()
    for (const spawn of ctx.tracked || []) trackedByPid.set(spawn.pid, spawn)
    // Resolve workspace symlinks so a cwd lsof reports as a real path
    // (e.g. /private/tmp/x on macOS) still matches a workspace stored as
    // /tmp/x. Done once per sample; falls back to the original on error.
    const workspaces = ctx.workspaces.map((ws) => ({ ...ws, path: safeRealpath(ws.path) }))

    const listenOut = await this.run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn'])
    const listen = parseMacLsofListen(listenOut)

    // Nothing listening → an empty (but available) snapshot. (Tracked-but-not-
    // listening shells aren't "servers"; their listening descendants are.)
    if (listen.size === 0) {
      return { sampledAt, servers: [], platform: this.platform, detectionAvailable: true }
    }

    const listenerPids = [...listen.keys()]
    const [cwdOut, psOut] = await Promise.all([
      this.run('lsof', ['-a', '-p', listenerPids.join(','), '-d', 'cwd', '-Fpn']),
      this.run('ps', ['-axo', 'pid=,ppid=,rss=,command='])
    ])
    const cwdByPid = parseMacLsofCwd(cwdOut)
    const cmdByPid = parseProcessCommandList(psOut)
    const ppidByPid = new Map<number, number>()
    for (const [pid, info] of cmdByPid) if (info.ppid != null) ppidByPid.set(pid, info.ppid)
    const trackedPids = new Set(trackedByPid.keys())

    const ownPid = process.pid
    const servers: LocalServerEntry[] = []
    for (const pid of listenerPids) {
      if (pid === ownPid) continue
      const listenInfo = listen.get(pid)!
      const ports = listenInfo.ports

      // Attribute to the agent command that launched it: the listener is
      // usually a descendant of the tracked shell/CLI, so walk ancestors.
      const ancestorPid = findTrackedAncestor(pid, ppidByPid, trackedPids)
      const tracked = ancestorPid != null ? trackedByPid.get(ancestorPid) : undefined

      const command = cmdByPid.get(pid)?.command || listenInfo.command || ''
      const cwd = cwdByPid.get(pid)
      const workspace = matchWorkspaceForCwd(cwd, workspaces, this.platform)

      // Strict scoping: surface only when cwd is under a workspace OR an
      // agent we tracked launched it. Unrelated system servers are dropped.
      if (!workspace && !tracked) continue

      servers.push({
        id: String(pid),
        pid,
        name: deriveServerName(command) || 'server',
        command,
        ports,
        primaryPort: pickPrimaryPort(ports),
        cwd,
        workspaceId: workspace?.id,
        workspacePath: workspace?.path || tracked?.workspacePath,
        workspaceName: workspace?.displayName
          ? formatLocalServerWorkspaceLabel(workspace.displayName)
          : undefined,
        origin: tracked ? 'agent-spawned' : 'detected',
        rssBytes: cmdByPid.get(pid)?.rssBytes,
        pgid: tracked?.pgid,
        chatId: tracked?.chatId,
        runId: tracked?.runId,
        provider: tracked?.provider,
        startedAt: tracked?.startedAt
      })
    }

    servers.sort(sortServers)
    return { sampledAt, servers, platform: this.platform, detectionAvailable: true }
  }
}

/** realpathSync that falls back to the input on any error (missing dir, perms). */
function safeRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/** Agent-spawned first, then by workspace name, then by primary port. */
export function sortServers(a: LocalServerEntry, b: LocalServerEntry): number {
  if (a.origin !== b.origin) return a.origin === 'agent-spawned' ? -1 : 1
  const wa = a.workspaceName || a.workspacePath || ''
  const wb = b.workspaceName || b.workspacePath || ''
  if (wa !== wb) return wa.localeCompare(wb)
  return (a.primaryPort || 0) - (b.primaryPort || 0)
}
