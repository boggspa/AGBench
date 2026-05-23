export type CreativeAppId = 'final-cut-pro' | 'logic-pro' | 'blender'

export type CreativeAppTransport =
  | 'exchange-file'
  | 'workflow-extension'
  | 'apple-events'
  | 'drag-drop'
  | 'ax-ui'
  | 'screen-capture'
  | 'cli'
  | 'native-script'
  | 'live-addon'
  | 'core-midi'
  | 'control-surface'

export type CreativeRiskTier =
  | 'observe'
  | 'draft'
  | 'apply-to-copy'
  | 'live-control'
  | 'destructive-expensive'

export interface CreativeAttachedWindowMeta {
  windowID?: number
  title?: string
  bundleID?: string
  applicationName?: string
  pid?: number
}

export interface CreativeCapability {
  id: string
  label: string
  riskTier: CreativeRiskTier
  transports: CreativeAppTransport[]
  readOnly: boolean
  requiresApproval: boolean
  summary: string
}

export interface CreativeAppDefinition {
  id: CreativeAppId
  label: string
  bundleIds: string[]
  commonAppPaths: string[]
  projectExtensions: string[]
  transports: CreativeAppTransport[]
  capabilities: CreativeCapability[]
  prompts: string[]
  limitations: string[]
}

export interface CreativeAppStatus {
  id: CreativeAppId
  label: string
  bundleIds: string[]
  installedHint: boolean
  /**
   * True when at least one of the app's declared `bundleIds` is currently
   * running according to `NSRunningApplication`. Surfaced separately from
   * `installedHint` because the agent often needs both signals: an app
   * can be installed-but-quit (don't suggest sending it work yet) or
   * running-but-not-focused (probably fine to push an import to).
   *
   * `false` when the daemon isn't available — callers should treat
   * `installedHint=true && runningHint=false` as "installed; running
   * status unknown or quit" since the probe degrades gracefully.
   * Phase K1.
   */
  runningHint: boolean
  attached: boolean
  attachedWindow?: CreativeAttachedWindowMeta
  projectExtensions: string[]
  transports: CreativeAppTransport[]
  capabilityCount: number
  riskTiers: CreativeRiskTier[]
  limitations: string[]
}

export interface CreativeAppStatusSnapshot {
  ok: true
  generatedAt: string
  appId?: CreativeAppId
  apps: CreativeAppStatus[]
}

export interface CreativeAppCapabilitySnapshot {
  ok: true
  generatedAt: string
  appId?: CreativeAppId
  apps: Array<
    CreativeAppStatus & {
      capabilities: CreativeCapability[]
      prompts: string[]
    }
  >
}

export type CreativeProjectKind =
  | 'fcpxml'
  | 'final-cut-library'
  | 'final-cut-xml-bundle'
  | 'logic-package'
  | 'musicxml'
  | 'midi'
  | 'blender-binary'
  | 'blender-exchange'
  | 'unknown'

export interface CreativeProjectSnapshotInput {
  path: string
  extension?: string
  isDirectory: boolean
  sizeBytes?: number
  text?: string
  bytes?: Uint8Array
  now?: string
}

export interface CreativeProjectSnapshot {
  ok: true
  generatedAt: string
  path: string
  appId?: CreativeAppId
  kind: CreativeProjectKind
  readOnly: true
  transport: CreativeAppTransport
  summary: string
  sizeBytes?: number
  stats: Record<string, number | string | boolean>
  warnings: string[]
}

export type CreativeValidationSeverity = 'error' | 'warning' | 'info'

export interface CreativeValidationIssue {
  severity: CreativeValidationSeverity
  code: string
  message: string
  detail?: string
}

export interface FcpxmlValidationInput {
  path: string
  text: string
  truncated?: boolean
  now?: string
}

export interface FcpxmlValidationResult {
  ok: true
  generatedAt: string
  appId: 'final-cut-pro'
  path: string
  kind: 'fcpxml'
  readOnly: true
  validation: 'lightweight-fcpxml'
  valid: boolean
  version: string
  stats: Record<string, number | string | boolean>
  issueCounts: Record<CreativeValidationSeverity, number>
  issues: CreativeValidationIssue[]
}

export interface FcpxmlTimelineIrInput {
  path: string
  text: string
  truncated?: boolean
  now?: string
}

export interface FcpxmlResourceIr {
  id: string
  name?: string
  uid?: string
  src?: string
  duration?: string
  start?: string
  format?: string
  role?: string
  mediaRepCount?: number
}

export interface FcpxmlFormatIr {
  id: string
  name?: string
  width?: string
  height?: string
  frameDuration?: string
  colorSpace?: string
}

export interface FcpxmlEffectIr {
  id: string
  name?: string
  uid?: string
}

export interface FcpxmlTimelineMarkerIr {
  type: 'marker' | 'chapter-marker' | 'caption'
  value?: string
  start?: string
  duration?: string
  note?: string
  role?: string
}

export interface FcpxmlTimelineItemIr {
  index: number
  type: string
  name?: string
  ref?: string
  refName?: string
  offset?: string
  start?: string
  duration?: string
  lane?: string
  role?: string
  format?: string
  markers: FcpxmlTimelineMarkerIr[]
  captions: FcpxmlTimelineMarkerIr[]
}

export interface FcpxmlSequenceIr {
  name?: string
  duration?: string
  format?: string
  tcStart?: string
  tcFormat?: string
  spine: FcpxmlTimelineItemIr[]
  markers: FcpxmlTimelineMarkerIr[]
}

export interface FcpxmlProjectIr {
  name?: string
  eventName?: string
  sequence?: FcpxmlSequenceIr
}

export interface FcpxmlTimelineIr {
  ok: true
  generatedAt: string
  appId: 'final-cut-pro'
  path: string
  kind: 'fcpxml'
  readOnly: true
  ir: 'fcpxml-timeline-ir-v1'
  version: string
  resources: {
    assets: FcpxmlResourceIr[]
    formats: FcpxmlFormatIr[]
    effects: FcpxmlEffectIr[]
  }
  projects: FcpxmlProjectIr[]
  summary: Record<string, number | string | boolean>
  warnings: string[]
}

