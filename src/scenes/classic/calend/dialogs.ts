// CALEND dialog frames and the board's presenter for sim dialogs/prompts.
// Frame scripts lay the dialogs out exactly as ScoreScripts 26/28/44/25/45/46/51/52/56/58/61/
// 24/265/295 did; the button scripts (27/55/29/50/92/47/49/53/54/57/59/60/62/63/145/296)
// resolve the player's answer, which the presenter turns into the sim command.
import type { Command, GameState, Prompt } from '../../../sim/index.ts';
import { doctorListItems, eventTextId } from '../../../sim/index.ts';
import { game, type Presenter } from '../../../engine/game.ts';
import { text as contentText } from '../../../game/text.ts';
import { askPrompt, showTownTalk } from '../../../ui/prompts.ts';
import type { ScriptTable } from '../dir/player.ts';
import { csound } from '../dir/sound.ts';
import { lines, numberToCurrency, value } from '../dir/lingo.ts';
import type { Calend } from './board.ts';

export type DialogCur =
  | { kind: 'mes'; text: string; dbox: string }
  | { kind: 'dec1'; line: string[]; input: 1 | 2; button: 0 | 1 }
  | { kind: 'dl'; line: string[]; input: 1 | 2 | 3 }
  | { kind: 'dl1'; level: number }
  | { kind: 'doc1' }
  | { kind: 'wed'; line: string[] }
  | { kind: 'wed1'; line: string[] }
  | { kind: 'may'; text: string; answers: number[] }
  | { kind: 'maym' }
  | { kind: 'lists'; line: string[] }
  | { kind: 'extra'; n: number }
  | { kind: 'nhelp'; days: number }
  | { kind: 'eog' };

export interface DialogState {
  cur: DialogCur | null;
  resolve: ((v: never) => void) | null;
}

/** g_DBNames: dialog portraits that carry a name plate */
const DB_NAMES = ['DBox2', 'DBox13', 'DBox12', 'DBox01', 'DBox32', 'DBox23'];
const it = (line: string[], n: number) => (line[n - 1] ?? '').trim();

/** Show a dialog frame and wait for its button script to resolve. */
function modal<T>(cal: Calend, label: string, cur: DialogCur): Promise<T> {
  return new Promise<T>((resolve) => {
    cal.dlg.resolve?.(undefined as never);
    cal.dlg.cur = cur;
    cal.dlg.resolve = resolve as (v: never) => void;
    cal.g.enter = 0;
    cal.d.cursor(0);
    // Ret(): the day is written back into NewDate when the calendar stops for a dialog
    if (cal.c.state) cal.dateFields(false);
    cal.d.go(label);
  });
}

function finish(cal: Calend, v: unknown) {
  const r = cal.dlg.resolve;
  cal.dlg.cur = null;
  cal.dlg.resolve = null;
  cal.g.enter = 0;
  cal.d.cursorOff();
  for (let i = 18; i <= 31; i++) cal.d.puppetSprite(i, false);
  cal.d.go('Begin');
  r?.(v as never);
}

/** Original text of a field (CALEND/SHARED cast), else the content lookup. */
export function fieldText(cal: Calend, id: string): string {
  const m = cal.d.member(id);
  if (m && (m.type === 'text' || m.type === 'button') && m.text !== undefined) return m.text;
  return contentText(id);
}

function nameFor(s: GameState, dbox: string): string {
  const pos = DB_NAMES.indexOf(dbox) + 1;
  if (pos < 3) return 'Lilly Mae';
  if (pos === 3) return s.propet.babyNames[1];
  if (pos === 6) return s.propet.babyNames[2];
  return s.propet.babyNames[0];
}

/** Lingo `put v into word a to b of line n of field` (words = runs of non-spaces). */
function putWords(t: string, lineNo: number, a: number, b: number, v: string): string {
  const ls = t.split(/\r\n|\r|\n/);
  const l = ls[lineNo - 1];
  if (l === undefined) return t;
  const spans: [number, number][] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(l))) spans.push([m.index, m.index + m[0].length]);
  if (spans.length < a) return t;
  const start = spans[a - 1][0];
  const end = spans[Math.min(b, spans.length) - 1][1];
  ls[lineNo - 1] = l.slice(0, start) + v + l.slice(end);
  return ls.join('\r');
}

