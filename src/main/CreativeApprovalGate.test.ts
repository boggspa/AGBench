import { describe, expect, it, vi } from 'vitest'

import { CreativeApprovalGate, type CreativeApprovalRequestBroadcast } from './CreativeApprovalGate'

const sampleDetails = {
  title: 'Send your edit to Final Cut Pro',
  description: 'Open the freshly-written .fcpxml in Final Cut Pro',
  filePath: '/tmp/edit-abc.fcpxml',
  targetBundleId: 'com.apple.FinalCut'
}

describe('CreativeApprovalGate (K3)', () => {
  it('broadcasts a request and resolves approved when the renderer says yes', async () => {
    const broadcasts: CreativeApprovalRequestBroadcast[] = []
    const gate = new CreativeApprovalGate({
      broadcastRequest: (request) => broadcasts.push(request)
    })
    const pending = gate.requestApproval('fcp.import-fcpxml', sampleDetails)
    expect(broadcasts).toHaveLength(1)
    expect(broadcasts[0].className).toBe('fcp.import-fcpxml')
    expect(broadcasts[0].details.filePath).toBe('/tmp/edit-abc.fcpxml')
    gate.resolveApproval(broadcasts[0].requestId, { approved: true })
    const decision = await pending
    expect(decision).toEqual({ approved: true, rememberForSession: false })
  })

  it('caches the className when rememberForSession is true and short-circuits future requests', async () => {
    const broadcasts: CreativeApprovalRequestBroadcast[] = []
    const gate = new CreativeApprovalGate({
      broadcastRequest: (request) => broadcasts.push(request)
    })
    // First call → broadcasts, user approves + remembers.
    const firstPending = gate.requestApproval('applescript:fcp.open-project', sampleDetails)
    gate.resolveApproval(broadcasts[0].requestId, { approved: true, rememberForSession: true })
    await firstPending
    expect(gate.approvedClassesSnapshot()).toEqual(['applescript:fcp.open-project'])
    // Second call → does NOT broadcast, resolves immediately.
    const secondPending = gate.requestApproval('applescript:fcp.open-project', sampleDetails)
    expect(broadcasts).toHaveLength(1)
    const secondDecision = await secondPending
    expect(secondDecision).toEqual({ approved: true, rememberForSession: true })
  })

  it('does not cache when rememberForSession is false', async () => {
    const broadcasts: CreativeApprovalRequestBroadcast[] = []
    const gate = new CreativeApprovalGate({
      broadcastRequest: (request) => broadcasts.push(request)
    })
    const pending = gate.requestApproval('applescript:raw', sampleDetails)
    gate.resolveApproval(broadcasts[0].requestId, { approved: true, rememberForSession: false })
    await pending
    expect(gate.approvedClassesSnapshot()).toEqual([])
    // Second call → still broadcasts.
    void gate.requestApproval('applescript:raw', sampleDetails)
    expect(broadcasts).toHaveLength(2)
  })

  it('resolves rejected when the renderer rejects', async () => {
    const broadcasts: CreativeApprovalRequestBroadcast[] = []
    const gate = new CreativeApprovalGate({
      broadcastRequest: (request) => broadcasts.push(request)
    })
    const pending = gate.requestApproval('fcp.import-fcpxml', sampleDetails)
    gate.resolveApproval(broadcasts[0].requestId, { approved: false })
    const decision = await pending
    expect(decision).toEqual({ approved: false, reason: 'user-rejected' })
  })

  it('does not cache a previously-approved class when the next call rejects', async () => {
    const broadcasts: CreativeApprovalRequestBroadcast[] = []
    const gate = new CreativeApprovalGate({
      broadcastRequest: (request) => broadcasts.push(request)
    })
    // Approve without remembering first.
    void gate.requestApproval('applescript:fcp.set-playhead', sampleDetails)
    gate.resolveApproval(broadcasts[0].requestId, { approved: true })
    expect(gate.approvedClassesSnapshot()).toEqual([])
  })

  it('resolves timeout-rejected when no decision arrives within the timeout', async () => {
    vi.useFakeTimers()
    try {
      const broadcasts: CreativeApprovalRequestBroadcast[] = []
      const gate = new CreativeApprovalGate({
        broadcastRequest: (request) => broadcasts.push(request),
        timeoutMs: 10_000
      })
      const pending = gate.requestApproval('fcp.import-fcpxml', sampleDetails)
      // Fast-forward past the timeout.
      vi.advanceTimersByTime(10_001)
      const decision = await pending
      expect(decision).toEqual({ approved: false, reason: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed when the broadcast throws', async () => {
    const gate = new CreativeApprovalGate({
      broadcastRequest: () => {
        throw new Error('no renderer attached')
      }
    })
    const decision = await gate.requestApproval('fcp.import-fcpxml', sampleDetails)
    expect(decision).toEqual({ approved: false, reason: 'cache-rejected' })
  })

  it('ignores resolveApproval for unknown request ids without crashing', () => {
    const gate = new CreativeApprovalGate({
      broadcastRequest: () => {}
    })
    // Just shouldn't throw.
    gate.resolveApproval('bogus-id', { approved: true })
  })

  it('clearSessionApprovals wipes the cache', async () => {
    const broadcasts: CreativeApprovalRequestBroadcast[] = []
    const gate = new CreativeApprovalGate({
      broadcastRequest: (request) => broadcasts.push(request)
    })
    void gate.requestApproval('blender:render-still', sampleDetails)
    gate.resolveApproval(broadcasts[0].requestId, { approved: true, rememberForSession: true })
    expect(gate.approvedClassesSnapshot()).toEqual(['blender:render-still'])
    gate.clearSessionApprovals()
    expect(gate.approvedClassesSnapshot()).toEqual([])
    // Next call broadcasts again.
    void gate.requestApproval('blender:render-still', sampleDetails)
    expect(broadcasts).toHaveLength(2)
  })
})
