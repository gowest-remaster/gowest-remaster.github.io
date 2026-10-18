// A small Director 4 player for the Classic edition. It plays one movie's score at a time on a
// 640x480 software stage (canvas, drawn pixel-sharp and scaled by CSS), with Lingo semantics
// close enough that the original scripts (decompiled/lingo/**) port almost line by line:
//
//   - 48 sprite channels. Entering a frame reloads a channel from the score only when its score
//     data changes and it is not puppeted, so Lingo edits (locV +/-1000 hiding, castNum swaps)
//     persist across `go(the frame)` loops as in the original.
//   - Frame scripts (enterFrame/exitFrame), sprite scripts (mouseDown/mouseUp/keyDown...) and
//     movie handlers, looked up by the script's castId in a ScriptTable the screen supplies
//     (e.g. `{ 12: { exitFrame() {...} } }` for "ScoreScript 12.ls").
//   - tempo from the score/VWCF (a frame per 1/tempo s), `go`, labels, `the frame`,
//     `the timer`, `the ticks`, `rollOver`, `the clickOn`, `the mouseDown`, cursors per sprite,
//     editable fields, puppetSound / sound channels, score transitions.
// Handlers may be async (await a dialog, a sound, a delay); the playhead waits for them like a
// blocking Lingo handler, while rendering and mouse events keep going.
import { castLib, builtinPalettes, scoreOf, CLASSIC_BASE, type CastLib, type Member } from './cast.ts';
import type { ScoreFile, ScoreFrame, ScoreSprite, ScorePalette } from './types.ts';
import { memberCanvas, hitMask, inkKind, rgbOf } from './render.ts';
import { drawLines, fontKey, fontNow, getFont, layout, loadFontIndex, type LayoutOpts, type TextRun } from './font.ts';
import { csound } from './sound.ts';

export const STAGE_W = 640;
export const STAGE_H = 480;

export interface Handlers {
  enterFrame?(this: void): unknown;
  exitFrame?(this: void): unknown;
  mouseDown?(this: void): unknown;
  mouseUp?(this: void): unknown;
  /** return true to pass the key on to the field (Lingo `pass`) */
  keyDown?(this: void, key: string, e: KeyboardEvent): unknown;
  mouseEnter?(this: void): unknown;
  mouseLeave?(this: void): unknown;
  mouseWithin?(this: void): unknown;
}

/** Script handlers by script castId (sprite and frame scripts of the movie or SHARED). */
export type ScriptTable = Record<number, Handlers>;

export type CursorName = 'hand' | 'fhand' | 'pen' | 'question' | 'arrow' | 'watch' | 'none';
/** Original cursor lists: [castBitmap, castMask]. */
export const CURSOR_IDS: Record<number, CursorName> = { 3550: 'hand', 3552: 'fhand', 3554: 'pen', 3646: 'question' };
export const HAND: CursorName = 'hand';

export class Sprite {
  member: Member | null = null;
  /** registration point (Director loc) */
  locH = 0;
  locV = 0;
  /** draw size (stretch / text / shape) */
  width = 0;
  height = 0;
  stretch = false;
  ink = 0;
  fore = 255;
  back = 0;
  visible = true;
  puppet = false;
  thickness = 0;
  type = '';
  shapeKind = 0; // QuickDraw sprite: 1 rect, 2 roundRect, 3 oval, 4 line (score "shape")
  editable = false;
  moveable = false;
  trails = false;
  /** never hit by the mouse (rollover highlights drawn over hotspots, e.g. edRoll's frame) */
  passThrough = false;
  cursor: CursorName | null = null;
  /** sprite script castId */
  scriptId = 0;
  /** source score data (for change detection) */
  src: ScoreSprite | null = null;
  srcKey = '';
  /** extra content: a video element drawn into the sprite rect */
  video: HTMLVideoElement | HTMLCanvasElement | null = null;
  /** film loop frame counter */
  loopFrame = 0;
  /** text-sprite cache */
  textCache: { key: string; canvas: HTMLCanvasElement } | null = null;

  readonly ch: number;
  constructor(ch: number) {
    this.ch = ch;
  }

  get castNum() {
    return this.member?.id ?? 0;
  }

  /** Top-left draw rect in stage coordinates. */
  rect(): { left: number; top: number; right: number; bottom: number } {
    const m = this.member;
    let w = this.width;
    let h = this.height;
    let x = this.locH;
    let y = this.locV;
    if (m && m.type === 'bitmap' && m.w && m.h) {
      if (!this.stretch) {
        w = m.w;
        h = m.h;
        x = this.locH - (m.regX ?? 0);
        y = this.locV - (m.regY ?? 0);
      } else {
        const sx = w / m.w;
        const sy = h / m.h;
        x = this.locH - Math.round((m.regX ?? 0) * sx);
        y = this.locV - Math.round((m.regY ?? 0) * sy);
      }
    } else if (this.type === 'filmLoop' || this.type === 'digitalVideo') {
      x = this.locH - Math.floor(w / 2);
      y = this.locV - Math.floor(h / 2);
    }
    return { left: x, top: y, right: x + w, bottom: y + h };
  }

  /** On stage (the ±1000 hiding convention counts as hidden). */
  get onStage() {
    const r = this.rect();
    return this.visible && r.right > 0 && r.bottom > 0 && r.left < STAGE_W && r.top < STAGE_H;
  }
}

export interface MovieCtx {
  name: string;
  score: ScoreFile;
  lib: CastLib;
  shared: CastLib;
  /** frame n (1-based) -> score entry */
  frameIdx: (ScoreFrame | undefined)[];
}

