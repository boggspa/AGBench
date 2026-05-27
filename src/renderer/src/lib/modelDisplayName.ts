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
  'kimi-k2-0905-preview': 'Kimi K2 (0905 Preview)'
}

/**
 * Resolve a model id to a human-readable display name. Falls
 * back to the input id when no mapping exists, so unfamiliar
 * models stay readable (vs. returning a placeholder like
 * "Unknown model" which would lose information).
 *
 * The `provider` argument is currently unused but kept in the
 * signature for future ambiguous-id disambiguation (e.g. if a
 * generic id like `default` appears, the provider tells us
 * which "Default" to show). For now it's documentation-only;
 * mappings key on the full id so collisions across providers
 * don't happen in the known set.
 */
export function humaniseModelId(
  _provider: ProviderId | undefined,
  modelId: string | undefined | null
): string {
  if (!modelId) return ''
  const key = modelId.trim().toLowerCase()
  return KNOWN_MODEL_LABELS[key] || modelId
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
