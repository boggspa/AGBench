#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

const MIGRATION_VERSION = '1.0.7-M8'
const PROVIDERS = new Set(['gemini', 'codex', 'claude', 'kimi', 'grok', 'cursor'])
const PROVIDER_LABELS = {
  gemini: 'Gemini',
  codex: 'Codex',
  claude: 'Claude',
  kimi: 'Kimi',
  grok: 'Grok',
  cursor: 'Cursor'
}
const PROVIDER_MCP_METHOD_PATTERN = /^(gemini|codex|claude|kimi|grok|cursor)-mcp\//

function isProviderId(value) {
  return typeof value === 'string' && PROVIDERS.has(value)
}

function providerFromMethod(method) {
  if (typeof method !== 'string') return undefined
  const match = method.match(PROVIDER_MCP_METHOD_PATTERN)
  return isProviderId(match && match[1]) ? match[1] : undefined
}

function providerFromRecord(record) {
  const methodProvider = providerFromMethod(record && record.method)
  if (methodProvider) return methodProvider
  if (isProviderId(record && record.provider)) return record.provider
  const metadata = record && record.metadata && typeof record.metadata === 'object' ? record.metadata : {}
  const metadataProvider = metadata.parentProvider || metadata.provider
  return isProviderId(metadataProvider) ? metadataProvider : undefined
}

function rewriteHistoricalApprovalTitle(title, provider) {
  if (provider === 'gemini' || typeof title !== 'string') return null
  const providerName = PROVIDER_LABELS[provider]
  if (title.startsWith('Approve Gemini ')) {
    return {
      title: title.replace(/^Approve Gemini\b/, `Approve ${providerName}`),
      reason: 'approve-title-provider-prefix'
    }
  }
  if (title.startsWith('Gemini wants ')) {
    return {
      title: title.replace(/^Gemini\b/, providerName),
      reason: 'delegation-title-provider-prefix'
    }
  }
  return null
}

function backfillApprovalLedgerTitles(records, migratedAt = new Date().toISOString()) {
  const changes = []
  const unchangedRows = []
  const nextRecords = records.map((record, index) => {
    if (!record || typeof record !== 'object') {
      unchangedRows.push({ index, reason: 'non-object-row' })
      return record
    }
    const provider = providerFromRecord(record)
    const baseRow = {
      index,
      id: record.id,
      approvalId: record.approvalId,
      provider,
      method: record.method,
      title: record.title
    }
    if (!provider) {
      unchangedRows.push({ ...baseRow, reason: 'provider-unresolved' })
      return record
    }
    if (typeof record.title !== 'string') {
      unchangedRows.push({ ...baseRow, reason: 'non-string-title' })
      return record
    }
    const rewrite = rewriteHistoricalApprovalTitle(record.title, provider)
    if (!rewrite) {
      unchangedRows.push({
        ...baseRow,
        reason: provider === 'gemini' ? 'gemini-provider' : 'title-current-or-provider-agnostic'
      })
      return record
    }
    const nextRecord = {
      ...record,
      title: rewrite.title,
      metadata: {
        ...(record.metadata || {}),
        approvalTitleBackfill: {
          version: MIGRATION_VERSION,
          migratedAt,
          previousTitle: record.title
        }
      }
    }
    changes.push({
      index,
      id: record.id,
      approvalId: record.approvalId,
      provider,
      method: record.method,
      previousTitle: record.title,
      nextTitle: rewrite.title,
      reason: rewrite.reason
    })
    return nextRecord
  })
  const staleRowsAfter = nextRecords
    .map((record, index) => {
      if (!record || typeof record !== 'object') return null
      const provider = providerFromRecord(record)
      if (!provider || provider === 'gemini') return null
      const rewrite = rewriteHistoricalApprovalTitle(record.title, provider)
      if (!rewrite) return null
      return {
        index,
        id: record.id,
        approvalId: record.approvalId,
        provider,
        method: record.method,
        previousTitle: record.title,
        nextTitle: rewrite.title,
        reason: rewrite.reason
      }
    })
    .filter(Boolean)
  return {
    records: nextRecords,
    scanned: records.length,
    changed: changes.length,
    unchanged: unchangedRows.length,
    changes,
    unchangedRows,
    staleRowsAfter
  }
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function defaultUserDataDir() {
  if (process.env.AGBENCH_USER_DATA_DIR) return process.env.AGBENCH_USER_DATA_DIR
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'AGBench')
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'AGBench')
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'AGBench')
}

function defaultLedgerPath() {
  return (
    process.env.AGBENCH_APPROVAL_LEDGER_PATH ||
    path.join(defaultUserDataDir(), 'approval-ledger.json')
  )
}

