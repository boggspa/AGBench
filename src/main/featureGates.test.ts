import { afterEach, describe, expect, it } from 'vitest'
import { messagesBridgeEnabled } from './featureGates'

const ORIGINAL_MESSAGES_FLAG = process.env.TASKWRAITH_MESSAGES_BRIDGE

afterEach(() => {
  if (ORIGINAL_MESSAGES_FLAG === undefined) delete process.env.TASKWRAITH_MESSAGES_BRIDGE
  else process.env.TASKWRAITH_MESSAGES_BRIDGE = ORIGINAL_MESSAGES_FLAG
})

describe('featureGates', () => {
  describe('messagesBridgeEnabled', () => {
    it('allows the Messages bridge in unpackaged development runs', () => {
      delete process.env.TASKWRAITH_MESSAGES_BRIDGE
      expect(messagesBridgeEnabled({ isPackaged: false, appName: 'TaskWraith' })).toBe(true)
    })

    it('allows the Messages bridge in packaged debug builds', () => {
      delete process.env.TASKWRAITH_MESSAGES_BRIDGE
      expect(messagesBridgeEnabled({ isPackaged: true, appName: 'TaskWraith Debug' })).toBe(true)
    })

    it('disables the Messages bridge in public packaged releases', () => {
      delete process.env.TASKWRAITH_MESSAGES_BRIDGE
      expect(messagesBridgeEnabled({ isPackaged: true, appName: 'TaskWraith' })).toBe(false)
    })

    it('honors the local kill switch in dev/debug runs', () => {
      process.env.TASKWRAITH_MESSAGES_BRIDGE = '0'
      expect(messagesBridgeEnabled({ isPackaged: false, appName: 'TaskWraith' })).toBe(false)
      expect(messagesBridgeEnabled({ isPackaged: true, appName: 'TaskWraith Debug' })).toBe(false)
    })
  })
})