export interface FcpxmlTimelineDiffInput {
  beforePath: string
  beforeText: string
  afterPath: string
  afterText: string
  beforeTruncated?: boolean
  afterTruncated?: boolean
  now?: string
}

export interface FcpxmlTimelineDiffItemSummary {
  index: number
  type: string
  name?: string
  ref?: string
  refName?: string
  offset?: string
  start?: string
  duration?: string
  lane?: string
  role?: string
  format?: string
  markerCount: number
  captionCount: number
}

export interface FcpxmlTimelineChangedItemIr {
  index: number
  fields: string[]
  before: FcpxmlTimelineDiffItemSummary
  after: FcpxmlTimelineDiffItemSummary
}

export interface FcpxmlTimelineProjectDiffIr {
  index: number
  fields: string[]
  beforeName?: string
  afterName?: string
  eventName?: string
  addedItems: FcpxmlTimelineDiffItemSummary[]
  removedItems: FcpxmlTimelineDiffItemSummary[]
  changedItems: FcpxmlTimelineChangedItemIr[]
}

export interface FcpxmlTimelineAffectedResourceIr {
  id: string
  name?: string
  uid?: string
}

export interface FcpxmlTimelineDiffPlan {
  ok: true
  generatedAt: string
  appId: 'final-cut-pro'
  kind: 'fcpxml'
  readOnly: true
  diff: 'fcpxml-timeline-diff-v1'
  beforePath: string
  afterPath: string
  summary: Record<string, number | string | boolean>
  affectedResources: {
    assets: FcpxmlTimelineAffectedResourceIr[]
    effects: FcpxmlTimelineAffectedResourceIr[]
  }
  projects: FcpxmlTimelineProjectDiffIr[]
  sidecar: {
    schema: 'agbench-fcpxml-diff-plan-v1'
    recommendedPath: string
    document: Record<string, unknown>
  }
  warnings: string[]
}

export interface CreativeAppProbeInput {
  appId?: CreativeAppId
  attachedWindow?: CreativeAttachedWindowMeta | null
  now?: string
  fileExists?: (path: string) => boolean
  /**
   * Predicate that answers "is this bundle id currently running?" for a
   * given bundle id. Backed by the Swift daemon's
   * `creative.runningApplications` JSON-RPC method via
   * `NSRunningApplication.runningApplications(withBundleIdentifier:)`.
   * Omit when the probe is unavailable (no daemon) — `runningHint`
   * degrades to `false`. Phase K1.
   */
  runningHint?: (bundleId: string) => boolean
}

