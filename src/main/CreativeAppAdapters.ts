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
        summary: 'Use menu/control-surface actions only for approved import, export, transport, or bounce flows.'
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
        summary: 'Inspect objects, materials, nodes, collections, and render settings through Blender data APIs.'
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

export function buildCreativeAppStatusSnapshot(input: CreativeAppProbeInput = {}): CreativeAppStatusSnapshot {
  const generatedAt = input.now || new Date().toISOString()
  return {
    ok: true,
    generatedAt,
    appId: input.appId,
    apps: matchingDefinitions(input.appId).map((definition) => statusForDefinition(definition, input))
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

function matchingDefinitions(appId?: CreativeAppId): CreativeAppDefinition[] {
  return appId
    ? CREATIVE_APP_DEFINITIONS.filter((definition) => definition.id === appId)
    : CREATIVE_APP_DEFINITIONS
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
