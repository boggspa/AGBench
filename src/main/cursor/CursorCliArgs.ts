// Pure builder for the Cursor Agent CLI argv (`cursor-agent -p …`). No Electron
// imports — unit-testable. Mirrors GrokCliArgs.
//
// LOAD-BEARING SAFETY (proven by the CR3 live spike — see the blueprint):
//   * A bare `cursor-agent -p` has write+shell and uses them UNMEDIATED. So we
//     NEVER spawn bare `-p`: read-only runs always pass `--mode plan` (proven
//     to refuse edits), and write runs are contained by a workspace-local
//     `.cursor/cli.json` deny-list (written by CursorWorkspaceConfig, NOT here).
//   * We NEVER pass `--force` / `--yolo` (they auto-allow everything).
//   * Only Composer 2.5 model ids are forwarded — AGBench exposes no other
//     Cursor-proxied model.

import { CURSOR_COMPOSER_MODEL_IDS } from './CursorCliProbe'

/**
 * `'plan'` / unset = read-only (`--mode plan`, no edits). Anything else =
 * write-capable (default mode + the deny-list config contains native side
 * effects). Mirrors grokWriteCapable / claudePermissionModeForApproval.
 */
export function cursorWriteCapable(approvalMode: string | null | undefined): boolean {
  return typeof approvalMode === 'string' && approvalMode.trim() !== '' && approvalMode !== 'plan'
}

export interface BuildCursorCliArgsInput {
  prompt: string
  workspace: string
  model?: string | null
  /** Resume a prior chat by id (Cursor `--resume <chatId>`). */
  providerSessionId?: string | null
  /** Composer approval mode: 'plan'/unset = read-only; else write-capable. */
  approvalMode?: string | null
}

/** True only for the canonical Composer 2.5 ids (composer-2.5 / -fast). Any
 *  other value (CLI-default sentinel, a leaked id from another provider's
 *  picker) is dropped so Cursor falls back to its account default rather than
 *  erroring on an unknown model. */
function isComposerModel(model: string | null | undefined): model is string {
  return typeof model === 'string' && CURSOR_COMPOSER_MODEL_IDS.includes(model)
}

export function buildCursorCliArgs(input: BuildCursorCliArgsInput): string[] {
  const writeCapable = cursorWriteCapable(input.approvalMode)
  const args: string[] = [
    '-p',
    '--output-format',
    'stream-json',
    // Headless: trust the workspace so the run doesn't block on the interactive
    // "Trust this workspace" prompt (only valid with --print).
    '--trust',
    '--workspace',
    input.workspace
  ]
  // Read-only safety: plan mode performs no edits (proven). Write mode runs in
  // default mode; native side effects are contained by the deny-list config.
  // NEVER `--force` / `--yolo`.
  if (!writeCapable) {
    args.push('--mode', 'plan')
  }
  const resumeId =
    typeof input.providerSessionId === 'string' ? input.providerSessionId.trim() : ''
  if (resumeId) {
    args.push('--resume', resumeId)
  }
  if (isComposerModel(input.model)) {
    args.push('--model', input.model)
  }
  // Prompt is the trailing positional.
  args.push(input.prompt)
  return args
}
