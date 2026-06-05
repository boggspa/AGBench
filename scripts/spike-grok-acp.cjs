#!/usr/bin/env node

// THROWAWAY spike harness for `grok agent stdio` — probing the ACP-style
// JSON-RPC wire protocol so we can decide whether ACP can preserve TaskWraith's
// permission/tool authority for a write-capable Grok adapter (1.0.6-G1).
//
// NOT production code. It spawns `grok --no-auto-update agent stdio`, sends a
// scripted sequence of JSON-RPC frames (newline-delimited by default; pass
// FRAMING=lsp for Content-Length framing), logs ALL raw stdout/stderr, then
// kills the child. Only `session/prompt` would call the model; the
// initialize/session-new handshake does not.
//
// Usage:
//   node scripts/spike-grok-acp.cjs                 # initialize only
//   STAGE=session node scripts/spike-grok-acp.cjs   # + session/new
//   STAGE=prompt  node scripts/spike-grok-acp.cjs   # + a tiny prompt
//   FRAMING=lsp   node scripts/spike-grok-acp.cjs   # LSP Content-Length frames

const { spawn } = require('node:child_process')
const os = require('node:os')
const path = require('node:path')

const GROK = process.env.GROK_BIN || path.join(os.homedir(), '.grok', 'bin', 'grok')
const FRAMING = process.env.FRAMING || 'ndjson'
const STAGE = process.env.STAGE || 'initialize'
const CWD = process.env.SPIKE_CWD || os.tmpdir()

const child = spawn(GROK, ['--no-auto-update', 'agent', 'stdio'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: CWD,
  env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
})

const log = (tag, value) => process.stdout.write(`${tag} ${value}\n`)

let capturedSessionId = ''
let promptSent = false
child.stdout.on('data', (d) => {
  const text = d.toString()
  log('[stdout]', JSON.stringify(text))
  const match = text.match(/"sessionId":"([^"]+)"/)
  if (match && !capturedSessionId) {
    capturedSessionId = match[1]
    log('[captured]', `sessionId=${capturedSessionId}`)
    if (STAGE === 'prompt' && !promptSent) {
      promptSent = true
      // Step 3 — a trivial prompt over the captured session (the only step
      // that calls the model). Confirms session/update delta shape + any
      // session/request_permission round-trips.
      rpc('session/prompt', {
        sessionId: capturedSessionId,
        prompt: [{ type: 'text', text: 'hi' }]
      })
    }
  }
})
child.stderr.on('data', (d) => log('[stderr]', JSON.stringify(d.toString())))
child.on('error', (e) => log('[error]', e.message))
child.on('exit', (code, sig) => {
  log('[exit]', `code=${code} sig=${sig}`)
  process.exit(0)
})

function send(obj) {
  const json = JSON.stringify(obj)
  log('[send]', json)
  if (FRAMING === 'lsp') {
    const body = Buffer.from(json, 'utf8')
    child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    child.stdin.write(body)
  } else {
    child.stdin.write(json + '\n')
  }
}

let nextId = 1
const rpc = (method, params) => send({ jsonrpc: '2.0', id: nextId++, method, params })

// Step 1 — initialize handshake (ACP / Zed Agent Client Protocol shape).
rpc('initialize', {
  protocolVersion: 1,
  clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
  clientInfo: { name: 'taskwraith-spike', version: '0.0.0' }
})

if (STAGE === 'session' || STAGE === 'prompt') {
  setTimeout(() => {
    // Step 2 — create a session. Probe whether it accepts cwd / mcpServers.
    rpc('session/new', { cwd: CWD, mcpServers: [] })
  }, 1500)
}

// Step 3 (STAGE=prompt) is sent from the stdout handler once session/new
// returns a real sessionId (see capturedSessionId above).

setTimeout(
  () => {
    log('[timeout]', 'killing child')
    child.kill('SIGINT')
    setTimeout(() => process.exit(0), 500)
  },
  STAGE === 'prompt' ? 14000 : STAGE === 'session' ? 6000 : 4000
)
