// TSTREET1: Main Street (decompiled/lingo/TSTREET1, spec 03-town.md §1). Ported script by
// script; the rules (dealer count, grain quote and sale, businesses, the 1909 claim) come from
// the sim: enterTown, grainQuote, sellGrain, buyBusiness, buyClaim.
import type { MovieFactory, ClassicContext } from '../context.ts';
import type { Presenter } from '../../../engine/game.ts';
import { game } from '../../../engine/game.ts';
import { claimAvailable, grainQuote, reproduces, type QuirkId } from '../../../sim/index.ts';
import { BUSINESSES } from '../../../sim/data/tables.ts';
import { text } from '../../../game/text.ts';
import { HAND } from '../dir/player.ts';
import { csound } from '../dir/sound.ts';
import { lines, numberToCurrency, value } from '../dir/lingo.ts';
import { sharedScripts, syncMoney } from '../shared/common.ts';
import { down, goTo, hasHouse, playFile, townFields, up, type Destination } from './../town/common.ts';

// field "Dealers": y0, y1, idx, local sounds (1 dealer), local sounds (2 dealers)
const DEALERS: [number, number, number, number, number, number, number, number, number][] = [
  [1880, 1880, -2, 700, 702, 0, 0, 0, 0],
  [1881, 1885, -3, 700, 706, 0, 0, 0, 0],
  [1886, 1886, -3, 700, 706, 0, 713, 714, 715],
  [1887, 1890, 1, 707, 708, 0, 707, 712, 716],
  [1891, 1893, -30, 700, 706, 0, 713, 714, 715],
  [1894, 1894, 4, 700, 706, 0, 713, 714, 715],
  [1895, 1914, 10, 700, 706, 0, 713, 714, 715],
  [1915, 1920, 3, 709, 706, 0, 711, 712, 715],
];
const SND = (n: number) => `DATA\\SOUND\\TSTREET\\${n}.WAV`;
const HINT_SPRITES = [16, 17, 18, 4, 19, 5, 6, 7, 8];

