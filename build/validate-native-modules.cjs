const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

async function validateNativeModules(context) {
  const resourcesDir = resolveResourcesDir(context)
  validateAppAsarSize(resourcesDir)
  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked')
  const platform = context.electronPlatformName || process.platform
  const arch = normalizeArch(context.arch || process.arch)
  const expectedMacArchs = platform === 'darwin' ? expectedMacArchitectures(context, arch) : []

  if (platform === 'darwin' && expectedMacArchs.length > 1) {
    removeHostOnlyNodePtyBuildBinding(unpackedDir, expectedMacArchs)
  }

  const nodePtyBindings = findFiles(unpackedDir, (filePath) => {
    const normalized = filePath.split(path.sep).join('/')
    return (
      normalized.includes('/node_modules/node-pty/') &&
      path.basename(filePath) === 'pty.node' &&
      isCompatibleNodePtyBinding(normalized, platform, arch)
    )
  })

  if (nodePtyBindings.length === 0) {
    throw new Error(
      `Compatible node-pty native binding for ${platform}-${arch} was not packaged under ${unpackedDir}.`
    )
  }

  console.log(`Validated node-pty native binding: ${nodePtyBindings[0]}`)

  if (platform === 'darwin' && expectedMacArchs.length > 0) {
    validateMacNodePtyBindings(unpackedDir, expectedMacArchs)
  }

  // macOS-only: confirm the Swift AgbenchBridgeDaemon was embedded
  // as an extraResource. The mac build chains run
  // `prebuild:bridge-daemon` before electron-builder; this is the safety
  // net that surfaces a clear error if the binary failed to land in the
  // bundle for any reason (broken swift toolchain, missing config, etc.).
  if (platform === 'darwin') {
    const daemonPath = path.join(resourcesDir, 'bridge', 'AgbenchBridgeDaemon')
    if (!fs.existsSync(daemonPath)) {
      throw new Error(
        `AgbenchBridgeDaemon was not packaged at ${daemonPath}. Did \`npm run prebuild:bridge-daemon\` run before electron-builder?`
      )
    }
    const stat = fs.statSync(daemonPath)
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(
        `AgbenchBridgeDaemon at ${daemonPath} is not a non-empty file (size=${stat.size}).`
      )
    }
    verifyMachOArchitectures(daemonPath, expectedMacArchs, 'AgbenchBridgeDaemon')
    validateMacAppBinaries(resourcesDir, context, expectedMacArchs)
    console.log(`Validated AgbenchBridgeDaemon: ${daemonPath} (${stat.size} bytes)`)
  }

  await hardenElectronFuses(context, resourcesDir)
}

function validateAppAsarSize(resourcesDir) {
  if (process.env.AGBENCH_DISABLE_BUNDLE_SIZE_GUARD === '1') {
    console.log('Skipped app.asar size guard via AGBENCH_DISABLE_BUNDLE_SIZE_GUARD=1')
    return
  }

  const appAsarPath = path.join(resourcesDir, 'app.asar')
  if (!fs.existsSync(appAsarPath)) {
    throw new Error(`app.asar was not packaged at ${appAsarPath}.`)
  }

  const maxBytes = readMegabyteLimit('AGBENCH_MAX_ASAR_MB', 500)
  const stat = fs.statSync(appAsarPath)
  if (!stat.isFile()) {
    throw new Error(`app.asar path is not a file: ${appAsarPath}`)
  }
  if (stat.size > maxBytes) {
    throw new Error(
      `app.asar exceeds size limit: ${appAsarPath} is ${formatBytes(stat.size)}; limit is ${formatBytes(maxBytes)}.`
    )
  }
  console.log(`Validated app.asar size: ${formatBytes(stat.size)} <= ${formatBytes(maxBytes)}`)
}

