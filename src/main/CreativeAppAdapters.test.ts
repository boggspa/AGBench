import { describe, expect, it } from 'vitest'
import {
  buildCreativeAppCapabilitySnapshot,
  buildCreativeAppStatusSnapshot,
  buildCreativeProjectSnapshot,
  isCreativeAppId,
  validateFcpxml
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

  it('summarizes FCPXML without mutating the source document', () => {
    const snapshot = buildCreativeProjectSnapshot({
      path: 'edit.fcpxml',
      isDirectory: false,
      text: `
        <fcpxml version="1.14">
          <resources><asset id="r1" /><effect id="e1" /></resources>
          <library><event><project><sequence><spine><asset-clip /><marker /></spine></sequence></project></event></library>
        </fcpxml>
      `
    })

    expect(snapshot.appId).toBe('final-cut-pro')
    expect(snapshot.kind).toBe('fcpxml')
    expect(snapshot.readOnly).toBe(true)
    expect(snapshot.stats.version).toBe('1.14')
    expect(snapshot.stats.assets).toBe(1)
    expect(snapshot.stats.projects).toBe(1)
    expect(snapshot.stats.markers).toBe(1)
  })

  it('summarizes MIDI headers for Logic file workflows', () => {
    const snapshot = buildCreativeProjectSnapshot({
      path: 'cue.mid',
      isDirectory: false,
      bytes: new Uint8Array([
        0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x01, 0x00, 0x02, 0x01, 0xe0
      ])
    })

    expect(snapshot.appId).toBe('logic-pro')
    expect(snapshot.kind).toBe('midi')
    expect(snapshot.stats.validHeader).toBe(true)
    expect(snapshot.stats.format).toBe(1)
    expect(snapshot.stats.tracks).toBe(2)
  })

  it('treats app packages as metadata-only snapshots', () => {
    const snapshot = buildCreativeProjectSnapshot({
      path: 'Project.logicx',
      isDirectory: true,
      sizeBytes: 4096
    })

    expect(snapshot.appId).toBe('logic-pro')
    expect(snapshot.kind).toBe('logic-package')
    expect(snapshot.stats.directory).toBe(true)
    expect(snapshot.warnings[0]).toContain('.logicx internals')
  })

  it('validates clean FCPXML with lightweight checks', () => {
    const result = validateFcpxml({
      path: 'edit.fcpxml',
      text: `
        <fcpxml version="1.14">
          <resources><asset id="r1" src="file:///clip.mov" /></resources>
          <library><event><project><sequence><spine><asset-clip ref="r1" /></spine></sequence></project></event></library>
        </fcpxml>
      `
    })

    expect(result.valid).toBe(true)
    expect(result.version).toBe('1.14')
    expect(result.issueCounts.error).toBe(0)
    expect(result.stats.assets).toBe(1)
  })

  it('flags duplicate ids and unresolved refs in FCPXML', () => {
    const result = validateFcpxml({
      path: 'broken.fcpxml',
      text: `
        <fcpxml version="1.14">
          <resources><asset id="r1" /><asset id="r1" /></resources>
          <library><event><project><sequence><spine><asset-clip ref="missing" /></spine></sequence></project></event></library>
        </fcpxml>
      `
    })

    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('duplicate-id')
    expect(result.issues.map((issue) => issue.code)).toContain('unresolved-ref')
  })
})