/** DL (ScoreScript 44) + BuildLetter (MovieScript 97), on the original field text (layout kept). */
function letterText(cal: Calend, name: string, insertDear: boolean): string {
  const s = cal.s;
  let t = fieldText(cal, name);
  const me = `${s.name.first} ${s.name.last}`.trim();
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
      const ls = t.split(/\r\n|\r|\n/);
      ls[3] = `${son2} ${s.name.last},`.replace(/ ,$/, ',');
      t = ls.join('\r');
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
  return t;
}

/** Coord (SHARED): letter name -> signature y */
function signCoord(cal: Calend, name: string): number {
  const raw = cal.d.field('Coord');
  const m = new RegExp(`#${name}:(\\d+)`, 'i').exec(raw);
  return m ? Number(m[1]) : 0;
}

/** The dialog with a portrait + optional name plate (Mes / Doc / Wed layout, frames 26/45/51). */
function portraitSetup(cal: Calend, dbox: string | undefined) {
  const d = cal.d;
  for (const ch of [20, 21, 22, 24, 25]) d.puppetSprite(ch, true);
  cal.hand(22);
  if (dbox && d.castNumber(dbox)) cal.setCastName(20, dbox);
  for (let ch = 20; ch <= 22; ch++) cal.up(ch);
  if (dbox && DB_NAMES.includes(dbox)) {
    d.setField('Name', nameFor(cal.s, dbox));
    cal.up(24);
    cal.up(25);
  }
}

function setChecks(cal: Calend, from: number, n: number) {
  for (let ch = from; ch < from + n; ch++) {
    cal.up(ch);
    cal.setCastName(ch, 'NoR');
    cal.hand(ch);
  }
}

