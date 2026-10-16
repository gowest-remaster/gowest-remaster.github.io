// Formatting helpers for the Remastered UI: money, dates, plurals, crop names.
// New UI copy only; original text always comes from src/content via game/text.ts.

export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_CAPS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

let classicCurrency = false;
/** CURRENCY quirk: classic rules print negatives as "$-5.00". */
export function setClassicCurrency(b: boolean) {
  classicCurrency = b;
}

/** "$1,240.50" / "$1,240" (whole numbers drop cents unless `cents`). Negative uses a real minus. */
export function money(n: number, opts: { cents?: boolean; sign?: boolean } = {}): string {
  const neg = n < 0;
  const v = Math.abs(n);
  const cents = opts.cents ?? !Number.isInteger(Math.round(v * 100) / 100);
  const s = v.toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  if (neg && classicCurrency) return `$-${s}`;
  const sign = neg ? '−' : opts.sign && n > 0 ? '+' : '';
  return `${sign}$${s}`;
}

/** Always two decimals: "$1,240.00". */
export const money2 = (n: number) => money(n, { cents: true });

export const num = (n: number) => Math.round(n).toLocaleString('en-US');

export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

export function monthName(m: number, style: 'long' | 'short' | 'caps' = 'long') {
  const i = (((m - 1) % 12) + 12) % 12;
  return style === 'long' ? MONTHS_LONG[i] : style === 'short' ? MONTHS_SHORT[i] : MONTHS_CAPS[i];
}

export function dateLong(d: { year: number; mon: number; day?: number }) {
  return d.day ? `${monthName(d.mon)} ${d.day}, ${d.year}` : `${monthName(d.mon)} ${d.year}`;
}
export function dateShort(d: { year: number; mon: number; day?: number }) {
  return d.day ? `${monthName(d.mon, 'short')} ${d.day}, ${d.year}` : `${monthName(d.mon, 'short')} ${d.year}`;
}

/** Months from (y1,m1) to (y2,m2). */
export const monthsBetween = (y1: number, m1: number, y2: number, m2: number) => (y2 - y1) * 12 + (m2 - m1);

export const CROP_NAMES = ['', 'Winter wheat', 'Spring wheat', 'Oats', 'Corn'] as const;

export const GOAL_NAMES = ['', 'Farmer', 'Businessperson', 'Politician'] as const;
/** Check dates per goal (02 §6.7.4–6.7.6). */
export const GOAL_CHECK: Record<number, { year: number; mon: number }> = {
  1: { year: 1902, mon: 8 },
  2: { year: 1909, mon: 6 },
  3: { year: 1915, mon: 6 },
};

export function seasonName(mon: number): 'spring' | 'summer' | 'autumn' | 'winter' {
  if (mon >= 3 && mon <= 5) return 'spring';
  if (mon >= 6 && mon <= 8) return 'summer';
  if (mon >= 9 && mon <= 11) return 'autumn';
  return 'winter';
}
