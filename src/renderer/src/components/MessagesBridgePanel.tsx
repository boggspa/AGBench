import { useCallback, useEffect, useMemo, useState, type FormEvent, type JSX } from 'react'
import type { AppSettings, ChatRecord, ProviderId } from '../../../main/store/types'
import type {
  MessageChannelBinding,
  MessageChannelBindingInput
} from '../../../main/channels/MessageChannelTypes'
import type { MessageChannelCursor } from '../../../main/channels/MessageChannelCursorStore'
import type { MessageChannelAuditRecord } from '../../../main/channels/MessageChannelAuditStore'
import type {
  MessagesBridgeInboundMessage,
  MessageChannelPollSummary,
  MessagesBridgeConversation
} from '../../../main/channels/MessageChannelGatewayService'
import {
  messageBridgeBindingPollBlocker,
  messageBridgePollOnceBlocker,
  messageBridgeSendBlocker,
  messagesBridgeAuditRecordMatchesBinding,
  messagesBridgePollDiagnostic,
  messagesBridgePollObservation,
  messagesBridgePanelErrorMessage,
  messagesBridgePeekRowPreview,
  messagesBridgePeekRowStatus,
  messagesBridgeStatusCommandState,
  messagesBridgeDatabaseBlocker,
  type MessagesBridgeStatus
} from './MessagesBridgePanelLogic'

type BridgeSettingsState = {
  enabled: boolean
  pollIntervalMs: number
}

type BindingFormState = {
  id: string
  label: string
  accountId: string
  chatGuid: string
  allowedHandles: string
  appChatId: string
  provider: ProviderId
  requireTrigger: boolean
  triggerPrefix: string
}

type ValidationAction = {
  label: string
  disabled?: boolean
  disabledReason?: string
  onClick: () => void
}

type ValidationStep = {
  key: string
  title: string
  detail: string
  complete: boolean
  actions: ValidationAction[]
}

const PROVIDER_OPTIONS: ProviderId[] = ['codex', 'gemini', 'claude', 'kimi']
const DEFAULT_POLL_INTERVAL_MS = 30_000
const MIN_POLL_INTERVAL_SECONDS = 5
const FULL_DISK_ACCESS_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
const AUTOMATION_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation'
const SECURITY_SETTINGS_FALLBACK_PATH = '/System/Library/PreferencePanes/Security.prefPane'
const MESSAGES_APP_PATH = '/System/Applications/Messages.app'

const emptyBindingForm = (): BindingFormState => ({
  id: '',
  label: '',
  accountId: 'mac-default',
  chatGuid: '',
  allowedHandles: '',
  appChatId: '',
  provider: 'codex',
  requireTrigger: true,
  triggerPrefix: 'tw'
})

