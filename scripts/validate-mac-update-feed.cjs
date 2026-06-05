#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const DEFAULT_FEED_NAMES = ['latest-mac.yml', 'beta-mac.yml']

function cleanArtifactName(value) {
  if (!value || typeof value !== 'string') return undefined
  const trimmed = value
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .split(/[?#]/)[0]
  if (!trimmed) return undefined
  return trimmed.split('/').filter(Boolean).pop() || trimmed
}

function classifyMacArtifact(name) {
  const cleanName = cleanArtifactName(name)?.toLowerCase()
  if (!cleanName) return 'unknown'
  if (/\buniversal\b|[-_.]universal[-_.]/i.test(cleanName)) return 'universal'
  if (/\barm64\b|[-_.]arm64[-_.]/i.test(cleanName)) return 'arm64'
  if (/\bx64\b|\bx86_64\b|[-_.](?:x64|x86_64)[-_.]/i.test(cleanName)) return 'x64'
  if (/(?:^|[-_.])mac\.zip$/i.test(cleanName)) return 'universal'
  return 'unknown'
}

function extractArtifactEntries(feedText) {
  const entries = []
  const seen = new Set()
  const topLevelPath = feedText.match(/(?:^|\n)path:\s*([^\n]+)/)?.[1]
  const add = (source, rawValue) => {
    const name = cleanArtifactName(rawValue)
    if (!name || !/\.(?:zip|dmg)$/i.test(name)) return
    const key = `${source}:${name}`
    if (seen.has(key)) return
    seen.add(key)
    entries.push({
      source,
      name,
      arch: classifyMacArtifact(name)
    })
  }
  add('path', topLevelPath)

  const nestedEntryPattern = /(?:^|\n)\s+(?:-\s*)?(?:url|path):\s*([^\n]+)/g
  let match
  while ((match = nestedEntryPattern.exec(feedText))) {
    add('file', match[1])
  }
  return entries
}

function validateMacUpdateFeedText(feedText, options = {}) {
  const fileName = options.fileName || 'mac update feed'
  const entries = extractArtifactEntries(feedText)
  const errors = []
  const topLevel = entries.find((entry) => entry.source === 'path')

  if (!topLevel) {
    errors.push(`${fileName}: missing top-level mac updater path.`)
  } else if (!topLevel.name.toLowerCase().endsWith('.zip')) {
    errors.push(`${fileName}: top-level updater path must point to a zip artifact.`)
  }

  for (const entry of entries) {
    if (entry.arch !== 'universal') {
      errors.push(
        `${fileName}: ${entry.name} is ${entry.arch}; shared mac feeds must publish universal artifacts.`
      )
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    artifacts: entries
  }
}

function validateMacUpdateFeedFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  return validateMacUpdateFeedText(text, { fileName: path.basename(filePath) })
}

function resolveFeedFiles(targets) {
  const resolved = []
  for (const target of targets) {
    const absolute = path.resolve(target)
    if (!fs.existsSync(absolute)) continue
    const stat = fs.statSync(absolute)
    if (stat.isDirectory()) {
      for (const feedName of DEFAULT_FEED_NAMES) {
        const candidate = path.join(absolute, feedName)
        if (fs.existsSync(candidate)) resolved.push(candidate)
      }
    } else {
      resolved.push(absolute)
    }
  }
  return resolved
}

function runCli(argv = process.argv.slice(2)) {
  const targets = argv.length > 0 ? argv : ['dist']
  const files = resolveFeedFiles(targets)
  if (files.length === 0) {
    console.error(
      `[validate-mac-update-feed] No mac update feed found. Checked: ${targets.join(', ')}`
    )
    return 1
  }

  let failed = false
  for (const file of files) {
    const result = validateMacUpdateFeedFile(file)
    if (result.ok) {
      console.log(
        `[validate-mac-update-feed] ${path.basename(file)} ok (${result.artifacts
          .map((artifact) => `${artifact.name}:${artifact.arch}`)
          .join(', ')})`
      )
      continue
    }
    failed = true
    for (const error of result.errors) {
      console.error(`[validate-mac-update-feed] ${error}`)
    }
  }
  return failed ? 1 : 0
}

if (require.main === module) {
  process.exitCode = runCli()
}

module.exports = {
  classifyMacArtifact,
  extractArtifactEntries,
  runCli,
  validateMacUpdateFeedFile,
  validateMacUpdateFeedText
}
