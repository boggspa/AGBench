import { describe, expect, it } from 'vitest'
import {
  agentInvocationRouteLabel,
  agentInvocationSourceClassName,
  agentInvocationSourceLabel,
  childAgentInteractivityLabel,
  childAgentStateLabel,
  providerDisplayName
} from './AgentInvocationPresentation'

describe('AgentInvocationPresentation', () => {
  it('uses one source vocabulary for provider-native and AGBench invocations', () => {
    expect(agentInvocationSourceLabel('provider-native')).toBe('Provider Native')
    expect(agentInvocationSourceLabel('agbench-subthread')).toBe('AGBench Sub-thread')
    expect(agentInvocationSourceClassName('provider-native')).toBe('source-provider-native')
    expect(agentInvocationSourceClassName('agbench-subthread')).toBe('source-agbench-subthread')
  })

  it('keeps the route distinction explicit', () => {
    expect(agentInvocationRouteLabel('provider-native')).toBe(
      'Provider tool call in this transcript'
    )
    expect(agentInvocationRouteLabel('agbench-subthread')).toBe('Durable sub-thread')
  })

  it('formats provider, status, and interactivity labels', () => {
    expect(providerDisplayName('claude')).toBe('Claude')
    expect(providerDisplayName('cursor')).toBe('Cursor')
    expect(providerDisplayName('unknown')).toBe('Agent')
    expect(childAgentStateLabel('running')).toBe('Running')
    expect(childAgentStateLabel('queued')).toBe('Queued')
    expect(childAgentInteractivityLabel('observe-only')).toBe('Observe-only')
  })
})
