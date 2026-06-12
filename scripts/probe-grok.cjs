#!/usr/bin/env node

// Dev-only runner for the Grok Build CLI probe.
//
// READ-ONLY by construction: it runs only `--version` / `--help` style probes
// (always prefixed with `--no-auto-update`). It never runs a prompt, never
// mutates ~/.grok, and never reads credential files.
//
// The authoritative, unit-tested parsing lives in
// src/main/grok/GrokCliProbe.ts; this script mirrors it so you can run
// `node scripts/probe-grok.cjs` for a quick sanity check without an Electron
// build (the .ts module can't be required from plain Node — no TS loader).

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const READ_ONLY = '--no-auto-update'

function resolveGrokBinary() {
  const preferred = path.join(os.homedir(), '.grok', 'bin', 'grok')
  if (fs.existsSync(preferred)) return { binaryPath: preferred, source: 'common' }
  const finder = process.platform === 'win32' ? 'where' : 'which'
  const which = spawnSync(finder, ['grok'], { encoding: 'utf8' })
  if (which.status === 0) {
    const line = (which.stdout || '').split(/\r?\n/).find(Boolean)
    if (line) return { binaryPath: line.trim(), source: 'path' }
  }
  return {
    binaryPath: null,
    source: 'missing',
    error: 'Grok CLI was not found at ~/.grok/bin/grok or on PATH.'
  }
}

function capture(bin, args) {
  const res = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: 8000,
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
  const m = (raw || '').match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/)
  return m ? m[1] : null
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
    const m = lines[i].match(/^\s{2,}([a-z][a-z0-9-]*)\s{2,}\S/)
    if (m) out.push(m[1])
  }
  return out
}

const resolved = resolveGrokBinary()
const findings = {
  probedAt: new Date().toISOString(),
  binaryPath: resolved.binaryPath,
  binarySource: resolved.source,
  version: null,
  versionRaw: '',
  topLevelFlags: [],
  subcommands: [],
  agentStdioDocumented: false,
  errors: []
}

if (!resolved.binaryPath) {
  findings.errors.push(resolved.error)
  console.log(JSON.stringify(findings, null, 2))
  process.exit(0)
}

const versionRes = capture(resolved.binaryPath, [READ_ONLY, '--version'])
findings.versionRaw = (versionRes.stdout || versionRes.stderr || '').trim()
findings.version = parseVersion(findings.versionRaw)
if (versionRes.error) findings.errors.push('version probe failed: ' + versionRes.error)

const helpRes = capture(resolved.binaryPath, [READ_ONLY, '--help'])
findings.topLevelFlags = extractFlags(helpRes.stdout || helpRes.stderr || '')
findings.subcommands = extractSubcommands(helpRes.stdout || helpRes.stderr || '')
if (helpRes.error) findings.errors.push('help probe failed: ' + helpRes.error)

const stdioRes = capture(resolved.binaryPath, [READ_ONLY, 'agent', 'stdio', '--help'])
// Ignore global plumbing flags clap attaches to every subcommand's help —
// 0.2.32 added --leader-socket everywhere and 0.2.51 added --debug /
// --debug-file, none of which is stdio documentation. Mirrors
// agentStdioIsDocumented in src/main/grok/GrokCliProbe.ts.
const GLOBAL_PLUMBING_FLAGS = new Set(['--help', '--leader-socket', '--debug', '--debug-file'])
findings.agentStdioDocumented = extractFlags(stdioRes.stdout || stdioRes.stderr || '').some(
  (flag) => !GLOBAL_PLUMBING_FLAGS.has(flag)
)
if (stdioRes.error) findings.errors.push('agent stdio probe failed: ' + stdioRes.error)

console.log(JSON.stringify(findings, null, 2))
