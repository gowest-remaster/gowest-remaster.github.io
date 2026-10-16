// Main Street (TSTREET1): grain selling (local elevator / O'Grady), buying businesses and
// the 1909 homestead claim. docs/spec/03-town.md §1.
import { addScore, changeCash, dialog, emit, fillLogBook, monthRolls, quirk, rand, reject, visitRand, type Ctx } from './ctx.ts';
import { BUSINESSES, CLAIM, DEALERS, GRAIN_PRICE_MAX, GRAIN_PRICE_MIN } from './data/tables.ts';
import type { GameState, TownSession } from './state.ts';

/** Street init (ScoreScript 2): number of grain dealers this visit. */
export function enterTown(ctx: Ctx): TownSession {
  const y = ctx.s.date.year;
  const cache = monthRolls(ctx);
  const roll = () => (y === 1886 || (y > 1886 && visitRand(ctx, 4) < 3) ? 2 : 1);
  const dealers = cache ? (cache.town ??= { dealers: roll() }).dealers : roll();
  const sess = { dealers };
  ctx.s.sessions.town = sess;
  return sess;
}

export interface GrainQuote {
  /** adjusted price per bushel per crop */
  prices: [number, number, number, number];
  bushels: [number, number, number, number];
  localTotal: number;
  ogradyTotal: number;
  /** cents per bushel and haul fee shown by the O'Grady hauler */
  bonusCents: number;
  haul: number;
}

/** `DelSetup` (TSTREET1 MovieScript 12): local and O'Grady totals. Pure. */
export function grainQuote(s: GameState): GrainQuote {
  const row = DEALERS.find((d) => s.date.year >= d.y0 && s.date.year <= d.y1);
  const idx = row?.idx ?? 0;
  const bushels = [...s.cursit.bushels] as GrainQuote['bushels'];
  const prices = s.cursit.prices.map((p0) => {
    let p = p0;
    if (p >= 0.4) p = p + (idx * p) / 100;
    return Math.min(GRAIN_PRICE_MAX, Math.max(GRAIN_PRICE_MIN, p));
  }) as GrainQuote['prices'];
  const plus = s.random.elevatorBonus;
  const haul = s.random.transport;
  const localTotal = bushels.reduce((a, b, i) => a + b * prices[i], 0);
  const ogradyTotal = bushels.reduce((a, b, i) => a + (prices[i] + plus / 100) * b, 0) - haul;
  return { prices, bushels, localTotal, ogradyTotal, bonusCents: plus, haul };
}

export function hasCropsToSell(ctx: Ctx): boolean {
  const c = ctx.s.cursit;
  if (quirk(ctx, 'Q12')) return c.harvestValue > 0;
  return c.harvestValue > 0 || c.bushels.some((b) => b > 0);
}

/** Click the elevator (dealer 'local') or the O'Grady hauler, then OK (ScoreScripts 10/14/18). */
export function sellGrain(ctx: Ctx, dealer: 'local' | 'ogrady') {
  const s = ctx.s;
  const c = s.cursit;
  const sess = s.sessions.town ?? enterTown(ctx);
  if (dealer === 'ogrady' && sess.dealers < 2) return reject(ctx, 'noOgradyToday');
  const { year, mon } = s.date;
  if (year === 1894 && (mon === 6 || mon === 7)) {
    if (quirk(ctx, 'T1')) c.bushels = [0, 0, 0, 0];
    return dialog(ctx, 'No1894', 'Deal2');
  }
  if (!hasCropsToSell(ctx)) {
    if (quirk(ctx, 'T2')) c.bushels = [0, 0, 0, 0];
    return dialog(ctx, 'NoSale', 'DBox0');
  }
  const q = grainQuote(s);
  c.harvestValue = 0;
  c.harvestBushels = 0;
  c.bushels = [0, 0, 0, 0];
  const sold = q.bushels.reduce((a, b) => a + b, 0);
  s.extra.monthTally.soldBushels += sold;
  if (dealer === 'local') {
    s.extra.monthTally.grainIncome += q.localTotal;
    changeCash(ctx, q.localTotal, 'grainSale');
    fillLogBook(ctx, quirk(ctx, 'LOGLOC') ? 7 : 6, 6, 0, q.localTotal);
    return;
  }
  let total = q.ogradyTotal;
  if (!quirk(ctx, 'OGNEG')) total = Math.max(0, total);
  if (rand(ctx, 10) < 5) {
    const loss = rand(ctx, 30) + 20;
    const net = total - (total * loss) / 100;
    c.telegram = { year, month: mon, net, pending: 1 };
    s.myRecieve += net;
    s.extra.monthTally.grainIncome += net;
  } else {
    s.myRecieve += total;
    s.extra.monthTally.grainIncome += total;
  }
  fillLogBook(ctx, quirk(ctx, 'LOGLOC') ? 8 : 6, 6, 0, 0);
}

/** Which business (1..4) is for sale now, or 0 (`g_Sprite` window, ScoreScript 2). */
export function businessForSale(s: GameState): number {
  const { year, mon } = s.date;
  for (let k = 0; k < BUSINESSES.length; k++) {
    const y0 = BUSINESSES[k].startYear;
    if (((year === y0 && mon > 3) || (year === y0 + 1 && mon < 4)) && s.propet.business[k] === 0) return k + 1;
  }
  return 0;
}

/** For-Sale sign OK (ScoreScript 9). Cash only. */
export function buyBusiness(ctx: Ctx, k: number) {
  const s = ctx.s;
  if (businessForSale(s) !== k) return reject(ctx, 'notForSale');
  const b = BUSINESSES[k - 1];
  if (s.propet.cash < b.price) return dialog(ctx, 'NoM', 'DBox0');
  addScore(ctx, b.score, `business${k}`);
  changeCash(ctx, -b.price, 'business');
  s.propet.business[k - 1] = quirk(ctx, 'T7') ? b.income : b.adIncome;
  emit(ctx, { type: 'built', item: `business${k}` });
}

/** "LAND FOR FREE" sign visible: Apr 1909..Mar 1910 while one claim. */
export function claimAvailable(s: GameState): boolean {
  const { year, mon } = s.date;
  return ((year === CLAIM.year && mon > 3) || (year === CLAIM.year + 1 && mon < 4)) && s.propet.numFields === 1;
}

export function buyClaim(ctx: Ctx) {
  const s = ctx.s;
  if (!claimAvailable(s)) return reject(ctx, 'claimNotAvailable');
  if (s.propet.cash < CLAIM.price) return dialog(ctx, 'NoM', 'DBox0');
  changeCash(ctx, -CLAIM.price, 'claim');
  addScore(ctx, CLAIM.score, 'claim');
  s.propet.numFields = 2;
}
