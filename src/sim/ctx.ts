// Command execution context and shared money/score/logbook helpers (SHARED MovieScript 3203/3207).
import { reproduces, type QuirkId } from './fidelity.ts';
import { random, type RngHolder } from './rng.ts';
import type { SimEvent } from './events-out.ts';
import type { GameState } from './state.ts';
import { MONTHS_GB } from './data/tables.ts';

export interface Ctx {
  s: GameState;
  out: SimEvent[];
}

export const quirk = (ctx: Ctx, id: QuirkId) => reproduces(ctx.s.fidelity, id);
/** World-stream roll (month advance, disasters, yields, prices, events). */
export const rand = (ctx: Ctx, n: number) => random(ctx.s, n);

/**
 * Run `fn` with the visit-stream RNG (per-visit rolls, trivia order). With RNGSTREAM
 * reproduced (classic) this is the single world stream, as in the original.
 */
export function withVisitRng<T>(ctx: Ctx, fn: (h: RngHolder) => T): T {
  if (quirk(ctx, 'RNGSTREAM')) return fn(ctx.s);
  const h: RngHolder = { rng: ctx.s.rngVisit };
  try {
    return fn(h);
  } finally {
    ctx.s.rngVisit = h.rng;
  }
}
export const visitRand = (ctx: Ctx, n: number) => withVisitRng(ctx, (h) => random(h, n));

/**
 * VISITROLL: the per-visit roll cache for the current month, or null when every visit re-rolls
 * (classic). The cache is dropped when the month changes.
 */
export function monthRolls(ctx: Ctx): GameState['extra']['visitRolls'] | null {
  if (quirk(ctx, 'VISITROLL')) return null;
  const key = ctx.s.date.year * 100 + ctx.s.date.mon;
  if (ctx.s.extra.visitRolls.key !== key) ctx.s.extra.visitRolls = { key };
  return ctx.s.extra.visitRolls;
}
export const emit = (ctx: Ctx, e: SimEvent) => {
  ctx.out.push(e);
};

/** Recompute Propet 10.2 total. */
export function syncTotal(ctx: Ctx) {
  const p = ctx.s.propet;
  p.total = p.cash + p.savings;
}

/** `ChangeCash(delta)`: cash += delta, clamped at 0 (Q1); total refreshed. */
export function changeCash(ctx: Ctx, delta: number, reason: string) {
  const p = ctx.s.propet;
  const before = p.cash;
  p.cash = Math.max(0, p.cash + delta);
  syncTotal(ctx);
  emit(ctx, { type: 'cash', delta: p.cash - before, requested: delta, cash: p.cash, reason });
}

/** Set savings directly (savings box / event payments). */
export function changeSavings(ctx: Ctx, delta: number, reason: string) {
  const p = ctx.s.propet;
  p.savings += delta;
  syncTotal(ctx);
  emit(ctx, { type: 'savings', delta, savings: p.savings, reason });
}

/**
 * Event payment "cash first, then savings" (CALEND ScoreScript 49/50/54/55, SON2PLOT).
 * `amount` > 0 is a payment; < 0 a receipt. Caller has already checked affordability.
 * Quirk PAYSAV: the original zeroes cash first, so savings lose the full amount.
 */
export function payCashThenSavings(ctx: Ctx, amount: number, reason: string) {
  const p = ctx.s.propet;
  if (p.cash >= amount) {
    changeCash(ctx, -amount, reason);
    return;
  }
  const cash = p.cash;
  changeCash(ctx, -cash, reason);
  const fromSavings = quirk(ctx, 'PAYSAV') ? amount : amount - cash;
  changeSavings(ctx, -fromSavings, reason);
}

/**
 * `MYSCORE(p)`. `reason` is the event/text id or a short key (`business1`, `claim`,
 * `doctorList`...) shown in the Standing ledger.
 */
export function addScore(ctx: Ctx, delta: number, reason = 'other') {
  if (!delta) return;
  ctx.s.propet.score += delta;
  emit(ctx, { type: 'score', delta, score: ctx.s.propet.score, reason });
}

/**
 * LifePrice (monthly upkeep) change. `reason` as for addScore. The legacy form
 * `changeLifePrice(ctx, delta, floor5?)` is still accepted (reason 'other').
 */
export function changeLifePrice(ctx: Ctx, delta: number, reason: string | boolean = 'other', floor5 = false) {
  if (typeof reason === 'boolean') {
    floor5 = reason;
    reason = 'other';
  }
  const p = ctx.s.propet;
  const before = p.lifePrice;
  p.lifePrice += delta;
  if (floor5 && p.lifePrice < 5) p.lifePrice = 5;
  if (p.lifePrice !== before) emit(ctx, { type: 'lifePrice', delta: p.lifePrice - before, lifePrice: p.lifePrice, reason });
}

/** `FillLogBook(loc, act, cost, income)` */
export function fillLogBook(ctx: Ctx, loc: number, act: number, cost: number, income: number) {
  const s = ctx.s;
  const entry = { date: `${MONTHS_GB[s.date.mon - 1]} ${s.date.day}`, year: s.date.year, loc, act, cost, income, total: s.propet.total };
  s.logbook.push(entry);
  emit(ctx, { type: 'log', entry });
}

export function dialog(ctx: Ctx, id: string, dbox?: string, params?: Record<string, string | number>) {
  emit(ctx, { type: 'dialog', id, dbox, params });
}

export function reject(ctx: Ctx, reason: string, dialogId?: string) {
  emit(ctx, { type: 'rejected', reason, dialog: dialogId });
}

/** Neighbour portrait: young (DBox1) before 1887 / `limit`, else old (DBox19). */
export function neighborBox(year: number, limitExclusive = 1887) {
  return year < limitExclusive ? 'DBox1' : 'DBox19';
}
