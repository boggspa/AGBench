#!/usr/bin/env node

/**
 * smoke-bridge-daemon-roundtrip
 *
 * Self-contained daemon smoke. Spawns TaskWraithBridgeDaemon, waits for the
 * daemon-hello line, then verifies the inbound stdio JSON-RPC request/response
 * path with bridge.ping, bridge.status, and a synthetic Messages.app database
 * for messages.status / messages.conversations / messages.poll, including
 * the latest-first diagnostic poll mode used by the setup UI. The removed
 * remote-iOS transport layer no longer emits daemon-originated requests or
 * run-event broadcasts.
 */

const { spawn, spawnSync } = require('child_process')
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('fs')
const { tmpdir } = require('os')
const { createInterface } = require('readline')
const { join } = require('path')
const { randomUUID } = require('crypto')

const REPO_ROOT = join(__dirname, '..')
const BRIDGE_BUILD_ROOT = join(REPO_ROOT, 'swift', 'TaskWraithBridge', '.build')
const BIN_PATH =
  process.env.TASKWRAITH_BRIDGE_DAEMON_PATH ||
  [
    join(BRIDGE_BUILD_ROOT, 'release', 'TaskWraithBridgeDaemon'),
    join(BRIDGE_BUILD_ROOT, 'debug', 'TaskWraithBridgeDaemon')
  ].find((candidate) => existsSync(candidate))
const TIMEOUT_MS = Number(process.env.BRIDGE_SMOKE_TIMEOUT_MS || 8000)

if (!BIN_PATH || !existsSync(BIN_PATH)) {
  console.error('[smoke-bridge-daemon-roundtrip] daemon binary not found.')
  console.error('Run: npm run prebuild:bridge-daemon and try again.')
  process.exit(2)
}

const tempDir = mkdtempSync(join(tmpdir(), 'taskwraith-bridge-smoke-'))
const syntheticMessagesDb = join(tempDir, 'chat.db')

const pingId = randomUUID()
const statusId = randomUUID()
const messagesStatusId = randomUUID()
const messagesConversationsId = randomUUID()
const messagesPollId = randomUUID()
const messagesLatestPollId = randomUUID()

let helloSeen = false
let pingSeen = false
let statusSeen = false
let messagesStatusSeen = false
let messagesConversationsSeen = false
let messagesPollSeen = false
let messagesLatestPollSeen = false
let stderrTail = ''

try {
  createSyntheticMessagesDatabase(syntheticMessagesDb)
} catch (err) {
  rmSync(tempDir, { recursive: true, force: true })
  console.error(
    `[smoke-bridge-daemon-roundtrip] synthetic Messages database setup failed: ${
      err && err.message ? err.message : String(err)
    }`
  )
  process.exit(2)
}

const proc = spawn(BIN_PATH, [], {
  shell: false,
  stdio: 'pipe',
  env: {
    ...process.env,
    TASKWRAITH_MESSAGES_DB_PATH_FOR_TESTING: syntheticMessagesDb
  }
})

const timer = setTimeout(() => {
  fail(
    `Timed out after ${TIMEOUT_MS}ms. helloSeen=${helloSeen} pingSeen=${pingSeen} statusSeen=${statusSeen} messagesStatusSeen=${messagesStatusSeen} messagesConversationsSeen=${messagesConversationsSeen} messagesPollSeen=${messagesPollSeen} messagesLatestPollSeen=${messagesLatestPollSeen}`
  )
}, TIMEOUT_MS)
timer.unref?.()

function teardown() {
  clearTimeout(timer)
  try {
    proc.stdin.end()
  } catch {
    // Best effort: the daemon may have already closed stdin.
  }
  setTimeout(() => {
    if (!proc.killed) {
      try {
        proc.kill('SIGTERM')
      } catch {
        // Best effort: process teardown should not mask smoke-test outcome.
      }
    }
  }, 250).unref?.()
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // Best effort cleanup.
  }
}

function pass() {
  teardown()
  console.log(
    '[smoke-bridge-daemon-roundtrip] OK — hello + ping + status + synthetic Messages RPCs + latest-first diagnostics observed'
  )
  process.exit(0)
}