export function MessagesBridgePanel(): JSX.Element {
  const [bridgeSettings, setBridgeSettings] = useState<BridgeSettingsState>({
    enabled: false,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS
  })
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(
    String(DEFAULT_POLL_INTERVAL_MS / 1000)
  )
  const [status, setStatus] = useState<MessagesBridgeStatus | null>(null)
  const [bindings, setBindings] = useState<MessageChannelBinding[]>([])
  const [conversations, setConversations] = useState<MessagesBridgeConversation[]>([])
  const [cursors, setCursors] = useState<MessageChannelCursor[]>([])
  const [audit, setAudit] = useState<MessageChannelAuditRecord[]>([])
  const [chats, setChats] = useState<ChatRecord[]>([])
  const [form, setForm] = useState<BindingFormState>(() => emptyBindingForm())
  const [loading, setLoading] = useState(true)
  const [savingSettings, setSavingSettings] = useState(false)
  const [savingBinding, setSavingBinding] = useState(false)
  const [scanningConversations, setScanningConversations] = useState(false)
  const [testingBindingId, setTestingBindingId] = useState<string | null>(null)
  const [pollingBindingId, setPollingBindingId] = useState<string | null>(null)
  const [peekingBindingId, setPeekingBindingId] = useState<string | null>(null)
  const [peekBindingId, setPeekBindingId] = useState<string | null>(null)
  const [peekRows, setPeekRows] = useState<MessagesBridgeInboundMessage[]>([])
  const [clearingCursorBindingId, setClearingCursorBindingId] = useState<string | null>(null)
  const [resettingSetup, setResettingSetup] = useState(false)
  const [polling, setPolling] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pollSummary, setPollSummary] = useState<MessageChannelPollSummary | null>(null)

  const activeChats = useMemo(() => chats.filter((chat) => !chat.archived), [chats])
  const activeBindings = useMemo(() => bindings.filter((binding) => !binding.archived), [bindings])
  const primaryBinding = activeBindings[0] || null

  const loadPanel = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [settings, bridgeStatus, nextBindings, nextCursors, nextAudit, nextChats] =
        await Promise.all([
          window.api.getSettings(),
          window.api.getMessagesBridgeStatus(),
          window.api.listMessageChannelBindings(),
          window.api.listMessageChannelCursors(),
          window.api.listMessageChannelAudit(50),
          window.api.getChats()
        ])
      const nextSettings = settingsToBridgeState(settings)
      setBridgeSettings(nextSettings)
      setPollIntervalSeconds(String(Math.round(nextSettings.pollIntervalMs / 1000)))
      setStatus(bridgeStatus as MessagesBridgeStatus)
      setBindings(nextBindings)
      setCursors(nextCursors)
      setAudit(nextAudit.reverse())
      setChats(nextChats)
      const nextActiveChats = nextChats.filter((chat) => !chat.archived)
      setForm((current) =>
        current.appChatId || nextActiveChats.length === 0
          ? current
          : { ...current, appChatId: nextActiveChats[0].appChatId }
      )
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void loadPanel()
    })
    return () => {
      cancelled = true
    }
  }, [loadPanel])

  const updateBridgeSettings = async (partial: Partial<BridgeSettingsState>): Promise<void> => {
    const nextSettings = { ...bridgeSettings, ...partial }
    setBridgeSettings(nextSettings)
    setSavingSettings(true)
    setError(null)
    setMessage(null)
    try {
      await window.api.updateSettings({
        messageBridgeEnabled: nextSettings.enabled,
        messageBridgePollIntervalMs: nextSettings.pollIntervalMs
      })
      setMessage('Channel gateway settings saved.')
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    } finally {
      setSavingSettings(false)
    }
  }

  const applyPollInterval = async (): Promise<void> => {
    const seconds = Number(pollIntervalSeconds)
    const nextSeconds = Number.isFinite(seconds)
      ? Math.max(MIN_POLL_INTERVAL_SECONDS, Math.trunc(seconds))
      : DEFAULT_POLL_INTERVAL_MS / 1000
    setPollIntervalSeconds(String(nextSeconds))
    await updateBridgeSettings({ pollIntervalMs: nextSeconds * 1000 })
  }

  const refreshStatus = async (): Promise<void> => {
    setError(null)
    try {
      setStatus((await window.api.getMessagesBridgeStatus()) as MessagesBridgeStatus)
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    }
  }

  const pollOnce = async (): Promise<void> => {
    setPolling(true)
    setError(null)
    setMessage(null)
    try {
      const summary = await window.api.pollMessageChannelsOnce()
      setPollSummary(summary)
      const diagnostic = messagesBridgePollDiagnostic(summary, triggerPrefixForCommand)
      setMessage(
        `Polled ${summary.polled} rows; dispatched ${summary.dispatched}.${
          diagnostic ? ` ${diagnostic}` : ''
        }`
      )
      const [nextCursors, nextAudit] = await Promise.all([
        window.api.listMessageChannelCursors(),
        window.api.listMessageChannelAudit(50)
      ])
      setCursors(nextCursors)
      setAudit(nextAudit.reverse())
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    } finally {
      setPolling(false)
    }
  }

  const scanConversations = async (): Promise<void> => {
    const blocker = messagesBridgeDatabaseBlocker(status)
    if (blocker) {
      setMessage(null)
      setError(blocker)
      return
    }
    setScanningConversations(true)
    setError(null)
    setMessage(null)
    try {
      const result = await window.api.listMessagesBridgeConversations({
        accountId: form.accountId.trim() || 'mac-default',
        limit: 25
      })
      setConversations(result.conversations)
      setMessage(`Found ${result.conversations.length} recent iMessage conversations.`)
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    } finally {
      setScanningConversations(false)
    }
  }

  const applyConversation = (conversation: MessagesBridgeConversation): void => {
    const operatorHandle = conversationOperatorHandle(conversation)
    const selfToSelf = conversationAppearsSelfToSelf(conversation, form.accountId)
    setForm((current) => ({
      ...current,
      accountId: conversation.accountId || current.accountId || 'mac-default',
      chatGuid: conversation.chatGuid,
      label: current.label || conversationTitle(conversation),
      allowedHandles: operatorHandle || ''
    }))
    if (operatorHandle) {
      setError(null)
      setMessage(
        selfToSelf
          ? `Selected ${operatorHandle}. This looks like a same-Apple-ID/self-synced conversation; a dedicated TaskWraith address gives cleaner UX.`
          : `Selected operator handle ${operatorHandle}.`
      )
    } else {
      setMessage(null)
      setError(
        'That conversation has multiple possible participants. Enter one exact operator handle manually before saving.'
      )
    }
  }

  const saveBindingFromCurrentForm = async (): Promise<MessageChannelBinding | null> => {
    setSavingBinding(true)
    setError(null)
    setMessage(null)
    try {
      const input = formToBindingInput(form)
      const saved = await window.api.upsertMessageChannelBinding(input)
      setBindings((current) => upsertBindingInList(current, saved))
      setForm(bindingToForm(saved))
      const nextAudit = await window.api.listMessageChannelAudit(50)
      setAudit(nextAudit.reverse())
      setMessage('iMessage binding saved.')
      return saved
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
      return null
    } finally {
      setSavingBinding(false)
    }
  }

  const saveBinding = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    await saveBindingFromCurrentForm()
  }

  const archiveBinding = async (bindingId: string): Promise<void> => {
    setError(null)
    setMessage(null)
    try {
      const archived = await window.api.archiveMessageChannelBinding(bindingId)
      if (archived) {
        setBindings((current) => upsertBindingInList(current, archived))
        setMessage('iMessage binding archived.')
      }
      const nextAudit = await window.api.listMessageChannelAudit(50)
      setAudit(nextAudit.reverse())
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    }
  }

  const sendTestMessage = async (binding: MessageChannelBinding): Promise<void> => {
    setTestingBindingId(binding.id)
    setError(null)
    setMessage(null)
    try {
      if (
        window.api.hostPlatform === 'darwin' &&
        !hasSentBridgeTest &&
        typeof window.api.openMessagesPermissionHelper === 'function'
      ) {
        try {
          await window.api.openMessagesPermissionHelper()
        } catch {
          // The send test is the authoritative automation check; the helper
          // window is only setup guidance and should not block it.
        }
      }
      const result = await window.api.sendMessageChannelTest(binding.id)
      setMessage(`Sent bridge test message to ${result.recipientHandle}.`)
      const nextAudit = await window.api.listMessageChannelAudit(50)
      setAudit(nextAudit.reverse())
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
      const nextAudit = await window.api.listMessageChannelAudit(50)
      setAudit(nextAudit.reverse())
    } finally {
      setTestingBindingId(null)
    }
  }

  const pollBinding = async (binding: MessageChannelBinding): Promise<void> => {
    setPollingBindingId(binding.id)
    setError(null)
    setMessage(null)
    try {
      const summary = await window.api.pollMessageChannelBinding(binding.id)
      setPollSummary(summary)
      const diagnostic = messagesBridgePollDiagnostic(summary, binding.triggerPrefix || 'tw')
      setMessage(
        `Polled ${summary.polled} rows for ${binding.label || binding.chatGuid}; dispatched ${summary.dispatched}.${
          diagnostic ? ` ${diagnostic}` : ''
        }`
      )
      const [nextCursors, nextAudit] = await Promise.all([
        window.api.listMessageChannelCursors(),
        window.api.listMessageChannelAudit(50)
      ])
      setCursors(nextCursors)
      setAudit(nextAudit.reverse())
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
      const nextAudit = await window.api.listMessageChannelAudit(50)
      setAudit(nextAudit.reverse())
    } finally {
      setPollingBindingId(null)
    }
  }

  const peekBindingMessages = async (binding: MessageChannelBinding): Promise<void> => {
    setPeekingBindingId(binding.id)
    setError(null)
    setMessage(null)
    try {
      if (typeof window.api.peekMessageChannelBinding !== 'function') {
        throw new Error(
          'Channel gateway diagnostic IPC is not loaded in this running TaskWraith process. Restart TaskWraith, then reopen Settings -> Channels.'
        )
      }
      const result = await window.api.peekMessageChannelBinding(binding.id)
      setPeekBindingId(binding.id)
      setPeekRows(result.messages)
      setMessage(`Read ${result.messages.length} latest Messages rows for this operator link.`)
      const nextAudit = await window.api.listMessageChannelAudit(50)
      setAudit(nextAudit.reverse())
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    } finally {
      setPeekingBindingId(null)
    }
  }

  const clearCursors = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    try {
      await window.api.clearMessageChannelCursors()
      setCursors([])
      const nextAudit = await window.api.listMessageChannelAudit(50)
      setAudit(nextAudit.reverse())
      setMessage('Message cursors cleared.')
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    }
  }

  const clearBindingCursor = async (binding: MessageChannelBinding): Promise<void> => {
    setClearingCursorBindingId(binding.id)
    setError(null)
    setMessage(null)
    try {
      let resetMessage =
        'Reset this operator channel cursor. Send "tw status" again or click Poll binding.'
      if (typeof window.api.clearMessageChannelBindingCursor === 'function') {
        await window.api.clearMessageChannelBindingCursor(binding.id)
      } else {
        await window.api.clearMessageChannelCursors()
        resetMessage =
          'Reset all message cursors because this running TaskWraith preload does not expose binding-scoped reset. Send "tw status" again or click Poll binding.'
      }
      const [nextCursors, nextAudit] = await Promise.all([
        window.api.listMessageChannelCursors(),
        window.api.listMessageChannelAudit(50)
      ])
      setCursors(nextCursors)
      setAudit(nextAudit.reverse())
      setMessage(resetMessage)
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    } finally {
      setClearingCursorBindingId(null)
    }
  }

  const startSetupOver = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    if (!primaryBinding) {
      setForm(emptyBindingForm())
      setConversations([])
      setPollSummary(null)
      setPeekBindingId(null)
      setPeekRows([])
      setMessage('Reset the setup form. Scan recent iMessages to create a new operator link.')
      return
    }
    setResettingSetup(true)
    try {
      if (typeof window.api.clearMessageChannelBindingCursor === 'function') {
        await window.api.clearMessageChannelBindingCursor(primaryBinding.id)
      } else {
        await window.api.clearMessageChannelCursors()
      }
      const archived = await window.api.archiveMessageChannelBinding(primaryBinding.id)
      if (archived) {
        setBindings((current) => upsertBindingInList(current, archived))
      }
      const [nextCursors, nextAudit] = await Promise.all([
        window.api.listMessageChannelCursors(),
        window.api.listMessageChannelAudit(50)
      ])
      setCursors(nextCursors)
      setAudit(nextAudit.reverse())
      setConversations([])
      setForm(emptyBindingForm())
      setPollSummary(null)
      setPeekBindingId(null)
      setPeekRows([])
      setMessage(
        'Archived the current operator link and reset setup. Scan recent iMessages, then save the new TaskWraith contact link.'
      )
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    } finally {
      setResettingSetup(false)
    }
  }

  const createOperatorChat = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    try {
      const chat = await window.api.createGlobalChat()
      await window.api.saveChat(chat)
      setChats((current) => [
        chat,
        ...current.filter((candidate) => candidate.appChatId !== chat.appChatId)
      ])
      setForm((current) => ({ ...current, appChatId: chat.appChatId }))
      setMessage('Operator channel created.')
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    }
  }

  const openPermissionPane = async (href: string, label: string): Promise<void> => {
    setError(null)
    setMessage(null)
    if (window.api.hostPlatform !== 'darwin') {
      setError('The iMessage local adapter is macOS-only.')
      return
    }
    try {
      const result = await window.api.openExternalOrPath(href)
      if (!result.ok) {
        const fallback = await window.api.openExternalOrPath(SECURITY_SETTINGS_FALLBACK_PATH)
        if (!fallback.ok) {
          throw new Error(result.error || fallback.error || `Could not open ${label}.`)
        }
        setMessage(`${label} settings opened. Select the privacy row manually if needed.`)
        return
      }
      setMessage(`${label} opened in System Settings.`)
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    }
  }

  const openAutomationPermissionSetup = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    if (window.api.hostPlatform !== 'darwin') {
      setError('The iMessage local adapter is macOS-only.')
      return
    }
    try {
      let helperOpened = false
      if (typeof window.api.openMessagesPermissionHelper === 'function') {
        await window.api.openMessagesPermissionHelper()
        helperOpened = true
      }
      const result = await window.api.openExternalOrPath(AUTOMATION_SETTINGS_URL)
      if (!result.ok) {
        const fallback = await window.api.openExternalOrPath(SECURITY_SETTINGS_FALLBACK_PATH)
        if (!fallback.ok) {
          throw new Error(result.error || fallback.error || 'Could not open Automation.')
        }
        setMessage(
          `${helperOpened ? 'Permission helper opened. ' : ''}Security settings opened. Select Automation manually if needed.`
        )
        return
      }
      setMessage(
        `${helperOpened ? 'Permission helper opened. ' : ''}Automation opened in System Settings. If TaskWraith is missing, run Send test once so macOS asks for consent.`
      )
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    }
  }

  const openMessagesApp = async (): Promise<void> => {
    setError(null)
    setMessage(null)
    try {
      const result = await window.api.openExternalOrPath(MESSAGES_APP_PATH)
      if (!result?.ok) {
        throw new Error(result?.error || 'Could not open Messages.app.')
      }
      setMessage(
        'Opened Messages.app. Choose Messages -> Settings -> iMessage, then sign into the TaskWraith Apple Account.'
      )
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    }
  }

  const statusLabel = status?.ok
    ? 'Ready'
    : status?.reason
      ? 'Unavailable'
      : loading
        ? 'Checking'
        : 'Needs setup'
  const statusTone = status?.ok ? 'ok' : 'warn'
  const databaseReady = Boolean(status?.databaseReadable && status?.pollSupported)
  const hasConversationScan = conversations.length > 0 || Boolean(primaryBinding)
  const hasBinding = Boolean(primaryBinding)
  const hasSentBridgeTest = audit.some(
    (record) =>
      record.kind === 'outbound_sent' &&
      record.payload?.test === true &&
      messagesBridgeAuditRecordMatchesBinding(record, primaryBinding)
  )
  const hasHandledStatusCommand = audit.some(
    (record) =>
      record.kind === 'inbound_dispatched' &&
      auditCommandName(record) === 'status' &&
      messagesBridgeAuditRecordMatchesBinding(record, primaryBinding)
  )
  const hasSentStatusReply = audit.some(
    (record) =>
      record.kind === 'outbound_sent' &&
      auditCommandName(record) === 'status' &&
      messagesBridgeAuditRecordMatchesBinding(record, primaryBinding)
  )
  const conversationScanBlocker = messagesBridgeDatabaseBlocker(status)
  const bindingSaveBlocker = bindingFormBlocker(form, hasBinding)
  const canSaveWizardBinding = !bindingSaveBlocker
  const primarySendTestBlocker = messageBridgeSendBlocker(status, primaryBinding)
  const primaryPollBlocker = messageBridgeBindingPollBlocker(status, primaryBinding)
  const pollOnceBlocker = messageBridgePollOnceBlocker(status, activeBindings.length)
  const triggerPrefixForCommand =
    (primaryBinding?.triggerPrefix || form.triggerPrefix || 'tw').trim() || 'tw'
  const statusCommandText = `${triggerPrefixForCommand} status`
  const bridgeIdentityValue = primaryBinding?.accountId || form.accountId
  const bridgeIdentityLabel = formatBridgeIdentityLabel(bridgeIdentityValue)
  const bridgeIdentityIsPlaceholder = isPlaceholderBridgeIdentity(bridgeIdentityValue)
  const copyStatusCommand = async (): Promise<void> => {
    setError(null)
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard is not available.')
      }
      await navigator.clipboard.writeText(statusCommandText)
      setMessage(`Copied "${statusCommandText}" for your iPhone.`)
    } catch (err) {
      setError(messagesBridgePanelErrorMessage(err))
    }
  }
  const validationSteps: ValidationStep[] = [
    {
      key: 'full-disk-access',
      title: 'Full Disk Access',
      detail: databaseReady
        ? 'Messages database is readable.'
        : 'Grant access, restart TaskWraith if macOS still reports unreadable, then recheck.',
      complete: databaseReady,
      actions: [
        {
          label: 'Open settings',
          onClick: () => void openPermissionPane(FULL_DISK_ACCESS_SETTINGS_URL, 'Full Disk Access')
        },
        { label: 'Recheck', onClick: () => void refreshStatus() }
      ]
    },
    {
      key: 'scan-conversations',
      title: 'Find TaskWraith contact',
      detail:
        conversations.length > 0
          ? `${conversations.length} recent iMessage conversation${conversations.length === 1 ? '' : 's'} loaded.`
          : conversationScanBlocker
            ? conversationScanBlocker
            : 'Click Scan, then choose the conversation where your iPhone messages the TaskWraith contact.',
      complete: hasConversationScan,
      actions: [
        {
          label: scanningConversations ? 'Scanning...' : 'Scan',
          disabled: scanningConversations || Boolean(conversationScanBlocker),
          disabledReason: conversationScanBlocker || undefined,
          onClick: () => void scanConversations()
        }
      ]
    },
    {
      key: 'create-binding',
      title: 'Choose TaskWraith contact',
      detail: primaryBinding
        ? `Active binding: ${primaryBinding.label || primaryBinding.chatGuid}.`
        : conversations.length > 0 && bindingSaveBlocker?.startsWith('Missing')
          ? 'Choose the TaskWraith contact conversation. A distinct Apple Account or reachable email gives the cleanest UX.'
          : bindingSaveBlocker ||
            'Save one operator-channel link with an exact sender handle and trigger.',
      complete: hasBinding,
      actions: [
        ...(!form.appChatId
          ? [
              {
                label: 'New chat',
                disabled: savingBinding,
                onClick: () => void createOperatorChat()
              }
            ]
          : []),
        {
          label: savingBinding ? 'Saving...' : 'Save link',
          disabled: savingBinding || hasBinding || !canSaveWizardBinding,
          disabledReason: bindingSaveBlocker || undefined,
          onClick: () => void saveBindingFromCurrentForm()
        }
      ]
    },
    {
      key: 'automation-permission',
      title: 'Automation permission',
      detail: hasSentBridgeTest
        ? 'Messages.app accepted an automated send from TaskWraith.'
        : primaryBinding
          ? "Send one test to validate macOS Messages automation. TaskWraith will reply as the Mac's Messages identity; it cannot spoof another iMessage sender."
          : 'Save the TaskWraith contact link first, then send a test to trigger macOS Messages automation consent.',
      complete: hasSentBridgeTest,
      actions: [
        {
          label: 'Open helper',
          onClick: () => void openAutomationPermissionSetup()
        },
        {
          label: testingBindingId === primaryBinding?.id ? 'Sending...' : 'Send test',
          disabled: Boolean(primarySendTestBlocker) || testingBindingId === primaryBinding?.id,
          disabledReason: primarySendTestBlocker || undefined,
          onClick: () => {
            if (primaryBinding) void sendTestMessage(primaryBinding)
          }
        }
      ]
    },
    {
      key: 'poll-status',
      title: 'Poll tw status',
      detail: hasHandledStatusCommand
        ? 'TaskWraith handled an inbound status command.'
        : `Text "${statusCommandText}" to the TaskWraith contact from your iPhone, then poll. If you already sent it, reset the cursor and poll again.`,
      complete: hasHandledStatusCommand,
      actions: [
        {
          label: 'Copy text',
          disabled: !primaryBinding,
          disabledReason: 'Save an operator link first.',
          onClick: () => void copyStatusCommand()
        },
        {
          label: clearingCursorBindingId === primaryBinding?.id ? 'Resetting...' : 'Reset cursor',
          disabled: !primaryBinding || clearingCursorBindingId === primaryBinding?.id,
          disabledReason: primaryBinding
            ? 'Cursor reset is already running.'
            : 'Save an operator link first.',
          onClick: () => {
            if (primaryBinding) void clearBindingCursor(primaryBinding)
          }
        },
        {
          label: pollingBindingId === primaryBinding?.id ? 'Polling...' : 'Poll binding',
          disabled: Boolean(primaryPollBlocker) || pollingBindingId === primaryBinding?.id,
          disabledReason: primaryPollBlocker || undefined,
          onClick: () => {
            if (primaryBinding) void pollBinding(primaryBinding)
          }
        },
        {
          label: peekingBindingId === primaryBinding?.id ? 'Reading...' : 'Inspect rows',
          disabled: !primaryBinding || peekingBindingId === primaryBinding?.id,
          disabledReason: primaryBinding
            ? 'Message row inspection is already running.'
            : 'Save an operator link first.',
          onClick: () => {
            if (primaryBinding) void peekBindingMessages(primaryBinding)
          }
        }
      ]
    },
    {
      key: 'verify-reply',
      title: 'Verify reply',
      detail: hasSentStatusReply
        ? 'A status command reply was sent through Messages.app.'
        : 'Confirm the status command produced an outbound command reply.',
      complete: hasSentStatusReply,
      actions: [
        {
          label: 'Refresh audit',
          onClick: () => void loadPanel()
        }
      ]
    }
  ]
  const validationCompleteCount = validationSteps.filter((step) => step.complete).length
  const currentValidationStep = validationSteps.find((step) => !step.complete) || null
  const wizardConversationPicks = conversations
    .filter((conversation) => Boolean(conversationOperatorHandle(conversation)))
    .slice(0, 4)
  const missingBindingFields = bindingFieldStatus(form)
  const pollDiagnostic = messagesBridgePollDiagnostic(pollSummary, triggerPrefixForCommand)
  const pollObservation = messagesBridgePollObservation(pollSummary)
  const pollCommandState = messagesBridgeStatusCommandState(
    pollSummary,
    hasHandledStatusCommand,
    hasSentStatusReply
  )
  const activePeekRows = peekBindingId === primaryBinding?.id ? peekRows : []

  return (
    <div className="messages-bridge-panel" aria-label="Channel gateway">
      <div className="messages-bridge-status-grid">
        <div className={`messages-bridge-status-chip messages-bridge-status-chip-${statusTone}`}>
          <span>Gateway</span>
          <strong>{statusLabel}</strong>
        </div>
        <div className="messages-bridge-status-chip">
          <span>Polling</span>
          <strong>{bridgeSettings.enabled ? 'Enabled' : 'Off'}</strong>
        </div>
        <div className="messages-bridge-status-chip">
          <span>Bindings</span>
          <strong>{bindings.filter((binding) => !binding.archived).length}</strong>
        </div>
        <div className="messages-bridge-status-chip">
          <span>Interval</span>
          <strong>{Math.round(bridgeSettings.pollIntervalMs / 1000)}s</strong>
        </div>
      </div>

      {status?.reason && <div className="settings-error">{status.reason}</div>}
      {error && <div className="settings-error">{error}</div>}
      {message && <p className="settings-hint messages-bridge-feedback">{message}</p>}

      <section className="messages-bridge-identity-card" aria-label="Channel gateway overview">
        <div className="messages-bridge-identity-avatar" aria-hidden="true">
          CH
        </div>
        <div>
          <span className="sidebar-section-title">Channels gateway</span>
          <strong>Local/self-hosted adapters, TaskWraith-controlled permissions.</strong>
          <small>
            The active adapter is iMessage local experimental. Telegram, Matrix, Signal, email, and
            local web chat can plug into the same canonical event, allowlist, routing, approval, and
            audit path without a TaskWraith-hosted relay.
          </small>
        </div>
        <div className="messages-bridge-identity-steps">
          <span>Contact allowlists gate every inbound conversation.</span>
          <span>Trigger prefixes prevent accidental dispatch.</span>
          <span>Approvals, file access, and provider runs still go through TaskWraith policy.</span>
          <span>Portable commands: status, pause, approve &lt;code&gt;, deny &lt;code&gt;.</span>
        </div>
      </section>

      <section className="messages-bridge-identity-card" aria-label="Bridge identity setup">
        <div className="messages-bridge-identity-avatar" aria-hidden="true">
          TW
        </div>
        <div>
          <span className="sidebar-section-title">iMessage local identity</span>
          <strong>
            This Mac will receive as:{' '}
            {bridgeIdentityIsPlaceholder ? 'TaskWraith iMessage address' : bridgeIdentityLabel}
          </strong>
          <small>
            TaskWraith replies as the identity signed into Messages.app on this Mac. Sign only
            Messages into the dedicated TaskWraith Apple Account; do not add that address to your
            primary Apple Account if you want separation.
          </small>
        </div>
        <div className="messages-bridge-identity-steps">
          <span>Open Messages.app, then choose Settings -&gt; iMessage.</span>
          <span>Add this address to Contacts as TaskWraith.</span>
          <span>Set a TaskWraith avatar or icon on that contact.</span>
          <span>Send {statusCommandText} to this contact to validate.</span>
          <span>TaskWraith cannot spoof another iMessage sender.</span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void openMessagesApp()}
          >
            Open Messages.app
          </button>
        </div>
      </section>

      <section className="messages-bridge-validation-sheet" aria-label="First-run validation">
        <div className="messages-bridge-subsection-header">
          <div>
            <h4 className="sidebar-section-title" style={{ margin: 0 }}>
              First-run validation
            </h4>
            <p className="messages-bridge-validation-subtitle">
              {validationCompleteCount} of {validationSteps.length} checks complete
            </p>
            <p className="messages-bridge-validation-helper">
              Completed rows stay done. Grey buttons unlock after the highlighted next action.
            </p>
          </div>
          <div className="messages-bridge-actions">
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={resettingSetup}
              onClick={() => void startSetupOver()}
            >
              {resettingSetup ? 'Resetting...' : 'Start over'}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => void loadPanel()}>
              Refresh
            </button>
          </div>
        </div>
        <div className="messages-bridge-validation-list">
          <div className="messages-bridge-validation-summary">
            <div>
              <span>{currentValidationStep ? 'Next action' : 'Ready'}</span>
              <strong>
                {currentValidationStep
                  ? currentValidationStep.title
                  : 'Channel validation complete'}
              </strong>
              <small>
                {currentValidationStep
                  ? currentValidationStep.detail
                  : 'Scheduled polling can stay on for this allowlisted operator link.'}
              </small>
              {currentValidationStep?.key === 'create-binding' &&
                wizardConversationPicks.length > 0 && (
                  <div className="messages-bridge-validation-picks">
                    {wizardConversationPicks.map((conversation) => (
                      <button
                        key={conversation.chatGuid}
                        type="button"
                        className="messages-bridge-validation-pick"
                        title={conversation.chatGuid}
                        onClick={() => applyConversation(conversation)}
                      >
                        <span>{conversationTitle(conversation)}</span>
                        <small>{conversationOperatorHandle(conversation)}</small>
                      </button>
                    ))}
                  </div>
                )}
              {currentValidationStep?.key === 'poll-status' && (
                <div className="messages-bridge-poll-live" aria-label="Poll status diagnostics">
                  <div>
                    <span>Expected iPhone sender</span>
                    <strong>
                      {primaryBinding?.allowedHandles[0] || 'Save an operator link first'}
                    </strong>
                  </div>
                  <div>
                    <span>Bound conversation</span>
                    <code>{primaryBinding?.chatGuid || 'No Messages chat selected'}</code>
                  </div>
                  <div>
                    <span>Last TaskWraith poll</span>
                    <strong>{pollObservation}</strong>
                  </div>
                  <div>
                    <span>Integration state</span>
                    <strong>{pollCommandState}</strong>
                  </div>
                  {pollDiagnostic && <p>{pollDiagnostic}</p>}
                  <div className="messages-bridge-peek-list" aria-label="Latest Messages rows">
                    {activePeekRows.length === 0 ? (
                      <small>
                        Click Inspect rows to see the latest raw Messages rows for this saved
                        conversation.
                      </small>
                    ) : (
                      activePeekRows.map((row) => (
                        <div key={`${row.messageGuid}:${row.rowId}`}>
                          <span>
                            Row {row.rowId} - {row.isFromMe ? 'from this Mac' : 'from operator'}
                          </span>
                          <strong>{row.senderHandle || 'No sender handle'}</strong>
                          <small>{messagesBridgePeekRowPreview(row)}</small>
                          {primaryBinding && (
                            <em>
                              {messagesBridgePeekRowStatus(
                                row,
                                primaryBinding,
                                statusCommandText
                              )}
                            </em>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            {currentValidationStep?.key === 'create-binding' && (
              <div className="messages-bridge-validation-field-checks">
                {missingBindingFields.map((field) => (
                  <span
                    key={field.label}
                    className={`messages-bridge-validation-field-check ${
                      field.complete
                        ? 'messages-bridge-validation-field-check-done'
                        : 'messages-bridge-validation-field-check-missing'
                    }`}
                  >
                    {field.label}
                  </span>
                ))}
              </div>
            )}
            {currentValidationStep?.key === 'poll-status' && (
              <button
                type="button"
                className="messages-bridge-command-pill"
                onClick={() => void copyStatusCommand()}
              >
                {statusCommandText}
              </button>
            )}
          </div>
          {validationSteps.map((step, index) => {
            const disabledReason = step.complete
              ? null
              : step.actions.find((action) => action.disabled && action.disabledReason)
                  ?.disabledReason || null
            return (
              <div
                key={step.key}
                className={`messages-bridge-validation-row${
                  step.complete ? ' messages-bridge-validation-row-complete' : ''
                }${
                  currentValidationStep?.key === step.key
                    ? ' messages-bridge-validation-row-current'
                    : ''
                }`}
              >
                <span className="messages-bridge-validation-index">
                  {step.complete ? 'Done' : String(index + 1)}
                </span>
                <div>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </div>
                <div className="messages-bridge-validation-actions">
                  {step.actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={action.disabled}
                      title={
                        action.disabled && action.disabledReason ? action.disabledReason : undefined
                      }
                      onClick={action.onClick}
                    >
                      {action.label}
                    </button>
                  ))}
                  {disabledReason && (
                    <small className="messages-bridge-validation-action-reason">
                      {disabledReason}
                    </small>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="messages-bridge-setup" aria-label="iMessage adapter setup">
        <div className="messages-bridge-subsection-header">
          <h4 className="sidebar-section-title" style={{ margin: 0 }}>
            iMessage adapter checks
          </h4>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void refreshStatus()}
          >
            Recheck
          </button>
        </div>
        <div className="messages-bridge-setup-grid">
          <div className="messages-bridge-setup-row">
            <div>
              <strong>Messages database</strong>
              <span>{status?.databasePath || '~/Library/Messages/chat.db'}</span>
            </div>
            <code>{status?.databaseReadable ? 'Readable' : 'Needs Full Disk Access'}</code>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() =>
                void openPermissionPane(FULL_DISK_ACCESS_SETTINGS_URL, 'Full Disk Access')
              }
            >
              Full Disk Access
            </button>
          </div>
          <div className="messages-bridge-setup-row">
            <div>
              <strong>Messages automation</strong>
              <span>
                {status?.automationRequiresUserConsent
                  ? 'macOS asks on first Messages.app send.'
                  : 'Messages.app send bridge'}
              </span>
            </div>
            <code>{status?.sendTextSupported ? 'Text enabled' : 'Unavailable'}</code>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => void openAutomationPermissionSetup()}
            >
              Automation helper
            </button>
          </div>
          <div className="messages-bridge-setup-row">
            <div>
              <strong>Outbound files</strong>
              <span>Only explicit TaskWraith attachment paths are sent.</span>
            </div>
            <code>{status?.sendAttachmentSupported ? 'Supported' : 'Unavailable'}</code>
          </div>
        </div>
      </section>

      <div className="messages-bridge-controls">
        <label className="messages-bridge-toggle">
          <input
            type="checkbox"
            checked={bridgeSettings.enabled}
            disabled={savingSettings}
            onChange={(event) => void updateBridgeSettings({ enabled: event.target.checked })}
          />
          <span>
            Scheduled polling
            <small>
              The current iMessage adapter polls locally; trigger-gated bindings decide what
              dispatches.
            </small>
          </span>
        </label>
        <label className="messages-bridge-interval">
          <span>Poll every</span>
          <input
            type="number"
            min={MIN_POLL_INTERVAL_SECONDS}
            step={5}
            value={pollIntervalSeconds}
            disabled={savingSettings}
            onChange={(event) => setPollIntervalSeconds(event.target.value)}
            onBlur={() => void applyPollInterval()}
          />
          <span>sec</span>
        </label>
        <div className="messages-bridge-actions">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void refreshStatus()}
          >
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={polling || Boolean(pollOnceBlocker)}
            title={pollOnceBlocker || undefined}
            onClick={() => void pollOnce()}
          >
            {polling ? 'Polling...' : 'Poll once'}
          </button>
        </div>
      </div>

      <form className="messages-bridge-form" onSubmit={(event) => void saveBinding(event)}>
        <div className="messages-bridge-form-header">
          <h4 className="sidebar-section-title" style={{ margin: 0 }}>
            {form.id ? 'Edit binding' : 'New binding'}
          </h4>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setForm(emptyBindingForm())}
          >
            Clear
          </button>
        </div>
        <label className="settings-field">
          <span className="settings-field-label">Label</span>
          <input
            value={form.label}
            onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
            placeholder="Operator channel"
          />
        </label>
        <label className="settings-field">
          <span className="settings-field-label">Mac Messages identity</span>
          <input
            value={form.accountId}
            onChange={(event) =>
              setForm((current) => ({ ...current, accountId: event.target.value }))
            }
            placeholder="taskwraith@example.com"
            required
          />
        </label>
        <label className="settings-field messages-bridge-field-wide">
          <span className="settings-field-label">Messages chat GUID</span>
          <input
            value={form.chatGuid}
            onChange={(event) =>
              setForm((current) => ({ ...current, chatGuid: event.target.value }))
            }
            placeholder="iMessage;-;+15551234567"
            required
          />
        </label>
        <div className="messages-bridge-discovery messages-bridge-field-wide">
          <div className="messages-bridge-subsection-header">
            <h4 className="sidebar-section-title" style={{ margin: 0 }}>
              Recent iMessages
            </h4>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={scanningConversations || Boolean(conversationScanBlocker)}
              title={conversationScanBlocker || undefined}
              onClick={() => void scanConversations()}
            >
              {scanningConversations ? 'Scanning...' : 'Scan recent'}
            </button>
          </div>
          <p className="messages-bridge-discovery-hint">
            Best: bind the conversation where your iPhone messages the TaskWraith contact. Use a
            dedicated Apple Account or reachable email when possible. Avoid random human chats and
            groups.
          </p>
          <div className="messages-bridge-conversation-list">
            {conversations.length === 0 ? (
              <div className="settings-audit-empty">No recent conversations loaded.</div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.chatGuid}
                  type="button"
                  className="messages-bridge-conversation-row"
                  onClick={() => applyConversation(conversation)}
                >
                  <span>
                    <strong>{conversationTitle(conversation)}</strong>
                    <small>{conversationSubtitle(conversation, bridgeIdentityValue)}</small>
                  </span>
                  <span>
                    <small>{formatConversationHandles(conversation)}</small>
                    <em>{conversationPreview(conversation)}</em>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
        <label className="settings-field">
          <span className="settings-field-label">Operator channel</span>
          <select
            className="settings-select"
            value={form.appChatId}
            onChange={(event) =>
              setForm((current) => ({ ...current, appChatId: event.target.value }))
            }
            required
          >
            <option value="">Select chat</option>
            {activeChats.map((chat) => (
              <option key={chat.appChatId} value={chat.appChatId}>
                {formatChatLabel(chat)}
              </option>
            ))}
          </select>
        </label>
        <div className="messages-bridge-inline-actions">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => void createOperatorChat()}
          >
            New global chat
          </button>
        </div>
        <label className="settings-field">
          <span className="settings-field-label">Provider</span>
          <select
            className="settings-select"
            value={form.provider}
            onChange={(event) =>
              setForm((current) => ({ ...current, provider: event.target.value as ProviderId }))
            }
          >
            {PROVIDER_OPTIONS.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          <span className="settings-field-label">Trigger prefix</span>
          <input
            value={form.triggerPrefix}
            onChange={(event) =>
              setForm((current) => ({ ...current, triggerPrefix: event.target.value }))
            }
            placeholder="tw"
          />
        </label>
        <div className="messages-bridge-toggle messages-bridge-field-wide">
          <input type="checkbox" checked readOnly />
          <span>
            Require trigger
            <small>
              Incoming messages must begin with the prefix before TaskWraith dispatches.
            </small>
          </span>
        </div>
        <label className="settings-field messages-bridge-field-wide">
          <span className="settings-field-label">Allowed handles</span>
          <textarea
            className="settings-textarea"
            rows={3}
            value={form.allowedHandles}
            onChange={(event) =>
              setForm((current) => ({ ...current, allowedHandles: event.target.value }))
            }
            placeholder="+15551234567, user@example.com"
            required
          />
        </label>
        <div className="messages-bridge-form-actions">
          <button type="submit" className="btn btn-sm" disabled={savingBinding}>
            {savingBinding ? 'Saving...' : 'Save binding'}
          </button>
        </div>
      </form>

      <section className="messages-bridge-subsection" aria-label="iMessage bindings">
        <div className="messages-bridge-subsection-header">
          <h4 className="sidebar-section-title" style={{ margin: 0 }}>
            Bindings
          </h4>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void loadPanel()}>
            Reload
          </button>
        </div>
        <div className="messages-bridge-table">
          {bindings.length === 0 ? (
            <div className="settings-audit-empty">No iMessage bindings configured.</div>
          ) : (
            bindings.map((binding) => {
              const archivedBlocker = binding.archived ? 'Archived links cannot be used.' : null
              const sendBlocker = archivedBlocker || messageBridgeSendBlocker(status, binding)
              const pollBlocker =
                archivedBlocker || messageBridgeBindingPollBlocker(status, binding)
              return (
                <div
                  key={binding.id}
                  className={`messages-bridge-row ${binding.archived ? 'messages-bridge-row-archived' : ''}`}
                >
                  <div>
                    <strong>{binding.label || binding.chatGuid}</strong>
                    <span>{binding.chatGuid}</span>
                  </div>
                  <div>
                    <span>{binding.provider}</span>
                    <code>{binding.triggerPrefix || 'tw'}</code>
                  </div>
                  <div>
                    <span>{binding.allowedHandles.join(', ')}</span>
                    <small>{binding.archived ? 'Archived' : 'Active'}</small>
                  </div>
                  <div className="messages-bridge-row-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={Boolean(sendBlocker) || testingBindingId === binding.id}
                      title={sendBlocker || undefined}
                      onClick={() => void sendTestMessage(binding)}
                    >
                      {testingBindingId === binding.id ? 'Sending...' : 'Test'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={Boolean(pollBlocker) || pollingBindingId === binding.id}
                      title={pollBlocker || undefined}
                      onClick={() => void pollBinding(binding)}
                    >
                      {pollingBindingId === binding.id ? 'Polling...' : 'Poll'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={Boolean(binding.archived)}
                      title={archivedBlocker || undefined}
                      onClick={() => setForm(bindingToForm(binding))}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={Boolean(binding.archived)}
                      title={archivedBlocker || undefined}
                      onClick={() => void archiveBinding(binding.id)}
                    >
                      Archive
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      <section className="messages-bridge-subsection" aria-label="iMessage cursors and audit">
        <div className="messages-bridge-subsection-header">
          <h4 className="sidebar-section-title" style={{ margin: 0 }}>
            Cursors and audit
          </h4>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={cursors.length === 0}
            onClick={() => void clearCursors()}
          >
            Clear cursors
          </button>
        </div>
        {pollSummary && (
          <p className="settings-hint">
            Last manual poll: {pollSummary.polled} rows, {pollSummary.accepted} accepted,{' '}
            {pollSummary.dispatched} dispatched.
            {pollDiagnostic && (
              <>
                <br />
                {pollDiagnostic}
              </>
            )}
          </p>
        )}
        <div className="messages-bridge-cursor-list">
          {cursors.length === 0 ? (
            <span>No cursors saved.</span>
          ) : (
            cursors.map((cursor) => (
              <code key={`${cursor.channel}:${cursor.accountId}:${cursor.chatGuid}`}>
                {cursor.accountId} / {cursor.chatGuid}: row {cursor.lastRowId}
              </code>
            ))
          )}
        </div>
        <div className="messages-bridge-audit-list">
          {audit.length === 0 ? (
            <div className="settings-audit-empty">No channel gateway audit records yet.</div>
          ) : (
            audit.slice(0, 12).map((record) => (
              <div key={record.id} className="messages-bridge-audit-row">
                <span>{formatTimestamp(record.timestamp)}</span>
                <strong>{record.kind}</strong>
                <p>{record.summary}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

function settingsToBridgeState(settings: AppSettings): BridgeSettingsState {
  const pollIntervalMs =
    typeof settings.messageBridgePollIntervalMs === 'number' &&
    Number.isFinite(settings.messageBridgePollIntervalMs)
      ? Math.max(MIN_POLL_INTERVAL_SECONDS * 1000, Math.trunc(settings.messageBridgePollIntervalMs))
      : DEFAULT_POLL_INTERVAL_MS
  return {
    enabled: Boolean(settings.messageBridgeEnabled),
    pollIntervalMs
  }
}

function formToBindingInput(form: BindingFormState): MessageChannelBindingInput {
  const allowedHandles = parseAllowedHandles(form.allowedHandles)
  if (allowedHandles.length === 0) {
    throw new Error('Add at least one allowed iMessage handle.')
  }
  if (allowedHandles.some((handle) => handle === '*')) {
    throw new Error('Allowed handles must be exact phone numbers or iMessage addresses.')
  }
  if (allowedHandles.length > 1) {
    throw new Error('Use one exact operator handle for this MVP.')
  }
  if (isGroupIMessageChatGuid(form.chatGuid)) {
    throw new Error('Use a one-to-one operator iMessage chat, not a group conversation.')
  }
  return {
    ...(form.id ? { id: form.id } : {}),
    channel: 'imessage',
    accountId: form.accountId.trim() || 'mac-default',
    chatGuid: form.chatGuid.trim(),
    allowedHandles,
    appChatId: form.appChatId.trim(),
    provider: form.provider,
    mode: 'operator',
    requireTrigger: true,
    triggerPrefix: form.triggerPrefix.trim() || 'tw',
    ...(form.label.trim() ? { label: form.label.trim() } : {})
  }
}

function bindingToForm(binding: MessageChannelBinding): BindingFormState {
  return {
    id: binding.id,
    label: binding.label || '',
    accountId: binding.accountId || 'mac-default',
    chatGuid: binding.chatGuid,
    allowedHandles: binding.allowedHandles.join('\n'),
    appChatId: binding.appChatId,
    provider: binding.provider,
    requireTrigger: true,
    triggerPrefix: binding.triggerPrefix || 'tw'
  }
}

function bindingFormBlocker(form: BindingFormState, hasBinding: boolean): string | null {
  if (hasBinding) return 'An active operator link already exists.'
  if (isGroupIMessageChatGuid(form.chatGuid)) {
    return 'Use a one-to-one operator iMessage chat. Group conversations are not part of this MVP.'
  }
  const handles = parseAllowedHandles(form.allowedHandles)
  if (handles.some((handle) => handle === '*')) {
    return 'Allowed handle must be one exact phone number or iMessage address.'
  }
  if (handles.length > 1) {
    return 'Use one exact operator handle. Group and multi-person bindings are not part of this MVP.'
  }
  const missing = bindingFieldStatus(form)
    .filter((field) => !field.complete)
    .map((field) => field.label.toLowerCase())
  if (missing.length === 0) return null
  return `Missing ${humanList(missing)}. Scan a recent iMessage to fill these automatically.`
}

function bindingFieldStatus(form: BindingFormState): Array<{ label: string; complete: boolean }> {
  const handles = parseAllowedHandles(form.allowedHandles)
  return [
    { label: 'Chat GUID', complete: Boolean(form.chatGuid.trim()) },
    { label: 'One operator handle', complete: handles.length === 1 && handles[0] !== '*' },
    { label: 'Operator channel', complete: Boolean(form.appChatId.trim()) }
  ]
}

function parseAllowedHandles(value: string): string[] {
  const seen = new Set<string>()
  const handles: string[] = []
  for (const raw of value.split(/[\n,]/)) {
    const handle = raw.trim()
    const key = handle.toLowerCase()
    if (!handle || seen.has(key)) continue
    seen.add(key)
    handles.push(handle)
  }
  return handles
}

function humanList(items: string[]): string {
  if (items.length <= 1) return items[0] || ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

function upsertBindingInList(
  bindings: MessageChannelBinding[],
  binding: MessageChannelBinding
): MessageChannelBinding[] {
  const index = bindings.findIndex((candidate) => candidate.id === binding.id)
  if (index < 0) return [binding, ...bindings]
  const next = [...bindings]
  next[index] = binding
  return next
}

function formatChatLabel(chat: ChatRecord): string {
  const title = chat.title?.trim() || 'Untitled chat'
  const scope =
    chat.scope === 'global' ? 'Global' : chat.workspacePath?.split(/[\\/]/).pop() || 'Workspace'
  return `${title} (${scope})`
}

function conversationTitle(conversation: MessagesBridgeConversation): string {
  const operatorHandle = conversationOperatorHandle(conversation)
  if (operatorHandle && !conversation.displayName?.trim()) {
    return 'Operator conversation with you'
  }
  return (
    conversation.displayName?.trim() ||
    conversation.participantHandles.filter(Boolean).join(', ') ||
    conversation.chatIdentifier?.trim() ||
    conversation.chatGuid
  )
}

function conversationSubtitle(
  conversation: MessagesBridgeConversation,
  bridgeIdentityValue: string
): string {
  if (conversationAppearsSelfToSelf(conversation, bridgeIdentityValue)) {
    return 'May be same-Apple-ID/self-synced'
  }
  if (conversationOperatorHandle(conversation)) {
    return 'TaskWraith contact candidate'
  }
  return conversation.chatGuid
}

function conversationHandles(conversation: MessagesBridgeConversation): string[] {
  const seen = new Set<string>()
  const handles: string[] = []
  const candidates = [
    ...conversation.participantHandles,
    conversation.lastSenderHandle,
    conversation.chatIdentifier
  ]
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (!value || seen.has(value.toLowerCase())) continue
    seen.add(value.toLowerCase())
    handles.push(value)
  }
  return handles
}

function conversationOperatorHandle(conversation: MessagesBridgeConversation): string | null {
  const handles = conversationHandles(conversation)
  const chatIdentifier = conversation.chatIdentifier?.trim()
  if (
    chatIdentifier &&
    isLikelyOperatorHandle(chatIdentifier) &&
    handles.some((handle) => sameHandle(handle, chatIdentifier))
  ) {
    return handles.find((handle) => sameHandle(handle, chatIdentifier)) || chatIdentifier
  }
  const lastSender = conversation.lastSenderHandle?.trim()
  if (lastSender && conversation.lastIsFromMe === false && isLikelyOperatorHandle(lastSender)) {
    return handles.find((handle) => sameHandle(handle, lastSender)) || lastSender
  }
  if (lastSender && conversation.lastIsFromMe === true) {
    const candidates = handles.filter(
      (handle) => !sameHandle(handle, lastSender) && isLikelyOperatorHandle(handle)
    )
    if (candidates.length === 1) return candidates[0]
  }
  const likelyHandles = handles.filter(isLikelyOperatorHandle)
  return likelyHandles.length === 1 ? likelyHandles[0] : null
}

function sameHandle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function isLikelyOperatorHandle(value: string): boolean {
  const trimmed = value.trim()
  return trimmed.includes('@') || /^\+?[\d\s().-]{7,}$/.test(trimmed)
}

function conversationAppearsSelfToSelf(
  conversation: MessagesBridgeConversation,
  bridgeIdentityValue: string
): boolean {
  const operatorHandle = conversationOperatorHandle(conversation)
  const bridgeIdentity = bridgeIdentityValue.trim()
  if (
    operatorHandle &&
    bridgeIdentity &&
    !isPlaceholderBridgeIdentity(bridgeIdentity) &&
    sameHandle(operatorHandle, bridgeIdentity)
  ) {
    return true
  }
  const handles = conversationHandles(conversation)
  return Boolean(conversation.lastIsFromMe && handles.length === 0)
}

function formatBridgeIdentityLabel(value: string): string {
  const trimmed = value.trim()
  return isPlaceholderBridgeIdentity(trimmed) ? 'TaskWraith iMessage address' : trimmed
}

function isPlaceholderBridgeIdentity(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  return !trimmed || trimmed === 'mac-default'
}

function isGroupIMessageChatGuid(value: string): boolean {
  return /^imessage;\+;/i.test(value.trim())
}

function formatConversationHandles(conversation: MessagesBridgeConversation): string {
  const handles = conversationHandles(conversation)
  return handles.length > 0 ? handles.join(', ') : 'No handles'
}

function conversationPreview(conversation: MessagesBridgeConversation): string {
  const text = conversation.lastMessageText?.replace(/\s+/g, ' ').trim()
  if (!text) return conversation.lastTimestamp ? formatTimestamp(conversation.lastTimestamp) : ''
  const preview = text.length > 90 ? `${text.slice(0, 87)}...` : text
  return conversation.lastTimestamp
    ? `${formatTimestamp(conversation.lastTimestamp)} - ${preview}`
    : preview
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function auditCommandName(record: MessageChannelAuditRecord): string | null {
  const command = record.payload?.command
  if (typeof command === 'string') return command
  if (!command || typeof command !== 'object') return null
  const name = (command as { name?: unknown }).name
  return typeof name === 'string' ? name : null
}
