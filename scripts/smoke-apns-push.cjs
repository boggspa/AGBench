#!/usr/bin/env node

/**
 * smoke-apns-push
 *
 * End-to-end smoke test for the APNs wake-push path. Self-contained: signs
 * a JWT with the user's .p8 key, opens HTTP/2 to Apple's sandbox or
 * production gateway, and sends ONE push to a real device token. Reports
 * Apple's response (apns-id header + body) and exits non-zero on
 * delivery failure.
 *
 * This script intentionally re-implements the JWT + HTTP/2 logic that
 * lives in `src/main/Http2ApnsPusher.ts`, so the smoke can validate
 * the credentials and the wire protocol independently of any AGBench
 * code. If the smoke succeeds, the Http2ApnsPusher class should also
 * succeed with the same inputs.
 *
 * Required environment variables:
 *   AGBENCH_APNS_KEY_PATH      — path to AuthKey_XXXXXXXXXX.p8
 *   AGBENCH_APNS_KEY_ID        — 10-char Key ID from Apple Developer Keys
 *   AGBENCH_APNS_TEAM_ID       — 10-char Team ID from membership page
 *   AGBENCH_APNS_BUNDLE_ID     — iOS bundle id (e.g. com.example.AGBench.ios)
 *   AGBENCH_APNS_DEVICE_TOKEN  — 64-char hex device token from a paired iPhone
 *
 * Optional environment variables:
 *   AGBENCH_APNS_ENV           — 'sandbox' (default) or 'production'
 *   AGBENCH_APNS_PUSH_KIND     — 'approval' (default), 'silent', or 'both'
 *   AGBENCH_APNS_SUMMARY       — body text override for approval push
 *   AGBENCH_APNS_TIMEOUT_MS    — request timeout (default 10000)
 *
 * Exit codes:
 *   0  — push delivered (Apple returned :status 200)
 *   2  — missing or malformed environment variables
 *   3  — credential file not readable or not a PEM .p8
 *   4  — HTTP/2 session error (network / TLS)
 *   5  — Apple rejected the push (returns the reason from Apple's body)
 *
 * Usage example:
 *   AGBENCH_APNS_KEY_PATH=~/.config/agbench/apns-auth-key.p8 \
 *   AGBENCH_APNS_KEY_ID=[key-id] \
 *   AGBENCH_APNS_TEAM_ID=<your-team-id> \
 *   AGBENCH_APNS_BUNDLE_ID=com.example.AGBench.ios \
 *   AGBENCH_APNS_DEVICE_TOKEN=<64-hex> \
 *   AGBENCH_APNS_ENV=sandbox \
 *   node scripts/smoke-apns-push.cjs
 */

const { createSign } = require('crypto')
const { readFileSync, existsSync } = require('fs')
const http2 = require('http2')
const path = require('path')
const os = require('os')

function fail(code, msg) {
  console.error(`[smoke-apns-push] ${msg}`)
  process.exit(code)
}

function info(msg) {
  console.log(`[smoke-apns-push] ${msg}`)
}

// ---------- env validation ----------
const KEY_PATH_RAW = process.env.AGBENCH_APNS_KEY_PATH
const KEY_ID = process.env.AGBENCH_APNS_KEY_ID
const TEAM_ID = process.env.AGBENCH_APNS_TEAM_ID
const BUNDLE_ID = process.env.AGBENCH_APNS_BUNDLE_ID
const DEVICE_TOKEN = process.env.AGBENCH_APNS_DEVICE_TOKEN
const ENV = (process.env.AGBENCH_APNS_ENV || 'sandbox').toLowerCase()
const PUSH_KIND = (process.env.AGBENCH_APNS_PUSH_KIND || 'approval').toLowerCase()
const SUMMARY = process.env.AGBENCH_APNS_SUMMARY || 'AGBench smoke test — approval needed'
const TIMEOUT_MS = Number(process.env.AGBENCH_APNS_TIMEOUT_MS || 10000)

