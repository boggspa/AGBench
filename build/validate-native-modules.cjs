const fs = require('node:fs')
const path = require('node:path')

async function validateNativeModules(context) {
  const resourcesDir = resolveResourcesDir(context)
  const unpackedDir = path.join(resourcesDir, 'app.asar.unpacked')
  const platform = context.electronPlatformName || process.platform
  const arch = context.arch || process.arch
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

  // macOS-only: confirm the Swift GuiGeminiBridgeDaemon was embedded
  // as an extraResource. The mac build chains run
  // `prebuild:bridge-daemon` before electron-builder; this is the safety
  // net that surfaces a clear error if the binary failed to land in the
  // bundle for any reason (broken swift toolchain, missing config, etc.).
  if (platform === 'darwin') {
    const daemonPath = path.join(resourcesDir, 'bridge', 'GuiGeminiBridgeDaemon')
    if (!fs.existsSync(daemonPath)) {
      throw new Error(
        `GuiGeminiBridgeDaemon was not packaged at ${daemonPath}. Did \`npm run prebuild:bridge-daemon\` run before electron-builder?`
      )
    }
    const stat = fs.statSync(daemonPath)
    if (!stat.isFile() || stat.size === 0) {
      throw new Error(
        `GuiGeminiBridgeDaemon at ${daemonPath} is not a non-empty file (size=${stat.size}).`
      )
    }
    console.log(`Validated GuiGeminiBridgeDaemon: ${daemonPath} (${stat.size} bytes)`)
  }

  await hardenElectronFuses(context, resourcesDir)
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
  const prebuildNeedle = `/node_modules/node-pty/prebuilds/${platform}-${arch}/pty.node`
  const rebuiltNeedle = '/node_modules/node-pty/build/Release/pty.node'
  return normalizedPath.endsWith(prebuildNeedle) || normalizedPath.endsWith(rebuiltNeedle)
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

module.exports = validateNativeModules
module.exports.default = validateNativeModules