export function dialogScripts(cal: Calend): ScriptTable {
  const d = cal.d;
  const g = cal.g;
  const cur = () => cal.dlg.cur;
  let myBuy: number[] = [];
  let myChoice = 0;
  let totSum = 0;
  const okWhen = (on: boolean) => {
    const sp = d.sprite(30);
    if (on && sp.locV > 1000) {
      cal.up(30);
      cal.hand(30);
    } else if (!on && sp.locV < 1000) {
      cal.down(30);
      d.setCursor(30, null);
    }
  };
  const toggle = (ch: number) => {
    const on = d.sprite(ch).castNum === d.castNumber('YesR');
    cal.setCastName(ch, on ? 'NoR' : 'YesR');
    return !on;
  };
  return {
    // 26: Mes
    26: {
      exitFrame() {
        const c = cur();
        if (g.enter === 0 && c?.kind === 'mes') {
          g.enter = 1;
          d.setField('CurFDBK', c.text);
          portraitSetup(cal, c.dbox);
        }
        d.go(d.frame);
      },
    },
    // 27: OK of Mes / Doc / Wed
    27: {
      mouseDown: () => d.press(),
      mouseUp() {
        finish(cal, true);
      },
    },
    // 45: Doc (the doctor speaks)
    45: {
      exitFrame() {
        const c = cur();
        if (g.enter === 0 && c?.kind === 'mes') {
          g.enter = 1;
          d.setField('CurFDBK', c.text);
          portraitSetup(cal, 'DBox11');
        }
        d.go(d.frame);
      },
    },
    // 51: Wed (the wedding news)
    51: {
      exitFrame() {
        const c = cur();
        if (g.enter === 0 && c?.kind === 'wed') {
          g.enter = 1;
          d.setField('WL1', d.field('WL0'));
          d.setField('CurFDBK', fieldText(cal, it(c.line, 5)));
          portraitSetup(cal, it(c.line, 7));
        }
        d.go(d.frame);
      },
    },
    // 28: Dec1 (baby name / yes-no family decisions)
    28: {
      exitFrame() {
        const c = cur();
        if (g.enter === 0 && c?.kind === 'dec1') {
          g.enter = 1;
          cal.puppets(18, 31, true);
          d.setField('CurFDBK', fieldText(cal, eventTextId(cal.s, promptOf(cal))));
          d.setField('CurF2', lines(d.field('Text2'))[value(it(c.line, 6)) - 1] ?? '');
          const dbox = it(c.line, 7);
          if (d.castNumber(dbox)) cal.setCastName(18, dbox);
          cal.up(18);
          cal.up(19);
          if (c.button === 1) {
            cal.setCastName(30, 'OK');
            cal.setCastName(31, 'Cans');
          }
          cal.hand(30, 31);
          cal.up(20);
          if (c.input === 1) {
            cal.up(25);
            cal.up(21);
            cal.up(24);
            d.setLocH(30, 510);
            d.setField('INPUT', '');
            d.setEditable(24, true);
            d.focus = 24;
          } else {
            cal.up(30);
            cal.up(31);
            cal.up(25);
          }
        }
        if (c?.kind === 'dec1' && c.input === 1) okWhen(d.field('INPUT').length > 0);
        d.go(d.frame);
      },
      keyDown(key: string) {
        const c = cur();
        if (c?.kind !== 'dec1' || c.input !== 1) return false;
        if (key === 'Backspace') return true;
        if (key.length !== 1) return false;
        const code = key.charCodeAt(0);
        return code >= 65 && code <= 122 && d.field('INPUT').length < 10;
      },
    },
    // 55: Yes / OK of Dec1
    55: {
      mouseDown: () => d.press(),
      mouseUp() {
        const name = d.field('INPUT');
        d.setEditable(24, false);
        finish(cal, { yes: true, name });
      },
    },
    // 29: No / Cancel (Dec1, DL, Doc1, Wed1)
    29: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.setEditable(24, false);
        d.setEditable(27, false);
        finish(cal, { yes: false, cancel: true });
      },
    },
    // 44: DL (letters)
    44: {
      exitFrame() {
        const c = cur();
        if (g.enter === 0 && c?.kind === 'dl') {
          g.enter = 1;
          cal.puppets(18, 31, true);
          const had = it(c.line, 6);
          const name = it(c.line, 5);
          const sig = it(c.line, 7);
          if (sig !== '0' && d.castNumber(sig)) cal.setCastName(21, sig);
          d.setField('DLL', letterText(cal, name, it(c.line, 12) !== '1'));
          cal.up(18);
          if (had !== '0' && d.castNumber(had)) {
            cal.setCastName(19, had);
            cal.up(19);
            d.setLocV(20, 85);
          } else d.setLocV(20, 48);
          if (sig !== '0') {
            const y = signCoord(cal, name);
            if (y > 0) d.setLocV(21, y + 20);
            else cal.up(21);
          }
          if (c.input === 3) {
            cal.setCastName(30, 'Yes');
            cal.setCastName(31, 'No');
          }
          d.setField('DL0', lines(d.field('Text2'))[value(it(c.line, 8)) - 1] ?? '');
          if (c.input === 1) {
            for (const ch of [22, 23, 26, 27, 31]) cal.up(ch);
            d.setField('INPUT1', '');
            d.setEditable(27, true);
            d.focus = 27;
            cal.hand(31);
          } else if (c.input === 2) {
            d.setLoc(30, 518, 365);
            cal.hand(30);
          } else {
            for (const ch of [22, 23, 30, 31]) cal.up(ch);
            cal.hand(30, 31);
          }
        }
        if (c?.kind === 'dl' && c.input === 1) okWhen(d.field('INPUT1').length > 0);
        d.go(d.frame);
      },
      keyDown(key: string) {
        const c = cur();
        if (c?.kind !== 'dl' || c.input !== 1) return false;
        if (key === 'Backspace') return true;
        return key.length === 1 && key >= '0' && key <= '9' && d.field('INPUT1').length < 5;
      },
    },
    // 50: OK / Yes of a letter
    50: {
      mouseDown: () => d.press(),
      mouseUp() {
        const amount = value(d.field('INPUT1'));
        d.setEditable(27, false);
        finish(cal, { yes: true, amount });
      },
    },
    // 25: DL1 (politician letters ALM1..6)
    25: {
      exitFrame() {
        const c = cur();
        if (g.enter === 0 && c?.kind === 'dl1') {
          g.enter = 1;
          cal.puppets(18, 31, true);
          const w = c.level;
          const name2 = `ALM${w}`;
          const [had, sig] = w === 1 ? ['Had5', 'Sig50'] : w < 4 ? ['Had2', 'Sig1'] : w < 6 ? ['Had3', 'Sig4'] : ['Had4', 'Sig6'];
          cal.setCastName(19, had);
          cal.setCastName(21, sig);
          const body = lines(fieldText(cal, name2));
          body[0] = `Dear  ${cal.s.name.first} ${cal.s.name.last}`.trimEnd() + ',';
          d.setField('DLL', body.join('\r'));
          for (const ch of [18, 19, 20, 30]) cal.up(ch);
          const y = signCoord(cal, name2);
          if (y > 0) d.setLocV(21, y + 20);
          else cal.up(21);
          cal.hand(30);
        }
        d.go(d.frame);
      },
    },
    92: {
      mouseDown: () => d.press(),
      mouseUp() {
        finish(cal, true);
      },
    },
    // 46: Doc1 (the doctor's list)
    46: {
      exitFrame() {
        const c = cur();
        if (g.enter === 0 && c?.kind === 'doc1') {
          g.enter = 1;
          cal.puppets(18, 31, true);
          const stove = cal.s.propet.stove > 0;
          d.setField('DocList', d.field(stove ? '0DocList' : 'ListBase'));
          d.setField('MYINPUT', '');
          for (const ch of [20, 21, 22, 23, 28, 31]) cal.up(ch);
          cal.hand(31);
          const n = doctorListItems(stove).length;
          setChecks(cal, 24, n);
          myBuy = Array(n).fill(0);
        }
        okWhen(myBuy.some((x) => x > 0));
        d.go(d.frame);
      },
    },
    // 47: tick a doctor's-list line
    47: {
      mouseUp() {
        const ch = d.clickOn;
        const i = ch - 24;
        const on = toggle(ch);
        const items = doctorListItems(cal.s.propet.stove > 0);
        myBuy[i] = on ? items[i].price : 0;
        d.setField('MYINPUT', numberToCurrency(myBuy.reduce((a, b) => a + b, 0)));
      },
    },
    49: {
      mouseDown: () => d.press(),
      mouseUp() {
        finish(cal, { items: myBuy.map((x) => x > 0) });
      },
    },
    // 52: Wed1 (how much for the wedding)
    52: {
      exitFrame() {
        const c = cur();
        if (g.enter === 0 && c?.kind === 'wed1') {
          myChoice = 0;
          g.enter = 1;
          cal.puppets(18, 31, true);
          d.setField('DL0', "I'll give");
          d.setField('WedPr1', numberToCurrency(value(it(c.line, 8))));
          d.setField('WedPr2', numberToCurrency(value(it(c.line, 9))));
          d.setField('WedPr3', numberToCurrency(value(it(c.line, 10))));
          d.setField('CurFDBK1', fieldText(cal, it(c.line, 6)));
          for (const ch of [20, 21, 22, 23, 24, 25, 26, 27, 28, 31]) cal.up(ch);
          for (const ch of [26, 27, 28]) cal.setCastName(ch, 'NoR');
          cal.hand(26, 27, 28, 31);
        }
        okWhen(myChoice > 0);
        d.go(d.frame);
      },
    },
    // 53: radio buttons (Wed1, May)
    53: {
      mouseUp() {
        const ch = d.clickOn;
        if (d.sprite(ch).castNum === d.castNumber('NoR')) {
          if (myChoice > 0) cal.setCastName(myChoice + 25, 'NoR');
          cal.setCastName(ch, 'YesR');
          myChoice = ch - 25;
        }
      },
    },
    54: {
      mouseDown: () => d.press(),
      mouseUp() {
        finish(cal, { option: myChoice });
      },
    },
    // 56: May (goal reached: what next?)
    56: {
      exitFrame() {
        const c = cur();
        if (g.enter === 0 && c?.kind === 'may') {
          myChoice = 0;
          g.enter = 1;
          cal.puppets(18, 31, true);
          d.setField('CurFDBK1', fieldText(cal, c.text));
          cal.up(20);
          cal.up(22);
          const n = c.answers.length;
          const fb = value(c.text.replace(/\D/g, '')) || 1;
          for (let ch = 26; ch <= 25 + n; ch++) {
            cal.setCastName(ch, 'NoR');
            if (ch === 27) {
              d.setLocV(ch, fb < 3 ? 230 : 240);
              cal.hand(ch);
              continue;
            }
            cal.up(ch);
            cal.hand(ch);
          }
        }
        okWhen(myChoice > 0);
        d.go(d.frame);
      },
    },
    57: {
      mouseDown: () => d.press(),
      mouseUp() {
        finish(cal, { option: myChoice });
      },
    },
    // 58: MayM (the town council questionnaire)
    58: {
      exitFrame() {
        if (g.enter === 0 && cur()?.kind === 'maym') {
          g.enter = 1;
          cal.puppets(18, 31, true);
          for (let ch = 24; ch <= 29; ch++) {
            cal.setCastName(ch, 'NoR');
            cal.hand(ch);
          }
          myBuy = [0, 0, 0, 0, 0, 0];
          totSum = 0;
          cal.hand(30);
        }
        d.go(d.frame);
      },
    },
    // 59: checkboxes (MayM, Lists)
    59: {
      mouseUp() {
        const ch = d.clickOn;
        const c = cur();
        const on = toggle(ch);
        myBuy[ch - 24] = on ? 1 : 0;
        if (c?.kind === 'lists') {
          totSum += (on ? 1 : -1) * value(it(c.line, ch - 23 + 7));
          d.setField('MYINPUT', String(totSum));
        }
      },
    },
    60: {
      mouseDown: () => d.press(),
      mouseUp() {
        finish(cal, { answers: myBuy.map((x) => x > 0) });
      },
    },
    // 61: Lists (the mayor's budget)
    61: {
      exitFrame() {
        const c = cur();
        if (g.enter === 0 && c?.kind === 'lists') {
          d.setField('MYINPUT', '');
          totSum = 0;
          g.enter = 1;
          cal.puppets(18, 31, true);
          d.setField('CurFDBK1', fieldText(cal, it(c.line, 5)));
          const n = value(it(c.line, 6));
          setChecks(cal, 24, n);
          myBuy = Array(n).fill(0);
        }
        okWhen(myBuy.some((x) => x > 0));
        d.go(d.frame);
      },
    },
    62: {
      mouseDown: () => d.press(),
      mouseUp() {
        finish(cal, { projects: myBuy.map((x) => x > 0) });
      },
    },
    // 24: Extra (the election result)
    24: {
      exitFrame() {
        const c = cur();
        if (g.enter === 0 && c?.kind === 'extra') {
          g.enter = 1;
          for (const ch of [18, 19, 20, 21]) d.puppetSprite(ch, true);
          d.setField('ExName', `${cal.s.name.first} ${cal.s.name.last}`.trim());
          cal.setCastName(18, `extra${c.n}`);
          for (let ch = 18; ch <= 21; ch++) cal.up(ch);
          cal.hand(20);
        }
        d.go(d.frame);
      },
    },
    63: {
      mouseDown: () => d.press(),
      mouseUp() {
        finish(cal, true);
      },
    },
    // 265: NHelp (a neighbour asks for help)
    265: {
      exitFrame() {
        const c = cur();
        if (g.enter === 0 && c?.kind === 'nhelp') {
          for (let ch = 20; ch <= 23; ch++) d.puppetSprite(ch, true);
          d.setField('CurFDBK', `${d.field('MyHelp')}It will take ${c.days} days. Will you help me?`);
          cal.setCastName(20, cal.s.date.year < 1887 ? 'DBox1' : 'DBox19');
          for (let ch = 20; ch <= 23; ch++) cal.up(ch);
          cal.hand(22, 23);
          g.enter = 1;
        }
        d.go(d.frame);
      },
    },
    145: {
      mouseDown: () => d.press(),
      mouseUp() {
        finish(cal, { yes: d.clickOn === 22 });
      },
    },
    // 295: Eog (end of the game: new game / exit)
    295: {
      exitFrame() {
        if (g.enter === 0) {
          g.enter = 1;
          d.cursor(0);
          d.puppetSprite(17, false);
          d.puppetSprite(34, false);
          for (const ch of [22, 25]) {
            d.puppetSprite(ch, true);
            cal.hand(ch);
          }
        }
        for (const ch of [22, 25]) {
          const base = d.castNumber(`Menu${ch - 20}`);
          d.setCast(ch, d.rollOver(ch) ? base + 1 : base);
        }
        d.go(d.frame);
      },
    },
    296: {
      mouseUp() {
        const ch = d.clickOn;
        d.cursorOff();
        d.puppetSprite(22, false);
        d.puppetSprite(25, false);
        const r = cal.dlg.resolve;
        cal.dlg.cur = null;
        cal.dlg.resolve = null;
        r?.((ch === 22 ? 'new' : 'exit') as never);
      },
    },
  };
}

