/*
 * composerChipFormat.ts — per-shell text formatter for the combined
 * model + reasoning chip in the composer.
 *
 * Real Codex shows `5.5 Extra High` (model digit + capitalised
 * reasoning level). Real Claude shows `Opus 4.7 · Max` (model name +
 * effort capped at "Max"). Real Kimi shows `K2.6` or `K2.6 Thinking`.
 * Each upstream product has its own convention; this module captures
 * those rules in pure functions so the rendering surface stays dumb.
 *
 * No React, no IPC. Pure data transforms — easy to test.
 */

import type { ProviderId, ComposerStyle } from '../../../main/store/types'

export interface ComposerChipContext {
  provider: ProviderId
  composerStyle: ComposerStyle
  /** Model id (e.g. "gpt-5.5", "claude-opus-4-7-thinking"). */
  modelId: string
  /** Human-readable model label as it appears in the existing model picker. */
  modelLabel: string
  /** Codex reasoning effort token (e.g. "low" | "medium" | "high" | "xhigh"). */
  codexReasoningEffort?: string
  /** Claude reasoning effort token (e.g. "off" | "low" | "medium" | "high"). */
  claudeReasoningEffort?: string
  /** Kimi thinking toggle (boolean). */
  kimiThinkingEnabled?: boolean
}

/**
 * Extract a short, idiomatic model name per provider convention.
 *
 * Codex (`gpt-5.5`, `gpt-5.4-mini`)        → `5.5`, `5.4-Mini`
 * Claude (`claude-opus-4-7-thinking`)      → `Opus 4.7`
 * Kimi (`kimi-k2.6`, `kimi-k2.6-thinking`) → `K2.6`
 * Gemini (`gemini-2.5-pro`)                → `2.5 Pro`
 *
 * Falls back to the full label when no provider-specific pattern matches.
 */
export function shortModelName(provider: ProviderId, modelLabel: string, modelId: string): string {
  const id = (modelId || '').toLowerCase()
  const label = modelLabel || modelId

  // 1.0.4 — `cli-default` is the sentinel model id stored on a freshly
  // created ensemble participant (see `ensembleProviderDefaults.ts`)
  // when the user hasn't actively picked a model yet. Without this
  // branch the per-message badge displayed the raw token literally —
  // e.g. "Codex / Brodex · cli-default" — which read as a model name
  // and made users wonder whether their picker change actually took.
  // The picker's own label for this id is `'CLI Default'`
  // (App.tsx:3540), so mirror that here for visual consistency.
  if (id === 'cli-default') return 'CLI Default'

  if (provider === 'codex') {
    // gpt-5.5 → 5.5; gpt-5.4-mini → 5.4-Mini; gpt-5.3-codex-spark → 5.3-Codex-Spark
    const match = id.match(/^gpt-([\d.]+)(.*)$/)
    if (match) {
      const version = match[1]
      const suffix = match[2]
        .replace(/^-/, '')
        .split('-')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('-')
      return suffix ? `${version}-${suffix}` : version
    }
  }

  if (provider === 'claude') {
    // claude-opus-4-7, claude-sonnet-4-6-thinking → Opus 4.7 / Sonnet 4.6
    const match = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/)
    if (match) {
      const family = match[1].charAt(0).toUpperCase() + match[1].slice(1)
      return `${family} ${match[2]}.${match[3]}`
    }
  }

  if (provider === 'kimi') {
    // kimi-k2.6, kimi-k2.6-thinking → K2.6
    const match = id.match(/^kimi-(k[\d.]+)/)
    if (match) {
      return match[1].toUpperCase()
    }
  }

  if (provider === 'gemini') {
    // gemini-2.5-pro, gemini-flash-lite, gemini-1.5-flash → 2.5 Pro / Flash Lite / 1.5 Flash
    const match = id.match(/^gemini-(.+)$/)
    if (match) {
      return match[1]
        .split('-')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    }
  }

  return label
}

/**
 * Reasoning-level display per provider's product convention.
 *
 * Codex: `Low` / `Medium` / `High` / `Extra High` (xhigh → "Extra High")
 * Claude: `Low` / `Medium` / `Max` (high → "Max" per Claude Code convention)
 * Kimi: `Thinking` when on, empty when off
 * Gemini: no reasoning concept today — returns empty
 *
 * `off` always returns empty so the chip omits the reasoning suffix.
 */
export function reasoningDisplayLabel(ctx: ComposerChipContext): string {
  const { provider } = ctx

  if (provider === 'codex') {
    const effort = (ctx.codexReasoningEffort || '').toLowerCase()
    if (!effort) return ''
    if (effort === 'xhigh') return 'Extra High'
    if (effort === 'low') return 'Low'
    if (effort === 'medium') return 'Medium'
    if (effort === 'high') return 'High'
    return effort.charAt(0).toUpperCase() + effort.slice(1)
  }

  if (provider === 'claude') {
    const effort = (ctx.claudeReasoningEffort || '').toLowerCase()
    if (!effort || effort === 'off') return ''
    if (effort === 'high') return 'Max'
    if (effort === 'low') return 'Low'
    if (effort === 'medium') return 'Medium'
    return effort.charAt(0).toUpperCase() + effort.slice(1)
  }

  if (provider === 'kimi') {
    return ctx.kimiThinkingEnabled ? 'Thinking' : ''
  }

  return ''
}

/**
 * Compose the chip text. Per-shell native format when the shell is
 * themed for that provider (Codex shell + Codex provider → real-Codex
 * convention); otherwise a sensible cross-shell default.
 *
 * Examples:
 *   Codex shell + codex provider + xhigh   → `5.5 Extra High`
 *   Claude shell + claude provider + high  → `Opus 4.7 · Max`
 *   Kimi shell + kimi provider + on        → `K2.6 Thinking`
 *   AGBench shell + codex + high           → `GPT-5.5 · High`
 *   AGBench shell + kimi + on              → `K2.6 · Thinking`
 */
export function formatComposerModelChip(ctx: ComposerChipContext): string {
  const { provider, composerStyle, modelLabel, modelId } = ctx
  const reasoning = reasoningDisplayLabel(ctx)
  const shellMatchesProvider =
    (composerStyle === 'codex' && provider === 'codex') ||
    (composerStyle === 'claude' && provider === 'claude') ||
    (composerStyle === 'kimi' && provider === 'kimi') ||
    (composerStyle === 'gemini' && provider === 'gemini')

  // Per-shell native format — only when the shell is themed FOR the
  // active provider. Mixed combinations fall back to the AGBench
  // default so the chip is always readable.
  if (shellMatchesProvider) {
    const short = shortModelName(provider, modelLabel, modelId)
    if (provider === 'codex') {
      return reasoning ? `${short} ${reasoning}` : short
    }
    if (provider === 'claude') {
      return reasoning ? `${short} · ${reasoning}` : short
    }
    if (provider === 'kimi') {
      return reasoning ? `${short} ${reasoning}` : short
    }
    if (provider === 'gemini') {
      return short
    }
  }

  // Default (AGBench native shell, mismatched shell/provider, or
  // creative shells: modular / terminal / stub / satellite).
  return reasoning ? `${modelLabel} · ${reasoning}` : modelLabel
}
