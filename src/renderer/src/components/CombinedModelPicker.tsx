/*
 * CombinedModelPicker — replaces the per-provider native <select>
 * model + reasoning controls with one chip + a two-column popover
 * (Model on the left, Reasoning on the right). Modelled after real
 * Codex's nested model + reasoning menu.
 *
 * Wires to existing renderer state (no new IPC, no new types):
 *   - selectedModelId / onSelectModel — model picker state
 *   - reasoningOptions / selectedReasoning / onSelectReasoning —
 *     per-provider reasoning state, with provider-aware label
 *     mapping handled by `composerChipFormat`.
 *
 * Chip text comes from `formatComposerModelChip(ctx)` — per-shell
 * native format when the shell + provider align, AGBench default
 * otherwise.
 *
 * Popover positioning + keyboard nav cloned from AgentMentionMenu:
 *   - Portaled to document.body so it escapes any transformed
 *     ancestor.
 *   - ArrowUp / ArrowDown navigates the focused column.
 *   - ArrowLeft / ArrowRight switches columns (when both visible).
 *   - Enter commits highlighted item.
 *   - Escape dismisses.
 *   - Click-outside dismisses.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProviderId, ComposerStyle } from '../../../main/store/types'
import {
  formatComposerModelChip,
  reasoningDisplayLabel
} from '../lib/composerChipFormat'

export interface CombinedModelPickerModelOption {
  id: string
  label: string
}

export interface CombinedModelPickerReasoningOption {
  /** Internal token (e.g. 'low' | 'medium' | 'high' | 'xhigh' | 'off'). */
  value: string
  /** Human-readable label as it should appear in the popover row. */
  label: string
}

interface CombinedModelPickerProps {
  provider: ProviderId
  composerStyle: ComposerStyle
  modelOptions: CombinedModelPickerModelOption[]
  selectedModelId: string
  onSelectModel: (modelId: string) => void
  /**
   * Reasoning options for the current provider. Pass an empty array
   * to hide the reasoning column entirely (e.g. Gemini today).
   */
  reasoningOptions: CombinedModelPickerReasoningOption[]
  selectedReasoning: string
  onSelectReasoning: (value: string) => void
  /** Codex reasoning effort token (so the chip text can format it). */
  codexReasoningEffort?: string
  /** Claude reasoning effort token (so the chip text can format it). */
  claudeReasoningEffort?: string
  /** Kimi thinking flag (so the chip text can format it). */
  kimiThinkingEnabled?: boolean
  disabled?: boolean
}

