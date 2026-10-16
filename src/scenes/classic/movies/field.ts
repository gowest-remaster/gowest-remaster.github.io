// FIELD (plow / plant / harvest), ported from decompiled/lingo/FIELD/casts/Internal/*.ls
// (spec docs/spec/02-farm-sim.md §5). Handlers are keyed by the original script castIds
// (ScoreScript N). Presentation follows the Lingo; the rules come from the sim: a job is
// dry-run with `game.peek`, its events are animated square by square in the original frames
// (PField1/2, S1P1-3, HField1/2, SH), and the very same result is then committed with
// `game.apply`, whose dialogs this movie's presenter shows in the FIELD dialog frames.
import type { MovieFactory, ClassicContext } from '../context.ts';
import type { Handlers, ScriptTable } from '../dir/player.ts';
import { HAND } from '../dir/player.ts';
import { csound } from '../dir/sound.ts';
import { numberToCurrency, YEAR_GB, YEAR_MON } from '../dir/lingo.ts';
import { castDate, edRollOver, quirk, sharedScripts, syncMoney } from '../shared/common.ts';
import { game } from '../../../engine/game.ts';
import { FieldController } from '../../controllers/field.ts';
import { mySpeed as simSpeed, type Command, type Crop, type GameState, type SimEvent } from '../../../sim/index.ts';

/** Seed-marker positions per square of a field (MovieScript 1 g_LocH / g_LocV). */
const LOC_H = [202 + 20, 392 + 20, 222 + 20, 350 + 40, 240 + 20, 351 + 20, 254 + 20, 345 + 20];
const LOC_V = [311 + 20, 305 + 20, 216 + 20, 211 + 20, 162 + 10, 162 + 10, 125 + 10, 125 + 10];
const SEASON = [4, 5, 9, 10];

