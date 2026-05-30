#!/usr/bin/env node

/**
 * Verifies that the sibling CodexBridge checkout exposes the Remote/iOS ack
 * seam required by GUIGemini's Swift bridge and iOS companion tests.
 *
 * This intentionally does not modify or stage CodexBridge. The checkout is
 * often dirty with unrelated app work; this script only reports whether the
 * public BridgeCore API has the fields GUIGemini compiles against.
 */

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '..')
const CODEXBRIDGE_ROOT =
  process.env.CODEXBRIDGE_PATH || path.resolve(REPO_ROOT, '..', 'CodexBridge')
const BRIDGE_TRANSPORT = path.join(
  CODEXBRIDGE_ROOT,
  'Sources',
  'BridgeCore',
  'BridgeTransport.swift'
)
const PATCH_PATH = path.join(REPO_ROOT, 'docs', 'CODEXBRIDGE-REMOTE-IOS-SEAM.patch')

const required = [
  ['BridgeJSONValue enum', 'public enum BridgeJSONValue'],
  ['BridgeJSONValue object case', 'case object([String: BridgeJSONValue])'],
  ['BridgeActionAck schemaVersion', 'public let schemaVersion: Int?'],
  ['BridgeActionAck directJournalRecordName', 'public let directJournalRecordName: String?'],
  ['BridgeActionAck executed', 'public let executed: Bool?'],
  ['BridgeActionAck reasonCode', 'public let reasonCode: String?'],
  ['BridgeActionAck actionKind', 'public let actionKind: String?'],
  ['BridgeActionAck workspaceId', 'public let workspaceId: String?'],
  ['BridgeActionAck threadId', 'public let threadId: String?'],
  ['BridgeActionAck runId', 'public let runId: String?'],
  ['BridgeActionAck appRunId', 'public let appRunId: String?'],
  ['BridgeActionAck approvalId', 'public let approvalId: String?'],
  ['BridgeActionAck questionId', 'public let questionId: String?'],
  ['BridgeActionAck pairId', 'public let pairId: String?'],
  ['BridgeActionAck correlationId', 'public let correlationId: String?'],
  ['BridgeActionAck scope', 'public let scope: String?'],
  ['BridgeActionAck data bag', 'public let data: [String: BridgeJSONValue]?']
]

if (!fs.existsSync(BRIDGE_TRANSPORT)) {
  console.error(`[check-codexbridge-seam] missing ${BRIDGE_TRANSPORT}`)
  console.error(`Set CODEXBRIDGE_PATH to the sibling checkout if it lives elsewhere.`)
  process.exit(2)
}

const source = fs.readFileSync(BRIDGE_TRANSPORT, 'utf8')
const missing = required.filter(([, needle]) => !source.includes(needle))

if (missing.length > 0) {
  console.error('[check-codexbridge-seam] FAIL — CodexBridge seam is missing:')
  for (const [label] of missing) console.error(`  - ${label}`)
  console.error('\nApply the isolated patch on a clean CodexBridge branch:')
  console.error(`  cd ${CODEXBRIDGE_ROOT}`)
  console.error(`  git switch -c codex/remote-ios-bridge-ack-seam`)
  console.error(`  git apply ${PATCH_PATH}`)
  process.exit(1)
}

console.log(`[check-codexbridge-seam] OK — required seam present at ${BRIDGE_TRANSPORT}`)
