/*
 * ensembleProviderDefaults — per-provider model + reasoning + fast-tier
 * options for the ensemble participant chip flyouts. Mirrors the
 * defaults baked into App.tsx (CODEX_DEFAULT_MODELS,
 * CLAUDE_DEFAULT_MODELS, GEMINI_DEFAULT_MODELS, KIMI_DEFAULT_MODELS)
 * but stays in a small standalone module so the consumer doesn't
 * need to import from App.tsx (which would invert the dependency
 * direction).
 *
 * Originally landed in Slice D (1.0.3) for the EnsembleSetupSheet
 * modal's per-row pickers; carried forward in Slice F (1.0.3) when
 * that modal retired and the per-participant pickers moved into
 * EnsembleParticipantsAboveRow chip flyouts.
 *
 * Note: the renderer's authoritative model list lives in App.tsx's
 * `agentModelsByProvider` state (which can be hydrated from server-side
 * configuration). The setup sheet uses these defaults only — if a user
 * has a custom model that isn't in this list, the chip will still
 * render its label (CombinedModelPicker falls back to the modelId). The
 * orchestrator dispatch passes the raw `participant.model` string to
 * the provider adapter unchanged, so custom IDs still work.
 */

import type {
  CombinedModelPickerModelOption,
  CombinedModelPickerReasoningOption
} from '../components/CombinedModelPicker'
import type {
  EnsembleParticipant,
  PermissionPresetId,
  ProviderId
} from '../../../main/store/types'

export interface EnsembleModelDefaults {
  modelOptions: CombinedModelPickerModelOption[]
  reasoningOptions: CombinedModelPickerReasoningOption[]
  /**
   * Default reasoning value when no participant.reasoningEffort is set.
   * For Kimi this is the value that maps to thinkingEnabled=true.
   */
  defaultReasoning: string
  /**
   * Model IDs that support the paid Fast tier (lightning bolt + toggle).
   * Empty set means the toggle row stays hidden.
   */
  fastModeCapableModelIds: Set<string>
  /** Default model id when participant.model is unset. */
  defaultModelId: string
}

const CODEX_REASONING: CombinedModelPickerReasoningOption[] = [
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' }
]

const CLAUDE_REASONING: CombinedModelPickerReasoningOption[] = [
  { value: 'off', label: 'Thinking off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'Max' }
]

const KIMI_REASONING: CombinedModelPickerReasoningOption[] = [
  { value: 'on', label: 'Thinking on' },
  { value: 'off', label: 'Thinking off' }
]

// Grok mirrors Claude Code's effort grammar (low|medium|high|xhigh|max);
// GrokCliArgs.normalizeGrokEffortFlag is the dispatch-side guard.
const GROK_REASONING: CombinedModelPickerReasoningOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'max', label: 'Max' }
]

const CODEX_MODELS: CombinedModelPickerModelOption[] = [
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
  { id: 'gpt-5.2', label: 'GPT-5.2' }
]

