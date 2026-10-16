// General Store (STORE): seeds and catalogue. docs/spec/03-town.md §3.
import { changeCash, dialog, fillLogBook, reject, type Ctx } from './ctx.ts';
import { fenWMill } from './calendar.ts';
import { CATALOG, YIELD_CORN, YIELD_OATS, YIELD_WHEAT, type CatalogName } from './data/tables.ts';
import type { Crop, GameState } from './state.ts';

const round2 = (x: number) => Math.round(x * 100) / 100;

/** `edPrice`: seed price per acre = B/A x 0.1 for the year (unrounded). */
export function seedPricePerAcre(year: number, crop: Crop): number {
  const table = crop <= 2 ? YIELD_WHEAT : crop === 3 ? YIELD_OATS : YIELD_CORN;
  return (table.get(year)?.ba ?? 0) * 0.1;
}

/** Total the clerk expects: rounded displayed price x acres, rounded to cents. */
export function seedOrderTotal(year: number, crop: Crop, acres: number): number {
  return round2(round2(seedPricePerAcre(year, crop)) * acres);
}

/**
 * Seed order form OK (`edCheckTotal`). `typedTotal` is what the player typed; omit it to
 * let the UI skip the arithmetic exercise. Cash only.
 */
export function buySeeds(ctx: Ctx, crop: Crop, acres: number, typedTotal?: number) {
  const s = ctx.s;
  if (![1, 2, 3, 4].includes(crop) || !Number.isInteger(acres) || acres <= 0) return reject(ctx, 'invalidOrder');
  if (!s.sessions.store || s.sessions.store.seed !== crop) s.sessions.store = { errors: 0, seed: crop };
  const sess = s.sessions.store;
  const sum = seedOrderTotal(s.date.year, crop, acres);
  const student = typedTotal ?? sum;
  sess.errors += 1;
  if (sum === 0) return;
  if (round2(student) === sum) {
    if (s.propet.cash >= sum) {
      s.propet.seeds[crop - 1] += acres;
      changeCash(ctx, -sum, 'seeds');
      fillLogBook(ctx, 4, 18, sum, 0);
      return dialog(ctx, 'SEG70');
    }
    return dialog(ctx, 'SEG71');
  }
  if (sess.errors >= 3) return dialog(ctx, 'SEG69', undefined, { total: sum });
  return dialog(ctx, student < sum ? 'SEG72' : 'SEG73');
}

/** Product pages available at the current date, in catalogue order. */
export function catalogAvailable(s: GameState): { name: CatalogName; price: number; stock: number }[] {
  const { year, mon } = s.date;
  return CATALOG.filter((c) => c.year === 0 || (year === c.year && mon >= c.month) || year > c.year).map((c) => ({
    name: c.name,
    price: s.catalog[c.name].price,
    stock: s.catalog[c.name].stock,
  }));
}

/** Catalogue BUY + order OK (ScoreScript 35, `edUpdatePropt`). */
export function buyCatalogItem(ctx: Ctx, name: CatalogName, qty: number) {
  const s = ctx.s;
  const p = s.propet;
  const item = catalogAvailable(s).find((c) => c.name === name);
  if (!item) return reject(ctx, 'notInCatalog');
  if (!Number.isInteger(qty) || qty < 1 || qty > item.stock) return reject(ctx, 'invalidQuantity');
  const total = qty * item.price;
  if (p.cash < total) return dialog(ctx, 'SEG71');
  changeCash(ctx, -total, 'catalog');
  fillLogBook(ctx, 4, 18, total, 0);
  s.catalog[name].stock -= qty;
  switch (name) {
    case 'windMill':
      p.extraWindmills += qty;
      fenWMill(ctx);
      break;
    case 'wireFence':
      p.fence += qty;
      break;
    case 'kodakCamera':
      p.camera += qty;
      break;
    case 'tractor':
      p.tractors += qty;
      break;
    case 'car':
      p.car += qty;
      break;
  }
}
