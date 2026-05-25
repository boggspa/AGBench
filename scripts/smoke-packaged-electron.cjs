#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const repoRoot = process.cwd()
const searchArg = process.argv[2]
const searchRoots = searchArg
  ? [path.resolve(repoRoot, searchArg)]
  : ['dist', 'dist-debug'].map((dir) => path.join(repoRoot, dir))
const bundleSizeGuardDisabled = process.env.AGBENCH_DISABLE_BUNDLE_SIZE_GUARD === '1'
const maxAsarBytes = readMegabyteLimit('AGBENCH_MAX_ASAR_MB', 500)
const maxZipBytes = readMegabyteLimit('AGBENCH_MAX_ZIP_MB', 700)
const launchSmokeTimeoutMs = readIntegerEnv('AGBENCH_PACKAGE_SMOKE_TIMEOUT_MS', 8000)

main().catch((error) => {
  fail(error instanceof Error ? error.stack || error.message : String(error))
})

async function main() {
  assertFile(path.join(repoRoot, 'out/main/index.js'), 'main bundle')
  assertFile(path.join(repoRoot, 'out/preload/index.js'), 'preload bundle')
  assertFile(path.join(repoRoot, 'out/renderer/index.html'), 'renderer bundle')

  const packageRoot = findPackagedApp(searchRoots)
  if (!packageRoot) {
    fail(`No packaged Electron app was found under ${searchRoots.join(', ')}.`)
  }

  const resourcesDir = resolveResourcesDir(packageRoot)
  const packageTarget = inferPackageTarget(packageRoot)
  const appAsarPath = path.join(resourcesDir, 'app.asar')
  assertDir(resourcesDir, 'Electron resources directory')
  assertFile(appAsarPath, 'packaged app.asar')
  assertMaxFileSize(appAsarPath, 'packaged app.asar', maxAsarBytes)

  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked')
  assertDir(unpackedDir, 'app.asar.unpacked directory')

  const nativeBindings = findFiles(unpackedDir, (filePath) => {
    const normalized = filePath.split(path.sep).join('/')
    return (
      normalized.includes('/node_modules/node-pty/') &&
      path.basename(filePath) === 'pty.node' &&
      isCompatibleNodePtyBinding(normalized, packageTarget.platform, packageTarget.arch)
    )
  })

  if (nativeBindings.length === 0) {
    fail(
      `Compatible node-pty native binding for ${packageTarget.platform}-${packageTarget.arch} was not found in ${unpackedDir}.`
    )
  }

  validateZipArtifacts(searchRoots)
  console.log(`packaged Electron static smoke ok: ${path.relative(repoRoot, packageRoot) || packageRoot}`)
  console.log(`node-pty native binding: ${path.relative(repoRoot, nativeBindings[0])}`)
  await runLaunchSmoke(packageRoot)
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(`Missing ${label}: ${filePath}`)
  }
}

function assertDir(dirPath, label) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    fail(`Missing ${label}: ${dirPath}`)
  }
}

function assertMaxFileSize(filePath, label, maxBytes) {
  if (bundleSizeGuardDisabled) return
  const stat = fs.statSync(filePath)
  if (stat.size > maxBytes) {
    fail(
      `${label} exceeds size limit: ${path.relative(repoRoot, filePath) || filePath} is ${formatBytes(stat.size)}; limit is ${formatBytes(maxBytes)}.`
    )
  }
}

function validateZipArtifacts(roots) {
  if (bundleSizeGuardDisabled) {
    console.log('bundle size guard skipped via AGBENCH_DISABLE_BUNDLE_SIZE_GUARD=1')
    return
  }
  const zipArtifacts = findFilesInRoots(
    roots,
    (filePath) => path.extname(filePath).toLowerCase() === '.zip'
  )
  for (const zipPath of zipArtifacts) {
    assertMaxFileSize(zipPath, 'packaged zip artifact', maxZipBytes)
  }
  if (zipArtifacts.length > 0) {
    console.log(`validated packaged zip size guard: ${zipArtifacts.length} artifact(s)`)
  }
}

