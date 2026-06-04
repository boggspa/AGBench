import { getChatProvider } from './chatScope'
import { normalizeProviderModelKey } from './providerModelDefaults'
import type { ChatRecord, ChatRun, GeminiWorktreeConfig } from '../../../main/store/types'

const normalizeGeminiResumeTarget = (value?: string): string | undefined => {
  const target = value?.trim()
  if (!target || target.toLowerCase() === 'unknown') return undefined
  return target && /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,511}$/.test(target) ? target : undefined
}

const getGeminiWorktreeResumeKey = (worktree?: GeminiWorktreeConfig | null): string => {
  if (!worktree?.enabled) {
    return 'disabled'
  }
  return ['enabled', worktree.name || '', worktree.effectivePath || ''].join('\u0000')
}

const getLastGeminiRunForResume = (chat: ChatRecord): ChatRun | undefined => {
  const runs = [...(chat.runs || [])].reverse()
  return runs.find((candidate) => (candidate.provider || getChatProvider(chat)) === 'gemini')
}

const resolveGeminiResumeForRun = (
  chat: ChatRecord,
  requestedModel: string | undefined,
  approvalMode: string,
  worktree?: GeminiWorktreeConfig | null,
  geminiAuthProfileId?: string | null
): { sessionId?: string; skippedReason?: string } => {
  const sessionId = normalizeGeminiResumeTarget(chat.linkedGeminiSessionId)
  if (!sessionId) {
    return {}
  }

  if (approvalMode !== 'plan') {
    return {
      skippedReason:
        'Starting a fresh Gemini session because write-capable Gemini runs cannot safely resume CLI sessions; Gemini can persist plan-mode tool limits inside a resumed session.'
    }
  }

  const lastRun = getLastGeminiRunForResume(chat)
  if (!lastRun) {
    return { sessionId }
  }

  const previousAuthProfileId =
    typeof lastRun.geminiAuthProfileId === 'string' ? lastRun.geminiAuthProfileId : null
  const nextAuthProfileId = geminiAuthProfileId || null
  if (previousAuthProfileId !== nextAuthProfileId) {
    return {
      skippedReason:
        'Starting a fresh Gemini session because the selected Gemini auth profile changed.'
    }
  }

  const previousApprovalMode = lastRun.approvalMode || 'default'
  if (previousApprovalMode !== approvalMode) {
    return {
      skippedReason: `Starting a fresh Gemini session because approval mode changed from ${previousApprovalMode} to ${approvalMode}.`
    }
  }

  const previousModel = lastRun.requestedModel || lastRun.actualModel
  const previousModelKey = normalizeProviderModelKey(previousModel)
  const nextModelKey = normalizeProviderModelKey(requestedModel)
  if (previousModelKey && nextModelKey && previousModelKey !== nextModelKey) {
    return {
      skippedReason: `Starting a fresh Gemini session because model changed from ${previousModel} to ${requestedModel}.`
    }
  }

  const previousWorktreeKey = getGeminiWorktreeResumeKey(lastRun.geminiWorktree)
  const nextWorktreeKey = getGeminiWorktreeResumeKey(worktree)
  if (previousWorktreeKey !== nextWorktreeKey) {
    return {
      skippedReason: 'Starting a fresh Gemini session because the Gemini worktree setting changed.'
    }
  }

  return { sessionId }
}

export {
  normalizeGeminiResumeTarget,
  getGeminiWorktreeResumeKey,
  getLastGeminiRunForResume,
  resolveGeminiResumeForRun
}
