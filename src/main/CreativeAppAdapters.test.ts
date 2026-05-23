import { describe, expect, it } from 'vitest'
import {
  buildCreativeAppCapabilitySnapshot,
  buildCreativeAppStatusSnapshot,
  isCreativeAppId
} from './CreativeAppAdapters'

describe('CreativeAppAdapters', () => {
  it('lists the initial supported creative apps', () => {
    const snapshot = buildCreativeAppStatusSnapshot({
      now: '2026-05-23T00:00:00.000Z',
      fileExists: () => false
    })

    expect(snapshot.generatedAt).toBe('2026-05-23T00:00:00.000Z')
    expect(snapshot.apps.map((app) => app.id)).toEqual(['final-cut-pro', 'logic-pro', 'blender'])
    expect(snapshot.apps.every((app) => app.capabilityCount > 0)).toBe(true)
  })

  it('marks the matching user-attached window without enumerating other windows', () => {
    const snapshot = buildCreativeAppStatusSnapshot({
      attachedWindow: {
        windowID: 42,
        title: 'My Scene.blend',
        bundleID: 'org.blenderfoundation.blender',
        applicationName: 'Blender',
        pid: 1234
      },
      fileExists: () => false
    })

    const blender = snapshot.apps.find((app) => app.id === 'blender')
    const logic = snapshot.apps.find((app) => app.id === 'logic-pro')

    expect(blender?.attached).toBe(true)
    expect(blender?.attachedWindow?.windowID).toBe(42)
    expect(logic?.attached).toBe(false)
    expect(logic?.attachedWindow).toBeUndefined()
  })

  it('filters detailed capabilities by app id', () => {
    const snapshot = buildCreativeAppCapabilitySnapshot({
      appId: 'final-cut-pro',
      fileExists: (path) => path === '/Applications/Final Cut Pro.app'
    })

    expect(snapshot.apps).toHaveLength(1)
    expect(snapshot.apps[0].id).toBe('final-cut-pro')
    expect(snapshot.apps[0].installedHint).toBe(true)
    expect(snapshot.apps[0].capabilities.map((capability) => capability.id)).toContain(
      'fcpxml-patch-plan'
    )
    expect(snapshot.apps[0].prompts).toContain('shot_list_to_fcpxml')
  })

  it('validates creative app ids', () => {
    expect(isCreativeAppId('logic-pro')).toBe(true)
    expect(isCreativeAppId('premiere-pro')).toBe(false)
  })
})
