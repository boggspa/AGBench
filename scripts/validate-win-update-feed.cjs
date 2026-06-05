#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const WINDOWS_ARCHES = ['x64', 'arm64']
const DEFAULT_FEED_NAMES = WINDOWS_ARCHES.flatMap((arch) => [
  `latest-win-${arch}.yml`,
  `beta-win-${arch}.yml`
])

function cleanArtifactName(value) {
  if (!value || typeof value !== 'string') return undefined
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '').split(/[?#]/)[0]
  if (!trimmed) return undefined
  return trimmed.split('/').filter(Boolean).pop() || trimmed
}

function classifyWindowsArtifact(name) {
  const cleanName = cleanArtifactName(name)?.toLowerCase()
  if (!cleanName) return 'unknown'
  if (/\barm64\b|[-_.]arm64[-_.]/i.test(cleanName)) return 'arm64'
  if (/\bx64\b|\bx86_64\b|[-_.](?:x64|x86_64)[-_.]/i.test(cleanName)) return 'x64'
  return 'unknown'
}

function expectedArchFromFeedName(fileName) {
  const lower = fileName.toLowerCase()
  if (/(?:^|[-_.])arm64\.ya?ml$|[-_.]arm64[-_.]/.test(lower)) return 'arm64'
  if (/(?:^|[-_.])x64\.ya?ml$|[-_.](?:x64|x86_64)[-_.]/.test(lower)) return 'x64'
  return undefined
}

function extractArtifactEntries(feedText) {
  const entries = []
  const seen = new Set()
  const topLevelPath = feedText.match(/(?:^|\n)path:\s*([^\n]+)/)?.[1]
  const add = (source, rawValue) => {
    const name = cleanArtifactName(rawValue)
    if (!name || !/\.exe$/i.test(name)) return
    const key = `${source}:${name}`
    if (seen.has(key)) return
    seen.add(key)
    entries.push({
      source,
      name,
      arch: classifyWindowsArtifact(name)
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

function validateWindowsUpdateFeedText(feedText, options = {}) {
  const fileName = options.fileName || 'windows update feed'
  const expectedArch = options.expectedArch || expectedArchFromFeedName(fileName)
  const entries = extractArtifactEntries(feedText)
  const errors = []
  const topLevel = entries.find((entry) => entry.source === 'path')

  if (!expectedArch) {
    errors.push(`${fileName}: feed name must include x64 or arm64.`)
  }
  if (!topLevel) {
    errors.push(`${fileName}: missing top-level Windows updater path.`)
  } else if (!topLevel.name.toLowerCase().endsWith('.exe')) {
    errors.push(`${fileName}: top-level updater path must point to a setup exe artifact.`)
  }

  for (const entry of entries) {
    if (entry.arch === 'unknown') {
      errors.push(`${fileName}: ${entry.name} has unknown Windows artifact architecture.`)
    } else if (expectedArch && entry.arch !== expectedArch) {
      errors.push(
        `${fileName}: ${entry.name} is ${entry.arch}; expected ${expectedArch} for this feed.`
      )
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    artifacts: entries
  }
}

function validateWindowsUpdateFeedFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8')
  return validateWindowsUpdateFeedText(text, { fileName: path.basename(filePath) })
}

function validateWindowsReleaseDirectory(distDir) {
  const errors = []
  const installerNames = safeReadDir(distDir)
    .filter((entry) => entry.isFile() && /\.exe$/i.test(entry.name) && /setup/i.test(entry.name))
    .map((entry) => entry.name)

  for (const arch of WINDOWS_ARCHES) {
    const installer = installerNames.find((name) => classifyWindowsArtifact(name) === arch)
    if (!installer) {
      errors.push(`${path.basename(distDir)}: missing Windows ${arch} setup installer.`)
      continue
    }
    const blockMapPath = path.join(distDir, `${installer}.blockmap`)
    if (!fs.existsSync(blockMapPath)) {
      errors.push(`${path.basename(distDir)}: missing blockmap for ${installer}.`)
    }
  }

  return errors
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
  const directoryErrors = targets.flatMap((target) => {
    const absolute = path.resolve(target)
    return fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()
      ? validateWindowsReleaseDirectory(absolute)
      : []
  })
  if (files.length === 0) {
    console.error(
      `[validate-win-update-feed] No Windows update feed found. Checked: ${targets.join(', ')}`
    )
    return 1
  }

  let failed = directoryErrors.length > 0
  for (const error of directoryErrors) {
    console.error(`[validate-win-update-feed] ${error}`)
  }
  for (const file of files) {
    const result = validateWindowsUpdateFeedFile(file)
    if (result.ok) {
      console.log(
        `[validate-win-update-feed] ${path.basename(file)} ok (${result.artifacts
          .map((artifact) => `${artifact.name}:${artifact.arch}`)
          .join(', ')})`
      )
      continue
    }
    failed = true
    for (const error of result.errors) {
      console.error(`[validate-win-update-feed] ${error}`)
    }
  }
  return failed ? 1 : 0
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

if (require.main === module) {
  process.exitCode = runCli()
}

module.exports = {
  classifyWindowsArtifact,
  extractArtifactEntries,
  runCli,
  validateWindowsReleaseDirectory,
  validateWindowsUpdateFeedFile,
  validateWindowsUpdateFeedText
}
