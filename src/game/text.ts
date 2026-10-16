// Verbatim text lookup for ids the sim emits ("T623", "NoPlow5", "SEG70", event/letter names).
// Sources, in order: text members of the movies (by name, movie priority), recorded voice lines
// (bank/store clerks), and Lingo literals. Nothing is retyped here except clearly marked
// fallbacks for the few messages that exist only as bitmaps in the original.
import { loadAll, loadRawText, type MovieName, type TownTalkFile, type TriviaFile, type VoiceFile, type EventsFile, type LettersFile, type DialogsFile } from '../content/content.ts';

export interface Content {
  events: EventsFile;
  letters: LettersFile;
  dialogs: DialogsFile;
  trivia: TriviaFile;
  townTalk: TownTalkFile;
  voice: VoiceFile;
}

const MOVIES: MovieName[] = ['CALEND', 'FIELD', 'SHARED', 'TSTREET1', 'STORE', 'BANK09', 'HOUSE1'];
const byMovie = new Map<string, Map<string, string>>();
const voiceByName = new Map<string, { text: string; speaker: string | null }>();
let content: Content;

/** Messages whose original text is bitmap art or missing from the extraction (transcribed). */
const FALLBACK: Record<string, string> = {
  TakeMail: "There's a letter in your mailbox.",
  GameIsOver: 'Your game is over.',
  NotEnoughMoneyBox: 'Not enough money',
  NoMoneyCashier: 'There is no money waiting for you at the bank.',
};

export async function loadText() {
  const files = await loadAll(['events.json', 'letters.json', 'dialogs.json', 'trivia.json', 'townTalk.json', 'voice.json']);
  content = {
    events: files['events.json'],
    letters: files['letters.json'],
    dialogs: files['dialogs.json'],
    trivia: files['trivia.json'],
    townTalk: files['townTalk.json'],
    voice: files['voice.json'],
  };
  const raws = await Promise.all(MOVIES.map((m) => loadRawText(m)));
  raws.forEach((r, i) => {
    const m = new Map<string, string>();
    for (const mem of r.members) if (mem.name && !m.has(mem.name)) m.set(mem.name, mem.text);
    byMovie.set(MOVIES[i], m);
  });
  for (const l of content.voice.lines) {
    if (!l.text) continue;
    const name = l.id.split('.').slice(1).join('.');
    if (!voiceByName.has(name)) voiceByName.set(name, { text: l.text, speaker: l.speaker });
  }
}

export function getContent(): Content {
  return content;
}

/** Text member by name, searching movies in priority order (exact, then case-insensitive). */
export function member(name: string, prefer?: MovieName): string | undefined {
  const order = prefer ? [prefer, ...MOVIES.filter((m) => m !== prefer)] : MOVIES;
  for (const m of order) {
    const t = byMovie.get(m)?.get(name);
    if (t !== undefined) return t;
  }
  const lower = name.toLowerCase();
  for (const m of order) for (const [k, v] of byMovie.get(m) ?? []) if (k.toLowerCase() === lower) return v;
  return undefined;
}

/** Resolve a dialog id to display text. */
export function text(id: string, prefer?: MovieName): string {
  const t = member(id, prefer) ?? voiceByName.get(id)?.text ?? FALLBACK[id];
  if (t === undefined) {
    console.warn('missing text', id);
    return id;
  }
  return tidy(t);
}

/** Normalise the authoring line breaks for flowing HTML: keep paragraph breaks, join soft wraps. */
export function tidy(t: string): string {
  return t.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Lines of a member (verbatim, for lists such as Text2 or doctor lists). */
export function lines(id: string): string[] {
  return (member(id) ?? '').replace(/\r/g, '').split('\n');
}
