#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const DARWIN_CLAUDE_SDK_PACKAGES = [
  '@anthropic-ai/claude-agent-sdk-darwin-arm64',
  '@anthropic-ai/claude-agent-sdk-darwin-x64'
]

function resolveDarwinClaudeSdkPackages(lock) {
  const packages = lock && typeof lock === 'object' ? lock.packages || {} : {}
  return DARWIN_CLAUDE_SDK_PACKAGES.map((name) => {
    const entry = packages[`node_modules/${name}`]
    if (!entry || typeof entry.version !== 'string' || entry.version.length === 0) {
      throw new Error(`Missing ${name} version in package-lock.json.`)
    }
    return { name, version: entry.version, spec: `${name}@${entry.version}` }
  })
}

function missingPackageSpecs(repoRoot, packages) {
  return packages
    .filter(({ name }) => {
      const packageDir = path.join(repoRoot, 'node_modules', ...name.split('/'))
      const packageJson = path.join(packageDir, 'package.json')
      const claudeBinary = path.join(packageDir, 'claude')
      return !fs.existsSync(packageJson) || !fs.existsSync(claudeBinary)
    })
    .map(({ spec }) => spec)
}

function ensureMacUniversalOptionalDeps({
  repoRoot = process.cwd(),
  platform = process.platform,
  npmCommand = 'npm',
  exec = execFileSync
} = {}) {
  if (platform !== 'darwin') {
    return { installed: false, reason: `skipped on ${platform}`, specs: [] }
  }

  const lockPath = path.join(repoRoot, 'package-lock.json')
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  const packages = resolveDarwinClaudeSdkPackages(lock)
  const missing = missingPackageSpecs(repoRoot, packages)
  if (missing.length === 0) {
    return { installed: false, reason: 'already present', specs: [] }
  }

  exec(
    npmCommand,
    ['install', '--no-save', '--package-lock=false', '--force', '--ignore-scripts', ...missing],
    {
      cwd: repoRoot,
      stdio: 'inherit'
    }
  )
  return { installed: true, reason: 'installed missing packages', specs: missing }
}

function main() {
  const result = ensureMacUniversalOptionalDeps()
  if (result.specs.length > 0) {
    console.log(`Prepared mac universal optional deps: ${result.specs.join(', ')}`)
  } else {
    console.log(`Prepared mac universal optional deps: ${result.reason}`)
  }
}

if (require.main === module) {
  main()
}

module.exports = {
  DARWIN_CLAUDE_SDK_PACKAGES,
  ensureMacUniversalOptionalDeps,
  missingPackageSpecs,
  resolveDarwinClaudeSdkPackages
}
