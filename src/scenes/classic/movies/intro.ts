// INTRO.DIR: the narrated "Go West" slideshow (INTRO1/2/3.MOV narration with cue -> frame
// tables), the goal balloons, the homestead claim form with its pen signature, and the
// stagecoach driver. Ports INTRO MovieScript 91, CastScript 118 (slideShow control), 101/102
// (balloons), SHARED 3201 (animation object, simplified) and ScoreScripts 4-123.
// Spec: docs/spec/01-framework.md §7 and Appendix B.
import type { MovieFactory } from '../context.ts';
import type { Handlers } from '../dir/player.ts';
import { extUrl } from '../dir/cast.ts';
import { csound } from '../dir/sound.ts';
import { frameLabelHere, marker, parsePropList } from '../front/util.ts';
import { quirk } from '../shared/common.ts';

/** Narration lengths (s) when the browser cannot report them (spec §7.1). */
const DURATIONS = [137.7, 16.0, 30.6];
const NARRATION_CH = 3;
const TICKS = 60;

interface Anim {
  ch: number;
  start: number;
  end: number;
  cur: number;
  playing: boolean;
  staticCast: number;
}

/** INTRO's sProperCase (MovieScript 91): ASCII only, capitals after spaces. */
function sProperCase(s: string) {
  let out = '';
  let first = true;
  for (const ch of s) {
    const n = ch.charCodeAt(0);
    if (first) {
      out += n > 96 && n < 123 ? ch.toUpperCase() : ch;
      first = false;
      continue;
    }
    if (n === 32) {
      first = true;
      out += ch;
      continue;
    }
    out += n > 64 && n < 91 ? ch.toLowerCase() : ch;
  }
  return out;
}

