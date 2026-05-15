import { useState, useEffect, useCallback } from 'react';
import type {
  AppSettings,
  AppearanceMode,
  ComposerStyle,
  PromptSurfaceStyle,
  ThemeAccentStyle,
  ThemeAppearance,
  ThemeCornerStyle,
  VisualEffectStyle
} from '../../../main/store/types';
import {
  COMPOSER_FONT_MATCH_TRANSCRIPT,
  FONT_STACKS,
  normalizeComposerFontFamily,
  normalizeFontFamily,
  resolveComposerFontFamily
} from '../lib/typefaceOptions';

const DEFAULT_ADVANCED_FX: AppSettings['advancedFx'] = {
  agentAura: true,
  livingWorkspace: true,
  dataViz: true,
  intensity: 'cinematic'
};

export interface AppearanceState {
  mode: AppearanceMode;
  visualEffectStyle: VisualEffectStyle;
  themeAppearance: ThemeAppearance;
  themeCornerStyle: ThemeCornerStyle;
  themeAccentStyle: ThemeAccentStyle;
  promptSurfaceStyle: PromptSurfaceStyle;
  composerStyle: ComposerStyle;
  transcriptFontFamily: string;
  composerFontFamily: string;
  funFxEnabled: boolean;
  funFxMode: AppSettings['funFxMode'];
  advancedFx: AppSettings['advancedFx'];
  reduceTransparency: boolean;
  reduceMotion: boolean;
  compactDensity: boolean;
  showInspector: boolean;
  inspectorWidth: number;
  sidebarWidth: number;
}

const DEFAULT_INSPECTOR_WIDTH = 380;
const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_INSPECTOR_WIDTH = 300;
const MAX_INSPECTOR_WIDTH = 720;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 440;

const clampNumber = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

