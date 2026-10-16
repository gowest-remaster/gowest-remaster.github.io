// Family album unlocks, newspaper availability, achievements page values.
// docs/spec/04-home-album.md §6, 03-town.md §5.2, 02-farm-sim.md §6.11.
import { reproduces } from './fidelity.ts';
import { ALBUM_DATED_CAPTIONS, ALBUM_GENERAL_CAPTIONS, LAND_VALUE, LIVESTOCK_PRICES, NEWS_ISSUES } from './data/tables.ts';
import type { GameState } from './state.ts';

/** g_MaxPic: 17 pictures with a camera, else 5 (ANIMIDX: classic needs exactly one camera). */
export function albumMaxPictures(s: GameState): number {
  const cam = s.propet.camera;
  if (reproduces(s.fidelity, 'ANIMIDX')) return cam === 1 ? 17 : 5;
  return cam >= 1 ? 17 : 5;
}

/** General caption ids (`ATexts` .. `ATextsE`). */
export const GENERAL_CAPTION_IDS = Array.from({ length: ALBUM_GENERAL_CAPTIONS }, (_, i) => (i === ALBUM_GENERAL_CAPTIONS - 1 ? 'ATextsE' : `ATexts${i + 1}`));

/** Captions offered by the chooser at the current date (ALBUM ScoreScript 5). */
export function albumCaptions(s: GameState): string[] {
  const { year, mon } = s.date;
  if (year > 1918) return [...GENERAL_CAPTION_IDS, ...ALBUM_DATED_CAPTIONS.map((c) => c.id)];
  if (year < 1885 || (year === 1885 && mon < 8)) return [...GENERAL_CAPTION_IDS];
  if (!reproduces(s.fidelity, 'CAPSCAN')) {
    return [...GENERAL_CAPTION_IDS, ...ALBUM_DATED_CAPTIONS.filter((c) => c.year < year || (c.year === year && c.month <= mon)).map((c) => c.id)];
  }
  // Scan as written: the first not-yet-reached caption ends the range (inclusive).
  let end = -1;
  for (let i = 0; i < ALBUM_DATED_CAPTIONS.length; i++) {
    const c = ALBUM_DATED_CAPTIONS[i];
    if (c.year < year || (c.year === year && c.month <= mon)) continue;
    end = i;
    break;
  }
  if (end < 0) end = ALBUM_DATED_CAPTIONS.length - 1; // Dec 1918: stale g_EndText; treat as all
  return [...GENERAL_CAPTION_IDS, ...ALBUM_DATED_CAPTIONS.slice(0, end + 1).map((c) => c.id)];
}

/** Number of newspaper issues readable (g_cYear, 0..12). */
export function newspaperIssues(s: GameState): number {
  const { year, mon, day } = s.date;
  const reached = (d: { year: number; month: number; day: number }) =>
    year > d.year || (year === d.year && (mon > d.month || (mon === d.month && day >= d.day)));
  if (!reproduces(s.fidelity, 'T21')) return NEWS_ISSUES.filter(reached).length;
  for (let v = 1; v <= 12; v++) {
    if (year < NEWS_ISSUES[v - 1].year) {
      if (v === 1) return 0;
      const d = NEWS_ISSUES[v - 2];
      return mon < d.month || (mon === d.month && day < d.day) ? v - 2 : v - 1;
    }
  }
  const d = NEWS_ISSUES[11];
  return mon < d.month || (mon === d.month && day > d.day) ? 11 : 12;
}

/** Newspaper basket active from August 1880. */
export function newspaperAvailable(s: GameState): boolean {
  return s.date.year > 1880 || (s.date.year === 1880 && s.date.mon > 7);
}

/** Achievements page farm value (MovieScript 4). */
export function farmValue(s: GameState): number {
  const p = s.propet;
  const row = LIVESTOCK_PRICES.get(s.date.year) ?? LIVESTOCK_PRICES.get(1880)!;
  const land = LAND_VALUE.get(s.date.year) ?? 3200;
  return p.horses * row.horse + p.pigs * row.pig + p.cows * row.cow + p.tractors * 400 + p.plows * 50 + land;
}

/** Goal page progress bar width in px: money part (max 116) + score part (max 182). */
export function goalProgress(s: GameState): { money: number; score: number } {
  const goal = s.begin.goal;
  const target = goal >= 1 && goal <= 3 ? s.begin.targets[goal - 1] : 1000;
  return {
    money: Math.min(116, Math.trunc(((s.propet.cash + s.propet.savings) * 116) / target)),
    score: Math.min(182, Math.trunc((s.propet.score * 182) / 90)),
  };
}
