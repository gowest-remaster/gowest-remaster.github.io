// Construction (CALEND Con/Con1, ScoreScripts 64–75) and the livestock market
// (LVST/BuySell, MovieScript 76). docs/spec/02-farm-sim.md §6.12–§6.13.
import { changeCash, changeLifePrice, dialog, emit, fillLogBook, monthRolls, quirk, reject, visitRand, type Ctx } from './ctx.ts';
import { advanceDays, barnHouse, catchUpMonths, fenWMill } from './calendar.ts';
import { CONSTRUCTION_DAYS, CONSTRUCTION_WAGE, LIVESTOCK_PRICES } from './data/tables.ts';
import { lingoInt, type LivestockSession } from './state.ts';
import type { Helpers } from './field.ts';

export type BuildItem = keyof typeof CONSTRUCTION_DAYS;

/** Jobs currently on the to-build list (Propet line 17). */
export function buildableItems(s: Ctx['s']): BuildItem[] {
  const p = s.propet;
  const out: BuildItem[] = [];
  if (p.toBuildHouse > 0) out.push('house');
  if (p.toBuildBarn > 0) out.push('barn');
  if (p.toBuildWindmill > 0) out.push('windmill');
  if (p.toBuildFence === 1) out.push('woodFence');
  if (p.toBuildFence === 2) out.push('barbedFence');
  return out;
}

/** Days and cost of a construction job: days = base div team (min 1), cost = workers x $5. */
export function constructionEstimate(item: BuildItem, h: Helpers) {
  const days = Math.max(1, Math.trunc(CONSTRUCTION_DAYS[item] / (h.workers + h.neighbors + h.family + 1)));
  return { days, cost: h.workers * CONSTRUCTION_WAGE };
}

export function build(ctx: Ctx, item: BuildItem, h: Helpers) {
  const s = ctx.s;
  const p = s.propet;
  if (p.toBuildBarn + p.toBuildFence + p.toBuildWindmill + p.toBuildHouse <= 0) return dialog(ctx, 'NothToB');
  if (s.date.mon < 3 || s.date.mon > 10) return dialog(ctx, 'CantBuild');
  if (!buildableItems(s).includes(item)) return reject(ctx, 'notBuildable');
  const okHelpers = h.workers >= 0 && h.workers <= 5 && h.neighbors >= 0 && h.neighbors <= 3 && h.family >= 0 && h.family <= p.familyWorkers;
  if (!okHelpers) return reject(ctx, 'invalidHelpers');
  const { days, cost } = constructionEstimate(item, h);
  s.extra.lastConstructionCost = cost; // field "Cost" (read later by NHelp, Q23)
  if (cost > p.cash) return dialog(ctx, 'NoM', 'DBox0');
  const from = advanceDays(ctx, days, 'calend', 'build');
  if (cost > 0) changeCash(ctx, -cost, 'construction');
  switch (item) {
    case 'house':
      s.globals.houseStat = 1;
      p.house = 1;
      p.toBuildHouse = 0;
      break;
    case 'barn':
      p.barn = 1;
      p.toBuildBarn = 0;
      s.globals.barnStat = 1;
      break;
    case 'windmill':
      if (p.windmill !== 1) p.windmill = 1;
      else p.extraWindmills += 1;
      fenWMill(ctx);
      p.toBuildWindmill -= 1;
      break;
    case 'woodFence':
    case 'barbedFence':
      p.fence = item === 'woodFence' ? 1 : 3;
      p.toBuildFence = 0;
      fenWMill(ctx);
      break;
  }
  barnHouse(ctx);
  emit(ctx, { type: 'built', item });
  catchUpMonths(ctx, from);
}

// ---------------------------------------------------------------------------
// Livestock market
// ---------------------------------------------------------------------------

