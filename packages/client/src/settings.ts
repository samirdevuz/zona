import { GRAPHICS, type GraphicsPresetId } from '@zona/shared';
import type { Lang } from './i18n';
import type { CameraMode } from './render/rigs';

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
  /** Recorded CC0 sound effects (false = synthesized placeholders). */
  realSounds: boolean;
  preset: GraphicsPresetId;
  renderScale: number;
  lang: Lang;
  /** Camera mode (GAME.md 8.2). */
  camera: CameraMode;
  /** Key overrides: action -> KeyboardEvent.code (GAME.md 8.1 rebinding). */
  keys: Record<string, string>;
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
  realSounds: true,
  preset: GRAPHICS.defaultPreset,
  renderScale: 1,
  lang: 'uz',
  camera: 'first',
  keys: {},
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
export function sessionDel(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}
export function sessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
