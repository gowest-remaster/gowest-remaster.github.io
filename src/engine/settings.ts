// Per-device settings (volumes, calendar speed). Game state never lives here; it is in IndexedDB.
export type CalendarSpeed = 'fast' | 'normal' | 'classic';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  ambience: number;
  musicOn: boolean;
  speed: CalendarSpeed;
  lastProfile: string | null;
  /** Developer's Cut unlocked before any profile existed; applied to the next profile. */
  pendingDevcut: boolean;
}

const KEY = 'gowest.settings.v1';
const DEFAULTS: Settings = { master: 0.9, music: 0.7, sfx: 0.8, ambience: 0.5, musicOn: true, speed: 'fast', lastProfile: null, pendingDevcut: false };

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* private mode etc. */
  }
  return { ...DEFAULTS };
}

export function settings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(current));
}

export function onSettings(fn: (s: Settings) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
