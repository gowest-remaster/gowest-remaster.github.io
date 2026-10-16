// Ports of the SHARED house scripts used by HOUSE1/HOUSE2/HOUSE3 (and the unused BHOUSE1):
//   - entry + upgrade offer (ScoreScript 3234 Begin, 3251 Choice) — the offer itself is the sim's
//     `houseOffer` prompt, shown here with the house's own dialog sprites 4..7
//   - house init / main loop / location bar (3243 "11", 3241 "9", 3277 GoOutfromLoc)
//   - hotspots: logbook (3238 "6"), album (3239 "7"), savings box (3240 "8"), newspapers (3268)
//   - logbook (MovieScript 3222 PutLog/Table, 3244/3246/3250/3252/3253/3248/3254-3256/3260)
//   - savings box (3223 Save1, 3224/3225/3227/3228/3229/3230/3231/3232/3233/3235/3258/3259/3261/3262)
// Spec: docs/spec/04-home-album.md §1–§4, 01-framework §6.4–6.7.
// Rules (prices, savings, logbook rows, the upgrade) come from the sim via game.run.
import type { Command, GameState, Prompt } from '../../../sim/index.ts';
import { game } from '../../../engine/game.ts';
import { askPrompt } from '../../../ui/prompts.ts';
import { text } from '../../../game/text.ts';
import type { ClassicContext, MovieModule, MovieName } from '../context.ts';
import type { ScriptTable } from '../dir/player.ts';
import { HAND } from '../dir/player.ts';
import { line, lines, numberToCurrency, value } from '../dir/lingo.ts';
import { quirk, castDate, edPlayBgMusic, edRollOver, edStopBgMusic, sharedScripts, syncMoney } from './common.ts';

export type HouseNo = 1 | 2 | 3;

// ------------------------------------------------------------------ AllNotes (logbook notes)
// Field "AllNotes" (SHARED 3063) is saved with the bookmark in the original; the sim does not
// model it, so the Classic edition keeps it per profile in localStorage.
function notesKey() {
  return `gowest.classic.allnotes.${game.profile?.id ?? 'anon'}`;
}

export function loadAllNotes(): string[] {
  try {
    const raw = localStorage.getItem(notesKey());
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    /* unavailable */
  }
  return [];
}

function saveAllNotes(a: string[]) {
  try {
    localStorage.setItem(notesKey(), JSON.stringify(a));
  } catch {
    /* unavailable */
  }
}

/** Movie name for g_WhatHouse (`go(1, "House" & g_WhatHouse)`). */
export function houseMovie(wh: number): MovieName {
  return wh >= 3 ? 'HOUSE3' : wh === 2 ? 'HOUSE2' : 'HOUSE1';
}

/** `GoOutfromLoc`: g_Marker = clickOn - 20. */
export function goOutFromLoc(c: ClassicContext, marker: number) {
  const d = c.d;
  c.g.marker = marker;
  d.cursorOff();
  d.cursor(4);
  edStopBgMusic(c);
  const map = () => {
    if (c.g.mmapSound) d.puppetSound(c.g.mmapSound);
  };
  const year = c.state?.date.year ?? 1880;
  switch (marker) {
    case 1:
      map();
      return c.goMovie('FIELD');
    case 2:
      return c.goMovie('BANK09');
    case 3:
      return c.goMovie('STORE');
    case 4:
      map();
      return c.goMovie('TSTREET1', year < 1890 ? 'S1' : 'S2');
    case 5:
      map();
      return c.goMovie('CALEND', 'Start');
  }
}

const newsOpen = (s: GameState | null) => !!s && (s.date.year > 1880 || (s.date.year === 1880 && s.date.mon > 7));

/**
 * One house movie. `no` is g_WhatHouse for the movie (BHOUSE1 behaves like HOUSE1).
 */