const CREATIVE_APP_DEFINITIONS: CreativeAppDefinition[] = [
  {
    id: 'final-cut-pro',
    label: 'Final Cut Pro',
    bundleIds: ['com.apple.FinalCut'],
    commonAppPaths: ['/Applications/Final Cut Pro.app'],
    projectExtensions: ['.fcpxml', '.fcpxmld', '.fcpbundle'],
    transports: [
      'exchange-file',
      'workflow-extension',
      'apple-events',
      'drag-drop',
      'ax-ui',
      'screen-capture'
    ],
    capabilities: [
      {
        id: 'fcpxml-timeline-snapshot',
        label: 'FCPXML timeline snapshot',
        riskTier: 'observe',
        transports: ['exchange-file'],
        readOnly: true,
        requiresApproval: false,
        summary: 'Parse exported FCPXML for clips, edit decisions, metadata, markers, and assets.'
      },
      {
        id: 'fcpxml-timeline-ir',
        label: 'FCPXML timeline IR',
        riskTier: 'observe',
        transports: ['exchange-file'],
        readOnly: true,
        requiresApproval: false,
        summary: 'Parse FCPXML into a compact timeline IR for diffing, draft plans, and preview UX.'
      },
      {
        id: 'fcpxml-diff-plan',
        label: 'FCPXML diff plan',
        riskTier: 'observe',
        transports: ['exchange-file'],
        readOnly: true,
        requiresApproval: false,
        summary:
          'Compare original and drafted FCPXML files into an approval-ready diff plan and JSON sidecar payload.'
      },
      {
        id: 'fcpxml-lightweight-validate',
        label: 'FCPXML lightweight validation',
        riskTier: 'draft',
        transports: ['exchange-file'],
        readOnly: true,
        requiresApproval: false,
        summary:
          'Check FCPXML root/version, duplicate ids, unresolved refs, and structural counts before import planning.'
      },
      {
        id: 'fcpxml-patch-plan',
        label: 'FCPXML patch plan',
        riskTier: 'draft',
        transports: ['exchange-file'],
        readOnly: false,
        requiresApproval: false,
        summary: 'Generate a proposed FCPXML patch or import bundle without touching Final Cut Pro.'
      },
      {
        id: 'fcpxml-approved-import',
        label: 'Approved FCPXML import',
        riskTier: 'live-control',
        transports: ['apple-events', 'drag-drop'],
        readOnly: false,
        requiresApproval: true,
        summary: 'Send a validated FCPXML document to Final Cut Pro only after user approval.'
      },
      {
        id: 'fcp-window-observe',
        label: 'Attached window observation',
        riskTier: 'observe',
        transports: ['screen-capture'],
        readOnly: true,
        requiresApproval: true,
        summary: 'Use the user-attached Final Cut Pro window for visual confirmation and OCR.'
      }
    ],
    prompts: ['shot_list_to_fcpxml', 'caption_timeline_from_srt', 'paper_edit_from_transcript'],
    limitations: [
      'No broad public live timeline mutation API is assumed.',
      'FCPXML import should target a scratch library or copy by default.',
      'Workflow extensions provide limited timeline/playhead awareness, not full headless editing.'
    ]
  },
  {
    id: 'logic-pro',
    label: 'Logic Pro',
    bundleIds: ['com.apple.logic10'],
    commonAppPaths: ['/Applications/Logic Pro.app'],
    projectExtensions: ['.logicx', '.mid', '.midi', '.musicxml', '.xml', '.aaf'],
    transports: [
      'exchange-file',
      'core-midi',
      'control-surface',
      'native-script',
      'ax-ui',
      'screen-capture'
    ],
    capabilities: [
      {
        id: 'logic-file-bridge',
        label: 'MIDI/MusicXML/audio file bridge',
        riskTier: 'draft',
        transports: ['exchange-file'],
        readOnly: false,
        requiresApproval: false,
        summary: 'Generate or parse MIDI, MusicXML, AAF/FCPXML, and stem bundles in the workspace.'
      },
      {
        id: 'logic-scripter-author',
        label: 'Scripter MIDI FX authoring',
        riskTier: 'draft',
        transports: ['native-script'],
        readOnly: false,
        requiresApproval: false,
        summary: 'Generate paste-ready Logic Scripter JavaScript with deterministic MIDI behavior.'
      },
      {
        id: 'logic-midi-audition',
        label: 'Virtual MIDI audition',
        riskTier: 'live-control',
        transports: ['core-midi'],
        readOnly: false,
        requiresApproval: true,
        summary: 'Send bounded MIDI notes or controller data to Logic Virtual In for auditioning.'
      },
      {
        id: 'logic-approved-ui-action',
        label: 'Approved Logic UI action',
        riskTier: 'live-control',
        transports: ['ax-ui', 'control-surface'],
        readOnly: false,
        requiresApproval: true,
        summary:
          'Use menu/control-surface actions only for approved import, export, transport, or bounce flows.'
      }
    ],
    prompts: ['soundtrack_spotting_notes', 'mix_notes_to_logic_regions'],
    limitations: [
      'Direct .logicx package mutation is not treated as a public API.',
      'Control-surface and Accessibility paths are fallback transports.',
      'Real-time Scripter or Audio Unit callbacks should stay deterministic and offline.'
    ]
  },
  {
    id: 'blender',
    label: 'Blender',
    bundleIds: ['org.blenderfoundation.blender'],
    commonAppPaths: ['/Applications/Blender.app'],
    projectExtensions: ['.blend', '.blend1', '.fbx', '.obj', '.gltf', '.glb'],
    transports: ['cli', 'native-script', 'live-addon', 'screen-capture'],
    capabilities: [
      {
        id: 'blender-scene-query',
        label: 'Scene graph query',
        riskTier: 'observe',
        transports: ['native-script', 'cli'],
        readOnly: true,
        requiresApproval: false,
        summary:
          'Inspect objects, materials, nodes, collections, and render settings through Blender data APIs.'
      },
      {
        id: 'blender-structured-scene-patch',
        label: 'Structured scene patch',
        riskTier: 'apply-to-copy',
        transports: ['native-script', 'cli', 'live-addon'],
        readOnly: false,
        requiresApproval: true,
        summary: 'Apply structured scene changes to a copy or approved live bridge session.'
      },
      {
        id: 'blender-render-preview',
        label: 'Render preview',
        riskTier: 'apply-to-copy',
        transports: ['cli', 'native-script'],
        readOnly: false,
        requiresApproval: true,
        summary: 'Run bounded preview renders and return artifacts to AGBench.'
      },
      {
        id: 'blender-generated-python',
        label: 'Generated Python execution',
        riskTier: 'destructive-expensive',
        transports: ['native-script', 'cli', 'live-addon'],
        readOnly: false,
        requiresApproval: true,
        summary: 'Execute generated Blender Python only after code preview and explicit approval.'
      }
    ],
    prompts: ['blender_scene_optimize', 'render_preview_and_review'],
    limitations: [
      'Blender Python is not sandboxed.',
      'Batch jobs should default to --disable-autoexec, --offline-mode, and workspace artifacts.',
      'Live bridge commands should be structured and token-authenticated.'
    ]
  }
]

const CREATIVE_APP_IDS = new Set(CREATIVE_APP_DEFINITIONS.map((definition) => definition.id))

export function isCreativeAppId(value: unknown): value is CreativeAppId {
  return typeof value === 'string' && CREATIVE_APP_IDS.has(value as CreativeAppId)
}

export function listCreativeAppDefinitions(): CreativeAppDefinition[] {
  return CREATIVE_APP_DEFINITIONS.map((definition) => cloneDefinition(definition))
}

/**
 * Flat de-duplicated list of every bundle id any creative-app definition
 * declares. Handy for the main-process running-app probe: it can fetch
 * the running-state of all bundle ids in a single JSON-RPC call to the
 * daemon, then hand the resulting map back through the `runningHint`
 * predicate. Phase K1.
 */
export function listCreativeAppBundleIds(): string[] {
  const set = new Set<string>()
  for (const definition of CREATIVE_APP_DEFINITIONS) {
    for (const bundleId of definition.bundleIds) set.add(bundleId)
  }
  return [...set]
}

export function buildCreativeAppStatusSnapshot(
  input: CreativeAppProbeInput = {}
): CreativeAppStatusSnapshot {
  const generatedAt = input.now || new Date().toISOString()
  return {
    ok: true,
    generatedAt,
    appId: input.appId,
    apps: matchingDefinitions(input.appId).map((definition) =>
      statusForDefinition(definition, input)
    )
  }
}

export function buildCreativeAppCapabilitySnapshot(
  input: CreativeAppProbeInput = {}
): CreativeAppCapabilitySnapshot {
  const generatedAt = input.now || new Date().toISOString()
  return {
    ok: true,
    generatedAt,
    appId: input.appId,
    apps: matchingDefinitions(input.appId).map((definition) => ({
      ...statusForDefinition(definition, input),
      capabilities: definition.capabilities.map((capability) => ({ ...capability })),
      prompts: [...definition.prompts]
    }))
  }
}

export function buildCreativeProjectSnapshot(
  input: CreativeProjectSnapshotInput
): CreativeProjectSnapshot {
  const generatedAt = input.now || new Date().toISOString()
  const extension = normalizeExtension(input.extension || extensionFromPath(input.path))
  const inferred = inferCreativeProjectKind(input, extension)
  const stats = buildProjectStats(inferred.kind, input)
  return {
    ok: true,
    generatedAt,
    path: input.path,
    appId: inferred.appId,
    kind: inferred.kind,
    readOnly: true,
    transport: inferred.transport,
    summary: inferred.summary,
    sizeBytes: input.sizeBytes,
    stats,
    warnings: buildProjectWarnings(inferred.kind, input)
  }
}

