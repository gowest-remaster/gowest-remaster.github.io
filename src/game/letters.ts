// Letter assembly as in CALEND `DL` (ScoreScript 44) and `BuildLetter` (MovieScript 97):
// the letter text, "Dear <MyName>," unless item 12 = 1, and name substitutions for some letters.
import type { GameState } from '../sim/index.ts';
import { member } from './text.ts';

const words = (line: string) => line.split(' ');

/** Lingo `put x into word a to b of line n` on a text (1-based, words split on single spaces). */
function putWords(t: string, lineNo: number, a: number, b: number, value: string): string {
  const ls = t.split('\n');
  const l = ls[lineNo - 1];
  if (l === undefined) return t;
  const w = words(l);
  // Lingo words skip runs of spaces; emulate by mapping word indices onto non-empty tokens.
  const idx: number[] = [];
  w.forEach((x, i) => x !== '' && idx.push(i));
  if (idx.length < a) return t;
  const start = idx[a - 1];
  const end = idx[Math.min(b, idx.length) - 1];
  w.splice(start, end - start + 1, value);
  ls[lineNo - 1] = w.join(' ');
  return ls.join('\n');
}

export function myName(s: GameState) {
  return `${s.name.first} ${s.name.last}`.trim();
}

export function buildLetter(s: GameState, name: string, insertDear: boolean): string {
  let t = (member(name, 'CALEND') ?? name).replace(/\r/g, '');
  const me = myName(s);
  const son2 = s.propet.babyNames[2];
  if (insertDear) t = putWords(t, 1, 2, 2, `${me},`);
  switch (name) {
    case 'AL43':
      t = putWords(t, 1, 5, 6, me);
      t = putWords(t, 3, 1, 2, me);
      t = putWords(t, 6, 6, 7, `${me}.`);
      t = putWords(t, 7, 1, 2, me);
      break;
    case 'AL36':
    case 'AL52':
      t = putWords(t, 3, 11, 11, `${son2}.`);
      break;
    case 'AL33': {
      const ls = t.split('\n');
      ls[3] = `${son2} ${s.name.last},`.replace(/ ,$/, ',');
      t = ls.join('\n');
      break;
    }
    case 'AL34':
      t = putWords(t, 8, 11, 11, `${son2}.`);
      t = putWords(t, 4, 10, 10, son2);
      break;
    case 'AL39':
      t = putWords(t, 2, 4, 5, `${son2} ${s.name.last}`.trim());
      t = putWords(t, 5, 1, 1, son2);
      break;
    case 'AL40':
      t = putWords(t, 3, 6, 6, son2);
      break;
  }
  // Collapse the authoring's padding runs (the original field wrapped them away).
  return t.replace(/ {3,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