function fail(reason) {
  teardown()
  console.error(`[smoke-bridge-daemon-roundtrip] FAIL — ${reason}`)
  if (stderrTail) {
    console.error('--- daemon stderr (tail) ---')
    console.error(stderrTail.trimEnd())
  }
  process.exit(1)
}

function maybeFinish() {
  if (
    helloSeen &&
    pingSeen &&
    statusSeen &&
    messagesStatusSeen &&
    messagesConversationsSeen &&
    messagesPollSeen &&
    messagesLatestPollSeen
  ) {
    pass()
  }
}

function writeStdinLine(envelope) {
  try {
    proc.stdin.write(`${JSON.stringify(envelope)}\n`)
  } catch (err) {
    fail(`stdin write failed: ${err && err.message ? err.message : String(err)}`)
  }
}

function sendRequests() {
  writeStdinLine({ jsonrpc: '2.0', id: pingId, method: 'bridge.ping', params: {} })
  writeStdinLine({ jsonrpc: '2.0', id: statusId, method: 'bridge.status', params: {} })
  writeStdinLine({ jsonrpc: '2.0', id: messagesStatusId, method: 'messages.status', params: {} })
  writeStdinLine({
    jsonrpc: '2.0',
    id: messagesConversationsId,
    method: 'messages.conversations',
    params: { accountId: 'smoke', limit: 5 }
  })
  writeStdinLine({
    jsonrpc: '2.0',
    id: messagesPollId,
    method: 'messages.poll',
    params: {
      accountId: 'smoke',
      chatGuid: 'iMessage;-;smoke-chat',
      afterRowId: 0,
      limit: 5,
      includeFromMe: false
    }
  })
  writeStdinLine({
    jsonrpc: '2.0',
    id: messagesLatestPollId,
    method: 'messages.poll',
    params: {
      accountId: 'smoke',
      chatGuid: 'iMessage;-;smoke-chat',
      afterRowId: 0,
      limit: 2,
      includeFromMe: true,
      latestFirst: true
    }
  })
}

const stdoutReader = createInterface({ input: proc.stdout })
stdoutReader.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    fail(`Non-JSON output line: ${trimmed.slice(0, 200)}`)
    return
  }
  if (!parsed || typeof parsed !== 'object') return

  if (parsed.kind === 'daemon-hello') {
    if (parsed.daemon !== 'TaskWraithBridgeDaemon') {
      fail(`hello had unexpected daemon field: ${JSON.stringify(parsed)}`)
      return
    }
    if (parsed.remoteTransportEnabled !== false) {
      fail(`hello did not report remoteTransportEnabled=false: ${JSON.stringify(parsed)}`)
      return
    }
    helloSeen = true
    sendRequests()
    return
  }

  if (String(parsed.id) === pingId) {
    if (parsed.error || parsed.result?.pong !== true) {
      fail(`bridge.ping returned unexpected response: ${JSON.stringify(parsed)}`)
      return
    }
    pingSeen = true
    maybeFinish()
    return
  }

  if (String(parsed.id) === statusId) {
    if (
      parsed.error ||
      parsed.result?.daemon !== 'TaskWraithBridgeDaemon' ||
      parsed.result?.remoteTransportEnabled !== false ||
      parsed.result?.screenWatchEnabled !== true
    ) {
      fail(`bridge.status returned unexpected response: ${JSON.stringify(parsed)}`)
      return
    }
    statusSeen = true
    maybeFinish()
    return
  }

  if (String(parsed.id) === messagesStatusId) {
    if (
      parsed.error ||
      parsed.result?.ok !== true ||
      parsed.result?.databasePath !== syntheticMessagesDb ||
      parsed.result?.pollSupported !== true ||
      parsed.result?.sendTextSupported !== true ||
      parsed.result?.sendAttachmentSupported !== true ||
      parsed.result?.automationRequiresUserConsent !== true
    ) {
      fail(`messages.status returned unexpected response: ${JSON.stringify(parsed)}`)
      return
    }
    messagesStatusSeen = true
    maybeFinish()
    return
  }

  if (String(parsed.id) === messagesConversationsId) {
    const conversation = parsed.result?.conversations?.[0]
    if (
      parsed.error ||
      parsed.result?.accountId !== 'smoke' ||
      conversation?.chatGuid !== 'iMessage;-;smoke-chat' ||
      !conversation?.participantHandles?.includes('operator@example.com')
    ) {
      fail(`messages.conversations returned unexpected response: ${JSON.stringify(parsed)}`)
      return
    }
    messagesConversationsSeen = true
    maybeFinish()
    return
  }

  if (String(parsed.id) === messagesPollId) {
    const message = parsed.result?.messages?.[0]
    if (
      parsed.error ||
      parsed.result?.accountId !== 'smoke' ||
      message?.chatGuid !== 'iMessage;-;smoke-chat' ||
      message?.messageGuid !== 'smoke-message-1' ||
      message?.attachments?.[0]?.filename !== 'smoke.png'
    ) {
      fail(`messages.poll returned unexpected response: ${JSON.stringify(parsed)}`)
      return
    }
    messagesPollSeen = true
    maybeFinish()
    return
  }

  if (String(parsed.id) === messagesLatestPollId) {
    const messages = parsed.result?.messages || []
    if (
      parsed.error ||
      parsed.result?.accountId !== 'smoke' ||
      messages.length !== 2 ||
      messages[0]?.messageGuid !== 'smoke-message-2' ||
      messages[0]?.isFromMe !== true ||
      messages[1]?.messageGuid !== 'smoke-message-1'
    ) {
      fail(`messages.poll latestFirst returned unexpected response: ${JSON.stringify(parsed)}`)
      return
    }
    messagesLatestPollSeen = true
    maybeFinish()
  }
})

