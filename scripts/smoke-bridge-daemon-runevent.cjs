#!/usr/bin/env node

/**
 * smoke-bridge-daemon-runevent
 *
 * Phase C-late slice "stream events to iOS" smoke. Verifies that
 * `bridge.runEvent` notifications sent from Electron → daemon get
 * received, re-encoded, and dispatched into `TransportListener.broadcastRunEvent`.
 *
 * Since no real iOS peer is connected during the smoke, the broadcast
 * is a no-op at the QUIC layer — but the daemon writes a stderr log
 * line confirming the JSON was re-encoded and the broadcast call was
 * issued. This proves the full Electron → daemon → TransportListener
 * chain is wired.
 *
 * Usage:
 *   node scripts/smoke-bridge-daemon-runevent.cjs
 *
 * Prereq: `swift build` has been run inside `swift/GuiGeminiBridge`.
 */

const { spawn } = require('child_process')
const { existsSync } = require('fs')
const { createInterface } = require('readline')
const { join } = require('path')

const REPO_ROOT = join(__dirname, '..')
const BIN_PATH = join(
  REPO_ROOT,
  'swift',
  'GuiGeminiBridge',
  '.build',
  'debug',
  'GuiGeminiBridgeDaemon'
)
const TIMEOUT_MS = Number(process.env.BRIDGE_SMOKE_TIMEOUT_MS || 8000)

if (!existsSync(BIN_PATH)) {
  console.error(`[smoke-bridge-daemon-runevent] daemon binary not found at ${BIN_PATH}`)
  console.error('Run: (cd swift/GuiGeminiBridge && swift build) and try again.')
  process.exit(2)
}

const wireEvent = {
  channel: 'agent-output',
  provider: 'gemini',
  payload: { kind: 'stream', text: 'hello from the run-event smoke', appRunId: 'run-smoke-1' },
  publishedAt: '2026-05-15T13:00:00Z'
}

let helloSeen = false
let broadcastLogSeen = false
let stderrTail = ''
let exitedEarly = false

const proc = spawn(BIN_PATH, [], { shell: false, stdio: 'pipe' })

const timer = setTimeout(() => {
  fail(
    `Timed out after ${TIMEOUT_MS}ms. helloSeen=${helloSeen} broadcastLogSeen=${broadcastLogSeen}`
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
}

function pass() {
  teardown()
  console.log(
    '[smoke-bridge-daemon-runevent] OK — daemon received notification and issued broadcast'
  )
  process.exit(0)
}

function fail(reason) {
  teardown()
  console.error(`[smoke-bridge-daemon-runevent] FAIL — ${reason}`)
  if (stderrTail) {
    console.error('--- daemon stderr (tail) ---')
    console.error(stderrTail.trimEnd())
  }
  process.exit(1)
}

function sendNotification() {
  const envelope = {
    jsonrpc: '2.0',
    method: 'bridge.runEvent',
    params: wireEvent
  }
  try {
    proc.stdin.write(`${JSON.stringify(envelope)}\n`)
  } catch (err) {
    fail(`stdin write failed: ${err && err.message ? err.message : String(err)}`)
  }
}

const stdoutReader = createInterface({ input: proc.stdout })
stdoutReader.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return
  }
  if (parsed && parsed.kind === 'daemon-hello') {
    helloSeen = true
    sendNotification()
  }
})

proc.stderr.on('data', (chunk) => {
  const text = chunk.toString('utf8')
  stderrTail += text
  if (stderrTail.length > 4096) stderrTail = stderrTail.slice(-4096)
  // The daemon emits one of these per bridge.runEvent handled.
  if (
    text.includes('[bridge.runEvent] broadcast') &&
    text.includes('channel=agent-output') &&
    text.includes('provider=gemini')
  ) {
    broadcastLogSeen = true
    pass()
  }
})

proc.on('exit', (code, signal) => {
  exitedEarly = !(helloSeen && broadcastLogSeen)
  if (exitedEarly) {
    fail(`daemon exited early (code=${code} signal=${signal})`)
  }
})

proc.on('error', (err) => {
  fail(`spawn error: ${err && err.message ? err.message : String(err)}`)
})
