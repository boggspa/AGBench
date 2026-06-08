import type { OllamaModelInfo } from './OllamaProvider'
import type { ProviderCapabilityWarning } from '../store/types'

export type OllamaModelFamily =
  | 'qwen3_4b'
  | 'qwen3_5_9b'
  | 'gemma4_12b'
  | 'gpt_oss_20b'
  | 'unknown'

export interface OllamaModelPreflightInput {
  modelId: string
  modelLabel: string
  /** Resolved model metadata from /api/tags when the requested id is installed. */
  modelInfo?: OllamaModelInfo | null
  installedModelIds: string[]
  totalMemoryBytes: number
}

export interface OllamaModelPreflightCheck {
  id: string
  ok: boolean
  detail: string
}

export interface OllamaModelPreflightResult {
  family: OllamaModelFamily
  checks: OllamaModelPreflightCheck[]
  guidance: string
  delegateHint?: string
  warnings: ProviderCapabilityWarning[]
}

function warning(
  id: string,
  severity: ProviderCapabilityWarning['severity'],
  title: string,
  message: string
): ProviderCapabilityWarning {
  return { id, severity, title, message }
}

/** Normalize a pulled Ollama tag to a stable family key. */
export function resolveOllamaModelFamily(modelId: string): OllamaModelFamily {
  const key = modelId.trim().toLowerCase()
  if (key === 'qwen3:4b-instruct' || key.startsWith('qwen3:4b')) return 'qwen3_4b'
  if (key === 'qwen3.5:9b' || key.startsWith('qwen3.5:9b')) return 'qwen3_5_9b'
  if (key === 'gemma4:12b' || key.startsWith('gemma4:12b')) return 'gemma4_12b'
  if (
    key === 'gpt-oss' ||
    key === 'gpt-oss:20b' ||
    key === 'gpt-oss:latest' ||
    key.startsWith('gpt-oss') ||
    key === 'openai/gpt-oss-20b'
  ) {
    return 'gpt_oss_20b'
  }
  return 'unknown'
}

