import { existsSync } from 'fs'
import os from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'

export interface NativeFeatureCapability {
  available: boolean
  reason?: string
}

export interface NativeBridgeCapability extends NativeFeatureCapability {
  binaryPath?: string
  binaryArchs?: string[]
  requiredArch?: string
}

export interface NativeCapabilitySnapshot {
  platform: string
  arch: string
  osRelease: string
  macosVersion?: string
  bridge: NativeBridgeCapability
  screenWatch: NativeFeatureCapability
  appwatch: NativeFeatureCapability
  ocr: NativeFeatureCapability
  appleEvents: NativeFeatureCapability
}

export interface NativeCapabilityInput {
  platform?: string
  arch?: string
  osRelease?: string
  macosVersion?: string
  binaryPath?: string
  binaryExists?: boolean
  binaryArchs?: string[]
  resourcesPath?: string
  dirname?: string
}

const MIN_BRIDGE_MACOS = '14.0'

export function getNativeCapabilitySnapshot(
  input: NativeCapabilityInput = {}
): NativeCapabilitySnapshot {
  const platform = input.platform || process.platform
  const arch = input.arch || process.arch
  const osRelease = input.osRelease || os.release()
  const macosVersion = platform === 'darwin' ? input.macosVersion || readMacosVersion() : undefined
  const binaryPath =
    input.binaryPath ||
    (platform === 'darwin'
      ? resolveBridgeDaemonBinaryPath({
          resourcesPath: input.resourcesPath,
          dirname: input.dirname
        })
      : undefined)
  const binaryExists =
    input.binaryExists !== undefined ? input.binaryExists : Boolean(binaryPath && existsSync(binaryPath))
  const requiredArch = requiredMachOArch(arch)
  const binaryArchs =
    input.binaryArchs ||
    (binaryPath && binaryExists && platform === 'darwin' ? readMachOArchs(binaryPath) : undefined)

  let bridge: NativeBridgeCapability
  if (platform !== 'darwin') {
    bridge = { available: false, reason: 'Native bridge features are available on macOS only.' }
  } else if (!macosVersion || compareVersions(macosVersion, MIN_BRIDGE_MACOS) < 0) {
    bridge = {
      available: false,
      reason: `Native bridge features require macOS ${MIN_BRIDGE_MACOS} or newer.`
    }
  } else if (!binaryPath || !binaryExists) {
    bridge = { available: false, reason: 'AgbenchBridgeDaemon binary was not found.' }
  } else if (requiredArch && binaryArchs && !binaryArchs.includes(requiredArch)) {
    bridge = {
      available: false,
      binaryPath,
      binaryArchs,
      requiredArch,
      reason: `AgbenchBridgeDaemon does not contain the current CPU architecture (${requiredArch}).`
    }
  } else {
    bridge = {
      available: true,
      binaryPath,
      ...(binaryArchs ? { binaryArchs } : {}),
      ...(requiredArch ? { requiredArch } : {})
    }
  }

  const nativeBridgeFeature = featureFromBridge(bridge)
  return {
    platform,
    arch,
    osRelease,
    ...(macosVersion ? { macosVersion } : {}),
    bridge,
    screenWatch: nativeBridgeFeature,
    appwatch: nativeBridgeFeature,
    ocr: bridge.available
      ? { available: true, reason: 'Vision OCR is optional and capture remains available if OCR fails.' }
      : nativeBridgeFeature,
    appleEvents: nativeBridgeFeature
  }
}

export function resolveBridgeDaemonBinaryPath(input: {
  resourcesPath?: string
  dirname?: string
} = {}): string {
  const resourcesPath = input.resourcesPath || process.resourcesPath
  if (resourcesPath) {
    const bundled = join(resourcesPath, 'bridge', 'AgbenchBridgeDaemon')
    if (existsSync(bundled)) return bundled
  }
  const dirname = input.dirname || __dirname
  const devDebug = join(
    dirname,
    '..',
    '..',
    'swift',
    'AgbenchBridge',
    '.build',
    'debug',
    'AgbenchBridgeDaemon'
  )
  if (existsSync(devDebug)) return devDebug
  return join(
    dirname,
    '..',
    '..',
    'swift',
    'AgbenchBridge',
    '.build',
    'release',
    'AgbenchBridgeDaemon'
  )
}

function featureFromBridge(bridge: NativeBridgeCapability): NativeFeatureCapability {
  return bridge.available ? { available: true } : { available: false, reason: bridge.reason }
}

function requiredMachOArch(arch: string): string | undefined {
  if (arch === 'arm64') return 'arm64'
  if (arch === 'x64') return 'x86_64'
  return undefined
}

function readMacosVersion(): string | undefined {
  const result = spawnSync('/usr/bin/sw_vers', ['-productVersion'], {
    encoding: 'utf8',
    stdio: 'pipe'
  })
  const version = result.status === 0 ? result.stdout.trim() : ''
  return version || undefined
}

function readMachOArchs(filePath: string): string[] | undefined {
  const result = spawnSync('/usr/bin/lipo', ['-archs', filePath], {
    encoding: 'utf8',
    stdio: 'pipe'
  })
  if (result.status !== 0) return undefined
  return result.stdout.trim().split(/\s+/).filter(Boolean)
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number(part) || 0)
  const right = b.split('.').map((part) => Number(part) || 0)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0)
    if (delta !== 0) return delta > 0 ? 1 : -1
  }
  return 0
}
