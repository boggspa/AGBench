#!/usr/bin/env node

/**
 * Builds the iOS companion for the generic iOS Simulator destination. This is
 * a release gate, not part of the default cross-platform CI path.
 */

const { spawnSync } = require('child_process')
const { existsSync } = require('fs')
const { join } = require('path')

const REPO_ROOT = join(__dirname, '..')
const IOS_DIR = join(REPO_ROOT, 'ios', 'GuiGeminiCompanion')
const PROJECT_PATH = join(IOS_DIR, 'GuiGeminiCompanion.xcodeproj')
const REQUIRED = process.env.AGBENCH_IOS_SIM_REQUIRED === '1'

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || REPO_ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...(opts.env || {}) }
  })
  if (result.status !== 0) process.exit(result.status || 1)
}

function commandExists(cmd) {
  const result = spawnSync('sh', ['-lc', `command -v ${cmd}`], { stdio: 'ignore' })
  return result.status === 0
}

if (process.platform !== 'darwin') {
  const message = `[build-ios-simulator] Skipping — xcodebuild is macOS-only (platform=${process.platform})`
  if (REQUIRED) {
    console.error(message)
    process.exit(2)
  }
  console.log(message)
  process.exit(0)
}

if (!commandExists('xcodebuild')) {
  console.error('[build-ios-simulator] xcodebuild not found')
  process.exit(2)
}

if (!existsSync(PROJECT_PATH)) {
  if (!commandExists('xcodegen')) {
    console.error(
      '[build-ios-simulator] GuiGeminiCompanion.xcodeproj missing and xcodegen not found'
    )
    process.exit(2)
  }
  console.log('[build-ios-simulator] generating Xcode project with xcodegen')
  run('xcodegen', ['generate'], { cwd: IOS_DIR })
}

run(
  'xcodebuild',
  [
    '-project',
    'GuiGeminiCompanion.xcodeproj',
    '-scheme',
    'GuiGeminiCompanion',
    '-configuration',
    'Debug',
    '-destination',
    'generic/platform=iOS Simulator',
    'CODE_SIGNING_ALLOWED=NO',
    'build'
  ],
  { cwd: IOS_DIR }
)