const factory: MovieFactory = (c: ClassicContext) => {
  const d = c.d;
  const g = c.g;
  // movie globals
  let dealers = 1;
  let maxPic = 4;
  let whatPic = 'D1';
  let str = 'Str1';
  let sprite = 0; // g_Sprite: the For-Sale sign on show
  let blink = 0;
  let blinkAt = 0;
  let line = 0; // g_Line
  let curDeal = 1;
  let contin = 0;
  let sell = 0;
  let pic = 0; // g_i
  let sound: string | null = null; // g_sound (greeting)
  let okSound: string | null = null;
  let cansSound: string | null = null;
  let msgDone: (() => void) | null = null;
  const st = () => c.state!;
  const q = (id: QuirkId) => reproduces(st().fidelity, id);

  const owned = (k: number) => st().propet.business[k - 1] > 0;

  /** Message box (sprites 41-43: DBox0 or Deal2 + CurFDBK + OK), as ScoreScript 10/9 show it. */
  const showBox = (body: string, box = 'DBox0') =>
    new Promise<void>((resolve) => {
      d.cursorOff();
      g.mode = 1;
      d.setField('CurFDBK', body);
      for (const ch of [41, 42, 43]) d.puppetSprite(ch, true);
      d.setCast(41, box);
      for (const ch of [41, 42, 43]) up(c, ch);
      d.setCursor(43, HAND);
      msgDone = resolve;
    });

  /** DelSetup (MovieScript 12): fill the deal table from the sim's quote. */
  const delSetup = () => {
    const s = st();
    const year = s.date.year;
    const row = DEALERS.find((r) => year >= r[0] && year <= r[1]) ?? DEALERS[DEALERS.length - 1];
    // STRIKESND: in Jun-Aug 1894 the original skips this, so stale or no lines play
    if (!(year === 1894 && s.date.mon > 5 && s.date.mon < 9) || !q('STRIKESND')) {
      const o = 3 * (dealers - 1);
      sound = row[3 + o] ? SND(row[3 + o]) : null;
      okSound = row[4 + o] ? SND(row[4 + o]) : null;
      cansSound = row[5 + o] ? SND(row[5 + o]) : null;
    }
    const qt = grainQuote(s);
    qt.bushels.forEach((b, i) => d.setField(`B${i + 1}`, String(b)));
    for (let i = 0; i < 3; i++) d.setField(`PT${i + 1}`, numberToCurrency(qt.prices[i]));
    // PT4: corn's price kept as a string, truncated to 4 chars (classic); to the cent when fixed
    const p4 = String(Math.round(qt.prices[3] * 100) / 100);
    if (q('PT4')) d.setField('PT4', p4.length === 3 ? `$${p4}0` : p4.length > 4 ? `$${p4.slice(0, 4)}` : `$${p4}`);
    else d.setField('PT4', numberToCurrency(qt.prices[3]));
    qt.bushels.forEach((b, i) => d.setField(`P${i + 1}`, numberToCurrency(b * qt.prices[i])));
    d.setField('TotalPrice', numberToCurrency(qt.localTotal));
    for (const f of ['B1', 'B2', 'B3', 'B4', 'PT1', 'PT2', 'PT3', 'PT4', 'P1', 'P2', 'P3', 'P4', 'TotalPrice']) d.setFieldStyle(f, 'Times New Roman', 14, 'Plain');
    return qt;
  };

  /** ScoreScript 10: the elevator (18) or the O'Grady hauler (4). */
  const clickDealer = async () => {
    if (g.mode !== 0) return;
    const click = d.clickOn;
    g.mode = 1;
    g.enter = 0;
    pic = 0;
    d.cursorOff();
    const dealer = click === 18 ? 'local' : 'ogrady';
    const r = game.peek({ type: 'sellGrain', dealer });
    if (r && r.events.some((e) => e.type === 'dialog')) {
      // "nothing to sell" / 1894 strike: the sim's side effects + its message box
      await game.apply(r);
      return;
    }
    d.cursor(4);
    const qt = delSetup();
    if (click === 18) {
      curDeal = 1;
    } else {
      curDeal = 2;
      const year = st().date.year;
      sound = SND(year === 1886 ? 703 : year > 1886 && year < 1915 ? 718 : 719);
      okSound = SND(717);
      cansSound = SND(705);
      d.setField('Deal2', d.field('Deal2').replace(/^[^\r\n]*/, `The O'Grady grain elevator is offering ${qt.bonusCents} cents`));
      const ls = lines(d.field('Deal2'));
      ls[2] = `I will haul your crops to O'Grady for ${numberToCurrency(qt.haul)}. `;
      d.setField('Deal2', ls.join('\r'));
    }
    for (let i = 23; i <= 43; i++) d.puppetSprite(i, false);
    if (sound) void playFile(sound, 1);
    contin = 0;
    d.go('Deal');
  };

  /** ScoreScript 8: a For-Sale sign (5..8) or the LAND FOR FREE sign (9). */
  const clickSign = () => {
    if (g.mode !== 0) return;
    line = d.clickOn - 4;
    d.setField('Price', line < 5 ? String(BUSINESSES[line - 1].price) : '');
    g.mode = 1;
    // sale("S" & g_Line) (MovieScript 7)
    d.cursorOff();
    d.setCast(10, line < 5 ? `S${line}` : 'S5');
    let list: number[];
    if (line < 5) list = [10, 11, 14, 15];
    else {
      d.setField('Date', d.field('CurrentDate'));
      list = [12, 14, 15, 37, 38];
    }
    for (const ch of list) d.setLocV(ch, d.sprite(ch).locV - 1000);
    d.setCursor(14, HAND);
    d.setCursor(15, HAND);
  };

  /** ScoreScript 9: OK (14) / X (15) on a sale sign. */
  const saleButton = async () => {
    g.mode = 0;
    g.enter = 0;
    const click = d.clickOn;
    d.cursorOff();
    for (let ch = 10; ch <= 15; ch++) down(c, ch);
    for (let ch = 37; ch <= 39; ch++) down(c, ch);
    if (click !== 14) return;
    const price = line < 5 ? BUSINESSES[line - 1].price : 20;
    if (st().propet.cash >= price) {
      await c.run(line < 5 ? { type: 'buyBusiness', business: line } : { type: 'buyClaim' });
      if (line !== 5 && sprite > 0) sprite = 0;
      d.setLocV(line + 4, d.sprite(line + 4).locV + 1000);
      syncMoney(c);
    } else {
      await showBox(d.field('NoM'));
    }
  };

  /** MovieScript 16 `hint` (the mouseUpScript while "?" is on). */
  const hint = () => {
    const click = d.clickOn;
    if (d.sprite(click).cursor !== 'question') return;
    const i = HINT_SPRITES.indexOf(click);
    if (i < 0) return;
    d.cursorOff();
    const hints = d.field('Hints');
    const idx = lines(hints)[0].split(',').map((x) => value(x));
    const beg = idx[2 * i];
    const end = idx[2 * i + 1];
    d.setField('CurFDBK', lines(hints).slice(beg - 1, end).join('\r'));
    for (const ch of [41, 42, 43]) up(c, ch);
    d.setCursor(43, HAND);
    for (const ch of HINT_SPRITES) if (d.sprite(ch).locV < 1000) d.setCursor(ch, 'question');
  };

  const nav = (where: Destination) => {
    d.cursorOff();
    d.cursor(4);
    goTo(c, where);
  };

  const presenter: Partial<Presenter> = {
    async info(_s, e) {
      if (e.id === 'NoSale' || e.id === 'No1894' || e.id === 'NoM') {
        await showBox(d.field(e.id) || text(e.id), e.id === 'No1894' ? 'Deal2' : 'DBox0');
        return;
      }
      await c.alert(text(e.id));
    },
  };

  return {
    startFrame: 'S1',
    presenter,
    async startMovie() {
      const s = c.state;
      if (!s) return;
      await c.run({ type: 'enterTown' });
      dealers = c.state?.sessions.town?.dealers ?? 1;
      townFields(c);
    },
    update() {
      syncMoney(c);
    },
    scripts: {
      ...sharedScripts(c),
      // S1/S2 init
      2: {
        exitFrame() {
          const s = st();
          // STREETERA fixed: always pick the street by year (the go(1,"TStreet1") exits show S1)
          const want = s.date.year < 1890 ? 'S1' : 'S2';
          if (!q('STREETERA') && d.frame !== d.labelFrame(want)) {
            d.go(want);
            return;
          }
          townFields(c);
          for (let i = 1; i <= 18; i++) d.puppetSprite(i, true);
          for (let i = 26; i <= 43; i++) if (i !== 39 && i !== 40) d.puppetSprite(i, true);
          g.mode = 0;
          g.enter = 0;
          blink = 0;
          const { year, mon } = s.date;
          if (year > 1884 || (year === 1884 && mon > 5)) d.setLocV(2, d.sprite(2).locV - 1000);
          if (year < 1890) {
            d.spriteBox(16, 10, 153, 10 + 125, 153 + 170);
            d.spriteBox(17, 144, 137, 144 + 118, 137 + 181);
            d.spriteBox(18, 331, 149, 331 + 65, 149 + 161);
            maxPic = 4;
            str = 'Str1';
          } else {
            d.spriteBox(16, 88, 97, 88 + 40, 97 + 167);
            d.spriteBox(17, 130, 71, 130 + 40, 71 + 190);
            d.spriteBox(18, 176, 18, 176 + 90, 18 + 186);
            maxPic = 8;
            str = 'Str2';
          }
          g.retFromE = str;
          if (dealers === 2) {
            whatPic = year < 1890 ? 'D1' : 'D2';
            up(c, 3);
            up(c, 4);
          }
          sprite = 0;
          // the sign channel of the current window (5..8), shown while that business is unowned
          const win = [1895, 1900, 1904, 1909].findIndex((y0) => (year === y0 && mon > 3) || (year === y0 + 1 && mon < 4));
          if (win >= 0) {
            sprite = win + 5;
            if (win === 3 && claimAvailable(s)) up(c, 9);
          }
          if (sprite > 0 && !owned(sprite - 4)) up(c, sprite);
          d.startTimer();
          blinkAt = 0;
        },
      },
      // Str1/Str2 main loop
      3: {
        exitFrame() {
          const s = st();
          if (g.enter === 0) {
            g.enter = 1;
            for (let i = 23; i <= 38; i++) if (i !== 25 && !d.sprite(i).puppet) d.puppetSprite(i, true);
            for (let i = 41; i <= 43; i++) d.puppetSprite(i, true);
            d.cursor(0);
            if (dealers === 2) d.setCursor(4, HAND);
            for (let i = 16; i <= 18; i++) d.setCursor(i, HAND);
            if (sprite > 0 && !owned(sprite - 4)) d.setCursor(sprite, HAND);
            // CLAIMCURSOR: the original's cursor test disagrees with the sign's window
            if (q('CLAIMCURSOR') ? s.date.year === 1909 && s.date.mon > 3 && s.propet.numFields === 1 : claimAvailable(s)) d.setCursor(9, HAND);
            d.setCursor(19, HAND);
          }
          const bar = [26, 27, 29, 30, 31];
          if (d.mouseV > 421 && d.sprite(26).locV > 1000 && g.mode === 0) {
            for (const i of bar) {
              d.setLocV(i, d.sprite(i).locV - 1000);
              if (i !== 26) d.setCursor(i, HAND);
            }
            if (hasHouse(c)) {
              d.setLocV(28, d.sprite(28).locV - 1000);
              d.setCursor(28, HAND);
            }
          } else if ((d.mouseV < 422 || g.mode === 1) && d.sprite(26).locV < 1000) {
            for (const i of bar) {
              d.setLocV(i, d.sprite(i).locV + 1000);
              d.setCursor(i, 0);
            }
            if (hasHouse(c)) {
              d.setLocV(28, d.sprite(28).locV + 1000);
              d.setCursor(28, 0);
            }
          }
          // the For-Sale sign blinks 8 times (every 20 ticks), then stays
          if (sprite > 0 && !owned(sprite - 4)) {
            if (blink < 8) {
              if (d.timer >= 20 || blinkAt === 0) {
                blinkAt = 1;
                const sp = d.sprite(sprite);
                d.setLocV(sprite, sp.locV > 1000 ? sp.locV - 1000 : sp.locV + 1000);
                blink++;
                d.startTimer();
              }
            } else if (d.sprite(sprite).locV > 1000) d.setLocV(sprite, d.sprite(sprite).locV - 1000);
          }
          d.go(d.frame);
        },
      },
      // store / bank hotspots
      11: {
        mouseUp() {
          if (g.mode !== 0) return;
          csound.stop(1);
          nav('Store');
        },
      },
      15: {
        mouseUp() {
          if (g.mode !== 0) return;
          csound.stop(1);
          nav('Bank09');
        },
      },
      10: { mouseUp: clickDealer },
      // OK on the message box
      13: {
        mouseDown: () => d.press(),
        mouseUp() {
          g.enter = 0;
          g.mode = 0;
          d.cursorOff();
          for (const ch of [41, 42, 43]) d.setLocV(ch, d.sprite(ch).locV + 1000);
          const f = msgDone;
          msgDone = null;
          f?.();
        },
      },
      // Deal frame loop
      14: {
        async exitFrame() {
          if (g.enter === 0) {
            g.enter = 1;
            for (let i = 23; i <= 42; i++) d.puppetSprite(i, true);
            let list: number[];
            let curs: number[];
            if (curDeal === 1) {
              list = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 40, 41, 42, 47];
              curs = [40, 41, 42, 47];
              d.puppetSprite(47, true);
            } else {
              list = [38, 39, 41, 42];
              curs = [4, 41, 42];
            }
            // sell(list, curs) (MovieScript 17)
            d.cursorOff();
            for (const ch of list) up(c, ch);
            for (const ch of curs) d.setCursor(ch, HAND);
            d.cursor(0);
          }
          if (curDeal === 2 && csound.busy(1)) {
            pic++;
            if (pic === maxPic) pic = 0;
            const m = d.castNumber(whatPic);
            if (m) d.setCast(4, m + pic);
          }
          // a click while the dealer talks stops him (mouseUpScript "sound stop 1")
          if (contin === 1 && d.mouseDown) csound.stop(1);
          if (contin === 0 || csound.busy(1)) {
            d.go(d.frame);
            return;
          }
          g.enter = 0;
          for (let i = 23; i <= 43; i++) if (d.sprite(i).puppet) d.puppetSprite(i, false);
          d.puppetSprite(46, false);
          d.puppetSprite(47, false);
          if (curDeal === 2) d.setCast(4, whatPic);
          contin = 2;
          if (sell > 0) {
            await c.run({ type: 'sellGrain', dealer: curDeal === 1 ? 'local' : 'ogrady' });
            syncMoney(c);
          }
          d.go(str);
        },
      },
      // OK (41) / X (42) on the deal
      18: {
        mouseDown: () => d.press(),
        mouseUp() {
          if (contin !== 0) return;
          d.cursorOff();
          contin = 1;
          g.mode = 0;
          sell = 0;
          csound.stop(1);
          if (d.clickOn === 41) {
            sell = 1;
            if (okSound) void playFile(okSound, 1);
          } else if (cansSound) void playFile(cansSound, 1);
        },
      },
      // "?" hint mode
      19: {
        mouseUp() {
          if (g.mode !== 0) return;
          g.enter = 0;
          d.cursorOff();
          d.go('Ques');
        },
      },
      20: {
        exitFrame() {
          if (g.enter === 0) {
            d.cursorOff();
            for (let i = 41; i <= 43; i++) if (!d.sprite(i).puppet) d.puppetSprite(i, true);
            g.enter = 1;
            d.setCast(31, 'Red');
            d.setCursor(31, HAND);
            for (const ch of HINT_SPRITES) if (d.sprite(ch).locV < 1000 && d.sprite(ch).member) d.setCursor(ch, 'question');
          }
          d.go(d.frame);
        },
      },
      21: {
        mouseDown: () => d.press(),
        mouseUp() {
          for (const ch of [41, 42, 43]) down(c, ch);
          g.enter = 0;
        },
      },
      22: {
        mouseDown() {
          if (d.clickOn === 43) d.press();
        },
        mouseUp() {
          hint();
          d.cursorOff();
          for (const ch of [41, 42, 43]) if (d.sprite(ch).puppet) d.puppetSprite(ch, false);
          for (const ch of [41, 42, 43]) down(c, ch);
          g.enter = 0;
          d.setCast(31, 'Green');
          d.go(str);
        },
      },
      23: { mouseUp: hint },
      // location bar
      25: {
        mouseDown: () => d.press(),
        mouseUp() {
          const marker = d.clickOn - 26;
          g.marker = marker;
          d.cursorOff();
          d.cursor(4);
          if (marker === 1) nav('Field');
          else if (marker === 2) {
            g.enter = 0;
            nav('House');
          } else if (marker === 4) nav('Bank09');
          else if (marker === 5) nav('Store');
          else if (marker === 3) nav('Calend');
        },
      },
      // click the O'Grady hauler on the deal screen: his greeting again
      26: {
        mouseUp() {
          if (sound) void playFile(sound, 1);
        },
      },
      8: { mouseUp: clickSign },
      9: { mouseDown: () => d.press(), mouseUp: saleButton },
    },
  };
};

export default factory;
