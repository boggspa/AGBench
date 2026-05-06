import { useState, useEffect, useCallback } from 'react';
import type {
  AppSettings,
  AppearanceMode,
  PromptSurfaceStyle,
  ThemeAccentStyle,
  ThemeAppearance,
  ThemeCornerStyle,
  VisualEffectStyle
} from '../../../main/store/types';

export interface AppearanceState {
  mode: AppearanceMode;
  visualEffectStyle: VisualEffectStyle;
  themeAppearance: ThemeAppearance;
  themeCornerStyle: ThemeCornerStyle;
  themeAccentStyle: ThemeAccentStyle;
  promptSurfaceStyle: PromptSurfaceStyle;
  reduceTransparency: boolean;
  reduceMotion: boolean;
  compactDensity: boolean;
  showInspector: boolean;
  inspectorWidth: number;
  sidebarWidth: number;
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
    reduceTransparency,
    reduceMotion,
    compactDensity: false,
    showInspector: true,
    inspectorWidth: 380,
    sidebarWidth: 260,
  };
}

export function useAppearance() {
  const [state, setState] = useState<AppearanceState>(getInitialState);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    window.api.getSettings().then((settings: AppSettings) => {
      setState({
        mode: settings.appearanceMode || 'soft_glass',
        visualEffectStyle: settings.visualEffectStyle || 'auto',
        themeAppearance: settings.themeAppearance || 'system',
        themeCornerStyle: settings.themeCornerStyle || 'rounded',
        themeAccentStyle: settings.themeAccentStyle || 'system',
        promptSurfaceStyle: settings.promptSurfaceStyle || 'liquid_glass',
        reduceTransparency: settings.reduceTransparency || getInitialState().reduceTransparency,
        reduceMotion: settings.reduceMotion || getInitialState().reduceMotion,
        compactDensity: settings.compactDensity || false,
        showInspector: settings.showInspector !== false,
        inspectorWidth: settings.inspectorWidth || 380,
        sidebarWidth: settings.sidebarWidth || 260,
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
    root.setAttribute('data-reduce-transparency', String(next.reduceTransparency));
    root.setAttribute('data-reduce-motion', String(next.reduceMotion));
    root.setAttribute('data-compact', String(next.compactDensity));
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
      const next = { ...prev, ...partial };
      // Persist to store
      window.api.updateSettings({
        appearanceMode: next.mode,
        visualEffectStyle: next.visualEffectStyle,
        themeAppearance: next.themeAppearance,
        themeCornerStyle: next.themeCornerStyle,
        themeAccentStyle: next.themeAccentStyle,
        promptSurfaceStyle: next.promptSurfaceStyle,
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
      setState(prev => ({
        ...prev,
        reduceMotion: prev.reduceMotion || motionQuery?.matches || false,
        reduceTransparency: prev.reduceTransparency || transparencyQuery?.matches || false,
      }));
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