export function validateFcpxml(input: FcpxmlValidationInput): FcpxmlValidationResult {
  const generatedAt = input.now || new Date().toISOString()
  const text = input.text || ''
  const stats = buildProjectStats('fcpxml', { path: input.path, isDirectory: false, text })
  const issues: CreativeValidationIssue[] = []

  if (!text.trim()) {
    issues.push({
      severity: 'error',
      code: 'empty-document',
      message: 'FCPXML document is empty.'
    })
  }
  if (!textIncludes(text, '<fcpxml')) {
    issues.push({
      severity: 'error',
      code: 'missing-root',
      message: 'FCPXML document does not contain an <fcpxml> root element.'
    })
  }

  const version = typeof stats.version === 'string' ? stats.version : 'unknown'
  if (version === 'unknown') {
    issues.push({
      severity: 'warning',
      code: 'missing-version',
      message: 'FCPXML root has no detected version attribute.'
    })
  } else if (!/^\d+(\.\d+)?$/.test(version)) {
    issues.push({
      severity: 'warning',
      code: 'unexpected-version-format',
      message: `FCPXML version "${version}" does not look like a numeric version.`
    })
  }

  const ids = collectAttributeValues(text, 'id')
  const duplicateIds = duplicateValues(ids)
  for (const id of duplicateIds.slice(0, 20)) {
    issues.push({
      severity: 'error',
      code: 'duplicate-id',
      message: `Duplicate FCPXML id "${id}" detected.`
    })
  }
  if (duplicateIds.length > 20) {
    issues.push({
      severity: 'warning',
      code: 'duplicate-id-truncated',
      message: `${duplicateIds.length - 20} additional duplicate ids were omitted from this result.`
    })
  }

  const idSet = new Set(ids)
  const unresolvedRefs = collectAttributeValues(text, 'ref').filter((ref) => !idSet.has(ref))
  for (const ref of [...new Set(unresolvedRefs)].slice(0, 20)) {
    issues.push({
      severity: 'error',
      code: 'unresolved-ref',
      message: `Reference "${ref}" does not match any detected id.`
    })
  }
  if (unresolvedRefs.length > 20) {
    issues.push({
      severity: 'warning',
      code: 'unresolved-ref-truncated',
      message: `${unresolvedRefs.length - 20} additional unresolved refs were omitted from this result.`
    })
  }

  if (Number(stats.assets || 0) === 0) {
    issues.push({
      severity: 'info',
      code: 'no-assets',
      message: 'No <asset> entries were detected.'
    })
  }
  if (Number(stats.sequences || 0) === 0) {
    issues.push({
      severity: 'info',
      code: 'no-sequences',
      message: 'No <sequence> entries were detected.'
    })
  }
  if (input.truncated) {
    issues.push({
      severity: 'warning',
      code: 'document-truncated',
      message: 'Only the initial portion of this FCPXML document was validated.',
      detail: 'Increase the snapshot limit or validate the file externally before importing.'
    })
  }

  return {
    ok: true,
    generatedAt,
    appId: 'final-cut-pro',
    path: input.path,
    kind: 'fcpxml',
    readOnly: true,
    validation: 'lightweight-fcpxml',
    valid: !issues.some((issue) => issue.severity === 'error'),
    version,
    stats,
    issueCounts: countIssuesBySeverity(issues),
    issues
  }
}

export function buildFcpxmlTimelineIr(input: FcpxmlTimelineIrInput): FcpxmlTimelineIr {
  const generatedAt = input.now || new Date().toISOString()
  const text = input.text || ''
  const stats = buildProjectStats('fcpxml', { path: input.path, isDirectory: false, text })
  const document = parseXmlDocument(text)
  const fcpxml = firstDescendant(document, 'fcpxml')
  const warnings: string[] = []
  if (!fcpxml) {
    warnings.push('No <fcpxml> root element was found; timeline IR may be empty.')
  }
  if (input.truncated) {
    warnings.push('Only the initial portion of this FCPXML document was parsed into timeline IR.')
  }

  const assets = descendants(document, 'asset').map(assetToIr)
  const assetNameById = new Map(
    assets.map((asset) => [asset.id, asset.name || asset.uid || asset.id])
  )
  const formats = descendants(document, 'format').map(formatToIr)
  const effects = descendants(document, 'effect').map(effectToIr)
  const effectNameById = new Map(
    effects.map((effect) => [effect.id, effect.name || effect.uid || effect.id])
  )

  const projects = descendants(document, 'project').map((project) => {
    const sequence = firstChild(project, 'sequence') || firstDescendant(project, 'sequence')
    return {
      name: project.attrs.name,
      eventName: nearestAncestorName(project, 'event'),
      sequence: sequence ? sequenceToIr(sequence, assetNameById, effectNameById) : undefined
    }
  })

  if (projects.length === 0) {
    warnings.push('No <project> entries were detected.')
  }

  const clipCount = projects.reduce(
    (count, project) => count + (project.sequence?.spine.length || 0),
    0
  )
  const markerCount = projects.reduce(
    (count, project) => count + (project.sequence?.markers.length || 0),
    0
  )

  return {
    ok: true,
    generatedAt,
    appId: 'final-cut-pro',
    path: input.path,
    kind: 'fcpxml',
    readOnly: true,
    ir: 'fcpxml-timeline-ir-v1',
    version: typeof stats.version === 'string' ? stats.version : 'unknown',
    resources: { assets, formats, effects },
    projects,
    summary: {
      projectCount: projects.length,
      sequenceCount: projects.filter((project) => project.sequence).length,
      assetCount: assets.length,
      formatCount: formats.length,
      effectCount: effects.length,
      timelineItemCount: clipCount,
      markerCount,
      truncated: Boolean(input.truncated)
    },
    warnings
  }
}

