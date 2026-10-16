// Music player: one cue at a time. Changes are a clean dip (fade out, a breath, new cue from its
// start), never an overlap; stings dip the music to near-silence and play alone.
//
// Loops use AudioBufferSourceNode.loopStart/loopEnd from the manifest. The files carry a periodic
// pre-roll and tail (see tools/audio/build_music.py) so the native loop is seamless and robust to
// codec priming offsets.
import type { BufferCache } from './loader.ts';
import type { MusicCue, MusicManifest } from './types.ts';

interface Track {
  cue: MusicCue;
  src: AudioBufferSourceNode;
  /** fade-in and fade-out live on separate nodes so their automation never overlaps */
  gain: GainNode;
  fadeOut: GainNode;
  /** ctx time at which the cue's musical time 0 (loopStart for loops, file start for one-shots) plays. */
  t0: number;
  stopping: boolean;
}

export interface ChangeOptions {
  /** Kept for compatibility; changes now always respond immediately (no bar-line wait). */
  quantize?: 'bar' | 'beat' | 'now';
  /** Fade-out of the old cue in seconds (default 1.2, ease-out). */
  fadeOut?: number;
  /** Silence between the old cue ending and the new one starting (default 0.4 s). */
  gap?: number;
  /** Fade-in of the new cue in seconds (default 0.3; 1.5 when starting from silence). */
  fadeIn?: number;
  /** @deprecated unused */
  maxWait?: number;
}

/** Sampled gain curves. Fade-in: sine ease. Fade-out: ease-out (drops promptly, settles gently). */
const curve = (from: number, to: number, n = 64) => {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    a[i] = to > from ? from + (to - from) * Math.sin((t * Math.PI) / 2) : to + (from - to) * (1 - t) * (1 - t);
  }
  return a;
};

const STING_DUCK = 0.003; // about -50 dB: music is effectively silent under a sting
const STING_ATTACK = 0.3;

export class MusicPlayer {
  readonly out: GainNode;
  private stingBus: GainNode;
  private stingDuck: GainNode;
  private current: Track | null = null;
  private live = new Set<Track>();
  /** ctx time by which every fading track has stopped. */
  private quietAt = 0;
  private wanted: string | null = null;
  private oneshotReturn: string | null = null;
  private seq = 0;
  private stingsUntil = 0;
  private ctx: AudioContext;
  private cache: BufferCache;
  private manifest: MusicManifest;
  /** Called when a one-shot cue (finale, goal) has finished; the director then restores the scene cue. */
  onOneshotEnd: ((id: string) => void) | null = null;

  constructor(ctx: AudioContext, cache: BufferCache, manifest: MusicManifest, dest: AudioNode) {
    this.ctx = ctx;
    this.cache = cache;
    this.manifest = manifest;
    this.out = ctx.createGain();
    this.stingDuck = ctx.createGain(); // music under a sting
    this.stingBus = ctx.createGain();
    this.stingDuck.connect(this.out);
    this.stingBus.connect(this.out);
    this.out.connect(dest);
  }

  /** Debug/verification: effective gain of every live music track and the sting state, right now. */
  debugLevels(): { tracks: { id: string; gain: number; started: boolean }[]; duck: number; sting: boolean } {
    const now = this.ctx.currentTime;
    return {
      tracks: [...this.live].map((t) => ({ id: t.cue.id, gain: now < t.t0 ? 0 : t.gain.gain.value * t.fadeOut.gain.value, started: now >= t.t0 })),
      duck: this.stingDuck.gain.value,
      sting: now < this.stingsUntil,
    };
  }

  cue(id: string): MusicCue | undefined {
    return this.manifest.cues[id];
  }

  get playing(): string | null {
    return this.current && !this.current.stopping ? this.current.cue.id : null;
  }

  /** Musical position of the current cue: bar (1-based) and beat within it. */
  position(): { cue: string; bar: number; beat: number; seconds: number } | null {
    const tr = this.current;
    if (!tr) return null;
    const pos = this.posAt(tr, this.ctx.currentTime);
    const bar = Math.floor(pos / tr.cue.barSec);
    const beat = Math.floor((pos - bar * tr.cue.barSec) / (tr.cue.barSec / tr.cue.beatsPerBar));
    return { cue: tr.cue.id, bar: bar + 1, beat: beat + 1, seconds: pos };
  }

  preload(id: string) {
    const c = this.cue(id);
    if (c) void this.cache.load(c.files);
  }