/** Pen sprite visible: April/May, not 1880, game running, barn = 1. */
export function livestockMarketOpen(s: Ctx['s']): boolean {
  return (s.date.mon === 4 || s.date.mon === 5) && s.date.year !== 1880 && s.globals.eog === 0 && s.propet.barn === 1;
}

/** Choosing "Buy" rolls the per-animal maximum and the +/-1..20% prices (BuySell). */
export function enterLivestockMarket(ctx: Ctx): LivestockSession | undefined {
  const s = ctx.s;
  if (!livestockMarketOpen(s)) {
    reject(ctx, 'marketClosed');
    return undefined;
  }
  const cache = monthRolls(ctx);
  if (cache?.livestock) {
    const sess = structuredClone(cache.livestock);
    s.sessions.livestock = sess;
    return sess;
  }
  const max: [number, number, number] = [visitRand(ctx, 7) + 3, visitRand(ctx, 7) + 3, visitRand(ctx, 7) + 3];
  const row = LIVESTOCK_PRICES.get(s.date.year)!;
  const roll = (base: number) => {
    const proc = (base * visitRand(ctx, 20)) / 100;
    return visitRand(ctx, 2) === 1 ? lingoInt(base + proc) : lingoInt(base - proc);
  };
  const cow = roll(row.cow);
  const pig = roll(row.pig);
  const horse = roll(row.horse);
  const sess: LivestockSession = { max, price: [horse, pig, cow] };
  s.sessions.livestock = sess;
  if (cache) cache.livestock = structuredClone(sess);
  return sess;
}

export interface Animals {
  horses: number;
  pigs: number;
  cows: number;
}

export function buyLivestock(ctx: Ctx, a: Animals) {
  const s = ctx.s;
  const p = s.propet;
  const sess = s.sessions.livestock ?? enterLivestockMarket(ctx);
  if (!sess) return;
  const n = [a.horses, a.pigs, a.cows];
  if (n.some((x, i) => !Number.isInteger(x) || x < 0 || x > sess.max[i])) return reject(ctx, 'invalidQuantity');
  const total = n.reduce((acc, x, i) => acc + x * sess.price[i], 0);
  if (total === 0) return reject(ctx, 'nothingSelected');
  if (total > p.cash) return dialog(ctx, 'NoBuy', 'DBox0');
  const hadCows = p.cows > 0;
  p.horses += a.horses;
  p.pigs += a.pigs;
  p.cows += a.cows;
  if (!hadCows && p.cows > 0) changeLifePrice(ctx, -10, 'ownCow');
  changeCash(ctx, -total, 'livestock');
  fillLogBook(ctx, quirk(ctx, 'LOGLOC') ? 6 : 7, 14, total, 0);
}

export function sellLivestock(ctx: Ctx, a: Animals) {
  const s = ctx.s;
  const p = s.propet;
  if (!livestockMarketOpen(s)) return reject(ctx, 'marketClosed');
  if (p.horses + p.pigs + p.cows <= 1) return reject(ctx, 'notEnoughAnimals');
  if (a.horses < 0 || a.pigs < 0 || a.cows < 0 || a.horses > p.horses - 1 || a.pigs > p.pigs || a.cows > p.cows) return reject(ctx, 'invalidQuantity');
  const row = LIVESTOCK_PRICES.get(s.date.year)!;
  const income = a.horses * lingoInt(row.horse) + a.pigs * lingoInt(row.pig) + a.cows * lingoInt(row.cow);
  if (income === 0 && a.horses + a.pigs + a.cows === 0) return reject(ctx, 'nothingSelected');
  const hadCows = p.cows > 0;
  p.horses -= a.horses;
  p.pigs -= a.pigs;
  p.cows -= a.cows;
  if (hadCows && p.cows === 0) changeLifePrice(ctx, 10, 'noCow');
  changeCash(ctx, income, 'livestock');
  fillLogBook(ctx, quirk(ctx, 'LOGLOC') ? 6 : 7, 15, 0, income);
}
