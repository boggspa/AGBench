/*
 * BugReportService — append-only intake for tester bug reports (1.0.1).
 *
 * Built for early external tester passes: when a tester hits something
 * weird, they open the BugReportSheet in the renderer,
 * types a title + description + severity, and the form submits
 * through `submit-bug-report` IPC. This module is the main-side
 * receiver — it renders the payload to a Markdown entry and appends
 * to a single file under `<userData>/AGBench/bug-reports.md`.
 *
 * Why one file with `---` separators (not one file per report):
 *   1. Easier to triage by hand at the end of the session: open one
 *      file, scroll the entries.
 *   2. Sortable / greppable / pipeable; per-file reports buried under
 *      timestamp filenames hurt the "skim and triage" use-case the
 *      tester intake is designed for.
 *   3. Single file is simpler to back up / share / paste into a
 *      Slack thread.
 *
 * The rendering is intentionally pure (no fs / app dependencies) so
 * the unit test can assert exact markdown output. The fs/append
 * layer lives at the bottom of the file and is the only piece that
 * needs an environment.
 */

import * as path from 'node:path'
import { promises as fs } from 'node:fs'

export type BugReportSeverity = 'info' | 'minor' | 'major' | 'blocking'

export interface BugReportContext {
  /** ISO 8601 timestamp captured client-side when the user opened
   * the sheet. We trust the renderer here — the file is local and
   * the tester is the user; no spoofing concern. */
  timestamp: string
  /** App version string (semver). Stamped from `app.getVersion()` so
   * the entry survives even if the renderer's display is stale. */
  version: string
  /** Currently-selected provider id (codex / claude / etc.). */
  provider: string
  /** Workspace path the chat is rooted in, or "(global chat)" when
   * the chat is provider-global. */
  workspace: string
  /** Composer shell label (default / codex / claude / gemini / kimi /
   * modular). */
  shell: string
  /** User-selected surface from the report sheet. */
  surface?: string
  /** Active chat kind, e.g. single-provider or ensemble. */
  chatKind?: string
  /** Active Settings tab when the report was filed from Settings. */
  settingsTab?: string
  /** Active inspector tab when the inspector was visible. */
  inspectorTab?: string
  /** Appearance theme token at capture time. */
  theme?: string
  /** Prompt/message bubble preference at capture time. */
  promptBubble?: string
  /** Compact participant/mode summary for Ensemble chats. */
  ensemble?: string
}

export interface BugReportSubmission {
  title: string
  description: string
  /** May be empty — section is omitted from the Markdown body when so. */
  expected: string
  severity: BugReportSeverity
  context: BugReportContext
}

/** Maximum size of the single append-only file before the service
 * starts logging a warning. Soft cap — we still append; the warning
 * exists so the maintainer can sweep + archive the file before it gets
 * unwieldy. 5 MB ≈ 50k typical entries. */
const SOFT_SIZE_WARNING_BYTES = 5 * 1024 * 1024

/** Build a human-readable timestamp from an ISO string. Falls back
 * to the ISO when the locale conversion throws (shouldn't happen on
 * a real Date, but defensive — the renderer is sending raw strings). */
function humanizeTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function pushOptionalContext(lines: string[], label: string, value: unknown): void {
  const text = optionalString(value)
  if (text) lines.push(`- ${label}: ${text}`)
}

/**
 * Render a single bug-report submission to its Markdown form. Pure
 * — no fs touches. Returns the entry body without leading / trailing
 * separators (the caller adds the `---` HR when stitching it into
 * the append file).
 */