async function hardenElectronFuses(context, resourcesDir) {
  const executablePath = resolveElectronExecutable(context, resourcesDir)
  const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')
  await flipFuses(executablePath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false
  })
  console.log(`Hardened Electron fuses: ${executablePath}`)
}

function resolveElectronExecutable(context, resourcesDir) {
  const appOutDir = context.appOutDir
  const platform = context.electronPlatformName || process.platform
  const appInfo = context.packager && context.packager.appInfo
  const productFilename = appInfo && (appInfo.productFilename || appInfo.productName)
  const productName = appInfo && appInfo.productName
  const names = Array.from(new Set([productFilename, productName, 'AGBench'].filter(Boolean)))

  const candidates = []
  if (platform === 'darwin') {
    const contentsDir = path.dirname(resourcesDir)
    for (const name of names) {
      candidates.push(path.join(contentsDir, 'MacOS', name))
    }
  } else if (platform === 'win32') {
    for (const name of names) {
      candidates.push(path.join(appOutDir, `${name}.exe`))
    }
  } else {
    for (const name of names) {
      candidates.push(path.join(appOutDir, name))
    }
  }

  const found = candidates.find((candidate) => fs.existsSync(candidate))
  if (found) return found
  throw new Error(`Electron executable was not found. Checked: ${candidates.join(', ')}`)
}

function isCompatibleNodePtyBinding(normalizedPath, platform, arch) {
  if (platform === 'darwin' && arch === 'universal') {
    return /\/node_modules\/node-pty\/prebuilds\/darwin-(?:arm64|x64)\/pty\.node$/.test(
      normalizedPath
    )
  }
  const prebuildNeedle = `/node_modules/node-pty/prebuilds/${platform}-${arch}/pty.node`
  const rebuiltNeedle = '/node_modules/node-pty/build/Release/pty.node'
  return normalizedPath.endsWith(prebuildNeedle) || normalizedPath.endsWith(rebuiltNeedle)
}

function validateMacNodePtyBindings(unpackedDir, expectedArchs) {
  const nodePtyDir = findNodePtyDir(unpackedDir)
  if (!nodePtyDir) {
    throw new Error(`node-pty package was not unpacked under ${unpackedDir}.`)
  }
  if (expectedArchs.length > 1) {
    const requiredPrebuilds = [
      { pathArch: 'darwin-arm64', machArch: 'arm64' },
      { pathArch: 'darwin-x64', machArch: 'x86_64' }
    ]
    for (const prebuild of requiredPrebuilds) {
      const prebuildPath = path.join(nodePtyDir, 'prebuilds', prebuild.pathArch, 'pty.node')
      if (!fs.existsSync(prebuildPath)) {
        throw new Error(`Required node-pty universal prebuild is missing: ${prebuildPath}`)
      }
      verifyMachOArchitectures(prebuildPath, [prebuild.machArch], `node-pty ${prebuild.pathArch}`)
    }
    console.log('Validated node-pty Darwin prebuilds for universal package.')
    return
  }

  for (const binding of findFiles(nodePtyDir, (filePath) => path.basename(filePath) === 'pty.node')) {
    verifyMachOArchitectures(binding, expectedArchs, `node-pty ${path.relative(nodePtyDir, binding)}`)
  }
}

function removeHostOnlyNodePtyBuildBinding(unpackedDir, expectedArchs) {
  const nodePtyDir = findNodePtyDir(unpackedDir)
  if (!nodePtyDir) return
  const buildBinding = path.join(nodePtyDir, 'build', 'Release', 'pty.node')
  if (!fs.existsSync(buildBinding)) return
  const hasAllArchs = expectedArchs.every((arch) => hasMachOArchitecture(buildBinding, arch))
  if (hasAllArchs) return
  fs.rmSync(path.join(nodePtyDir, 'build'), { recursive: true, force: true })
  console.log(
    `Removed host-only node-pty build binding from universal package: ${buildBinding}`
  )
}

