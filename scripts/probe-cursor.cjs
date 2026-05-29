#!/usr/bin/env node

// Dev-only runner for the Cursor Agent CLI probe.
//
// READ-ONLY by construction: it runs only `--version` / `--help` / `status` /
// `models` probes. It NEVER runs a prompt (`-p`), never passes `--force`, never
// mutates global `~/.cursor`, and never reads credential files.
//
// The authoritative, unit-tested parsing lives in
// src/main/cursor/CursorCliProbe.ts; this script mirrors it so you can run
// `node scripts/probe-cursor.cjs` for a quick sanity check without an Electron
// build (the .ts module can't be required from plain Node — no TS loader).

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function resolveCursorBinary() {
  const preferred = path.join(os.homedir(), '.local', 'bin', 'cursor-agent')
  if (fs.existsSync(preferred)) return { binaryPath: preferred, source: 'common' }
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const which = spawnSync(finder, ['cursor-agent'], { encoding: 'utf8' })
  if (which.status === 0) {
    const line = (which.stdout || '').split(/\r?\n/).find(Boolean)
    if (line) return { binaryPath: line.trim(), source: 'path' }
  }
  return {
    binaryPath: null,
    source: 'missing',
    error: 'Cursor CLI was not found at ~/.local/bin/cursor-agent or on PATH.'
  }
}

function capture(bin, args) {
  const res = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
  })
  return {
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    code: res.status,
    error: res.error ? res.error.message : undefined
  }
}

function parseVersion(raw) {
  const withHash = (raw || '').match(/\b(\d{4}\.\d{2}\.\d{2}-[0-9a-f]+)\b/)
  if (withHash) return withHash[1]
  const dateOnly = (raw || '').match(/\b(\d{4}\.\d{2}\.\d{2})\b/)
  return dateOnly ? dateOnly[1] : null
}

function parseLoginState(raw) {
  const text = (raw || '').trim()
  if (!text) return false
  return !/not logged in|logged out|not authenticated|please log ?in/i.test(text)
}

function extractFlags(text) {
  const flags = new Set()
  for (const line of (text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('-')) continue
    for (const m of trimmed.matchAll(/--[a-z][a-z0-9-]*/g)) flags.add(m[0])
  }
  return [...flags].sort()
}

function extractSubcommands(text) {
  const lines = (text || '').split(/\r?\n/)
  const start = lines.findIndex((line) => /^Commands:\s*$/.test(line.trim()))
  if (start === -1) return []
  const out = []
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) break
    const m = lines[i].match(/^\s{2,4}([a-z][a-z0-9-]*)\b/)
    if (m && /\s{2,}\S/.test(lines[i].slice(m[0].length))) out.push(m[1])
  }
  return out
}

function parseModels(raw) {
  const out = []
  for (const line of (raw || '').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s+-\s+(.+)$/)
    if (m) out.push({ id: m[1], label: m[2].trim() })
  }
  return out
}

const resolved = resolveCursorBinary()
const findings = {
  probedAt: new Date().toISOString(),
  binaryPath: resolved.binaryPath,
  binarySource: resolved.source,
  version: null,
  versionRaw: '',
  loggedIn: false,
  topLevelFlags: [],
  subcommands: [],
  models: [],
  composerModelIds: [],
  errors: []
}

if (!resolved.binaryPath) {
  findings.errors.push(resolved.error)
  console.log(JSON.stringify(findings, null, 2))
  process.exit(0)
}

const versionRes = capture(resolved.binaryPath, ['--version'])
findings.versionRaw = (versionRes.stdout || versionRes.stderr || '').trim()
findings.version = parseVersion(findings.versionRaw)
if (versionRes.error) findings.errors.push('version probe failed: ' + versionRes.error)

const helpRes = capture(resolved.binaryPath, ['--help'])
findings.topLevelFlags = extractFlags(helpRes.stdout || helpRes.stderr || '')
findings.subcommands = extractSubcommands(helpRes.stdout || helpRes.stderr || '')
if (helpRes.error) findings.errors.push('help probe failed: ' + helpRes.error)

const statusRes = capture(resolved.binaryPath, ['status'])
findings.loggedIn = parseLoginState(statusRes.stdout || statusRes.stderr || '')
if (statusRes.error) findings.errors.push('status probe failed: ' + statusRes.error)

const modelsRes = capture(resolved.binaryPath, ['models'])
findings.models = parseModels(modelsRes.stdout || modelsRes.stderr || '')
findings.composerModelIds = findings.models.map((m) => m.id).filter((id) => id.startsWith('composer-'))
if (modelsRes.error) findings.errors.push('models probe failed: ' + modelsRes.error)

console.log(JSON.stringify(findings, null, 2))
