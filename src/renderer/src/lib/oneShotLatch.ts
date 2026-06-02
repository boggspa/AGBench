/**
 * A one-shot latch: the first `run(fn)` executes `fn` and latches; every later
 * `run` is a no-op that returns false.
 *
 * AgentQuestionCard uses this as a resolve-once guard. A question is answered
 * by posting back via `answerAgentQuestion` OR cancelled via
 * `cancelAgentQuestion` — exactly one should reach the parked MCP tool call. A
 * fast double-click on an option, or an answer racing the ×/Escape dismiss,
 * could otherwise fire both, leaving the agent with an answer AND a
 * cancellation for the same question. The latch collapses that to a single
 * resolution.
 */
export function createOneShotLatch(): {
  run: (fn: () => void) => boolean
  used: () => boolean
} {
  let latched = false
  return {
    run(fn: () => void): boolean {
      if (latched) return false
      latched = true
      fn()
      return true
    },
    used: () => latched
  }
}
