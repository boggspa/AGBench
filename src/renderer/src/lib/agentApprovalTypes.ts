import type { ProviderId } from '../../../main/store/types'

type AgentApprovalAction =
  | 'accept'
  | 'acceptForSession'
  | 'acceptForWorkspace'
  | 'decline'
  | 'cancel'
  | 'useProviderNative'
  | 'useAGBenchSubthread'
  // Slice 4 of the external-path-redesign arc. See the same union
  // in src/main/store/types.ts:84 — mirrored here because App.tsx
  // declares its own copy rather than importing the canonical
  // definition. A follow-up unification would import from types.ts.
  | 'grantExternalPathRead'
  | 'grantExternalPathEdit'
  | 'declineExternalPath'

interface AgentApprovalRequest {
  id: string
  provider: ProviderId
  appRunId?: string
  appChatId?: string
  method: string
  title: string
  body: string
  preview?: any
  actions: AgentApprovalAction[]
}

const isNativeSubAgentPreferenceApproval = (request: AgentApprovalRequest | null): boolean =>
  Boolean(
    request?.actions?.includes('useProviderNative') ||
    request?.actions?.includes('useAGBenchSubthread')
  )

export type { AgentApprovalAction, AgentApprovalRequest }
export { isNativeSubAgentPreferenceApproval }
