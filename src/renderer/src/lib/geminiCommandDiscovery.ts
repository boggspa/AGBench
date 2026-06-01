import {
  GEMINI_PALETTE_CORE as COMMAND_PALETTE_CORE,
  type CommandPaletteGroup,
  type CommandPaletteItem,
  type CommandPaletteSource
} from './ComposerSlashCommands'

export type GeminiMemoryFile = {
  id: string
  scope: 'workspace' | 'global'
  path: string
  displayPath: string
  content?: string
  sizeBytes?: number
  error?: string
}

const MEMORY_PREVIEW_CHARS = 6000

export const mergeCommandPaletteItems = (customItems: CommandPaletteItem[]): CommandPaletteItem[] => {
  const seen = new Set<string>()
  const next: CommandPaletteItem[] = []

  for (const item of [...COMMAND_PALETTE_CORE, ...customItems]) {
    const key = item.command.trim().toLowerCase()
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    next.push(item)
  }

  return next
}

export const normalizeDiscoveredCommandItems = (items: any[]): CommandPaletteItem[] => {
  if (!Array.isArray(items)) {
    return []
  }

  return items
    .map((item, index): CommandPaletteItem | null => {
      const command = typeof item?.command === 'string' ? item.command.trim() : ''
      if (!command.startsWith('/')) {
        return null
      }

      const source: CommandPaletteSource = item.scope === 'global' ? 'global' : 'workspace'
      return {
        id: `custom-${source}-${command}-${index}`,
        command,
        label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : command,
        description:
          typeof item.description === 'string' && item.description.trim()
            ? item.description.trim()
            : `Custom Gemini command discovered from ${source} command files.`,
        group: 'Custom' as CommandPaletteGroup,
        source,
        sourcePath: typeof item.sourcePath === 'string' ? item.sourcePath : undefined
      }
    })
    .filter((item): item is CommandPaletteItem => Boolean(item))
}

export const getMemoryPreviewText = (file: GeminiMemoryFile): string => {
  const content = file.error || file.content || '(empty GEMINI.md)'
  if (content.length <= MEMORY_PREVIEW_CHARS) {
    return content
  }
  return `${content.slice(0, MEMORY_PREVIEW_CHARS)}\n\n[truncated ${content.length - MEMORY_PREVIEW_CHARS} characters]`
}