async function runLaunchSmoke(packageRoot) {
  if (process.env.AGBENCH_SKIP_LAUNCH_SMOKE === '1') {
    console.log('packaged app launch smoke skipped via AGBENCH_SKIP_LAUNCH_SMOKE=1')
    return
  }
  if (process.platform !== 'darwin' || !packageRoot.endsWith('.app')) {
    console.log(`packaged app launch smoke skipped for ${process.platform}`)
    return
  }

  const executablePath = resolveMacExecutablePath(packageRoot)
  const appName = path.basename(packageRoot, '.app')
  const openProc = spawn('/usr/bin/open', ['-n', '-W', packageRoot], {
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let openOutput = ''
  let openError = null
  openProc.stdout?.on('data', (chunk) => {
    openOutput += chunk.toString()
  })
  openProc.stderr?.on('data', (chunk) => {
    openOutput += chunk.toString()
  })
  openProc.on('error', (error) => {
    openError = error
  })

  const launchResult = await waitForMacAppProcess(executablePath, launchSmokeTimeoutMs)
  await quitMacAppProcess(executablePath)
  const exitResult = await waitForChildExit(openProc, 3000)
  if (!exitResult.exited) {
    openProc.kill('SIGTERM')
  }

  if (openError) {
    fail(`Failed to launch packaged app with /usr/bin/open: ${openError.message}`)
  }
  if (!launchResult.ok) {
    const detail = openOutput.trim() ? `\nopen output:\n${openOutput.trim()}` : ''
    fail(
      `Packaged app launch smoke failed: ${appName} did not stay running within ${launchSmokeTimeoutMs}ms.${detail}`
    )
  }

  console.log(`packaged app launch smoke ok: ${appName} (${launchResult.pidCount} process id(s))`)
}

function resolveMacExecutablePath(packageRoot) {
  const macosDir = path.join(packageRoot, 'Contents', 'MacOS')
  const appName = path.basename(packageRoot, '.app')
  const candidates = [path.join(macosDir, appName)]
  for (const entry of safeReadDir(macosDir)) {
    if (entry.isFile()) candidates.push(path.join(macosDir, entry.name))
  }
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (found) return found
  fail(`Packaged app executable was not found under ${macosDir}.`)
}

async function waitForMacAppProcess(executablePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let firstSeenAt = 0
  let lastPidCount = 0
  while (Date.now() < deadline) {
    const pids = findProcessIdsForExecutable(executablePath)
    lastPidCount = pids.length
    if (pids.length > 0) {
      if (firstSeenAt === 0) firstSeenAt = Date.now()
      if (Date.now() - firstSeenAt >= 1500) {
        return { ok: true, pidCount: pids.length }
      }
    } else {
      firstSeenAt = 0
    }
    await sleep(250)
  }
  return { ok: false, pidCount: lastPidCount }
}

async function quitMacAppProcess(executablePath) {
  const pids = findProcessIdsForExecutable(executablePath)
  if (pids.length === 0) return
  spawnSync('/bin/kill', pids, { stdio: 'ignore' })
  await sleep(500)
  const remaining = findProcessIdsForExecutable(executablePath)
  if (remaining.length > 0) {
    spawnSync('/bin/kill', ['-9', ...remaining], { stdio: 'ignore' })
  }
}

function findProcessIdsForExecutable(executablePath) {
  const result = spawnSync('/usr/bin/pgrep', ['-f', escapeRegex(executablePath)], {
    encoding: 'utf8'
  })
  if (result.status !== 0 || !result.stdout.trim()) return []
  return result.stdout
    .trim()
    .split(/\s+/)
    .map((pid) => pid.trim())
    .filter(Boolean)
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ exited: true })
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve({ exited: false })
    }, timeoutMs)
    const onExit = () => {
      cleanup()
      resolve({ exited: true })
    }
    const cleanup = () => {
      clearTimeout(timer)
      child.off('exit', onExit)
    }
    child.once('exit', onExit)
  })
}

function findPackagedApp(roots) {
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    if (isPackagedRoot(root)) return root
    const found = findDirectories(root, isPackagedRoot, 5)
    if (found.length > 0) return found[0]
  }
  return null
}

function isPackagedRoot(candidate) {
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) return false
  if (
    candidate.endsWith('.app') &&
    fs.existsSync(path.join(candidate, 'Contents/Resources/app.asar'))
  ) {
    return true
  }
  return fs.existsSync(path.join(candidate, 'resources/app.asar'))
}

function resolveResourcesDir(packageRoot) {
  if (packageRoot.endsWith('.app')) {
    return path.join(packageRoot, 'Contents/Resources')
  }
  return path.join(packageRoot, 'resources')
}

function inferPackageTarget(packageRoot) {
  const normalized = packageRoot.split(path.sep).join('/')
  if (
    packageRoot.endsWith('.app') ||
    normalized.includes('/mac') ||
    normalized.includes('darwin')
  ) {
    return { platform: 'darwin', arch: normalized.includes('arm64') ? 'arm64' : process.arch }
  }
  if (normalized.includes('win-unpacked') || normalized.includes('/win')) {
    return {
      platform: 'win32',
      arch: normalized.includes('arm64') ? 'arm64' : normalized.includes('ia32') ? 'ia32' : 'x64'
    }
  }
  if (normalized.includes('linux')) {
    return {
      platform: 'linux',
      arch: normalized.includes('arm64')
        ? 'arm64'
        : normalized.includes('armv7l')
          ? 'armv7l'
          : 'x64'
    }
  }
  return { platform: process.platform, arch: process.arch }
}

function isCompatibleNodePtyBinding(normalizedPath, platform, arch) {
  const prebuildNeedle = `/node_modules/node-pty/prebuilds/${platform}-${arch}/pty.node`
  const rebuiltNeedle = '/node_modules/node-pty/build/Release/pty.node'
  return normalizedPath.endsWith(prebuildNeedle) || normalizedPath.endsWith(rebuiltNeedle)
}

function findDirectories(root, predicate, maxDepth, depth = 0) {
  if (depth > maxDepth) return []
  const entries = safeReadDir(root)
  const matches = []
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (!entry.isDirectory()) continue
    if (predicate(fullPath)) {
      matches.push(fullPath)
      continue
    }
    matches.push(...findDirectories(fullPath, predicate, maxDepth, depth + 1))
  }
  return matches
}

function findFiles(root, predicate) {
  const matches = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of safeReadDir(current)) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile() && predicate(fullPath)) {
        matches.push(fullPath)
      }
    }
  }
  return matches
}

function findFilesInRoots(roots, predicate) {
  const matches = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    if (fs.statSync(root).isFile()) {
      if (predicate(root)) matches.push(root)
      continue
    }
    matches.push(...findFiles(root, predicate))
  }
  return matches
}

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

function readMegabyteLimit(envName, defaultMb) {
  const raw = process.env[envName]
  if (!raw) return defaultMb * 1024 * 1024
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) {
    fail(`${envName} must be a positive number of megabytes.`)
  }
  return Math.floor(value * 1024 * 1024)
}

function readIntegerEnv(envName, defaultValue) {
  const raw = process.env[envName]
  if (!raw) return defaultValue
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${envName} must be a positive integer.`)
  }
  return value
}

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