const CLAUDE_MODELS: CombinedModelPickerModelOption[] = [
  { id: 'default', label: 'Default' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { id: 'claude-opus-4-7-1m', label: 'Claude Opus 4.7 1M' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6 Legacy' }
]

const GEMINI_MODELS: CombinedModelPickerModelOption[] = [
  { id: 'cli-default', label: 'CLI Default' },
  { id: 'auto', label: 'Auto' },
  { id: 'pro', label: 'Pro' },
  { id: 'flash', label: 'Flash' },
  { id: 'flash-lite', label: 'Flash Lite' }
]

const KIMI_MODELS: CombinedModelPickerModelOption[] = [
  { id: 'kimi-k2.6', label: 'Kimi K2.6' }
]

// Grok — mirrors App.tsx GROK_DEFAULT_MODELS. `grok-build` is the real CLI id =
// Grok Build 0.1 (NOT "Grok 4.3", which the subscription CLI doesn't expose).
const GROK_MODELS: CombinedModelPickerModelOption[] = [
  { id: 'grok-build', label: 'Grok Build 0.1' }
]

const CODEX_FAST_CAPABLE = new Set<string>(['gpt-5.5', 'gpt-5.4'])
const CLAUDE_FAST_CAPABLE = new Set<string>(['claude-opus-4-7', 'claude-opus-4-6'])

/**
 * Canonical seed config for a new ensemble participant. Mirrors the
 * fallback values that used to be scattered across:
 *   - `src/main/EnsembleDefaults.ts` (initial `model` + `permissionPresetId`)
 *   - `App.tsx` composer pickers (`reasoningEffort || 'medium'`, etc.)
 *   - `EnsembleOrchestrator.ts` dispatch (`participant.model || 'cli-default'`)
 *
 * Used both for seeding (when adding a participant) and for resolving
 * the effective per-participant settings the composer pickers display.
 *
 * Field shape matches the `EnsembleParticipant` interface in
 * `src/main/store/types.ts` (around line 206). `reasoningEffort`,
 * `fastModeEnabled`, `thinkingEnabled`, and `serviceTier` are optional
 * on the participant record itself — this helper resolves them to
 * concrete defaults so call-sites don't need to repeat the fallback
 * logic.
 *
 * Note: `model` defaults to `'cli-default'` rather than the per-provider
 * preferred id (e.g. `'gpt-5.5'`) to match the existing seeding behaviour
 * in `EnsembleDefaults.ts`. The orchestrator + provider adapters resolve
 * `'cli-default'` to the provider's CLI-default model at dispatch time.
 * `getEnsembleModelDefaults(provider).defaultModelId` exposes the
 * preferred display id for the model picker; the participant record
 * keeps the agnostic `'cli-default'` until the user picks something.
 */
export interface DefaultEnsembleParticipantConfig {
  model: string
  permissionPresetId: PermissionPresetId
  reasoningEffort?: string
  fastModeEnabled?: boolean
  thinkingEnabled?: boolean
  serviceTier?: string
}

export function getDefaultEnsembleParticipantConfig(
  provider: ProviderId
): DefaultEnsembleParticipantConfig {
  switch (provider) {
    case 'codex':
      return {
        model: 'cli-default',
        permissionPresetId: 'workspace_write',
        reasoningEffort: 'medium',
        fastModeEnabled: false,
        serviceTier: ''
      }
    case 'claude':
      return {
        model: 'cli-default',
        permissionPresetId: 'read_only',
        reasoningEffort: 'medium',
        fastModeEnabled: false
      }
    case 'gemini':
      return {
        model: 'cli-default',
        permissionPresetId: 'read_only'
      }
    case 'kimi':
      return {
        model: 'cli-default',
        permissionPresetId: 'read_only',
        thinkingEnabled: false
      }
    case 'grok':
      // Grok stays read-only as an ensemble member until G5 (tool mediation
      // via AGBench MCP + approval ledger) lands write-capable runs. 'cli-default'
      // resolves to grok-build at dispatch (buildGrokCliArgs only forwards a
      // genuine grok* id, so cli-default → Grok's own default).
      return {
        model: 'cli-default',
        permissionPresetId: 'read_only',
        reasoningEffort: 'medium'
      }
    default:
      return {
        model: 'cli-default',
        permissionPresetId: 'default'
      }
  }
}

/**
 * Resolve a participant's effective settings by layering its stored
 * fields on top of `getDefaultEnsembleParticipantConfig`. The returned
 * object always has concrete (non-undefined) values for the
 * provider-relevant fields so consumers can read directly without
 * repeating fallback chains.
 *
 * - `reasoningEffort`: empty string for providers without a reasoning
 *   axis (Gemini); otherwise the participant's value or the canonical
 *   provider default.
 * - `serviceTier`: empty string when not the paid Fast tier. Codex
 *   participants infer `'fast'` from `fastModeEnabled` if `serviceTier`
 *   itself is unset, matching the existing renderer fallback in
 *   `App.tsx` and the orchestrator dispatch.
 */
export interface ResolvedEnsembleParticipantSettings {
  provider: ProviderId
  model: string
  permissionPresetId: PermissionPresetId
  reasoningEffort: string
  fastModeEnabled: boolean
  thinkingEnabled: boolean
  serviceTier: string
}

export function resolveEnsembleParticipantSettings(
  participant: Pick<
    EnsembleParticipant,
    | 'provider'
    | 'model'
    | 'permissionPresetId'
    | 'reasoningEffort'
    | 'fastModeEnabled'
    | 'thinkingEnabled'
    | 'serviceTier'
  >
): ResolvedEnsembleParticipantSettings {
  const defaults = getDefaultEnsembleParticipantConfig(participant.provider)
  const model = participant.model || defaults.model
  const permissionPresetId = participant.permissionPresetId || defaults.permissionPresetId
  const reasoningEffort = participant.reasoningEffort || defaults.reasoningEffort || ''
  const fastModeEnabled = Boolean(participant.fastModeEnabled ?? defaults.fastModeEnabled)
  const thinkingEnabled = Boolean(participant.thinkingEnabled ?? defaults.thinkingEnabled)
  // Codex serviceTier: respect explicit value, else infer 'fast' from
  // fastModeEnabled (mirrors the existing renderer + dispatch fallback).
  const serviceTier =
    participant.serviceTier ?? (fastModeEnabled ? 'fast' : defaults.serviceTier ?? '')
  return {
    provider: participant.provider,
    model,
    permissionPresetId,
    reasoningEffort,
    fastModeEnabled,
    thinkingEnabled,
    serviceTier
  }
}

export function getEnsembleModelDefaults(provider: ProviderId): EnsembleModelDefaults {
  switch (provider) {
    case 'codex':
      return {
        modelOptions: CODEX_MODELS,
        reasoningOptions: CODEX_REASONING,
        defaultReasoning: 'medium',
        fastModeCapableModelIds: CODEX_FAST_CAPABLE,
        defaultModelId: 'gpt-5.5'
      }
    case 'claude':
      return {
        modelOptions: CLAUDE_MODELS,
        reasoningOptions: CLAUDE_REASONING,
        defaultReasoning: 'medium',
        fastModeCapableModelIds: CLAUDE_FAST_CAPABLE,
        defaultModelId: 'default'
      }
    case 'gemini':
      return {
        modelOptions: GEMINI_MODELS,
        reasoningOptions: [],
        defaultReasoning: '',
        fastModeCapableModelIds: new Set<string>(),
        defaultModelId: 'cli-default'
      }
    case 'kimi':
      return {
        modelOptions: KIMI_MODELS,
        reasoningOptions: KIMI_REASONING,
        defaultReasoning: 'off',
        fastModeCapableModelIds: new Set<string>(),
        defaultModelId: 'kimi-k2.6'
      }
    case 'grok':
      return {
        modelOptions: GROK_MODELS,
        reasoningOptions: GROK_REASONING,
        defaultReasoning: 'medium',
        fastModeCapableModelIds: new Set<string>(),
        defaultModelId: 'grok-build'
      }
    default:
      return {
        modelOptions: [],
        reasoningOptions: [],
        defaultReasoning: '',
        fastModeCapableModelIds: new Set<string>(),
        defaultModelId: 'cli-default'
      }
  }
}
