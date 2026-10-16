// Persisted audio settings (per device). Separate key from the old build's gowest.settings.v1.
import type { AudioSettings } from './types.ts';

const KEY = 'gowest.audio.v1';

export const DEFAULT_SETTINGS: AudioSettings = {
  master: 0.9,
  music: 0.6,
  ambience: 0.7,
  sfx: 0.6,
  voice: 1.0,
  muted: false,
  reducedAudio: false,
  captions: true,
};

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* private mode, blocked storage */
  }
  // First run: honour the OS "reduce motion" preference as a hint for reduced audio.
  return { ...DEFAULT_SETTINGS, reducedAudio: prefersReducedMotion() };
}

export function saveSettings(s: AudioSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
