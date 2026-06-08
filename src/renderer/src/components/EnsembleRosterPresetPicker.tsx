import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { EnsembleConfig } from '../../../main/store/types'
import {
  deleteEnsembleRosterPreset,
  listEnsembleRosterPresets,
  renameEnsembleRosterPreset,
  saveEnsembleRosterPreset,
  type EnsembleRosterPreset
} from '../lib/ensembleRosterPresets'

export const ENSEMBLE_ROSTER_PRESET_INLINE_LIMIT = 3

export interface EnsembleRosterPresetPickerProps {
  ensemble: EnsembleConfig | null | undefined
  disabled?: boolean
  onApplyPreset: (preset: EnsembleRosterPreset) => void
  variant?: 'welcome' | 'compact'
}

export function EnsembleRosterPresetPicker({
  ensemble,
  disabled = false,
  onApplyPreset,
  variant = 'welcome'
}: EnsembleRosterPresetPickerProps): React.JSX.Element | null {
  const [presets, setPresets] = useState<EnsembleRosterPreset[]>(() => listEnsembleRosterPresets())
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  const refreshPresets = (): void => {
    setPresets(listEnsembleRosterPresets())
  }

  useEffect(() => {
    if (!popoverOpen) return
    const handlePointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (
        popoverRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return
      }
      setPopoverOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPopoverOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [popoverOpen])

  useLayoutEffect(() => {
    if (!popoverOpen || !triggerRef.current) {
      setPopoverPosition(null)
      return
    }
    const updatePosition = (): void => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      setPopoverPosition({
        left: Math.max(12, rect.left),
        top: rect.bottom + 8
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [popoverOpen])

  const handleSaveCurrent = (): void => {
    if (!ensemble || disabled) return
    const suggested = 'Ensemble roster'
    const entered = window.prompt('Name this ensemble roster preset:', suggested)
    if (!entered) return
    saveEnsembleRosterPreset(entered, ensemble)
    refreshPresets()
  }

  const handleRename = (preset: EnsembleRosterPreset): void => {
    const entered = window.prompt('Rename preset:', preset.name)
    if (!entered || entered.trim() === preset.name) return
    renameEnsembleRosterPreset(preset.id, entered)
    refreshPresets()
  }

  const handleDelete = (preset: EnsembleRosterPreset): void => {
    const confirmed = window.confirm(`Delete preset "${preset.name}"?`)
    if (!confirmed) return
    deleteEnsembleRosterPreset(preset.id)
    refreshPresets()
  }

  const inlinePresets = presets.slice(0, ENSEMBLE_ROSTER_PRESET_INLINE_LIMIT)
  const overflowPresets = presets.slice(ENSEMBLE_ROSTER_PRESET_INLINE_LIMIT)
  const canSave = Boolean(ensemble) && !disabled

  const rootClassName =
    variant === 'compact'
      ? 'ensemble-roster-preset-picker is-compact'
      : 'ensemble-roster-preset-picker'

  return (
    <div className={rootClassName}>
      <span className="ensemble-roster-preset-picker-label">Roster presets</span>
      <div className="ensemble-roster-preset-picker-chips">
        <button
          type="button"
          className="ensemble-roster-preset-picker-chip ensemble-roster-preset-picker-chip-save"
          onClick={handleSaveCurrent}
          disabled={!canSave}
          title={
            canSave
              ? 'Save the current participant lineup, order, models, and orchestration settings'
              : 'Cannot save roster while a round is running'
          }
        >
          Save current…
        </button>
        {inlinePresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="ensemble-roster-preset-picker-chip"
            disabled={disabled}
            onClick={() => onApplyPreset(preset)}
            title={`Recall ${preset.participants.length} participants in saved order`}
          >
            <span className="ensemble-roster-preset-picker-chip-name">{preset.name}</span>
          </button>
        ))}
        {(overflowPresets.length > 0 || presets.length > 0) && (
          <button
            ref={triggerRef}
            type="button"
            className={`ensemble-roster-preset-picker-chip ensemble-roster-preset-picker-browse${popoverOpen ? ' is-open' : ''}`}
            onClick={() => setPopoverOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={popoverOpen}
          >
            More…
          </button>
        )}
      </div>
      {popoverOpen &&
        popoverPosition &&
        createPortal(
          <div
            ref={popoverRef}
            className="ensemble-roster-preset-popover"
            role="menu"
            style={{ left: popoverPosition.left, top: popoverPosition.top }}
          >
            <div className="ensemble-roster-preset-popover-section">
              <div className="ensemble-roster-preset-popover-header">Saved rosters</div>
              {presets.length === 0 ? (
                <div className="ensemble-roster-preset-popover-empty">
                  No saved rosters yet. Use “Save current…” to store this lineup.
                </div>
              ) : (
                presets.map((preset) => (
                  <div key={preset.id} className="ensemble-roster-preset-popover-row">
                    <button
                      type="button"
                      className="ensemble-roster-preset-popover-row-main-action"
                      disabled={disabled}
                      onClick={() => {
                        onApplyPreset(preset)
                        setPopoverOpen(false)
                      }}
                    >
                      <span className="ensemble-roster-preset-popover-row-name">{preset.name}</span>
                      <span className="ensemble-roster-preset-popover-row-meta">
                        {preset.participants.length}{' '}
                        {preset.participants.length === 1 ? 'participant' : 'participants'} ·{' '}
                        {preset.orchestrationMode === 'continuous' ? 'Continuous' : 'Turn'}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="ensemble-roster-preset-popover-row-action"
                      onClick={() => handleRename(preset)}
                      title="Rename preset"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="ensemble-roster-preset-popover-row-action is-danger"
                      onClick={() => handleDelete(preset)}
                      title="Delete preset"
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