export interface PlayerHooks {
  /** movie-level handlers (Lingo movie scripts) used when no sprite/frame script handles an event */
  movie?: Handlers;
  /** drawn after the sprites, in movie coordinates (dynamic overlays) */
  afterDraw?(ctx: CanvasRenderingContext2D): void;
  /** drawn first, in screen coordinates (e.g. the still behind the LOGIN window) */
  beforeDraw?(ctx: CanvasRenderingContext2D): void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class DirPlayer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  movie: MovieCtx | null = null;
  scripts: ScriptTable = {};
  hooks: PlayerHooks = {};
  readonly sprites: Sprite[] = Array.from({ length: 49 }, (_, i) => new Sprite(i));
  frame = 0;
  /** stage palette */
  palette: Uint8Array = new Uint8Array(768);
  paletteKey = '';
  bgColor = 255;
  tempo = 15;
  /** overrides the score tempo (puppetTempo) */
  puppetTempo = 0;
  private pendingGo: number | null = null;
  private running = false;
  private stepping = false;
  private acc = 0;
  private dirty = true;
  private destroyed = false;
  private startMs = performance.now();
  private timerStart = performance.now();
  // input
  mouseH = -1;
  mouseV = -1;
  mouseIsDown = false;
  clickOn = 0;
  private pressed: { ch: number; cast: Member | null } | null = null;
  private cancelMouseUp = false;
  /** global cursor (Lingo `cursor(n)`): null = sprite cursors / arrow */
  globalCursor: CursorName | null = null;
  focus = 0;
  private caretOn = true;
  private caretT = 0;
  private lastHover = 0;
  /** palette fade: 0 normal .. 1 black */
  fade = 0;
  private transition: { from: HTMLCanvasElement; t0: number; dur: number; type: number; chunk: number } | null = null;
  private scoreSound: [number, number] = [0, 0];
  private cursorUrls = new Map<string, string>();
  private cursorMeta: Record<string, { file: string; hx: number; hy: number; w: number; h: number }> | null = null;
  private cursorImgs = new Map<string, HTMLImageElement>();
  /** CSS px per stage px (for crisp scaled cursors) */
  cssScale = 1;
  private keyListener: (e: KeyboardEvent) => void;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = STAGE_W;
    this.canvas.height = STAGE_H;
    this.canvas.className = 'classic-stage';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    host.appendChild(this.canvas);
    const pos = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      this.cssScale = r.width / STAGE_W;
      this.mouseH = Math.floor(((e.clientX - r.left) / r.width) * STAGE_W) - this.origin.x;
      this.mouseV = Math.floor(((e.clientY - r.top) / r.height) * STAGE_H) - this.origin.y;
    };
    this.canvas.addEventListener('pointermove', (e) => {
      pos(e);
      this.updateCursor();
      this.hover();
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.mouseH = this.mouseV = -1;
      this.hover();
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      pos(e);
      this.canvas.setPointerCapture(e.pointerId);
      void this.onDown();
    });
    this.canvas.addEventListener('pointerup', (e) => {
      pos(e);
      void this.onUp();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.keyListener = (e) => this.onKey(e);
    window.addEventListener('keydown', this.keyListener, true);
    this.setupSoftKeys();
    void fetch(`${CLASSIC_BASE}cursors/cursors.json`)
      .then((r) => r.json())
      .then((m) => {
        this.cursorMeta = m;
        for (const [k, v] of Object.entries(m as Record<string, { file: string }>)) {
          const img = new Image();
          img.src = `${CLASSIC_BASE}cursors/${v.file}`;
          this.cursorImgs.set(k, img);
          img.onload = () => this.updateCursor();
        }
      });
  }

  destroy() {
    this.destroyed = true;
    this.running = false;
    window.removeEventListener('keydown', this.keyListener, true);
    this.softKeys?.remove();
    for (const s of this.sprites) if (s.video instanceof HTMLVideoElement) s.video.pause();
    this.canvas.remove();
  }

  // ------------------------------------------------------------------ loading
  /** Load a movie (cast, SHARED, score, bitmaps, fonts) and go to `frame` (number or label). */
  async loadMovie(name: string, frame: number | string = 1, scripts?: ScriptTable, startMovie?: () => void | Promise<void>) {
    const [lib, shared, score, builtins] = await Promise.all([castLib(name), castLib('SHARED'), scoreOf(name), builtinPalettes()]);
    await Promise.all([lib.load(), shared.load()]);
    // preload every font used by the movie's text members
    await loadFontIndex();
    const keys = new Set<string>();
    for (const m of [...lib.members.values(), ...shared.members.values()]) if (m.type === 'text' || m.type === 'button') for (const s of m.styles ?? []) keys.add(fontKey(s.font, s.size, s.style, s.ascent));
    keys.add(fontKey('Arial', 12, 0));
    await Promise.all([...keys].map((k) => getFont(k)));
    const frameIdx: (ScoreFrame | undefined)[] = [];
    for (const f of score.frames) for (let n = f.n; n <= (f.to ?? f.n); n++) frameIdx[n] = f;
    this.movie = { name, score, lib, shared, frameIdx };
    if (scripts) this.scripts = scripts;
    this.builtins = builtins;
    this.bgColor = score.stage.bgColor;
    this.tempo = score.stage.tempo || 15;
    this.setPalette(score.stage.palette);
    for (const s of this.sprites) this.clearSprite(s);
    this.scoreSound = [0, 0];
    this.frame = 0;
    this.focus = 0;
    this.puppetTempo = 0;
    this.pendingGo = null;
    const r = this.movie.score.stage.rect;
    this.origin = { x: score.stage.w < STAGE_W ? r.left : 0, y: score.stage.h < STAGE_H ? r.top : 0 };
    if (startMovie) await startMovie();
    const n = this.pendingGo ?? this.labelFrame(frame);
    this.pendingGo = null;
    this.enterFrameNumber(n, true);
  }
  /** where the movie's stage sits on the 640x480 screen (LOGIN is a 320x200 window at 160,140) */
  origin = { x: 0, y: 0 };
  private builtins: Record<string, Uint8Array> = {};

  /** Frame number of a label (or the number itself). */
  labelFrame(f: number | string): number {
    if (typeof f === 'number') return f;
    const labels = this.movie?.score.labels ?? {};
    if (f in labels) return labels[f];
    const k = Object.keys(labels).find((l) => l.toLowerCase() === f.toLowerCase());
    if (k) return labels[k];
    console.warn('classic: unknown label', f);
    return this.frame || 1;
  }

  /** Label of the current frame section (the nearest label at or before the frame). */
  get frameLabel(): string {
    const labels = this.movie?.score.labels ?? {};
    let best = '';
    let bn = -1;
    for (const [k, v] of Object.entries(labels)) if (v <= this.frame && v > bn) ((best = k), (bn = v));
    return best;
  }

  // ------------------------------------------------------------------ members
  /** `member` / `cast` lookup: castId (>= 3000 = SHARED) or name (movie first, then SHARED). */
  member(ref: number | string): Member | null {
    const mv = this.movie;
    if (!mv) return null;
    if (typeof ref === 'number') return (ref >= 3000 ? mv.shared.get(ref) : mv.lib.get(ref)) ?? mv.lib.get(ref) ?? mv.shared.get(ref) ?? null;
    const id = mv.lib.idOf(ref);
    if (id !== undefined) return mv.lib.get(id)!;
    const sid = mv.shared.idOf(ref);
    if (sid !== undefined) return mv.shared.get(sid)!;
    return null;
  }

  /** `the number of cast "X"` (0 when missing). */
  castNumber(name: string) {
    return this.member(name)?.id ?? 0;
  }

  /** Field text (`field "X"`). */
  field(ref: number | string): string {
    return this.member(ref)?.text ?? '';
  }

  /** `put s into field "X"`. */
  setField(ref: number | string, s: string | number) {
    const m = this.member(ref);
    if (!m) {
      console.warn('classic: no field', ref);
      return;
    }
    const t = String(s);
    if (m.text !== t) {
      m.text = t;
      m.version++;
      this.dirty = true;
    }
  }

  /** Change a text member's font (Lingo textFont/textSize/textStyle, SHOWTEXT). */
  setFieldStyle(ref: number | string, font: string, size: number, style: 'Plain' | 'Bold' | 'Italic' | number = 'Plain', color?: string) {
    const m = this.member(ref);
    if (!m) return;
    const st = typeof style === 'number' ? style : style === 'Bold' ? 1 : style === 'Italic' ? 2 : 0;
    const base = m.styles?.[0];
    m.styles = [{ start: 0, height: null, ascent: null, size, style: st, font, color: color ?? base?.color ?? '#000000' }];
    m.version++;
    void getFont(fontKey(font, size, st)).then(() => {
      m.version++;
      this.dirty = true;
    });
    this.dirty = true;
  }

  // ------------------------------------------------------------------ sprites
  sprite(ch: number): Sprite {
    return this.sprites[ch];
  }

  /** `set the castNum of sprite ch to ...` (by id or name); the loc is kept. */
  setCast(ch: number, ref: number | string | Member | null) {
    const s = this.sprites[ch];
    const m = ref === null ? null : typeof ref === 'object' ? ref : this.member(ref);
    if (m && s.member !== m && m.type === 'bitmap' && !s.stretch) {
      s.width = m.w ?? s.width;
      s.height = m.h ?? s.height;
    }
    if (m && (m.type === 'text' || m.type === 'button') && s.member?.type !== 'text' && s.member?.type !== 'button') {
      const r = m.rect;
      if (r && !s.width) {
        s.width = r[2] - r[0];
        s.height = r[3] - r[1];
      }
      s.type = 'text';
    } else if (m?.type === 'bitmap') s.type = 'bitmap';
    s.member = m;
    s.textCache = null;
    this.dirty = true;
  }

  setLoc(ch: number, h: number, v: number) {
    const s = this.sprites[ch];
    s.locH = h;
    s.locV = v;
    this.dirty = true;
  }

  setLocV(ch: number, v: number) {
    this.sprites[ch].locV = v;
    this.dirty = true;
  }

  setLocH(ch: number, h: number) {
    this.sprites[ch].locH = h;
    this.dirty = true;
  }

  /** Hide/show with the original ±1000 convention on locV. */
  show(ch: number, on = true) {
    const s = this.sprites[ch];
    if (on && s.locV >= 1000) s.locV -= 1000 * Math.floor(s.locV / 1000);
    else if (!on && s.locV < 1000) s.locV += 1000;
    this.dirty = true;
  }

  setVisible(ch: number, v: boolean) {
    this.sprites[ch].visible = v;
    this.dirty = true;
  }

  puppetSprite(ch: number, on: boolean) {
    this.sprites[ch].puppet = on;
  }

  /** `spriteBox(ch, l, t, r, b)` */
  spriteBox(ch: number, l: number, t: number, r: number, b: number) {
    const s = this.sprites[ch];
    const m = s.member;
    s.stretch = true;
    s.width = r - l;
    s.height = b - t;
    if (m && m.type === 'bitmap' && m.w && m.h) {
      s.locH = l + Math.round((m.regX ?? 0) * (s.width / m.w));
      s.locV = t + Math.round((m.regY ?? 0) * (s.height / m.h));
    } else {
      s.locH = l;
      s.locV = t;
    }
    this.dirty = true;
  }

  setCursor(ch: number, c: CursorName | number[] | 0 | null) {
    this.sprites[ch].cursor = Array.isArray(c) ? (CURSOR_IDS[c[0]] ?? 'hand') : c === 0 ? null : c;
    this.updateCursor();
  }

  /** Lingo `cursor(n)`: 0/-1 arrow (sprite cursors on), 4 watch, 200 blank, or a cursor list. */
  cursor(n: number | number[] | CursorName) {
    if (Array.isArray(n)) this.globalCursor = CURSOR_IDS[n[0]] ?? 'hand';
    else if (typeof n === 'string') this.globalCursor = n;
    else this.globalCursor = n === 4 ? 'watch' : n === 200 ? 'none' : null;
    this.updateCursor();
  }

  updateStage() {
    this.dirty = true;
  }

  private clearSprite(s: Sprite) {
    s.member = null;
    s.src = null;
    s.srcKey = '';
    s.puppet = false;
    s.visible = true;
    s.cursor = null;
    s.scriptId = 0;
    s.video = null;
    s.type = '';
    s.width = s.height = 0;
    s.textCache = null;
    s.editable = false;
    s.passThrough = false;
  }

  private loadSprite(s: Sprite, d: ScoreSprite | undefined, key: string) {
    const keepCursor = s.cursor;
    if (!d) {
      // `the visible of sprite` is a channel property in Director: it survives score changes
      const vis = s.visible;
      this.clearSprite(s);
      s.visible = vis;
      s.cursor = null;
      return;
    }
    s.src = d;
    s.srcKey = key;
    s.member = d.castId && !d.castMissing ? this.member(d.castId) : null;
    s.type = d.type ?? (d.shape ? 'shape' : '');
    s.locH = d.loc[0];
    s.locV = d.loc[1];
    s.width = d.w;
    s.height = d.h;
    s.stretch = d.flags.includes('stretch') && s.type === 'bitmap';
    s.ink = d.ink;
    s.fore = d.fore;
    s.back = d.back;
    s.thickness = d.thickness ?? 0;
    s.trails = d.flags.includes('trails');
    s.moveable = d.flags.includes('moveable');
    s.editable = d.flags.includes('editable');
    s.passThrough = false;
    s.scriptId = d.script && !d.script.castMissing ? d.script.castId : 0;
    s.shapeKind = d.shape ? ({ rect: 1, roundRect: 2, oval: 3, line: 4 } as Record<string, number>)[d.shape] ?? 1 : 0;
    s.textCache = null;
    s.loopFrame = 0;
    // Director keeps a sprite's cursor while the channel holds the same member
    s.cursor = keepCursor && s.member === (s.member ?? null) ? keepCursor : null;
  }

  // ------------------------------------------------------------------ playback
  /** `go(frame)` / `go("label")`: jump after the current handler. */
  go(f: number | string) {
    this.pendingGo = this.labelFrame(f);
    if (!this.stepping) queueMicrotask(() => this.flushGo());
  }

  private flushGo() {
    if (this.pendingGo === null || this.stepping || this.destroyed) return;
    const n = this.pendingGo;
    this.pendingGo = null;
    this.enterFrameNumber(n);
    this.acc = 0;
  }

  start() {
    this.running = true;
  }

  stop() {
    this.running = false;
  }

  get frameTempo() {
    if (this.puppetTempo) return this.puppetTempo;
    const f = this.movie?.frameIdx[this.frame];
    return f?.tempo && f.tempo > 0 && f.tempo < 120 ? f.tempo : this.tempo;
  }

  /** Advance time (called every animation frame by the scene). */
  update(dt: number) {
    if (this.destroyed || !this.movie) return;
    this.caretT += dt;
    if (this.caretT > 0.5) {
      this.caretT = 0;
      this.caretOn = !this.caretOn;
      if (this.focus) this.dirty = true;
    }
    if (this.running && !this.stepping) {
      this.acc += dt;
      const period = 1 / Math.max(1, this.frameTempo);
      if (this.acc >= period) {
        this.acc = Math.min(this.acc - period, period);
        void this.step();
      }
    }
    // film loops and videos animate continuously
    for (const s of this.sprites) if (s.video || s.type === 'filmLoop') this.dirty = true;
    if (this.transition || this.dirty) this.render();
  }

  /** exitFrame of the current frame, then move to the next (or the `go` target). */
  private async step() {
    this.stepping = true;
    try {
      const fs = this.frameScript();
      // no frame-script handler: the event goes to the movie script (Lingo semantics)
      const r = fs?.exitFrame ? fs.exitFrame() : this.hooks.movie?.exitFrame?.();
      if (r instanceof Promise) await r;
      if (this.destroyed) return;
      // advance film loops one frame per tick
      for (const s of this.sprites) if (s.type === 'filmLoop') s.loopFrame++;
      const next = this.pendingGo ?? this.frame + 1;
      this.pendingGo = null;
      const last = this.movie!.score.frameCount;
      this.enterFrameNumber(next > last ? last : next);
    } catch (e) {
      console.error('classic: script error', e);
    } finally {
      this.stepping = false;
    }
    if (this.pendingGo !== null) this.flushGo();
  }

  /** The frame script handlers of the current frame. */
  frameScript(): Handlers | undefined {
    const f = this.movie?.frameIdx[this.frame];
    return f?.script ? this.scripts[f.script.castId] : undefined;
  }

  private enterFrameNumber(n: number, first = false) {
    const mv = this.movie!;
    const prev = mv.frameIdx[this.frame];
    const f = mv.frameIdx[n];
    const changed = prev !== f || first || n !== this.frame;
    const prevFrame = this.frame;
    this.frame = n;
    if (changed && f && f !== prev) {
      if (f.transition && !first) this.beginTransition(f.transition.type, f.transition.durationMs, f.transition.chunkSize);
      if (f.palette && (!prev || prev.palette?.id !== f.palette.id)) this.setPalette(f.palette);
    }
    if (changed) {
      const bych = new Map<number, ScoreSprite>();
      for (const s of f?.sprites ?? []) bych.set(s.ch, s);
      for (let ch = 1; ch <= 48; ch++) {
        const s = this.sprites[ch];
        if (s.puppet) {
          // the sprite script stays attached to the score cell even while puppeted
          const pd = bych.get(ch);
          if (pd) s.scriptId = pd.script && !pd.script.castMissing ? pd.script.castId : 0;
          continue;
        }
        const d = bych.get(ch);
        const key = d ? spriteKey(d) : '';
        if (key !== s.srcKey || first) this.loadSprite(s, d, key);
      }
      // score sound channels
      for (const i of [0, 1] as const) {
        const snd = i === 0 ? f?.sound1 : f?.sound2;
        const id = snd?.castId ?? 0;
        if (id !== this.scoreSound[i]) {
          this.scoreSound[i] = id;
          if (id) {
            const m = this.member(id);
            // a puppetSound still playing on that channel overrides the score's sound
            if (m?.type === 'sound' && !(this.soundPuppet[i + 1] && csound.busy(i + 1))) void csound.playMember(i + 1, m);
          }
        }
      }
    }
    void prevFrame;
    this.dirty = true;
    const fs = this.frameScript();
    try {
      const r = fs?.enterFrame ? fs.enterFrame() : this.hooks.movie?.enterFrame?.();
      if (r instanceof Promise) r.catch((e) => console.error(e));
    } catch (e) {
      console.error('classic: enterFrame error', e);
    }
    this.updateCursor();
  }

  // ------------------------------------------------------------------ palette
  setPalette(p: ScorePalette & { extractorResolved?: string }) {
    const mv = this.movie;
    if (!mv) return;
    let bytes: Uint8Array | undefined;
    let key = '';
    if (p.id < 0 || p.builtin) {
      bytes = this.builtins[String(p.id)] ?? this.builtins['-101'];
      key = `b${p.id}`;
    } else {
      const lib = p.lib === 'SHARED' || p.id >= 3000 ? mv.shared : mv.lib;
      bytes = lib.palettes.get(p.id) ?? mv.lib.palettes.get(p.id) ?? mv.shared.palettes.get(p.id);
      key = `${lib.name}:${p.id}`;
      if (!bytes && p.extractorResolved) {
        const m = /member:(\d+)/.exec(p.extractorResolved);
        if (m) {
          const id = Number(m[1]);
          bytes = mv.lib.palettes.get(id) ?? mv.shared.palettes.get(id);
          key = `r:${id}`;
        }
      }
    }
    if (!bytes) {
      bytes = this.builtins['-101'];
      key = 'b-101';
    }
    if (bytes && key !== this.paletteKey) {
      this.palette = bytes;
      this.paletteKey = key;
      for (const s of this.sprites) s.textCache = null;
      this.dirty = true;
    }
  }

  /** Use a palette cast member by name or id (puppetPalette). */
  puppetPalette(ref: number | string) {
    const m = this.member(ref);
    const id = typeof ref === 'number' ? ref : m?.id;
    if (id) this.setPalette({ id, lib: id >= 3000 ? 'SHARED' : undefined });
  }

  color(index: number) {
    return rgbOf(this.palette, index);
  }

  // ------------------------------------------------------------------ rendering
  render() {
    const ctx = this.ctx;
    this.dirty = false;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.origin.x || this.origin.y ? '#000' : this.color(this.bgColor);
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
    this.hooks.beforeDraw?.(ctx);
    ctx.save();
    if (this.origin.x || this.origin.y) {
      const st = this.movie!.score.stage;
      ctx.translate(this.origin.x, this.origin.y);
      ctx.beginPath();
      ctx.rect(0, 0, st.w, st.h);
      ctx.clip();
      ctx.fillStyle = this.color(this.bgColor);
      ctx.fillRect(0, 0, st.w, st.h);
    }
    for (let ch = 1; ch <= 48; ch++) this.drawSprite(ctx, this.sprites[ch]);
    this.hooks.afterDraw?.(ctx);
    ctx.restore();
    if (this.fade > 0) {
      ctx.globalAlpha = Math.min(1, this.fade);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, STAGE_W, STAGE_H);
      ctx.globalAlpha = 1;
    }
    if (this.transition) this.drawTransition();
  }

  private drawSprite(ctx: CanvasRenderingContext2D, s: Sprite) {
    if (!s.visible) return;
    const r = s.rect();
    if (r.right <= 0 || r.bottom <= 0 || r.left >= STAGE_W || r.top >= STAGE_H) return;
    const m = s.member;
    const kind = inkKind(s.ink);
    if (s.video) {
      ctx.drawImage(s.video, r.left, r.top, r.right - r.left, r.bottom - r.top);
      return;
    }
    if (m?.type === 'bitmap') {
      const c = memberCanvas(m, this.palette, this.paletteKey, s);
      if (!c) return;
      if (kind === 'reverse') ctx.globalCompositeOperation = 'difference';
      ctx.drawImage(c, r.left, r.top, r.right - r.left, r.bottom - r.top);
      ctx.globalCompositeOperation = 'source-over';
      return;
    }
    if (m && (m.type === 'text' || m.type === 'button')) {
      this.drawText(ctx, s, m, r);
      return;
    }
    if (s.type === 'filmLoop' && m) {
      this.drawFilmLoop(ctx, s, r);
      return;
    }
    if (s.type === 'shape' || s.shapeKind || m?.type === 'shape') {
      this.drawShape(ctx, s, r);
    }
  }

  private drawShape(ctx: CanvasRenderingContext2D, s: Sprite, r: { left: number; top: number; right: number; bottom: number }) {
    const m = s.member;
    // background-transparent ink drops a fill in the sprite's back colour (STORE's white mask)
    const filled = m ? (m.fill ?? 0) !== 0 && !(inkKind(s.ink) === 'bgTransparent' && s.fore === s.back) : false;
    const th = (s.thickness & 0x0f) - 1;
    const kind = inkKind(s.ink);
    if (kind === 'reverse' && th <= 0) return;
    // notGhost inverts then ghosts: a black outline comes out white, i.e. transparent (TTALK No1-9 hotspot)
    if (kind === 'notGhost' && !filled) return;
    if (!filled && th <= 0) return;
    const col = this.color(s.fore);
    const w = r.right - r.left;
    const h = r.bottom - r.top;
    if (kind === 'reverse') ctx.globalCompositeOperation = 'difference';
    const st = m?.shapeType ?? s.shapeKind ?? 1;
    if (st === 3) {
      ctx.beginPath();
      ctx.ellipse(r.left + w / 2, r.top + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (filled && kind !== 'reverse') {
        ctx.fillStyle = col;
        ctx.fill();
      }
      if (th > 0) {
        ctx.strokeStyle = col;
        ctx.lineWidth = th;
        ctx.stroke();
      }
    } else if (st === 4) {
      ctx.fillStyle = col;
      ctx.fillRect(r.left, r.top, Math.max(1, w), Math.max(1, th, h === 0 ? 1 : 0));
    } else {
      if (filled && kind !== 'reverse') {
        ctx.fillStyle = col;
        ctx.fillRect(r.left, r.top, w, h);
      }
      if (th > 0) {
        ctx.fillStyle = col;
        ctx.fillRect(r.left, r.top, w, th);
        ctx.fillRect(r.left, r.bottom - th, w, th);
        ctx.fillRect(r.left, r.top, th, h);
        ctx.fillRect(r.right - th, r.top, th, h);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawFilmLoop(ctx: CanvasRenderingContext2D, s: Sprite, r: { left: number; top: number }) {
    const loop = this.movie?.score.filmLoops?.[String(s.member!.id)];
    if (!loop || !loop.frames.length) return;
    const fr = loop.frames[s.loopFrame % loop.frames.length];
    for (const sub of fr.sprites) {
      const m = sub.castId ? this.member(sub.castId) : null;
      if (!m || m.type !== 'bitmap') continue;
      const c = memberCanvas(m, this.palette, this.paletteKey, sub);
      if (c) ctx.drawImage(c, r.left + (sub.relX ?? 0), r.top + (sub.relY ?? 0));
    }
  }

  /** Layout options for a text member as drawn by sprite s. */
  textOpts(s: Sprite, m: Member, width: number): LayoutOpts {
    const styles = m.styles?.length ? m.styles : [{ start: 0, height: null, ascent: null, style: 0, size: 12, color: '#000000', font: 'Arial' }];
    const runs: { start: number; run: TextRun }[] = styles.map((st) => {
      const font = fontNow(fontKey(st.font, st.size, st.style, st.ascent))!;
      let color = st.color ?? '#000000';
      // a field's black text takes the sprite's foreground colour
      // (fore == back, e.g. 0/0 on the logbook and album fields, means "not set": keep black)
      if ((color === '#000000' || color === '#000') && s.fore !== 255 && s.fore !== s.back) color = this.color(s.fore);
      const fm = font?.meta;
      const lh = st.height ?? fm?.height ?? 16;
      const asc = st.ascent ?? fm?.ascent ?? 12;
      return { start: st.start ?? 0, run: { font, color, underline: !!((st.style ?? 0) & 4), lineHeight: Math.max(lh, fm?.height ?? 0), ascent: Math.max(asc, fm?.ascent ?? 0) } };
    });
    const runAt = (off: number) => {
      let r = runs[0].run;
      for (const x of runs) if (x.start <= off) r = x.run;
      return r;
    };
    return { width, align: m.align ?? 0, wrap: true, runAt };
  }

  private drawText(ctx: CanvasRenderingContext2D, s: Sprite, m: Member, r: { left: number; top: number; right: number; bottom: number }) {
    // a D4 field is laid out at its member rect width, whatever the score box says (TSTREET1's
    // 58-px MyCash box and STORE's 84-px LocDate box both centre on the field's own width)
    const mw = m.type === 'text' && m.rect ? m.rect[2] - m.rect[0] : 0;
    const w = Math.max(1, mw > 0 ? mw : r.right - r.left);
    // a field shows its whole member rect even when the score box is shorter
    const h = Math.max(1, r.bottom - r.top, m.rect ? m.rect[3] - m.rect[1] : 0);
    const opts = this.textOpts(s, m, w);
    // fonts still loading: draw next time
    for (const st of m.styles ?? []) if (!fontNow(fontKey(st.font, st.size, st.style, st.ascent))) return void (this.dirty = true);
    const key = `${m.version}|${m.text}|${w}x${h}|${s.ink}|${s.fore}|${s.back}|${this.paletteKey}`;
    let c = s.textCache?.key === key ? s.textCache.canvas : null;
    if (!c) {
      c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cx = c.getContext('2d')!;
      cx.imageSmoothingEnabled = false;
      const kind = inkKind(s.ink);
      if (kind === 'copy') {
        cx.fillStyle = this.color(s.back);
        cx.fillRect(0, 0, w, h);
      }
      const text = m.text ?? '';
      const ls = layout(text, opts);
      drawLines(cx, text, ls, 0, 0, w, opts);
      s.textCache = { key, canvas: c };
    }
    ctx.drawImage(c, r.left, r.top);
    if (this.focus === s.ch && this.caretOn) {
      // caret after the last character
      const text = m.text ?? '';
      const ls = layout(text, opts);
      const last = ls[ls.length - 1];
      let y = 0;
      for (let i = 0; i < ls.length - 1; i++) y += ls[i].height;
      let x = last ? last.width : 0;
      if (opts.align === 1) x = Math.floor((w - (last?.width ?? 0)) / 2) + (last?.width ?? 0);
      else if (opts.align === -1) x = w;
      ctx.fillStyle = '#000';
      ctx.fillRect(r.left + Math.min(x, w - 1), r.top + y + 1, 1, (last?.height ?? 14) - 2);
    }
  }

  // ------------------------------------------------------------------ transitions
  /**
   * Lingo `puppetTransition(type, quarterSeconds)`: the next stage change is revealed with that
   * transition, from the picture currently on screen (the last rendered frame).
   */
  puppetTransition(type: number, quarterSeconds = 2, chunk = 4) {
    this.beginTransition(type, quarterSeconds * 250, chunk);
  }

  private beginTransition(type: number, durationMs: number, chunk: number) {
    const from = document.createElement('canvas');
    from.width = STAGE_W;
    from.height = STAGE_H;
    from.getContext('2d')!.drawImage(this.canvas, 0, 0);
    this.transition = { from, t0: performance.now(), dur: Math.max(150, Math.min(durationMs || 500, 1500)), type, chunk: Math.max(2, chunk || 4) };
  }

  private drawTransition() {
    const t = this.transition!;
    const p = (performance.now() - t.t0) / t.dur;
    if (p >= 1) {
      this.transition = null;
      return;
    }
    this.dirty = true;
    // paint the old image back over the parts the transition has not revealed yet
    const ctx = this.ctx;
    const cs = t.chunk * 4;
    const cols = Math.ceil(STAGE_W / cs);
    const rows = Math.ceil(STAGE_H / cs);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const cx = (x + 0.5) / cols - 0.5;
        const cy = (y + 0.5) / rows - 0.5;
        let order: number;
        switch (t.type) {
          case 1: // wipeRight
            order = (x + 0.5) / cols;
            break;
          case 2: // wipeLeft
            order = 1 - (x + 0.5) / cols;
            break;
          case 3: // wipeDown
            order = (y + 0.5) / rows;
            break;
          case 4: // wipeUp
            order = 1 - (y + 0.5) / rows;
            break;
          case 5: // centerOutHorizontal
            order = Math.abs(cy) * 2;
            break;
          case 7: // centerOutSquare
            order = Math.max(Math.abs(cx), Math.abs(cy)) * 2;
            break;
          case 10: // edgesInSquare
            order = 1 - Math.max(Math.abs(cx), Math.abs(cy)) * 2;
            break;
          case 15: // stripsRightBuildDown-ish
            order = (1 - (x + 0.5) / cols) * 0.5 + ((y + 0.5) / rows) * 0.5;
            break;
          default: // dissolve-ish
            order = ((x * 7919 + y * 104729) % 997) / 997;
        }
        if (order >= p) ctx.drawImage(t.from, x * cs, y * cs, cs, cs, x * cs, y * cs, cs, cs);
      }
  }

  // ------------------------------------------------------------------ input
  /** Topmost sprite under (h, v), as Director hit-tests (matte sprites by their pixels). */
  spriteAt(h = this.mouseH, v = this.mouseV, filter?: (s: Sprite) => boolean): number {
    for (let ch = 48; ch >= 1; ch--) {
      const s = this.sprites[ch];
      if (filter && !filter(s)) continue;
      if (this.hits(s, h, v)) return ch;
    }
    return 0;
  }

  private hits(s: Sprite, h: number, v: number): boolean {
    if (!s.visible || s.passThrough || (!s.member && !s.shapeKind && s.type !== 'shape')) return false;
    if (s.member?.type === 'sound' || s.member?.type === 'palette') return false;
    const r = s.rect();
    if (h < r.left || v < r.top || h >= r.right || v >= r.bottom) return false;
    if (s.member?.type === 'bitmap' && inkKind(s.ink) === 'matte') {
      const c = memberCanvas(s.member, this.palette, this.paletteKey, s);
      const mask = c && hitMask(c);
      if (mask && c) {
        const x = Math.floor(((h - r.left) / (r.right - r.left)) * c.width);
        const y = Math.floor(((v - r.top) / (r.bottom - r.top)) * c.height);
        return !!mask[y * c.width + x];
      }
    }
    return true;
  }

  /** Lingo `rollOver(ch)`: the mouse is over that sprite (regardless of what is on top). */
  rollOver(ch: number) {
    return this.hits(this.sprites[ch], this.mouseH, this.mouseV);
  }

  /** `the mouseDown` */
  get mouseDown() {
    return this.mouseIsDown;
  }

  /** SHARED `press()`: show the down art (castNum+1) while held; cancel the mouseUp if released outside. */
  press(ch = this.clickOn) {
    const s = this.sprites[ch];
    if (!s.member) return;
    this.pressed = { ch, cast: s.member };
    const down = this.member(s.member.id + 1);
    if (down) {
      s.member = down;
      s.textCache = null;
    }
    this.dirty = true;
  }

  private handlerFor(ev: keyof Handlers, ch: number): (() => unknown) | null {
    const s = ch ? this.sprites[ch] : null;
    const sh = s?.scriptId ? this.scripts[s.scriptId] : undefined;
    if (sh && sh[ev]) return sh[ev] as () => unknown;
    const fs = this.frameScript();
    if (fs && fs[ev]) return fs[ev] as () => unknown;
    const mh = this.hooks.movie;
    if (mh && mh[ev]) return mh[ev] as () => unknown;
    return null;
  }

  private async run(fn: (() => unknown) | null) {
    if (!fn) return;
    try {
      const r = fn();
      if (r instanceof Promise) await r;
    } catch (e) {
      console.error('classic: handler error', e);
    }
    if (this.pendingGo !== null && !this.stepping) this.flushGo();
  }

  private async onDown() {
    this.mouseIsDown = true;
    const now = performance.now();
    this.doubleClick = now - this.lastClickAt < 400;
    this.lastClickAt = now;
    this.cancelMouseUp = false;
    const ch = this.spriteAt();
    this.clickOn = ch;
    const s = this.sprites[ch];
    if (ch && s.editable && s.member && (s.member.type === 'text')) {
      this.focus = ch;
      this.dirty = true;
    }
    await this.run(this.handlerFor('mouseDown', ch));
  }

  private async onUp() {
    this.mouseIsDown = false;
    if (this.pressed) {
      const p = this.pressed;
      this.pressed = null;
      const s = this.sprites[p.ch];
      s.member = p.cast;
      s.textCache = null;
      this.dirty = true;
      if (!this.rollOver(p.ch)) this.cancelMouseUp = true;
    }
    if (this.cancelMouseUp) {
      this.cancelMouseUp = false;
      return;
    }
    // Lingo `the mouseUpScript`: runs before the sprite's mouseUp; returning false = dontPassEvent
    if (this.mouseUpScript) {
      let pass: unknown = true;
      try {
        pass = this.mouseUpScript();
      } catch (e) {
        console.error(e);
      }
      if (pass === false) return;
    }
    await this.run(this.handlerFor('mouseUp', this.clickOn));
  }

  /** Lingo `set the mouseUpScript to ...` (null = EMPTY). */
  mouseUpScript: (() => unknown) | null = null;

  /** `the doubleClick`: this click came soon after the previous one. */
  doubleClick = false;
  private lastClickAt = 0;

  /** `CursorOff()`: clear every sprite cursor. */
  cursorOff() {
    for (const s of this.sprites) s.cursor = null;
    this.updateCursor();
  }

  /** `repeat while the mouseDown ... end repeat`: call `onMove` on every move until release. */
  trackMouse(onMove: () => void): Promise<void> {
    return new Promise((resolve) => {
      if (!this.mouseIsDown) {
        onMove();
        resolve();
        return;
      }
      const mv = () => {
        onMove();
        this.dirty = true;
      };
      const up = () => {
        this.canvas.removeEventListener('pointermove', mv);
        this.canvas.removeEventListener('pointerup', up);
        onMove();
        resolve();
      };
      this.canvas.addEventListener('pointermove', mv);
      this.canvas.addEventListener('pointerup', up);
      onMove();
    });
  }

  /** Cancel the coming mouseUp (Lingo `CansPress` / dontPassEvent). */
  cancelClick() {
    this.cancelMouseUp = true;
  }

  private hover() {
    const ch = this.spriteAt();
    if (ch !== this.lastHover) {
      const prev = this.lastHover;
      this.lastHover = ch;
      if (prev) void this.run(this.sprites[prev].scriptId ? (this.scripts[this.sprites[prev].scriptId]?.mouseLeave as () => unknown) ?? null : null);
      if (ch) void this.run(this.sprites[ch].scriptId ? (this.scripts[this.sprites[ch].scriptId]?.mouseEnter as () => unknown) ?? null : null);
    }
  }

  /** Keyboard: sprite keyDown handler of the focused field (return true = pass), then editing. */
  /** Phones have no keyboard until a text field has focus: a hidden <input> takes focus when an editable stage
   *  field is tapped (inside the tap, as iOS requires), and its typing is fed to onKey as key presses. */
  private softKeys: HTMLInputElement | null = null;
  private setupSoftKeys() {
    if (typeof matchMedia !== 'function' || !matchMedia('(pointer: coarse)').matches) return;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.autocapitalize = 'off';
    inp.autocomplete = 'off';
    inp.spellcheck = false;
    inp.setAttribute('aria-hidden', 'true');
    // on screen (iOS won't focus an off-screen input) but invisible; 16px so Safari doesn't zoom in on focus
    inp.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;pointer-events:none';
    const key = (k: string) => this.onKey({ key: k, target: null, preventDefault() {}, stopPropagation() {} } as unknown as KeyboardEvent);
    inp.addEventListener('beforeinput', (e) => {
      const ie = e as InputEvent;
      e.preventDefault();
      if (ie.inputType === 'insertText' && ie.data) for (const ch of ie.data) key(ch);
      else if (ie.inputType === 'deleteContentBackward') key('Backspace');
      else if (ie.inputType === 'insertLineBreak' || ie.inputType === 'insertParagraph') key('Enter');
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        key(e.key);
      }
    });
    document.body.appendChild(inp);
    this.softKeys = inp;
    // after the tap's own mouse compatibility events (a mousedown on the canvas would take the focus straight back)
    this.canvas.addEventListener('click', () => {
      const s = this.focus ? this.sprites[this.focus] : null;
      if (s?.editable) inp.focus();
      else if (document.activeElement === inp) inp.blur();
    });
  }

  private onKey(e: KeyboardEvent) {
    if (this.destroyed || !this.canvas.isConnected) return;
    // dialogs of the HTML overlay (if any) get their own keys
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const key = e.key;
    const fn = this.handlerFor('keyDown', this.focus);
    let pass = true;
    if (fn) {
      try {
        pass = (fn as unknown as (k: string, e: KeyboardEvent) => unknown).call(null, key, e) === true;
      } catch (err) {
        console.error(err);
      }
      if (this.pendingGo !== null && !this.stepping) this.flushGo();
    }
    if (this.focus || fn) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!pass || !this.focus) return;
    const s = this.sprites[this.focus];
    const m = s.member;
    if (!m || m.type !== 'text') return;
    let text = m.text ?? '';
    if (key === 'Backspace') text = text.slice(0, -1);
    else if (key === 'Enter') text += '\r';
    else if (key === 'Tab') {
      this.focusNext();
      return;
    } else if (key.length === 1) text += key;
    else return;
    this.setField(m.id, text);
  }

  focusNext() {
    const eds = this.sprites.filter((s) => s.editable && s.onStage && s.member?.type === 'text').map((s) => s.ch);
    if (!eds.length) return;
    const i = eds.indexOf(this.focus);
    this.focus = eds[(i + 1) % eds.length];
    this.dirty = true;
  }

  setEditable(ch: number, on: boolean) {
    this.sprites[ch].editable = on;
    if (on && !this.focus) this.focus = ch;
    if (!on && this.focus === ch) this.focus = 0;
    this.dirty = true;
  }

  // ------------------------------------------------------------------ cursors
  private cursorCss(name: CursorName): string {
    if (name === 'watch') return 'wait';
    if (name === 'none') return 'none';
    if (name === 'arrow') return 'default';
    const meta = this.cursorMeta?.[name];
    const img = this.cursorImgs.get(name);
    if (!meta || !img?.complete) return 'pointer';
    const k = Math.max(1, Math.min(4, Math.round(this.cssScale)));
    const id = `${name}@${k}`;
    let url = this.cursorUrls.get(id);
    if (!url) {
      const c = document.createElement('canvas');
      c.width = meta.w * k;
      c.height = meta.h * k;
      const cx = c.getContext('2d')!;
      cx.imageSmoothingEnabled = false;
      cx.drawImage(img, 0, 0, c.width, c.height);
      url = `url(${c.toDataURL()}) ${meta.hx * k} ${meta.hy * k}, pointer`;
      this.cursorUrls.set(id, url);
    }
    return url;
  }

  updateCursor() {
    let name: CursorName = 'arrow';
    if (this.globalCursor) name = this.globalCursor;
    else {
      for (let ch = 48; ch >= 1; ch--) {
        const s = this.sprites[ch];
        if (s.cursor && this.hits(s, this.mouseH, this.mouseV)) {
          name = s.cursor;
          break;
        }
      }
    }
    const css = this.cursorCss(name);
    if (this.canvas.style.cursor !== css) this.canvas.style.cursor = css;
  }

  // ------------------------------------------------------------------ time
  /** `the ticks` (1/60 s since start) */
  get ticks() {
    return Math.floor(((performance.now() - this.startMs) / 1000) * 60);
  }

  startTimer() {
    this.timerStart = performance.now();
  }

  /** `the timer` in ticks */
  get timer() {
    return Math.floor(((performance.now() - this.timerStart) / 1000) * 60);
  }

  /** Wait (rendering continues). */
  delay(ms: number) {
    return sleep(ms);
  }

  /** Wait for the next click anywhere (resolves on mouseUp). */
  waitClick(): Promise<void> {
    return new Promise((resolve) => {
      const up = () => {
        this.canvas.removeEventListener('pointerup', up);
        resolve();
      };
      this.canvas.addEventListener('pointerup', up);
    });
  }

  // ------------------------------------------------------------------ sound shortcuts
  /** `puppetSound "name"` (channel 1); 0 / "" stops. */
  /** channels whose sound Lingo set with puppetSound (score sounds yield while it plays) */
  private soundPuppet: boolean[] = [];
  puppetSound(ref: number | string, ch = 1) {
    this.soundPuppet[ch] = !!ref;
    if (!ref) {
      csound.stop(ch);
      return;
    }
    const m = this.member(ref);
    if (m?.type === 'sound') void csound.playMember(ch, m);
  }

  soundBusy(ch: number) {
    return csound.busy(ch);
  }
}

function spriteKey(d: ScoreSprite) {
  return `${d.castId}|${d.castLib ?? ''}|${d.loc[0]},${d.loc[1]}|${d.w}x${d.h}|${d.ink}|${d.fore}|${d.back}|${d.script?.castId ?? 0}|${d.flags.join(',')}`;
}

export { csound };
