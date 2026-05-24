/*
 * workspacePolicyServices.ts — the canonical list of agentic
 * services the user can pre-authorise on a per-workspace basis.
 *
 * Originally lived inside `WorkspaceAccessControls.tsx` next to the
 * Tool Grants pill. Lifted to a shared module so the new
 * CombinedPermissionsPicker (which now hosts the Tool Grants column)
 * can consume the same definitions without duplicating them.
 */

import type { AgenticServiceId } from '../../../main/store/types'

export interface WorkspacePolicyService {
  id: AgenticServiceId
  label: string
  help: string
}

export const WORKSPACE_POLICY_SERVICES: WorkspacePolicyService[] = [
  {
    id: 'shellCommands',
    label: 'Shell',
    help: 'Run shell commands without asking again when global policy is Workspace grant.'
  },
  {
    id: 'fileChanges',
    label: 'Edit files',
    help: 'Write or replace files without asking again when global policy is Workspace grant.'
  },
  {
    id: 'mcpTools',
    label: 'Read/search tools',
    help: 'Use MCP tools such as read/list/search without asking again when global policy is Workspace grant.'
  },
  {
    id: 'subThreadDelegation',
    label: 'Delegate',
    help: 'Spawn cross-provider sub-threads without asking again when global policy is Workspace grant.'
  }
]
