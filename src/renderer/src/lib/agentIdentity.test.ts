import { describe, expect, it } from 'vitest'
import type { ChatRecord, ChildAgentThread } from '../../../main/store/types'
import { AGENT_NAME_POOL, assignAgentIdentity } from './agentIdentity'

function makeChat(overrides: Partial<ChatRecord> = {}): ChatRecord {
  return {
    appChatId: 'chat-agent-identity',
    scope: 'workspace',
    provider: 'claude',
    title: 'Agent identities',
    workspaceId: 'ws-1',
    workspacePath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [],
    runs: [],
    ...overrides
  }
}

function makeThread(overrides: Partial<ChildAgentThread> = {}): ChildAgentThread {
  return {
    id: 'task-1',
    provider: 'claude',
    kind: 'claude-task',
    interactivity: 'oneshot',
    name: 'Task #1',
    state: 'running',
    toolActivityIds: ['task-1'],
    ...overrides
  }
}

describe('AGENT_NAME_POOL', () => {
  it('uses the bespoke nickname pool for fallback subagent identities', () => {
    expect(AGENT_NAME_POOL).toEqual([
      'Donny-Davis',
      'Harmonium',
      'Jenkinz',
      'Dexterman',
      'Croxley-Marvin',
      'Wendens-Ambo',
      'Georgioni',
      'Teleminster',
      'Korbis',
      'Wellson',
      'Baxter-Ravens',
      'Brian Brian Brian',
      'Imhotep',
      'Hubert Cumberdale',
      'Phobos',
      'Deimos',
      'Dogsbody',
      'Roboteknik',
      'Zandar',
      'Serafin',
      'Orzwald',
      'Channing',
      'Tobus Maximus',
      'Arxfold',
      'Persia',
      'Jakker',
      'Hilbert',
      'Dufus',
      'Sicklemas',
      'Frankenborg',
      'Chaxim',
      'Tre Solomon',
      'Eloque',
      'Xarxes',
      'Julio',
      'Jeremy Patchman',
      'Malek Malloc',
      'Tommy Tipper',
      'Jim The Mage',
      'Kevin The Karate King',
      'Master Maxwell',
      'Dorribald',
      'Marsham',
      'Yorris',
      'Bennison',
      'La Li Lu Le Lo',
      'Nish',
      'Ozbern',
      'Pendris',
      'Quendrew',
      'Roobis',
      'Uno',
      'Volkarr',
      'Yoodoo'
    ])
  })
})

describe('assignAgentIdentity', () => {
  it('assigns generated slug and accent metadata for bespoke pool names', () => {
    const chat = makeChat()
    const identity = assignAgentIdentity(chat, makeThread())

    expect(identity).toMatchObject({
      agentId: 'task-1',
      name: 'Donny-Davis',
      color: '#DD3E2C',
      slug: 'donny-davis',
      accent: '#DD3E2C',
      source: 'pool'
    })
  })

  it('enriches existing persisted identities with generated icon metadata', () => {
    const chat = makeChat({
      providerMetadata: {
        agentIdentities: {
          'task-1': {
            agentId: 'task-1',
            name: 'Harmonium',
            color: '#ff5f5f',
            source: 'pool',
            assignedAt: '2026-05-31T00:00:00.000Z'
          }
        }
      }
    })
    const identity = assignAgentIdentity(chat, makeThread())
    const metadata = chat.providerMetadata as {
      agentIdentities?: Record<string, { accent?: string; color?: string; slug?: string }>
    }

    expect(identity).toMatchObject({
      name: 'Harmonium',
      color: '#2CDD88',
      slug: 'harmonium',
      accent: '#2CDD88'
    })
    expect(metadata.agentIdentities?.['task-1']).toMatchObject({
      color: '#2CDD88',
      slug: 'harmonium',
      accent: '#2CDD88'
    })
  })
})