function findNodePtyDir(unpackedDir) {
  const candidates = findDirectories(
    unpackedDir,
    (candidate) => candidate.split(path.sep).join('/').endsWith('/node_modules/node-pty'),
    8
  )
  return candidates[0]
}

function validateMacAppBinaries(resourcesDir, context, expectedArchs) {
  if (expectedArchs.length === 0) return
  const executablePath = resolveElectronExecutable(context, resourcesDir)
  verifyMachOArchitectures(executablePath, expectedArchs, 'app executable')

  const contentsDir = path.dirname(resourcesDir)
  const frameworksDir = path.join(contentsDir, 'Frameworks')
  const electronFramework = path.join(
    frameworksDir,
    'Electron Framework.framework',
    'Electron Framework'
  )
  if (fs.existsSync(electronFramework)) {
    verifyMachOArchitectures(electronFramework, expectedArchs, 'Electron Framework')
  }
  for (const helperApp of findDirectories(frameworksDir, (candidate) => candidate.endsWith('.app'), 5)) {
    const helperMacOSDir = path.join(helperApp, 'Contents', 'MacOS')
    for (const entry of safeReadDir(helperMacOSDir)) {
      if (!entry.isFile()) continue
      verifyMachOArchitectures(
        path.join(helperMacOSDir, entry.name),
        expectedArchs,
        `Electron helper ${path.basename(helperApp)}`
      )
    }
  }
}

function expectedMacArchitectures(context, arch) {
  const appOutDir = String(context.appOutDir || '').toLowerCase()
  if (arch === 'universal' || appOutDir.includes('mac-universal')) return ['arm64', 'x86_64']
  if (arch === 'arm64') return ['arm64']
  if (arch === 'x64') return ['x86_64']
  return []
}

function normalizeArch(value) {
  if (typeof value === 'number') {
    try {
      const { Arch } = require('builder-util')
      return Arch[value] || String(value)
    } catch {
      return String(value)
    }
  }
  return String(value || process.arch)
}

function verifyMachOArchitectures(filePath, archs, label) {
  if (process.platform !== 'darwin' || archs.length === 0) return
  for (const arch of archs) {
    if (hasMachOArchitecture(filePath, arch)) continue
    throw new Error(`${label} is missing ${arch} slice: ${filePath}`)
  }
}

function hasMachOArchitecture(filePath, arch) {
  const result = spawnSync('/usr/bin/lipo', [filePath, '-verify_arch', arch], {
    stdio: 'pipe',
    encoding: 'utf8'
  })
  return result.status === 0
}

function resolveResourcesDir(context) {
  const appOutDir = context.appOutDir
  const appInfo = context.packager && context.packager.appInfo
  const productFilename = appInfo && (appInfo.productFilename || appInfo.productName)

  if (context.electronPlatformName === 'darwin') {
    const candidates = [
      productFilename
        ? path.join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources')
        : '',
      ...findDirectories(appOutDir, (candidate) => candidate.endsWith('.app'), 2).map((appPath) =>
        path.join(appPath, 'Contents', 'Resources')
      )
    ].filter(Boolean)
    const found = candidates.find((candidate) => fs.existsSync(candidate))
    if (found) return found
  }

  const resourcesDir = path.join(appOutDir, 'resources')
  if (fs.existsSync(resourcesDir)) return resourcesDir
  throw new Error(`Electron resources directory was not found in ${appOutDir}.`)
}

function findDirectories(root, predicate, maxDepth, depth = 0) {
  if (!root || depth > maxDepth) return []
  const entries = safeReadDir(root)
  const matches = []
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)
    if (!entry.isDirectory()) continue
    if (predicate(fullPath)) {
      matches.push(fullPath)
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
    throw new Error(`${envName} must be a positive number of megabytes.`)
  }
  return Math.floor(value * 1024 * 1024)
}

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
}

module.exports = validateNativeModules
module.exports.default = validateNativeModules
