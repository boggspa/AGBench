import { describe, expect, it } from 'vitest'
import { parseSideSlashCommand } from './SideSlashCommand'

describe('parseSideSlashCommand', () => {
  it('parses the default split side chat command', () => {
    expect(parseSideSlashCommand('/side')).toEqual({ presentation: 'split', seedPrompt: '' })
    expect(parseSideSlashCommand('  /side Investigate this branch')).toEqual({
      presentation: 'split',
      seedPrompt: 'Investigate this branch'
    })
  })

  it('parses explicit side chat presentations', () => {
    expect(parseSideSlashCommand('/side drawer inspect this')).toEqual({
      presentation: 'drawer',
      seedPrompt: 'inspect this'
    })
    expect(parseSideSlashCommand('/side popout')).toEqual({
      presentation: 'popout',
      seedPrompt: ''
    })
    expect(parseSideSlashCommand('/side pop-out review this in a window')).toEqual({
      presentation: 'popout',
      seedPrompt: 'review this in a window'
    })
    expect(parseSideSlashCommand('/side main continue here')).toEqual({
      presentation: 'main',
      seedPrompt: 'continue here'
    })
  })

  it('rejects non-side slash commands and side-looking prefixes', () => {
    expect(parseSideSlashCommand('/sidecar')).toBeNull()
    expect(parseSideSlashCommand('/clear')).toBeNull()
  })
})
