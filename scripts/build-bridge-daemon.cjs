#!/usr/bin/env node

/**
 * build-bridge-daemon
 *
 * Pre-build step that compiles the Swift GuiGeminiBridgeDaemon as a
 * release binary so electron-builder can bundle it as an extraResource
 * in the packaged .app. macOS-only; no-op (with a friendly log) on
 * other platforms because the daemon uses Apple Network framework +
 * Bonjour + CryptoKit and only makes sense in a macOS Electron build.
 *
 * Invoked via the `prebuild:bridge-daemon` npm script before the
 * electron-builder step in mac build targets.
 */

const { spawnSync } = require('child_process')
const { existsSync } = require('fs')
const { join } = require('path')

const REPO_ROOT = join(__dirname, '..')
const PACKAGE_PATH = join(REPO_ROOT, 'swift', 'GuiGeminiBridge')

if (process.platform !== 'darwin') {
  console.log(
    `[build-bridge-daemon] Skipping — daemon is macOS-only (platform=${process.platform})`
  )
  process.exit(0)
}

if (!existsSync(join(PACKAGE_PATH, 'Package.swift'))) {
  console.error(`[build-bridge-daemon] No SwiftPM manifest at ${PACKAGE_PATH}/Package.swift`)
  process.exit(2)
}

console.log('[build-bridge-daemon] swift build -c release …')
const result = spawnSync('swift', ['build', '-c', 'release', '--package-path', PACKAGE_PATH], {
  stdio: 'inherit'
})

if (result.status !== 0) {
  console.error(`[build-bridge-daemon] swift build exited with code ${result.status}`)
  process.exit(result.status ?? 1)
}

const binaryPath = join(PACKAGE_PATH, '.build', 'release', 'GuiGeminiBridgeDaemon')
if (!existsSync(binaryPath)) {
  console.error(`[build-bridge-daemon] Expected binary not found at ${binaryPath}`)
  process.exit(3)
}

console.log(`[build-bridge-daemon] OK — release binary at ${binaryPath}`)
