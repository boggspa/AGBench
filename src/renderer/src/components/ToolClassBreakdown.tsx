import {
  groupToolsByClass,
  TOOL_CLASS_LABELS,
  TOOL_CLASS_ORDER,
  type ToolClass
} from '../../../main/ToolClassTaxonomy'
import { READ_ONLY_TOOL_PRESET } from '../../../main/PermissionEnvelope'

// Read-only is the one preset with a concrete allow-list (READ_ONLY_TOOL_PRESET);
// other presets are policy-derived, so only these concrete tools are broken down.
const READ_ONLY_BREAKDOWN = groupToolsByClass([...READ_ONLY_TOOL_PRESET])

/**
 * Compact tool-class breakdown for the read-only / plan posture (panel
 * feedback): which of the four classes a read-only participant may use — reads
 * / orchestration / user-prompts are allowed (full tool list on hover) and
 * workspace writes are blocked. Surfaced in the Inspector's per-participant
 * permission view, where read_only is the active posture.
 */
export function ReadOnlyToolClassBreakdown(): React.JSX.Element {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'right' }}>
      {TOOL_CLASS_ORDER.map((cls: ToolClass) => {
        const tools = READ_ONLY_BREAKDOWN[cls]
        const blocked = cls === 'workspace_write' || tools.length === 0
        return (
          <span
            key={cls}
            title={blocked ? 'Blocked under read-only' : tools.join(', ')}
            style={{
              color: blocked ? 'var(--text-tertiary)' : 'var(--text-secondary)',
              whiteSpace: 'nowrap'
            }}
          >
            {blocked ? '✗' : '✓'} {TOOL_CLASS_LABELS[cls]}
            {!blocked && ` (${tools.length})`}
          </span>
        )
      })}
    </span>
  )
}
