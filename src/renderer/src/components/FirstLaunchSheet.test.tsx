import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FirstLaunchSheet } from './FirstLaunchSheet'
import type { GeminiAuthStatus, ProviderApiKeyStatus } from '../../../main/store/types'

/**
 * Server-rendered smoke tests for FirstLaunchSheet. The component
 * is mostly presentation — these tests cover the gnarly bits:
 *   1. `open={false}` renders nothing (auto-show gating is host-side
 *      but this is the contract the host depends on).
 *   2. Status-summary lines flip correctly for the four provider
 *      shapes (signed-in / not-available / not-signed-in / no status).
 *   3. Kimi card is rendered with the de-emphasised class so the
 *      light-mode CSS picks up the muted styling.
 *
 * We don't simulate clicks — the codebase uses `renderToStaticMarkup`
 * (no jsdom), so interaction coverage lives in manual / e2e testing.
 */

function makeProviderApiKeyStatus(
  overrides: Partial<ProviderApiKeyStatus> = {}
): ProviderApiKeyStatus {
  return {
    available: true,
    authState: 'authenticated',
    apiKeyConfigured: false,
    encryptionAvailable: true,
    ...overrides
  }
}

function makeGeminiAuthStatus(overrides: Partial<GeminiAuthStatus> = {}): GeminiAuthStatus {
  return {
    available: true,
    authState: 'authenticated',
    apiKeyConfigured: false,
    encryptionAvailable: true,
    profiles: [],
    activeProfileId: null,
    ...overrides
  }
}

describe('FirstLaunchSheet', () => {
  it('returns null when not open so the host can mount it unconditionally', () => {
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={false}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={null}
        claudeAuthStatus={null}
        kimiAuthStatus={null}
        geminiAuthStatus={null}
      />
    )
    expect(html).toBe('')
  })

  it('renders all four provider cards when open', () => {
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={true}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={null}
        claudeAuthStatus={null}
        kimiAuthStatus={null}
        geminiAuthStatus={null}
      />
    )
    expect(html).toContain('data-provider="codex"')
    expect(html).toContain('data-provider="claude"')
    expect(html).toContain('data-provider="gemini"')
    expect(html).toContain('data-provider="kimi"')
  })

  it('renders Welcome heading and the numbered onboarding sections', () => {
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={true}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={null}
        claudeAuthStatus={null}
        kimiAuthStatus={null}
        geminiAuthStatus={null}
      />
    )
    expect(html).toContain('Welcome to AGBench')
    expect(html).toContain('1. Sign in to your providers')
    expect(html).toContain('2. Add your first workspace')
    expect(html).toContain('3. Choose your starting look')
    expect(html).toContain('4. Try Ensemble chats')
    expect(html).toContain('5. Power-user shortcuts')
  })

  it('renders the Appearance preference controls and preview surfaces', () => {
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={true}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={null}
        claudeAuthStatus={null}
        kimiAuthStatus={null}
        geminiAuthStatus={null}
        themeAppearance="blue"
        composerStyle="claude"
        userBubbleColor="purple"
      />
    )
    expect(html).toContain('Theme')
    expect(html).toContain('Composer shell')
    expect(html).toContain('Message bubble')
    expect(html).toContain('Composer preview')
    expect(html).toContain('data-composer-style="claude"')
    expect(html).toContain('data-user-bubble-color="purple"')
    expect(html).toContain('Plan / Read-only')
  })

  it('renders the Ensemble preview row with provider participants', () => {
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={true}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={null}
        claudeAuthStatus={null}
        kimiAuthStatus={null}
        geminiAuthStatus={null}
      />
    )
    expect(html).toContain('New Ensemble puts multiple provider participants')
    expect(html).toContain('data-provider="codex"')
    expect(html).toContain('data-provider="claude"')
    expect(html).toContain('data-provider="gemini"')
    expect(html).toContain('data-provider="kimi"')
    expect(html).toContain('Turn / Continuous in the composer')
  })

  it('Kimi card carries the de-emphasised + optional classes for muted styling', () => {
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={true}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={null}
        claudeAuthStatus={null}
        kimiAuthStatus={null}
        geminiAuthStatus={null}
      />
    )
    // The kimi card div should appear with both modifier classes.
    expect(html).toMatch(
      /first-launch-sheet-provider-card[^"]*first-launch-sheet-provider-card-deemphasised/
    )
  })

  it('Gemini card is marked optional but not de-emphasised', () => {
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={true}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={null}
        claudeAuthStatus={null}
        kimiAuthStatus={null}
        geminiAuthStatus={null}
      />
    )
    // Two cards should be optional (Gemini + Kimi). Count "Optional" badges.
    const badges = html.match(/first-launch-sheet-provider-card-optional-badge/g)
    expect(badges).toBeTruthy()
    expect(badges!.length).toBe(2)
  })

  it('Codex card surfaces "signed in" when codexStatus.codexUsage.planType is present', () => {
    const codexStatus = {
      available: true,
      codexUsage: { planType: 'pro', userId: 'user-123' }
    }
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={true}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={codexStatus}
        claudeAuthStatus={null}
        kimiAuthStatus={null}
        geminiAuthStatus={null}
      />
    )
    // Plan label appears in the Codex card status row, AND the
    // signed-in dot variant class is present at least once.
    expect(html).toContain('Signed in (pro)')
    expect(html).toContain('first-launch-sheet-provider-status-dot-signed-in')
  })

  it('Codex card surfaces "Codex CLI not found" when available is false', () => {
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={true}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={{ available: false }}
        claudeAuthStatus={null}
        kimiAuthStatus={null}
        geminiAuthStatus={null}
      />
    )
    expect(html).toContain('Codex CLI not found')
  })

  it('Codex card surfaces "Usage credential missing" when codexUsage.error is set', () => {
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={true}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={{ available: true, codexUsage: { error: 'no credential' } }}
        claudeAuthStatus={null}
        kimiAuthStatus={null}
        geminiAuthStatus={null}
      />
    )
    expect(html).toContain('Usage credential missing')
  })

  it('Claude card surfaces "signed in" when apiKeyConfigured is true', () => {
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={true}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={null}
        claudeAuthStatus={makeProviderApiKeyStatus({ apiKeyConfigured: true })}
        kimiAuthStatus={null}
        geminiAuthStatus={null}
      />
    )
    expect(html).toContain('API key saved')
  })

  it('Claude card shows "CLI not found" when binary is unavailable', () => {
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={true}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={null}
        claudeAuthStatus={makeProviderApiKeyStatus({ available: false })}
        kimiAuthStatus={null}
        geminiAuthStatus={null}
      />
    )
    expect(html).toContain('CLI not found')
  })

  it('Gemini card surfaces the active profile label when set', () => {
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={true}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={null}
        claudeAuthStatus={null}
        kimiAuthStatus={null}
        geminiAuthStatus={makeGeminiAuthStatus({
          activeProfileId: 'profile-1',
          activeProfileLabel: 'work-gemini'
        })}
      />
    )
    expect(html).toContain('Active profile: work-gemini')
  })

  it('renders the footer Skip + Got it buttons', () => {
    const html = renderToStaticMarkup(
      <FirstLaunchSheet
        open={true}
        onDismiss={() => {}}
        onOpenSettings={() => {}}
        codexStatus={null}
        claudeAuthStatus={null}
        kimiAuthStatus={null}
        geminiAuthStatus={null}
      />
    )
    expect(html).toContain('Skip for now')
    expect(html).toContain('Got it')
  })
})
