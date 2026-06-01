import type {
  ChatScope,
  EffectiveRunPermissions,
  EnsembleRunIdentity,
  ExternalPathGrant,
  GeminiWorktreeLaunchOption,
  ProviderId,
  RuntimeProfile
} from '../store/types'

// Phase B1: AgentRunPayload + AgentRunRoute exported so extracted run services
// can type their public surface without importing from main/index.ts.
export interface AgentRunRoute {
  appRunId?: string
  appChatId?: string
}

export interface AgentRunPayload {
  provider: ProviderId
  scope: ChatScope
  workspace?: string
  prompt: string
  appRunId?: string
  appChatId?: string
  model?: string
  reasoningEffort?: string | null
  serviceTier?: string | null
  claudeReasoningEffort?: string | null
  claudeFastMode?: boolean | null
  kimiThinking?: boolean | null
  approvalMode?: string
  imagePaths?: string[]
  providerSessionId?: string | null
  externalPathGrants?: ExternalPathGrant[]
  sessionTrust?: boolean
  geminiWorktree?: GeminiWorktreeLaunchOption
  runtimeProfileId?: string
  geminiAuthProfileId?: string | null
  handoffSourceRunId?: string
  runtimeProfile?: RuntimeProfile
  effectivePermissions?: EffectiveRunPermissions
  ensembleRun?: EnsembleRunIdentity
}
