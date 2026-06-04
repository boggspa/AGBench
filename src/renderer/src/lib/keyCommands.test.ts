import { describe, expect, it } from 'vitest'
import {
  findKeyCommandConflict,
  formatKeyCommandBinding,
  getKeyCommandForEvent,
  resolveKeyCommandBindings
} from './keyCommands'

function keyEvent(input: {
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}): KeyboardEvent {
  return input as KeyboardEvent
}

describe('key command bindings', () => {
  it('resolves defaults and matches the command palette shortcut', () => {
    const bindings = resolveKeyCommandBindings({})

    expect(formatKeyCommandBinding(bindings['command-palette'])).toEqual(['Cmd/Ctrl', 'K'])
    expect(getKeyCommandForEvent(keyEvent({ key: 'k', metaKey: true }), bindings)?.id).toBe(
      'command-palette'
    )
  })

  it('applies custom overrides and supports unassigned commands', () => {
    const bindings = resolveKeyCommandBindings({
      'popout-chat-window': { key: 'P', modifiers: ['primary', 'shift'] },
      'toggle-inspector': null
    })

    expect(getKeyCommandForEvent(keyEvent({ key: 'p', ctrlKey: true, shiftKey: true }), bindings)?.id).toBe(
      'popout-chat-window'
    )
    expect(bindings['toggle-inspector']).toBeNull()
  })

  it('detects conflicts against the resolved binding map', () => {
    const bindings = resolveKeyCommandBindings({})
    const conflict = findKeyCommandConflict(
      'popout-chat-window',
      { key: 'K', modifiers: ['primary'] },
      bindings
    )

    expect(conflict?.id).toBe('command-palette')
  })
})
