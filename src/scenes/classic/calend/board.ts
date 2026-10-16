// CALEND (the game board / town map + calendar): the original Lingo of
// decompiled/lingo/CALEND/casts/Internal ported script by script. Score scripts keep their
// castIds (ScoreScript 12 -> scripts[12]). Presentation (sprites, fields, sounds, frame flow)
// follows the Lingo; game rules come only from the sim (game.run), so the scripts that changed
// fields/globals in the original send the matching sim command instead.
//
// Dialog frames (Mes, Dec1, DL, DL1, Doc/Doc1, Wed/Wed1, May, MayM, Lists, Extra, NHelp, Eog)
// are driven by the presenter (calend/dialogs.ts): it sends the playhead to the frame, the
// frame script lays the dialog out as the original did, and the button script resolves the
// answer back to the sim.
import type { Command, GameState, SimEvent } from '../../../sim/index.ts';
import { buildableItems, constructionEstimate, livestockMarketOpen, type BuildItem } from '../../../sim/index.ts';
import { LIVESTOCK_PRICES } from '../../../sim/data/tables.ts';
import { game } from '../../../engine/game.ts';
import type { ClassicContext, MovieModule } from '../context.ts';
import type { ScriptTable } from '../dir/player.ts';
import { HAND } from '../dir/player.ts';
import { csound } from '../dir/sound.ts';
import { numberToCurrency, lines, item, value, YEAR_GB, random } from '../dir/lingo.ts';
import { edPlayBgMusic, edStopBgMusic, sharedScripts, syncMoney } from '../shared/common.ts';
import { dialogScripts, makePresenter, type DialogState } from './dialogs.ts';

/** g_AllSounds (FIRSTTIME): ambience per g_MainView. */
const ALL_SOUNDS: Record<number, string> = { 0: 'Spring', 1: 'Wind', 2: 'Wind', 3: 'Spring', 5: 'Spring', 6: 'TSR', 7: 'Wind', 8: 'Wind', 9: 'Fire', 10: 'Tornado', 11: 'Grass', 12: 'Cows' };
/** g_ListDays (ScoreScript 64) by g_WhatBuild 1..5 */
const BUILD_OF: BuildItem[] = ['house', 'barn', 'windmill', 'woodFence', 'barbedFence'];

export class Calend {
  readonly c: ClassicContext;
  readonly dlg: DialogState = { cur: null, resolve: null };
  /** false once the movie is left (late async handlers must not touch the next movie) */
  alive = true;
  // calendar run
  running = false;
  stopAsked = false;
  private flipDone: (() => void) | null = null;
  // hint mode (MovieScript 94)
  private listOfSprites: number[] = [];
  private hintCast = 'Hints';
  // construction (ScoreScripts 64-75)
  private whatBuild = 0;
  private wor = 0;
  private neib = 0;
  private fam = 0;
  private maxFam = 0;
  // livestock (MovieScript 76 BuySell, ScoreScripts 83-91)
  private myChoice = 1;
  private anim = [0, 0, 0];
  private animPrice = [0, 0, 0];
  private max = [0, 0, 0];
  private myTotal = 0;
  // achievements
  private myGoal = 0;
  // trivia
  private lastRoll = 0;

  constructor(c: ClassicContext) {
    this.c = c;
  }

  get d() {
    return this.c.d;
  }
  get s(): GameState {
    return this.c.state!;
  }
  get g() {
    return this.c.g;
  }

  /** `field "X"` text of CALEND/SHARED (original member), "" if missing. */
  field(name: string) {
    return this.d.field(name);
  }

  // ------------------------------------------------------------------ helpers
  /** show a sprite hidden by +1000 (`if the locV > 1000 then -1000`) */
  up(ch: number) {
    const sp = this.d.sprite(ch);
    if (sp.locV > 1000) this.d.setLocV(ch, sp.locV - 1000);
  }
  /** hide a sprite (`if the locV < 1000 then +1000`) */
  down(ch: number) {
    const sp = this.d.sprite(ch);
    if (sp.locV < 1000) this.d.setLocV(ch, sp.locV + 1000);
  }
  hand(...chs: number[]) {
    for (const ch of chs) this.d.setCursor(ch, HAND);
  }
  puppets(from: number, to: number, on: boolean) {
    for (let i = from; i <= to; i++) this.d.puppetSprite(i, on);
  }
  setCastName(ch: number, name: string, offset = 0) {
    const n = this.d.castNumber(name);
    if (n) this.d.setCast(ch, n + offset);
  }
  /** `set the foreColor of field X to n` */
  fieldColor(name: string, index: number) {
    const m = this.d.member(name);
    if (!m) return;
    const col = this.d.color(index);
    m.styles = (m.styles?.length ? m.styles : [{ start: 0, height: null, ascent: null, style: 0, size: 12, color: '#000000', font: 'Arial' }]).map((st) => ({ ...st, color: col }));
    m.version++;
    this.d.updateStage();
  }
  playTownMap(name: string) {
    void csound.playFile(2, `DATA\\SOUND\\TOWNMAP\\${name}.WAV`);
  }

  /** NewDate field: "MON.\rDAY\rYEAR" when stopped, "MON.\r\rYEAR" while the calendar runs (CASTDATE). */
  dateFields(running = this.running) {
    const s = this.s;
    const mon = YEAR_GB[s.date.mon - 1];
    this.d.setField('NewDate', `${mon}\r${running ? '' : s.date.day}\r${s.date.year}`);
    this.d.setField('CurrentDate', `${mon} ${s.date.day}, ${s.date.year}`);
  }

  /** MYSCORE display ("SCORE :  n"), money fields (ALLMONEY), date. */
  syncFields(sound = true) {
    if (!this.c.state) return;
    syncMoney(this.c, sound);
    this.d.setField('Score', `SCORE :  ${this.s.propet.score}`);
    this.d.setField('MyName', `${this.s.name.first} ${this.s.name.last}`.trim());
    this.dateFields();
  }

  // ------------------------------------------------------------------ the farm picture (MovieScript 68)
  /** BuildPic */
  buildPic() {
    this.build1();
    this.fenWMill();
    const p = this.s.propet;
    if (p.tractors > 0) {
      this.d.setCast(13, this.d.castNumber('Trac1') + p.tractors - 1);
      this.up(13);
    }
    if (p.car > 0) this.up(14);
  }

  /** FenWMill (display only; the extra-windmill swap is a sim rule) */
  fenWMill() {
    const p = this.s.propet;
    if (p.fence > 0) {
      this.d.setCast(5, this.d.castNumber('Fen2') + p.numFields);
      this.up(5);
    }
    if (p.windmill > 0) {
      this.d.setCast(7, this.d.castNumber('Wmill1') + p.windmill - 1);
      this.up(7);
    }
    if (p.extraWindmills > 0) {
      this.d.setCast(8, this.d.castNumber('Wmill3') + p.extraWindmills - 1);
      this.up(8);
    }
  }

