// Small Lingo helpers for porting the original scripts (decompiled/lingo/**). Director 4 is
// 1-based, strings use CR line breaks, "item" splits on commas.

export const CR = '\r';

export function lines(s: string): string[] {
  return s.replace(/\r\n/g, '\r').replace(/\n/g, '\r').split('\r');
}

/** `line n of s` (1-based; "" when out of range). */
export function line(s: string, n: number): string {
  return lines(s)[n - 1] ?? '';
}

/** `item n of s` (1-based, comma-delimited). */
export function item(s: string, n: number): string {
  return s.split(',')[n - 1] ?? '';
}

/** `word n of s` (1-based, whitespace-delimited). */
export function word(s: string, n: number): string {
  return s.trim().split(/\s+/)[n - 1] ?? '';
}

/** Lingo `value()` for numbers ("" or junk -> 0, like the originals rely on). */
export function value(s: string | number | null | undefined): number {
  if (typeof s === 'number') return s;
  const n = parseFloat(String(s ?? '').trim());
  return Number.isFinite(n) ? n : 0;
}

/** Lingo `random(n)`: 1..n. Presentation-only randomness (rules use the seeded sim RNG). */
export const random = (n: number) => 1 + Math.floor(Math.random() * Math.max(1, n));

/**
 * SHARED `numberToCurrency`: "$" & sign & dollars-with-commas & "." & 2-digit cents.
 * The sign comes after the "$" (quirk 17): -5 -> "$-5.00".
 */
export function numberToCurrency(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  const neg = n < 0;
  const cents = Math.round(Math.abs(n) * 100);
  const d = Math.floor(cents / 100);
  const c = cents % 100;
  const digits = `${d.toLocaleString('en-US')}.${String(c).padStart(2, '0')}`;
  if (neg && !currencyQuirk) return `-$${digits}`;
  return `$${neg ? '-' : ''}${digits}`;
}

/** CURRENCY quirk (sim/fidelity.ts): set by the Classic scene from the game's fidelity. */
let currencyQuirk = true;
export function setCurrencyQuirk(on: boolean) {
  currencyQuirk = on;
}

export function currencyToNumber(s: string): number {
  return value(s.replace(/^\$/, '').replace(/,/g, ''));
}

/** `sProperCase`: first letter of each space-separated word upper-cased, the rest lower-cased. */
export function properCase(s: string): string {
  return s
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

/** Month names as in field "YearGB" (calendar, upper case with a dot). */
export const YEAR_GB = ['JAN.', 'FEB.', 'MAR.', 'APR.', 'MAY', 'JUNE', 'JULY', 'AUG.', 'SEPT.', 'OCT.', 'NOV.', 'DEC.'];
/** Month names as in field "Year" (FIELD and town dates). */
export const YEAR_MON = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
