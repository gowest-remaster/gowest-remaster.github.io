// FIELD movie: entering the field, plowing, planting, harvesting and the yield formula.
// docs/spec/02-farm-sim.md §5.
import { changeCash, dialog, emit, fillLogBook, monthRolls, quirk, rand, reject, visitRand, type Ctx } from './ctx.ts';
import { advanceDays, catchUpMonths, recordSkippedMonths, seasonOf } from './calendar.ts';
import { YIELD_CORN, YIELD_OATS, YIELD_WHEAT } from './data/tables.ts';
import { hasUnsoldCrops } from './rules.ts';
import { SQUARES, lingoInt, zeros, type Crop, type FieldSession } from './state.ts';

export interface Helpers {
  /** hired workers 0..5 (paid daily) */
  workers: number;
  /** neighbours 0..available (free, creates a debt) */
  neighbors: number;
  /** family 0..Propet 14.2 */
  family: number;
}

export const NO_HELPERS: Helpers = { workers: 0, neighbors: 0, family: 0 };
const SEASON_MONTHS = [4, 5, 9, 10];

/** FIELD startMovie (MovieScript 1) + the map click that recomputes CurSit 4.5 (ScoreScript 13). */
export function enterField(ctx: Ctx): FieldSession {
  const s = ctx.s;
  const r = s.random;
  // Q14: the map->field click uses Random 2.2 for both thresholds.
  s.cursit.wintSum = quirk(ctx, 'Q14')
    ? seasonOf(s.date.mon, s.date.day, r.winterDay, r.winterDay)
    : seasonOf(s.date.mon, s.date.day, r.summerDay, r.winterDay);
  const cache = monthRolls(ctx);
  let neighbors: number;
  let wage: number;
  if (cache) {
    // VISITROLL: once per month; the neighbour roll is kept even while goodwill is cool.
    cache.field ??= { neighbors: visitRand(ctx, 3), wage: visitRand(ctx, 3) + 3 };
    neighbors = s.cursit.goodwill > 0 ? 0 : cache.field.neighbors;
    wage = cache.field.wage;
  } else {
    neighbors = s.cursit.goodwill > 0 ? 0 : visitRand(ctx, 3);
    wage = visitRand(ctx, 3) + 3;
  }
  s.propet.hasSeed = s.propet.seeds.some((x) => x > 0) ? 1 : 0;
  const session = { neighbors, wage, land: s.propet.landQuality };
  s.sessions.field = session;
  return session;
}

function session(ctx: Ctx): FieldSession {
  return ctx.s.sessions.field ?? enterField(ctx);
}

/** Days per square for a helper team: integer division first (02 §5.2). */
export function mySpeed(tractors: number, h: Helpers): number {
  const base = tractors > 0 ? 2 : 6;
  return Math.trunc(base / (h.workers + h.neighbors + h.family + 1));
}

function validHelpers(ctx: Ctx, h: Helpers, maxNeighbors: number): boolean {
  const ok =
    Number.isInteger(h.workers) && h.workers >= 0 && h.workers <= 5 &&
    Number.isInteger(h.neighbors) && h.neighbors >= 0 && h.neighbors <= maxNeighbors &&
    Number.isInteger(h.family) && h.family >= 0 && h.family <= ctx.s.propet.familyWorkers;
  if (!ok) reject(ctx, 'invalidHelpers');
  return ok;
}

/** FIELD `CheckMoney` (MovieScript 38). NoM1 gives the $100 immediately (dialog OK). */
function checkMoneyField(ctx: Ctx) {
  const s = ctx.s;
  let code: number;
  if (s.propet.savings > 0) code = 2;
  else if (hasUnsoldCrops(ctx)) code = 3;
  else if (s.globals.count1 === 0) {
    code = 1;
    s.globals.count1 = 1;
  } else if (s.propet.loanAmount === 0) code = 4;
  else code = 6;
  dialog(ctx, `NoM${code}`);
  if (code === 1) changeCash(ctx, 100, 'neighborsGift');
}

/** Season check during field work. `swapped` = PlowGoes thresholds (Q14). */
function fieldSeason(ctx: Ctx, swapped: boolean) {
  const s = ctx.s;
  const { mon, day } = s.date;
  const may = swapped ? s.random.winterDay : s.random.summerDay;
  const oct = swapped ? s.random.summerDay : s.random.winterDay;
  if ((mon === 5 && day >= may) || mon === 6) s.cursit.wintSum = 2;
  else if ((mon === 10 && day >= oct) || mon === 11) s.cursit.wintSum = 1;
}

