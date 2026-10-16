// Farm house: upgrade offers and the savings box. docs/spec/04-home-album.md §1, §3.
import { changeCash, changeSavings, dialog, fillLogBook, quirk, reject, type Ctx } from './ctx.ts';
import { barnHouse } from './calendar.ts';
import { HOUSE_UPGRADES } from './data/tables.ts';
import { setPending } from './events.ts';
import type { GameState } from './state.ts';

/** The upgrade offer that applies right now (SHARED ScoreScript 3234), or null. */
export function houseUpgradeOffer(s: GameState) {
  const g = s.globals;
  for (const u of HOUSE_UPGRADES) {
    if (g.whatHouse === u.from && s.propet.total >= u.threshold && g.wasHouse < 2 && s.date.year > u.minYearExclusive) return u;
  }
  return null;
}

function offer(ctx: Ctx) {
  const u = houseUpgradeOffer(ctx.s);
  if (u) setPending(ctx, { kind: 'houseOffer', fromHouse: u.from, cost: u.cost, text: u.text });
}

/** Enter the house movie at frame 1 (map, bank, field, store, town, album, news). */
export function enterHouse(ctx: Ctx) {
  if (ctx.s.propet.house <= 0) return reject(ctx, 'noHouse');
  offer(ctx);
}

/** Choice.ls: Yes buys (cash first, then savings for the shortfall); No counts a decline. */
export function answerHouseOffer(ctx: Ctx, yes: boolean) {
  const s = ctx.s;
  const p = s.pending;
  if (!p || p.kind !== 'houseOffer') return reject(ctx, 'noHouseOffer');
  setPending(ctx, null);
  if (!yes) {
    s.globals.wasHouse += 1;
    return;
  }
  const cost = p.cost;
  if (s.propet.cash >= cost) changeCash(ctx, -cost, 'house');
  else {
    changeSavings(ctx, -(cost - s.propet.cash), 'house');
    changeCash(ctx, -s.propet.cash, 'house');
  }
  if (!quirk(ctx, 'SAVLOG')) fillLogBook(ctx, 2, 18, cost, 0);
  s.globals.whatHouse += 1;
  s.globals.wasHouse = 0;
  barnHouse(ctx);
  offer(ctx); // go(1, "House"&n) re-runs the check
}

/** PressOk1: put money in the savings box. */
export function depositSavings(ctx: Ctx, amount: number) {
  const s = ctx.s;
  if (!(amount > 0)) return reject(ctx, 'invalidAmount');
  if (s.propet.house <= 0) return reject(ctx, 'noHouse');
  if (s.propet.cash < amount) return dialog(ctx, 'NotEnoughMoneyBox');
  changeSavings(ctx, amount, 'savingsBox');
  changeCash(ctx, -amount, 'savingsBox');
  fillLogBook(ctx, 2, 16, quirk(ctx, 'SAVLOG') ? 0 : amount, 0);
}

/** PressOk2: take money out of the savings box. */
export function withdrawSavings(ctx: Ctx, amount: number) {
  const s = ctx.s;
  if (!(amount > 0)) return reject(ctx, 'invalidAmount');
  if (s.propet.house <= 0) return reject(ctx, 'noHouse');
  if (s.propet.savings < amount) return dialog(ctx, 'NotEnoughMoneyBox');
  changeSavings(ctx, -amount, 'savingsBox');
  changeCash(ctx, amount, 'savingsBox');
  fillLogBook(ctx, 2, 17, 0, quirk(ctx, 'SAVLOG') ? 0 : amount);
}
