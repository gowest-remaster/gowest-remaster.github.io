// SHARED "Animation object script" (ScoreScript 3201, spec 01 §6.8) for the town talk: steps a
// sprite through a cast range once per score frame (the actorList), with loop counts, an end
// script, and sync to a sound channel (stop when the channel goes quiet). Locations are not
// animated here (the town talk never moves its actors).
import type { DirPlayer } from '../dir/player.ts';
import { csound } from '../dir/sound.ts';

export class Actors {
  list: AnimObj[] = [];
  step() {
    for (const a of [...this.list]) a.step();
  }
  clear() {
    this.list = [];
  }
}

export type LoopMode = number | 'forever';

export class AnimObj {
  readonly sprite: number;
  readonly start: number;
  readonly end: number;
  cur = 0;
  loop: LoopMode = 'forever';
  private counter = 1;
  endScript: () => void = () => {};
  sync = 0;
  /** sound-sync becomes active once the sound has been started (it is fetched async) */
  syncArmed = false;
  mode: 'play' | 'stop' | 'pause' = 'stop';
  private puppetStart: boolean;
  private d: DirPlayer;
  private actors: Actors;

  private constructor(d: DirPlayer, actors: Actors, sprite: number, start: number, end: number) {
    this.d = d;
    this.actors = actors;
    this.sprite = sprite;
    this.start = start;
    this.end = end;
    this.puppetStart = d.sprite(sprite).puppet;
  }

  /** edANOpen(sprite, startCast, endCast): null for the original's error symbols. */
  static open(d: DirPlayer, actors: Actors, sprite: number, start: string | number, end: string | number): AnimObj | null {
    const s = typeof start === 'number' ? start : d.castNumber(start);
    const e = typeof end === 'number' ? end : d.castNumber(end);
    if (!s || !e || e < s || sprite < 1 || sprite > 48) return null;
    return new AnimObj(d, actors, sprite, s, e);
  }

  play() {
    if (this.actors.list.includes(this)) this.stop();
    const d = this.d;
    d.puppetSprite(this.sprite, true);
    this.counter = 1;
    this.cur = this.start;
    d.setCast(this.sprite, this.start);
    // edANGetDefLoc: a sprite parked off stage animates at the stage centre
    const sp = d.sprite(this.sprite);
    if (!(sp.locH > 0 && sp.locV > 0 && sp.locH < 640 && sp.locV < 480)) d.setLoc(this.sprite, 320, 240);
    this.actors.list.push(this);
    this.mode = 'play';
  }

  pause() {
    const i = this.actors.list.indexOf(this);
    if (i >= 0) this.actors.list.splice(i, 1);
    this.mode = 'pause';
  }

  stop() {
    this.pause();
    this.d.puppetSprite(this.sprite, this.puppetStart);
    this.mode = 'stop';
  }

  close() {
    this.stop();
  }

  setLoop(l: LoopMode) {
    this.counter = 1;
    this.loop = l;
  }

  step() {
    const next = this.nextCast();
    if (next !== null) {
      this.cur = next;
      this.d.setCast(this.sprite, next);
    }
    if (this.mode !== 'play') return;
    if (this.sync && this.syncArmed && !csound.busy(this.sync)) {
      this.stop();
      this.endScript();
    }
  }

  private nextCast(): number | null {
    if (this.cur < this.end) return this.cur + 1;
    if (typeof this.loop === 'number') {
      if (this.counter < this.loop) {
        this.counter++;
        return this.start;
      }
      this.pause();
      this.endScript();
      return null;
    }
    return this.start;
  }
}
