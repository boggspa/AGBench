import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { ProviderId } from '../../../main/store/types'
import { createOneShotLatch } from '../lib/oneShotLatch'

/**
 * QMOD (1.0.3) — state for an in-flight `ask_user_question` MCP tool
 * invocation. The agent's tool call parks main-process-side; main fires
 * `agent-question-requested` IPC with the question payload + a
 * `questionId` opaque to the renderer. We surface a card in the
 * transcript and on submit/dismiss, post the answer back via
 * `answerAgentQuestion` / `cancelAgentQuestion`. The parked Promise
 * resolves and the agent's tool call returns the answer as its result.
 *
 * Per-chat state because two chats could each have an open question
 * simultaneously and they shouldn't bleed into each other.
 *
 * `messageId` is the synthetic system-message inserted into the chat
 * transcript at question time — the card renders adjacent to that
 * message so it's anchored in the conversation flow.
 */
export type AgentQuestionState = {
  questionId: string
  appRunId: string
  messageId: string
  provider: ProviderId | null
  question: string
  options?: string[]
  context?: string
  askedAt: number
}

export interface AgentQuestionCardProps {
  state: AgentQuestionState
  onAnswer: (answer: string, isCustom: boolean) => void
  onDismiss: () => void
}

export function AgentQuestionCard({
  state,
  onAnswer,
  onDismiss
}: AgentQuestionCardProps): ReactElement {
  const hasOptions = (state.options?.length ?? 0) > 0
  const [showFreeText, setShowFreeText] = useState(!hasOptions)
  const [freeText, setFreeText] = useState('')
  const providerClass = state.provider ? ` provider-${state.provider}` : ''

  // Resolve-once guard: a fast double-click, or an answer racing the ×/Escape
  // dismiss, must not fire both `answerAgentQuestion` AND `cancelAgentQuestion`
  // for the same parked MCP call. One latch per mounted card — the render sites
  // key the card by questionId, so each new question mounts a fresh card (and a
  // fresh latch); no in-render ref reset needed.
  const latchRef = useRef(createOneShotLatch())
  const answerOnce = (value: string, isCustom: boolean): void => {
    latchRef.current.run(() => onAnswer(value, isCustom))
  }
  const dismissOnce = (): void => {
    latchRef.current.run(() => onDismiss())
  }

  const submitFreeText = (): void => {
    if (!freeText.trim()) return
    answerOnce(freeText.trim(), true)
  }

  return (
    <div className={`plan-choice-card agent-question-card${providerClass}`}>
      <div className="plan-choice-question agent-question-card-question">{state.question}</div>
      {state.context && <div className="agent-question-card-context">{state.context}</div>}
      {hasOptions && !showFreeText && (
        <div className="plan-choice-actions">
          {state.options!.map((option) => (
            <button
              key={option}
              type="button"
              className="plan-choice-action-btn"
              onClick={() => answerOnce(option, false)}
              title={`Answer: ${option}`}
            >
              {option}
            </button>
          ))}
          <button
            type="button"
            className="plan-choice-action-btn agent-question-card-other"
            onClick={() => setShowFreeText(true)}
            title="Type your own answer instead"
          >
            Other…
          </button>
        </div>
      )}
      {showFreeText && (
        <div className="agent-question-card-freetext">
          <textarea
            className="agent-question-card-input"
            value={freeText}
            onChange={(event) => setFreeText(event.target.value)}
            placeholder="Type your answer… (⌘/Ctrl+Enter to submit)"
            rows={3}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                submitFreeText()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                if (hasOptions) {
                  setShowFreeText(false)
                  setFreeText('')
                } else {
                  dismissOnce()
                }
              }
            }}
          />
          <div className="agent-question-card-freetext-actions">
            {hasOptions && (
              <button
                type="button"
                className="plan-choice-action-btn agent-question-card-cancel"
                onClick={() => {
                  setShowFreeText(false)
                  setFreeText('')
                }}
              >
                Back to options
              </button>
            )}
            <button
              type="button"
              className="plan-choice-action-btn agent-question-card-submit"
              onClick={submitFreeText}
              disabled={!freeText.trim()}
            >
              Send answer
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        className="agent-question-card-dismiss"
        onClick={dismissOnce}
        title="Dismiss without answering (agent receives `cancelled: true`)"
        aria-label="Dismiss question"
      >
        ×
      </button>
    </div>
  )
}