export function parseOllamaParameterBillions(parameterSize?: string | null): number | null {
  const raw = String(parameterSize || '').trim()
  if (!raw) return null
  const match = raw.match(/([\d.]+)\s*B/i)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

/** Rough resident-RAM estimate for a loaded quantised weights file (GB). */
export function estimateOllamaModelRamGb(input: {
  parameterBillions?: number | null
  quantizationLevel?: string | null
}): number | null {
  const params = input.parameterBillions
  if (params == null) return null
  const quant = String(input.quantizationLevel || '').toUpperCase()
  const bytesPerParam = quant.includes('Q8') ? 1.0 : quant.includes('Q6') ? 0.75 : 0.62
  // Add ~25% headroom for runtime/KV overhead on first load.
  return Math.round(params * bytesPerParam * 1.25 * 10) / 10
}

export function formatMemoryGb(bytes: number): string {
  const gb = bytes / 1024 ** 3
  return gb >= 10 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`
}

function modelInstalled(modelId: string, installedModelIds: string[]): boolean {
  const target = modelId.trim().toLowerCase()
  return installedModelIds.some((id) => id.trim().toLowerCase() === target)
}

function modelSupportsNativeTools(modelInfo?: OllamaModelInfo | null): boolean | null {
  if (!modelInfo?.capabilities?.length) return null
  return modelInfo.capabilities.some((cap) => cap.toLowerCase() === 'tools')
}

function familyGuidance(family: OllamaModelFamily, modelLabel: string): {
  guidance: string
  delegateHint?: string
} {
  switch (family) {
    case 'qwen3_5_9b':
      return {
        guidance: `${modelLabel} is a capable local scout for scoped tasks — search, read files, and single-file edits with approval.`,
        delegateHint:
          'For multi-file refactors, broad test-suite fixes, or long autonomous loops, delegate implementation to Codex or Claude.'
      }
    case 'qwen3_4b':
      return {
        guidance: `${modelLabel} is best for quick lookups, narrow reads, and short answers.`,
        delegateHint:
          'For edits, shell work, or multi-step refactors, use a larger local model or delegate to a cloud provider.'
      }
    case 'gemma4_12b':
      return {
        guidance: `${modelLabel} handles moderate local tasks well — exploration, planning, and smaller edits.`,
        delegateHint:
          'For large refactors or repo-wide test fixes, consider Codex or Claude for implementation.'
      }
    case 'gpt_oss_20b':
      return {
        guidance: `${modelLabel} has stronger reasoning but can be finicky with tool calls; TaskWraith will nudge it when it stalls.`,
        delegateHint:
          'For heavy multi-file implementation, a cloud sub-thread (Codex/Claude) is often faster and more reliable.'
      }
    default:
      return {
        guidance: `${modelLabel} is a local model — great for privacy and quick workspace reads, but smaller than frontier cloud agents.`,
        delegateHint:
          'For ambitious refactors or long tool chains, delegate the implementation pass to Codex or Claude.'
      }
  }
}

/** Honest per-model capability preflight for the first Ollama run of each tag. */
export function evaluateOllamaModelPreflight(
  input: OllamaModelPreflightInput
): OllamaModelPreflightResult {
  const family = resolveOllamaModelFamily(input.modelId)
  const { guidance, delegateHint } = familyGuidance(family, input.modelLabel)
  const checks: OllamaModelPreflightCheck[] = []
  const warnings: ProviderCapabilityWarning[] = []

  const installed = modelInstalled(input.modelId, input.installedModelIds)
  checks.push({
    id: 'installed',
    ok: installed,
    detail: installed
      ? 'Model tag is present in the local Ollama library.'
      : 'Model tag was not found in /api/tags — run `ollama pull` before expecting reliable runs.'
  })
  if (!installed) {
    warnings.push(
      warning(
        'ollama-model-missing',
        'error',
        'Model not installed',
        `Pull ${input.modelId} with \`ollama pull ${input.modelId}\`, then refresh models.`
      )
    )
  }

  const paramB =
    parseOllamaParameterBillions(input.modelInfo?.parameterSize) ??
    (family === 'qwen3_4b'
      ? 4
      : family === 'qwen3_5_9b'
        ? 9
        : family === 'gemma4_12b'
          ? 12
          : family === 'gpt_oss_20b'
            ? 20
            : null)
  const estimatedRamGb = estimateOllamaModelRamGb({
    parameterBillions: paramB,
    quantizationLevel: input.modelInfo?.quantizationLevel
  })
  const usableRamBytes = Math.floor(input.totalMemoryBytes * 0.55)
  const ramOk =
    estimatedRamGb == null ? true : estimatedRamGb <= usableRamBytes / 1024 ** 3 + 0.5
  checks.push({
    id: 'ram',
    ok: ramOk,
    detail:
      estimatedRamGb == null
        ? 'RAM headroom could not be estimated from model metadata.'
        : ramOk
          ? `Estimated load ~${estimatedRamGb} GB fits within ~${formatMemoryGb(usableRamBytes)} usable RAM.`
          : `Estimated load ~${estimatedRamGb} GB may exceed ~${formatMemoryGb(usableRamBytes)} usable RAM on this Mac — expect swapping or failed loads.`
  })
  if (!ramOk && estimatedRamGb != null) {
    warnings.push(
      warning(
        'ollama-ram-tight',
        'warning',
        'RAM may be tight',
        `This model may need ~${estimatedRamGb} GB resident while loaded. Close other heavy apps or pick a smaller quant/model.`
      )
    )
  }

  const nativeTools = modelSupportsNativeTools(input.modelInfo)
  checks.push({
    id: 'tools',
    ok: nativeTools !== false,
    detail:
      nativeTools === true
        ? 'Ollama reports native tool-calling support for this tag.'
        : nativeTools === false
          ? 'Ollama did not advertise tool-calling — TaskWraith will use the JSON-in-prose fallback (less reliable).'
          : 'Tool-calling support unknown — TaskWraith will try native tools first, then the JSON fallback.'
  })
  if (nativeTools === false) {
    warnings.push(
      warning(
        'ollama-tools-unadvertised',
        'warning',
        'Tool calling unverified',
        'This tag did not advertise `tools` in Ollama metadata. Expect occasional tool-intent stubs; TaskWraith will nudge and retry.'
      )
    )
  }

  const headline = delegateHint ? `${guidance} ${delegateHint}` : guidance
  warnings.unshift(
    warning('ollama-model-guidance', 'info', `${input.modelLabel} — local expectations`, headline)
  )

  return {
    family,
    checks,
    guidance: headline,
    delegateHint,
    warnings
  }
}

export function shouldRunOllamaModelPreflight(
  completedAtByModel: Record<string, number> | undefined,
  modelId: string
): boolean {
  const key = modelId.trim()
  if (!key) return false
  return !completedAtByModel?.[key]
}
