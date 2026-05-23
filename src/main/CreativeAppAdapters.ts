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

export interface CreativeAppProbeInput {
  appId?: CreativeAppId
  attachedWindow?: CreativeAttachedWindowMeta | null
  now?: string
  fileExists?: (path: string) => boolean
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
