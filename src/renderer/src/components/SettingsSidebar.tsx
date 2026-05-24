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
import { SETTINGS_TABS, type SettingsTab } from './SettingsPanel'

interface SettingsSidebarProps {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  onBackToApp: () => void
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
  onBackToApp
}: SettingsSidebarProps) {
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
          {SETTINGS_TABS.map((tab, index) => {
            // Insert a thin divider whenever the group changes from the
            // previous tab so app-config and device-management read as
            // visually distinct sections (mirrors Chris's "settings |
            // pairing" framing — settings tabs on top, pairing pinned
            // to the bottom under a small gap).
            const previousGroup = index > 0 ? SETTINGS_TABS[index - 1].group : tab.group
            const showDividerAbove = index > 0 && previousGroup !== tab.group
            return (
              <span key={tab.id} className="settings-sidebar-tab-slot">
                {showDividerAbove && (
                  <span className="settings-sidebar-divider" aria-hidden="true" />
                )}
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={`settings-sidebar-tab ${activeTab === tab.id ? 'active' : ''}`}
                  onClick={() => onTabChange(tab.id)}
                >
                  <span className="settings-sidebar-tab-label">{tab.label}</span>
                </button>
              </span>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}
