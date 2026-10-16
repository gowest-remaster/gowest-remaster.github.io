// Scene -> target mix. Pure and deterministic so it can be unit-tested and reasoned about.
//
// Music: one cue per context (see public/assets/audio/music/manifest.json). Ambience: a level per bed;
// the director ramps between mixes. Levels here are relative (0..1) and multiplied by each bed's
// manifest gainDb, so every layer stays subtle under the music.
import type { Mix, Place, Scene } from './types.ts';

const OUTDOOR: Place[] = ['homestead', 'field', 'town'];
const INDOOR: Place[] = ['house', 'store', 'bank', 'elevator'];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Smooth 0..1 window over the hour of day (wraps midnight). */
function hourWindow(h: number, start: number, peak: number, end: number): number {
  const hh = ((h % 24) + 24) % 24;
  const span = (a: number, b: number) => ((b - a + 24) % 24) || 24;
  const from = (x: number) => (x - start + 24) % 24;
  const x = from(hh);
  const up = span(start, peak);
  const total = span(start, end);
  if (x >= total) return 0;
  const t = x <= up ? x / up : 1 - (x - up) / (total - up);
  return clamp01(Math.sin((t * Math.PI) / 2));
}

export function isNight(hour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  return h >= 20 || h < 5;
}

/**
 * The music plan for a scene: an ordered rotation of cues. Each cue plays one full pass, then the
 * director moves to the next with a clean dip. The main theme (GANCOUA) in the two arrangements
 * the user loves, cozy v3 (`title`) and solo piano (`parlor`), is home for title, homestead, house and
 * field. Town, interiors and events keep their own cue. The seasonal cues and the guitar/daylight
 * arrangements stay in the manifest for the audition page but are not scheduled anywhere.
 */
export function musicPlan(s: Scene): string[] {
  switch (s.event) {
    case 'finale':
      return ['finale'];
    case 'goal':
      return ['goal'];
    case 'harvest':
      return ['harvest'];
    case 'new_year':
      return ['new_year'];
    case 'disaster':
      return ['disaster'];
    default:
      break;
  }
  const outdoor = OUTDOOR.includes(s.place);
  if (outdoor && s.place !== 'town' && s.tension >= 0.65) return ['disaster'];
  // The user's two loved arrangements of the main theme carry the places where most time is spent.
  const home = ['title', 'parlor'];
  switch (s.place) {
    case 'title':
    case 'menu':
      return ['title'];
    case 'album':
      return ['parlor', 'title'];
    case 'credits':
      return ['theme_full'];
    case 'homestead':
      return home;
    case 'field':
      return s.season === 'winter' ? home : ['title', 'parlor', 'field'];
    case 'house':
      return ['parlor', 'title'];
    case 'town':
      return ['town'];
    case 'store':
    case 'bank':
    case 'elevator':
      return ['interior'];
    case 'silent':
      return [];
  }
  return [];
}

/** First cue of the plan (what starts when you arrive). */
export function chooseMusic(s: Scene): string | null {
  return musicPlan(s)[0] ?? null;
}

/** Events that play their cue for one pass and then hand back to the place's music. */
export const ONCE_EVENTS = new Set(['harvest', 'new_year']);

export function computeMix(s: Scene, reduced = false): Mix {
  const beds: Record<string, number> = {};
  const set = (id: string, v: number) => {
    if (v > 0.01) beds[id] = Math.max(beds[id] ?? 0, clamp01(v));
  };
  const indoor = INDOOR.includes(s.place) ? 1 : 0;
  const wind = clamp01(s.wind);
  const wet = s.weather === 'rain' || s.weather === 'storm';
  const winter = s.season === 'winter';
  const night = isNight(s.hour);
  const morning = hourWindow(s.hour, 4.5, 7, 12);
  const evening = hourWindow(s.hour, 18.5, 22, 5);

  if (s.place === 'title' || s.place === 'menu' || s.place === 'credits' || s.place === 'album' || s.place === 'silent') {
    return { music: chooseMusic(s), playlist: musicPlan(s), beds, indoor: 0, thunder: false };
  }

  // Outdoor weather layer: heard everywhere (muffled indoors).
  if (winter || s.weather === 'snow') {
    set('snow_wind', 0.35 + 0.65 * wind);
    set('wind_light', 0.25 * (1 - wind));
  } else {
    set('wind_light', 0.25 + 0.75 * (1 - wind) * 0.8);
    set('wind_strong', Math.pow(wind, 1.4));
  }
  if (wet) set('rain', s.weather === 'storm' ? 1 : 0.75);

  if (s.place === 'homestead' || s.place === 'field') {
    if (!winter && !wet) set('grass_rustle', 0.25 + 0.6 * wind);
    if ((s.season === 'spring' || s.season === 'summer') && !wet) set('birds_morning', 0.25 + 0.75 * morning);
    if (s.season === 'autumn' && !wet) set('birds_morning', 0.35 * morning);
    if (!winter && night) set('crickets_night', s.season === 'autumn' ? 0.6 : 1);
    else if (!winter && evening > 0) set('crickets_night', 0.6 * evening);
    if (s.place === 'homestead') {
      set('windmill_creak', 0.15 + 0.85 * wind);
      if (!night && !wet) set('farm_animals', winter ? 0.25 : 0.6);
    }
  }
  if (s.place === 'town') {
    set('town_bustle', night ? 0.15 : 0.85);
  }
  if (s.place === 'house') {
    set('clock_tick', 0.8);
    if (winter || s.season === 'autumn' || night || evening > 0.3) set('hearth', winter ? 1 : 0.7);
    if (!winter && night) set('crickets_night', 0.6);
  }
  if (s.place === 'bank') set('clock_tick', 0.6);
  if (s.place === 'store' || s.place === 'bank') set('town_bustle', 0.35);
  if (s.place === 'elevator') {
    set('town_bustle', 0.2);
    set('windmill_creak', 0.15 + 0.4 * wind);
  }

  if (reduced) {
    // Calmer: keep only the steady beds, softer, and drop busy/eventful layers.
    for (const k of ['farm_animals', 'town_bustle', 'windmill_creak', 'birds_morning']) {
      if (beds[k] !== undefined) beds[k] *= 0.4;
    }
    for (const k of Object.keys(beds)) beds[k] *= 0.7;
  }
  return { music: chooseMusic(s), playlist: musicPlan(s), beds, indoor, thunder: s.weather === 'storm' && !reduced };
}
