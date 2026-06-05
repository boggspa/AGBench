import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock electron-updater BEFORE importing UpdateService — autoUpdater is
// a real Electron-runtime singleton and we don't want it to do anything
// during tests. `vi.hoisted` runs at the same hoisted phase as
// `vi.mock`, sidestepping the temporal dead zone we'd hit if the
// factory closed over a plain `const`.
const mockAutoUpdater = vi.hoisted(() => ({
  channel: 'latest' as string,
  autoDownload: true,
  autoInstallOnAppQuit: true,
  logger: null as unknown,
  checkForUpdates: vi.fn(async () => null),
  downloadUpdate: vi.fn(async () => ['/tmp/update.dmg']),
  quitAndInstall: vi.fn(),
  on: vi.fn(),
  emit: vi.fn()
}))

vi.mock('electron-updater', () => ({
  autoUpdater: mockAutoUpdater
}))

import { UpdateService } from './UpdateService'

function emitUpdaterEvent(name: string, payload?: unknown): void {
  const handler = mockAutoUpdater.on.mock.calls.find((call) => call[0] === name)?.[1]
  if (typeof handler === 'function') {
    handler(payload)
  }
}

describe('UpdateService', () => {
  beforeEach(() => {
    mockAutoUpdater.checkForUpdates.mockClear()
    mockAutoUpdater.downloadUpdate.mockClear()
    mockAutoUpdater.quitAndInstall.mockClear()
    mockAutoUpdater.on.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('starts in `disabled` status until configured', () => {
    const svc = new UpdateService()
    expect(svc.snapshot().status).toBe('disabled')
    expect(svc.snapshot().enabled).toBe(false)
  })

  it('stays disabled when configured with channel=debug', () => {
    const svc = new UpdateService()
    svc.configure({ channel: 'debug', enabled: true })
    expect(svc.snapshot().status).toBe('disabled')
    expect(svc.snapshot().channel).toBe('debug')
  })

  it('stays disabled when enabled=false even with a real channel', () => {
    const svc = new UpdateService()
    svc.configure({ channel: 'stable', enabled: false })
    expect(svc.snapshot().status).toBe('disabled')
  })

  it('moves to idle when configured with a real channel + enabled', () => {
    const svc = new UpdateService()
    svc.configure({ channel: 'stable', enabled: true })
    expect(svc.snapshot().status).toBe('idle')
    expect(svc.snapshot().enabled).toBe(true)
    expect(mockAutoUpdater.channel).toBe('latest')
  })

  it('maps nightly channel to electron-updater beta', () => {
    const svc = new UpdateService()
    svc.configure({ channel: 'nightly', enabled: true })
    expect(mockAutoUpdater.channel).toBe('beta')
  })

  it('wires the autoUpdater event listeners exactly once', () => {
    const svc = new UpdateService()
    svc.configure({ channel: 'stable', enabled: true })
    const firstCount = mockAutoUpdater.on.mock.calls.length
    expect(firstCount).toBeGreaterThan(0)
    svc.configure({ channel: 'nightly', enabled: true })
    // Should not re-attach listeners on a re-configure.
    expect(mockAutoUpdater.on.mock.calls.length).toBe(firstCount)
  })

  it('checkForUpdates is a no-op when disabled', async () => {
    const svc = new UpdateService()
    const result = await svc.checkForUpdates()
    expect(result).toBeNull()
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('checkForUpdates transitions to checking + invokes autoUpdater', async () => {
    const svc = new UpdateService()
    svc.configure({ channel: 'stable', enabled: true })
    const listener = vi.fn()
    svc.subscribe(listener)
    await svc.checkForUpdates()
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    // First subscriber call should report `checking`; subsequent
    // transitions depend on autoUpdater events which we haven't fired
    // here.
    const statuses = listener.mock.calls.map((c) => (c[0] as { status: string }).status)
    expect(statuses).toContain('checking')
  })

  it('handles checkForUpdates errors as error status', async () => {
    mockAutoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('feed unavailable'))
    const svc = new UpdateService()
    svc.configure({ channel: 'stable', enabled: true })
    await svc.checkForUpdates()
    const snap = svc.snapshot()
    expect(snap.status).toBe('error')
    expect(snap.errorMessage).toContain('feed unavailable')
  })

  it('downloadUpdate is rejected when status is not "available"', async () => {
    const svc = new UpdateService()
    svc.configure({ channel: 'stable', enabled: true })
    await svc.downloadUpdate()
    expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('quitAndInstall is rejected when status is not "downloaded"', () => {
    const svc = new UpdateService()
    svc.configure({ channel: 'stable', enabled: true })
    svc.quitAndInstall()
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('subscribers receive snapshots on configure', () => {
    const svc = new UpdateService()
    const listener = vi.fn()
    svc.subscribe(listener)
    svc.configure({ channel: 'stable', enabled: true })
    expect(listener).toHaveBeenCalled()
    expect(listener.mock.calls[listener.mock.calls.length - 1][0]).toMatchObject({
      status: 'idle',
      channel: 'stable',
      enabled: true
    })
  })

  it('unsubscribe stops further updates', () => {
    const svc = new UpdateService()
    const listener = vi.fn()
    const unsub = svc.subscribe(listener)
    svc.configure({ channel: 'stable', enabled: true })
    const callsAfterFirstConfigure = listener.mock.calls.length
    unsub()
    svc.configure({ channel: 'nightly', enabled: true })
    expect(listener.mock.calls.length).toBe(callsAfterFirstConfigure)
  })

  it('listener that throws does not break other listeners', () => {
    const svc = new UpdateService({ log: vi.fn() })
    const bad = vi.fn(() => {
      throw new Error('bad listener')
    })
    const good = vi.fn()
    svc.subscribe(bad)
    svc.subscribe(good)
    svc.configure({ channel: 'stable', enabled: true })
    expect(bad).toHaveBeenCalled()
    expect(good).toHaveBeenCalled()
  })

  it('snapshot includes lastCheckedAt after a check', async () => {
    const svc = new UpdateService()
    svc.configure({ channel: 'stable', enabled: true })
    expect(svc.snapshot().lastCheckedAt).toBeUndefined()
    await svc.checkForUpdates()
    const snap = svc.snapshot()
    expect(snap.lastCheckedAt).toBeDefined()
    expect(new Date(snap.lastCheckedAt!).getTime()).toBeGreaterThan(0)
  })

  it('captures release metadata when an update is available', () => {
    const svc = new UpdateService({ platform: 'darwin', arch: 'arm64' })
    svc.configure({ channel: 'stable', enabled: true })
    emitUpdaterEvent('update-available', {
      version: '1.0.73',
      files: [],
      path: 'AGBench-1.0.73.dmg',
      sha512: 'abc',
      releaseName: 'AGBench 1.0.73',
      releaseDate: '2026-06-04T12:00:00.000Z',
      releaseNotes: 'New updater UI.'
    })

    expect(svc.snapshot()).toMatchObject({
      status: 'available',
      latestVersion: '1.0.73',
      releaseName: 'AGBench 1.0.73',
      releaseDate: '2026-06-04T12:00:00.000Z',
      releaseNotes: 'New updater UI.',
      updateArchitecture: {
        platform: 'darwin',
        arch: 'arm64',
        artifactName: 'AGBench-1.0.73.dmg',
        artifactArch: 'unknown',
        compatible: true,
        reason: 'Unknown mac update artifact architecture: AGBench-1.0.73.dmg'
      },
      releasePageUrl: 'https://github.com/boggspa/AGBench/releases/tag/v1.0.73'
    })
  })

  it('rejects an arm64-only mac update before download on Intel', async () => {
    const svc = new UpdateService({ platform: 'darwin', arch: 'x64' })
    svc.configure({ channel: 'stable', enabled: true })

    emitUpdaterEvent('update-available', {
      version: '1.0.73',
      files: [{ url: 'AGBench-1.0.73-arm64-mac.zip', sha512: 'abc', size: 1 }],
      path: 'AGBench-1.0.73-arm64-mac.zip',
      sha512: 'abc'
    })

    expect(svc.snapshot()).toMatchObject({
      status: 'error',
      errorMessage: 'Incompatible update artifact: host=darwin-x64 artifact=arm64',
      updateArchitecture: {
        platform: 'darwin',
        arch: 'x64',
        artifactName: 'AGBench-1.0.73-arm64-mac.zip',
        artifactArch: 'arm64',
        compatible: false
      }
    })

    await svc.downloadUpdate()
    expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('accepts a universal mac update on Intel', () => {
    const svc = new UpdateService({ platform: 'darwin', arch: 'x64' })
    svc.configure({ channel: 'stable', enabled: true })

    emitUpdaterEvent('update-available', {
      version: '1.0.73',
      files: [{ url: 'AGBench-1.0.73-universal-mac.zip', sha512: 'abc', size: 1 }],
      path: 'AGBench-1.0.73-universal-mac.zip',
      sha512: 'abc'
    })

    expect(svc.snapshot()).toMatchObject({
      status: 'available',
      updateArchitecture: {
        platform: 'darwin',
        arch: 'x64',
        artifactName: 'AGBench-1.0.73-universal-mac.zip',
        artifactArch: 'universal',
        compatible: true
      }
    })
  })

  it('preserves full changelog arrays when an update is downloaded', () => {
    const svc = new UpdateService()
    svc.configure({ channel: 'stable', enabled: true })
    emitUpdaterEvent('update-downloaded', {
      version: '1.0.74',
      files: [],
      path: 'AGBench-1.0.74.dmg',
      sha512: 'abc',
      releaseDate: '2026-06-04T13:00:00.000Z',
      releaseNotes: [
        { version: '1.0.74', note: 'Second update.' },
        { version: '1.0.73', note: null }
      ]
    })

    expect(svc.snapshot()).toMatchObject({
      status: 'downloaded',
      latestVersion: '1.0.74',
      releaseNotes: [
        { version: '1.0.74', note: 'Second update.' },
        { version: '1.0.73', note: null }
      ]
    })
  })

  it('clears stale release metadata when no update is available', () => {
    const svc = new UpdateService()
    svc.configure({ channel: 'stable', enabled: true })
    emitUpdaterEvent('update-available', {
      version: '1.0.73',
      files: [],
      path: 'AGBench-1.0.73.dmg',
      sha512: 'abc',
      releaseDate: '2026-06-04T12:00:00.000Z',
      releaseNotes: 'New updater UI.'
    })
    emitUpdaterEvent('update-not-available')

    expect(svc.snapshot()).toMatchObject({
      status: 'not-available',
      latestVersion: undefined,
      releaseNotes: undefined
    })
  })

  it('reconfigure to debug after enabled returns to disabled', () => {
    const svc = new UpdateService()
    svc.configure({ channel: 'stable', enabled: true })
    expect(svc.snapshot().status).toBe('idle')
    svc.configure({ channel: 'debug', enabled: true })
    expect(svc.snapshot().status).toBe('disabled')
  })
})