const factory: MovieFactory = (c) => {
  const d = c.d;
  const mode: 'newGame' | 'oldGame' = c.state ? 'oldGame' : 'newGame';
  c.g.runningMode = mode;

  // ------------------------------------------------------------ narration ("the QT sprite")
  const nar = { seg: 0, t0: 0, dur: 0, ended: true };
  const movieTime = () => (nar.ended ? nar.dur * TICKS : Math.min(nar.dur, (performance.now() - nar.t0) / 1000) * TICKS);
  /** `the movieRate of sprite gQTSpriteNum <> 0` */
  const playing = () => !nar.ended && (performance.now() - nar.t0) / 1000 < nar.dur;

  async function startNarration(seg: number) {
    nar.seg = seg;
    nar.dur = DURATIONS[seg - 1];
    nar.ended = false;
    nar.t0 = performance.now();
    const url = await extUrl(`DATA\\QT\\INTRO\\INTRO${seg}.wav`);
    if (url && !nar.ended && nar.seg === seg) {
      await csound.play(NARRATION_CH, url);
      if (csound.busy(NARRATION_CH)) {
        nar.t0 = performance.now() - Math.max(0, csound.time(NARRATION_CH)) * 1000;
        nar.dur = csound.duration(NARRATION_CH) || nar.dur;
      }
    }
  }

  function endNarration() {
    nar.ended = true;
    csound.stop(NARRATION_CH);
  }

  // ------------------------------------------------------------ slideshow control (CastScript 118)
  let show: { cur: number; last: number; ques: Map<number, number>; frames: Map<number, number>; loopOne: boolean; inStep: boolean } | null = null;

  function birthSlideShow(seg: 1 | 2 | 3) {
    const suffix = seg === 1 ? '' : String(seg);
    const ques = parsePropList(d.field(`the queue field${suffix}`));
    const frames = parsePropList(d.field(`the que frames field${suffix}`));
    const keys = [...ques.keys()];
    show = { cur: 0, last: keys[keys.length - 1] ?? 0, ques, frames, loopOne: false, inStep: false };
    void startNarration(seg);
  }

  function stepFrame() {
    const s = show;
    if (!s || s.inStep) return;
    s.inStep = true;
    let next = -1;
    if (s.cur !== s.last) {
      const t = movieTime();
      while (s.cur < s.last && t >= (s.ques.get(s.cur + 1) ?? Infinity)) {
        s.cur++;
        next = s.frames.get(s.cur) ?? next;
      }
    }
    if (next < 1) next = d.frame + 1 === marker(d, 1) ? (s.loopOne ? d.frame : marker(d, 0)) : d.frame + 1;
    d.go(next);
    // edUpdateLoopMode reads the label of the frame being left
    const lbl = frameLabelHere(d);
    if (lbl) s.loopOne = lbl.split(',').pop() === 'loopOneFrame';
    s.inStep = false;
  }

  // ------------------------------------------------------------ animation objects (edANOpen)
  const anims = new Map<number, Anim>();
  let animAcc = 0;
  function anOpen(ch: number, startCast?: number): Anim | null {
    const start = startCast ?? d.sprite(ch).castNum;
    const sm = d.member(start);
    if (!sm) return null;
    // the end is the first member after start named "AN <name>,end"
    let end = start;
    for (let id = start; id < start + 40; id++) {
      const m = d.member(id);
      if (m && /^AN .*,end$/.test(m.name)) {
        end = id;
        break;
      }
    }
    const a: Anim = { ch, start, end, cur: start, playing: false, staticCast: d.sprite(ch).castNum };
    anims.set(ch, a);
    return a;
  }
  function anPlay(a: Anim | null) {
    if (!a) return;
    a.cur = a.start;
    a.playing = true;
    d.puppetSprite(a.ch, true);
    d.setCast(a.ch, a.cur);
  }
  function anStop(a: Anim | null) {
    if (a) a.playing = false;
  }
  function anClose(a: Anim | null) {
    if (!a) return;
    a.playing = false;
    anims.delete(a.ch);
  }

  // ------------------------------------------------------------ zoomBox
  const lastRect = new Map<number, { left: number; top: number; right: number; bottom: number }>();
  let zoom: { a: { left: number; top: number; right: number; bottom: number }; b: { left: number; top: number; right: number; bottom: number }; k: number } | null = null;
  const rectOf = (ch: number) => {
    const s = d.sprite(ch);
    if (s.member && s.onStage) return s.rect();
    return lastRect.get(ch) ?? { left: 320, top: 240, right: 320, bottom: 240 };
  };
  async function zoomBox(a: number, b: number, delayTicks: number) {
    const ra = rectOf(a);
    const rb = rectOf(b);
    const steps = 10;
    for (let k = 1; k <= steps; k++) {
      zoom = { a: ra, b: rb, k: k / steps };
      d.updateStage();
      await d.delay(Math.max(1, delayTicks) * (1000 / TICKS) * 2);
    }
    zoom = null;
    d.updateStage();
  }

  // ------------------------------------------------------------ goal balloons (ScoreScript 37/38)
  const BTNS = { farmer: 6, business: 8, political: 10, OK: 13 } as const;
  const PANELS = { smallPannel: 11, bigPannel: 12 } as const;
  type Goal = 'farmer' | 'business' | 'political';
  const GOALS: Goal[] = ['farmer', 'business', 'political'];
  const balloons = new Map<Goal, { ch: number; anim: Anim | null; selected: boolean; sound: number; staticCast: number }>();
  let theGoal: Goal | null = null;
  let afterEnter: (() => void) | null = null;

  function initGoalsFrame() {
    d.puppetSound('whatIsYourGoal?');
    d.puppetSprite(PANELS.bigPannel, true);
    d.puppetSprite(BTNS.OK, true);
    d.setCursor(BTNS.OK, 'hand');
    balloons.clear();
    for (const g of GOALS) {
      const ch = BTNS[g];
      const castName = d.sprite(ch).member?.name ?? '';
      d.puppetSprite(ch, true);
      const staticCast = d.sprite(ch).castNum;
      const anim = anOpen(ch, d.castNumber(`AN ${castName},start`));
      if (!anim) {
        // the original alerted "Baloon Object creation error:" here
        continue;
      }
      balloons.set(g, { ch, anim, selected: false, sound: d.castNumber(`SND ${castName}`), staticCast });
      d.setCursor(ch, 'hand');
    }
    theGoal = null;
  }

  function doClick(goal: Goal) {
    for (const [g, b] of balloons) {
      const on = g === goal;
      if (on && b.sound) d.puppetSound(b.sound, 4);
      if (on === b.selected) continue;
      b.selected = on;
      if (on) anPlay(b.anim);
      else {
        anStop(b.anim);
        d.setCast(b.ch, b.staticCast);
      }
    }
  }

  function showOKBtn() {
    for (const ch of [PANELS.bigPannel, BTNS.OK]) {
      const s = d.sprite(ch);
      if (s.locH > 1000) d.setLocH(ch, s.locH - 1000);
    }
  }

  function leaveGoals() {
    for (const b of balloons.values()) {
      anClose(b.anim);
      d.puppetSprite(b.ch, false);
      d.setCursor(b.ch, null);
    }
    balloons.clear();
    d.puppetSprite(PANELS.bigPannel, false);
    d.puppetSprite(BTNS.OK, false);
    d.setCursor(BTNS.OK, null);
  }

  function initSecondQue() {
    d.go(marker(d, mode === 'newGame' ? 1 : 2));
    birthSlideShow(2);
  }

  // ------------------------------------------------------------ claim form (ScoreScripts 45, 53, 58-60)
  const TEXT = { refresh: 3, firstName: 4, lastName: 5, sign: 6 } as const;
  const FBTN = { clear: 7, OK: 8 } as const;
  type FillKey = 'firstName' | 'lastName' | 'sign';
  let isFilled = false;
  const filled = new Set<FillKey>();
  let lastEditable = 0;
  /** signature ink: line segments in stage coordinates */
  const ink: [number, number, number, number][] = [];
  let names = { first: '', last: '' };
  let goalNum = 1;

  function initClaimForm() {
    d.puppetSound('SND claim form clerk');
    d.setCursor(TEXT.sign, 'pen');
    d.setCursor(FBTN.clear, 'hand');
    d.setCursor(FBTN.OK, 'hand');
    for (const ch of [FBTN.OK, TEXT.firstName, TEXT.lastName]) d.puppetSprite(ch, true);
    isFilled = false;
    filled.clear();
  }

  function updateFilledFlag(which: FillKey, state: boolean) {
    if (state) filled.add(which);
    else filled.delete(which);
    const ok = d.sprite(FBTN.OK);
    if ((isFilled && filled.size === 3) || (!isFilled && filled.size < 3)) return;
    if (filled.size === 3 && ok.locH > 640) {
      isFilled = true;
      d.setLocH(FBTN.OK, ok.locH - 1000);
    } else if (filled.size < 3 && ok.locH < 640) {
      isFilled = false;
      d.setLocH(FBTN.OK, ok.locH + 1000);
    }
  }

  function initThirdQue() {
    d.go(marker(d, mode === 'newGame' ? 1 : 2));
    birthSlideShow(3);
  }

  // ------------------------------------------------------------ the end (ScoreScript 119)
  let leaving = false;
  async function leave() {
    if (leaving) return;
    leaving = true;
    d.cursor(4);
    show = null;
    endNarration();
    for (const a of [...anims.values()]) anClose(a);
    d.stop();
    if (mode === 'newGame') await c.startGame(names.first, names.last, goalNum);
    else await c.goMovie('CALEND', c.g.introReturn);
  }

  const swallow: Handlers = { mouseDown: () => undefined, mouseUp: () => undefined };
  const zoomScript = (a: number, b: number): Handlers => ({ exitFrame: () => zoomBox(a, b, 1) });

  return {
    startFrame: 2,
    startMovie() {
      d.cursor(4);
      // edInitSlideShowFields
      const st = c.state;
      d.setField("form's FirstName", st ? st.name.first : '');
      d.setField("form's LastName", st ? st.name.last : '');
      names = { first: st?.name.first ?? '', last: st?.name.last ?? '' };
      goalNum = st?.begin.goal ?? 1;
      birthSlideShow(1);
      d.cursor(0);
    },
    stopMovie() {
      endNarration();
      csound.stop(4);
    },
    update(dt) {
      // the actorList: animation objects step once per frame at the movie tempo
      animAcc += dt;
      const period = 1 / Math.max(1, d.frameTempo);
      if (animAcc < period) return;
      animAcc = 0;
      for (const a of anims.values()) {
        if (!a.playing) continue;
        a.cur = a.cur >= a.end ? a.start : a.cur + 1;
        d.setCast(a.ch, a.cur);
      }
      for (let ch = 1; ch <= 48; ch++) {
        const s = d.sprite(ch);
        if (s.member && s.onStage) lastRect.set(ch, s.rect());
      }
    },
    afterDraw(ctx) {
      if (zoom) {
        const { a, b, k } = zoom;
        const lerp = (x: number, y: number) => Math.round(x + (y - x) * k);
        const r = { left: lerp(a.left, b.left), top: lerp(a.top, b.top), right: lerp(a.right, b.right), bottom: lerp(a.bottom, b.bottom) };
        ctx.globalCompositeOperation = 'difference';
        ctx.fillStyle = '#fff';
        ctx.fillRect(r.left, r.top, r.right - r.left, 1);
        ctx.fillRect(r.left, r.bottom - 1, r.right - r.left, 1);
        ctx.fillRect(r.left, r.top, 1, r.bottom - r.top);
        ctx.fillRect(r.right - 1, r.top, 1, r.bottom - r.top);
        ctx.globalCompositeOperation = 'source-over';
      }
      // the signature ink stays on the stage while the claim form is shown
      if ((d.frame === 42 || d.frame === 45) && ink.length) {
        // ScoreScript 53: PC draws with MovUtils mDrawLine colour 4, the Mac branch with 255 - 4:
        // the authors mirrored the index for the Mac palette order our palettes use, so the pen is
        // Mac/Director index 251 (navy #000080 in palette 3, active on the claim form)
        ctx.fillStyle = d.color(251);
        for (const [x0, y0, x1, y1] of ink) plotLine(ctx, x0, y0, x1, y1);
      }
    },
    movie: {
      exitFrame: () => stepFrame(),
      mouseUp() {
        if (mode === 'newGame') {
          // onMouseUp: the narration jumps to its end, so the remaining cues fire at once
          if (show) endNarration();
        } else void leave();
      },
    },
    scripts: {
      4: { exitFrame: () => stepFrame() },
      23: zoomScript(7, 9),
      25: zoomScript(9, 7),
      26: zoomScript(8, 9),
      28: zoomScript(9, 8),
      // 37: end of segment 1
      37: {
        enterFrame() {
          if (playing()) return;
          show = null;
          d.cursor(4);
          if (mode === 'newGame') {
            d.go(marker(d, 1));
            afterEnter = initGoalsFrame;
          } else initSecondQue();
          d.cursor(0);
        },
      },
      // 43: the goal screen loops and swallows stray clicks
      43: {
        enterFrame() {
          const f = afterEnter;
          afterEnter = null;
          f?.();
        },
        exitFrame: () => d.go(d.frame),
        ...swallow,
      },
      // 38: the balloons and OK
      38: {
        mouseDown() {
          if (d.clickOn === BTNS.OK) d.press();
        },
        mouseUp() {
          csound.stop(4);
          c.g.introReturn = 'Start';
          const ch = d.clickOn;
          if (ch === BTNS.OK) {
            goalNum = theGoal ? GOALS.indexOf(theGoal) + 1 : 1;
            leaveGoals();
            initSecondQue();
            return;
          }
          const g = GOALS.find((x) => BTNS[x] === ch);
          if (!g) return;
          if (!theGoal) showOKBtn();
          theGoal = g;
          doClick(g);
        },
      },
      // 45: end of segment 2 -> claim form (or segment 3 in #oldGame)
      45: {
        exitFrame() {
          if (playing()) {
            d.go(marker(d, 0));
            return;
          }
          show = null;
          if (mode === 'newGame') {
            d.go(marker(d, 1));
            afterEnter = initClaimForm;
          } else initThirdQue();
        },
      },
      47: { enterFrame() {} },
      // 61: the claim form loops; names count as filled while non-empty (keyUp in script 58)
      61: {
        enterFrame() {
          const f = afterEnter;
          afterEnter = null;
          f?.();
        },
        exitFrame() {
          updateFilledFlag('firstName', d.field("form's FirstName") !== '');
          updateFilledFlag('lastName', d.field("form's LastName") !== '');
          d.go(d.frame);
        },
        ...swallow,
      },
      // 58: the name fields
      58: {
        mouseDown() {
          const ch = d.clickOn;
          if (lastEditable) d.setEditable(lastEditable, false);
          lastEditable = ch;
          d.setEditable(ch, true);
          d.focus = ch;
        },
        keyDown(k: string) {
          return !(k === 'Enter' || k === 'Escape');
        },
      },
      // 53: the signature (pen) hotspot
      53: {
        async mouseDown() {
          const me = d.clickOn;
          const off = [-5, 8];
          let p = [d.mouseH + off[0], d.mouseV + off[1]];
          await d.trackMouse(() => {
            if (!d.rollOver(me)) return;
            const last = p;
            const q = [d.mouseH + off[0], d.mouseV + off[1]];
            if ((q[0] !== last[0] || q[1] !== last[1]) && d.rollOver(me)) {
              ink.push([last[0], last[1], q[0], q[1]]);
              p = q;
              d.updateStage();
            }
          });
          updateFilledFlag('sign', true);
        },
      },
      // 59: clear (eraser)
      59: {
        mouseDown: () => d.press(),
        mouseUp() {
          ink.length = 0;
          updateFilledFlag('sign', false);
          d.updateStage();
        },
      },
      // 60: OK on the claim form
      60: {
        mouseDown: () => d.press(),
        mouseUp() {
          d.puppetSound(0);
          d.setField("form's FirstName", sProperCase(d.field("form's FirstName")));
          d.setField("form's LastName", sProperCase(d.field("form's LastName")));
          names = { first: d.field("form's FirstName"), last: d.field("form's LastName") };
          d.puppetSprite(FBTN.OK, false);
          for (const ch of [FBTN.OK, FBTN.clear, TEXT.sign]) d.setCursor(ch, null);
          d.puppetSprite(TEXT.firstName, false);
          d.puppetSprite(TEXT.lastName, false);
          if (lastEditable) d.setEditable(lastEditable, false);
          d.focus = 0;
          initThirdQue();
        },
      },
      // 56: the start of segment 3 swallows clicks
      56: { ...swallow },
      // 123: create the driver's head and hand animation objects
      123: {
        exitFrame() {
          anOpen(3);
          anOpen(4);
          stepFrame();
        },
      },
      // 121: start them. INTROHAND (quirk 13): the original's typo (gHnadAnimObj) left the
      // hand still; with the fix the remake animates both.
      121: {
        exitFrame() {
          anPlay(anims.get(3) ?? null);
          if (!quirk(c, 'INTROHAND')) anPlay(anims.get(4) ?? null);
        },
      },
      // 119: when the narration ends, on to the game board
      119: {
        exitFrame() {
          if (playing()) {
            stepFrame();
            return;
          }
          void leave();
        },
      },
    },
  };
};

/** Bresenham line of 3x3 dots (MovUtils mDrawLine, width 3). */
function plotLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 2000; guard++) {
    ctx.fillRect(x0 - 1, y0 - 1, 3, 3);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export default factory;
