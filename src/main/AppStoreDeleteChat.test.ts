import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import { join } from 'path'
import { AppStore } from './store'
import type { ChatRecord, ChatRun } from './store/types'

const userDataPath = vi.hoisted(() => `/tmp/taskwraith-delete-chat-test-${process.pid}`)

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataPath
  }
}))

const runEventPath = (runId: string): string => join(userDataPath, 'run-events', `${runId}.jsonl`)
const artifactDir = (runId: string): string => join(userDataPath, 'run-artifacts', runId)

function makeRun(runId: string): ChatRun {
  return { runId, startedAt: '2026-05-08T00:00:00.000Z' }
}

function seedRunFiles(runId: string): void {
  fs.mkdirSync(join(userDataPath, 'run-events'), { recursive: true })
  fs.writeFileSync(runEventPath(runId), `{"runId":"${runId}"}\n`, 'utf8')
  fs.mkdirSync(artifactDir(runId), { recursive: true })
  fs.writeFileSync(join(artifactDir(runId), 'stdout.log'), 'stream\n', 'utf8')
}

function saveChatWithRuns(appChatId: string, runs: ChatRun[]): ChatRecord {
  const chat: ChatRecord = {
    appChatId,
    scope: 'workspace',
    chatKind: 'single',
    provider: 'gemini',
    title: appChatId,
    workspaceId: 'workspace-1',
    workspacePath: '/repo',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [],
    runs
  }
  AppStore.saveChat(chat)
  return chat
}

describe('AppStore.deleteChat run cleanup', () => {
  beforeEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
    fs.mkdirSync(join(userDataPath, 'chats'), { recursive: true })
  })

  it('removes the deleted chat run-event files and artifacts', () => {
    saveChatWithRuns('chat-a', [makeRun('run-1'), makeRun('run-2')])
    seedRunFiles('run-1')
    seedRunFiles('run-2')

    expect(fs.existsSync(runEventPath('run-1'))).toBe(true)
    expect(fs.existsSync(artifactDir('run-1'))).toBe(true)

    AppStore.deleteChat('chat-a')

    // Chat JSON gone (behaviour preserved).
    expect(fs.existsSync(join(userDataPath, 'chats', 'chat-a.json'))).toBe(false)
    // Both runs' forensic files removed.
    expect(fs.existsSync(runEventPath('run-1'))).toBe(false)
    expect(fs.existsSync(artifactDir('run-1'))).toBe(false)
    expect(fs.existsSync(runEventPath('run-2'))).toBe(false)
    expect(fs.existsSync(artifactDir('run-2'))).toBe(false)
  })

  it('leaves a sibling chat with a prefix-similar run id untouched', () => {
    // chat-a owns `run-1`; sibling chat-b owns `run-1-extra` whose id has
    // `run-1` as a string prefix. A prefix/readdir-based delete would wrongly
    // catch the sibling's files; an exact-name delete must not.
    saveChatWithRuns('chat-a', [makeRun('run-1')])
    saveChatWithRuns('chat-b', [makeRun('run-1-extra')])
    seedRunFiles('run-1')
    seedRunFiles('run-1-extra')

    AppStore.deleteChat('chat-a')

    // Deleted chat's run is gone...
    expect(fs.existsSync(runEventPath('run-1'))).toBe(false)
    expect(fs.existsSync(artifactDir('run-1'))).toBe(false)
    // ...but the sibling's prefix-similar run is fully intact.
    expect(fs.existsSync(runEventPath('run-1-extra'))).toBe(true)
    expect(fs.existsSync(artifactDir('run-1-extra'))).toBe(true)
    expect(fs.existsSync(join(userDataPath, 'chats', 'chat-b.json'))).toBe(true)
  })

  it('succeeds when a run-event file is already missing', () => {
    // run-1 has files, run-2 was never persisted (missing on disk).
    saveChatWithRuns('chat-a', [makeRun('run-1'), makeRun('run-2')])
    seedRunFiles('run-1')
    expect(fs.existsSync(runEventPath('run-2'))).toBe(false)

    expect(() => AppStore.deleteChat('chat-a')).not.toThrow()

    expect(fs.existsSync(runEventPath('run-1'))).toBe(false)
    expect(fs.existsSync(join(userDataPath, 'chats', 'chat-a.json'))).toBe(false)
  })
})
