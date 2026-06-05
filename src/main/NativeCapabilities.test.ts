import { describe, expect, it } from 'vitest'
import { getNativeCapabilitySnapshot } from './NativeCapabilities'

describe('NativeCapabilities', () => {
  it('keeps the bridge available on Intel macOS 15.5 when the binary has x86_64', () => {
    expect(
      getNativeCapabilitySnapshot({
        platform: 'darwin',
        arch: 'x64',
        osRelease: '24.5.0',
        macosVersion: '15.5',
        binaryPath: '/tmp/AgbenchBridgeDaemon',
        binaryExists: true,
        binaryArchs: ['arm64', 'x86_64']
      }).bridge
    ).toMatchObject({
      available: true,
      requiredArch: 'x86_64'
    })
  })

  it('disables the bridge below macOS 14', () => {
    expect(
      getNativeCapabilitySnapshot({
        platform: 'darwin',
        arch: 'arm64',
        osRelease: '22.6.0',
        macosVersion: '13.6',
        binaryPath: '/tmp/AgbenchBridgeDaemon',
        binaryExists: true,
        binaryArchs: ['arm64']
      }).bridge
    ).toMatchObject({
      available: false,
      reason: 'Native bridge features require macOS 14.0 or newer.'
    })
  })

  it('rejects bridge binaries missing the current CPU slice', () => {
    expect(
      getNativeCapabilitySnapshot({
        platform: 'darwin',
        arch: 'x64',
        osRelease: '24.5.0',
        macosVersion: '15.5',
        binaryPath: '/tmp/AgbenchBridgeDaemon',
        binaryExists: true,
        binaryArchs: ['arm64']
      }).bridge
    ).toMatchObject({
      available: false,
      requiredArch: 'x86_64',
      reason: 'AgbenchBridgeDaemon does not contain the current CPU architecture (x86_64).'
    })
  })
})
