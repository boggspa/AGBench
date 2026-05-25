/*
 * ensembleProviderDefaults — per-provider model + reasoning + fast-tier
 * options for the EnsembleSetupSheet picker rows. Mirrors the defaults
 * baked into App.tsx (CODEX_DEFAULT_MODELS, CLAUDE_DEFAULT_MODELS,
 * GEMINI_DEFAULT_MODELS, KIMI_DEFAULT_MODELS) but stays in a small
 * standalone module so the setup sheet doesn't need to import from
 * App.tsx (which would invert the dependency direction).
 *
 * Slice D (1.0.3) — replaces the EnsembleSetupSheet's free-text model
 * input with a CombinedModelPicker-driven chip.
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
import type { ProviderId } from '../../../main/store/types'

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

const CODEX_MODELS: CombinedModelPickerModelOption[] = [
  { id: 'gpt-5.5', label: 'GPT-5.5' },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' }
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

const CODEX_FAST_CAPABLE = new Set<string>(['gpt-5.5', 'gpt-5.4'])
const CLAUDE_FAST_CAPABLE = new Set<string>(['claude-opus-4-7', 'claude-opus-4-6'])

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
