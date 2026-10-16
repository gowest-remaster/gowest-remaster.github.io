// Pure mapping GameState (src/sim) -> WorldView (src/world/api.ts). No three.js, no side effects.
import type { GameState } from '../sim/state';
import type { CropKind, FieldSquareView, Season, WeatherKind, WorldView } from './api';

/** Sim crop codes: 1 winter wheat, 2 spring wheat, 3 oats, 4 corn. */
const CROP: Record<number, CropKind> = { 1: 'winterWheat', 2: 'wheat', 3: 'oats', 4: 'corn' };

export function seasonOfMonth(mon: number): Season {
  if (mon >= 3 && mon <= 5) return 'spring';
  if (mon >= 6 && mon <= 8) return 'summer';
  if (mon >= 9 && mon <= 11) return 'autumn';
  return 'winter';
}

/** Deterministic 0..1 per (year, month) so weather variety is stable across reloads. */
function monthHash(year: number, mon: number): number {
  let h = (year * 31 + mon * 7919) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Weather + snow from the season scene id (`globals.mainView`: 1 snow, 2 winter, 3 early spring, 5 late
 * spring, 6 summer, 7 drought, 8 autumn, 9 fire, 10 tornado, 11 grasshoppers, 12 cattle).
 */
export function weatherOf(s: GameState): { weather: WeatherKind; snowCover: number; wind: number; drought: number } {
  const { year, mon } = s.date;
  const mv = s.globals.mainView;
  const r = monthHash(year, mon);
  if (mv === 1) return { weather: 'snow', snowCover: 0.95, wind: 0.5, drought: 0 };
  if (mv === 2) return { weather: r < 0.5 ? 'overcast' : 'clear', snowCover: 0.75, wind: 0.35, drought: 0 };
  if (mv === 7) return { weather: 'clear', snowCover: 0, wind: 0.55, drought: 1 };
  if (mv === 10) return { weather: 'storm', snowCover: 0, wind: 0.9, drought: 0 };
  if (mv === 3) return { weather: r < 0.3 ? 'rain' : r < 0.55 ? 'overcast' : 'clear', snowCover: mon === 3 && r > 0.85 ? 0.3 : 0, wind: 0.55, drought: 0 };
  if (mv === 8 || mv === 9) return { weather: r < 0.25 ? 'overcast' : r < 0.35 ? 'rain' : 'clear', snowCover: 0, wind: 0.5, drought: 0 };
  // late spring / summer
  return { weather: r < 0.12 ? 'storm' : r < 0.22 ? 'rain' : 'clear', snowCover: 0, wind: 0.4, drought: 0 };
}

/** Visual stage of one square from the sim's plow / plant / harv codes. */
export function squareView(s: GameState, i: number): FieldSquareView {
  const c = s.cursit;
  const mon = s.date.mon;
  const plow = c.plow[i] ?? 0;
  const plant = c.plant[i] ?? 0;
  const harv = c.harv[i] ?? 0;
  if (harv === 13) return { stage: 'burnt', crop: CROP[plant] ?? null, growth: 1 };
  if (harv === 12 || harv === 14 || harv === 15) return { stage: 'stubble', crop: CROP[plant] ?? null, growth: harv === 14 ? 0.2 : 0.6 };
  if (harv >= 1 && harv <= 4) {
    const crop = CROP[harv];
    if (harv === 1) {
      // winter wheat is "mature" in the sim from November; visually it overwinters as green shoots
      if (mon >= 11 || mon <= 2) return { stage: 'sprout', crop, growth: 0.8 };
      if (mon <= 4) return { stage: 'growing', crop, growth: mon === 3 ? 0.4 : 0.8 };
      return { stage: 'ripe', crop, growth: 1 };
    }
    const g = mon <= 6 ? 0.35 : mon === 7 ? 0.7 : 1;
    return { stage: 'ripe', crop, growth: g };
  }
  if (plant >= 1 && plant <= 4) {
    const crop = CROP[plant];
    if (plant === 1) {
      // sown Aug..Oct
      if (mon === 8 || mon === 9) return { stage: 'planted', crop, growth: 0 };
      return { stage: 'sprout', crop, growth: mon === 10 ? 0.3 : 0.7 };
    }
    // spring crops sown Apr..Jun, mature from June/July
    if (mon <= 4) return { stage: 'planted', crop, growth: 0 };
    if (mon === 5) return { stage: 'sprout', crop, growth: 0.6 };
    return { stage: 'growing', crop, growth: mon === 6 ? 0.6 : 0.9 };
  }
  if (plow === 1 || plow === 15) return { stage: 'plowed', crop: null, growth: 0 };
  // untouched: virgin prairie until the first harvest, fallow stubble afterwards
  return { stage: c.firstHarv ? 'stubble' : 'prairie', crop: null, growth: 0 };
}

export function worldViewFromGame(s: GameState): WorldView {
  const p = s.propet;
  const g = s.globals;
  const { year, mon } = s.date;
  const w = weatherOf(s);
  const n = 8 * Math.max(1, Math.min(2, p.numFields));
  const field = Array.from({ length: n }, (_, i) => squareView(s, i));
  const house: WorldView['house'] = p.house > 0 ? (g.whatHouse === 3 ? 'frame' : g.whatHouse === 2 ? 'sodFurnished' : 'sod') : 'wagon';
  const children = p.babyNames.filter((x) => x && x.trim() !== '' && x !== '0').length;
  const dc = s.devcut as (GameState['devcut'] & { gramophone?: boolean }) | undefined;
  const extras: string[] = [];
  if (dc?.enabled) extras.push('freightOffice');
  if (dc?.woodenFence) extras.push('woodenFence');
  if (dc?.gramophone) extras.push('gramophone');
  return {
    year,
    month: mon,
    hour: 9.5,
    season: seasonOfMonth(mon),
    weather: w.weather,
    wind: w.wind,
    snowCover: w.snowCover,
    drought: w.drought,
    mail: (s.globals.mail ?? 0) > 0,
    field,
    house,
    barn: p.barn === 1,
    windmill: p.windmill === 1,
    fence: p.fence >= 3 ? 2 : p.fence >= 1 ? 1 : 0,
    stove: p.stove > 0,
    animals: { cows: p.cows, horses: p.horses, pigs: p.pigs, chickens: p.house > 0 ? 6 + Math.min(8, Math.floor((year - 1880) / 4)) : 0 },
    family: Math.min(6, 2 + children),
    townGrowth: Math.max(0, Math.min(1, (year - 1880) / 38)),
    ownedBusinesses: p.business.map((b) => b > 0),
    extras,
  };
}