  /** BUILD1 */
  build1() {
    const mv = this.s.globals.mainView;
    const bg = this.d.castNumber('Def') + mv;
    if (this.d.sprite(1).castNum !== bg) this.d.setCast(1, bg);
    const sp = this.d.sprite(1);
    if (sp.locV !== 0 || sp.locH !== 0) this.d.spriteBox(1, 0, 0, 640, 381);
    this.up(2);
    this.getSound();
    this.buildField();
    this.houseBarn();
  }

  /** BuildField */
  buildField() {
    const mv = this.s.globals.mainView;
    const fs = this.s.globals.fieldStat;
    this.up(3);
    if (mv === 1 || mv === 2 || mv === 9) this.setCastName(3, 'Shape');
    else this.d.setCast(3, this.d.castNumber('FDef') + fs);
    if (this.s.propet.numFields === 2) {
      this.up(4);
      if (mv < 3) this.setCastName(4, 'Shape');
      else this.d.setCast(4, this.d.castNumber('FDef') + fs);
    }
  }

  /** HouseBarn */
  houseBarn() {
    const g = this.s.globals;
    if (g.houseStat > 0) {
      this.d.setCast(9, this.d.castNumber('H1') + g.houseStat - 1);
      this.up(9);
      this.up(16);
    }
    if (this.s.propet.barn > 0) {
      this.d.setCast(6, this.d.castNumber('Barn1') + g.barnStat - 1);
      this.up(6);
    }
  }

  /** GetSound (MovieScript 40) */
  getSound() {
    const s = this.s;
    const name0 = ALL_SOUNDS[s.globals.mainView];
    if (name0) {
      let name = name0 === 'Wind' ? `Wind${random(2)}` : name0;
      if ((s.date.year === 1893 || s.date.year === 1902) && s.date.mon === 7) name = 'Wed';
      if (this.g.mmapSound !== name) {
        this.g.mmapSound = name;
        this.d.puppetSound(name);
      }
    } else {
      this.d.puppetSound(0);
      this.g.mmapSound = '';
    }
  }

  /** LVSTK pen shown in April/May (ScoreScripts 10/12) */
  livestockPen() {
    const s = this.s;
    if (livestockMarketOpen(s)) {
      this.up(15);
      this.hand(15);
    } else this.down(15);
  }

  /** After a sim command: refresh the picture as the original scripts did. */
  sync() {
    if (!this.c.state) return;
    const lbl = this.d.frameLabel;
    if (['Begin', 'Date', 'NextD', 'EndDate', 'Mes', 'Events', 'NHelp', 'Dec1', 'DL', 'DL1', 'Doc', 'Wed', 'May', 'MayM', 'Lists', 'Extra', 'Con', 'Con1', 'Ques', 'Propet', 'Trivia', 'RightAns', 'LVST', 'BuySell', 'Opt'].includes(lbl) || this.d.frame === 5) this.buildPic();
    this.syncFields();
  }

  // ------------------------------------------------------------------ the calendar
  /** ScoreScript 8 (calendar button, mouseUp). */
  async calendarButton() {
    if (this.running || game.busy) return;
    const s = this.s;
    this.g.enter = 0;
    this.d.cursorOff();
    this.d.puppetSprite(33, false);
    const g = s.globals;
    const simple = g.mail > 0 || g.houseStat === 0 || g.eog === 1 || s.date.year > 1919 || (s.date.year === 1919 && s.date.mon === 12);
    if (simple) {
      // TakeMail / the neighbours build the sod house / game over / the final town talk
      await this.c.run({ type: 'startCalendar' });
      if (this.c.state && !this.dlg.cur && this.alive) this.backToBegin();
      return;
    }
    this.up(11);
    this.down(12);
    this.running = true;
    this.stopAsked = false;
    this.d.cursor(4);
    this.d.startTimer();
    this.dateFields(true);
    this.d.go('Date');
    try {
      let r = await this.c.run({ type: 'startCalendar', yieldEachMonth: true });
      for (let guard = 0; guard < 1000 && r && this.c.state?.extra.calendar.running; guard++) {
        if (!this.alive) break;
        this.dateFields(true);
        this.d.go('Date');
        r = await this.c.run({ type: this.stopAsked ? 'stopCalendar' : 'continueCalendar' });
      }
    } finally {
      this.running = false;
      this.d.cursor(0);
      this.d.setCursor(34, null);
      this.d.setCursor(40, null);
    }
    if (this.c.state && this.alive && !this.dlg.cur) this.backToBegin();
  }

  backToBegin() {
    this.g.enter = 0;
    this.syncFields(false);
    this.d.go('Begin');
  }

  /** view.animate: the page flip (frames 14-17) and the 4-second EndDate wait for a month advance. */
  async animate(events: SimEvent[]) {
    if (events.some((e) => e.type === 'trivia')) this.playTownMap('Trivia');
    if (!this.running) {
      // the original scripts redraw the farm (HouseBarn/FenWMill/ALLMONEY) before the message shows
      if (this.alive && this.c.state && this.d.frame >= 4) {
        this.buildPic();
        this.syncFields();
      }
      return;
    }
    if (!events.some((e) => e.type === 'monthAdvanced')) return;
    if (!this.alive) return;
    // ScoreScript 6, the "keep running" branch of the Date check: NewCursor(0) and the hand on the green button
    // (sprites 34/40) before go(#next). The busy watch only shows for the check itself, so the player can click the
    // button during the page flip / EndDate wait (ScoreScript 9 -> g_OutDate). The sim's Date check is synchronous,
    // so the frame never rests on Date: this is where the original's cursors are set.
    if (!this.stopAsked) {
      this.d.cursor(0);
      this.hand(34, 40);
    }
    await new Promise<void>((resolve) => {
      this.flipDone = resolve;
      this.d.go('NextD');
    });
  }

  // ------------------------------------------------------------------ hint mode (MovieScript 94 `hint`)
  hint(): boolean {
    const d = this.d;
    const click = d.clickOn;
    if (click && d.sprite(click).cursor === 'question') {
      const i = this.listOfSprites.indexOf(click);
      if (i < 0) return true;
      d.cursorOff();
      const l1 = lines(this.field(this.hintCast))[0] ?? '';
      const beg = value(item(l1, 1 + 2 * i));
      const end = value(item(l1, 2 + 2 * i));
      d.setField('QText', lines(this.field(this.hintCast)).slice(beg - 1, end).join('\r'));
      this.hand(44);
      for (let ch = 45; ch <= 47; ch++) this.up(ch);
      for (const ch of this.listOfSprites) if (ch > 0 && d.sprite(ch).locV < 1000) d.setCursor(ch, 'question');
      this.hand(46);
    } else if (click === 46) {
      d.cursorOff();
      for (const ch of this.listOfSprites) if (ch > 0 && d.sprite(ch).locV < 1000) d.setCursor(ch, 'question');
      this.hand(44);
      for (let ch = 45; ch <= 47; ch++) this.down(ch);
    }
    return true;
  }

