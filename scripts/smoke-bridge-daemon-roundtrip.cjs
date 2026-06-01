#!/usr/bin/env node

/**
 * smoke-bridge-daemon-roundtrip
 *
 * Phase C3.5.6 smoke test. Exercises the full bidirectional JSON-RPC path:
 *
 *   smoke → daemon:   `bridge.testFireRequest`
 *   daemon → smoke:   `ui.testEcho`     (the daemon's outbound request)
 *   smoke → daemon:   response to `ui.testEcho`
 *   daemon → smoke:   response to `bridge.testFireRequest` containing what
 *                     the smoke answered above
 *
 * This proves:
 *   - BridgeStdoutWriter doesn't interleave concurrent emissions.
 *   - BridgeRequester correctly issues an outbound request and awaits.
 *   - The dispatch loop routes inbound stdin lines to either the requester
 *     (responses) or the dispatcher (requests/notifications).
 *   - The Electron-side `onRequest` handler in BridgeDaemonClient is mirrored
 *     correctly here: any peer that participates in JSON-RPC over stdio can
 *     answer a daemon request.
 *
 * Usage:
 *   node scripts/smoke-bridge-daemon-roundtrip.cjs
 *
 * Prereq: `swift build` has been run inside `swift/AgbenchBridge` so the
 * `.build/debug/AgbenchBridgeDaemon` binary exists.
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
  'AgbenchBridge',
  '.build',
  'debug',
  'AgbenchBridgeDaemon'
)
const TIMEOUT_MS = Number(process.env.BRIDGE_SMOKE_TIMEOUT_MS || 10_000)

if (!existsSync(BIN_PATH)) {
  console.error(`[smoke-bridge-daemon-roundtrip] daemon binary not found at ${BIN_PATH}`)
  console.error('Run: (cd swift/AgbenchBridge && swift build) and try again.')
  process.exit(2)
}

// Test payload — the daemon will echo this back via the round-trip.
const echoMethod = 'ui.testEcho'
const echoPayload = {
  kind: 'roundtrip-smoke',
  number: 7,
  list: [1, 'two', false, null],
  nested: { deep: { ok: true } }
}
// The daemon-side handler will return this exact object; the smoke then
// verifies it propagates through `daemonReceivedFromElectron`.
const smokeAnswer = {
  echoed: echoPayload,
  fromSmoke: true,
  greeting: 'hello-from-smoke'
}

const fireRequestId = randomUUID()
const fakeTailscaleStatus = {
  Version: '1.56.1-smoke',
  TailscaleIPs: ['100.64.10.20', 'fd7a:115c:a1e0::1'],
  Self: {
    HostName: 'smoke-mac',
    DNSName: 'smoke-mac.tail-smoke.ts.net',
    TailscaleIPs: ['100.64.10.20', 'fd7a:115c:a1e0::1']
  },
  BackendState: 'Running'
}

let helloSeen = false
let tailnetEndpointSeen = false
let inboundEchoHandled = false
let fireRequestResponseSeen = false
let stderrTail = ''

const proc = spawn(BIN_PATH, [], {
  shell: false,
  stdio: 'pipe',
  env: {
    ...process.env,
    AGBENCH_BRIDGE_TAILSCALE_STATUS_JSON: JSON.stringify(fakeTailscaleStatus)
  }
})

const timer = setTimeout(() => {
  fail(
    `Timed out after ${TIMEOUT_MS}ms. helloSeen=${helloSeen} tailnetEndpointSeen=${tailnetEndpointSeen} inboundEchoHandled=${inboundEchoHandled} fireRequestResponseSeen=${fireRequestResponseSeen}`
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
  console.log('[smoke-bridge-daemon-roundtrip] OK — full bidirectional round-trip observed')
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
  if (helloSeen && tailnetEndpointSeen && inboundEchoHandled && fireRequestResponseSeen) pass()
}

function writeStdinLine(envelope) {
  try {
    proc.stdin.write(`${JSON.stringify(envelope)}\n`)
  } catch (err) {
    fail(`stdin write failed: ${err && err.message ? err.message : String(err)}`)
  }
}

function sendFireRequest() {
  writeStdinLine({
    jsonrpc: '2.0',
    id: fireRequestId,
    method: 'bridge.testFireRequest',
    params: {
      outboundMethod: echoMethod,
      outboundParams: echoPayload,
      timeoutSeconds: 5
    }
  })
}

function deepEqual(a, b) {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (!deepEqual(a[k], b[k])) return false
  }
  return true
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

  // Daemon hello (one-shot, first line)
  if (parsed.kind === 'daemon-hello') {
    helloSeen = true
    const endpoints = Array.isArray(parsed.directEndpoints) ? parsed.directEndpoints : []
    const tailnetEndpoint = endpoints.find(
      (endpoint) =>
        endpoint &&
        endpoint.kind === 'quicTailscale' &&
        endpoint.host === '100.64.10.20' &&
        endpoint.port === 38747
    )
    if (!tailnetEndpoint || parsed.tailscaleEndpoint?.ipv4 !== '100.64.10.20') {
      fail(`daemon hello did not advertise fake tailnet endpoint: ${JSON.stringify(parsed)}`)
      return
    }
    tailnetEndpointSeen = true
    sendFireRequest()
    return
  }

  // Inbound request from the daemon: daemon is asking us `ui.testEcho`.
  // Same classification logic as BridgeDaemonClient — id + method + no result/error.
  const hasId = typeof parsed.id === 'string' || typeof parsed.id === 'number'
  const hasResultOrError = 'result' in parsed || 'error' in parsed
  if (hasId && parsed.method && !hasResultOrError) {
    if (parsed.method !== echoMethod) {
      fail(`unexpected inbound request method: ${parsed.method}`)
      return
    }
    if (!deepEqual(parsed.params, echoPayload)) {
      fail(`inbound request params lost fidelity: ${JSON.stringify(parsed.params)}`)
      return
    }
    // Answer the daemon's request. The response envelope is what
    // BridgeDaemonClient.respondResult writes.
    writeStdinLine({ jsonrpc: '2.0', id: String(parsed.id), result: smokeAnswer })
    inboundEchoHandled = true
    return
  }

  // Response to our outbound `bridge.testFireRequest`.
  if (hasId && String(parsed.id) === fireRequestId) {
    if (parsed.error) {
      fail(`bridge.testFireRequest returned error: ${JSON.stringify(parsed.error)}`)
      return
    }
    const result = parsed.result
    if (!result || result.outboundMethod !== echoMethod) {
      fail(`testFireRequest result shape unexpected: ${JSON.stringify(result)}`)
      return
    }
    if (!deepEqual(result.daemonReceivedFromElectron, smokeAnswer)) {
      fail(
        `daemon did not receive our answer faithfully. got=${JSON.stringify(result.daemonReceivedFromElectron)} expected=${JSON.stringify(smokeAnswer)}`
      )
      return
    }
    fireRequestResponseSeen = true
    maybeFinish()
    return
  }
})

proc.stderr.on('data', (chunk) => {
  stderrTail += chunk.toString('utf8')
  if (stderrTail.length > 4096) stderrTail = stderrTail.slice(-4096)
})

proc.on('exit', (code, signal) => {
  const incomplete = !(
    helloSeen &&
    tailnetEndpointSeen &&
    inboundEchoHandled &&
    fireRequestResponseSeen
  )
  if (incomplete) {
    fail(`daemon exited early (code=${code} signal=${signal})`)
  }
})

proc.on('error', (err) => {
  fail(`spawn error: ${err && err.message ? err.message : String(err)}`)
})
