// Remastered settings (per device, localStorage). Game state never lives here.
// Applies presentation classes/vars to <html> so CSS can react (text size, motion, fonts, palettes).
import type { Quality } from '../../world/api.ts';
import { isCompact } from '../ui/compact.ts';

export type Speed = 'stroll' | 'trot' | 'gallop' | 'instant';
export type ChipDetail = 'story' | 'clear' | 'detailed' | 'off';
export type AssistPreset = 'schoolhouse' | 'homesteader' | 'original' | 'custom';
export type Palette = 'standard' | 'protan' | 'deutan' | 'tritan' | 'contrast';
export type FontChoice = 'period' | 'plain' | 'dyslexia';

export interface Assists {
  preset: AssistPreset;
  chips: ChipDetail;
  todayCard: boolean;
  tips: boolean;
  /** calm-ui §5: Full = next step + glow + one-line first-visit hints; Light = next step + glow; Off */
  guidance: 'full' | 'light' | 'off';
  learning: boolean;
  autoPause: 'all' | 'deadlines' | 'off';
  undo: boolean;
  rewind: boolean;
  seasonReveal: boolean;
  ogradyOdds: boolean;
  labels: 'always' | 'hover';
}

export interface RmSettings {
  textScale: number; // 0.9 .. 1.6
  reducedMotion: 'auto' | 'on' | 'off';
  captions: boolean;
  soundCaptions: boolean;
  master: number;
  music: number;
  ambience: number;
  sfx: number;
  voice: number;
  /** 'performance' = low quality with the world's auto-quality governor switched off */
  quality: Quality | 'auto' | 'performance';
  palette: Palette;
  font: FontChoice;
  speed: Speed;
  assists: Assists;
  /** Studio (Developer's Cut) unlocked on this device. */
  studio: boolean;
  /** dismissed one-time tips */
  seenTips: string[];
  ribbonCollapsed: boolean;
}

export const ASSIST_PRESETS: Record<Exclude<AssistPreset, 'custom'>, Omit<Assists, 'preset'>> = {
  schoolhouse: { chips: 'story', todayCard: false, tips: true, guidance: 'full', learning: true, autoPause: 'all', undo: true, rewind: true, seasonReveal: false, ogradyOdds: false, labels: 'always' },
  homesteader: { chips: 'clear', todayCard: false, tips: true, guidance: 'light', learning: false, autoPause: 'deadlines', undo: true, rewind: true, seasonReveal: false, ogradyOdds: false, labels: 'hover' },
  original: { chips: 'off', todayCard: false, tips: false, guidance: 'off', learning: false, autoPause: 'off', undo: false, rewind: false, seasonReveal: false, ogradyOdds: false, labels: 'hover' },
};

const DEFAULTS: RmSettings = {
  textScale: 1,
  reducedMotion: 'auto',
  captions: true,
  soundCaptions: true,
  master: 0.9,
  music: 0.65,
  ambience: 0.5,
  sfx: 0.8,
  voice: 1,
  quality: 'auto',
  palette: 'standard',
  font: 'period',
  speed: 'trot',
  assists: { preset: 'homesteader', ...ASSIST_PRESETS.homesteader },
  studio: false,
  seenTips: [],
  ribbonCollapsed: false,
};

const KEY = 'gowest.remastered.settings.v1';
let current: RmSettings = load();
const listeners = new Set<(s: RmSettings) => void>();

function load(): RmSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { ...DEFAULTS, ...p, assists: { ...DEFAULTS.assists, ...(p.assists ?? {}) } };
    }
  } catch {
    /* private mode */
  }
  return structuredClone(DEFAULTS);
}

export function rm(): RmSettings {
  return current;
}

export function setRm(patch: Partial<RmSettings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  applyToDocument();
  listeners.forEach((l) => l(current));
}

export function setAssists(patch: Partial<Assists>) {
  const a = { ...current.assists, ...patch };
  if (!('preset' in patch)) a.preset = 'custom';
  setRm({ assists: a });
}

export function applyPreset(p: Exclude<AssistPreset, 'custom'>) {
  setRm({ assists: { preset: p, ...ASSIST_PRESETS[p] } });
}

export function onRm(fn: (s: RmSettings) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function reducedMotion(): boolean {
  if (current.reducedMotion === 'on') return true;
  if (current.reducedMotion === 'off') return false;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Seconds per month at each speed (presentation only). */
export const SPEED_SECONDS: Record<Speed, number> = { stroll: 1.5, trot: 0.6, gallop: 0.15, instant: 0 };
export const SPEED_LABEL: Record<Speed, string> = { stroll: 'Stroll', trot: 'Trot', gallop: 'Gallop', instant: 'Instant' };
export const SPEEDS: Speed[] = ['stroll', 'trot', 'gallop', 'instant'];

/** UI scale from the window size: bigger on QHD screens, slightly tighter on 720p. */
function viewportScale() {
  // phones in landscape (ui/compact.ts): a denser overlay, body text about 13.6 px
  if (isCompact()) return 0.85;
  const k = Math.min(window.innerWidth / 1440, window.innerHeight / 900);
  return Math.max(0.9, Math.min(1.35, k));
}
let vpListening = false;

/** Apply the Settings ▸ Graphics choice to the world: a cap for the governor, or the fixed Performance preset. */
export function applyQuality(world: { setQuality(q: Quality): void; setAutoQuality?(on: boolean): void } | null | undefined, q: RmSettings['quality'] = current.quality) {
  if (!world) return;
  if (q === 'performance') {
    world.setAutoQuality?.(false);
    world.setQuality('low');
    return;
  }
  world.setAutoQuality?.(true);
  world.setQuality(q === 'auto' ? 'ultra' : q);
}

export function applyToDocument() {
  const d = document.documentElement;
  d.style.setProperty('--vp-scale', viewportScale().toFixed(3));
  if (!vpListening && typeof window !== 'undefined') {
    vpListening = true;
    window.addEventListener('resize', () => d.style.setProperty('--vp-scale', viewportScale().toFixed(3)));
  }
  d.style.setProperty('--text-scale', String(current.textScale));
  d.classList.toggle('rm-reduced-motion', reducedMotion());
  d.dataset.palette = current.palette;
  d.dataset.font = current.font;
  d.dataset.labels = current.assists.labels;
}
