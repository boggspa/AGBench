#!/usr/bin/env node

/**
 * Validates the shared Remote/iOS golden JSON fixtures. This is intentionally
 * lightweight and dependency-free so TS, Swift, and release-gate workflows can
 * run it before loading the same payloads in language-specific tests.
 */

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '..')
const FIXTURE_DIR = path.join(REPO_ROOT, 'tests', 'fixtures', 'remote-ios')

const errors = []

function fail(file, message) {
  errors.push(`${path.relative(REPO_ROOT, file)}: ${message}`)
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    fail(file, `invalid JSON: ${error.message}`)
    return null
  }
}

function isIsoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function requireString(file, obj, key) {
  if (typeof obj[key] !== 'string' || obj[key].length === 0) {
    fail(file, `expected non-empty string field "${key}"`)
  }
}

function requireBoolean(file, obj, key) {
  if (typeof obj[key] !== 'boolean') {
    fail(file, `expected boolean field "${key}"`)
  }
}

function validateAck(file, obj) {
  if (obj.schemaVersion !== 1) fail(file, 'BridgeActionAckV1 schemaVersion must be 1')
  for (const key of ['ackId', 'pairID', 'actionKind', 'reason', 'createdAt']) {
    requireString(file, obj, key)
  }
  requireBoolean(file, obj, 'accepted')
  requireBoolean(file, obj, 'executed')
  if (obj.scope !== undefined && obj.scope !== 'once' && obj.scope !== 'session') {
    fail(file, 'scope must be "once" or "session" when present')
  }
  if (!isIsoDate(obj.createdAt)) fail(file, 'createdAt must parse as an ISO timestamp')
  if (obj.accepted === false && obj.executed !== false) {
    fail(file, 'denied acks must have executed=false')
  }
  if (obj.workspaceId !== undefined && typeof obj.workspaceId !== 'string') {
    fail(file, 'workspaceId must be a string when present')
  }
  if (obj.threadId !== undefined && typeof obj.threadId !== 'string') {
    fail(file, 'threadId must be a string when present')
  }
  if (obj.runId !== undefined && typeof obj.runId !== 'string') {
    fail(file, 'runId must be a string when present')
  }
}

function validateProjectionEnvelope(file, obj) {
  if (obj.schemaVersion !== 1) fail(file, 'RemoteProjectionEnvelope schemaVersion must be 1')
  for (const key of [
    'envelopeId',
    'pairID',
    'workspaceId',
    'threadId',
    'payloadKind',
    'generatedAt'
  ]) {
    requireString(file, obj, key)
  }
  if (obj.payloadKind !== 'remoteThreadSnapshot') {
    fail(file, 'payloadKind must be "remoteThreadSnapshot" for this fixture set')
  }
  if (!Array.isArray(obj.capabilities) || obj.capabilities.length === 0) {
    fail(file, 'capabilities must be a non-empty array')
  }
  if (!isIsoDate(obj.generatedAt)) fail(file, 'generatedAt must parse as an ISO timestamp')
  if (!obj.payload || typeof obj.payload !== 'object' || Array.isArray(obj.payload)) {
    fail(file, 'payload must be an object')
    return
  }

  const payload = obj.payload
  if (payload.schemaVersion !== 1) fail(file, 'payload.schemaVersion must be 1')
  if (payload.threadId !== obj.threadId) {
    fail(file, 'payload.threadId must match envelope.threadId')
  }
  if (!payload.mode || typeof payload.mode.kind !== 'string') {
    fail(file, 'payload.mode.kind is required')
  }
  if (!Array.isArray(payload.rows)) {
    fail(file, 'payload.rows must be an array')
    return
  }
  if (payload.mode.kind === 'latestN' && payload.rows.length > payload.mode.n) {
    fail(file, 'latestN payload has more rows than mode.n')
  }
  for (const [index, row] of payload.rows.entries()) {
    for (const key of ['id', 'role', 'kind', 'preview', 'timestamp']) {
      if (typeof row[key] !== 'string' || row[key].length === 0) {
        fail(file, `expected non-empty string field "payload.rows[${index}].${key}"`)
      }
    }
    requireBoolean(file, row, 'truncated')
    if (!isIsoDate(row.timestamp)) fail(file, `payload.rows[${index}].timestamp must be ISO`)
    if (row.attention && typeof row.attention.kind !== 'string') {
      fail(file, `payload.rows[${index}].attention.kind must be a string`)
    }
  }
}

function main() {
  if (!fs.existsSync(FIXTURE_DIR)) {
    console.error(`[validate-remote-ios-fixtures] missing fixture dir: ${FIXTURE_DIR}`)
    process.exit(2)
  }

  const files = fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(FIXTURE_DIR, name))
    .sort()

  if (files.length === 0) {
    console.error('[validate-remote-ios-fixtures] no JSON fixtures found')
    process.exit(2)
  }

  for (const file of files) {
    const obj = readJson(file)
    if (!obj) continue
    if (obj.kind === 'BridgeActionAckV1') validateAck(file, obj)
    else if (obj.kind === 'RemoteProjectionEnvelope') validateProjectionEnvelope(file, obj)
    else fail(file, `unknown fixture kind "${obj.kind}"`)
  }

  if (errors.length > 0) {
    console.error('[validate-remote-ios-fixtures] FAIL')
    for (const error of errors) console.error(`  - ${error}`)
    process.exit(1)
  }

  console.log(`[validate-remote-ios-fixtures] OK (${files.length} fixtures)`)
}

main()
