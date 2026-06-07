import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  getVisibleSettingsTabs,
  isSettingsTabVisible,
  resolveVisibleSettingsTab
} from './SettingsPanel'
import { SettingsSidebar } from './SettingsSidebar'

describe('Settings tabs', () => {
  it('shows Messages as its own default tab while keeping TestFlight-gated Devices hidden', () => {
    const visibleTabs = getVisibleSettingsTabs().map((tab) => tab.id)

    expect(visibleTabs).toContain('messages')
    expect(visibleTabs).not.toContain('pairing')
    expect(isSettingsTabVisible('messages')).toBe(true)
    expect(isSettingsTabVisible('pairing')).toBe(false)
    expect(resolveVisibleSettingsTab('messages')).toBe('messages')
    expect(resolveVisibleSettingsTab('pairing')).toBe('behavior')
  })

  it('renders Messages in the Settings sidebar without exposing Devices', () => {
    const html = renderToStaticMarkup(
      <SettingsSidebar
        activeTab="messages"
        onTabChange={vi.fn()}
        onBackToApp={vi.fn()}
        appVersion="1.1.0"
      />
    )

    expect(html).toContain('Messages')
    expect(html).not.toContain('Devices')
    expect(html).toContain('aria-selected="true"')
  })
})
