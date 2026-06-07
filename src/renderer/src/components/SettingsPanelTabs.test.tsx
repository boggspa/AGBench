import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  getVisibleSettingsTabs,
  isSettingsTabVisible,
  resolveVisibleSettingsTab
} from './SettingsPanel'
import { SettingsSidebar } from './SettingsSidebar'

describe('Settings tabs', () => {
  it('hides dev/debug-only Channels and TestFlight-gated Devices by default', () => {
    const visibleTabs = getVisibleSettingsTabs().map((tab) => tab.id)

    expect(visibleTabs).not.toContain('messages')
    expect(visibleTabs).not.toContain('pairing')
    expect(isSettingsTabVisible('messages')).toBe(false)
    expect(isSettingsTabVisible('pairing')).toBe(false)
    expect(resolveVisibleSettingsTab('messages')).toBe('behavior')
    expect(resolveVisibleSettingsTab('pairing')).toBe('behavior')
  })

  it('omits Channels from the Settings sidebar without exposing Devices', () => {
    const html = renderToStaticMarkup(
      <SettingsSidebar
        activeTab="messages"
        onTabChange={vi.fn()}
        onBackToApp={vi.fn()}
        appVersion="1.1.0"
      />
    )

    expect(html).not.toContain('Channels')
    expect(html).not.toContain('Devices')
    expect(html).toContain('aria-selected="true"')
  })
})
