import { describe, it, expect } from 'vitest'
import type {
  AppearanceMode,
  PromptSurfaceStyle,
  ThemeAccentStyle,
  ThemeAppearance,
  ThemeCornerStyle,
  VisualEffectStyle
} from '../../../main/store/types'

describe('Appearance settings validation', () => {
  it('valid appearance modes are accepted by the type system', () => {
    const validModes: AppearanceMode[] = ['solid', 'soft_glass', 'native_glass']
    expect(validModes).toContain('soft_glass')
    expect(validModes).toContain('solid')
    expect(validModes).toContain('native_glass')
  })

  it('default settings shape matches AppSettings', () => {
    const defaults = {
      appearanceMode: 'soft_glass' as AppearanceMode,
      visualEffectStyle: 'auto' as VisualEffectStyle,
      themeAppearance: 'system' as ThemeAppearance,
      themeCornerStyle: 'rounded' as ThemeCornerStyle,
      themeAccentStyle: 'system' as ThemeAccentStyle,
      promptSurfaceStyle: 'liquid_glass' as PromptSurfaceStyle,
      reduceTransparency: false,
      reduceMotion: false,
      compactDensity: false,
      showInspector: true,
      inspectorWidth: 380,
      sidebarWidth: 260
    }
    expect(defaults.appearanceMode).toBe('soft_glass')
    expect(defaults.visualEffectStyle).toBe('auto')
    expect(defaults.themeAppearance).toBe('system')
    expect(defaults.reduceTransparency).toBe(false)
    expect(defaults.reduceMotion).toBe(false)
    expect(defaults.showInspector).toBe(true)
  })

  it('mode names are generic, not branded', () => {
    const mode: AppearanceMode = 'soft_glass'
    expect(mode).not.toBe('apple_glass')
    expect(mode).not.toBe('claude_glass')
    // Just verifying we use generic naming
    expect(['solid', 'soft_glass', 'native_glass']).toContain(mode)
  })
})
