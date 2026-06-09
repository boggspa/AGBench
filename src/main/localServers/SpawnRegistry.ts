/*
 * SpawnRegistry — tracks the OS processes TaskWraith itself spawns for agent
 * tool calls (and provider CLIs), so they can be attributed ("agent-started")
 * in the Local Servers list and cleanly reaped by process group. Keyed by pid;
 * untracked when the spawn exits.
 */

import type { TrackedSpawn } from './types'

export class SpawnRegistry {
  private byPid = new Map<number, TrackedSpawn>()

  track(spawn: TrackedSpawn): void {
    if (!Number.isFinite(spawn.pid)) return
    this.byPid.set(spawn.pid, spawn)
  }

  untrack(pid: number): void {
    this.byPid.delete(pid)
  }

  get(pid: number): TrackedSpawn | undefined {
    return this.byPid.get(pid)
  }

  list(): TrackedSpawn[] {
    return [...this.byPid.values()]
  }

  byRunId(runId: string): TrackedSpawn[] {
    return this.list().filter((spawn) => spawn.runId === runId)
  }

  clear(): void {
    this.byPid.clear()
  }
}