  /** a map click while a letter waits in the mailbox: TakeMail (ScoreScripts 13/18/19/36/93/96...) */
  async takeMailFirst(): Promise<boolean> {
    if (this.s.globals.mail > 0) {
      this.d.puppetSprite(33, false);
      await this.c.run({ type: 'openMail' });
      if (this.alive && !this.dlg.cur) this.backToBegin();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ achievements (MovieScript 4)
  ahievPage1() {
    const p = this.s.propet;
    const d = this.d;
    d.setField('CashGB', numberToCurrency(p.cash));
    d.setField('SaveGB', numberToCurrency(p.savings));
    d.setField('LifeGB', numberToCurrency(p.lifePrice));
    for (const f of ['CashGB', 'SaveGB', 'LifeGB']) d.setFieldStyle(f, 'Times New Roman', 18, 'Plain');
  }
  private landValue() {
    return this.s.propet.landValue || 3200;
  }
  private animValues() {
    const p = this.s.propet;
    const row = LIVESTOCK_PRICES.get(this.s.date.year);
    let tot = 0;
    const out = ['', '', ''];
    if (row) {
      const v = [row.horse, row.pig, row.cow];
      const n = [p.horses, p.pigs, p.cows];
      for (let i = 0; i < 3; i++)
        if (n[i] > 0) {
          const x = Math.round(v[i] * n[i]);
          out[i] = numberToCurrency(x);
          tot += x;
        }
    }
    return { out, tot };
  }
  ahievTable() {
    const d = this.d;
    const goal = this.s.begin.goal;
    d.setField('MyGoal', lines(this.field('Goals'))[goal - 1] ?? '');
    const { tot } = this.animValues();
    const p = this.s.propet;
    d.setField('TotalGB', numberToCurrency(tot + p.tractors * 400 + p.plows * 50 + this.landValue()));
    d.setFieldStyle('TotalGB', 'Times New Roman', 18, 'Plain');
  }
  ahievPage2() {
    const d = this.d;
    const p = this.s.propet;
    d.setField('SizeF', `${p.numFields * 160} acres`);
    d.setField('ValueF', numberToCurrency(this.landValue()));
    d.setFieldStyle('SizeF', 'Times New Roman', 18, 'Plain');
    d.setFieldStyle('ValueF', 'Times New Roman', 18, 'Plain');
    const names = ['WWeatF', 'SWeatF', 'OatsF', 'CornF'];
    names.forEach((n, i) => {
      d.setField(n, p.seeds[i] > 0 ? `${p.seeds[i]} acres` : ' ');
      d.setFieldStyle(n, 'Times New Roman', 14, 'Bold');
    });
  }
  ahievPage3() {
    const d = this.d;
    const p = this.s.propet;
    const n = [p.horses, p.pigs, p.cows];
    const { out, tot } = this.animValues();
    // AnimV1 is the horses' value (Lst item 4), AnimV3 the cows' (item 2)
    for (let i = 0; i < 3; i++) {
      d.setField(`Anim${i + 1}`, n[i] > 0 ? String(n[i]) : '');
      d.setField(`AnimV${i + 1}`, out[i]);
    }
    for (const f of ['Anim1', 'Anim2', 'Anim3', 'AnimV1', 'AnimV2', 'AnimV3']) d.setFieldStyle(f, 'Times New Roman', 14, 'Bold');
    d.setField('TotV', numberToCurrency(tot));
    d.setFieldStyle('TotV', 'Times New Roman', 14, 'Bold');
  }
  ahievPage4() {
    const d = this.d;
    const p = this.s.propet;
    if (p.tractors > 0) {
      d.setField('TractorF', String(p.tractors));
      d.setField('TractorVF', numberToCurrency(p.tractors * 400));
      d.setFieldStyle('TractorF', 'Times New Roman', 18, 'Plain');
      d.setFieldStyle('TractorVF', 'Times New Roman', 18, 'Plain');
    } else {
      d.setField('TractorF', ' ');
      d.setField('TractorVF', ' ');
    }
    d.setField('PlowF', String(p.plows));
    d.setField('PlowVF', numberToCurrency(p.plows * 50));
    d.setField('TotV1', numberToCurrency(p.tractors * 400 + p.plows * 50));
    for (const f of ['PlowF', 'PlowVF', 'TotV1']) d.setFieldStyle(f, 'Times New Roman', 18, 'Plain');
  }
  private leaveGoalPage() {
    if (this.myGoal === 1) {
      for (let i = 1; i <= 4; i++) this.d.puppetSprite(30 + i, false);
      for (let i = 1; i <= 7; i++) this.d.puppetSprite(19 + i, false);
      for (const ch of [38, 40, 41, 42]) this.d.puppetSprite(ch, false);
    }
  }

  // ------------------------------------------------------------------ livestock (MovieScript 76 BuySell)
  buySell() {
    const d = this.d;
    for (const f of ['Anim1', 'Anim2', 'Anim3', 'AnimV1', 'AnimV2', 'AnimV3', 'TotAV1', 'TotAV2', 'TotAV3', 'MyTotal']) d.setField(f, ' ');
    this.anim = [0, 0, 0];
    this.animPrice = [0, 0, 0];
    this.max = [0, 0, 0];
    const p = this.s.propet;
    if (this.myChoice === 1) {
      const sess = this.s.sessions.livestock;
      if (sess) {
        this.max = [...sess.max];
        this.animPrice = [...sess.price];
      }
      for (let i = 0; i < 3; i++) d.setField(`AnimV${i + 1}`, numberToCurrency(this.animPrice[i]));
    } else {
      const row = LIVESTOCK_PRICES.get(this.s.date.year);
      const own = [p.horses - 1, p.pigs, p.cows];
      const price = row ? [Math.round(row.horse), Math.round(row.pig), Math.round(row.cow)] : [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        if (own[i] > 0) {
          this.anim[i] = own[i];
          this.max[i] = own[i];
          d.setField(`Anim${i + 1}`, String(own[i]));
          this.animPrice[i] = price[i];
          d.setField(`AnimV${i + 1}`, numberToCurrency(price[i]));
          d.setField(`TotAV${i + 1}`, numberToCurrency(price[i] * own[i]));
        }
      }
    }
    this.updateTotal();
  }
  private updateTotal() {
    this.myTotal = this.anim.reduce((a, n, i) => a + n * this.animPrice[i], 0);
    this.d.setField('MyTotal', this.myTotal > 0 ? numberToCurrency(this.myTotal) : ' ');
  }
  private animClick(i: number, delta: 1 | -1) {
    const old = this.anim[i];
    if (delta > 0) this.anim[i] = old === this.max[i] ? 0 : old + 1;
    else this.anim[i] = old === 0 ? this.max[i] : old - 1;
    this.d.setField(`Anim${i + 1}`, this.anim[i] > 0 ? String(this.anim[i]) : ' ');
    this.d.setField(`TotAV${i + 1}`, this.anim[i] > 0 ? numberToCurrency(this.animPrice[i] * this.anim[i]) : ' ');
    this.updateTotal();
  }

  // ------------------------------------------------------------------ construction (Table, MovieScript 42)
  private table() {
    const item = BUILD_OF[this.whatBuild - 1];
    const est = constructionEstimate(item, { workers: this.wor, neighbors: this.neib, family: this.fam });
    this.d.setField('Days', String(est.days));
    this.d.setField('Cost', String(est.cost));
  }
  private afterConstruction() {
    this.puppets(18, 48, false);
    const left = buildableItems(this.s).length > 0;
    this.g.enter = 0;
    this.d.go(left ? 'Con' : 'Begin');
  }

  // ------------------------------------------------------------------ scripts
  scripts(): ScriptTable {
    const d = this.d;
    const c = this.c;
    const g = this.g;
    const self = this;
    const busy = () => game.busy || this.running;
    return {
      ...sharedScripts(c),
      ...dialogScripts(this),

      // ---------------- Start / First / Begin
      // 39: Start
      39: {
        exitFrame() {
          for (const ch of [1, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16]) d.puppetSprite(ch, true);
          const s = self.s;
          self.syncFields(false);
          if (s.date.year === 1880 && s.date.mon === 4 && s.globals.houseStat === 0 && s.globals.firstTT !== 1) {
            d.puppetSound('Spring');
            g.mmapSound = 'Spring';
            g.retFromE = 'First';
            d.go(d.frame + 1);
          } else {
            self.buildPic();
            if (!d.soundBusy(1) && g.mmapSound) d.puppetSound(g.mmapSound);
            g.retFromE = 'Begin';
            d.go('Begin');
          }
        },
      },
      // 77: First (the forced first town talk blinks)
      77: {
        exitFrame() {
          d.cursor(0);
          if (!d.sprite(2).puppet) for (const ch of [2, 29, 30, 31]) d.puppetSprite(ch, true);
          self.up(2);
          if (!d.sprite(12).cursor) self.hand(12, 17, 18);
          if (self.s.globals.firstTT === 0) {
            const sp = d.sprite(12);
            d.setLocV(12, sp.locV > 1000 ? sp.locV - 1000 : sp.locV + 1000);
            d.go(d.frame);
          } else {
            self.buildPic();
            self.down(2);
            for (const ch of [2, 29, 30, 31]) d.puppetSprite(ch, false);
            d.go(d.frame + 1);
          }
        },
      },
      // 78: town talk sprite (12, 17)
      78: {
        async mouseUp() {
          if (busy()) return;
          d.cursorOff();
          const s = self.s;
          if (s.globals.tTalk <= 0) return;
          if (await self.takeMailFirst()) return;
          d.cursor(4);
          if (g.mmapSound === 'Wed') {
            g.mmapSound = 'WedTT';
            d.puppetSound('WedTT');
          } else if (g.mmapSound === 'Wind1' || g.mmapSound === 'Wind2') {
            g.mmapSound = 'Wind';
            d.puppetSound('Wind');
          }
          await c.run({ type: 'visitTownTalk' });
          if (self.alive && !self.dlg.cur) {
            d.cursor(0);
            // on the First frame ScoreScript 77 builds the farm and moves on by itself
            if (d.frameLabel !== 'First') self.backToBegin();
          }
        },
      },
      // 12: Begin
      12: {
        exitFrame() {
          if (!c.state) return;
          const s = self.s;
          d.cursor(0);
          if (s.globals.tTalk !== 0 && d.sprite(12).locV > 1000) {
            self.up(12);
            self.hand(12, 17);
          } else if (s.globals.tTalk === 0) self.down(12);
          d.puppetSprite(34, false);
          self.livestockPen();
          if (s.date.year > 1906 || (s.date.year === 1906 && s.date.mon > 2)) {
            const snow = s.globals.mainView === 2;
            if (s.globals.mail > 0) {
              self.setCastName(10, snow ? 'MAILS1' : 'MAIL1');
              d.spriteBox(10, 161, 334, 161 + 36, 334 + 40);
              self.hand(10);
            } else {
              self.setCastName(10, snow ? 'MAILS0' : 'Mail0');
              d.spriteBox(10, 161, 334, 161 + 36, 334 + 40);
            }
          }
          for (const ch of [3, 4, 5, 11, 12, 16, 34, 35, 39, 40, 41, 42, 44]) if (d.sprite(ch).locV < 1000) self.hand(ch);
          if (!d.sprite(33).puppet) d.puppetSprite(33, true);
          if (s.extra.triviaOpen) {
            self.setCastName(33, 'Open');
            self.hand(33);
          } else {
            self.setCastName(33, 'Close');
            d.setCursor(33, null);
          }
          self.hand(18);
          self.syncFields(false);
        },
      },
      // 7: frame 5 loop (blinking town talk)
      7: {
        exitFrame() {
          const s = c.state;
          if (s && s.globals.tTalk !== 0 && s.globals.blinkTTalk > 0) {
            const sp = d.sprite(12);
            d.setLocV(12, sp.locV > 1000 ? sp.locV - 1000 : sp.locV + 1000);
          }
          d.go(d.frame);
        },
      },
      // 8: calendar button (34 "Red", 35 NewDate)
      8: {
        mouseDown() {
          if (d.clickOn === 34 && !busy()) d.press();
        },
        mouseUp() {
          void self.calendarButton();
        },
      },
      // 9: green button / pages while running -> stop at the next Date check
      9: {
        mouseUp() {
          if (d.sprite(d.clickOn).cursor === HAND) {
            d.cursor(4);
            d.setCursor(34, null);
            d.setCursor(40, null);
            self.stopAsked = true;
          }
        },
      },
      // 6: Date (the date check is the sim's; the frame holds while it runs)
      6: {
        enterFrame() {
          if (!d.sprite(34).puppet) d.puppetSprite(34, true);
        },
        exitFrame() {
          if (self.running) {
            d.cursor(0);
            if (!self.stopAsked) self.hand(34, 40);
          }
          d.go(d.frame);
        },
      },
      // 197: NextD
      197: {
        exitFrame() {
          d.startTimer();
        },
      },
      // 10: frame 17 enterFrame = month advance (BuildDate, PREPARE's visuals, LVSTK)
      10: {
        enterFrame() {
          if (!c.state) return;
          self.dateFields(true);
          self.buildPic();
          self.livestockPen();
          syncMoney(c);
        },
      },
      // 148: EndDate: wait 4 s since frame 14
      148: {
        exitFrame() {
          if (d.timer / 60 < 4) {
            d.go(d.frame);
            return;
          }
          const done = self.flipDone;
          self.flipDone = null;
          d.go('Date');
          done?.();
        },
      },
      // 13: fields (3, 4, 5)
      13: {
        async mouseUp() {
          if (busy()) return;
          d.cursorOff();
          if (await self.takeMailFirst()) return;
          g.mmapSound = '';
          d.cursor(4);
          await c.goMovie('FIELD');
        },
      },
      // 36: house hotspot (16)
      36: {
        async mouseUp() {
          if (busy()) return;
          d.cursorOff();
          if (await self.takeMailFirst()) return;
          d.puppetSound(0);
          g.mmapSound = '';
          g.enter = 0;
          d.cursor(4);
          const wh = self.s.globals.whatHouse;
          await c.goMovie(wh >= 3 ? 'HOUSE3' : wh === 2 ? 'HOUSE2' : 'HOUSE1');
        },
      },
      // 96: town (11)
      96: {
        async mouseUp() {
          if (busy()) return;
          d.cursorOff();
          if (await self.takeMailFirst()) return;
          d.puppetSound(0);
          g.mmapSound = '';
          d.cursor(4);
          await c.goMovie('TSTREET1', self.s.date.year < 1890 ? 'S1' : 'S2');
        },
      },
      // 95: mailbox (10)
      95: {
        async mouseUp() {
          if (busy() || self.s.globals.mail <= 0) return;
          d.puppetSprite(33, false);
          d.cursorOff();
          // ScoreScript 95 goes straight to "Events": no "There's a letter in your mailbox." line
          c.g.x.silentTakeMail = true;
          try {
            await c.run({ type: 'openMail' });
          } finally {
            c.g.x.silentTakeMail = false;
          }
          if (self.alive && !self.dlg.cur) self.backToBegin();
        },
      },
      // 93: livestock pen (15)
      93: {
        async mouseUp() {
          if (busy()) return;
          d.cursorOff();
          d.puppetSprite(33, false);
          if (await self.takeMailFirst()) return;
          d.puppetSound(0);
          await c.run({ type: 'enterLivestockMarket' });
          edPlayBgMusic(c, 'GANCOUA');
          d.go('LVST');
        },
      },
      // 17: trivia card (33)
      17: {
        mouseUp() {
          if (busy()) return;
          if (d.sprite(33).castNum === d.castNumber('Open')) {
            d.cursorOff();
            g.enter = 0;
            d.puppetSprite(33, false);
            d.go('Trivia');
          }
        },
      },
      // 18: hammer (39) -> construction
      18: {
        async mouseUp() {
          if (busy()) return;
          d.cursorOff();
          g.enter = 0;
          d.puppetSprite(33, false);
          if (await self.takeMailFirst()) return;
          const s = self.s;
          if (buildableItems(s).length > 0) {
            if (s.date.mon < 11 && s.date.mon > 2) {
              d.puppetSound(0);
              d.go('Con');
            } else await self.message('CantBuild', 'DBox0');
          } else await self.message('NothToB', 'DBox0');
        },
      },
      // 19: achievements (40)
      19: {
        async mouseUp() {
          if (busy()) return;
          d.cursorOff();
          d.cursor(0);
          d.puppetSprite(33, false);
          self.myGoal = 0;
          if (await self.takeMailFirst()) return;
          self.ahievTable();
          self.ahievPage1();
          g.enter = 0;
          d.go('Propet');
        },
      },
      // 48: options menu (41)
      48: {
        mouseDown() {
          if (!busy()) d.press();
        },
        async mouseUp() {
          if (busy()) return;
          d.cursorOff();
          d.puppetSprite(33, false);
          if (await self.takeMailFirst()) return;
          g.enter = 0;
          d.go('Opt');
        },
      },
      // 263 / 15: "?" hints
      263: {
        async mouseUp() {
          if (busy()) return;
          d.cursorOff();
          d.puppetSprite(33, false);
          if (await self.takeMailFirst()) return;
          self.listOfSprites = self.s.propet.house === 0 ? [11, -1, 3, 4, 42, 33, 40, 10, 41, 12, 15, 39, 36, 37] : [11, 34, 3, 4, 42, 33, 40, 10, 41, 12, 15, 39, 36, 37];
          self.hintCast = 'Hints';
          g.enter = 0;
          g.mode = 0;
          d.go('Ques');
        },
      },
      // 14: Ques (hint mode)
      14: {
        exitFrame() {
          if (g.enter === 0) {
            d.cursorOff();
            for (let ch = 45; ch <= 47; ch++) if (!d.sprite(ch).puppet) d.puppetSprite(ch, true);
            g.enter = 1;
            for (const ch of self.listOfSprites) if (ch > 0 && d.sprite(ch).locV < 1000) d.setCursor(ch, 'question');
            self.hand(44);
            d.mouseUpScript = () => self.hint();
          }
          const sp = d.sprite(46);
          if (sp.locV < 1000 && sp.cursor !== HAND) self.hand(46);
          else if (sp.locV > 1000 && sp.cursor) d.setCursor(46, null);
          d.go(d.frame);
        },
      },
      // 20: leave hint mode (44 "?", 46 OK)
      20: {
        mouseDown() {
          if (d.clickOn === 46) d.press();
        },
        mouseUp() {
          g.enter = 0;
          d.cursorOff();
          for (const ch of [45, 46, 47]) d.puppetSprite(ch, false);
          d.mouseUpScript = null;
          d.go('Begin');
        },
      },
      21: { mouseDown: () => d.press() },
      22: { mouseDown() {} },
      // 16: "?" inside construction toggles hint mode
      16: {
        mouseUp() {
          d.cursorOff();
          if (g.mode === 0) {
            self.up(48);
            g.mode = 1;
            for (const ch of self.listOfSprites) if (ch > 0) d.setCursor(ch, 'question');
            d.mouseUpScript = () => self.hint();
          } else {
            d.mouseUpScript = null;
            for (let ch = 45; ch <= 48; ch++) self.down(ch);
            g.mode = 0;
            g.enter = 0;
          }
        },
      },
      // 23: OK of a construction hint
      23: {
        mouseDown: () => d.press(),
        mouseUp() {
          d.mouseUpScript = null;
          d.cursorOff();
          for (let ch = 45; ch <= 48; ch++) self.down(ch);
          g.mode = 0;
          g.enter = 0;
        },
      },

      // ---------------- achievements
      33: {
        exitFrame() {
          if (g.enter === 0) {
            d.cursorOff();
            g.enter = 1;
            if (self.myGoal === 1) {
              for (const ch of [38, 40, 41, 42]) d.puppetSprite(ch, true);
              const s = self.s;
              const score = s.propet.score;
              const goal = s.begin.goal;
              const maxv = s.begin.targets[Math.max(0, goal - 1)] || 1;
              const w1 = Math.min(116, Math.trunc(((s.propet.savings + s.propet.cash) * 116) / maxv));
              const w2 = Math.min(182, Math.trunc((score * 182) / 90));
              d.spriteBox(38, 198, 158, 198 + Math.max(1, w1 + w2), 158 + 18);
              for (let i = 1; i <= 4; i++) {
                d.puppetSprite(30 + i, false);
                d.puppetSprite(30 + i, true);
                if (s.propet.business[i - 1] > 0) self.up(30 + i);
              }
              for (let i = 1; i <= 7; i++) {
                d.puppetSprite(19 + i, true);
                if ((s.propet.ach[i - 1] ?? 0) > 0) self.up(19 + i);
              }
              for (let ch = 27; ch <= 30; ch++) d.setCursor(ch, d.sprite(ch).castNum > 0 ? HAND : null);
              self.hand(39);
            } else {
              for (let ch = 27; ch <= 33; ch++) d.setCursor(ch, d.sprite(ch).castNum > 0 ? HAND : null);
            }
            d.cursor(0);
          }
          d.go(d.frame);
        },
      },
      // 30: tab "FARM"
      30: {
        mouseUp() {
          d.cursor(4);
          g.enter = 0;
          self.leaveGoalPage();
          self.myGoal = 0;
          self.ahievPage2();
          d.go('F1');
          d.cursor(0);
        },
      },
      // 31: tab "GOALS"
      31: {
        mouseUp() {
          g.enter = 0;
          self.myGoal = 1;
          d.go('Goal');
        },
      },
      // 32: tab "MONEY"
      32: {
        mouseUp() {
          g.enter = 0;
          self.leaveGoalPage();
          self.myGoal = 0;
          self.ahievPage1();
          d.go('Propet');
        },
      },
      // 34: back to the map
      34: {
        mouseDown: () => d.press(),
        mouseUp() {
          d.cursorOff();
          self.leaveGoalPage();
          self.myGoal = 0;
          g.enter = 0;
          d.go('Begin');
        },
      },
      // 35: farm sub-pages F1/F2/F3
      35: {
        mouseUp() {
          const n = d.clickOn - 30;
          g.enter = 0;
          if (n === 1) self.ahievPage2();
          else if (n === 2) self.ahievPage3();
          else self.ahievPage4();
          d.go(`F${n}`);
        },
      },
      // 283: the goal text ("G1".."G3") on the goal page
      283: {
        mouseDown: () => d.press(),
        mouseUp() {
          d.cursorOff();
          self.setCastName(41, `G${self.s.begin.goal}`);
          d.setVisible(30, false);
          for (const ch of [40, 41, 42]) self.up(ch);
          self.hand(42);
        },
      },
      284: {
        mouseDown: () => d.press(),
        mouseUp() {
          d.cursorOff();
          for (const ch of [40, 41, 42]) self.down(ch);
          d.setVisible(30, true);
          for (let ch = 27; ch <= 30; ch++) if (d.sprite(ch).castNum > 0) self.hand(ch);
          self.hand(39);
        },
      },

      // ---------------- construction
      64: {
        exitFrame() {
          if (g.enter === 0) {
            g.mode = 0;
            g.enter = 1;
            self.hintCast = 'Hints1';
            self.puppets(18, 31, true);
            self.puppets(44, 48, true);
            self.whatBuild = 0;
            self.wor = self.neib = self.fam = 0;
            self.maxFam = self.s.propet.familyWorkers;
            const items = buildableItems(self.s);
            if (items.includes('barbedFence')) {
              self.setCastName(24, 'Barb');
              self.up(24);
              self.down(23);
              self.listOfSprites = [20, 21, 22, 0, 24];
            } else if (items.includes('woodFence')) {
              self.setCastName(23, 'Wood');
              self.up(23);
              self.down(24);
              self.listOfSprites = [20, 21, 22, 23, 0];
            } else {
              self.down(23);
              self.down(24);
              self.listOfSprites = [20, 21, 22, 0, 0];
            }
            if (items.includes('house')) self.up(20);
            else self.down(20);
            if (items.includes('barn')) self.up(21);
            else self.down(21);
            if (items.includes('windmill')) self.up(22);
            else self.down(22);
            let j = 0;
            for (let i = 1; i <= 5; i++)
              if (d.sprite(19 + i).locV < 1000) {
                j++;
                self.hand(19 + i);
              }
            if (j > 0) {
              self.up(44);
              self.hand(44);
            } else {
              self.down(44);
              d.setCursor(44, null);
            }
            self.hand(31);
          }
          d.go(d.frame);
        },
      },
      65: {
        exitFrame() {
          if (g.enter === 0) {
            self.puppets(18, 33, true);
            self.puppets(45, 48, true);
            self.listOfSprites = [-1, -1, -1, -1, -1, 29, 33, 32, 26, 27, 30, 31];
            g.enter = 1;
            for (const ch of [18, 19, 20, 21, 22, 28, 30, 31, 44]) self.hand(ch);
          }
          d.go(d.frame);
        },
      },
      // 66: leave construction
      66: {
        mouseDown() {
          if (g.mode === 0) d.press();
        },
        mouseUp() {
          if (g.mode !== 0) return;
          d.cursorOff();
          self.puppets(18, 31, false);
          self.puppets(44, 48, false);
          if (g.mmapSound) d.puppetSound(g.mmapSound);
          g.enter = 0;
          d.go('Begin');
        },
      },
      // 67: pick a job
      67: {
        mouseUp() {
          if (g.mode !== 0) return;
          self.whatBuild = d.clickOn - 19;
          d.setField('Wor', String(self.wor));
          d.setField('Neib', String(self.neib));
          d.setField('Fam', String(self.fam));
          self.table();
          g.enter = 0;
          self.puppets(18, 31, false);
          self.puppets(44, 48, false);
          d.go(d.frame + 1);
        },
      },
      69: { mouseDown: () => d.press(), mouseUp: () => ((self.wor = self.wor === 0 ? 5 : self.wor - 1), d.setField('Wor', String(self.wor)), self.table()) },
      70: { mouseDown: () => d.press(), mouseUp: () => ((self.wor = (self.wor + 1) % 6), d.setField('Wor', String(self.wor)), self.table()) },
      71: { mouseDown: () => d.press(), mouseUp: () => ((self.neib = (self.neib + 1) % 4), d.setField('Neib', String(self.neib)), self.table()) },
      72: { mouseDown: () => d.press(), mouseUp: () => ((self.neib = self.neib === 0 ? 3 : self.neib - 1), d.setField('Neib', String(self.neib)), self.table()) },
      75: { mouseDown: () => d.press(), mouseUp: () => ((self.fam = self.fam === self.maxFam ? 0 : self.fam + 1), d.setField('Fam', String(self.fam)), self.table()) },
      231: { mouseDown: () => d.press(), mouseUp: () => ((self.fam = self.fam === 0 ? self.maxFam : self.fam - 1), d.setField('Fam', String(self.fam)), self.table()) },
      // 73: OK -> build
      73: {
        mouseDown() {
          if (g.mode === 0) d.press();
        },
        async mouseUp() {
          if (g.mode !== 0 || busy()) return;
          d.cursorOff();
          g.enter = 0;
          const item = BUILD_OF[self.whatBuild - 1];
          await c.run({ type: 'build', item, helpers: { workers: self.wor, neighbors: self.neib, family: self.fam } });
          if (self.alive) self.afterConstruction();
        },
      },
      // 74: Cancel
      74: {
        mouseDown() {
          if (g.mode === 0) d.press();
        },
        mouseUp() {
          if (g.mode !== 0) return;
          d.cursorOff();
          self.afterConstruction();
        },
      },

      // ---------------- livestock market
      86: {
        exitFrame() {
          d.cursorOff();
          for (let ch = 20; ch <= 22; ch++) {
            d.setVisible(ch, true);
            d.puppetSprite(ch, true);
          }
          const p = self.s.propet;
          if (p.horses + p.pigs + p.cows > 1) {
            self.up(21);
            self.hand(21);
          }
          self.hand(20, 22);
        },
      },
      87: {
        exitFrame() {
          d.go(d.frame);
        },
      },
      85: {
        mouseDown: () => d.press(),
        mouseUp() {
          d.cursorOff();
          d.puppetSound(0);
          for (const ch of [20, 21, 22]) d.puppetSprite(ch, false);
          if (d.clickOn === 20) {
            self.myChoice = 1;
            d.go('BuySell');
          } else if (d.clickOn === 21) {
            self.myChoice = 2;
            d.go('BuySell');
          } else {
            edStopBgMusic(c);
            if (g.mmapSound) d.puppetSound(g.mmapSound);
            g.enter = 0;
            d.go('Begin');
          }
        },
      },
      83: {
        exitFrame() {
          for (const ch of [19, 41, 42, 43]) d.puppetSprite(ch, true);
          self.setCastName(19, self.myChoice === 1 ? 'Buy' : 'Sell');
          self.up(19);
          self.buySell();
          for (let ch = 34; ch <= 39; ch++) self.hand(ch);
          self.hand(21);
          d.setVisible(20, false);
        },
      },
      84: {
        exitFrame() {
          const sum = self.anim[0] + self.anim[1] + self.anim[2];
          if (sum === 0 && d.sprite(20).visible) {
            d.setVisible(20, false);
            d.setCursor(20, null);
          } else if (sum > 0 && !d.sprite(20).visible) {
            d.setVisible(20, true);
            self.hand(20);
          }
          d.go(d.frame);
        },
      },
      90: { mouseDown: () => d.press(), mouseUp: () => (d.puppetSound(0), self.animClick(d.clickOn - 37, -1)) },
      91: { mouseDown: () => d.press(), mouseUp: () => (d.puppetSound(0), self.animClick(d.clickOn - 34, 1)) },
      // 88: OK (buy / sell)
      88: {
        mouseDown: () => d.press(),
        async mouseUp() {
          if (busy()) return;
          const s = self.s;
          const a = { horses: self.anim[0], pigs: self.anim[1], cows: self.anim[2] };
          if (self.myChoice === 1 && self.myTotal <= s.propet.cash) {
            d.puppetSound(0);
            d.cursorOff();
            for (const ch of [19, 41, 42, 43]) d.puppetSprite(ch, false);
            await c.run({ type: 'buyLivestock', ...a });
            g.enter = 0;
            d.go('LVST');
          } else if (self.myChoice === 2) {
            d.cursorOff();
            for (const ch of [19, 41, 42, 43]) d.puppetSprite(ch, false);
            await c.run({ type: 'sellLivestock', ...a });
            d.go('LVST');
          } else {
            d.cursorOff();
            for (const ch of [41, 42, 43]) self.up(ch);
            self.hand(43);
          }
        },
      },
      // 89: Cancel
      89: {
        mouseDown: () => d.press(),
        mouseUp() {
          d.cursorOff();
          d.puppetSound(0);
          d.setVisible(20, true);
          for (const ch of [19, 41, 42, 43]) d.puppetSprite(ch, false);
          d.go('LVST');
        },
      },
      // 180: OK of "not enough money"
      180: {
        mouseDown: () => d.press(),
        mouseUp() {
          d.cursorOff();
          for (const ch of [41, 42, 43]) self.down(ch);
          self.hand(20, 21);
        },
      },

      // ---------------- trivia (MovieScript 700, ScoreScripts 701-706)
      701: {
        exitFrame() {
          const q = self.s.extra.triviaQuestion || 1;
          for (let ch = 19; ch <= 28; ch++) d.puppetSprite(ch, true);
          self.lastRoll = 0;
          // edShowScreen
          const BONUS = [20, 20, 30, 10, 10, 20, 30, 30, 30, 20, 10, 10, 20, 20, 30, 30];
          const QUEY = [146, 146, 138, 137, 146, 137, 156, 146, 137, 146, 156, 137, 135, 146, 146, 146];
          for (let ch = 19; ch <= 22; ch++) self.setCastName(ch, `bon${BONUS[q - 1]}`);
          self.setCastName(23, `pic${q}`);
          self.setCastName(24, `triv${q}`);
          for (let k = 1; k <= 4; k++) {
            const name = `ans${q}${k}`;
            self.setCastName(24 + k, name);
            self.fieldColor(name, 255);
            self.hand(24 + k);
          }
          d.setLocV(24, QUEY[q - 1]);
          d.setLocV(25, 192 - 17 * +(q === 3) - +(q === 12) - 22 * +(q === 13));
          d.setLocV(26, 212 - 16 * +(q === 3) - 5 * +(q === 12) - 8 * +(q === 13));
          d.setLocV(27, 232 - 8 * +(q === 12) - 9 * +(q === 13));
          d.setLocV(28, 252 - 10 * +(q === 12) + 6 * +(q === 13));
          for (let ch = 19; ch <= 28; ch++) self.up(ch);
        },
      },
      702: {
        exitFrame() {
          let roll = 0;
          for (let ch = 25; ch <= 28; ch++) {
            if (d.rollOver(ch)) {
              roll = d.sprite(ch).castNum;
              if (roll !== self.lastRoll) {
                if (self.lastRoll > 0) self.fieldColor(d.member(self.lastRoll)!.name, 255);
                self.fieldColor(d.member(roll)!.name, 249);
                self.lastRoll = roll;
              }
            }
          }
          if (roll === 0 && self.lastRoll > 0) {
            self.fieldColor(d.member(self.lastRoll)!.name, 255);
            self.lastRoll = 0;
          }
          d.go(d.frame);
        },
      },
      703: {
        async mouseUp() {
          if (busy()) return;
          const ans = d.clickOn - 24;
          for (let ch = 23; ch <= 28; ch++) {
            d.puppetSprite(ch, false);
            d.setCursor(ch, null);
          }
          const r = await c.run({ type: 'answerTrivia', answer: ans });
          const ev = r?.events.find((e) => e.type === 'triviaAnswered') as Extract<SimEvent, { type: 'triviaAnswered' }> | undefined;
          d.puppetSound(ev?.correct ? 'ECONOM45' : 'ACHOOO2');
          d.go('RightAns');
        },
      },
      704: {
        exitFrame() {
          const q = self.s.extra.triviaQuestion || 1;
          const X = [211, 198, 211, 211, 211, 211, 211, 206, 211, 203, 211, 211, 211, 211, 211, 211];
          const Y = [169, 140, 169, 169, 169, 169, 169, 140, 169, 148, 169, 169, 158, 169, 169, 164];
          d.puppetSprite(23, true);
          self.setCastName(23, `right${q}`);
          d.setLoc(23, X[q - 1], Y[q - 1]);
        },
      },
      705: {
        exitFrame() {
          if (!d.sprite(24).cursor) self.hand(24);
          d.go(d.frame);
        },
      },
      706: {
        mouseDown: () => d.press(),
        mouseUp() {
          // edLeave
          d.setCursor(24, null);
          d.puppetSound(0);
          for (let ch = 18; ch <= 28; ch++) {
            if (d.sprite(ch).puppet) d.puppetSprite(ch, false);
            d.setVisible(ch, true);
          }
          g.enter = 0;
          d.go('Begin');
        },
      },

      // ---------------- options menu (Opt), start over, exit
      79: {
        exitFrame() {
          if (g.enter === 0) {
            g.enter = 1;
            for (let ch = 21; ch <= 25; ch++) {
              d.puppetSprite(ch, true);
              self.hand(ch);
            }
          }
          for (const ch of [21, 22, 23, 24, 25]) {
            const base = d.castNumber(`Menu${ch - 20}`);
            d.setCast(ch, d.rollOver(ch) ? base + 1 : base);
          }
          d.go(d.frame);
        },
      },
      80: {
        async mouseUp() {
          const click = d.clickOn;
          d.cursorOff();
          for (let ch = 21; ch <= 25; ch++) d.puppetSprite(ch, false);
          if (click === 21) {
            g.enter = 0;
            d.go('Begin');
          } else if (click === 22) {
            d.go(d.frame + 1);
          } else if (click === 23) {
            d.cursor(4);
            await game.save('board');
            d.cursor(0);
            g.enter = 0;
            d.go('Begin');
          } else if (click === 24) {
            d.cursor(4);
            g.introReturn = 'Start';
            g.runningMode = 'oldGame';
            g.enter = 0;
            d.puppetSound(0);
            for (let i = 1; i <= 48; i++) d.puppetSprite(i, false);
            await c.goMovie('INTRO');
          } else if (click === 25) {
            g.enter = 0;
            d.setField('CurFDBK', 'Do you want to save your game?');
            d.go('Exit');
          }
        },
      },
      170: {
        exitFrame() {
          if (!d.sprite(29).cursor) self.hand(29, 30);
          d.go(d.frame);
        },
      },
      179: {
        mouseDown: () => d.press(),
        async mouseUp() {
          d.cursorOff();
          g.enter = 0;
          if (d.clickOn === 29) {
            // NewStart(): a new game starts in INTRO (goal + claim form)
            d.cursor(4);
            g.introReturn = 'Start';
            g.runningMode = 'newGame';
            d.puppetSound(0);
            for (let i = 1; i <= 48; i++) d.puppetSprite(i, false);
            await c.goMovie('INTRO');
          } else d.go('Opt');
        },
      },
      81: {
        exitFrame() {
          if (g.enter === 0) {
            g.enter = 1;
            for (const ch of [30, 31, 32]) d.puppetSprite(ch, false);
            const sp = d.sprite(21);
            if (sp.locV > 1000) d.setLocV(21, sp.locV - 1000);
            self.hand(30, 31, 32);
          }
          d.go(d.frame);
        },
      },
      // 38: Yes (save) / No -> halt
      38: {
        mouseDown: () => d.press(),
        async mouseUp() {
          d.cursorOff();
          await c.quit(d.clickOn === 30);
        },
      },
      // 98: Cancel
      98: {
        mouseDown: () => d.press(),
        mouseUp() {
          d.cursorOff();
          g.enter = 0;
          d.go('Begin');
        },
      },
      // 164: Intro label
      164: {
        exitFrame() {
          void c.goMovie('INTRO');
        },
      },
    };
  }

  /** Show a message box the way the board scripts did (`put field X into CurFDBK; go "Mes"`). */
  message(id: string, dbox: string) {
    return makePresenter(this).info!(this.s, { type: 'dialog', id, dbox });
  }

  module(): MovieModule {
    const self = this;
    return {
      startFrame: 'Start',
      scripts: this.scripts(),
      startMovie() {
        self.g.enter = 0;
        self.g.mode = 0;
        self.g.retFromE = 'Begin';
        self.d.mouseUpScript = null;
        if (self.c.state) {
          self.d.setField('MyName', `${self.s.name.first} ${self.s.name.last}`.trim());
          self.syncFields(false);
        }
      },
      stopMovie() {
        self.alive = false;
        self.d.mouseUpScript = null;
        self.dlg.resolve?.(undefined as never);
        self.dlg.cur = null;
        self.dlg.resolve = null;
        self.flipDone?.();
        self.flipDone = null;
      },
      presenter: makePresenter(this),
      view: {
        animate: (events) => this.animate(events),
        sync: () => this.sync(),
      },
    };
  }

  /** run a prompt answer through the presenter chain (used by dialogs that need the sim) */
  answer(cmd: Command) {
    return cmd;
  }
}
