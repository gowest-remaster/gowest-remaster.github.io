// Helpers shared by the town movies (TSTREET1, STORE, BANK09): spoken lines from cast sounds,
// the SHARED animation object (edANOpen / stepFrame), the location bars' destinations, the
// pen signature pads of the bank forms, and the shared fields (MyName, CurrentDate...).
import type { ClassicContext, MovieName } from '../context.ts';
import type { Member } from '../dir/cast.ts';
import { csound } from '../dir/sound.ts';
import { YEAR_GB } from '../dir/lingo.ts';
import { castDate, syncMoney } from '../shared/common.ts';

/** A sound cast member by name (movie cast first, then SHARED), case-insensitive. */
export function soundMember(c: ClassicContext, name: string): Member | null {
  const mv = c.d.movie;
  if (!mv) return null;
  const n = name.toLowerCase();
  for (const lib of [mv.lib, mv.shared]) for (const m of lib.members.values()) if (m.type === 'sound' && m.name.toLowerCase() === n) return m;
  return null;
}

/** `puppetSound "name"` for the town's spoken lines (one-shot, channel 1 by default). */
export function say(c: ClassicContext, name: string, ch = 1) {
  const m = soundMember(c, name);
  if (m) c.d.puppetSound(m.id, ch);
  else c.d.puppetSound(0, ch);
}

/** `sound playFile ch, "<sound>\TStreet\<n>.WAV"` */
export function playFile(path: string, ch = 1) {
  return csound.playFile(ch, path);
}

/**
 * SHARED "Animation object script" (edANOpen): steps a sprite through a cast range once per
 * movie frame; loops N times or forever, or until a sound channel goes quiet (sound synch).
 */
export class Anim {
  private cur = 0;
  private loops = 1;
  playing = false;
  endScript: (() => void) | null = null;
  private acc = 0;
  private c: ClassicContext;
  ch: number;
  start: number;
  end: number;
  loop: number | 'forever';
  synch = 0;

  constructor(c: ClassicContext, ch: number, start: number, end: number, loop: number | 'forever' = 'forever') {
    this.c = c;
    this.ch = ch;
    this.start = start;
    this.end = end;
    this.loop = loop;
  }

  /** `edANOpen(sprite, "X", "XEnd")` with cast names. */
  static named(c: ClassicContext, ch: number, start: string, end: string, loop: number | 'forever' = 'forever') {
    return new Anim(c, ch, c.d.castNumber(start), c.d.castNumber(end), loop);
  }

  play() {
    this.c.d.puppetSprite(this.ch, true);
    this.cur = this.start;
    this.loops = 1;
    this.c.d.setCast(this.ch, this.cur);
    this.playing = true;
    this.acc = 0;
  }

  /** edANStop: stop and give the sprite back to the score (start art). */
  stop() {
    if (!this.playing) return;
    this.playing = false;
    this.c.d.setCast(this.ch, this.start);
  }

  private finish() {
    this.playing = false;
    const f = this.endScript;
    this.endScript = null;
    f?.();
  }

  /** Called every animation frame; steps at the movie's tempo (stepFrame). */
  update(dt: number) {
    if (!this.playing) return;
    this.acc += dt;
    const period = 1 / Math.max(1, this.c.d.frameTempo);
    if (this.acc < period) return;
    this.acc -= period;
    if (this.acc > period) this.acc = 0;
    if (this.cur < this.end) this.cur++;
    else if (this.loop === 'forever') this.cur = this.start;
    else if (this.loops < this.loop) {
      this.loops++;
      this.cur = this.start;
    } else return this.finish();
    this.c.d.setCast(this.ch, this.cur);
    if (this.synch && !csound.busy(this.synch)) {
      this.stop();
      this.finish();
    }
  }
}

/** Shared fields the town shows: date, money, name. */
export function townFields(c: ClassicContext) {
  const s = c.state;
  if (!s) return;
  castDate(c);
  syncMoney(c, false);
  const mon = YEAR_GB[s.date.mon - 1];
  c.d.setField('CurrentDate', `${mon} ${s.date.day}, ${s.date.year}`);
  c.d.setField('MyName', `${s.name.first} ${s.name.last}`);
}

export type Destination = 'Field' | 'House' | 'Store' | 'Bank09' | 'TStreet1' | 'Calend';

/** The location bars' `go(...)` targets. */
export function goTo(c: ClassicContext, where: Destination) {
  const s = c.state;
  const year = s?.date.year ?? 1880;
  csound.stop(1);
  let movie: MovieName = 'CALEND';
  let frame: string | number | undefined;
  switch (where) {
    case 'Field':
      movie = 'FIELD';
      break;
    case 'House': {
      const wh = s?.globals.whatHouse ?? 1;
      movie = wh >= 3 ? 'HOUSE3' : wh === 2 ? 'HOUSE2' : 'HOUSE1';
      break;
    }
    case 'Store':
      movie = 'STORE';
      break;
    case 'Bank09':
      movie = 'BANK09';
      break;
    case 'TStreet1':
      movie = 'TSTREET1';
      frame = year < 1890 ? 'S1' : 'S2';
      break;
    case 'Calend':
      movie = 'CALEND';
      frame = 'Start';
      break;
  }
  void c.goMovie(movie, frame);
}

/** Does the farm have a house (Propet 7.6) for the location bar's House button. */
export const hasHouse = (c: ClassicContext) => (c.state?.propet.house ?? 0) > 0;

/**
 * The pen pad of the bank forms (ScoreScript 33, MovUtils mDrawLine width 2, colour 251):
 * strokes are kept as segments and drawn after the sprites; the eraser clears them.
 */
export class SignaturePad {
  segs: [number, number, number, number][] = [];
  private c: ClassicContext;
  constructor(c: ClassicContext) {
    this.c = c;
  }
  async draw(ch: number) {
    const d = this.c.d;
    let lx = d.mouseH;
    let ly = d.mouseV;
    await d.trackMouse(() => {
      if (d.rollOver(ch)) {
        this.segs.push([lx, ly, d.mouseH, d.mouseV]);
        d.updateStage();
      }
      lx = d.mouseH;
      ly = d.mouseV;
    });
  }
  clear() {
    this.segs = [];
    this.c.d.updateStage();
  }
  render(ctx: CanvasRenderingContext2D) {
    if (!this.segs.length) return;
    ctx.strokeStyle = this.c.d.color(251);
    ctx.lineWidth = 2;
    ctx.lineCap = 'square';
    ctx.beginPath();
    for (const [a, b, x, y] of this.segs) {
      ctx.moveTo(a, b);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** Hide (+1000) / show (-1000) on both axes, as STORE's edHideIcon / edShowIcon. */
export function hideIcon(c: ClassicContext, ch: number) {
  const s = c.d.sprite(ch);
  if (s.locH > 640 && s.locV > 480) return;
  c.d.setLoc(ch, s.locH + 1000, s.locV + 1000);
}
export function showIcon(c: ClassicContext, ch: number) {
  const s = c.d.sprite(ch);
  if (s.locH < 640 && s.locV < 480) return;
  c.d.setLoc(ch, s.locH - 1000, s.locV - 1000);
}

/** ±1000 on locV only (TSTREET1/BANK09 style). */
export function up(c: ClassicContext, ch: number) {
  const s = c.d.sprite(ch);
  if (s.locV >= 1000) c.d.setLocV(ch, s.locV - 1000);
}
export function down(c: ClassicContext, ch: number) {
  const s = c.d.sprite(ch);
  if (s.locV < 1000) c.d.setLocV(ch, s.locV + 1000);
}
