#!/usr/bin/env node

/**
 * smoke-bridge-daemon-notify
 *
 * Phase C3-late.4 smoke test. Spawns the `GuiGeminiBridgeDaemon` Swift binary
 * directly, reads its stdout line-by-line, and verifies the JSON-RPC
 * notification path works end-to-end:
 *
 *   1. Wait for `daemon-hello` startup line.
 *   2. Send `bridge.testNotify` request with a synthetic payload.
 *   3. Receive BOTH:
 *      - a JSON-RPC response (id matches our request, result.published=true)
 *      - a JSON-RPC notification (method + params we asked the daemon to emit)
 *   4. Exit 0 on success, non-zero (with diagnostics) on failure.
 *
 * Runs intentionally outside the Electron app so we can validate the wire
 * protocol independently of the renderer/main bootstrap. The TS-side
 * `BridgeDaemonClient` is the production caller; this script proves the
 * daemon-side surface it depends on.
 *
 * Usage:
 *   node scripts/smoke-bridge-daemon-notify.cjs
 *
 * Prereq: `swift build` has been run inside `swift/GuiGeminiBridge` so the
 * `.build/debug/GuiGeminiBridgeDaemon` binary exists.
 */

const { spawn } = require('child_process')
const { existsSync } = require('fs')
const { createInterface } = require('readline')
const { join } = require('path')
const { randomUUID } = require('crypto')

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
  console.error(`[smoke-bridge-daemon-notify] daemon binary not found at ${BIN_PATH}`)
  console.error('Run: (cd swift/GuiGeminiBridge && swift build) and try again.')
  process.exit(2)
}

const testMethod = 'bridge.didReceiveSmokeTest'
const testPayload = {
  hello: 'world',
  number: 42,
  nested: { a: 1, b: [true, false] }
}
const requestId = randomUUID()

let helloSeen = false
let responseSeen = false
let notificationSeen = false
let exitedEarly = false
let stderrTail = ''

const finalizeAttempts = []

const proc = spawn(BIN_PATH, [], { shell: false, stdio: 'pipe' })

const timer = setTimeout(() => {
  fail(
    `Timed out after ${TIMEOUT_MS}ms. helloSeen=${helloSeen} responseSeen=${responseSeen} notificationSeen=${notificationSeen}`
  )
}, TIMEOUT_MS)
timer.unref?.()

function teardown() {
  clearTimeout(timer)
  try {
    proc.stdin.end()
  } catch {}
  setTimeout(() => {
    if (!proc.killed) {
      try {
        proc.kill('SIGTERM')
      } catch {}
    }
  }, 250).unref?.()
}

function pass() {
  teardown()
  console.log('[smoke-bridge-daemon-notify] OK — hello + response + notification all observed')
  process.exit(0)
}

function fail(reason) {
  teardown()
  console.error(`[smoke-bridge-daemon-notify] FAIL — ${reason}`)
  if (stderrTail) {
    console.error('--- daemon stderr (tail) ---')
    console.error(stderrTail.trimEnd())
  }
  process.exit(1)
}

function maybeFinish() {
  if (helloSeen && responseSeen && notificationSeen) pass()
}

function sendRequest() {
  const envelope = {
    jsonrpc: '2.0',
    id: requestId,
    method: 'bridge.testNotify',
    params: {
      method: testMethod,
      payload: testPayload
    }
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
    fail(`Non-JSON output line: ${trimmed.slice(0, 200)}`)
    return
  }
  if (!parsed || typeof parsed !== 'object') return

  // 1) Daemon hello announcement (one-shot).
  if (parsed.kind === 'daemon-hello') {
    if (typeof parsed.daemon !== 'string' || parsed.daemon !== 'GuiGeminiBridgeDaemon') {
      fail(`hello had unexpected daemon field: ${JSON.stringify(parsed)}`)
      return
    }
    helloSeen = true
    sendRequest()
    return
  }

  // 2) Response to our request.
  if (parsed.id === requestId) {
    if (parsed.error) {
      fail(`testNotify returned error: ${JSON.stringify(parsed.error)}`)
      return
    }
    if (
      !parsed.result ||
      parsed.result.published !== true ||
      parsed.result.method !== testMethod
    ) {
      fail(`testNotify result shape unexpected: ${JSON.stringify(parsed.result)}`)
      return
    }
    responseSeen = true
    maybeFinish()
    return
  }

  // 3) The notification we asked the daemon to emit.
  if (parsed.method === testMethod) {
    const params = parsed.params
    if (
      !params ||
      params.hello !== testPayload.hello ||
      params.number !== testPayload.number ||
      !params.nested ||
      params.nested.a !== 1 ||
      !Array.isArray(params.nested.b) ||
      params.nested.b[0] !== true ||
      params.nested.b[1] !== false
    ) {
      fail(`notification params lost fidelity: ${JSON.stringify(params)}`)
      return
    }
    if (parsed.jsonrpc !== '2.0') {
      fail(`notification missing jsonrpc=2.0 marker: ${JSON.stringify(parsed)}`)
      return
    }
    notificationSeen = true
    maybeFinish()
    return
  }

  // Anything else — likely an unrelated future notification. Record briefly
  // so failures have context.
  finalizeAttempts.push(trimmed.slice(0, 160))
  if (finalizeAttempts.length > 16) finalizeAttempts.shift()
})

proc.stderr.on('data', (chunk) => {
  stderrTail += chunk.toString('utf8')
  if (stderrTail.length > 4096) stderrTail = stderrTail.slice(-4096)
})

proc.on('exit', (code, signal) => {
  exitedEarly = !(helloSeen && responseSeen && notificationSeen)
  if (exitedEarly) {
    fail(`daemon exited early (code=${code} signal=${signal})`)
  }
})

proc.on('error', (err) => {
  fail(`spawn error: ${err && err.message ? err.message : String(err)}`)
})