function parseArgs(argv) {
  const options = {
    dryRun: true,
    ledgerPath: defaultLedgerPath(),
    outDir: undefined,
    quietUnchanged: false,
    help: false
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (arg === '--dry-run') {
      options.dryRun = true
    } else if (arg === '--write') {
      options.dryRun = false
    } else if (arg === '--ledger') {
      options.ledgerPath = argv[++index]
    } else if (arg.startsWith('--ledger=')) {
      options.ledgerPath = arg.slice('--ledger='.length)
    } else if (arg === '--user-data') {
      options.ledgerPath = path.join(argv[++index], 'approval-ledger.json')
    } else if (arg.startsWith('--user-data=')) {
      options.ledgerPath = path.join(arg.slice('--user-data='.length), 'approval-ledger.json')
    } else if (arg === '--out-dir') {
      options.outDir = argv[++index]
    } else if (arg.startsWith('--out-dir=')) {
      options.outDir = arg.slice('--out-dir='.length)
    } else if (arg === '--quiet-unchanged') {
      options.quietUnchanged = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!options.ledgerPath) throw new Error('Missing --ledger <path>.')
  return options
}

function usage() {
  return [
    'Usage: node scripts/approval-title-backfill.cjs [--dry-run|--write] [--ledger <path>]',
    '',
    'Defaults to dry-run. Use --write to update the ledger after a backup is written.',
    'Use --out-dir <dir> to place the migration diff and backup outside the ledger directory.',
    'Environment overrides: AGBENCH_APPROVAL_LEDGER_PATH, AGBENCH_USER_DATA_DIR.'
  ].join('\n')
}

function readLedger(ledgerPath) {
  const text = fs.readFileSync(ledgerPath, 'utf8')
  const parsed = JSON.parse(text || '[]')
  if (!Array.isArray(parsed)) {
    throw new Error(`Approval ledger must be a JSON array: ${ledgerPath}`)
  }
  return parsed
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function runApprovalTitleBackfill(options) {
  const ledgerPath = path.resolve(options.ledgerPath)
  const outDir = path.resolve(options.outDir || path.dirname(ledgerPath))
  const generatedAt = new Date().toISOString()
  const suffix = timestampForFile(new Date(generatedAt))
  const records = readLedger(ledgerPath)
  const result = backfillApprovalLedgerTitles(records, generatedAt)
  const diffPath = path.join(outDir, `approval-title-backfill-${suffix}.diff.json`)
  const backupPath = options.dryRun
    ? undefined
    : path.join(outDir, `approval-ledger-${suffix}.backup.json`)
  const diff = {
    migration: 'approval-title-backfill',
    version: MIGRATION_VERSION,
    dryRun: options.dryRun,
    ledgerPath,
    backupPath: backupPath || null,
    generatedAt,
    scanned: result.scanned,
    changed: result.changed,
    unchanged: result.unchanged,
    changes: result.changes,
    unchangedRows: result.unchangedRows,
    staleRowsAfter: result.staleRowsAfter
  }

  writeJson(diffPath, diff)

  if (!options.dryRun && result.changed > 0) {
    fs.mkdirSync(outDir, { recursive: true })
    fs.copyFileSync(ledgerPath, backupPath)
    writeJson(ledgerPath, result.records)
  }

  return {
    ...result,
    dryRun: options.dryRun,
    ledgerPath,
    backupPath: backupPath || null,
    diffPath
  }
}

function logResult(result, quietUnchanged = false) {
  const mode = result.dryRun ? 'dry-run' : 'write'
  console.log(
    `[approval-title-backfill] ${mode}: scanned=${result.scanned} changed=${result.changed} unchanged=${result.unchanged}`
  )
  console.log(`[approval-title-backfill] diff=${result.diffPath}`)
  if (result.backupPath) {
    console.log(`[approval-title-backfill] backup=${result.backupPath}`)
  }
  for (const change of result.changes) {
    console.log(
      `[approval-title-backfill] changed index=${change.index} provider=${change.provider} ${JSON.stringify(change.previousTitle)} -> ${JSON.stringify(change.nextTitle)}`
    )
  }
  if (!quietUnchanged) {
    for (const row of result.unchangedRows) {
      console.log(
        `[approval-title-backfill] unchanged index=${row.index} provider=${row.provider || 'unknown'} reason=${row.reason} title=${JSON.stringify(row.title || '')}`
      )
    }
  }
  if (result.staleRowsAfter.length > 0) {
    console.error(
      `[approval-title-backfill] ERROR: ${result.staleRowsAfter.length} stale Gemini-labelled non-Gemini rows remain after migration.`
    )
  }
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return 0
  }
  const result = runApprovalTitleBackfill(options)
  logResult(result, options.quietUnchanged)
  return result.staleRowsAfter.length > 0 ? 2 : 0
}

if (require.main === module) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(`[approval-title-backfill] ${error instanceof Error ? error.message : String(error)}`)
    console.error(usage())
    process.exitCode = 1
  }
}

module.exports = {
  MIGRATION_VERSION,
  backfillApprovalLedgerTitles,
  defaultLedgerPath,
  main,
  parseArgs,
  providerFromRecord,
  rewriteHistoricalApprovalTitle,
  runApprovalTitleBackfill
}