export function buildFcpxmlTimelineDiffPlan(
  input: FcpxmlTimelineDiffInput
): FcpxmlTimelineDiffPlan {
  const generatedAt = input.now || new Date().toISOString()
  const before = buildFcpxmlTimelineIr({
    path: input.beforePath,
    text: input.beforeText,
    truncated: input.beforeTruncated,
    now: generatedAt
  })
  const after = buildFcpxmlTimelineIr({
    path: input.afterPath,
    text: input.afterText,
    truncated: input.afterTruncated,
    now: generatedAt
  })
  const projects = diffTimelineProjects(before, after)
  const affectedResources = collectAffectedResources(before, after, projects)
  const addedItemCount = projects.reduce((count, project) => count + project.addedItems.length, 0)
  const removedItemCount = projects.reduce(
    (count, project) => count + project.removedItems.length,
    0
  )
  const changedItemCount = projects.reduce(
    (count, project) => count + project.changedItems.length,
    0
  )
  const warnings = [
    ...before.warnings.map((warning) => `Before: ${warning}`),
    ...after.warnings.map((warning) => `After: ${warning}`)
  ]
  const summary: Record<string, number | string | boolean> = {
    projectCountBefore: before.projects.length,
    projectCountAfter: after.projects.length,
    addedItemCount,
    removedItemCount,
    changedItemCount,
    affectedAssetCount: affectedResources.assets.length,
    affectedEffectCount: affectedResources.effects.length,
    beforeTruncated: Boolean(input.beforeTruncated),
    afterTruncated: Boolean(input.afterTruncated)
  }
  const sidecarDocument = {
    schema: 'agbench-fcpxml-diff-plan-v1',
    generatedAt,
    appId: 'final-cut-pro',
    kind: 'fcpxml',
    beforePath: input.beforePath,
    afterPath: input.afterPath,
    summary,
    affectedResources,
    projects,
    warnings
  }

  return {
    ok: true,
    generatedAt,
    appId: 'final-cut-pro',
    kind: 'fcpxml',
    readOnly: true,
    diff: 'fcpxml-timeline-diff-v1',
    beforePath: input.beforePath,
    afterPath: input.afterPath,
    summary,
    affectedResources,
    projects,
    sidecar: {
      schema: 'agbench-fcpxml-diff-plan-v1',
      recommendedPath: recommendedTimelineSidecarPath(input.afterPath),
      document: sidecarDocument
    },
    warnings
  }
}

function matchingDefinitions(appId?: CreativeAppId): CreativeAppDefinition[] {
  return appId
    ? CREATIVE_APP_DEFINITIONS.filter((definition) => definition.id === appId)
    : CREATIVE_APP_DEFINITIONS
}

function inferCreativeProjectKind(
  input: CreativeProjectSnapshotInput,
  extension: string
): {
  appId?: CreativeAppId
  kind: CreativeProjectKind
  transport: CreativeAppTransport
  summary: string
} {
  if (input.isDirectory) {
    if (extension === '.fcpbundle') {
      return {
        appId: 'final-cut-pro',
        kind: 'final-cut-library',
        transport: 'exchange-file',
        summary:
          'Final Cut Pro library package; package contents are not inspected by this read-only snapshot.'
      }
    }
    if (extension === '.fcpxmld') {
      return {
        appId: 'final-cut-pro',
        kind: 'final-cut-xml-bundle',
        transport: 'exchange-file',
        summary:
          'Final Cut Pro XML bundle; bundle contents are not inspected by this read-only snapshot.'
      }
    }
    if (extension === '.logicx') {
      return {
        appId: 'logic-pro',
        kind: 'logic-package',
        transport: 'exchange-file',
        summary:
          'Logic Pro project package; package contents are not treated as a public project API.'
      }
    }
  }

  if (extension === '.fcpxml' || textIncludes(input.text, '<fcpxml')) {
    return {
      appId: 'final-cut-pro',
      kind: 'fcpxml',
      transport: 'exchange-file',
      summary: 'Final Cut Pro XML interchange document.'
    }
  }
  if (extension === '.musicxml' || textIncludes(input.text, '<score-partwise')) {
    return {
      appId: 'logic-pro',
      kind: 'musicxml',
      transport: 'exchange-file',
      summary: 'MusicXML score interchange document suitable for Logic Pro file workflows.'
    }
  }
  if (extension === '.mid' || extension === '.midi' || startsWithAscii(input.bytes, 'MThd')) {
    return {
      appId: 'logic-pro',
      kind: 'midi',
      transport: 'exchange-file',
      summary: 'Standard MIDI file for Logic Pro import or audition workflows.'
    }
  }
  if (
    extension === '.blend' ||
    extension === '.blend1' ||
    startsWithAscii(input.bytes, 'BLENDER')
  ) {
    return {
      appId: 'blender',
      kind: 'blender-binary',
      transport: 'cli',
      summary:
        'Blender binary project; deep scene inspection requires a Blender batch or live bridge.'
    }
  }
  if (
    extension === '.fbx' ||
    extension === '.obj' ||
    extension === '.gltf' ||
    extension === '.glb'
  ) {
    return {
      appId: 'blender',
      kind: 'blender-exchange',
      transport: 'exchange-file',
      summary: 'Blender-compatible asset exchange file.'
    }
  }
  return {
    kind: 'unknown',
    transport: 'exchange-file',
    summary: 'Creative project type is not recognized by the current adapter registry.'
  }
}

function buildProjectStats(
  kind: CreativeProjectKind,
  input: CreativeProjectSnapshotInput
): Record<string, number | string | boolean> {
  if (kind === 'fcpxml') {
    const text = input.text || ''
    return {
      version: firstAttribute(text, 'fcpxml', 'version') || 'unknown',
      libraries: countTag(text, 'library'),
      events: countTag(text, 'event'),
      projects: countTag(text, 'project'),
      sequences: countTag(text, 'sequence'),
      assets: countTag(text, 'asset'),
      clips: countAnyTag(text, ['clip', 'asset-clip', 'sync-clip', 'mc-clip']),
      markers: countTag(text, 'marker'),
      captions: countTag(text, 'caption'),
      effects: countTag(text, 'effect')
    }
  }
  if (kind === 'musicxml') {
    const text = input.text || ''
    return {
      title: tagText(text, 'work-title') || tagText(text, 'movement-title') || 'unknown',
      parts: countTag(text, 'part'),
      measures: countTag(text, 'measure'),
      notes: countTag(text, 'note'),
      harmonies: countTag(text, 'harmony')
    }
  }
  if (kind === 'midi') {
    return midiStats(input.bytes)
  }
  if (kind === 'blender-binary') {
    return blenderStats(input.bytes)
  }
  return {
    directory: input.isDirectory
  }
}

