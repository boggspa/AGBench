import { describe, expect, it } from 'vitest'
import {
  buildCreativeAppCapabilitySnapshot,
  buildCreativeAppStatusSnapshot,
  buildCreativeProjectSnapshot,
  buildFcpxmlTimelineDiffPlan,
  buildFcpxmlTimelineIr,
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

  it('parses FCPXML into a compact timeline IR', () => {
    const result = buildFcpxmlTimelineIr({
      path: 'edit.fcpxml',
      text: `
        <fcpxml version="1.14">
          <resources>
            <format id="fmt1" name="FFVideoFormat1080p30" width="1920" height="1080" />
            <asset id="r1" name="Interview" uid="abc" src="file:///interview.mov" duration="10s" />
            <effect id="title1" name="Basic Title" uid=".../Titles.localized/Basic Title" />
          </resources>
          <library>
            <event name="Day 1">
              <project name="Assembly">
                <sequence format="fmt1" duration="10s" tcStart="0s">
                  <spine>
                    <asset-clip name="Interview clip" ref="r1" offset="0s" duration="10s">
                      <marker start="1s" value="Intro" />
                      <caption start="2s" duration="1s" role="caption" />
                    </asset-clip>
                    <title name="Lower third" ref="title1" offset="3s" duration="2s" />
                  </spine>
                </sequence>
              </project>
            </event>
          </library>
        </fcpxml>
      `
    })

    expect(result.ir).toBe('fcpxml-timeline-ir-v1')
    expect(result.version).toBe('1.14')
    expect(result.resources.assets[0].name).toBe('Interview')
    expect(result.resources.formats[0].width).toBe('1920')
    expect(result.projects[0].eventName).toBe('Day 1')
    expect(result.projects[0].sequence?.format).toBe('fmt1')
    expect(result.projects[0].sequence?.spine).toHaveLength(2)
    expect(result.projects[0].sequence?.spine[0].refName).toBe('Interview')
    expect(result.projects[0].sequence?.spine[0].markers[0].value).toBe('Intro')
    expect(result.projects[0].sequence?.spine[0].captions).toHaveLength(1)
    expect(result.projects[0].sequence?.spine[1].refName).toBe('Basic Title')
  })

  it('builds a read-only FCPXML diff plan with sidecar payload', () => {
    const beforeText = `
      <fcpxml version="1.14">
        <resources>
          <format id="fmt1" width="1920" height="1080" />
          <asset id="r1" name="Interview" uid="abc" src="file:///interview.mov" duration="10s" />
          <asset id="r2" name="B-roll" uid="def" src="file:///broll.mov" duration="4s" />
          <effect id="title1" name="Basic Title" uid=".../Titles.localized/Basic Title" />
        </resources>
        <library>
          <event name="Day 1">
            <project name="Assembly">
              <sequence format="fmt1" duration="10s">
                <spine>
                  <asset-clip name="Interview clip" ref="r1" offset="0s" duration="10s" />
                  <title name="Lower third" ref="title1" offset="3s" duration="2s" />
                </spine>
              </sequence>
            </project>
          </event>
        </library>
      </fcpxml>
    `
    const afterText = `
      <fcpxml version="1.14">
        <resources>
          <format id="fmt1" width="1920" height="1080" />
          <asset id="r1" name="Interview" uid="abc" src="file:///interview.mov" duration="10s" />
          <asset id="r2" name="B-roll" uid="def" src="file:///broll.mov" duration="4s" />
          <effect id="title1" name="Basic Title" uid=".../Titles.localized/Basic Title" />
        </resources>
        <library>
          <event name="Day 1">
            <project name="Assembly">
              <sequence format="fmt1" duration="12s">
                <spine>
                  <asset-clip name="Interview clip" ref="r1" offset="0s" duration="8s" />
                  <title name="Lower third" ref="title1" offset="3s" duration="3s" />
                  <asset-clip name="B-roll cutaway" ref="r2" offset="8s" duration="4s" />
                </spine>
              </sequence>
            </project>
          </event>
        </library>
      </fcpxml>
    `

    const result = buildFcpxmlTimelineDiffPlan({
      beforePath: 'original.fcpxml',
      beforeText,
      afterPath: 'draft.fcpxml',
      afterText,
      now: '2026-05-23T10:00:00.000Z'
    })

    expect(result.diff).toBe('fcpxml-timeline-diff-v1')
    expect(result.summary.addedItemCount).toBe(1)
    expect(result.summary.changedItemCount).toBe(2)
    expect(result.projects[0].fields).toContain('sequence.duration')
    expect(result.projects[0].addedItems[0].refName).toBe('B-roll')
    expect(result.projects[0].changedItems[0].fields).toContain('duration')
    expect(result.affectedResources.assets.map((asset) => asset.name)).toEqual([
      'B-roll',
      'Interview'
    ])
    expect(result.affectedResources.effects[0].name).toBe('Basic Title')
    expect(result.sidecar.recommendedPath).toBe('draft.fcpxml.agbench-timeline-diff.json')
    expect(result.sidecar.document).toMatchObject({
      schema: 'agbench-fcpxml-diff-plan-v1',
      beforePath: 'original.fcpxml',
      afterPath: 'draft.fcpxml'
    })
  })
})
