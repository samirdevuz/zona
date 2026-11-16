import { GRAPHICS, type GraphicsPresetId } from '@zona/shared';
import type { Lang } from './i18n';

/** Player settings (GAME.md 8.1), persisted per browser. */
export interface Settings {
  name: string;
  /** Multiplier on the base mouse sensitivity. */
  sensitivity: number;
  adsSensMult: number;
  invertY: boolean;
  fov: number;
  volume: number;
  sfxVolume: number;
  preset: GraphicsPresetId;
  renderScale: number;
  lang: Lang;
}

/** Radians of view rotation per pixel of mouse movement at sensitivity 1. */
export const BASE_SENSITIVITY = 0.0022;

const KEY = 'zona.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  sensitivity: 1,
  adsSensMult: 0.75,
  invertY: false,
  fov: GRAPHICS.fovDefault,
  volume: 0.8,
  sfxVolume: 1,
  preset: GRAPHICS.defaultPreset,
  renderScale: 1,
  lang: 'uz',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Storage may be unavailable (private mode); defaults are fine.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function sessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