function buildProjectWarnings(
  kind: CreativeProjectKind,
  input: CreativeProjectSnapshotInput
): string[] {
  const warnings: string[] = []
  if (input.text === undefined && (kind === 'fcpxml' || kind === 'musicxml')) {
    warnings.push('Text content was not loaded, so XML element counts are unavailable.')
  }
  if (kind === 'final-cut-library') {
    warnings.push('AGBench does not inspect or mutate .fcpbundle internals in this snapshot.')
  }
  if (kind === 'logic-package') {
    warnings.push(
      'AGBench does not inspect or mutate .logicx internals because they are not a public project API.'
    )
  }
  if (kind === 'blender-binary') {
    warnings.push(
      'Use a future Blender batch/live adapter for authoritative scene graph inspection.'
    )
  }
  if (kind === 'unknown') {
    warnings.push('No adapter-specific parser matched this path.')
  }
  return warnings
}

function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('.') || !trimmed ? trimmed : `.${trimmed}`
}

function extensionFromPath(path: string): string {
  const name = path.split(/[\\/]/).pop() || ''
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index) : ''
}

function textIncludes(text: string | undefined, needle: string): boolean {
  return Boolean(text && text.toLowerCase().includes(needle.toLowerCase()))
}

function startsWithAscii(bytes: Uint8Array | undefined, prefix: string): boolean {
  if (!bytes || bytes.length < prefix.length) return false
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix.charCodeAt(index)) return false
  }
  return true
}

function countTag(text: string, tagName: string): number {
  return countAnyTag(text, [tagName])
}

function countAnyTag(text: string, tagNames: string[]): number {
  if (!text) return 0
  return tagNames.reduce((count, tagName) => {
    const pattern = new RegExp(`<${tagName}(\\s|>|/)`, 'gi')
    return count + (text.match(pattern)?.length || 0)
  }, 0)
}

function firstAttribute(text: string, tagName: string, attributeName: string): string | undefined {
  const pattern = new RegExp(`<${tagName}\\b[^>]*\\s${attributeName}=["']([^"']+)["']`, 'i')
  return text.match(pattern)?.[1]
}

