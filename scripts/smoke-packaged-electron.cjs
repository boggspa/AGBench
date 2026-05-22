#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

const repoRoot = process.cwd()
const searchArg = process.argv[2]
const searchRoots = searchArg
  ? [path.resolve(repoRoot, searchArg)]
  : ['dist', 'dist-debug'].map((dir) => path.join(repoRoot, dir))

assertFile(path.join(repoRoot, 'out/main/index.js'), 'main bundle')
assertFile(path.join(repoRoot, 'out/preload/index.js'), 'preload bundle')
assertFile(path.join(repoRoot, 'out/renderer/index.html'), 'renderer bundle')

const packageRoot = findPackagedApp(searchRoots)
if (!packageRoot) {
  fail(`No packaged Electron app was found under ${searchRoots.join(', ')}.`)
}

const resourcesDir = resolveResourcesDir(packageRoot)
const packageTarget = inferPackageTarget(packageRoot)
assertDir(resourcesDir, 'Electron resources directory')
assertFile(path.join(resourcesDir, 'app.asar'), 'packaged app.asar')

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

console.log(`packaged Electron smoke ok: ${path.relative(repoRoot, packageRoot) || packageRoot}`)
console.log(`node-pty native binding: ${path.relative(repoRoot, nativeBindings[0])}`)

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

function safeReadDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