if (!KEY_PATH_RAW) fail(2, 'AGBENCH_APNS_KEY_PATH not set')
if (!KEY_ID) fail(2, 'AGBENCH_APNS_KEY_ID not set')
if (!TEAM_ID) fail(2, 'AGBENCH_APNS_TEAM_ID not set')
if (!BUNDLE_ID) fail(2, 'AGBENCH_APNS_BUNDLE_ID not set')
if (!DEVICE_TOKEN) fail(2, 'AGBENCH_APNS_DEVICE_TOKEN not set')
if (!/^[0-9a-fA-F]+$/.test(DEVICE_TOKEN)) {
  fail(2, `AGBENCH_APNS_DEVICE_TOKEN must be hex; got "${DEVICE_TOKEN.slice(0, 12)}..."`)
}
if (DEVICE_TOKEN.length < 32) {
  fail(2, `AGBENCH_APNS_DEVICE_TOKEN looks too short (${DEVICE_TOKEN.length} chars); expected 64`)
}
if (!['sandbox', 'production'].includes(ENV)) {
  fail(2, `AGBENCH_APNS_ENV must be 'sandbox' or 'production'; got "${ENV}"`)
}
if (!['approval', 'silent', 'both'].includes(PUSH_KIND)) {
  fail(2, `AGBENCH_APNS_PUSH_KIND must be 'approval', 'silent', or 'both'; got "${PUSH_KIND}"`)
}

// Expand ~/ in key path.
const KEY_PATH = KEY_PATH_RAW.startsWith('~/')
  ? path.join(os.homedir(), KEY_PATH_RAW.slice(2))
  : KEY_PATH_RAW

if (!existsSync(KEY_PATH)) fail(3, `Key file does not exist: ${KEY_PATH}`)

let privateKeyPem
try {
  privateKeyPem = readFileSync(KEY_PATH, 'utf-8')
} catch (err) {
  fail(3, `Failed to read key file: ${err.message}`)
}
if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) {
  fail(3, `Key file does not look like a PEM .p8 (missing BEGIN PRIVATE KEY): ${KEY_PATH}`)
}

// ---------- JWT signing (ES256) ----------
function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function derEcdsaToConcat(der, sizePerInt) {
  // Apple requires raw r||s 64-byte signature; Node's createSign returns DER.
  // Parse DER SEQUENCE { INTEGER r, INTEGER s }.
  if (der[0] !== 0x30) throw new Error('DER signature does not start with SEQUENCE')
  let offset = 2
  if (der[1] & 0x80) offset += der[1] & 0x7f
  if (der[offset] !== 0x02) throw new Error('First component is not INTEGER')
  let rLen = der[offset + 1]
  let rStart = offset + 2
  let r = der.slice(rStart, rStart + rLen)
  offset = rStart + rLen
  if (der[offset] !== 0x02) throw new Error('Second component is not INTEGER')
  let sLen = der[offset + 1]
  let sStart = offset + 2
  let s = der.slice(sStart, sStart + sLen)
  // Strip 0x00 padding that DER adds when high bit is set.
  if (r[0] === 0x00) r = r.slice(1)
  if (s[0] === 0x00) s = s.slice(1)
  // Left-pad each to sizePerInt.
  const padR = Buffer.alloc(sizePerInt - r.length, 0)
  const padS = Buffer.alloc(sizePerInt - s.length, 0)
  return Buffer.concat([padR, r, padS, s])
}

function signJwt() {
  const header = { alg: 'ES256', kid: KEY_ID, typ: 'JWT' }
  const nowSec = Math.floor(Date.now() / 1000)
  const claims = { iss: TEAM_ID, iat: nowSec }
  const headerB64 = base64url(JSON.stringify(header))
  const claimsB64 = base64url(JSON.stringify(claims))
  const toSign = `${headerB64}.${claimsB64}`
  const signer = createSign('SHA256')
  signer.update(toSign)
  const derSig = signer.sign(privateKeyPem)
  const rawSig = derEcdsaToConcat(derSig, 32)
  return `${toSign}.${base64url(rawSig)}`
}