function tagText(text: string, tagName: string): string | undefined {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([^<]{1,200})</${tagName}>`, 'i')
  return text.match(pattern)?.[1]?.trim()
}

function collectAttributeValues(text: string, attributeName: string): string[] {
  if (!text) return []
  const pattern = new RegExp(`\\s${attributeName}=["']([^"']+)["']`, 'gi')
  const values: string[] = []
  for (const match of text.matchAll(pattern)) {
    if (match[1]) values.push(match[1])
  }
  return values
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
    } else {
      seen.add(value)
    }
  }
  return [...duplicates]
}

function countIssuesBySeverity(
  issues: CreativeValidationIssue[]
): Record<CreativeValidationSeverity, number> {
  return {
    error: issues.filter((issue) => issue.severity === 'error').length,
    warning: issues.filter((issue) => issue.severity === 'warning').length,
    info: issues.filter((issue) => issue.severity === 'info').length
  }
}

interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  parent?: XmlNode
}

function parseXmlDocument(text: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [] }
  const stack: XmlNode[] = [root]
  const tagPattern = /<([^!?][^>]*)>/g
  for (const match of text.matchAll(tagPattern)) {
    const raw = match[1]?.trim() || ''
    if (!raw || raw.startsWith('!--')) continue
    if (raw.startsWith('/')) {
      const closingName = raw.slice(1).trim().split(/\s+/)[0]
      while (stack.length > 1) {
        const current = stack.pop()
        if (current?.name === closingName) break
      }
      continue
    }
    const selfClosing = raw.endsWith('/')
    const body = selfClosing ? raw.slice(0, -1).trim() : raw
    const name = body.split(/\s+/)[0]
    if (!name) continue
    const node: XmlNode = {
      name,
      attrs: parseXmlAttributes(body.slice(name.length)),
      children: [],
      parent: stack[stack.length - 1]
    }
    stack[stack.length - 1].children.push(node)
    if (!selfClosing) stack.push(node)
  }
  return root
}

function parseXmlAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1]
    const value = match[3] ?? match[4] ?? ''
    attrs[name] = decodeXmlAttribute(value)
  }
  return attrs
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function firstDescendant(node: XmlNode, name: string): XmlNode | undefined {
  return descendants(node, name)[0]
}

function descendants(node: XmlNode, name: string): XmlNode[] {
  const matches: XmlNode[] = []
  for (const child of node.children) {
    if (child.name === name) matches.push(child)
    matches.push(...descendants(child, name))
  }
  return matches
}

function firstChild(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((child) => child.name === name)
}

function nearestAncestorName(node: XmlNode, ancestorName: string): string | undefined {
  let current = node.parent
  while (current) {
    if (current.name === ancestorName) return current.attrs.name
    current = current.parent
  }
  return undefined
}

function assetToIr(node: XmlNode): FcpxmlResourceIr {
  return {
    id: node.attrs.id || '',
    name: node.attrs.name,
    uid: node.attrs.uid,
    src: node.attrs.src,
    duration: node.attrs.duration,
    start: node.attrs.start,
    format: node.attrs.format,
    role: node.attrs.role,
    mediaRepCount: descendants(node, 'media-rep').length
  }
}

function formatToIr(node: XmlNode): FcpxmlFormatIr {
  return {
    id: node.attrs.id || '',
    name: node.attrs.name,
    width: node.attrs.width,
    height: node.attrs.height,
    frameDuration: node.attrs.frameDuration,
    colorSpace: node.attrs.colorSpace
  }
}

function effectToIr(node: XmlNode): FcpxmlEffectIr {
  return {
    id: node.attrs.id || '',
    name: node.attrs.name,
    uid: node.attrs.uid
  }
}

function sequenceToIr(
  node: XmlNode,
  assetNameById: Map<string, string>,
  effectNameById: Map<string, string>
): FcpxmlSequenceIr {
  const spine = firstChild(node, 'spine')
  const spineItems = spine
    ? spine.children
        .filter((child) => isTimelineItemNode(child.name))
        .map((child, index) => timelineItemToIr(child, index, assetNameById, effectNameById))
    : []
  return {
    name: node.attrs.name,
    duration: node.attrs.duration,
    format: node.attrs.format,
    tcStart: node.attrs.tcStart,
    tcFormat: node.attrs.tcFormat,
    spine: spineItems,
    markers: collectTimelineMarkers(node)
  }
}

function timelineItemToIr(
  node: XmlNode,
  index: number,
  assetNameById: Map<string, string>,
  effectNameById: Map<string, string>
): FcpxmlTimelineItemIr {
  const ref = node.attrs.ref
  return {
    index,
    type: node.name,
    name: node.attrs.name,
    ref,
    refName: ref ? assetNameById.get(ref) || effectNameById.get(ref) : undefined,
    offset: node.attrs.offset,
    start: node.attrs.start,
    duration: node.attrs.duration,
    lane: node.attrs.lane,
    role: node.attrs.role,
    format: node.attrs.format,
    markers: collectTimelineMarkers(node).filter((marker) => marker.type !== 'caption'),
    captions: collectTimelineMarkers(node).filter((marker) => marker.type === 'caption')
  }
}

function isTimelineItemNode(name: string): boolean {
  return [
    'asset-clip',
    'clip',
    'sync-clip',
    'mc-clip',
    'ref-clip',
    'gap',
    'title',
    'generator',
    'transition'
  ].includes(name)
}

function collectTimelineMarkers(node: XmlNode): FcpxmlTimelineMarkerIr[] {
  return [
    ...descendants(node, 'marker').map((marker) => markerToIr(marker, 'marker')),
    ...descendants(node, 'chapter-marker').map((marker) => markerToIr(marker, 'chapter-marker')),
    ...descendants(node, 'caption').map((marker) => markerToIr(marker, 'caption'))
  ]
}

function markerToIr(node: XmlNode, type: FcpxmlTimelineMarkerIr['type']): FcpxmlTimelineMarkerIr {
  return {
    type,
    value: node.attrs.value,
    start: node.attrs.start,
    duration: node.attrs.duration,
    note: node.attrs.note,
    role: node.attrs.role
  }
}

const TIMELINE_DIFF_FIELDS: Array<keyof FcpxmlTimelineDiffItemSummary> = [
  'type',
  'name',
  'ref',
  'refName',
  'offset',
  'start',
  'duration',
  'lane',
  'role',
  'format',
  'markerCount',
  'captionCount'
]

function diffTimelineProjects(
  before: FcpxmlTimelineIr,
  after: FcpxmlTimelineIr
): FcpxmlTimelineProjectDiffIr[] {
  const count = Math.max(before.projects.length, after.projects.length)
  const projects: FcpxmlTimelineProjectDiffIr[] = []
  for (let index = 0; index < count; index++) {
    const beforeProject = before.projects[index]
    const afterProject = after.projects[index]
    const projectDiff = diffTimelineProject(index, beforeProject, afterProject)
    if (
      projectDiff.fields.length > 0 ||
      projectDiff.addedItems.length > 0 ||
      projectDiff.removedItems.length > 0 ||
      projectDiff.changedItems.length > 0
    ) {
      projects.push(projectDiff)
    }
  }
  return projects
}

function diffTimelineProject(
  index: number,
  beforeProject: FcpxmlProjectIr | undefined,
  afterProject: FcpxmlProjectIr | undefined
): FcpxmlTimelineProjectDiffIr {
  const beforeItems = beforeProject?.sequence?.spine || []
  const afterItems = afterProject?.sequence?.spine || []
  const count = Math.max(beforeItems.length, afterItems.length)
  const addedItems: FcpxmlTimelineDiffItemSummary[] = []
  const removedItems: FcpxmlTimelineDiffItemSummary[] = []
  const changedItems: FcpxmlTimelineChangedItemIr[] = []

  for (let itemIndex = 0; itemIndex < count; itemIndex++) {
    const beforeItem = beforeItems[itemIndex]
    const afterItem = afterItems[itemIndex]
    if (!beforeItem && afterItem) {
      addedItems.push(summarizeTimelineItem(afterItem))
      continue
    }
    if (beforeItem && !afterItem) {
      removedItems.push(summarizeTimelineItem(beforeItem))
      continue
    }
    if (!beforeItem || !afterItem) continue
    const beforeSummary = summarizeTimelineItem(beforeItem)
    const afterSummary = summarizeTimelineItem(afterItem)
    const fields = changedTimelineFields(beforeSummary, afterSummary)
    if (fields.length > 0) {
      changedItems.push({
        index: itemIndex,
        fields,
        before: beforeSummary,
        after: afterSummary
      })
    }
  }

  return {
    index,
    fields: changedProjectFields(beforeProject, afterProject),
    beforeName: beforeProject?.name,
    afterName: afterProject?.name,
    eventName: afterProject?.eventName || beforeProject?.eventName,
    addedItems,
    removedItems,
    changedItems
  }
}

function changedProjectFields(
  beforeProject: FcpxmlProjectIr | undefined,
  afterProject: FcpxmlProjectIr | undefined
): string[] {
  const beforeSequence = beforeProject?.sequence
  const afterSequence = afterProject?.sequence
  const pairs: Array<[string, string | undefined, string | undefined]> = [
    ['project.name', beforeProject?.name, afterProject?.name],
    ['event.name', beforeProject?.eventName, afterProject?.eventName],
    ['sequence.duration', beforeSequence?.duration, afterSequence?.duration],
    ['sequence.format', beforeSequence?.format, afterSequence?.format],
    ['sequence.tcStart', beforeSequence?.tcStart, afterSequence?.tcStart],
    ['sequence.tcFormat', beforeSequence?.tcFormat, afterSequence?.tcFormat]
  ]
  return pairs.filter(([, before, after]) => before !== after).map(([field]) => field)
}

function summarizeTimelineItem(item: FcpxmlTimelineItemIr): FcpxmlTimelineDiffItemSummary {
  return {
    index: item.index,
    type: item.type,
    name: item.name,
    ref: item.ref,
    refName: item.refName,
    offset: item.offset,
    start: item.start,
    duration: item.duration,
    lane: item.lane,
    role: item.role,
    format: item.format,
    markerCount: item.markers.length,
    captionCount: item.captions.length
  }
}

function changedTimelineFields(
  before: FcpxmlTimelineDiffItemSummary,
  after: FcpxmlTimelineDiffItemSummary
): string[] {
  return TIMELINE_DIFF_FIELDS.filter((field) => before[field] !== after[field]).map(String)
}

function collectAffectedResources(
  before: FcpxmlTimelineIr,
  after: FcpxmlTimelineIr,
  projects: FcpxmlTimelineProjectDiffIr[]
): FcpxmlTimelineDiffPlan['affectedResources'] {
  const assetsById = new Map<string, FcpxmlTimelineAffectedResourceIr>()
  const effectsById = new Map<string, FcpxmlTimelineAffectedResourceIr>()
  for (const ir of [before, after]) {
    for (const asset of ir.resources.assets) {
      assetsById.set(asset.id, { id: asset.id, name: asset.name, uid: asset.uid })
    }
    for (const effect of ir.resources.effects) {
      effectsById.set(effect.id, { id: effect.id, name: effect.name, uid: effect.uid })
    }
  }

  const affectedAssetIds = new Set<string>()
  const affectedEffectIds = new Set<string>()
  for (const project of projects) {
    const summaries = [
      ...project.addedItems,
      ...project.removedItems,
      ...project.changedItems.flatMap((item) => [item.before, item.after])
    ]
    for (const summary of summaries) {
      if (!summary.ref) continue
      if (assetsById.has(summary.ref)) affectedAssetIds.add(summary.ref)
      if (effectsById.has(summary.ref)) affectedEffectIds.add(summary.ref)
    }
  }

  return {
    assets: affectedResourceList(affectedAssetIds, assetsById),
    effects: affectedResourceList(affectedEffectIds, effectsById)
  }
}

function affectedResourceList(
  ids: Set<string>,
  resourcesById: Map<string, FcpxmlTimelineAffectedResourceIr>
): FcpxmlTimelineAffectedResourceIr[] {
  return [...ids]
    .map((id) => resourcesById.get(id) || { id })
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id))
}

function recommendedTimelineSidecarPath(path: string): string {
  return `${path}.agbench-timeline-diff.json`
}

function readUint16BE(bytes: Uint8Array, offset: number): number | undefined {
  if (bytes.length < offset + 2) return undefined
  return bytes[offset] * 256 + bytes[offset + 1]
}

function midiStats(bytes: Uint8Array | undefined): Record<string, number | string | boolean> {
  if (!startsWithAscii(bytes, 'MThd') || !bytes) {
    return { validHeader: false }
  }
  return {
    validHeader: true,
    format: readUint16BE(bytes, 8) ?? 'unknown',
    tracks: readUint16BE(bytes, 10) ?? 'unknown',
    division: readUint16BE(bytes, 12) ?? 'unknown'
  }
}

function blenderStats(bytes: Uint8Array | undefined): Record<string, number | string | boolean> {
  if (!startsWithAscii(bytes, 'BLENDER') || !bytes) {
    return { validHeader: false }
  }
  return {
    validHeader: true,
    pointerSize: bytes[7] === 45 ? 8 : bytes[7] === 95 ? 4 : 'unknown',
    endian: bytes[8] === 118 ? 'little' : bytes[8] === 86 ? 'big' : 'unknown',
    version: bytes.length >= 12 ? asciiSlice(bytes, 9, 12) : 'unknown'
  }
}

function asciiSlice(bytes: Uint8Array, start: number, end: number): string {
  return Array.from(bytes.slice(start, end))
    .map((byte) => String.fromCharCode(byte))
    .join('')
}

function statusForDefinition(
  definition: CreativeAppDefinition,
  input: CreativeAppProbeInput
): CreativeAppStatus {
  const attachedWindow =
    input.attachedWindow && windowMatchesDefinition(input.attachedWindow, definition)
      ? input.attachedWindow
      : undefined
  return {
    id: definition.id,
    label: definition.label,
    bundleIds: [...definition.bundleIds],
    installedHint: definition.commonAppPaths.some((path) => input.fileExists?.(path) === true),
    // K1 — true when any of the app's declared bundle IDs reports
    // as running via the daemon probe. `.some()` because some apps
    // ship multiple bundle IDs across versions (Logic Pro X vs
    // newer SKU, etc.) and we count any match as "running".
    runningHint: definition.bundleIds.some((id) => input.runningHint?.(id) === true),
    attached: Boolean(attachedWindow),
    attachedWindow,
    projectExtensions: [...definition.projectExtensions],
    transports: [...definition.transports],
    capabilityCount: definition.capabilities.length,
    riskTiers: [...new Set(definition.capabilities.map((capability) => capability.riskTier))],
    limitations: [...definition.limitations]
  }
}

function windowMatchesDefinition(
  windowMeta: CreativeAttachedWindowMeta,
  definition: CreativeAppDefinition
): boolean {
  if (windowMeta.bundleID && definition.bundleIds.includes(windowMeta.bundleID)) {
    return true
  }
  const applicationName = windowMeta.applicationName?.toLowerCase() || ''
  return Boolean(applicationName && definition.label.toLowerCase().includes(applicationName))
}

function cloneDefinition(definition: CreativeAppDefinition): CreativeAppDefinition {
  return {
    ...definition,
    bundleIds: [...definition.bundleIds],
    commonAppPaths: [...definition.commonAppPaths],
    projectExtensions: [...definition.projectExtensions],
    transports: [...definition.transports],
    capabilities: definition.capabilities.map((capability) => ({ ...capability })),
    prompts: [...definition.prompts],
    limitations: [...definition.limitations]
  }
}