function finishFieldCommand(ctx: Ctx, fromKey: number) {
  if (quirk(ctx, 'Q4')) {
    ctx.s.date.lastStopMonth = ctx.s.date.mon; // FIELD sets CurSeason item 5 = item 3
    recordSkippedMonths(ctx, fromKey);
  } else catchUpMonths(ctx, fromKey);
}

// ---------------------------------------------------------------------------
// Plowing
// ---------------------------------------------------------------------------

export interface PlowOptions {
  /** 1-based squares (1..8 field 1, 9..16 field 2). */
  squares: number[];
  helpers?: Helpers;
  /** Answer to the "plow broke" interruption: buy new steel ($50) or repair the old one (+10 days). */
  plowBreakChoice?: 'newSteel' | 'repair';
}

/** Plow button + selection + OK (ScoreScripts 6/7/19, PlowGoes, Pla). */
export function plow(ctx: Ctx, opts: PlowOptions) {
  const s = ctx.s;
  const c = s.cursit;
  const p = s.propet;
  const sess = session(ctx);
  const { mon } = s.date;
  const nSquares = 8 * p.numFields;
  if (SEASON_MONTHS.includes(mon) && c.wintSum === 0) {
    if (c.numHarved > 0) return dialog(ctx, 'NoPlow5');
    if (c.plow.slice(0, nSquares).filter((v) => v === 1).length >= nSquares) return dialog(ctx, 'NoPlow1');
  } else if (p.cash <= 0) return checkMoneyField(ctx);
  else if (c.wintSum > 0) return dialog(ctx, `NoPlow${2 + c.wintSum}`);

  const h = opts.helpers ?? NO_HELPERS;
  if (!validHelpers(ctx, h, sess.neighbors)) return;
  const marked = [...new Set(opts.squares)].filter((sq) => sq >= 1 && sq <= nSquares && c.plow[sq - 1] === 0).sort((a, b) => a - b);
  if (marked.length === 0) return reject(ctx, 'noSquaresSelected');
  let speed = mySpeed(p.tractors, h);
  const estTime = Math.max(1, marked.length * speed);
  if (h.workers > 0 && p.cash < h.workers * sess.wage * estTime) return dialog(ctx, h.workers === 1 ? 'OneWor' : 'ManyWor');
  c.workNow = Math.max(c.workNow, h.neighbors);
  for (const sq of marked) c.plow[sq - 1] = 2;

  const d = s.date;
  const from = d.year * 100 + d.mon;
  let done = 0;
  let plowTime = 0;
  let broke = false;
  let sick = false;
  for (const sq of marked) {
    if (c.plow[sq - 1] !== 2) continue;
    advanceDays(ctx, speed, 'field', 'plow');
    done++;
    plowTime += speed;
    c.plow[sq - 1] = 1;
    fieldSeason(ctx, quirk(ctx, 'Q14'));
    if (done === marked.length) break;
    if (marked.length > 2 && done < marked.length - 1) {
      if (c.wintSum > 0) {
        dialog(ctx, c.wintSum === 1 ? 'StopPlow2' : 'StopPlow1');
        for (let i = 0; i < SQUARES; i++) if (c.plow[i] !== 1) c.plow[i] = d.mon === 10 ? 15 : 0;
        break;
      }
      if (!broke && p.tractors === 0 && done > 1 && rand(ctx, 10) < 3) {
        broke = true;
        dialog(ctx, 'StopPlow3');
        let choice = opts.plowBreakChoice ?? 'newSteel';
        if (choice === 'newSteel' && p.cash < 50) {
          dialog(ctx, 'NoMoney');
          choice = 'repair';
        }
        if (choice === 'newSteel') {
          changeCash(ctx, -50, 'plowSteel');
          fillLogBook(ctx, 3, 14, 50, 0);
        } else {
          advanceDays(ctx, 10, 'field', 'plowRepair');
          if (quirk(ctx, 'Q17')) changeCash(ctx, -10, 'plowRepair');
        }
        continue;
      }
      if (!sick && p.horses === 2 && done > 1 && rand(ctx, 10) < 3 && p.tractors === 0) {
        sick = true;
        speed *= 2;
        dialog(ctx, 'StopPlow4');
      }
    }
  }
  // Frame Pla
  if (speed < 1) advanceDays(ctx, sick ? 2 : 1, 'field', 'plow');
  c.numPlowed = c.plow.filter((v) => v === 1).length;
  for (let i = 0; i < SQUARES; i++) if (c.plow[i] === 2) c.plow[i] = 0;
  if (plowTime === 0) plowTime = 1;
  if (h.workers > 0) {
    const cost = h.workers * sess.wage * plowTime;
    changeCash(ctx, -cost, 'workers');
    fillLogBook(ctx, 3, 11, cost, 0);
  }
  fillLogBook(ctx, 3, 7, 0, 0);
  dialog(ctx, 'FDBK7');
  c.firstHarv = 1;
  finishFieldCommand(ctx, from);
}