const normalizeAppearanceDimension = (
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number => {
  const parsed = typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string'
      ? Number(value)
      : fallback
  return Number.isFinite(parsed) ? clampNumber(parsed, min, max) : fallback;
}

function getInitialState(): AppearanceState {
  const reduceMotion = typeof window !== 'undefined'
    ? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
    : false;
  const reduceTransparency = typeof window !== 'undefined'
    ? window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches || false
    : false;

  return {
    mode: 'soft_glass',
    visualEffectStyle: 'auto',
    themeAppearance: 'system',
    themeCornerStyle: 'rounded',
    themeAccentStyle: 'system',
    promptSurfaceStyle: 'liquid_glass',
    composerStyle: 'default',
    transcriptFontFamily: FONT_STACKS.agbench,
    composerFontFamily: COMPOSER_FONT_MATCH_TRANSCRIPT,
    funFxEnabled: true,
    funFxMode: 'cinematic',
    advancedFx: DEFAULT_ADVANCED_FX,
    reduceTransparency,
    reduceMotion,
    compactDensity: false,
    showInspector: true,
    inspectorWidth: DEFAULT_INSPECTOR_WIDTH,
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  };
}

function isFunFxMode(value: unknown): value is AppSettings['funFxMode'] {
  return (
    value === 'off' ||
    value === 'subtle' ||
    value === 'cinematic' ||
    value === 'epic'
  )
}

function normalizeAdvancedFx(
  value: Partial<AppSettings['advancedFx']> | undefined,
  fallbackIntensity: AppSettings['advancedFx']['intensity'] = DEFAULT_ADVANCED_FX.intensity
): AppSettings['advancedFx'] {
  const intensity =
    value?.intensity === 'subtle' || value?.intensity === 'cinematic' || value?.intensity === 'epic'
      ? value.intensity
      : fallbackIntensity;

  return {
    agentAura: value?.agentAura ?? DEFAULT_ADVANCED_FX.agentAura,
    livingWorkspace: value?.livingWorkspace ?? DEFAULT_ADVANCED_FX.livingWorkspace,
    dataViz: value?.dataViz ?? DEFAULT_ADVANCED_FX.dataViz,
    intensity
  };
}

export function useAppearance() {
  const [state, setState] = useState<AppearanceState>(getInitialState);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    window.api.getSettings().then((settings: AppSettings) => {
      const funFxMode = isFunFxMode(settings.funFxMode) ? settings.funFxMode : getInitialState().funFxMode;
      setState({
        mode: settings.appearanceMode || 'soft_glass',
        visualEffectStyle: settings.visualEffectStyle || 'auto',
        themeAppearance: settings.themeAppearance || 'system',
        themeCornerStyle: settings.themeCornerStyle || 'rounded',
        themeAccentStyle: settings.themeAccentStyle || 'system',
        promptSurfaceStyle: settings.promptSurfaceStyle || 'liquid_glass',
        composerStyle: settings.composerStyle || 'default',
        transcriptFontFamily: normalizeFontFamily(settings.transcriptFontFamily, FONT_STACKS.agbench),
        composerFontFamily: normalizeComposerFontFamily(settings.composerFontFamily),
        funFxEnabled: typeof settings.funFxEnabled === 'boolean' ? settings.funFxEnabled : getInitialState().funFxEnabled,
        funFxMode,
        advancedFx: normalizeAdvancedFx(
          settings.advancedFx,
          funFxMode === 'off' ? DEFAULT_ADVANCED_FX.intensity : funFxMode
        ),
        reduceTransparency: settings.reduceTransparency || getInitialState().reduceTransparency,
        reduceMotion: settings.reduceMotion || getInitialState().reduceMotion,
        compactDensity: settings.compactDensity || false,
        showInspector: settings.showInspector !== false,
        inspectorWidth: normalizeAppearanceDimension(
          settings.inspectorWidth,
          DEFAULT_INSPECTOR_WIDTH,
          MIN_INSPECTOR_WIDTH,
          MAX_INSPECTOR_WIDTH
        ),
        sidebarWidth: normalizeAppearanceDimension(
          settings.sidebarWidth,
          DEFAULT_SIDEBAR_WIDTH,
          MIN_SIDEBAR_WIDTH,
          MAX_SIDEBAR_WIDTH
        ),
      });
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const applyToDocument = useCallback((next: AppearanceState) => {
    const root = document.documentElement;
    root.setAttribute('data-appearance', next.mode);
    root.setAttribute('data-visual-effect', next.visualEffectStyle);
    root.setAttribute('data-theme', next.themeAppearance);
    root.setAttribute('data-corners', next.themeCornerStyle);
    root.setAttribute('data-accent', next.themeAccentStyle);
    root.setAttribute('data-prompt-surface', next.promptSurfaceStyle);
    root.setAttribute('data-composer-style', next.composerStyle);
    root.setAttribute('data-interface-style', next.composerStyle);
    root.setAttribute('data-reduce-transparency', String(next.reduceTransparency));
    root.setAttribute('data-reduce-motion', String(next.reduceMotion));
    root.setAttribute('data-fx-enabled', String(next.funFxEnabled));
    root.setAttribute('data-fx-mode', next.funFxMode);
    root.setAttribute('data-advanced-fx-agent-aura', String(next.funFxEnabled && !next.reduceMotion && next.advancedFx.agentAura));
    root.setAttribute('data-advanced-fx-living-workspace', String(next.funFxEnabled && !next.reduceMotion && next.advancedFx.livingWorkspace));
    root.setAttribute('data-advanced-fx-data-viz', String(next.funFxEnabled && !next.reduceMotion && next.advancedFx.dataViz));
    root.setAttribute('data-advanced-fx-intensity', next.advancedFx.intensity);
    root.setAttribute('data-compact', String(next.compactDensity));
    const transcriptFontFamily = normalizeFontFamily(next.transcriptFontFamily, FONT_STACKS.agbench);
    const composerFontFamily = resolveComposerFontFamily(next.composerFontFamily, transcriptFontFamily);
    root.style.setProperty('--transcript-font-family', transcriptFontFamily);
    root.style.setProperty('--composer-font-family', composerFontFamily);
    root.style.setProperty('--inspector-width', `${next.inspectorWidth}px`);
    root.style.setProperty('--sidebar-width', `${next.sidebarWidth}px`);
  }, []);

  useEffect(() => {
    if (loaded) {
      applyToDocument(state);
    }
  }, [state, loaded, applyToDocument]);

  const update = useCallback((partial: Partial<AppearanceState>) => {
    setState(prev => {
      const next = {
        ...prev,
        ...partial,
        advancedFx: partial.advancedFx
          ? normalizeAdvancedFx(partial.advancedFx, prev.advancedFx.intensity)
          : prev.advancedFx
      };
      next.inspectorWidth = normalizeAppearanceDimension(next.inspectorWidth, DEFAULT_INSPECTOR_WIDTH, MIN_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH)
      next.sidebarWidth = normalizeAppearanceDimension(next.sidebarWidth, DEFAULT_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH)
      // Persist to store
      window.api.updateSettings({
        appearanceMode: next.mode,
        visualEffectStyle: next.visualEffectStyle,
        themeAppearance: next.themeAppearance,
        themeCornerStyle: next.themeCornerStyle,
        themeAccentStyle: next.themeAccentStyle,
        promptSurfaceStyle: next.promptSurfaceStyle,
        composerStyle: next.composerStyle,
        transcriptFontFamily: next.transcriptFontFamily,
        composerFontFamily: next.composerFontFamily,
        funFxEnabled: next.funFxEnabled,
        funFxMode: next.funFxMode,
        advancedFx: next.advancedFx,
        reduceTransparency: next.reduceTransparency,
        reduceMotion: next.reduceMotion,
        compactDensity: next.compactDensity,
        showInspector: next.showInspector,
        inspectorWidth: next.inspectorWidth,
        sidebarWidth: next.sidebarWidth,
      }).catch(() => {});
      // Notify main process for native vibrancy / reduced transparency
      if (partial.mode !== undefined || partial.reduceTransparency !== undefined) {
        window.api.setAppearanceMode({
          mode: next.mode,
          reduceTransparency: next.reduceTransparency,
        }).catch(() => {})
      }
      applyToDocument(next);
      return next;
    });
  }, [applyToDocument]);

  useEffect(() => {
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const transparencyQuery = window.matchMedia?.('(prefers-reduced-transparency: reduce)');
    if (!motionQuery && !transparencyQuery) {
      return;
    }

    const handlePreferenceChange = () => {
      setState(prev => {
        const nextReduceMotion = prev.reduceMotion || motionQuery?.matches || false;
        const nextReduceTransparency = prev.reduceTransparency || transparencyQuery?.matches || false;
        // Skip the state update entirely when neither resolved value changes —
        // otherwise we return a fresh object reference, which fires the
        // applyToDocument effect and rewrites ~17 attributes on
        // documentElement, restarting any infinite CSS animations gated by
        // those attributes. macOS fires these matchMedia events on focus,
        // Mission Control, OS theme auto-switches, low-power-mode, etc.,
        // which the user perceived as "flicker out of nowhere".
        if (
          nextReduceMotion === prev.reduceMotion &&
          nextReduceTransparency === prev.reduceTransparency
        ) {
          return prev;
        }
        return {
          ...prev,
          reduceMotion: nextReduceMotion,
          reduceTransparency: nextReduceTransparency,
        };
      });
    };

    motionQuery?.addEventListener?.('change', handlePreferenceChange);
    transparencyQuery?.addEventListener?.('change', handlePreferenceChange);
    return () => {
      motionQuery?.removeEventListener?.('change', handlePreferenceChange);
      transparencyQuery?.removeEventListener?.('change', handlePreferenceChange);
    };
  }, []);

  return { ...state, update, loaded };
}
