import { afterEach, describe, expect, it } from 'vitest'
import { channelGatewayEnabled, concurrentLanesEnabled, messagesBridgeEnabled } from './featureGates'

const ORIGINAL_MESSAGES_FLAG = process.env.TASKWRAITH_MESSAGES_BRIDGE
const ORIGINAL_CONCURRENT_FLAG = process.env.TASKWRAITH_CONCURRENT_LANES

afterEach(() => {
  if (ORIGINAL_MESSAGES_FLAG === undefined) delete process.env.TASKWRAITH_MESSAGES_BRIDGE
  else process.env.TASKWRAITH_MESSAGES_BRIDGE = ORIGINAL_MESSAGES_FLAG
  if (ORIGINAL_CONCURRENT_FLAG === undefined) delete process.env.TASKWRAITH_CONCURRENT_LANES
  else process.env.TASKWRAITH_CONCURRENT_LANES = ORIGINAL_CONCURRENT_FLAG
})

describe('featureGates', () => {
  describe('channelGatewayEnabled', () => {
    it('allows the channel gateway in unpackaged development runs', () => {
      delete process.env.TASKWRAITH_MESSAGES_BRIDGE
      expect(channelGatewayEnabled({ isPackaged: false, appName: 'TaskWraith' })).toBe(true)
    })

    it('allows the channel gateway in packaged debug builds', () => {
      delete process.env.TASKWRAITH_MESSAGES_BRIDGE
      expect(channelGatewayEnabled({ isPackaged: true, appName: 'TaskWraith Debug' })).toBe(true)
    })

    it('disables the channel gateway in public packaged releases', () => {
      delete process.env.TASKWRAITH_MESSAGES_BRIDGE
      expect(channelGatewayEnabled({ isPackaged: true, appName: 'TaskWraith' })).toBe(false)
    })

    it('honors the local kill switch in dev/debug runs', () => {
      process.env.TASKWRAITH_MESSAGES_BRIDGE = '0'
      expect(channelGatewayEnabled({ isPackaged: false, appName: 'TaskWraith' })).toBe(false)
      expect(channelGatewayEnabled({ isPackaged: true, appName: 'TaskWraith Debug' })).toBe(false)
    })

    it('keeps messagesBridgeEnabled as a compatibility alias', () => {
      delete process.env.TASKWRAITH_MESSAGES_BRIDGE
      expect(messagesBridgeEnabled({ isPackaged: false, appName: 'TaskWraith' })).toBe(
        channelGatewayEnabled({ isPackaged: false, appName: 'TaskWraith' })
      )
    })
  })

  describe('concurrentLanesEnabled', () => {
    it('defaults on when the env flag is unset', () => {
      delete process.env.TASKWRAITH_CONCURRENT_LANES
      expect(concurrentLanesEnabled()).toBe(true)
    })

    it('opts out when TASKWRAITH_CONCURRENT_LANES=0', () => {
      process.env.TASKWRAITH_CONCURRENT_LANES = '0'
      expect(concurrentLanesEnabled()).toBe(false)
    })
  })
})
