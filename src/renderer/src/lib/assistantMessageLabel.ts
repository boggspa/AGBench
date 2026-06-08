import { reasoningDisplayLabel, shortModelName } from './composerChipFormat'
import { humaniseModelId } from './modelDisplayName'
import { resolveOllamaDisplayBrand } from './ollamaDisplayBrand'
import { getProviderLabel } from './providerLabels'
import type { ChatMessage, ProviderId } from '../../../main/store/types'

type AssistantMessageLabelPresentation = {
  label: string
  provider: ProviderId | null
  providerClass: string | null
  modelBadge: string | null
}

const formatAssistantMessageLabel = (
  message: ChatMessage,
  fallbackLabel: string,
  fallbackProvider: ProviderId | null
): AssistantMessageLabelPresentation => {
  if (message.metadata?.kind === 'guestParticipantReply') {
    const guestProvider = (message.metadata?.guestProvider as ProviderId | undefined) ?? null
    const guestRole =
      typeof message.metadata?.guestRole === 'string' && message.metadata.guestRole
        ? message.metadata.guestRole
        : 'Guest'
    const guestModel =
      typeof message.metadata?.guestModel === 'string' ? message.metadata.guestModel : ''
    return {
      label: guestProvider
        ? `${getProviderLabel(guestProvider)} / ${guestRole}`
        : `Guest / ${guestRole}`,
      provider: guestProvider,
      providerClass: guestProvider,
      modelBadge: guestProvider && guestModel ? shortModelName(guestProvider, '', guestModel) : null
    }
  }
  const provider = (message.metadata?.ensembleProvider as ProviderId | undefined) ?? null
  if (!provider) {
    if (fallbackProvider === 'ollama') {
      const model =
        typeof message.metadata?.providerModel === 'string' ? message.metadata.providerModel : ''
      const modelLabel =
        typeof message.metadata?.providerModelLabel === 'string'
          ? message.metadata.providerModelLabel
          : humaniseModelId('ollama', model)
      const brand = resolveOllamaDisplayBrand(model, modelLabel)
      if (brand) {
        return {
          label: brand.providerLabel,
          provider: fallbackProvider,
          providerClass: brand.providerClass,
          modelBadge: brand.modelLabel
        }
      }
      if (modelLabel) {
        return {
          label: modelLabel,
          provider: fallbackProvider,
          providerClass: fallbackProvider,
          modelBadge: null
        }
      }
    }
    // Solo chats: use the chat-level provider as the colouring hook.
    // The label is still the plain provider name (no role suffix
    // since there's no ensemble context). The composer chip already
    // shows the model in solo chats — no need to duplicate it here.
    return {
      label: fallbackLabel,
      provider: fallbackProvider,
      providerClass: fallbackProvider,
      modelBadge: null
    }
  }
  const role =
    typeof message.metadata?.ensembleRole === 'string' ? message.metadata.ensembleRole : ''
  // Ensemble preview: surface the participant's short model name as a
  // dim badge appended to "Provider / Role". Prep work for 1.0.4 where
  // two Claudes or two Codexes will share a provider — the model is
  // the only thing that visually distinguishes them in the transcript.
  // Falls back to no badge when the participant doesn't carry a model
  // (legacy ensemble chats from before this metadata existed).
  const ensembleModel =
    typeof message.metadata?.ensembleModel === 'string' ? message.metadata.ensembleModel : ''
  const ensembleReasoningEffort =
    typeof message.metadata?.ensembleReasoningEffort === 'string'
      ? message.metadata.ensembleReasoningEffort
      : ''
  const ensembleThinkingEnabled =
    typeof message.metadata?.ensembleThinkingEnabled === 'boolean'
      ? message.metadata.ensembleThinkingEnabled
      : undefined
  const modelName = ensembleModel ? shortModelName(provider, '', ensembleModel) : null
  // Append a reasoning/thinking suffix when the participant carried one
  // through dispatch so the header mirrors the composer chip the user
  // picked ("5.5 Extra High", "Opus 4.7 · Max", "K2.6 Thinking"). The
  // reasoning helper short-circuits to '' for providers without a
  // reasoning axis (Gemini) or when the effort is 'off'.
  const reasoningSuffix = modelName
    ? reasoningDisplayLabel({
        provider,
        // `reasoningDisplayLabel` doesn't read `composerStyle` — only the
        // sibling `formatComposerModelChip` does — but the shared
        // `ComposerChipContext` interface requires it. Any valid value
        // works; `'default'` is the most neutral.
        composerStyle: 'default',
        modelId: ensembleModel,
        modelLabel: '',
        codexReasoningEffort: provider === 'codex' ? ensembleReasoningEffort : undefined,
        claudeReasoningEffort: provider === 'claude' ? ensembleReasoningEffort : undefined,
        kimiThinkingEnabled: provider === 'kimi' ? ensembleThinkingEnabled : undefined
      })
    : ''
  const modelBadge = modelName
    ? reasoningSuffix
      ? `${modelName} ${reasoningSuffix}`
      : modelName
    : null
  return {
    label: role ? `${getProviderLabel(provider)} / ${role}` : getProviderLabel(provider),
    provider,
    providerClass: provider,
    modelBadge: modelBadge || null
  }
}

export { formatAssistantMessageLabel }
export type { AssistantMessageLabelPresentation }
