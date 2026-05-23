import { describe, expect, it } from 'vitest'
import {
  buildCreativeAppCapabilitySnapshot,
  buildCreativeAppStatusSnapshot,
  buildCreativeProjectSnapshot,
  buildFcpxmlTimelineDiffPlan,
  buildFcpxmlTimelineIr,
  isCreativeAppId,
  listCreativeAppBundleIds,
  serializeFcpxmlTimelineIr,
  validateFcpxml,
  type FcpxmlTimelineIr
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

  // Phase K1 — running-process probe.
  describe('runningHint (K1)', () => {
    it('exposes every declared bundle id via listCreativeAppBundleIds', () => {
      const ids = listCreativeAppBundleIds()
      expect(ids).toContain('com.apple.FinalCut')
      expect(ids).toContain('com.apple.logic10')
      expect(ids).toContain('org.blenderfoundation.blender')
      // Set semantics — no duplicates.
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('defaults runningHint to false when no predicate is supplied', () => {
      const snapshot = buildCreativeAppStatusSnapshot({ fileExists: () => true })
      for (const app of snapshot.apps) {
        expect(app.runningHint).toBe(false)
      }
    })

    it('flips runningHint to true when the predicate returns true for any declared bundle id', () => {
      const snapshot = buildCreativeAppStatusSnapshot({
        fileExists: () => true,
        runningHint: (bundleId) => bundleId === 'com.apple.FinalCut'
      })
      const fcp = snapshot.apps.find((app) => app.id === 'final-cut-pro')
      const logic = snapshot.apps.find((app) => app.id === 'logic-pro')
      const blender = snapshot.apps.find((app) => app.id === 'blender')
      expect(fcp?.runningHint).toBe(true)
      expect(logic?.runningHint).toBe(false)
      expect(blender?.runningHint).toBe(false)
    })

    it('keeps installedHint and runningHint orthogonal — installed-but-quit and quit-but-running are both representable', () => {
      // Installed but not running (app on disk, quit): installedHint=true, runningHint=false.
      const installedQuiet = buildCreativeAppStatusSnapshot({
        appId: 'final-cut-pro',
        fileExists: (path) => path === '/Applications/Final Cut Pro.app',
        runningHint: () => false
      })
      expect(installedQuiet.apps[0].installedHint).toBe(true)
      expect(installedQuiet.apps[0].runningHint).toBe(false)
      // Running but on a non-/Applications path (less common, but possible
      // for sideloaded copies): installedHint=false, runningHint=true.
      // The agent sees "running without a known disk hint" — useful signal.
      const runningElsewhere = buildCreativeAppStatusSnapshot({
        appId: 'final-cut-pro',
        fileExists: () => false,
        runningHint: () => true
      })
      expect(runningElsewhere.apps[0].installedHint).toBe(false)
      expect(runningElsewhere.apps[0].runningHint).toBe(true)
    })

    it('propagates runningHint into the capabilities snapshot too', () => {
      const snapshot = buildCreativeAppCapabilitySnapshot({
        appId: 'blender',
        fileExists: () => true,
        runningHint: (bundleId) => bundleId === 'org.blenderfoundation.blender'
      })
      expect(snapshot.apps[0].runningHint).toBe(true)
    })
  })

  // Phase K2 — FCPXML writer round-trip.
  describe('serializeFcpxmlTimelineIr (K2)', () => {
    it('emits a minimal valid FCPXML skeleton from an empty IR', () => {
      const result = serializeFcpxmlTimelineIr({ ir: {} })
      expect(result.ok).toBe(true)
      expect(result.text).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/)
      expect(result.text).toContain('<!DOCTYPE fcpxml>')
      expect(result.text).toContain('<fcpxml version="1.13">')
      expect(result.text).toContain('<resources>')
      // No <library> when no projects — keeps the doc minimal and importable.
      expect(result.text).not.toContain('<library>')
      expect(result.text).toMatch(/<\/fcpxml>\n$/)
      expect(result.summary.assetCount).toBe(0)
      expect(result.summary.projectCount).toBe(0)
    })

    it('round-trips a representative IR through emit → parse without losing structural fields', () => {
      const ir: FcpxmlTimelineIr = {
        ok: true,
        generatedAt: '2026-05-23T00:00:00.000Z',
        appId: 'final-cut-pro',
        path: 'edit.fcpxml',
        kind: 'fcpxml',
        readOnly: true,
        ir: 'fcpxml-timeline-ir-v1',
        version: '1.13',
        resources: {
          formats: [
            {
              id: 'r1',
              name: 'FFVideoFormat1080p2997',
              width: '1920',
              height: '1080',
              frameDuration: '1001/30000s'
            }
          ],
          assets: [
            {
              id: 'r2',
              name: 'B-roll',
              uid: 'ABC123',
              src: 'file:///Users/dev/Movies/broll.mov',
              duration: '120s',
              start: '0s',
              format: 'r1'
            }
          ],
          effects: [{ id: 'r3', name: 'Basic Title', uid: '.../Titles.localized/Basic Title.moef' }]
        },
        projects: [
          {
            name: 'My Edit',
            eventName: 'Phase K shoot',
            sequence: {
              name: 'My Edit',
              duration: '180s',
              format: 'r1',
              tcStart: '0s',
              tcFormat: 'NDF',
              spine: [
                {
                  index: 0,
                  type: 'asset-clip',
                  name: 'Opening shot',
                  ref: 'r2',
                  refName: 'B-roll',
                  offset: '0s',
                  start: '0s',
                  duration: '60s',
                  role: 'video',
                  markers: [
                    {
                      type: 'marker',
                      start: '15s',
                      duration: '1/30000s',
                      value: 'beat drop',
                      note: 'cymbal hit'
                    }
                  ],
                  captions: [
                    {
                      type: 'caption',
                      start: '5s',
                      duration: '3s',
                      value: 'Hello world',
                      role: 'iTT'
                    }
                  ]
                },
                {
                  index: 1,
                  type: 'gap',
                  name: undefined,
                  offset: '60s',
                  duration: '2s',
                  markers: [],
                  captions: []
                }
              ],
              markers: [
                {
                  type: 'chapter-marker',
                  start: '0s',
                  duration: '1/30000s',
                  value: 'Chapter 1'
                }
              ]
            }
          }
        ],
        summary: {},
        warnings: []
      }
      const writer = serializeFcpxmlTimelineIr({ ir })
      expect(writer.summary.timelineItemCount).toBe(2)
      // Reparse — the IR builder should reconstitute the same structural shape.
      const reparsed = buildFcpxmlTimelineIr({ path: 'roundtrip.fcpxml', text: writer.text })
      expect(reparsed.version).toBe('1.13')
      expect(reparsed.resources.assets.map((asset) => asset.id)).toEqual(['r2'])
      expect(reparsed.resources.assets[0].name).toBe('B-roll')
      expect(reparsed.resources.assets[0].src).toBe('file:///Users/dev/Movies/broll.mov')
      expect(reparsed.resources.formats[0].frameDuration).toBe('1001/30000s')
      expect(reparsed.resources.effects[0].name).toBe('Basic Title')
      expect(reparsed.projects).toHaveLength(1)
      const project = reparsed.projects[0]
      expect(project.name).toBe('My Edit')
      expect(project.eventName).toBe('Phase K shoot')
      expect(project.sequence?.spine).toHaveLength(2)
      expect(project.sequence?.spine[0].type).toBe('asset-clip')
      expect(project.sequence?.spine[0].name).toBe('Opening shot')
      expect(project.sequence?.spine[0].ref).toBe('r2')
      expect(project.sequence?.spine[0].duration).toBe('60s')
      expect(project.sequence?.spine[0].markers).toHaveLength(1)
      expect(project.sequence?.spine[0].markers[0].value).toBe('beat drop')
      expect(project.sequence?.spine[0].captions).toHaveLength(1)
      expect(project.sequence?.spine[0].captions[0].value).toBe('Hello world')
      expect(project.sequence?.spine[1].type).toBe('gap')
      expect(project.sequence?.spine[1].duration).toBe('2s')
      // Sequence-level markers in the parser use recursive `descendants()`
      // so the count is "all marker-like elements in the subtree" — the
      // chapter-marker we put at sequence level plus the marker+caption
      // inside the clip. That's pre-existing parser behavior, not a
      // writer concern. We just assert the chapter-marker we emitted
      // round-trips into the set.
      const chapterMarkers = (project.sequence?.markers || []).filter(
        (m) => m.type === 'chapter-marker'
      )
      expect(chapterMarkers).toHaveLength(1)
      expect(chapterMarkers[0].value).toBe('Chapter 1')
    })

    it('escapes XML metacharacters in attribute values', () => {
      const writer = serializeFcpxmlTimelineIr({
        ir: {
          resources: {
            assets: [
              {
                id: 'r1',
                name: 'Title with <special> & "quotes" \'apostrophes\'',
                src: 'file:///path/with&amp;.mov'
              }
            ]
          }
        }
      })
      // Verify entities, not raw chars. The doc must still be parseable.
      expect(writer.text).toContain('&lt;special&gt;')
      expect(writer.text).toContain('&amp;')
      expect(writer.text).toContain('&quot;quotes&quot;')
      expect(writer.text).toContain('&apos;apostrophes&apos;')
      // And it round-trips back to the original strings.
      const reparsed = buildFcpxmlTimelineIr({ path: 'esc.fcpxml', text: writer.text })
      expect(reparsed.resources.assets[0].name).toBe(
        'Title with <special> & "quotes" \'apostrophes\''
      )
    })

    it('preserves spine item ordering across emit/parse', () => {
      const ir: FcpxmlTimelineIr['projects'][number] = {
        name: 'order-test',
        sequence: {
          spine: [
            { index: 0, type: 'asset-clip', name: 'A', markers: [], captions: [] },
            { index: 1, type: 'gap', markers: [], captions: [] },
            { index: 2, type: 'asset-clip', name: 'B', markers: [], captions: [] },
            { index: 3, type: 'title', name: 'C', markers: [], captions: [] }
          ],
          markers: []
        }
      }
      const writer = serializeFcpxmlTimelineIr({ ir: { projects: [ir] } })
      const reparsed = buildFcpxmlTimelineIr({ path: 'order.fcpxml', text: writer.text })
      const names = reparsed.projects[0].sequence?.spine.map((s) => s.name || s.type)
      expect(names).toEqual(['A', 'gap', 'B', 'C'])
    })

    it('emits a <media-rep> child for every asset (DTD requires media-rep+)', () => {
      // Phase K7 — the FCPXML DTD declares
      //   <!ELEMENT asset (media-rep+, metadata?)>
      // i.e. every asset MUST carry at least one media-rep. Earlier
      // emission put src directly on <asset> and emitted no children,
      // which xmllint rejected as DTD-invalid even though FCP's
      // tolerant parser accepted it. The new shape moves src into a
      // nested <media-rep src="..."/> per the spec.
      const writer = serializeFcpxmlTimelineIr({
        ir: {
          resources: {
            assets: [{ id: 'r1', name: 'B-roll', src: 'file:///x.mov' }]
          }
        }
      })
      // The asset element opens (no self-close) and the media-rep
      // child sits inside it.
      expect(writer.text).toMatch(/<asset[^/]+id="r1"[^>]*>\s*\n\s*<media-rep[^>]+src="file:\/\/\/x\.mov"\s*\/>\s*\n\s*<\/asset>/)
      // Round-trip: the IR parser pulls src from the media-rep child.
      const reparsed = buildFcpxmlTimelineIr({ path: 'mr.fcpxml', text: writer.text })
      expect(reparsed.resources.assets[0].src).toBe('file:///x.mov')
      expect(reparsed.resources.assets[0].mediaRepCount).toBe(1)
    })

    it('synthesises a placeholder media-rep src when the IR asset has none', () => {
      // K7 — assets without src still need a media-rep child to satisfy
      // the DTD. We fill a workspace-placeholder URL so the doc remains
      // structurally valid; FCP shows the clip as offline media until
      // the asset is pointed at a real file.
      const writer = serializeFcpxmlTimelineIr({
        ir: { resources: { assets: [{ id: 'r1', name: 'Pending shoot' }] } }
      })
      expect(writer.text).toMatch(/<media-rep[^>]+src="file:\/\/\/agbench-placeholder\//)
      expect(writer.warnings.some((w) => /no src/.test(w))).toBe(true)
    })

    it('synthesises an empty sequence + spine when a project has no sequence (DTD: project requires sequence)', () => {
      // The K3 failure mode that surfaced this whole hardening pass:
      // FCP rejected the import with "expecting (sequence), got ()"
      // because our project element was empty. Writer now fills a
      // minimum-valid sequence so the document loads instead of
      // failing at the DTD layer.
      const writer = serializeFcpxmlTimelineIr({
        ir: {
          resources: {
            formats: [{ id: 'r1', name: '1080p' }],
            assets: []
          },
          projects: [{ name: 'project-without-sequence' }]
        }
      })
      expect(writer.text).toMatch(/<sequence[^>]+format="r1"[^>]*>\s*\n\s*<spine\s*>\s*<\/spine>/)
      expect(writer.warnings.some((w) => /no sequence/.test(w))).toBe(true)
    })

    it('defaults sequence format ref to the first declared format when the IR omits it', () => {
      // DTD `%media_attrs;` declares `format` as #REQUIRED on
      // <sequence>. When the agent supplies a sequence but forgets
      // the format ref, fall back to the first format in resources
      // and warn so the agent learns.
      const writer = serializeFcpxmlTimelineIr({
        ir: {
          resources: {
            formats: [
              { id: 'r1', name: '1080p' },
              { id: 'r2', name: '4k' }
            ]
          },
          projects: [
            { name: 'p', sequence: { spine: [], markers: [] } }
          ]
        }
      })
      expect(writer.text).toMatch(/<sequence[^>]+format="r1"/)
      expect(writer.warnings.some((w) => /no format ref/.test(w))).toBe(true)
    })

    it('surfaces a warning when no <format> resources exist and sequence has no format ref', () => {
      // Worst case — no formats anywhere. We can't synthesise an
      // IDREF that points nowhere (xmllint will catch the dangling
      // ref) so we emit the sequence WITHOUT format attr and surface
      // a clear warning rather than producing a silently-invalid doc.
      const writer = serializeFcpxmlTimelineIr({
        ir: {
          resources: {},
          projects: [{ name: 'p', sequence: { spine: [], markers: [] } }]
        }
      })
      expect(writer.warnings.some((w) => /no <format> resources are declared/.test(w))).toBe(
        true
      )
    })

    it('warns when a spine item is missing duration (DTD #REQUIRED on gap)', () => {
      const writer = serializeFcpxmlTimelineIr({
        ir: {
          resources: { formats: [{ id: 'r1', name: '1080p' }] },
          projects: [
            {
              name: 'p',
              sequence: {
                spine: [
                  {
                    index: 0,
                    type: 'gap',
                    name: 'untimed',
                    markers: [],
                    captions: []
                  }
                ],
                markers: []
              }
            }
          ]
        }
      })
      expect(writer.warnings.some((w) => /no duration/.test(w))).toBe(true)
    })

    it('synthesises an event name for projects without one so the doc validates', () => {
      const writer = serializeFcpxmlTimelineIr({
        ir: { projects: [{ name: 'untagged', eventName: undefined, sequence: undefined }] }
      })
      // The fallback name lives between the <event name="..."> attribute quotes.
      expect(writer.text).toMatch(/<event name="AGBench Drafts">/)
    })
  })
})