const factory: MovieFactory = (c: ClassicContext) => {
  const d = c.d;
  const g = c.g;
  const ctrl = new FieldController();
  const S = (): GameState => game.state!;

  // ---------------------------------------------------------------- Lingo globals (local mirror)
  let curField = 1; // g_CurField
  let numbFields = 1;
  let plow: number[] = []; // g_Plow (16, 0-based)
  let plant: number[] = [];
  let harv: number[] = [];
  let plantNow = new Array<number>(16).fill(0); // g_PlantNow
  let numPlowed = 0;
  let numPlanted = 0;
  let numHarved = 0;
  let wintSum = 0;
  let mon = 4;
  let day = 1;
  let year = 1880;
  let tractor = 0;
  let speed = 6; // g_Speed
  let mySpeedV = 6; // g_MySpeed
  let allWor: [number, number, number] = [0, 0, 0]; // g_AllWor workers, neighbours, family
  let numbWor1 = 1;
  let neib = 0; // g_Neib
  let maxFam = 1;
  let wage = 5; // g_PriceWok1
  let plowNow = 0; // squares marked this job
  let whatIDo = 1; // 1 plow, 2 harvest
  let fMark = 'Field';
  let stopTrac = 0;
  let okFlag = 0; // g_OK
  let noPlant = 0;
  let seas = 4; // g_Seas
  let seeds: number[] = [0, 0, 0, 0];
  let copy: { plant: number[]; num: number; seeds: number[] } | null = null;
  let hintOn = false; // the mouseUpScript is "hint"
  let flowBusy = false;
  /** dialogs already shown during an animated job (the presenter skips them) */
  const consumed: string[] = [];
  let okResolve: (() => void) | null = null;
  let choose = 1; // g_MyChoose

  const waitOk = () => new Promise<void>((r) => (okResolve = r));
  const finishOk = () => {
    const r = okResolve;
    okResolve = null;
    r?.();
  };

  function refresh() {
    const s = S();
    const cs = s.cursit;
    plow = [...cs.plow];
    plant = [...cs.plant];
    harv = [...cs.harv];
    numPlowed = cs.numPlowed;
    numPlanted = cs.numPlanted;
    numHarved = cs.numHarved;
    wintSum = cs.wintSum;
    mon = s.date.mon;
    day = s.date.day;
    year = s.date.year;
    tractor = s.propet.tractors;
    numbFields = s.propet.numFields;
    maxFam = s.propet.familyWorkers;
    seeds = [...s.propet.seeds];
    const sess = ctrl.session();
    neib = sess.neighbors;
    wage = sess.wage;
    if (curField > numbFields) curField = 1;
  }

  const sq = (i: number) => i - 8 * (curField - 1); // absolute 1-based square -> field square
  const range = () => Array.from({ length: 8 }, (_, k) => k + 1 + 8 * (curField - 1));

  /** MovieScript 95 `MyField`: the square art for the current field. */
  function myField() {
    const art = (crop: number) => ctrl.cropArt(crop as Crop);
    const set = (i: number, name: string) => d.setCast(sq(i) + 9, `${name}${sq(i)}`);
    if (SEASON.includes(mon)) {
      if (numHarved > 0) {
        for (const i of range()) {
          const h = harv[i - 1];
          let n: string;
          if (h === 15 || wintSum === 1) n = 'Frost';
          else if (h >= 1 && h <= 4) n = art(h);
          else if (h === 12) n = 'Drou';
          else n = wintSum === 1 ? 'Frost' : 'Grass';
          set(i, n);
        }
      } else {
        for (const i of range()) {
          let n: string;
          if (plant[i - 1] > 0 && plantNow[i - 1] === 0) n = 'Sprout';
          else if (plow[i - 1] === 1) n = 'Plow';
          else if (harv[i - 1] === 13) n = 'Burn';
          else n = wintSum === 1 ? 'Frost' : 'Grass';
          set(i, n);
        }
      }
    } else if (mon === 6 || mon === 11) {
      for (const i of range()) set(i, plant[i - 1] > 0 ? 'Sprout' : plow[i - 1] === 1 ? 'Plow' : wintSum === 1 ? 'Frost' : 'Grass');
    } else if (wintSum === 1) {
      for (const i of range()) set(i, 'Frost');
    } else if (numPlanted > 0) {
      for (const i of range()) set(i, plant[i - 1] > 0 && plantNow[i - 1] === 0 ? 'Sprout' : 'Grass');
    } else {
      for (const i of range()) set(i, plant[i - 1] === 13 ? 'Burn' : plant[i - 1] === 14 ? 'Bot' : 'Grass');
    }
    d.updateStage();
  }

  /** FIELD `NewDate` (30-day months, the year never changes). */
  function newDate(days: number): [number, number] {
    const monNow = mon + Math.trunc((days + day - 1) / 30);
    let daysNow = day + days <= 30 ? day + days : day + days - Math.trunc((days + day) / 30) * 30;
    if (daysNow === 0) daysNow = 30;
    return [monNow, daysNow];
  }

  /** MovieScript 35 `Table`: estimate fields for n squares. */
  function table(n: number, fld: string) {
    if (n > 0) {
      const t = Math.max(1, n * mySpeedV);
      d.setField(fld, t === 1 ? `${t} day` : `${t} days`);
      const [mn, dn] = newDate(t);
      d.setField('DateFin', `${YEAR_MON[(mn - 1) % 12]}  ${dn}, ${year}`);
      d.setField('PriceWor', allWor[0] > 0 ? `$${allWor[0] * wage * t}` : ' ');
    } else {
      d.setField('AcresPl', ' ');
      d.setField(fld, ' ');
      d.setField('DateFin', ' ');
      d.setField('PriceWor', ' ');
    }
  }
  const retable = () => (whatIDo === 1 ? table(plowNow, 'PlowTime') : table(numHarved, 'HarvTime'));

  /** MovieScript 16 `GoAndWork`. */
  function goAndWork() {
    numbWor1 = 1;
    for (const f of ['NumWork', 'AcresPl', 'PlowTime', 'DateFin', 'PriceWor', 'HarvTime']) d.setField(f, ' ');
    allWor = [0, 0, 0];
    speed = tractor === 0 ? 6 : 2;
    mySpeedV = speed;
  }

  /** The F1/F2 sign (sprite 35) for two claims. */
  function sign() {
    if (numbFields === 2) {
      if (curField === 1) {
        d.setLoc(35, 55, 145);
        d.setCast(35, 'F1');
      } else {
        d.setLoc(35, 550, 168);
        d.setCast(35, 'F2');
      }
      d.setCursor(35, HAND);
    } else d.setCursor(35, 0);
  }

  const showAll = (to = 41, except?: number) => {
    for (let i = 1; i <= to; i++) if (i !== except && !d.sprite(i).visible) d.setVisible(i, true);
  };

  function setDateFields(m: number, dd: number, y: number) {
    d.setField('LocDate', [YEAR_GB[m - 1], String(dd), String(y)].join('\r'));
  }

  /** helpers panel arrows (ScoreScripts 17/18/23/24/53/54) */
  function helperArrow(k: 0 | 1 | 2, delta: number): Handlers {
    return {
      mouseDown: () => d.press(),
      mouseUp() {
        const max = k === 0 ? 5 : k === 1 ? neib : maxFam;
        let v = allWor[k] + delta;
        if (v < 0) v = max;
        if (v > max) v = 0;
        allWor[k] = v;
        numbWor1 = allWor[0] + allWor[1] + allWor[2] + 1;
        d.setField('NumWork', allWor[0] > 0 ? String(allWor[0]) : ' ');
        d.setField(['Wor', 'Neib', 'MyFamily'][k], String(v));
        mySpeedV = Math.trunc(speed / numbWor1);
        retable();
      },
    };
  }

  // ---------------------------------------------------------------- hints (MovieScript 49)
  const HINT_LIST = [4, 5, 6];
  function hint(click: number) {
    if (d.sprite(click).cursor === 'question') {
      const idx = HINT_LIST.indexOf(click);
      d.cursorOff();
      const hints = d.field('Hints').replace(/\r\n?|\n/g, '\r').split('\r');
      const head = hints[0].split(',').map(Number);
      const beg = head[2 * idx];
      const end = head[2 * idx + 1];
      d.setField('QText', hints.slice(beg - 1, end).join('\r'));
      for (let i = 43; i <= 45; i++) if (d.sprite(i).locV > 1000) d.setLocV(i, d.sprite(i).locV - 1000);
      d.setCursor(27, HAND);
      for (const i of HINT_LIST) if (d.sprite(i).locV < 1000) d.setCursor(i, 'question');
      d.setCursor(45, HAND);
    } else if (click === 45) {
      d.cursorOff();
      for (const i of HINT_LIST) if (d.sprite(i).locV < 1000) d.setCursor(i, 'question');
      d.setCursor(27, HAND);
      for (let i = 43; i <= 45; i++) if (d.sprite(i).locV < 1000) d.setLocV(i, d.sprite(i).locV + 1000);
    }
  }
  const hintFirst = () => {
    if (hintOn) hint(d.clickOn);
  };

  // ---------------------------------------------------------------- dialog frames
  const neibArt = () => (year <= 1887 ? 'NeibY' : 'NeibO');

  /** Frame "No" (ScoreScript 3): a neighbour's message, OK (15) back to M1. */
  async function showNo(text: string) {
    d.setField('CurFDBK', text);
    g.enter = 0;
    d.go('No');
    d.start();
    await waitOk();
  }

  /** Frame "NoPlant" (ScoreScript 47/36). */
  async function showNoPlant(code: number) {
    noPlant = code;
    d.go('NoPlant');
    d.start();
    await waitOk();
  }

  /** Field text by name (FIELD cast first, then SHARED), as `put field X into field "CurFDBK"`. */
  const fld = (id: string) => (d.member(id) ? d.field(id) : id);

  const ticks = (n: number) => d.delay((n * 1000) / 60);

  function setCashField(cash: number) {
    const t = numberToCurrency(Math.max(0, cash));
    if (d.field('MyCash') !== t) void csound.playFile(2, 'DATA\\SOUND\\TOWNMAP\\Mo1.WAV');
    d.setField('MyCash', t);
  }

  // ---------------------------------------------------------------- plowing (SS19 + PlowGoes)
  async function runPlow() {
    const marked = plow.map((v, i) => (v === 2 ? i + 1 : 0)).filter(Boolean);
    const helpers = { workers: allWor[0], neighbors: allWor[1], family: allWor[2] };
    const base: Command = { type: 'plow', squares: marked, helpers };
    let r = game.peek({ ...base, plowBreakChoice: 'newSteel' } as Command);
    if (!r) return;
    if (r.events.some((e) => e.type === 'rejected') && !r.events.some((e) => e.type === 'dateChanged')) {
      // nothing to plow after all: just show what the sim said
      await game.apply(r);
      return;
    }
    flowBusy = true;
    d.stop();
    g.enter = 0;
    // Pl1 (SS20)
    d.go('Pl1');
    d.setCast(1, 'Field1');
    d.setLocV(35, 1000);
    showAll();
    curField = marked[0] > 8 ? 2 : 1;
    if (curField === 2) d.setCast(1, 'Field2');
    myField();
    d.go(curField === 2 ? 'PField2' : 'PField1');
    for (let i = 10; i <= 17; i++) d.puppetSprite(i, true);
    const initialSpeed = simSpeed(tractor, helpers);
    let spd = Math.max(0, initialSpeed);
    const plowEvents = r.events.filter((e) => e.type === 'dateChanged' && e.reason === 'plow').length;
    const nSquares = initialSpeed < 1 ? plowEvents - 1 : plowEvents;
    let done = 0;
    let stopped = false;
    for (let k = 0; k < r.events.length; k++) {
      const e: SimEvent = r.events[k];
      if (e.type === 'dateChanged' && (e.reason === 'plow' || e.reason === 'plowRepair')) {
        mon = e.mon;
        day = e.day;
        setDateFields(e.mon, e.day, e.year);
        if (e.reason === 'plow' && done < nSquares && !stopped) {
          const i = marked[done];
          if (i > 8 && curField === 1) {
            curField = 2;
            d.setCast(1, 'Field2');
            myField();
            d.go('PField2');
          }
          plow[i - 1] = 1;
          d.setCast(sq(i) + 9, `Plow${sq(i)}`);
          done++;
          d.updateStage();
          await ticks(10 + 5 * spd);
        }
      } else if (e.type === 'cash') {
        setCashField(e.cash);
      } else if (e.type === 'dialog') {
        if (e.id === 'StopPlow1' || e.id === 'StopPlow2') {
          consumed.push(e.id);
          stopped = true;
          // S1P1 (SS26): the rest of the land is lost for this season
          for (let q = 0; q < 16; q++) if (plow[q] !== 1) plow[q] = mon === 10 ? 15 : 0;
          d.setField('CurFDBK', fld(e.id));
          d.go('S1P1');
          myField();
          d.setVisible(36, true);
          d.setCursor(38, HAND);
          await waitOk();
        } else if (e.id === 'StopPlow3') {
          consumed.push(e.id);
          // S1P2 (SS28): the plow broke; choose new steel (1) or repair (2)
          choose = 1;
          d.setField('FDBK', fld('StopPlow3'));
          d.go('S1P2');
          await d.delay(0);
          d.setVisible(36, true);
          for (const ch of [38, 39, 40]) d.setCursor(ch, HAND);
          d.puppetSprite(39, true);
          d.puppetSprite(40, true);
          d.setCast(39, 'YesE');
          d.setCast(40, 'NoE');
          const cash = S().propet.cash;
          for (;;) {
            await waitOk();
            if (choose === 1 && cash - 50 >= 0) break;
            if (choose === 2) break;
            // SS27: no cash for new steel: show NoMoney, then the choice again
            if (d.field('FDBK') !== d.field('NoMoney')) {
              d.setField('FDBK', d.field('NoMoney'));
              d.setVisible(39, false);
              d.setVisible(40, false);
              d.setCursor(39, 0);
              d.setCursor(40, 0);
            } else {
              d.setVisible(39, true);
              d.setVisible(40, true);
              d.setCursor(39, HAND);
              d.setCursor(40, HAND);
              d.setField('FDBK', fld('StopPlow3'));
            }
          }
          d.puppetSprite(39, false);
          d.puppetSprite(40, false);
          if (choose === 2) {
            const r2 = game.peek({ ...base, plowBreakChoice: 'repair' } as Command);
            if (r2) r = r2; // same prefix (deterministic sim), different continuation
          }
          d.go(curField === 2 ? 'PField2' : 'PField1');
        } else if (e.id === 'NoMoney') {
          consumed.push(e.id);
        } else if (e.id === 'StopPlow4') {
          consumed.push(e.id);
          spd *= 2;
          d.setField('CurFDBK', fld('StopPlow4'));
          d.go('S1P3');
          d.setVisible(36, true);
          d.setCursor(38, HAND);
          await waitOk();
          d.go(curField === 2 ? 'PField2' : 'PField1');
        }
      }
    }
    // Pla (SS31): restore, then the sim result is committed and FDBK7 shown
    d.cursorOff();
    showAll();
    d.setLocH(35, 1000);
    await game.apply(r);
    refresh();
    myField();
    flowBusy = false;
    g.enter = 0;
    d.go('M1');
    d.start();
  }

  // ---------------------------------------------------------------- harvesting (SS56 + HarvGoes)
  async function runHarvest() {
    const helpers = { workers: allWor[0], neighbors: allWor[1], family: allWor[2] };
    const r = game.peek({ type: 'harvest', helpers });
    if (!r) return;
    if (!r.events.some((e) => e.type === 'harvest')) {
      // refused by the rules (e.g. workers that cannot be paid): the message, then back to M1
      await game.apply(r);
      refresh();
      myField();
      return;
    }
    flowBusy = true;
    d.stop();
    // Hv (SS66)
    d.go('Hv');
    showAll();
    const squares = harv.map((v, i) => (v > 0 && v < 10 ? i + 1 : 0)).filter(Boolean);
    curField = squares[0] > 8 ? 2 : 1;
    if (curField === 2) {
      d.setCast(1, 'Field2');
      myField();
    }
    d.go(curField === 2 ? 'HField2' : 'HField1');
    for (let i = 10; i <= 17; i++) d.puppetSprite(i, true);
    const initialSpeed = simSpeed(tractor, helpers);
    const hEvents = r.events.filter((e) => e.type === 'dateChanged' && e.reason === 'harvest').length;
    const nSquares = initialSpeed < 1 ? hEvents - 1 : hEvents;
    let done = 0;
    for (const e of r.events) {
      if (e.type === 'dateChanged' && e.reason === 'harvest') {
        mon = e.mon;
        day = e.day;
        setDateFields(e.mon, e.day, e.year);
        if (done < nSquares) {
          const i = squares[done];
          if (i > 8 && curField === 1) {
            curField = 2;
            d.setCast(1, 'Field2');
            myField();
            d.go('HField2');
          }
          d.setCast(sq(i) + 9, `Bot${sq(i)}`);
          done++;
          d.updateStage();
          await ticks(20);
        }
      } else if (e.type === 'cash') {
        setCashField(e.cash);
      } else if (e.type === 'dialog' && (e.id === 'StopHarv1' || e.id === 'StopHarv2')) {
        consumed.push(e.id);
        // SH (SS72): the rest of the crop is lost (frost in October, else gone)
        d.setField('CurFDBK', fld(e.id));
        g.enter = 0;
        d.go('SH');
        for (const i of range()) {
          if (!squares.slice(done).includes(i)) continue;
          d.setCast(sq(i) + 9, `${mon === 10 ? 'Frost' : 'Grass'}${sq(i)}`);
        }
        sign();
        d.setCursor(30, HAND);
        await waitOk();
        break;
      }
    }
    await game.apply(r);
    refresh();
    myField();
    flowBusy = false;
    g.enter = 0;
    d.go('M1');
    d.start();
  }

  // ---------------------------------------------------------------- scripts
  const scripts: ScriptTable = {
    ...sharedScripts(c),
    // 2: Workers button -> helpers panel
    2: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.cursorOff();
        d.puppetSprite(33, false);
        d.setField('Wor', String(allWor[0]));
        d.setField('Neib', String(allWor[1]));
        d.setField('MyFamily', String(allWor[2]));
        d.go(d.frame + 1);
      },
    },
    // 3: frame "No"
    3: {
      enterFrame() {
        if (g.enter === 0) {
          g.enter = 1;
          for (const ch of [28, 29, 30]) d.puppetSprite(ch, true);
          d.setCast(28, neibArt());
          for (const ch of [28, 29, 30]) if (d.sprite(ch).locV > 1000) d.setLocV(ch, d.sprite(ch).locV - 1000);
          sign();
          d.setCursor(30, HAND);
          d.setCursor(31, HAND);
        }
      },
      exitFrame: () => d.go(d.frame),
    },
    // 4: helpers panel Cancel
    4: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.cursorOff();
        g.enter = 0;
        for (const ch of [37, 38, 39]) d.setVisible(ch, false);
        for (let i = 43; i <= 46; i++) d.puppetSprite(i, false);
        d.puppetSprite(36, false);
        for (const i of range()) if (plow[i - 1] !== 1) d.setCursor(sq(i) + 9, HAND);
        d.setCursor(34, HAND);
        numbWor1 = 1;
        allWor = [0, 0, 0];
        speed = tractor === 0 ? 6 : 2;
        mySpeedV = speed;
        retable();
        d.setField('NumWork', '');
        d.setVisible(33, false);
        d.go(fMark);
      },
    },
    // 5: helpers panel loop
    5: {
      exitFrame() {
        if (!d.sprite(37).visible) {
          d.puppetSprite(36, true);
          for (const ch of [37, 38, 39]) d.setVisible(ch, true);
          d.setCursor(34, HAND);
          for (let i = 36; i <= 42; i++) d.setCursor(i, HAND);
          d.setCursor(48, HAND);
        }
        d.go(d.frame);
      },
    },
    // 6: Plow button
    6: {
      mouseUp() {
        hintFirst();
        if (g.mode !== 0) return;
        d.cursorOff();
        g.enter = 0;
        fMark = 'Field';
        d.setVisible(48, false);
        d.puppetSprite(48, false);
        for (let i = 20; i <= 31; i++) d.puppetSprite(i, false);
        for (let i = 43; i <= 46; i++) d.puppetSprite(i, false);
        d.puppetSprite(33, false);
        const blocked = ctrl.check('plow');
        if (blocked) {
          void game.apply(blocked);
          return;
        }
        for (const ch of [7, 8, 33]) d.setVisible(ch, false);
        for (let i = 18; i <= 25; i++) d.setVisible(i, false);
        for (const ch of [37, 38, 39]) d.setVisible(ch, false);
        whatIDo = 1;
        okFlag = 0;
        goAndWork();
        plowNow = 0;
        d.setField('MyFamily', String(S().propet.familyWorkers));
        d.go('Field');
      },
    },
    // 7: click a square to mark/unmark it (SQUARE)
    7: {
      mouseUp() {
        if (stopTrac !== 0) return;
        const click = d.clickOn;
        const i = click - 9 + 8 * (curField - 1);
        if (plow[i - 1] === 0) {
          d.setVisible(click + 8, true);
          numPlowed++;
          plowNow++;
          plow[i - 1] = 2;
        } else if (plow[i - 1] === 2) {
          d.setVisible(click + 8, false);
          plowNow--;
          numPlowed--;
          plow[i - 1] = 0;
        } else return;
        d.setField('AcresPl', plowNow > 0 ? String(plowNow * 20) : ' ');
        table(plowNow, 'PlowTime');
      },
    },
    // 8: frame "Field" (choosing squares)
    8: {
      exitFrame() {
        if (plowNow > 0 && okFlag === 0) {
          okFlag = 1;
          if (!d.sprite(37).visible) {
            d.setVisible(33, true);
            d.setCursor(33, HAND);
          }
          for (const i of range()) if (plow[i - 1] === 2) d.setVisible(sq(i) + 17, true);
        } else if (plowNow === 0 && okFlag === 1) {
          okFlag = 0;
          d.setVisible(33, false);
          d.setCursor(33, 0);
        }
        if (g.enter === 0) {
          stopTrac = 0;
          g.enter = 1;
          for (let i = 18; i <= 25; i++) d.setVisible(i, false);
          for (const i of range()) if (plow[i - 1] === 2) d.setVisible(sq(i) + 17, true);
          d.puppetSprite(32, false);
          d.setVisible(tractor === 0 ? 7 : 8, true);
          d.setCursor(36, HAND);
          sign();
          table(plowNow, 'PlowTime');
          if (!d.sprite(37).visible) for (const i of range()) if (plow[i - 1] !== 1) d.setCursor(sq(i) + 9, HAND);
          d.setCursor(34, HAND);
          okFlag = 0;
        }
        d.go(d.frame);
      },
    },
    // 9: helpers panel OK
    9: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.cursorOff();
        g.enter = 0;
        for (const ch of [37, 38, 39]) d.setVisible(ch, false);
        for (let i = 43; i <= 46; i++) d.puppetSprite(i, false);
        d.puppetSprite(36, false);
        for (const i of range()) if (plow[i - 1] !== 1) d.setCursor(sq(i) + 9, HAND);
        d.setCursor(34, HAND);
        retable();
        d.setVisible(33, false);
        d.go(fMark);
      },
    },
    // 10: the main field view (m1)
    10: {
      enterFrame() {
        if (g.enter === 0) {
          d.puppetSprite(35, true);
          g.enter = 1;
          for (let i = 43; i <= 46; i++) d.puppetSprite(i, true);
          showAll();
          d.puppetSprite(32, false);
          sign();
          for (const ch of [4, 5, 6, 7]) d.setCursor(ch, HAND);
          syncMoney(c, false);
          castDate(c);
        }
      },
      exitFrame() {
        edRollOver(c, [4, 5, 6], [40, 41, 42], 48);
        if (!d.sprite(20).puppet) {
          for (let i = 20; i <= 27; i++) d.puppetSprite(i, true);
          d.puppetSprite(33, true);
        }
        const house = S().propet.house > 0;
        if (d.mouseV > 421 && d.sprite(20).locV > 1000) {
          for (const i of [20, 21, 22, 24, 25, 26, 27]) {
            d.setLocV(i, d.sprite(i).locV - 1000);
            if (i !== 20 && g.mode === 0) d.setCursor(i, HAND);
          }
          if (house) {
            d.setLocV(23, d.sprite(23).locV - 1000);
            d.setCursor(23, HAND);
          }
        } else if (d.mouseV < 422 && d.sprite(20).locV < 1000 && g.mode === 0) {
          for (const i of [20, 21, 22, 24, 25, 26, 27]) {
            d.setLocV(i, d.sprite(i).locV + 1000);
            d.setCursor(i, 0);
          }
          if (house) {
            d.setLocV(23, d.sprite(23).locV + 1000);
            d.setCursor(23, 0);
          }
        }
        d.go(d.frame);
      },
    },
    // 11: MMenu init (once per entry)
    11: {
      exitFrame() {
        g.retFromE = 'M1';
        g.enter = 0;
        g.mode = 0;
        curField = 1;
        d.puppetSprite(35, true);
        d.setVisible(48, false);
        d.puppetSprite(1, true);
        for (let i = 10; i <= 17; i++) d.puppetSprite(i, true);
        refresh();
        myField();
        for (let i = 10; i <= 17; i++) if (d.sprite(i).locV > 1000) d.setLocV(i, d.sprite(i).locV - 1000);
        castDate(c);
        d.setField('PriceDay', `$${wage} daily`);
        d.cursor(0);
      },
    },
    12: { mouseUp() {} },
    // 13: "Work": show the panel art
    13: {
      exitFrame() {
        d.setVisible(33, true);
      },
    },
    // 15: dialog OK -> M1
    15: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.setCursor(30, 0);
        d.setCursor(31, 0);
        g.enter = 0;
        for (const ch of [28, 29, 30]) d.puppetSprite(ch, false);
        refresh();
        d.go('M1');
        finishOk();
      },
    },
    17: helperArrow(0, -1),
    18: helperArrow(0, +1),
    23: helperArrow(1, +1),
    24: helperArrow(1, -1),
    53: helperArrow(2, +1),
    54: helperArrow(2, -1),
    // 19: plow OK
    19: {
      mouseDown: () => d.press(),
      async mouseUp() {
        if (flowBusy) return;
        d.cursorOff();
        const pTime = Math.max(1, plowNow * mySpeedV);
        if (allWor[0] > 0 && S().propet.cash < allWor[0] * wage * pTime) {
          d.setField('CurFDBK', fld(allWor[0] === 1 ? 'OneWor' : 'ManyWor'));
          for (const ch of [33, 34, 36]) d.setVisible(ch, false);
          for (const ch of [37, 38, 39]) d.setVisible(ch, true);
          d.setCursor(39, HAND);
          d.setCursor(35, HAND);
          stopTrac = 1;
          return;
        }
        if (plowNow === 0) return;
        await runPlow();
      },
    },
    // 22: plow Cancel
    22: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.cursorOff();
        g.enter = 0;
        for (let i = 0; i < 16; i++) if (plow[i] === 2) ((plow[i] = 0), numPlowed--);
        plowNow = 0;
        numbWor1 = 1;
        for (const f of ['NumWork', 'AcresPl', 'PlowTime', 'DateFin', 'PriceWor']) d.setField(f, ' ');
        d.go('M1');
      },
    },
    // 27: S1P1-3 OK (interruptions during plowing)
    27: {
      mouseDown: () => d.press(),
      mouseUp: () => finishOk(),
    },
    // 30: Plant2 loop
    30: {
      enterFrame() {
        if (g.enter === 0) {
          g.enter = 1;
          for (const i of range()) {
            const ch = sq(i) + 26;
            if (plant[i - 1] > 0) {
              if (!d.sprite(ch).puppet) d.puppetSprite(ch, true);
              d.setLoc(ch, LOC_H[sq(i) - 1], LOC_V[sq(i) - 1] + 10);
              d.setCast(ch, d.castNumber('Se1') - 1 + plant[i - 1]);
              continue;
            }
            d.setLocV(ch, 1000);
          }
          sign();
          d.updateStage();
        }
        if (numPlanted > 0 && okFlag === 0) {
          d.setVisible(24, true);
          okFlag = 1;
          d.setCursor(24, HAND);
        } else if (numPlanted === 0 && okFlag === 0) {
          d.setVisible(24, false);
          okFlag = 1;
          d.setCursor(24, 0);
        }
      },
      exitFrame: () => d.go(d.frame),
    },
    // 32: Plant2 entry
    32: {
      enterFrame() {
        for (const ch of [37, 38, 39]) d.setVisible(ch, false);
        d.setVisible(24, numPlanted !== 0);
        g.enter = 0;
        okFlag = 0;
        for (let i = 1; i <= 4; i++) {
          const v = seeds[i - 1];
          d.setField(`Seed${i}`, v > 1 ? `${v} Acres` : v === 1 ? '1  Acre' : ' ');
          if (v >= 20) {
            d.setVisible(i + 19, true);
            d.setCursor(i + 19, HAND);
          } else d.setVisible(i + 19, false);
        }
        d.setCursor(25, HAND);
        d.setField('CurFDBK', fld('NoPlant5'));
        seas = mon;
      },
    },
    // 36: NoPlant loop
    36: {
      enterFrame() {
        if (g.enter === 0) {
          g.enter = 1;
          sign();
        }
      },
      exitFrame: () => d.go(d.frame),
    },
    // 37: Pla loop (FDBK7 shown)
    37: {
      enterFrame() {
        d.setCursor(29, HAND);
        d.setCursor(30, HAND);
      },
      exitFrame: () => d.go(d.frame),
    },
    // 39: OK after plowing / the harvest results -> M1
    39: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.cursorOff();
        g.enter = 0;
        refresh();
        if (wintSum === 1) myField();
        d.go('M1');
        finishOk();
      },
    },
    // 40: drag a seed bag onto a plowed square
    40: {
      mouseDown() {
        dragging = dragSeed();
      },
      async mouseUp() {
        await dragging;
        dropSeed();
      },
    },
    // 41: click a seed placed this session to take it back
    41: {
      mouseUp() {
        const click = d.clickOn;
        const i = click - 26 + 8 * (curField - 1);
        if (S().cursit.plant[i - 1] !== 0) return;
        const crop = d.sprite(click).castNum - (d.castNumber('Se1') - 1);
        plant[i - 1] = 0;
        plantNow[i - 1] = 0;
        seeds[crop - 1] += 20;
        d.setField(`Seed${crop}`, `${seeds[crop - 1]} Acres`);
        d.setLocV(click, 1000);
        d.setCursor(click, 0);
        numPlanted--;
        if (!d.sprite(19 + crop).visible) {
          d.setVisible(19 + crop, true);
          d.setCursor(19 + crop, HAND);
        }
        if (numPlanted === 0) okFlag = 0;
      },
    },
    // 43: the "?" hint mode toggle (and its panel OK)
    43: {
      mouseDown() {
        if (d.clickOn === 45) d.press();
      },
      mouseUp() {
        hintFirst();
        d.cursorOff();
        d.setCursor(27, HAND);
        d.setCursor(46, HAND);
        if (g.mode === 0) {
          d.puppetSprite(46, true);
          if (d.sprite(46).locV > 1000) d.setLocV(46, d.sprite(46).locV - 1000);
          g.mode = 1;
          for (const i of HINT_LIST) d.setCursor(i, 'question');
          hintOn = true;
        } else {
          hintOn = false;
          d.puppetSprite(46, false);
          for (let i = 43; i <= 45; i++) if (d.sprite(i).locV < 1000) d.setLocV(i, d.sprite(i).locV + 1000);
          g.mode = 0;
          g.enter = 0;
        }
      },
    },
    // 44: planting Cancel
    44: {
      mouseDown: () => d.press(),
      mouseUp() {
        if (copy) {
          plant = [...copy.plant];
          numPlanted = copy.num;
          seeds = [...copy.seeds];
        }
        plantNow = new Array(16).fill(0);
        for (let i = 1; i <= 8; i++) if (d.sprite(i + 26).puppet) d.puppetSprite(i + 26, false);
        g.enter = 0;
        d.cursorOff();
        d.go('M1');
      },
    },
    // 45: planting OK -> the sim plants the new squares
    45: {
      mouseDown: () => d.press(),
      async mouseUp() {
        d.cursorOff();
        const plantings = plantNow.map((v, i) => (v ? { square: i + 1, crop: plant[i] as Crop } : null)).filter((x): x is { square: number; crop: Crop } => !!x);
        plantNow = new Array(16).fill(0);
        for (let i = 1; i <= 8; i++) if (d.sprite(i + 26).puppet) d.puppetSprite(i + 26, false);
        if (plantings.length) await game.run({ type: 'plant', plantings });
        refresh();
        myField();
        g.enter = 0;
        d.go('M1');
      },
    },
    // 46: Plant button
    46: {
      mouseUp() {
        hintFirst();
        if (g.mode !== 0) return;
        d.cursorOff();
        for (let i = 20; i <= 31; i++) d.puppetSprite(i, false);
        for (let i = 43; i <= 46; i++) d.puppetSprite(i, false);
        d.puppetSprite(33, false);
        for (let i = 1; i <= 4; i++) {
          d.setField(`Seed${i}`, ' ');
          d.setFieldStyle(`Seed${i}`, 'Times New Roman', 14, 'Plain');
        }
        d.setVisible(48, false);
        d.puppetSprite(48, false);
        const blocked = ctrl.check('plant');
        if (blocked) {
          void game.apply(blocked);
          return;
        }
        refresh();
        copy = { plant: [...plant], num: numPlanted, seeds: [...seeds] };
        plantNow = new Array(16).fill(0);
        d.go('Plant2');
      },
    },
    // 47: NoPlant entry
    47: {
      enterFrame() {
        d.puppetSprite(28, true);
        d.setCast(28, noPlant === 1 ? 'StoreCl' : neibArt());
        if (d.sprite(28).locV > 1000) d.setLocV(28, d.sprite(28).locV - 1000);
        d.setField('CurFDBK', fld(`NoPlant${noPlant}`));
        d.setCursor(31, HAND);
        d.setCursor(30, HAND);
        g.enter = 0;
      },
    },
    // 48: family toggle (frame 41, unused by the score flow)
    48: {
      mouseUp() {
        if (allWor[2] === 0) {
          d.setCast(36, 'Fam1');
          allWor[2] = maxFam;
        } else {
          d.setCast(36, 'Fam0');
          allWor[2] = 0;
        }
        numbWor1 = allWor[0] + allWor[1] + allWor[2] + 1;
        d.setField('NumWork', allWor[0] > 0 ? String(allWor[0]) : ' ');
        d.setField('MyFamily', String(allWor[2]));
        mySpeedV = Math.trunc(speed / numbWor1);
        retable();
      },
    },
    50: { mouseDown: () => d.press() },
    // 51: Harv (harvest estimate) entry + loop
    51: {
      enterFrame() {
        if (g.enter === 0) {
          d.puppetSprite(33, false);
          d.setVisible(33, true);
          table(numHarved, 'HarvTime');
          g.enter = 1;
          d.setCursor(36, HAND);
          sign();
          d.setVisible(tractor === 0 ? 7 : 8, true);
          // CursorOn quirk 8: tests the visibility of sprite i (list index), not the listed sprite
          for (const ch of [5, 6, 33, 34]) if (quirk(c, 'CURSORON') || d.sprite(ch).onStage) d.setCursor(ch, HAND);
          d.updateStage();
        }
      },
      exitFrame: () => d.go(d.frame),
    },
    // 56: harvest OK
    56: {
      mouseDown: () => d.press(),
      async mouseUp() {
        if (flowBusy) return;
        d.cursorOff();
        await runHarvest();
      },
    },
    // 57: Harvest button
    57: {
      mouseUp() {
        hintFirst();
        if (g.mode !== 0) return;
        d.cursorOff();
        fMark = 'Harv';
        d.setVisible(48, false);
        d.puppetSprite(48, false);
        for (let i = 20; i <= 31; i++) d.puppetSprite(i, false);
        for (let i = 43; i <= 46; i++) d.puppetSprite(i, false);
        d.puppetSprite(33, false);
        g.enter = 0;
        const blocked = ctrl.check('harvest');
        if (blocked) {
          void game.apply(blocked);
          return;
        }
        for (const ch of [7, 8, 37, 38, 39]) d.setVisible(ch, false);
        whatIDo = 2;
        goAndWork();
        d.go('Harv');
      },
    },
    // 62: F1/F2 sign: switch fields
    62: {
      mouseUp() {
        if (g.mode !== 0) return;
        d.setLocV(35, 1000);
        curField = curField === 1 ? 2 : 1;
        d.setCast(1, curField === 1 ? 'Field1' : 'Field2');
        g.enter = 0;
        myField();
      },
    },
    // 70: Harend loop
    70: {
      exitFrame() {
        if (g.enter === 0) {
          d.setCursor(30, HAND);
          g.enter = 1;
        }
        d.go(d.frame);
      },
    },
    // 72/73: SH (harvest stopped) — shown by runHarvest; OK continues
    73: {
      mouseDown: () => d.press(),
      mouseUp: () => finishOk(),
    },
    // 77/78: plow-broke choices
    77: {
      mouseUp() {
        d.setCast(40, 'NoE');
        d.setCast(39, 'YesE');
        choose = 1;
      },
    },
    78: {
      mouseUp() {
        d.setCast(39, 'NoE');
        d.setCast(40, 'YesE');
        choose = 2;
      },
    },
    // 85: OK on the "wrong season" message while planting
    85: {
      mouseDown: () => d.press(),
      mouseUp() {
        g.enter = 0;
        okFlag = 0;
        for (const ch of [38, 39, 37]) d.setVisible(ch, false);
        d.setVisible(25, true);
        d.setCursor(39, 0);
        d.go('Plant2');
      },
    },
    // 87: OK on "can't pay the workers"
    87: {
      mouseDown: () => d.press(),
      mouseUp() {
        stopTrac = 0;
        for (const ch of [38, 39, 37]) d.setVisible(ch, false);
        for (const ch of [34, 33, 36]) d.setVisible(ch, true);
        for (const i of range()) if (plow[i - 1] !== 1) d.setCursor(sq(i) + 9, HAND);
        for (const ch of [5, 6, 34, 33]) d.setCursor(ch, HAND);
      },
    },
    // 92: the location bar
    92: {
      mouseDown() {
        if (g.mode === 0) d.press();
      },
      async mouseUp() {
        if (g.mode !== 0) return;
        const marker = d.clickOn - 20;
        g.marker = marker;
        d.cursorOff();
        d.cursor(4);
        // (the original also nudges g_MainView to the snow/summer view here; the board view
        // comes from the sim in this remake)
        const s = S();
        if (marker === 1) {
          d.puppetSound(0);
          await c.goMovie('BANK09');
        } else if (marker === 2) {
          d.puppetSound(0);
          await c.goMovie('STORE');
        } else if (marker === 3) {
          d.puppetSound(0);
          g.enter = 0;
          const wh = s.globals.whatHouse;
          await c.goMovie(wh >= 3 ? 'HOUSE3' : wh === 2 ? 'HOUSE2' : 'HOUSE1');
        } else if (marker === 4) {
          await c.goMovie('TSTREET1', s.date.year < 1890 ? 'S1' : 'S2');
        } else if (marker === 5) {
          await c.goMovie('CALEND', 'Start');
        }
      },
    },
    // 93: harvest Cancel
    93: {
      mouseDown: () => d.press(),
      mouseUp() {
        d.cursorOff();
        g.enter = 0;
        numbWor1 = 1;
        for (const f of ['NumWork', 'AcresPl', 'HarvTime', 'DateFin', 'PriceWor']) d.setField(f, ' ');
        d.go('M1');
      },
    },
  };

  let drag = { click: 0, notSeas: 0, over: 0 };
  let dragging: Promise<void> = Promise.resolve();
  /** ScoreScript 40 mouseDown: drag a seed bag (repeat while the mouseDown). */
  async function dragSeed() {
    const click = d.clickOn;
    const crop = click - 19;
    let notSeas = 0;
    if (crop === 1 && seas > 3 && seas < 8) notSeas = 1;
    else if (crop > 1 && (seas < 4 || seas > 7)) notSeas = 2;
    drag = { click, notSeas, over: 0 };
    if (notSeas) return;
    d.puppetSprite(click, true);
    d.setCast(click, d.castNumber('Se1') - 1 + crop);
    await d.trackMouse(() => d.setLoc(click, d.mouseH, d.mouseV));
    const sp = d.sprite(click);
    const r = sp.rect();
    for (let i = 10; i <= 17; i++) {
      if (r.bottom <= 273 + 173 && d.rollOver(i)) {
        drag.over = i;
        break;
      }
    }
  }

  /** ScoreScript 40 mouseUp. */
  function dropSeed() {
    const { click, notSeas, over } = drag;
    if (notSeas > 0) noPlantInPlace();
    else if (over > 0) {
      const i = over - 9 + 8 * (curField - 1);
      if (plow[i - 1] > 0 && plow[i - 1] < 10 && plant[i - 1] === 0) yesPlant(click, over);
    }
    // back to the score position (puppetSprite(g_Click, 0))
    d.puppetSprite(click, false);
    const src = d.sprite(click).src;
    if (src) {
      d.setCast(click, src.castId ?? 0);
      d.setLoc(click, src.loc[0], src.loc[1]);
    }
  }

  /** MovieScript 55 `NOPLANT`: the wrong-season message inside the planting screen. */
  function noPlantInPlace() {
    d.cursorOff();
    for (let i = 1; i <= 4; i++) if (d.sprite(i + 19).visible) d.setVisible(i + 19, false);
    for (const ch of [37, 38, 39]) d.setVisible(ch, true);
    d.setVisible(24, false);
    d.setVisible(25, false);
    d.setCursor(39, HAND);
  }

  /** MovieScript 55 `YESPLANT`. */
  function yesPlant(click: number, over: number) {
    const crop = click - 19;
    const i = over - 9 + 8 * (curField - 1);
    const ch = over + 17;
    d.setCursor(ch, HAND);
    if (!d.sprite(ch).puppet) d.puppetSprite(ch, true);
    d.setCast(ch, d.castNumber('Se1') - 1 + crop);
    d.setLoc(ch, LOC_H[over - 10], LOC_V[over - 10] + 10);
    if (plant[i - 1] !== crop) {
      if (plant[i - 1] === 0) {
        numPlanted++;
        if (numPlanted === 1) okFlag = 0;
      }
      plant[i - 1] = crop;
      plantNow[i - 1] = 1;
      const left = seeds[crop - 1] - 20;
      seeds[crop - 1] = Math.max(0, left);
      if (left >= 20) d.setField(`Seed${crop}`, `${left} Acres`);
      else {
        d.setField(`Seed${crop}`, left <= 0 ? ' ' : left === 1 ? '1  Acre' : `${left} Acres`);
        d.setCursor(click, 0);
        d.setVisible(click, false);
      }
    }
    d.updateStage();
  }

  return {
    startFrame: 1,
    scripts,
    async startMovie() {
      // FIELD startMovie (MovieScript 1): the visit's rolls come from the sim (enterField)
      d.cursor(4);
      g.music = null; // g_Filename = #No
      await game.run({ type: 'enterField' });
      curField = 1;
      refresh();
      goAndWork();
      d.setField('PriceDay', `$${wage} daily`);
      syncMoney(c, false);
      castDate(c);
    },
    presenter: {
      async info(_s, e) {
        const i = consumed.indexOf(e.id);
        if (i >= 0) {
          consumed.splice(i, 1);
          return;
        }
        if (e.id === 'FDBK7') {
          // Pla+1 (SS37): "Great. Now that you finished plowing..."
          g.enter = 0;
          d.go(d.labelFrame('Pla') + 1);
          d.start();
          await waitOk();
          return;
        }
        const np = /^NoPlant(\d)$/.exec(e.id);
        if (np) {
          await showNoPlant(Number(np[1]));
          return;
        }
        syncMoney(c);
        await showNo(fld(e.id === 'NoPlow4' ? 'Noplow4' : e.id));
        syncMoney(c);
      },
      async harvest(s, e, textId) {
        // Harend (SS69) + frame 52: bushels per crop and the dealer's message
        g.enter = 0;
        d.go('Harend');
        refresh();
        myField();
        showAll(48, 35);
        if (numbFields === 2 && !d.sprite(35).visible) d.setVisible(35, true);
        for (let k = 0; k < 4; k++) {
          d.setField(`Bush${k + 1}`, e.bushels[k] > 0 ? ` ${e.bushels[k]}  bushels` : ' ');
          d.setFieldStyle(`Bush${k + 1}`, 'Times New Roman', 14, 'Plain');
        }
        if (s.date.year > 1880 || textId === 'EndHarv') d.setField('EndHarv1', d.field('EndHarv'));
        syncMoney(c);
        d.cursorOff();
        d.setCursor(21, HAND);
        d.setCursor(22, HAND);
        await d.delay(100);
        d.go(d.labelFrame('Harend') + 1);
        d.start();
        await waitOk();
      },
      rejected() {},
    },
  };
};

export default factory;