  /**
   * Change to cue `id` (null = fade to silence). Responds immediately with a clean dip: the old cue
   * fades out (1.2 s ease-out), a short breath of silence (0.4 s), then the new cue starts from its
   * beginning with a short fade-in. Two different cues never sound together. Same cue: keeps playing.
   */
  async play(id: string | null, opts: ChangeOptions = {}): Promise<void> {
    if (id !== null && this.current && !this.current.stopping && this.current.cue.id === id) {
      this.wanted = id;
      return;
    }
    if (id === null && this.wanted === null && !this.current) return;
    this.wanted = id;
    const my = ++this.seq;
    const hadMusic = !!this.current || this.quietAt > this.ctx.currentTime;
    this.fadeOutCurrent(this.ctx.currentTime + 0.02, opts.fadeOut);
    if (id === null) return;
    const cue = this.cue(id);
    if (!cue) {
      console.warn('[audio] unknown music cue', id);
      return;
    }
    if (cue.kind === 'oneshot') this.oneshotReturn = this.lastLoop ?? this.oneshotReturn;
    const buf = await this.cache.load(cue.files);
    if (!buf || my !== this.seq) return; // superseded while loading
    const at = Math.max(this.ctx.currentTime + 0.05, this.quietAt + (opts.gap ?? 0.4));
    const gain = this.ctx.createGain();
    const fadeOut = this.ctx.createGain();
    gain.connect(fadeOut);
    fadeOut.connect(this.stingDuck);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    const startOffset = cue.kind === 'loop' ? (cue.loopStart ?? 0) : 0;
    if (cue.kind === 'loop') {
      src.loop = true;
      src.loopStart = cue.loopStart ?? 0;
      src.loopEnd = cue.loopEnd ?? buf.duration;
      this.lastLoop = cue.id;
    }
    const fadeIn = opts.fadeIn ?? (hadMusic ? 0.3 : 1.5);
    gain.gain.setValueAtTime(0, 0);
    if (fadeIn > 0) gain.gain.setValueCurveAtTime(curve(0, 1), at, fadeIn);
    else gain.gain.setValueAtTime(1, at);
    src.start(at, startOffset);
    const track: Track = { cue, src, gain, fadeOut, t0: at, stopping: false };
    this.current = track;
    this.live.add(track);
    src.onended = () => {
      fadeOut.disconnect();
      this.live.delete(track);
      if (this.current === track) {
        this.current = null;
        if (cue.kind === 'oneshot') {
          this.wanted = null;
          this.onOneshotEnd?.(cue.id);
        }
      }
    };
  }

  private lastLoop: string | null = null;

  /** The loop that was playing before the last one-shot, if any. */
  takeReturnCue(): string | null {
    const r = this.oneshotReturn;
    this.oneshotReturn = null;
    return r;
  }

  /**
   * Play a short sting. The music dips to near-silence first (0.3 s), the sting plays alone, then
   * the music comes back over 1.2 s. The sting never layers on audible music.
   */
  async sting(id: string, level = 1): Promise<void> {
    const cue = this.cue(id);
    if (!cue) {
      console.warn('[audio] unknown sting', id);
      return;
    }
    const buf = await this.cache.load(cue.files);
    if (!buf) return;
    const now = this.ctx.currentTime;
    const d = this.stingDuck.gain;
    const ducked = now < this.stingsUntil; // already ducked by an earlier sting
    const t = ducked ? now + 0.02 : now + STING_ATTACK + 0.02;
    d.cancelScheduledValues(now);
    d.setValueAtTime(d.value, now);
    if (!ducked) d.linearRampToValueAtTime(STING_DUCK, now + STING_ATTACK);
    else d.setValueAtTime(STING_DUCK, now + 0.01);
    const end = t + buf.duration;
    this.stingsUntil = Math.max(this.stingsUntil, end);
    const release = this.stingsUntil - 0.15;
    d.setValueAtTime(STING_DUCK, release);
    d.setValueCurveAtTime(curve(STING_DUCK, 1), release, 1.2);
    const g = this.ctx.createGain();
    g.gain.value = level;
    g.connect(this.stingBus);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g);
    src.start(t);
    src.onended = () => g.disconnect();
  }

  stopAll(fade = 1.2) {
    this.wanted = null;
    this.seq++;
    this.fadeOutCurrent(this.ctx.currentTime, fade);
  }

  private posAt(tr: Track, t: number): number {
    const raw = Math.max(0, t - tr.t0);
    if (tr.cue.kind !== 'loop') return raw;
    const len = (tr.cue.loopEnd ?? 0) - (tr.cue.loopStart ?? 0);
    return len > 0 ? raw % len : raw;
  }

  private fadeOutCurrent(at: number, fade = 1.2) {
    const tr = this.current;
    this.current = null;
    if (!tr || tr.stopping) return;
    tr.stopping = true;
    if (at < tr.t0) {
      // scheduled but not started yet (we were in the breath): cancel it outright
      try {
        tr.src.stop();
      } catch {
        /* */
      }
      return;
    }
    tr.fadeOut.gain.setValueCurveAtTime(curve(1, 0), at, fade);
    try {
      tr.src.stop(at + fade + 0.01);
    } catch {
      /* already stopped */
    }
    this.quietAt = Math.max(this.quietAt, at + fade + 0.01);
  }
}
