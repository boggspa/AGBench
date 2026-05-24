import { describe, expect, it } from 'vitest'
import {
  filterComposerMentionCandidates,
  type ComposerMentionCandidate
} from './AgentMentionMenu'

const candidates: ComposerMentionCandidate[] = [
  {
    id: 'agent:1',
    kind: 'agent',
    agentId: '1',
    name: 'Builder',
    detail: 'Claude worker'
  },
  {
    id: 'workspace:src/renderer/App.tsx',
    kind: 'workspace-file',
    name: 'src/renderer/App.tsx',
    path: 'src/renderer/App.tsx',
    detail: 'Workspace file'
  },
  {
    id: 'external:/Users/me/Other Project',
    kind: 'external-grant',
    name: 'Other Project',
    path: '/Users/me/Other Project',
    detail: 'Editable external path',
    access: 'write'
  }
]

describe('filterComposerMentionCandidates', () => {
  it('matches agents, workspace file paths, and external grant paths', () => {
    expect(filterComposerMentionCandidates(candidates, 'build').map((item) => item.id)).toEqual([
      'agent:1'
    ])
    expect(filterComposerMentionCandidates(candidates, 'renderer/app').map((item) => item.id)).toEqual([
      'workspace:src/renderer/App.tsx'
    ])
    expect(filterComposerMentionCandidates(candidates, 'other project').map((item) => item.id)).toEqual([
      'external:/Users/me/Other Project'
    ])
  })
})