export function makeHouse(c: ClassicContext, no: HouseNo, movie: MovieName): MovieModule {
  const d = c.d;
  const g = c.g;
  const st = () => c.state!;
  // logbook globals
  const lb = { lines: 1, set: 1, numbSet: 0, flagH: 0, flag2: 0 };
  // savings box: g_SaveInOut
  let saveInOut = 1;
  // pending upgrade answer (Choice.ls)
  let choose: ((yes: boolean) => void) | null = null;
  let entryChecked = false;

  const save = () => st().propet.savings;

  // HOUSE1: the cooking stove (Propet 11.4) shows sprite 2
  const ovenSprite = () => {
    if (no === 1 && !d.sprite(2).puppet) {
      d.puppetSprite(2, true);
      if (st().propet.stove === 1 && d.sprite(2).locV > 1000) d.setLocV(2, d.sprite(2).locV - 1000);
    }
  };

  // ---------------------------------------------------------------- logbook
  const logLines = () => st().logbook.map((e) => `${e.date},${e.year},${e.loc},${e.act},${e.cost},${e.income},${e.total}`);

  /** Table(): fill the 3 rows of page g_set. */
  const table = () => {
    const all = [' ', ...logLines()];
    const gpLines = all.length;
    const last = lb.numbSet === 0 || lb.set === lb.numbSet ? gpLines : 2 + (lb.set - 1) * 3 + 3 - 1;
    const notes = loadAllNotes();
    const actions = d.field('Actions');
    const color = no === 1 ? 237 : no === 2 ? 243 : 240;
    let x = 0;
    for (let j = 2 + (lb.set - 1) * 3; j <= last; j++) {
      x++;
      const ln = all[j - 1].split(',');
      d.setField(`DateT${x}`, `${ln[0]} , ${ln[1]}`);
      d.setFieldStyle(`DateT${x}`, 'Times New Roman', 14, 'Bold');
      d.setCast(x + 9, d.castNumber('BankLoc') + value(ln[2]) - 1);
      d.setField(`ActT${x}`, line(actions, value(ln[3])));
      d.setFieldStyle(`ActT${x}`, 'Times New Roman', 14, 'Bold');
      d.setField(`ExpT${x}`, numberToCurrency(value(ln[4])));
      d.setFieldStyle(`ExpT${x}`, 'Times New Roman', 14, 'Bold');
      d.setLoc(18 + x, 298, 200 + 62 * (x - 1));
      d.setField(`IncT${x}`, numberToCurrency(value(ln[5])));
      d.setFieldStyle(`IncT${x}`, 'Times New Roman', 14, 'Bold');
      d.setLoc(27 + x, 359, 200 + 62 * (x - 1));
      d.setField(`TotT${x}`, numberToCurrency(value(ln[6])));
      d.setFieldStyle(`TotT${x}`, 'Times New Roman', 14, 'Bold');
      d.setLoc(30 + x, 423, 200 + 62 * (x - 1));
      for (const i of [6, 9, 12, 15]) if (d.sprite(x + i).locV > 1000) d.setLocV(x + i, d.sprite(x + i).locV - 1000);
      const k0 = (j - 2) * 3;
      d.setField(`NotesT${x}`, [notes[k0] ?? '', notes[k0 + 1] ?? '', notes[k0 + 2] ?? ''].join('\r'));
      d.setFieldStyle(`NotesT${x}`, 'Arial', 12, 'Plain');
      d.sprite(x + 21).fore = 255;
      d.sprite(x + 21).back = color;
      d.setVisible(x + 21, true);
      d.setEditable(x + 21, true);
    }
    lb.flagH = 0;
  };

  const putLog = () => {
    d.cursorOff();
    d.setVisible(25, false);
    d.setVisible(26, false);
    for (let i = 22; i <= 24; i++) {
      d.setVisible(i, false);
      d.setEditable(i, false);
    }
    table();
  };

  /** Save the 3 visible note fields back into AllNotes (page g_set). */
  const saveNotes = () => {
    const notes = loadAllNotes();
    const base = (lb.set - 1) * 3 * 3;
    for (let i = 1; i <= 3; i++) {
      const ls = lines(d.field(`NotesT${i}`));
      for (let j = 1; j <= 3; j++) notes[base + 3 * (i - 1) + j - 1] = ls[j - 1] ?? '';
    }
    for (let k = 0; k < notes.length; k++) if (notes[k] === undefined || notes[k] === null) notes[k] = '';
    saveAllNotes(notes);
  };

  const pageTurn = (delta: number) => {
    d.setVisible(27, false);
    d.puppetSound('Econom12');
    saveNotes();
    lb.set += delta;
    for (let x = 1; x <= 3; x++)
      for (const i of [6, 9, 12, 15, 18, 27, 30]) if (d.sprite(x + i).locV < 1000) d.setLocV(x + i, d.sprite(x + i).locV + 1000);
    putLog();
  };

  const noteFocus = (ch: number) => {
    for (let i = 22; i <= 24; i++) d.setEditable(i, false);
    d.setEditable(ch, true);
    d.focus = ch;
  };

  // ---------------------------------------------------------------- savings
  const boxEmptySprite = () => {
    if (save() > 0 && d.sprite(3).visible) d.setVisible(3, false);
    else if (save() === 0 && !d.sprite(3).visible) d.setVisible(3, true);
  };

  /** "You have $X" into line 1 of a field. */
  const youHave = (field: string) => {
    const ls = lines(d.field(field));
    ls[0] = `You have ${numberToCurrency(save())}`;
    d.setField(field, ls.join('\r'));
  };

  const pressOk = async (deposit: boolean) => {
    const amt = value(d.field('InOut'));
    if (!(amt > 0)) return;
    d.setCursor(13, 0);
    d.setCursor(14, 0);
    const ok = deposit ? st().propet.cash >= amt : save() >= amt;
    if (!ok) {
      d.go('No');
      return;
    }
    await c.run(deposit ? { type: 'depositSavings', amount: amt } : { type: 'withdrawSavings', amount: amt });
    syncMoney(c);
    d.focus = 0;
    d.go('Save1');
  };

  // ---------------------------------------------------------------- scripts
  const scripts: ScriptTable = {
    ...sharedScripts(c),
    // Begin.ls: upgrade check on entry (frame 2)
    3234: {
      async exitFrame() {
        g.retFromE = 'House';
        ovenSprite();
        if (!entryChecked) {
          entryChecked = true;
          // the sim decides whether the offer applies (and raises the houseOffer prompt)
          await c.run({ type: 'enterHouse' });
          syncMoney(c);
          const wh = st().globals.whatHouse;
          if (wh !== no && movie !== 'BHOUSE1') {
            void c.goMovie(houseMovie(wh), 1);
            d.go(d.frame);
            return;
          }
        }
        d.cursor(0);
        d.go(d.frame + 1);
      },
    },
    // Choice.ls: Yes (sprite 6) / No (sprite 7)
    3251: {
      mouseDown() {
        d.press();
      },
      mouseUp() {
        g.enter = 0;
        for (let i = 4; i <= 7; i++) {
          if (d.sprite(i).locV < 1000) d.setLocV(i, d.sprite(i).locV + 1000);
          d.puppetSprite(i, false);
        }
        d.cursorOff();
        const yes = d.clickOn === 6;
        if (!yes && no === 1) d.setVisible(12, true);
        const f = choose;
        choose = null;
        f?.(yes);
      },
    },
    // 11.ls: house init (label "House")
    3243: {
      exitFrame() {
        d.setCursor(9, 0);
        ovenSprite();
        g.mode = 0;
        g.enter = 0;
        g.retFromE = 'House';
        for (let i = 20; i <= 32; i++) d.puppetSprite(i, true);
        for (let i = 45; i <= 47; i++) d.puppetSprite(i, true);
        d.puppetSprite(14, true);
        d.setVisible(14, false);
        d.cursor(0);
        d.puppetSprite(3, false);
        d.setVisible(3, true);
        d.setCursor(3, HAND);
        d.focus = 0;
      },
    },
    // 9.ls: main loop
    3241: {
      exitFrame() {
        const s = st();
        const news = newsOpen(s);
        if (g.enter === 0) {
          g.enter = 1;
          // CursorOn(g_cursor): HOUSE1 lists sprite 3, HOUSE2/3 list the empty sprite 4 (quirk)
          const list = [no === 1 || !quirk(c, 'CURSORON') ? 3 : 4, 9, 10, 11, 12, ...(news ? [13] : [])];
          for (const ch of list) if (d.sprite(ch).member) d.setCursor(ch, HAND);
        }
        const bar = d.sprite(20).locV;
        if (d.mouseV > 421 && bar > 1000) {
          for (let i = 20; i <= 27; i++) {
            if (d.sprite(i).locV > 1000) d.setLocV(i, d.sprite(i).locV - 1000);
            if (i !== 20) d.setCursor(i, HAND);
          }
        } else if (d.mouseV < 422 && bar < 1000) {
          for (let i = 20; i <= 27; i++) {
            d.setLocV(i, d.sprite(i).locV + 1000);
            d.setCursor(i, 0);
          }
        }
        if (news) edRollOver(c, [9, 10, 11, 12, 13], [27, 64, 63, 66, 65], 14);
        else edRollOver(c, [9, 10, 11, 12], [27, 64, 63, 66], 14);
        d.go(d.frame);
      },
    },
    // 10.ls "Evit": leftover location jump by g_Marker
    3242: {
      exitFrame() {
        const m = typeof g.marker === 'number' ? g.marker : 0;
        if (m >= 1 && m <= 5) void goOutFromLoc(c, m === 4 ? 4 : m);
      },
    },
    // GoOutfromLoc: the location bar
    3277: {
      mouseDown() {
        d.press();
      },
      mouseUp() {
        void goOutFromLoc(c, d.clickOn - 20);
      },
    },
    // GotoNews
    3268: {
      mouseUp() {
        if (g.mode !== 0) return;
        if (newsOpen(c.state)) {
          d.cursorOff();
          void c.goMovie('NEWS', `News${st().globals.whatHouse}`);
        }
      },
    },
    // 6.ls: open the logbook
    3238: {
      mouseUp() {
        if (g.mode !== 0) return;
        d.cursorOff();
        d.cursor(4);
        d.puppetSprite(2, false);
        for (let i = 7; i <= 33; i++) d.puppetSprite(i, false);
        lb.lines = st().logbook.length + 1;
        lb.flagH = 0;
        lb.numbSet = Math.ceil((lb.lines - 1) / 3);
        lb.set = lb.numbSet;
        lb.flag2 = 1;
        for (let i = 1; i <= 3; i++) d.setField(`NotesT${i}`, ' ');
        d.go('LogBook');
      },
    },
    // 7.ls: family album
    3239: {
      mouseUp() {
        if (g.mode !== 0) return;
        d.cursorOff();
        d.cursor(4);
        d.puppetSprite(14, false);
        void c.goMovie('ALBUM', 1);
      },
    },
    // 8.ls: savings box
    3240: {
      mouseUp() {
        if (g.mode !== 0) return;
        d.cursorOff();
        d.puppetSprite(14, false);
        d.puppetSprite(3, false);
        for (let i = 20; i <= 32; i++) d.puppetSprite(i, true);
        d.go('Save');
      },
    },
    // ------------------------------------------------ logbook
    // 12.ls (logbook entry frame in HOUSE2/HOUSE3)
    3244: {
      exitFrame() {
        for (let i = 1; i <= 38; i++) d.setVisible(i, true);
        d.cursorOff();
        d.setVisible(27, false);
        lb.flag2 = 1;
        for (let i = 1; i <= 3; i++) d.setField(`NotesT${i}`, ' ');
      },
    },
    // 14.ls
    3246: {
      exitFrame() {
        for (let i = 7; i <= 24; i++) {
          d.setVisible(i, true);
          d.puppetSprite(i, true);
        }
        for (let i = 27; i <= 33; i++) {
          d.setVisible(i, true);
          d.puppetSprite(i, true);
        }
        for (let i = 22; i <= 24; i++) d.setVisible(i, false);
        d.setVisible(25, false);
        d.setVisible(26, false);
        lb.flagH = 0;
      },
    },
    // 2.ls: logbook loop
    3250: {
      exitFrame() {
        if (lb.flag2 === 1 && lb.lines > 1) {
          putLog();
          lb.flag2 = 0;
        }
        if (lb.flagH === 0) {
          d.cursor(0);
          if (lb.lines < 5) {
            d.setVisible(25, false);
            d.setVisible(26, false);
          } else if (lb.numbSet > 0 && lb.set === 1) {
            d.setVisible(25, true);
            d.setCursor(25, HAND);
          } else if (lb.numbSet > 0 && lb.set > lb.numbSet - 1) {
            d.setVisible(26, true);
            d.setCursor(26, HAND);
          } else {
            d.setVisible(25, true);
            d.setVisible(26, true);
            d.setCursor(25, HAND);
            d.setCursor(26, HAND);
          }
          d.setCursor(5, HAND);
          lb.flagH = 1;
        }
        edRollOver(c, [25, 26], [67, 79], 27);
        d.go(d.frame);
      },
    },
    // 4.ls / 5.ls: next / previous page (two script variants exist)
    3252: { mouseDown: () => d.press(), mouseUp: () => pageTurn(+1) },
    3236: { mouseDown: () => d.press(), mouseUp: () => pageTurn(+1) },
    3253: { mouseDown: () => d.press(), mouseUp: () => pageTurn(-1) },
    3237: { mouseDown: () => d.press(), mouseUp: () => pageTurn(-1) },
    // 16.ls: close the logbook (saves the notes)
    3248: {
      mouseDown() {
        d.press();
      },
      mouseUp() {
        d.cursorOff();
        saveNotes();
        for (let i = 1; i <= 21; i++) if (!d.sprite(i).visible) d.setVisible(i, true);
        for (let i = 7; i <= 33; i++) d.puppetSprite(i, false);
        for (let i = 18; i <= 32; i++) d.setVisible(i, true);
        for (let i = 22; i <= 24; i++) d.setEditable(i, false);
        d.focus = 0;
        d.go('House');
      },
    },
    // 42.ls / Log5: the bottom strip leaves without saving the visible notes (quirk)
    3260: {
      mouseUp() {
        if (!quirk(c, 'LOGNOTES')) saveNotes();
        d.cursorOff();
        for (let i = 22; i <= 24; i++) d.setEditable(i, false);
        d.focus = 0;
        d.go('House');
      },
    },
    3267: {
      mouseUp() {
        d.cursorOff();
        d.focus = 0;
        d.go('House');
      },
    },
    // 19/20/21.ls: only the clicked notes field is editable
    3254: { mouseUp: () => noteFocus(22) },
    3255: { mouseUp: () => noteFocus(23) },
    3256: { mouseUp: () => noteFocus(24) },
    // 15.ls
    3247: { mouseDown: () => d.press() },
    // ------------------------------------------------ savings box
    // 33.ls: opening animation starts
    3262: {
      exitFrame() {
        d.puppetSound('Econom40');
        d.setField('InOut', '');
        if (save() > 0) d.setVisible(3, false);
      },
    },
    // 41.ls
    3261: {
      exitFrame() {
        d.puppetSprite(8, true);
        d.puppetSprite(2, false);
      },
    },
    // Save1.ls
    3223: {
      exitFrame() {
        boxEmptySprite();
        for (let i = 5; i <= 7; i++) if (!d.sprite(i).cursor) d.setCursor(i, HAND);
        d.setVisible(4, true);
        d.setCursor(4, HAND);
        edRollOver(c, [5, 6], [75, 76], 8);
        d.go(d.frame);
      },
    },
    // PressIn / PressOut
    3224: {
      mouseUp() {
        for (let i = 3; i <= 5; i++) d.setCursor(i, 0);
        saveInOut = 1;
        youHave('PutIn');
        d.setField('InOut', '');
        d.puppetSprite(8, false);
        d.setVisible(8, true);
        d.go('In');
      },
    },
    3225: {
      mouseUp() {
        for (let i = 3; i <= 5; i++) d.setCursor(i, 0);
        saveInOut = 2;
        youHave('TakeOut');
        d.setField('InOut', '');
        d.puppetSprite(8, false);
        d.setVisible(8, true);
        d.go('Out');
      },
    },
    // pressReturn: close the box
    3227: {
      mouseDown() {
        d.press();
      },
      mouseUp() {
        d.cursorOff();
        d.puppetSprite(8, false);
        ovenSprite();
        d.focus = 0;
        d.go('Close');
      },
    },
    // InOut.ls: In / Out dialog loop
    3228: {
      exitFrame() {
        boxEmptySprite();
        for (let i = 3; i <= 6; i++) d.setCursor(i, 0);
        for (const i of [13, 14]) if (!d.sprite(i).cursor) d.setCursor(i, HAND);
        if (d.focus !== 11) {
          d.setEditable(11, true);
          d.focus = 11;
        }
        d.go(d.frame);
      },
    },
    // InfoNo.ls: "not enough money"
    3229: {
      exitFrame() {
        boxEmptySprite();
        if (!d.sprite(14).cursor) d.setCursor(14, HAND);
        d.focus = 0;
        d.go(d.frame);
      },
    },
    // InputText.ls: digits, "." and Backspace only
    3230: {
      keyDown(key) {
        return /^[0-9.]$/.test(key) || key === 'Backspace';
      },
    },
    // PressCancel
    3231: {
      mouseDown() {
        d.press();
      },
      mouseUp() {
        d.setCursor(13, 0);
        d.setCursor(14, 0);
        d.focus = 0;
        d.go('Save1');
      },
    },
    // PressOk1 (put in) / PressOk2 (take out)
    3232: { mouseDown: () => d.press(), mouseUp: () => pressOk(true) },
    3233: { mouseDown: () => d.press(), mouseUp: () => pressOk(false) },
    // PressOk3: back from "not enough money"
    3235: {
      mouseDown() {
        d.press();
      },
      mouseUp() {
        d.setCursor(14, 0);
        d.go(saveInOut === 1 ? 'In' : saveInOut === 3 ? 'Save' : 'Out');
      },
    },
    // 38.ls / 39.ls: closing animation
    3258: { exitFrame: () => d.go('House') },
    3259: { exitFrame: () => d.puppetSound('Econom15') },
    // hint close button (dead help mode): press only
    47: { mouseDown: () => d.press() },
  };
  if (no === 3) {
    scripts[4] = { exitFrame: () => d.go(d.frame + 1) };
    scripts[5] = { exitFrame: () => d.go('House') };
  }

  const askOffer = (p: Extract<Prompt, { kind: 'houseOffer' }>): Promise<Command> => {
    d.setField('NewHouse', d.field(p.text));
    if (no === 1) d.setVisible(12, false);
    for (let i = 4; i <= 7; i++) {
      d.puppetSprite(i, true);
      if (d.sprite(i).locV > 1000) d.setLocV(i, d.sprite(i).locV - 1000);
    }
    d.cursor(0);
    d.setCursor(6, HAND);
    d.setCursor(7, HAND);
    return new Promise((resolve) => {
      choose = (yes) => resolve({ type: 'answerHouseOffer', yes });
    });
  };

  return {
    scripts,
    startFrame: 1,
    startMovie() {
      // MovieScript 1: GP1.MID, CASTDATE; HOUSE3 only calls CASTDATE (no music: quirk kept)
      d.cursor(4);
      if (no !== 3 || !quirk(c, 'HOUSE3MUSIC')) {
        d.puppetSound(0);
        g.enter = 0;
        edPlayBgMusic(c, 'GP1');
      }
      castDate(c);
      syncMoney(c, false);
    },
    presenter: {
      async prompt(s, p) {
        if (p.kind === 'houseOffer') return askOffer(p);
        // anything else falls back to the shared dialogs
        return askPrompt(s, p);
      },
      async info(_s, e) {
        // the sim's own check agrees with ours; show the house's "not enough money" frame
        if (e.id === 'NotEnoughMoneyBox') d.go('No');
        else await c.alert(text(e.id));
      },
    },
    view: { sync: () => syncMoney(c) },
  };
}
