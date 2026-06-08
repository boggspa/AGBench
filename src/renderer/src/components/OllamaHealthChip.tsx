import type { ReactElement } from 'react'
import type { OllamaModelInfo, OllamaStatusSnapshot } from '../../../main/ollama/OllamaProvider'
import type { OllamaToolControlTier } from '../../../main/store/types'

function tierShortLabel(tier: OllamaToolControlTier | undefined): string {
  if (tier === 'approved_edits') return 'edits'
  if (tier === 'approved_shell') return 'shell'
  if (tier === 'provider_parity') return 'parity'
  return 'read-only'
}

function resolveSelectedModel(
  status: OllamaStatusSnapshot | null | undefined,
  modelId?: string | null
): OllamaModelInfo | null {
  const models = status?.models
  if (!Array.isArray(models) || models.length === 0) return null
  const target = String(modelId || status?.defaultModel || '').trim()
  if (!target) return models[0] || null
  return models.find((model) => model.id === target) || models[0] || null
}

export interface OllamaHealthChipProps {
  status?: OllamaStatusSnapshot | null
  selectedModelId?: string | null
  toolControlTier?: OllamaToolControlTier
}

/** Compact composer chip summarising local Ollama readiness. */
export function OllamaHealthChip({
  status,
  selectedModelId,
  toolControlTier = 'read_only'
}: OllamaHealthChipProps): ReactElement | null {
  if (!status) return null

  if (!status.available) {
    return (
      <span className="composer-chip warning" title={status.error || 'Ollama runtime unreachable'}>
        Ollama offline
      </span>
    )
  }

  if (status.setupRequired || !status.modelCount) {
    return (
      <span
        className="composer-chip warning"
        title="Ollama is up but no models are installed. Pull a model with `ollama pull`."
      >
        Ollama: pull a model
      </span>
    )
  }

  const model = resolveSelectedModel(status, selectedModelId)
  const modelLabel = model?.label || model?.id || 'local model'
  const ctx =
    typeof model?.contextLength === 'number' && model.contextLength > 0
      ? `${Math.round(model.contextLength / 1000)}k ctx`
      : null
  const title = [
    'Ollama runtime is reachable.',
    model ? `Selected: ${model.id}` : null,
    ctx ? `Context window: ${model?.contextLength?.toLocaleString()} tokens (from /api/tags).` : null,
    `Tool tier: ${tierShortLabel(toolControlTier)}.`
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span className="composer-chip" title={title}>
      Ollama ready · {modelLabel} · {tierShortLabel(toolControlTier)}
      {ctx ? ` · ${ctx}` : ''}
    </span>
  )
}
