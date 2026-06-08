import type { ProviderId } from '../../../main/store/types'

/**
 * 1.0.5-EW50 — Shared model-id → human-readable display name
 * resolver. Pre-EW50 only `welcomeUsageDashboard.ts` had a
 * humaniser, and it only mapped Kimi ids — every other provider
 * fell through to the raw CLI/API id (`gemini-3-flash-preview`,
 * `claude-opus-4-7`, `gpt-5.5`). The Favorite Model chip on the
 * dashboard and the Model Comparisons + Settings Model Usage
 * lists all surfaced these raw ids, which read as developer-y
 * noise. EW50 extracts the resolver into this module so both
 * surfaces share one mapping table.
 *
 * Mapping table is hand-built rather than algorithmic because:
 *   - Capitalisation is not derivable from the id alone (GPT vs
 *     Gemini vs Claude vs Kimi all have different conventions).
 *   - Preview / numeric suffixes vary across providers
 *     (`-preview`, `-1m`, `-thinking`, dated `-0711-preview`).
 *   - A wrong heuristic-derived label is worse than the raw id;
 *     a missing mapping just falls back to the id and reads as
 *     "unknown but readable".
 *
 * To add a new model: append to `KNOWN_MODEL_LABELS` with the
 * exact lower-cased id key. The `humaniseModelId` lookup is
 * case-insensitive on the key side.
 */

const KNOWN_MODEL_LABELS: Record<string, string> = {
  // ── Gemini ────────────────────────────────────────────────
  // Full API/CLI ids
  'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
  'gemini-3-flash': 'Gemini 3 Flash',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
  'gemini-3.1-pro': 'Gemini 3.1 Pro',
  'gemini-3.1-flash-lite-preview': 'Gemini 3.1 Flash Lite Preview',
  'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
  // Composer-side short ids (from `GEMINI_DEFAULT_MODELS`)
  'cli-default': 'CLI Default',
  auto: 'Gemini Auto',
  pro: 'Gemini Pro',
  flash: 'Gemini Flash',
  'flash-lite': 'Gemini Flash Lite',

  // ── Codex (GPT) ───────────────────────────────────────────
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.3-codex': 'GPT-5.3 Codex',
  'gpt-5.3-codex-spark': 'GPT-5.3 Codex Spark',
  'gpt-5.2': 'GPT-5.2',

  // ── Claude ────────────────────────────────────────────────
  'claude-opus-4-7': 'Claude Opus 4.7',
  'claude-opus-4-7-1m': 'Claude Opus 4.7 (1M)',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'claude-opus-4-6': 'Claude Opus 4.6',
  // Composer-side short ids
  sonnet: 'Claude Sonnet',
  opus: 'Claude Opus',
  haiku: 'Claude Haiku',

  // ── Kimi (extends the original welcomeUsageDashboard.ts
  // mappings; includes the variants visible in the user's
  // Settings → Model usage list). The `kimi-k2-thinking`
  // (no decimal) alias maps to the same display as the
  // `k2.6` variant because Kimi treats them as equivalent for
  // user-facing labelling. ───────────────────────────────────
  'kimi-k2.6': 'Kimi K2.6',
  'kimi-k2.6-thinking': 'Kimi K2.6 Thinking',
  'kimi-k2-thinking': 'Kimi K2.6 Thinking',
  'kimi-k2.5': 'Kimi K2.5',
  'kimi-k2': 'Kimi K2',
  'kimi-latest': 'Kimi (Latest)',
  'kimi-k2-turbo-preview': 'Kimi K2 Turbo Preview',
  'kimi-k2-0711-preview': 'Kimi K2 (0711 Preview)',
  'kimi-k2-0905-preview': 'Kimi K2 (0905 Preview)',

  // ── Grok ─────────────────────────────────────────────────
  'grok-build': 'Grok Build 0.1',
  'grok-build-0.1': 'Grok Build 0.1',

  // ── Cursor ────────────────────────────────────────────────
  'composer-2.5': 'Composer 2.5',
  'composer-2.5-fast': 'Composer 2.5 Fast',

  // ── Ollama ────────────────────────────────────────────────
  'qwen3:4b-instruct': 'Qwen 3 (4B Param)',
  'gemma4:12b': 'Gemma 4 (12B Param)',
  'gemma4:12b-it-qat': 'Gemma 4 (12B Param)',
  'gemma4:12b-it-q4_k_m': 'Gemma 4 (12B Param)',
  'gemma4:12b-it-q8_0': 'Gemma 4 (12B Param)',
  'gemma4:12b-it-bf16': 'Gemma 4 (12B Param)',
  'gemma4:12b-mlx': 'Gemma 4 (12B Param)',
  'gemma4:12b-mlx-bf16': 'Gemma 4 (12B Param)',
  'gemma4:12b-mxfp8': 'Gemma 4 (12B Param)',
  'gemma4:12b-nvfp4': 'Gemma 4 (12B Param)',
  'gpt-oss': 'GPT OSS (20B Param)',
  'gpt-oss:20b': 'GPT OSS (20B Param)',
  'gpt-oss:latest': 'GPT OSS (20B Param)',
  'openai/gpt-oss-20b': 'GPT OSS (20B Param)'
}

const STALE_GEMINI_PLACEHOLDER_MODEL_IDS = new Set([
  'flash-lite',
  'gemini-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview'
])

/**
 * Normalise provider/model pairs before grouping usage rows.
 *
 * During the 1.0.6 Grok/Cursor bring-up, a few usage records were
 * persisted with the right provider but Gemini's default `flash-lite`
 * model id. Without this provider-aware repair the dashboard shows
 * black/yellow duplicate "Gemini Flash Lite" rows. Collapse those
 * placeholders to each provider's real default so historical samples
 * merge into the correct model row.
 */
export function canonicalModelIdForProvider(
  provider: ProviderId | undefined,
  modelId: string | undefined | null
): string {
  const trimmed = String(modelId || '').trim()
  if (!trimmed) return ''
  const key = trimmed.toLowerCase()
  if (provider === 'grok' && STALE_GEMINI_PLACEHOLDER_MODEL_IDS.has(key)) {
    return 'grok-build'
  }
  if (provider === 'cursor' && STALE_GEMINI_PLACEHOLDER_MODEL_IDS.has(key)) {
    return 'composer-2.5-fast'
  }
  return trimmed
}

/**
 * Resolve a model id to a human-readable display name. Falls
 * back to the input id when no mapping exists, so unfamiliar
 * models stay readable (vs. returning a placeholder like
 * "Unknown model" which would lose information).
 *
 * The `provider` argument is used for ambiguous legacy ids such as
 * `flash-lite`, which can be a real Gemini short id or stale
 * Grok/Cursor bootstrap metadata.
 */
export function humaniseModelId(
  provider: ProviderId | undefined,
  modelId: string | undefined | null
): string {
  const canonical = canonicalModelIdForProvider(provider, modelId)
  if (!canonical) return ''
  const key = canonical.trim().toLowerCase()
  return KNOWN_MODEL_LABELS[key] || canonical
}

/**
 * Read-only accessor for tests + tooling that need to enumerate
 * the known mappings (e.g. a future "show every known model"
 * preview surface). Returns a fresh shallow clone so callers
 * can't mutate the source-of-truth table.
 */
export function getKnownModelLabels(): Record<string, string> {
  return { ...KNOWN_MODEL_LABELS }
}
