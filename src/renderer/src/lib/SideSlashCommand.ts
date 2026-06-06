export type SideSlashPresentation = 'split' | 'drawer' | 'popout' | 'main'

export interface SideSlashCommand {
  presentation: SideSlashPresentation
  seedPrompt: string
}

const PRESENTATION_ALIASES: Record<string, SideSlashPresentation> = {
  split: 'split',
  beside: 'split',
  drawer: 'drawer',
  popout: 'popout',
  'pop-out': 'popout',
  window: 'popout',
  main: 'main'
}

export function parseSideSlashCommand(value: string): SideSlashCommand | null {
  const withoutLeadingWhitespace = value.replace(/^\s+/, '')
  const commandMatch = withoutLeadingWhitespace.match(/^\/side(?:-([a-z-]+))?(?=\s|$)/i)
  if (!commandMatch) return null
  const directPresentation = commandMatch[1]
    ? PRESENTATION_ALIASES[commandMatch[1].toLowerCase()]
    : undefined
  if (commandMatch[1] && !directPresentation) return null

  const args = withoutLeadingWhitespace.slice(commandMatch[0].length).trim()
  if (directPresentation) return { presentation: directPresentation, seedPrompt: args }
  if (!args) return { presentation: 'split', seedPrompt: '' }

  const firstSpace = args.search(/\s/)
  const firstToken = firstSpace < 0 ? args : args.slice(0, firstSpace)
  const presentation = PRESENTATION_ALIASES[firstToken.toLowerCase()]
  if (!presentation) return { presentation: 'split', seedPrompt: args }

  return {
    presentation,
    seedPrompt: firstSpace < 0 ? '' : args.slice(firstSpace).trim()
  }
}