// ---------------------------------------------------------------------------
// Planting
// ---------------------------------------------------------------------------

export interface Planting {
  /** 1-based square */
  square: number;
  crop: Crop;
}

/** Plant button + drag/drop + OK (ScoreScripts 46/32/40/45, YESPLANT). Costs no time or money. */
export function plant(ctx: Ctx, plantings: Planting[]) {
  const s = ctx.s;
  const c = s.cursit;
  const p = s.propet;
  const mon = s.date.mon;
  p.hasSeed = p.seeds.some((x) => x > 0) ? 1 : 0;
  let code = 0;
  if (c.numHarved > 0) code = 4;
  else if (c.numPlowed === 0) code = mon >= 4 && mon <= 6 ? 2 : 3;
  else if ([12, 1, 2, 3, 7, 8].includes(mon)) code = 6;
  else if (c.numPlanted === c.numPlowed) code = 7;
  else if (p.hasSeed === 0) code = 1;
  else if ((mon >= 4 && mon <= 6 && p.seeds[1] + p.seeds[2] + p.seeds[3] === 0) || (mon >= 8 && mon <= 10 && p.seeds[0] === 0)) code = 5;
  if (code) return dialog(ctx, `NoPlant${code}`);
  let planted = 0;
  for (const { square, crop } of plantings) {
    if (crop === 1 ? mon >= 4 && mon <= 7 : mon < 4 || mon > 7) {
      dialog(ctx, 'NoPlant5');
      continue;
    }
    const i = square - 1;
    if (i < 0 || i >= 8 * p.numFields || !(c.plow[i] > 0 && c.plow[i] < 10) || c.plant[i] !== 0) continue;
    if (p.seeds[crop - 1] < 20) continue;
    c.plant[i] = crop;
    c.numPlanted += 1;
    p.seeds[crop - 1] -= 20;
    planted++;
  }
  if (planted === 0) return reject(ctx, 'nothingPlanted');
  if (mon > 7) {
    c.deadlineYear = s.date.year + 1;
    c.deadlineMonth = 5;
  } else {
    c.deadlineYear = s.date.year;
    c.deadlineMonth = 10;
  }
  fillLogBook(ctx, 3, 8, 0, 0);
}

// ---------------------------------------------------------------------------
// Harvesting and yields
// ---------------------------------------------------------------------------

export interface YieldResult {
  bushels: [number, number, number, number];
  prices: [number, number, number, number];
  values: [number, number, number, number];
  index: number;
}

/**
 * Harend yield/price computation (FIELD ScoreScript 69). `counts` = harvested squares per crop.
 * RNG order: random(40) index, random(10) winter-wheat delta, random(10) sign.
 */
export function computeYield(ctx: Ctx, counts: [number, number, number, number], land: number): YieldResult {
  const year = ctx.s.date.year;
  const w = YIELD_WHEAT.get(year)!;
  const o = YIELD_OATS.get(year)!;
  const cr = YIELD_CORN.get(year)!;
  let bu2 = w.ba;
  let bu3 = o.ba;
  let bu4 = cr.ba;
  const pr2 = w.pb;
  const pr3 = o.pb;
  const pr4 = quirk(ctx, 'Q24') ? cr.pb : cr.pbIntended;
  if (land === 0) {
    bu2 -= (bu2 * 15) / 100;
    bu3 -= (bu3 * 15) / 100;
    bu4 -= (bu4 * 15) / 100;
  } else if (land === 2) {
    bu2 += (bu2 * 15) / 100;
    bu3 += (bu3 * 15) / 100;
    bu4 += (bu4 * 15) / 100;
  }
  const ran = rand(ctx, 40);
  const index = ran > 20 ? ran - 20 : -ran;
  const delta = (pr2 / 100) * rand(ctx, 10);
  const pr1 = rand(ctx, 10) < 5 ? pr2 + delta : pr2 - delta;
  const bu = [bu2, bu2, bu3, bu4];
  const pr = [pr1, pr2, pr3, pr4];
  const bushels = [0, 1, 2, 3].map((k) => {
    const b = lingoInt(bu[k] * counts[k] * 20);
    return b + Math.trunc((b * index) / 100);
  }) as YieldResult['bushels'];
  const values = [0, 1, 2, 3].map((k) => lingoInt(pr[k] * bushels[k])) as YieldResult['values'];
  return { bushels, prices: pr as YieldResult['prices'], values, index };
}

