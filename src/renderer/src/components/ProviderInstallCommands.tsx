import { useState, type ReactElement } from 'react'

interface ProviderInstallEntry {
  id: string
  label: string
  command: string
  /** The vendor the command comes from — shown on hover so a newcomer
   * can confirm it's the official source, not a third-party script. */
  source: string
}

/**
 * Official, copy-pasteable CLI install commands — one per provider, each
 * taken from that vendor's own published install docs. Surfaced in BOTH
 * the first-launch onboarding sheet and Settings → Providers so people
 * who live in ChatGPT/Claude.ai and have never touched a terminal can
 * get a CLI installed without hunting through six different doc sites.
 *
 * Keep these in sync with the vendors' official install pages:
 *   Codex  — OpenAI:    npm i -g @openai/codex                         (developers.openai.com/codex/cli)
 *   Claude — Anthropic: curl -fsSL https://claude.ai/install.sh | bash (code.claude.com/docs/en/setup)
 *   Gemini — Google:    npm i -g @google/gemini-cli                    (geminicli.com/docs)
 *   Kimi   — Moonshot:  curl -LsSf https://code.kimi.com/install.sh    (moonshotai.github.io/kimi-cli)
 *   Cursor — Cursor:    curl https://cursor.com/install -fsS | bash    (cursor.com/docs/cli/installation)
 *   Grok   — xAI:       curl -fsSL https://x.ai/cli/install.sh | bash  (x.ai/cli)
 *   Ollama — Ollama:    curl -fsSL https://ollama.com/install.sh | sh  (ollama.com)
 * (npm commands need Node 20+; the curl installers are self-contained.)
 */
const PROVIDER_INSTALL_COMMANDS: ProviderInstallEntry[] = [
  { id: 'codex', label: 'Codex', command: 'npm i -g @openai/codex', source: 'OpenAI' },
  {
    id: 'claude',
    label: 'Claude',
    command: 'curl -fsSL https://claude.ai/install.sh | bash',
    source: 'Anthropic'
  },
  { id: 'gemini', label: 'Gemini', command: 'npm i -g @google/gemini-cli', source: 'Google' },
  {
    id: 'kimi',
    label: 'Kimi',
    command: 'curl -LsSf https://code.kimi.com/install.sh | bash',
    source: 'Moonshot'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    command: 'curl https://cursor.com/install -fsS | bash',
    source: 'Cursor'
  },
  {
    id: 'grok',
    label: 'Grok',
    command: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    source: 'xAI'
  },
  {
    id: 'ollama',
    label: 'Ollama',
    command: 'curl -fsSL https://ollama.com/install.sh | sh',
    source: 'Ollama'
  }
]

/**
 * Rows of copyable official install commands. Pure presentation +
 * clipboard; the host decides whether to wrap it in a <details> (we do
 * in both call sites to keep the surfaces tidy by default).
 */
export function ProviderInstallCommands(): ReactElement {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copy = (entry: ProviderInstallEntry): void => {
    void navigator.clipboard?.writeText(entry.command)
    setCopiedId(entry.id)
    // Transient "Copied" confirmation; clears only if this row is still
    // the one showing it (so a quick second copy doesn't flash-clear).
    window.setTimeout(() => setCopiedId((cur) => (cur === entry.id ? null : cur)), 1500)
  }

  return (
    <div className="provider-install-commands">
      {PROVIDER_INSTALL_COMMANDS.map((entry) => (
        <div key={entry.id} className="provider-install-row" data-provider={entry.id}>
          <span className="provider-install-label">{entry.label}</span>
          <code className="provider-install-cmd" title={`Official ${entry.source} install command`}>
            {entry.command}
          </code>
          <button
            type="button"
            className="btn btn-sm provider-install-copy"
            onClick={() => copy(entry)}
            aria-label={`Copy ${entry.label} install command`}
          >
            {copiedId === entry.id ? 'Copied' : 'Copy'}
          </button>
        </div>
      ))}
    </div>
  )
}