/** the event prompt currently shown (for eventTextId) */
function promptOf(cal: Calend): Extract<Prompt, { kind: 'event' }> {
  const p = cal.s.pending;
  if (p?.kind === 'event') return p;
  return { kind: 'event', line: Math.max(0, cal.s.globals.mainLine - 1), stage: 'main' };
}

export function makePresenter(cal: Calend): Presenter {
  const live = () => cal.alive;
  const presenter: Presenter = {
    async info(s, e) {
      if (!live()) return;
      if (e.id === 'MyGoal') return; // the goal is set silently (ScoreScript 57)
      let t = fieldText(cal, e.id);
      if (e.id === 'SEG69' && e.params?.total !== undefined) t = `${t}\r\r${numberToCurrency(Number(e.params.total))}`;
      await modal(cal, 'Mes', { kind: 'mes', text: t, dbox: e.dbox ?? (s.date.year <= 1887 ? 'DBox1' : 'DBox19') });
    },

    async prompt(s, p): Promise<Command> {
      if (!live()) return askPrompt(s, p);
      switch (p.kind) {
        case 'message': {
          if (p.text === 'Extra1' || p.text === 'Extra2') {
            await modal(cal, 'Extra', { kind: 'extra', n: p.text === 'Extra1' ? 1 : 2 });
            return { type: 'ack' };
          }
          // the sim's openMail always raises TakeMail; a direct mailbox click (95) skips it
          if (p.text === 'TakeMail' && cal.c.g.x.silentTakeMail) return { type: 'ack' };
          if (p.text === 'TakeMail' || p.text === 'T623') cal.syncFields();
          await modal(cal, 'Mes', { kind: 'mes', text: fieldText(cal, p.text), dbox: p.dbox || 'DBox0' });
          return { type: 'ack' };
        }
        case 'neighborHelp': {
          const r = await modal<{ yes: boolean }>(cal, 'NHelp', { kind: 'nhelp', days: p.days });
          return { type: 'answerNeighborHelp', yes: r.yes };
        }
        case 'politicianLetter':
          await modal(cal, 'DL1', { kind: 'dl1', level: p.level });
          return { type: 'resolveEvent', choice: {} };
        case 'goalChoice': {
          const r = await modal<{ option: number }>(cal, 'May', { kind: 'may', text: p.text, answers: p.answers });
          return { type: 'resolveEvent', choice: { option: Math.max(1, r.option) } };
        }
        case 'event':
          return eventPrompt(cal, s, p);
        default:
          return askPrompt(s, p);
      }
    },

    async townTalk(id) {
      const c = cal.c;
      const path = c.state?.globals.tTalkPath || 'TTalk1';
      try {
        const mod = (await import('../movies/ttalk.ts')) as unknown as Record<string, unknown>;
        const play = mod.playTownTalk as ((cc: typeof c, id: number, path: string) => Promise<void>) | undefined;
        if (typeof play === 'function') {
          csound.stop(1);
          await play(c, id, path);
          if (c.state) await c.goMovie('CALEND', 'Start');
          return;
        }
      } catch (e) {
        console.warn('classic: TTALK unavailable', e);
      }
      await showTownTalk(id);
    },

    async gameOver(st) {
      const c = cal.c;
      if (!live()) {
        // the board was reloaded (e.g. after the final town talk): hand over to the live one
        const p = game.presenter;
        if (p?.gameOver && p !== presenter) return p.gameOver(st);
        return;
      }
      cal.buildPic();
      const r = await modal<'new' | 'exit'>(cal, 'Eog', { kind: 'eog' });
      if (r === 'new') {
        c.g.x.afterEog = 'intro';
        c.g.runningMode = 'newGame';
      } else c.g.x.afterEog = 'exit'; // halt(): back to the game's main menu (see LOGIN)
    },
  };
  return presenter;
}


