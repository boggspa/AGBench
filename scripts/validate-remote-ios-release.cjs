#!/usr/bin/env node

/**
 * Remote/iOS release gate runner. Device-only checks are documented in
 * docs/1.0.6-REMOTE-IOS-RELEASE-GATES.md and represented here as explicit
 * skipped/manual rows unless the required credentials/environment are present.
 */

const { spawnSync } = require('child_process')

const steps = [
  {
    name: 'remote-ios fixtures',
    cmd: 'npm',
    args: ['run', 'validate:fixtures'],
    required: true
  },
  {
    name: 'swift daemon tests',
    cmd: 'npm',
    args: ['run', 'test:swift:bridge'],
    required: true,
    skipOn: process.platform !== 'darwin',
    skipReason: 'macOS-only Swift daemon'
  },
  {
    name: 'iOS Swift tests',
    cmd: 'npm',
    args: ['run', 'test:swift:ios'],
    required: true,
    skipOn: process.platform !== 'darwin',
    skipReason: 'macOS-only iOS SwiftPM slice'
  },
  {
    name: 'bridge daemon smokes',
    cmd: 'npm',
    args: ['run', 'smoke:bridge-daemon'],
    required: true,
    skipOn: process.platform !== 'darwin',
    skipReason: 'macOS-only bridge daemon'
  },
  {
    name: 'iOS simulator build',
    cmd: 'npm',
    args: ['run', 'build:ios:sim'],
    required: true,
    skipOn: process.platform !== 'darwin',
    skipReason: 'xcodebuild is macOS-only'
  },
  {
    name: 'APNs smoke',
    cmd: 'npm',
    args: ['run', 'smoke:apns'],
    required: false,
    skipOn: !hasApnsEnv(),
    skipReason: 'set AGBENCH_APNS_* env vars and run before RC'
  }
]

const results = []

console.log(`[validate-remote-ios-release] starting (${steps.length} automated gates)`)

for (const step of steps) {
  if (step.skipOn) {
    results.push({ name: step.name, status: 'skipped', reason: step.skipReason })
    console.log(`  - ${step.name}: skipped (${step.skipReason})`)
    continue
  }
  process.stdout.write(`  - ${step.name}: `)
  const startedAt = Date.now()
  const result = spawnSync(step.cmd, step.args, { stdio: 'inherit', env: process.env })
  const durationMs = Date.now() - startedAt
  if (result.status === 0) {
    results.push({ name: step.name, status: 'passed', durationMs })
    console.log(`    passed (${formatDuration(durationMs)})`)
  } else {
    results.push({
      name: step.name,
      status: step.required ? 'failed' : 'failed-advisory',
      durationMs
    })
    console.log(`    failed (${formatDuration(durationMs)})`)
  }
}

console.log('\nRemote/iOS manual gates still required before RC:')
console.log('  - real iPhone LAN smoke')
console.log('  - real iPad LAN smoke')
console.log('  - iPhone/iPad Tailscale or off-LAN smoke')
console.log('  - locked/background push-resume smoke')
console.log('  - Mac app and bridge daemon restart/reconnect smoke')

const failed = results.filter((result) => result.status === 'failed')
if (failed.length > 0) {
  console.error(`\n[validate-remote-ios-release] ${failed.length} required gate(s) failed.`)
  process.exit(3)
}

console.log('\n[validate-remote-ios-release] automated gates passed or were platform-skipped.')
process.exit(0)

function hasApnsEnv() {
  return [
    'AGBENCH_APNS_KEY_PATH',
    'AGBENCH_APNS_KEY_ID',
    'AGBENCH_APNS_TEAM_ID',
    'AGBENCH_APNS_BUNDLE_ID',
    'AGBENCH_APNS_DEVICE_TOKEN'
  ].every((key) => Boolean(process.env[key]))
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m${seconds.toString().padStart(2, '0')}s`
}
