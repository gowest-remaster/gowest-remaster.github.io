// Interruptions only for real decisions (docs/design/calm-ui.md §2, §4). Prompts that ask no
// question (a letter to read, family news, a neighbor's note, the mailbox nudge, the election
// result) are answered for the player the moment they arrive, exactly as pressing their only
// button would, and kept in the Mailbox to read at leisure, with their original text, letterhead
// and signature. Choices, money troubles, disasters and endings still come up as a card.
import { eventTextId, type Command, type GameState, type Prompt } from '../../sim/index.ts';
import { preview, type Effects } from './simapi.ts';
import { session } from './session.ts';

export interface MailEntry {
  at: number;
  year: number;
  mon: number;
  kind: 'letter' | 'speech' | 'notice';
  title: string;
  read: boolean;
  letter?: { id: string; had: string; sig: string; dear: boolean };
  speech?: { textId: string; dbox: string | null };
  effects?: Effects;
}

/** Messages that only inform: the sod house is up, the neighbors' gift, the mailbox nudge, the vote. */
const NOTES: Record<string, string> = {
  T623: 'Your neighbors raised your sod house',
  NOM1: 'Your neighbors chipped in $100',
  TakeMail: '',
  Extra1: 'The votes are counted',
  Extra2: 'You won the election!',
};

const item = (line: string[], n: number) => line[n - 1] ?? '';

/** What answering this prompt quietly means, or null when it needs the player. */
export function quietPrompt(s: GameState): { cmd: Command; mail: MailEntry | null; note: string } | null {
  const p: Prompt | null = s.pending;
  if (!p || s.extra.ended) return null;
  const base = { at: Date.now(), year: s.date.year, mon: s.date.mon, read: false };
  if (p.kind === 'message' && p.text in NOTES) {
    const note = NOTES[p.text];
    if (!note) return { cmd: { type: 'ack' }, mail: null, note: '' };
    return { cmd: { type: 'ack' }, mail: { ...base, kind: 'speech', title: note, speech: { textId: p.text, dbox: p.dbox ?? null }, effects: preview(s, { type: 'ack' }) }, note };
  }
  if (p.kind === 'politicianLetter') {
    const L: Record<number, [string, string, string]> = { 1: ['ALM1', 'Had5', 'SIG50'], 2: ['ALM2', 'Had2', 'SIG1'], 3: ['ALM3', 'Had2', 'SIG1'], 4: ['ALM4', 'Had3', 'SIG4'], 5: ['ALM5', 'Had3', 'SIG4'], 6: ['ALM6', 'Had4', 'SIG6'] };
    const [id, had, sig] = L[p.level] ?? L[1];
    return { cmd: { type: 'resolveEvent', choice: {} }, mail: { ...base, kind: 'letter', title: 'A letter about the election', letter: { id, had, sig, dear: true } }, note: 'A letter came for you' };
  }
  if (p.kind === 'event') {
    const line = s.events[p.line];
    const type = Number(item(line, 4)) || 0;
    if (type === 7) {
      const cmd: Command = { type: 'resolveEvent', choice: {} };
      return { cmd, mail: { ...base, kind: 'letter', title: 'A letter', letter: { id: item(line, 5), had: item(line, 6), sig: item(line, 7), dear: item(line, 12) !== '1' }, effects: preview(s, cmd) }, note: 'A letter came for you' };
    }
    if (type === 5) {
      const cmd: Command = { type: 'resolveEvent', choice: {} };
      return { cmd, mail: { ...base, kind: 'speech', title: 'News from the family', speech: { textId: eventTextId(s, p), dbox: item(line, 6) || null }, effects: preview(s, cmd) }, note: 'News from the family' };
    }
  }
  return null;
}

export function mailbox(): MailEntry[] {
  const j = session.journal as { mailbox?: MailEntry[] };
  if (!j.mailbox) j.mailbox = [];
  return j.mailbox;
}
export const unreadMail = () => mailbox().filter((m) => !m.read).length;

/** Answer a quiet prompt now. Returns the note to show (or null when nothing was pending). */
export function settleQuiet(): { note: string; mail: MailEntry | null } | null {
  const s = session.state;
  if (!s) return null;
  const q = quietPrompt(s);
  if (!q) return null;
  session.run(q.cmd, q.mail ? `Read: ${q.mail.title}` : 'OK');
  if (q.mail) mailbox().push(q.mail);
  return { note: q.note, mail: q.mail };
}
