import { describe, it, expect } from 'vitest'
import {
  GEMINI_PALETTE_CORE,
  CODEX_PALETTE_CORE,
  CLI_PROVIDER_PALETTE_CORE,
  COMPOSER_SLASH_GROUP_ORDER,
  buildComposerSlashCommandRegistry,
  filterComposerSlashCommands,
  paletteCoreForProvider,
  wrapPaletteItemAsSlashCommand,
  type ComposerSlashCommand
} from './ComposerSlashCommands'

describe('ComposerSlashCommands', () => {
  describe('wrapPaletteItemAsSlashCommand', () => {
    it('wraps a CommandPaletteItem as a palette-passthrough ComposerSlashCommand', () => {
      const item = GEMINI_PALETTE_CORE[0]
      const wrapped = wrapPaletteItemAsSlashCommand(item)
      expect(wrapped.kind).toBe('palette-passthrough')
      expect(wrapped.id).toBe(item.id)
      expect(wrapped.command).toBe(item.command)
      expect(wrapped.label).toBe(item.label)
      expect(wrapped.description).toBe(item.description)
      expect(wrapped.group).toBe(item.group)
      // The original item is retained so the dispatcher can route it to
      // the existing handlePaletteCommand without losing fields like
      // `source`, `sourcePath`, or `action`.
      expect(wrapped.paletteItem).toBe(item)
    })
  })

  describe('paletteCoreForProvider', () => {
    it('returns GEMINI_PALETTE_CORE for gemini', () => {
      expect(paletteCoreForProvider('gemini')).toBe(GEMINI_PALETTE_CORE)
    })
    it('returns CODEX_PALETTE_CORE for codex', () => {
      expect(paletteCoreForProvider('codex')).toBe(CODEX_PALETTE_CORE)
    })
    it('returns CLI_PROVIDER_PALETTE_CORE for claude', () => {
      expect(paletteCoreForProvider('claude')).toBe(CLI_PROVIDER_PALETTE_CORE)
    })
    it('returns CLI_PROVIDER_PALETTE_CORE for kimi', () => {
      expect(paletteCoreForProvider('kimi')).toBe(CLI_PROVIDER_PALETTE_CORE)
    })
  })

  describe('buildComposerSlashCommandRegistry', () => {
    it('wraps every palette item as a palette-passthrough entry', () => {
      const result = buildComposerSlashCommandRegistry({
        provider: 'gemini',
        paletteItems: GEMINI_PALETTE_CORE
      })
      expect(result).toHaveLength(GEMINI_PALETTE_CORE.length)
      for (const entry of result) {
        expect(entry.kind).toBe('palette-passthrough')
      }
    })

    it('appends extraCommands after the palette-passthrough block', () => {
      const extras: ComposerSlashCommand[] = [
        {
          kind: 'action',
          id: 'test-extra',
          command: '/test-extra',
          label: 'Test extra',
          description: 'Test description',
          group: 'Custom',
          run: () => undefined
        }
      ]
      const result = buildComposerSlashCommandRegistry({
        provider: 'codex',
        paletteItems: CODEX_PALETTE_CORE,
        extraCommands: extras
      })
      expect(result).toHaveLength(CODEX_PALETTE_CORE.length + 1)
      expect(result[result.length - 1].id).toBe('test-extra')
      expect(result[result.length - 1].kind).toBe('action')
    })

    it('produces an empty registry when no items are provided', () => {
      const result = buildComposerSlashCommandRegistry({
        provider: 'gemini',
        paletteItems: []
      })
      expect(result).toEqual([])
    })
  })

  describe('filterComposerSlashCommands', () => {
    const registry = buildComposerSlashCommandRegistry({
      provider: 'codex',
      paletteItems: CODEX_PALETTE_CORE
    })

    it('returns all commands when query is empty', () => {
      expect(filterComposerSlashCommands(registry, '')).toEqual(registry)
      expect(filterComposerSlashCommands(registry, '   ')).toEqual(registry)
    })

    it('matches case-insensitively against the slash command text', () => {
      const result = filterComposerSlashCommands(registry, 'FORK')
      expect(result).toHaveLength(1)
      expect(result[0].command).toBe('/fork')
    })

    it('matches against the label and description', () => {
      // "review" appears in /review's label AND description; expect both
      // matches at least.
      const result = filterComposerSlashCommands(registry, 'review')
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result.some((entry) => entry.command === '/review')).toBe(true)
    })

    it('matches against the group label', () => {
      const result = filterComposerSlashCommands(registry, 'Inspectors')
      const inspectorEntries = registry.filter((entry) => entry.group === 'Inspectors')
      expect(result).toHaveLength(inspectorEntries.length)
    })

    it('returns no entries when nothing matches', () => {
      expect(filterComposerSlashCommands(registry, '__never_appears__')).toEqual([])
    })
  })

  describe('group ordering', () => {
    it('matches the Cmd-K palette group order (Core → Discovery → Memory → Inspectors → Custom)', () => {
      expect(COMPOSER_SLASH_GROUP_ORDER).toEqual([
        'Core',
        'Discovery',
        'Memory',
        'Inspectors',
        'Custom'
      ])
    })
  })

  describe('per-provider palette parity', () => {
    it('Gemini palette CORE has the expected entries', () => {
      const ids = GEMINI_PALETTE_CORE.map((entry) => entry.id)
      expect(ids).toEqual([
        'core-help',
        'core-stats',
        'core-commands-list',
        'core-commands-reload',
        'core-memory-list',
        'core-memory-show',
        'core-memory-refresh',
        'core-mcp',
        'core-extensions',
        'core-hooks'
      ])
    })

    it('Codex palette CORE has the expected entries', () => {
      const ids = CODEX_PALETTE_CORE.map((entry) => entry.id)
      expect(ids).toEqual([
        'codex-status',
        'codex-model',
        'codex-fast',
        'codex-diff',
        'codex-mcp',
        'codex-review',
        'codex-resume',
        'codex-fork',
        'codex-permissions'
      ])
    })

    it('CLI provider palette CORE has the expected entries', () => {
      const ids = CLI_PROVIDER_PALETTE_CORE.map((entry) => entry.id)
      expect(ids).toEqual([
        'cli-provider-status',
        'cli-provider-model',
        'cli-provider-diff',
        'cli-provider-review',
        'cli-provider-permissions'
      ])
    })
  })
})