// ---------- HTTP/2 push ----------
function buildApprovalPayload() {
  return {
    aps: {
      alert: { title: 'AGBench', body: SUMMARY },
      sound: 'default',
      'mutable-content': 1
    },
    pairID: 'smoke-test-pair',
    workspaceId: 'smoke-workspace',
    threadId: 'smoke-thread',
    toolCallId: `smoke-${Date.now()}`,
    summary: SUMMARY
  }
}

function buildSilentPayload() {
  return {
    aps: { 'content-available': 1 },
    pairID: 'smoke-test-pair'
  }
}

function pushOnce(jwt, kind) {
  return new Promise((resolve) => {
    const authority = ENV === 'production'
      ? 'https://api.push.apple.com'
      : 'https://api.sandbox.push.apple.com'
    const client = http2.connect(authority)
    const payload = kind === 'silent' ? buildSilentPayload() : buildApprovalPayload()
    const body = Buffer.from(JSON.stringify(payload), 'utf-8')

    let resolved = false
    const settle = (outcome) => {
      if (resolved) return
      resolved = true
      try { client.close() } catch { /* ignore */ }
      resolve(outcome)
    }

    client.on('error', (err) => {
      settle({ kind, ok: false, code: 4, reason: `session error: ${err.message}` })
    })

    const headers = {
      ':method': 'POST',
      ':path': `/3/device/${DEVICE_TOKEN.toLowerCase()}`,
      'authorization': `bearer ${jwt}`,
      'apns-topic': BUNDLE_ID,
      'apns-push-type': kind === 'silent' ? 'background' : 'alert',
      'apns-priority': kind === 'silent' ? '5' : '10',
      'content-type': 'application/json',
      'content-length': String(body.length)
    }

    const req = client.request(headers)
    let status = 0
    let apnsId = ''
    const chunks = []

    req.on('response', (h) => {
      status = Number(h[':status'])
      apnsId = String(h['apns-id'] || '')
    })
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const bodyText = Buffer.concat(chunks).toString('utf-8')
      if (status === 200) {
        settle({ kind, ok: true, code: 0, apnsId, reason: 'delivered' })
      } else {
        let reason = bodyText
        try {
          const parsed = JSON.parse(bodyText)
          if (parsed && typeof parsed.reason === 'string') reason = parsed.reason
        } catch { /* keep raw bodyText */ }
        settle({ kind, ok: false, code: 5, apnsId, reason: `:status ${status} — ${reason}` })
      }
    })
    req.on('error', (err) => {
      settle({ kind, ok: false, code: 4, reason: `request error: ${err.message}` })
    })

    setTimeout(() => {
      settle({ kind, ok: false, code: 4, reason: `timed out after ${TIMEOUT_MS}ms` })
    }, TIMEOUT_MS)

    req.end(body)
  })
}

// ---------- main ----------
;(async () => {
  info(`env=${ENV} bundle=${BUNDLE_ID} keyId=${KEY_ID} teamId=${TEAM_ID}`)
  info(`device-token=${DEVICE_TOKEN.slice(0, 8)}…${DEVICE_TOKEN.slice(-8)} (${DEVICE_TOKEN.length} chars)`)
  info(`push kind=${PUSH_KIND}`)

  let jwt
  try {
    jwt = signJwt()
  } catch (err) {
    fail(3, `JWT signing failed: ${err.message}`)
  }
  info(`JWT signed (${jwt.split('.')[0]}.${jwt.split('.')[1]}.…)`)

  const kinds = PUSH_KIND === 'both' ? ['silent', 'approval'] : [PUSH_KIND]
  const results = []
  for (const k of kinds) {
    info(`sending ${k} push…`)
    const r = await pushOnce(jwt, k)
    results.push(r)
    if (r.ok) {
      info(`✓ ${k} delivered — apns-id=${r.apnsId}`)
    } else {
      info(`✗ ${k} failed — ${r.reason}`)
    }
  }

  const failed = results.find((r) => !r.ok)
  if (failed) {
    process.exit(failed.code)
  }
  info('all pushes delivered.')
  process.exit(0)
})().catch((err) => {
  fail(4, `unhandled error: ${err.message}`)
})
