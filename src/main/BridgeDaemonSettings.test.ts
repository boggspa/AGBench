import { describe, expect, it } from 'vitest'
import { resolveDaemonShouldRun } from './BridgeDaemonSettings'

describe('resolveDaemonShouldRun', () => {
  it('defaults on when setting and env are unset', () => {
    expect(resolveDaemonShouldRun(undefined, undefined)).toMatchObject({
      shouldRun: true,
      settingEnabled: true,
      envOverride: null,
      source: 'settings'
    })
  })

  it('follows the persisted setting when env is unset', () => {
    expect(resolveDaemonShouldRun(false, undefined)).toMatchObject({
      shouldRun: false,
      settingEnabled: false,
      envOverride: null,
      source: 'settings'
    })
    expect(resolveDaemonShouldRun(true, undefined)).toMatchObject({
      shouldRun: true,
      settingEnabled: true,
      envOverride: null,
      source: 'settings'
    })
  })

  it('forces on when TASKWRAITH_BRIDGE_DAEMON is 1 or true', () => {
    expect(resolveDaemonShouldRun(false, '1')).toMatchObject({
      shouldRun: true,
      settingEnabled: false,
      envOverride: 'force-on',
      source: 'environment'
    })
    expect(resolveDaemonShouldRun(false, ' TRUE ')).toMatchObject({
      shouldRun: true,
      settingEnabled: false,
      envOverride: 'force-on',
      source: 'environment'
    })
  })

  it('forces off when TASKWRAITH_BRIDGE_DAEMON is 0 or false', () => {
    expect(resolveDaemonShouldRun(true, '0')).toMatchObject({
      shouldRun: false,
      settingEnabled: true,
      envOverride: 'force-off',
      source: 'environment'
    })
    expect(resolveDaemonShouldRun(true, 'false')).toMatchObject({
      shouldRun: false,
      settingEnabled: true,
      envOverride: 'force-off',
      source: 'environment'
    })
  })

  it('ignores unrecognized env values and falls back to the setting', () => {
    expect(resolveDaemonShouldRun(false, 'later')).toMatchObject({
      shouldRun: false,
      settingEnabled: false,
      envOverride: null,
      source: 'settings'
    })
  })
})