export function CombinedModelPicker({
  provider,
  composerStyle,
  modelOptions,
  selectedModelId,
  onSelectModel,
  reasoningOptions,
  selectedReasoning,
  onSelectReasoning,
  codexReasoningEffort,
  claudeReasoningEffort,
  kimiThinkingEnabled,
  disabled
}: CombinedModelPickerProps): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [focusedColumn, setFocusedColumn] = useState<'model' | 'reasoning'>('model')
  const [modelHighlight, setModelHighlight] = useState(0)
  const [reasoningHighlight, setReasoningHighlight] = useState(0)

  const selectedModelOption =
    modelOptions.find((option) => option.id === selectedModelId) ||
    modelOptions[0] || { id: selectedModelId, label: selectedModelId }

  const chipText = useMemo(
    () =>
      formatComposerModelChip({
        provider,
        composerStyle,
        modelId: selectedModelOption.id,
        modelLabel: selectedModelOption.label,
        codexReasoningEffort,
        claudeReasoningEffort,
        kimiThinkingEnabled
      }),
    [
      provider,
      composerStyle,
      selectedModelOption.id,
      selectedModelOption.label,
      codexReasoningEffort,
      claudeReasoningEffort,
      kimiThinkingEnabled
    ]
  )

  const reasoningSuffix = useMemo(
    () =>
      reasoningDisplayLabel({
        provider,
        composerStyle,
        modelId: selectedModelOption.id,
        modelLabel: selectedModelOption.label,
        codexReasoningEffort,
        claudeReasoningEffort,
        kimiThinkingEnabled
      }),
    [
      provider,
      composerStyle,
      selectedModelOption.id,
      selectedModelOption.label,
      codexReasoningEffort,
      claudeReasoningEffort,
      kimiThinkingEnabled
    ]
  )

  // Split chip text into "model" and "reasoning" pieces so we can
  // style them differently (model normal, reasoning muted/dimmed —
  // mirrors real Codex's `5.5 Extra High` rendering where "Extra
  // High" reads softer than "5.5").
  const chipPieces = useMemo(() => {
    if (!reasoningSuffix) return { primary: chipText, suffix: '' }
    if (chipText.endsWith(reasoningSuffix)) {
      const primary = chipText.slice(0, chipText.length - reasoningSuffix.length).trimEnd()
      // Trim trailing separator (`·` or space) so the suffix renders
      // as its own visual unit with its own styling.
      const cleaned = primary.replace(/[\s·]+$/, '')
      return { primary: cleaned, suffix: reasoningSuffix }
    }
    return { primary: chipText, suffix: '' }
  }, [chipText, reasoningSuffix])

  // Position the popover above-right of the chip when opened.
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      if (!open) {
        setPosition(null)
        return
      }
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const popoverWidth = reasoningOptions.length > 0 ? 360 : 200
      const left = Math.max(8, rect.right - popoverWidth)
      // Anchor ABOVE the chip with a small gap.
      const top = rect.top - 8
      setPosition({ left, top })
    })
    return () => {
      cancelled = true
    }
  }, [open, reasoningOptions.length])

  // Reset highlights when the popover opens.
  useEffect(() => {
    if (!open) return
    const modelIdx = Math.max(
      0,
      modelOptions.findIndex((option) => option.id === selectedModelId)
    )
    const reasoningIdx = Math.max(
      0,
      reasoningOptions.findIndex((option) => option.value === selectedReasoning)
    )
    setModelHighlight(modelIdx)
    setReasoningHighlight(reasoningIdx)
    setFocusedColumn('model')
  }, [open, modelOptions, selectedModelId, reasoningOptions, selectedReasoning])

  // Click-outside + Escape dismiss.
  useEffect(() => {
    if (!open) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (popoverRef.current?.contains(target)) return
      if (triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', handleClick, true)
    document.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('mousedown', handleClick, true)
      document.removeEventListener('keydown', handleKey, true)
    }
  }, [open])

  // Arrow navigation when popover is open.
  useEffect(() => {
    if (!open) return
    const handleArrowKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (focusedColumn === 'model') {
          setModelHighlight((idx) => Math.min(modelOptions.length - 1, idx + 1))
        } else {
          setReasoningHighlight((idx) => Math.min(reasoningOptions.length - 1, idx + 1))
        }
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (focusedColumn === 'model') {
          setModelHighlight((idx) => Math.max(0, idx - 1))
        } else {
          setReasoningHighlight((idx) => Math.max(0, idx - 1))
        }
      } else if (event.key === 'ArrowRight' && reasoningOptions.length > 0) {
        event.preventDefault()
        setFocusedColumn('reasoning')
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setFocusedColumn('model')
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (focusedColumn === 'model') {
          const option = modelOptions[modelHighlight]
          if (option) onSelectModel(option.id)
        } else {
          const option = reasoningOptions[reasoningHighlight]
          if (option) onSelectReasoning(option.value)
        }
      }
    }
    document.addEventListener('keydown', handleArrowKey, true)
    return () => {
      document.removeEventListener('keydown', handleArrowKey, true)
    }
  }, [
    open,
    focusedColumn,
    modelOptions,
    reasoningOptions,
    modelHighlight,
    reasoningHighlight,
    onSelectModel,
    onSelectReasoning
  ])

  const popoverContent = open && position && (
    <div
      ref={popoverRef}
      className={`composer-combined-picker-popover provider-${provider} shell-${composerStyle}`}
      style={{
        position: 'fixed',
        left: `${position.left}px`,
        top: `${position.top}px`,
        transform: 'translateY(-100%)'
      }}
      role="dialog"
      aria-label="Choose model and reasoning level"
    >
      <div
        className={`composer-combined-picker-column composer-combined-picker-models ${focusedColumn === 'model' ? 'is-focused' : ''}`}
      >
        <div className="composer-combined-picker-column-header">Model</div>
        {modelOptions.map((option, idx) => (
          <button
            key={option.id}
            type="button"
            className={`composer-combined-picker-row ${option.id === selectedModelId ? 'is-selected' : ''} ${idx === modelHighlight && focusedColumn === 'model' ? 'is-highlighted' : ''}`}
            onMouseEnter={() => {
              setFocusedColumn('model')
              setModelHighlight(idx)
            }}
            onClick={() => {
              onSelectModel(option.id)
              // Keep the popover open so the user can also tweak
              // reasoning without re-clicking the chip. Real Codex
              // behaves the same way.
            }}
          >
            <span className="composer-combined-picker-row-label">{option.label}</span>
            {option.id === selectedModelId && (
              <span className="composer-combined-picker-check" aria-hidden>
                ✓
              </span>
            )}
          </button>
        ))}
      </div>
      {reasoningOptions.length > 0 && (
        <div
          className={`composer-combined-picker-column composer-combined-picker-reasoning ${focusedColumn === 'reasoning' ? 'is-focused' : ''}`}
        >
          <div className="composer-combined-picker-column-header">Reasoning</div>
          {reasoningOptions.map((option, idx) => (
            <button
              key={option.value}
              type="button"
              className={`composer-combined-picker-row ${option.value === selectedReasoning ? 'is-selected' : ''} ${idx === reasoningHighlight && focusedColumn === 'reasoning' ? 'is-highlighted' : ''}`}
              onMouseEnter={() => {
                setFocusedColumn('reasoning')
                setReasoningHighlight(idx)
              }}
              onClick={() => {
                onSelectReasoning(option.value)
              }}
            >
              <span className="composer-combined-picker-row-label">{option.label}</span>
              {option.value === selectedReasoning && (
                <span className="composer-combined-picker-check" aria-hidden>
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="composer-combined-picker-trigger"
        data-composer-control="model"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Model and reasoning"
      >
        <span className="composer-combined-picker-trigger-primary">{chipPieces.primary}</span>
        {chipPieces.suffix && (
          <span className="composer-combined-picker-trigger-suffix">{chipPieces.suffix}</span>
        )}
      </button>
      {popoverContent ? createPortal(popoverContent, document.body) : null}
    </>
  )
}
