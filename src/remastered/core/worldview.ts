// GameState -> WorldView. Uses the world agent's mapping (src/world/fromGame.ts) when present,
// else this local mapping, which follows the same contract (src/world/api.ts).
import type { GameState } from '../../sim/index.ts';
import type { CropKind, FieldSquareView, WorldView, WeatherKind } from '../../world/api.ts';
import { seasonName } from './format.ts';
import { squares } from './simapi.ts';

type FromGame = (s: GameState, opts?: unknown) => WorldView;
let external: FromGame | null = null;
const mods = import.meta.glob('../../world/fromGame.ts');
export async function loadWorldViewMapper() {
  const m = Object.values(mods)[0];
  if (!m) return;
  try {
    const mod = (await m()) as Record<string, unknown>;
    const fn = (mod.worldViewFromGame ?? mod.default) as FromGame | undefined;
    if (typeof fn === 'function') external = fn;
  } catch (e) {
    console.warn('world/fromGame.ts failed to load', e);
  }
}

const CROP: CropKind[] = [null, 'winterWheat', 'wheat', 'oats', 'corn'];

export function worldViewOf(s: GameState, hour = 10): WorldView {
  if (external) {
    try {
      const v = external(s);
      return { ...v, hour: v.hour ?? hour };
    } catch (e) {
      console.warn('worldViewFromGame failed; using local mapping', e);
      external = null;
    }
  }
  const p = s.propet;
  const g = s.globals;
  const mon = s.date.mon;
  const season = seasonName(mon);
  const mv = g.mainView;
  const weather: WeatherKind = season === 'winter' ? (mon === 1 || mon === 2 ? 'snow' : 'overcast') : mv === 7 ? 'clear' : mon === 4 ? 'overcast' : 'clear';
  const field: FieldSquareView[] = squares(s)
    .filter((q) => q.owned)
    .map((q) => ({
      stage: q.stage === 'eaten' || q.stage === 'trampled' ? 'stubble' : q.stage === 'frost' ? 'stubble' : q.stage,
      crop: q.crop ? CROP[q.crop] : null,
      growth: q.growth,
    }));
  const businesses = p.business.map((b) => b > 0);
  return {
    year: s.date.year,
    month: mon,
    hour,
    season,
    weather,
    wind: season === 'winter' ? 0.6 : 0.3,
    snowCover: mon === 1 || mon === 2 ? 0.9 : mon === 12 ? 0.5 : mon === 3 ? 0.2 : 0,
    field,
    house: p.house <= 0 ? 'wagon' : g.whatHouse >= 3 ? 'frame' : g.whatHouse === 2 ? 'sodFurnished' : 'sod',
    barn: p.barn === 1,
    windmill: p.windmill === 1,
    fence: p.fence === 0 ? 0 : p.fence >= 3 ? 2 : 1,
    stove: p.stove > 0,
    animals: { cows: p.cows, horses: p.horses, pigs: p.pigs, chickens: 6 },
    family: 2 + p.babyNames.filter((n) => n && n !== 'a').length,
    townGrowth: Math.max(0, Math.min(1, (s.date.year - 1880) / 38)),
    ownedBusinesses: businesses,
    extras: [],
  };
}
