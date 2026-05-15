import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  NoopApnsPusher,
  createBridgeApnsPusher,
  type BridgeApprovalPushPayload
} from './BridgeApnsPusher'

describe('NoopApnsPusher', () => {
  const samplePayload: BridgeApprovalPushPayload = {
    pairID: 'pair-1',
    workspaceId: 'ws-1',
    threadId: 't-1',
    toolCallId: 'tool-99',
    summary: 'Run `rm -rf /tmp/foo`?'
  }

  it('returns delivered=false with reason=noop for approval pushes', async () => {
    const pusher = new NoopApnsPusher()
    const result = await pusher.pushApprovalNeeded(samplePayload)
    expect(result.delivered).toBe(false)
    expect(result.apnsId).toBe('')
    expect(result.reason).toBe('noop')
  })

  it('returns delivered=false with reason=noop for silent pushes', async () => {
    const pusher = new NoopApnsPusher()
    const result = await pusher.pushSilent('pair-1')
    expect(result.delivered).toBe(false)
    expect(result.reason).toBe('noop')
  })

  it('logs intent when an approval push is requested', async () => {
    const log = vi.fn()
    const pusher = new NoopApnsPusher(log)
    await pusher.pushApprovalNeeded(samplePayload)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('approval')
    expect(log.mock.calls[0][0]).toContain('pair-1')
    expect(log.mock.calls[0][0]).toContain('ws-1')
    expect(log.mock.calls[0][0]).toContain('tool-99')
  })

  it('does not throw on any payload shape', async () => {
    const pusher = new NoopApnsPusher()
    await expect(
      pusher.pushApprovalNeeded({
        pairID: '',
        workspaceId: '',
        threadId: '',
        toolCallId: '',
        summary: ''
      })
    ).resolves.toMatchObject({ delivered: false })
  })
})

describe('createBridgeApnsPusher factory', () => {
  const envBackup = {
    apns: process.env.AGBENCH_BRIDGE_APNS,
    dry: process.env.AGBENCH_BRIDGE_APNS_DRY_RUN
  }

  afterEach(() => {
    if (envBackup.apns === undefined) delete process.env.AGBENCH_BRIDGE_APNS
    else process.env.AGBENCH_BRIDGE_APNS = envBackup.apns
    if (envBackup.dry === undefined) delete process.env.AGBENCH_BRIDGE_APNS_DRY_RUN
    else process.env.AGBENCH_BRIDGE_APNS_DRY_RUN = envBackup.dry
  })

  it('returns a NoopApnsPusher by default', async () => {
    delete process.env.AGBENCH_BRIDGE_APNS
    const pusher = createBridgeApnsPusher()
    expect(pusher).toBeInstanceOf(NoopApnsPusher)
  })

  it('logs the chosen env at construction', () => {
    const log = vi.fn()
    process.env.AGBENCH_BRIDGE_APNS = 'sandbox'
    createBridgeApnsPusher({ log })
    const allLogs = log.mock.calls.map((c) => c[0] as string).join('\n')
    expect(allLogs).toContain('env=sandbox')
  })

  it('respects explicit options over env vars', () => {
    const log = vi.fn()
    process.env.AGBENCH_BRIDGE_APNS = 'sandbox'
    createBridgeApnsPusher({ log, env: 'production' })
    const allLogs = log.mock.calls.map((c) => c[0] as string).join('\n')
    expect(allLogs).toContain('env=production')
  })

  it('reports dryRun=true when env flag is set', () => {
    const log = vi.fn()
    process.env.AGBENCH_BRIDGE_APNS_DRY_RUN = '1'
    createBridgeApnsPusher({ log })
    const allLogs = log.mock.calls.map((c) => c[0] as string).join('\n')
    expect(allLogs).toContain('dryRun=true')
  })

  it('returned pusher honors the interface contract', async () => {
    const pusher = createBridgeApnsPusher()
    const approvalResult = await pusher.pushApprovalNeeded({
      pairID: 'p',
      workspaceId: 'w',
      threadId: 't',
      toolCallId: 'tc',
      summary: 's'
    })
    expect(approvalResult.delivered).toBe(false)
    const silentResult = await pusher.pushSilent('p')
    expect(silentResult.delivered).toBe(false)
  })
})
