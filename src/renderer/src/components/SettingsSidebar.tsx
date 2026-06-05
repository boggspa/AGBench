/**
 * SettingsSidebar — minimal Codex-style left-rail for the Settings
 * full-app takeover. When the user opens Settings (via the workspace
 * sidebar footer or the FirstLaunchSheet), App.tsx swaps the regular
 * `<Sidebar />` for this component and the transcript pane for the
 * SettingsPanel rendered in `layout="takeover"` mode.
 *
 * Visual reference: Codex CLI / Claude Code app — single column of
 * tab labels, no AGBench masthead, no workspace metadata, no search.
 * "← Back to app" sits at the top to flip the user back to the
 * regular chat surface.
 *
 * Tab labels and ids stay canonical in `SettingsPanel.tsx` via the
 * exported `SETTINGS_TABS` constant — this component re-uses that
 * list so the two render sites can't drift when tabs are added or
 * renamed in the future.
 */
import {
  getVisibleSettingsTabs,
  resolveVisibleSettingsTab,
  type SettingsTab
} from './SettingsPanel'

interface SettingsSidebarProps {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  onBackToApp: () => void
  appVersion?: string
}

function ArrowLeftSymbolIcon() {
  return (
    <span className="sf-symbol-icon" aria-hidden>
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9.5 4.2 5.5 8l4 3.8" />
        <path d="M5.7 8h6" />
      </svg>
    </span>
  )
}

export function SettingsSidebar({
  activeTab,
  onTabChange,
  onBackToApp,
  appVersion
}: SettingsSidebarProps) {
  const visibleVersion = appVersion && appVersion !== 'unknown' ? appVersion : null
  const visibleSettingsTabs = getVisibleSettingsTabs()
  const resolvedActiveTab = resolveVisibleSettingsTab(activeTab)

  return (
    <aside className="app-sidebar settings-sidebar" aria-label="Settings navigation">
      <div className="settings-sidebar-inner">
        <button
          type="button"
          className="settings-sidebar-back"
          onClick={onBackToApp}
          title="Return to the chat surface"
        >
          <ArrowLeftSymbolIcon />
          <span>Back to app</span>
        </button>
        <nav className="settings-sidebar-tabs" role="tablist" aria-label="Settings sections">
          {visibleSettingsTabs.map((tab, index) => {
            // Insert a thin divider whenever the group changes from the
            // previous tab so app-config and device-management read as
            // visually distinct sections (mirrors the maintainer's "settings |
            // pairing" framing — settings tabs on top, pairing pinned
            // to the bottom under a small gap).
            const previousGroup = index > 0 ? visibleSettingsTabs[index - 1].group : tab.group
            const showDividerAbove = index > 0 && previousGroup !== tab.group
            return (
              <span key={tab.id} className="settings-sidebar-tab-slot">
                {showDividerAbove && (
                  <span className="settings-sidebar-divider" aria-hidden="true" />
                )}
                <button
                  type="button"
                  role="tab"
                  aria-selected={resolvedActiveTab === tab.id}
                  className={`settings-sidebar-tab ${resolvedActiveTab === tab.id ? 'active' : ''}`}
                  onClick={() => onTabChange(tab.id)}
                >
                  <span className="settings-sidebar-tab-label">{tab.label}</span>
                </button>
              </span>
            )
          })}
        </nav>
        {visibleVersion && (
          <div
            className="settings-sidebar-version"
            aria-label={`AGBench version ${visibleVersion}`}
          >
            AGBench v{visibleVersion}
          </div>
        )}
      </div>
    </aside>
  )
}