export function renderBugReportMarkdown(submission: BugReportSubmission): string {
  const ctx = submission.context
  const human = humanizeTimestamp(ctx.timestamp)
  const lines: string[] = []
  // YAML frontmatter — keeps the file scannable; the maintainer can pipe to a
  // YAML parser later if he wants programmatic triage. We escape
  // double quotes in the title since YAML's single-line strings need
  // it; everything else is structurally simple enough not to need
  // additional escaping.
  lines.push('---')
  lines.push(`title: ${yamlString(submission.title)}`)
  lines.push(`severity: ${submission.severity}`)
  lines.push(`timestamp: ${ctx.timestamp}`)
  lines.push(`version: ${ctx.version}`)
  lines.push(`provider: ${ctx.provider}`)
  lines.push(`workspace: ${ctx.workspace}`)
  lines.push(`shell: ${ctx.shell}`)
  if (optionalString(ctx.surface)) lines.push(`surface: ${yamlString(ctx.surface!)}`)
  if (optionalString(ctx.chatKind)) lines.push(`chat_kind: ${yamlString(ctx.chatKind!)}`)
  if (optionalString(ctx.settingsTab)) lines.push(`settings_tab: ${yamlString(ctx.settingsTab!)}`)
  if (optionalString(ctx.inspectorTab))
    lines.push(`inspector_tab: ${yamlString(ctx.inspectorTab!)}`)
  if (optionalString(ctx.theme)) lines.push(`theme: ${yamlString(ctx.theme!)}`)
  if (optionalString(ctx.promptBubble))
    lines.push(`prompt_bubble: ${yamlString(ctx.promptBubble!)}`)
  if (optionalString(ctx.ensemble)) lines.push(`ensemble: ${yamlString(ctx.ensemble!)}`)
  lines.push('---')
  lines.push('')
  lines.push('## What happened')
  lines.push('')
  // If the tester left the description empty, mark it explicitly —
  // an empty section reads as "the maintainer missed something", we want
  // "(tester provided no description)" for clarity.
  lines.push(submission.description.trim() || '_(tester provided no description)_')
  lines.push('')
  if (submission.expected.trim()) {
    lines.push('## What was expected')
    lines.push('')
    lines.push(submission.expected.trim())
    lines.push('')
  }
  lines.push('## Context')
  lines.push('')
  lines.push(`- Timestamp: ${human} (${ctx.timestamp})`)
  lines.push(`- Version: ${ctx.version}`)
  lines.push(`- Provider: ${ctx.provider}`)
  pushOptionalContext(lines, 'Surface', ctx.surface)
  pushOptionalContext(lines, 'Chat kind', ctx.chatKind)
  lines.push(`- Workspace: ${ctx.workspace}`)
  lines.push(`- Shell: ${ctx.shell}`)
  pushOptionalContext(lines, 'Settings tab', ctx.settingsTab)
  pushOptionalContext(lines, 'Inspector tab', ctx.inspectorTab)
  pushOptionalContext(lines, 'Theme', ctx.theme)
  pushOptionalContext(lines, 'Bubble', ctx.promptBubble)
  pushOptionalContext(lines, 'Ensemble', ctx.ensemble)
  lines.push('')
  return lines.join('\n')
}

/**
 * Stitch a new entry into the append-only file payload. When the
 * existing buffer is empty, the entry is written as-is (no leading
 * separator); otherwise the entry is prefixed with a horizontal rule
 * + blank line so entries split cleanly when viewed as Markdown.
 *
 * Pure — does not touch fs. Exposed so the unit test can assert the
 * exact byte layout for `Append once` and `Append twice`.
 */
export function stitchAppendEntry(existing: string, newEntry: string): string {
  if (!existing.trim()) return newEntry
  // Ensure exactly one blank line between the existing tail and the
  // separator, and one blank line after the separator before the
  // next frontmatter.
  const trimmedExisting = existing.replace(/\n+$/, '\n')
  return `${trimmedExisting}\n---\n\n${newEntry}`
}

export interface BugReportWriteResult {
  ok: true
  path: string
  bytesWritten: number
  totalBytes: number
  sizeWarning: boolean
}

/**
 * Append a single bug-report entry to the on-disk file. Creates the
 * parent directory if missing. Returns the absolute path so callers
 * can surface "saved to ..." back to the user.
 *
 * The fs touch is intentionally minimal so the test can mock `fs`
 * via a small file-ops shim (passed in via the `ops` parameter for
 * unit-test isolation; defaults to the real `fs.promises` API in
 * production calls).
 */
export interface BugReportFsOps {
  mkdir: (dir: string, opts: { recursive: boolean }) => Promise<unknown>
  readFile: (file: string, encoding: 'utf8') => Promise<string>
  writeFile: (file: string, data: string, encoding: 'utf8') => Promise<void>
}

const realFsOps: BugReportFsOps = {
  mkdir: (dir, opts) => fs.mkdir(dir, opts),
  readFile: async (file, encoding) => {
    try {
      return await fs.readFile(file, encoding)
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e && e.code === 'ENOENT') return ''
      throw err
    }
  },
  writeFile: (file, data, encoding) => fs.writeFile(file, data, encoding)
}

/**
 * Resolve the on-disk file path. `<userData>/AGBench/bug-reports.md`.
 * Separated so the test can call it with a tmpdir as the userData root.
 */
export function resolveBugReportPath(userDataDir: string): string {
  return path.join(userDataDir, 'AGBench', 'bug-reports.md')
}

/** Append a rendered bug-report entry to the on-disk file. Public
 * orchestrator — the bulk of the logic is in the pure helpers above
 * so this function is mostly fs-glue. */
export async function appendBugReport(
  userDataDir: string,
  submission: BugReportSubmission,
  ops: BugReportFsOps = realFsOps
): Promise<BugReportWriteResult> {
  const filePath = resolveBugReportPath(userDataDir)
  const parentDir = path.dirname(filePath)
  await ops.mkdir(parentDir, { recursive: true })
  const existing = await ops.readFile(filePath, 'utf8')
  const entry = renderBugReportMarkdown(submission)
  const next = stitchAppendEntry(existing, entry)
  await ops.writeFile(filePath, next, 'utf8')
  const totalBytes = Buffer.byteLength(next, 'utf8')
  return {
    ok: true,
    path: filePath,
    bytesWritten: Buffer.byteLength(entry, 'utf8'),
    totalBytes,
    sizeWarning: totalBytes >= SOFT_SIZE_WARNING_BYTES
  }
}