async function eventPrompt(cal: Calend, s: GameState, p: Extract<Prompt, { kind: 'event' }>): Promise<Command> {
  const line = s.events[p.line];
  const type = value(it(line, 4));
  const tid = eventTextId(s, p);
  const ev = (choice: object): Command => ({ type: 'resolveEvent', choice });
  switch (type) {
    case 1: {
      void csound.playFile(2, 'DATA\\SOUND\\TOWNMAP\\Baby.WAV');
      const r = await modal<{ name: string }>(cal, 'Dec1', { kind: 'dec1', line, input: 1, button: 1 });
      return ev({ name: (r.name ?? '').trim() || 'Baby' });
    }
    case 2: {
      const r = await modal<{ cancel?: boolean; amount?: number }>(cal, 'DL', { kind: 'dl', line, input: 1 });
      return r.cancel ? ev({ cancel: true }) : ev({ amount: r.amount ?? 0 });
    }
    case 3: {
      const r = await modal<{ yes: boolean }>(cal, 'Dec1', { kind: 'dec1', line, input: 2, button: 0 });
      return ev({ yes: r.yes });
    }
    case 15: {
      const r = await modal<{ yes: boolean }>(cal, 'Dec1', { kind: 'dec1', line, input: 2, button: 1 });
      return ev({ yes: r.yes });
    }
    case 4: {
      if (p.stage === 'main') {
        await modal(cal, 'Doc', { kind: 'mes', text: fieldText(cal, tid), dbox: 'DBox11' });
        return ev({});
      }
      const r = await modal<{ items?: boolean[]; cancel?: boolean }>(cal, 'Doc1', { kind: 'doc1' });
      return r.cancel ? ev({ cancel: true }) : ev({ items: r.items ?? [] });
    }
    case 5:
      await modal(cal, 'Mes', { kind: 'mes', text: fieldText(cal, tid), dbox: it(line, 6) });
      return ev({});
    case 6: {
      const r = await modal<{ yes: boolean }>(cal, 'DL', { kind: 'dl', line, input: 3 });
      return ev({ yes: r.yes });
    }
    case 7:
      await modal(cal, 'DL', { kind: 'dl', line, input: 2 });
      return ev({});
    case 9: {
      const r = await modal<{ answers: boolean[] }>(cal, 'MayM', { kind: 'maym' });
      return ev({ answers: r.answers });
    }
    case 10: {
      await modal(cal, 'Wed', { kind: 'wed', line });
      const r = await modal<{ option?: number; cancel?: boolean }>(cal, 'Wed1', { kind: 'wed1', line });
      return r.cancel || !r.option ? ev({ cancel: true }) : ev({ option: r.option });
    }
    case 11: {
      const r = await modal<{ projects: boolean[] }>(cal, 'Lists', { kind: 'lists', line });
      return ev({ projects: r.projects ?? [] });
    }
    default:
      await modal(cal, 'Mes', { kind: 'mes', text: fieldText(cal, tid), dbox: 'DBox0' });
      return ev({});
  }
}