proc.stderr.on('data', (chunk) => {
  stderrTail += chunk.toString('utf8')
  if (stderrTail.length > 4096) stderrTail = stderrTail.slice(-4096)
})

proc.on('exit', (code, signal) => {
  if (!(helloSeen && pingSeen && statusSeen)) {
    fail(`daemon exited early (code=${code} signal=${signal})`)
  }
})

proc.on('error', (err) => {
  fail(`spawn error: ${err && err.message ? err.message : String(err)}`)
})

function createSyntheticMessagesDatabase(databasePath) {
  const sql = `
CREATE TABLE handle (id TEXT);
CREATE TABLE chat (
  guid TEXT,
  display_name TEXT,
  chat_identifier TEXT,
  service_name TEXT
);
CREATE TABLE message (
  guid TEXT,
  handle_id INTEGER,
  text TEXT,
  date INTEGER,
  is_from_me INTEGER
);
CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
CREATE TABLE attachment (
  guid TEXT,
  filename TEXT,
  mime_type TEXT,
  uti TEXT,
  total_bytes INTEGER
);
CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);

INSERT INTO handle(rowid, id) VALUES
  (1, 'operator@example.com'),
  (2, 'desktop@example.com');
INSERT INTO chat(rowid, guid, display_name, chat_identifier, service_name) VALUES
  (1, 'iMessage;-;smoke-chat', 'Smoke Operator', 'smoke-chat', 'iMessage');
INSERT INTO chat_handle_join(chat_id, handle_id) VALUES
  (1, 1),
  (1, 2);
INSERT INTO message(rowid, guid, handle_id, text, date, is_from_me) VALUES
  (1, 'smoke-message-1', 1, 'tw smoke test', 1, 0),
  (2, 'smoke-message-2', 2, 'TaskWraith: smoke reply', 2, 1);
INSERT INTO chat_message_join(chat_id, message_id) VALUES
  (1, 1),
  (1, 2);
INSERT INTO attachment(rowid, guid, filename, mime_type, uti, total_bytes) VALUES
  (1, 'smoke-attachment-1', '~/Library/Messages/Attachments/smoke.png', 'image/png', 'public.png', 12);
INSERT INTO message_attachment_join(message_id, attachment_id) VALUES
  (1, 1);
`
  writeFileSync(join(tempDir, 'messages.sql'), sql, 'utf8')

  const sqlite = spawnSync('sqlite3', [databasePath], {
    input: sql,
    encoding: 'utf8',
    shell: false,
    timeout: 4000
  })
  if (sqlite.error) {
    throw new Error(`sqlite3 synthetic database creation failed: ${sqlite.error.message}`)
  }
  if (sqlite.status !== 0) {
    throw new Error(`sqlite3 synthetic database creation failed: ${sqlite.stderr.trim()}`)
  }
}