export interface HarvestOptions {
  helpers?: Helpers;
}

/** Harvest button + OK (ScoreScripts 57/51/56, HarvGoes, SH, Harend). */
export function harvest(ctx: Ctx, opts: HarvestOptions = {}) {
  const s = ctx.s;
  const c = s.cursit;
  const p = s.propet;
  const sess = session(ctx);
  const mon = s.date.mon;
  if (!SEASON_MONTHS.includes(mon)) return dialog(ctx, c.numPlanted > 0 ? 'NoHarv1' : 'NoHarv2');
  if (c.wintSum === 1) return dialog(ctx, 'StopHarv2');
  if (c.numHarved === 0) {
    if (c.numPlanted > 0) return dialog(ctx, 'NoHarv1');
    if (c.numPlowed > 0) return dialog(ctx, 'NoHarv2');
    return dialog(ctx, 'NoHarv3');
  }
  if (p.cash <= 0) return checkMoneyField(ctx);
  const h = opts.helpers ?? NO_HELPERS;
  if (!validHelpers(ctx, h, sess.neighbors)) return;
  const speed = mySpeed(p.tractors, h);
  if (!quirk(ctx, 'Q18') && h.workers > 0 && h.workers * sess.wage * Math.max(1, c.numHarved * speed) > p.cash)
    return dialog(ctx, h.workers === 1 ? 'OneWor' : 'ManyWor');
  s.globals.workNow1 = Math.max(s.globals.workNow1, h.neighbors);

  const d = s.date;
  const from = d.year * 100 + d.mon;
  const squares = c.harv.map((v, i) => (v > 0 && v < 10 ? i : -1)).filter((i) => i >= 0);
  let done = 0;
  let harvTime = 0;
  for (const i of squares) {
    advanceDays(ctx, speed, 'field', 'harvest');
    done++;
    harvTime += speed;
    fieldSeason(ctx, false);
    if (done < squares.length && c.wintSum > 0) {
      dialog(ctx, c.wintSum === 1 ? 'StopHarv2' : 'StopHarv1');
      // Q19: the original writes this wipe into CurSit line 1; Harend clears the field anyway.
      for (let j = i + 1; j < 8 * p.numFields; j++) c.harv[j] = d.mon === 10 ? 15 : 0;
      break;
    }
  }
  // Harend
  if (speed < 1) advanceDays(ctx, 1, 'field', 'harvest');
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const v of c.harv) if (v >= 1 && v <= 4) counts[v - 1]++;
  const y = computeYield(ctx, counts, sess.land);
  const roundPrices = quirk(ctx, 'Q15');
  for (let k = 0; k < 4; k++) {
    c.bushels[k] += y.bushels[k];
    c.prices[k] = roundPrices ? Math.round(y.prices[k]) : Math.round(y.prices[k] * 100) / 100;
  }
  c.harvestValue = y.values.reduce((a, b) => a + b, 0);
  c.harvestBushels = y.bushels.reduce((a, b) => a + b, 0);
  if (h.workers > 0) {
    const cost = h.workers * sess.wage * harvTime;
    changeCash(ctx, -cost, 'workers');
    fillLogBook(ctx, 3, 11, cost, 0);
  }
  fillLogBook(ctx, 3, 9, 0, 0);
  c.plow = zeros(SQUARES);
  c.plant = zeros(SQUARES);
  c.harv = zeros(SQUARES);
  c.numPlowed = 0;
  c.numPlanted = 0;
  c.numHarved = 0;
  c.firstHarv = 1;
  emit(ctx, { type: 'harvest', bushels: y.bushels, prices: [...c.prices], value: c.harvestValue, index: y.index });
  dialog(ctx, s.date.year === 1880 ? 'EndHarv1' : 'EndHarv');
  finishFieldCommand(ctx, from);
}
