// Layered ambience beds. Each bed loops by overlapping segments with a short (30 ms) crossfade at the
// loop point. The files carry a periodic pre-roll/tail, so the crossfade blends near-identical audio
// and any codec wrap step (AAC) is hidden. Levels glide; silent beds are released after a while.
// Outdoor beds run through a low-pass that closes when the scene is indoors (muffled weather).
import type { BufferCache } from './loader.ts';
import type { AmbienceManifest, Mix } from './types.ts';

const XF = 0.03;
const INDOOR_BEDS = new Set(['hearth', 'clock_tick']);
const dbToGain = (db: number) => Math.pow(10, db / 20);

interface Bed {
  id: string;
  level: GainNode;
  target: number;
  buffer: AudioBuffer | null;
  loading: boolean;
  nextT: number;
  segments: Set<AudioBufferSourceNode>;
  releaseAt: number;
}

export class AmbienceMixer {
  readonly out: GainNode;
  private outdoor: GainNode;
  private outdoorFilter: BiquadFilterNode;
  private indoorBus: GainNode;
  private beds = new Map<string, Bed>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private thunderOn = false;
  private thunderAt = 0;
  private ctx: AudioContext;
  private cache: BufferCache;
  private manifest: AmbienceManifest;

  constructor(ctx: AudioContext, cache: BufferCache, manifest: AmbienceManifest, dest: AudioNode) {
    this.ctx = ctx;
    this.cache = cache;
    this.manifest = manifest;
    this.out = ctx.createGain();
    this.outdoor = ctx.createGain();
    this.outdoorFilter = ctx.createBiquadFilter();
    this.outdoorFilter.type = 'lowpass';
    this.outdoorFilter.frequency.value = 18000;
    this.outdoorFilter.Q.value = 0.5;
    this.indoorBus = ctx.createGain();
    this.outdoor.connect(this.outdoorFilter).connect(this.out);
    this.indoorBus.connect(this.out);
    this.out.connect(dest);
  }

  get ids(): string[] {
    return Object.keys(this.manifest.beds);
  }

  /** Current target levels (for debugging/UI). */
  levels(): Record<string, number> {
    const r: Record<string, number> = {};
    for (const [id, b] of this.beds) r[id] = b.target;
    return r;
  }

  apply(mix: Mix, glide = 2.5) {
    const now = this.ctx.currentTime;
    // indoor muffling
    const f = mix.indoor > 0.5 ? 700 : 18000;
    this.outdoorFilter.frequency.cancelScheduledValues(now);
    this.outdoorFilter.frequency.setTargetAtTime(f, now, glide / 3);
    this.outdoor.gain.setTargetAtTime(mix.indoor > 0.5 ? 0.55 : 1, now, glide / 3);
    for (const id of new Set([...this.beds.keys(), ...Object.keys(mix.beds)])) {
      this.setLevel(id, mix.beds[id] ?? 0, glide);
    }
    this.thunderOn = mix.thunder;
    if (mix.thunder && this.thunderAt === 0) this.thunderAt = now + 6 + Math.random() * 10;
    if (!mix.thunder) this.thunderAt = 0;
    this.ensureTimer();
  }

  setLevel(id: string, level: number, glide = 2.5) {
    const meta = this.manifest.beds[id];
    if (!meta) return;
    let bed = this.beds.get(id);
    if (!bed) {
      if (level <= 0) return;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      g.connect(INDOOR_BEDS.has(id) ? this.indoorBus : this.outdoor);
      bed = { id, level: g, target: 0, buffer: null, loading: false, nextT: 0, segments: new Set(), releaseAt: 0 };
      this.beds.set(id, bed);
    }
    bed.target = level;
    const now = this.ctx.currentTime;
    const v = level * dbToGain(meta.gainDb);
    bed.level.gain.cancelScheduledValues(now);
    bed.level.gain.setTargetAtTime(v, now, Math.max(0.05, glide / 3));
    bed.releaseAt = level <= 0 ? now + glide * 2.5 + 0.5 : 0;
    if (level > 0 && !bed.buffer && !bed.loading) {
      bed.loading = true;
      void this.cache.load(meta.files).then((buf) => {
        bed.loading = false;
        bed.buffer = buf;
        this.pump();
      });
    }
    this.ensureTimer();
  }

  stopAll(fade = 1.5) {
    for (const id of this.beds.keys()) this.setLevel(id, 0, fade);
    this.thunderOn = false;
    this.thunderAt = 0;
  }

  /** One-shot thunder (also used by the director when weather turns stormy). */
  async thunder(level = 1) {
    const ids = Object.keys(this.manifest.oneshots).filter((k) => k.startsWith('thunder'));
    if (!ids.length) return;
    const id = ids[Math.floor(Math.random() * ids.length)];
    const meta = this.manifest.oneshots[id];
    const buf = await this.cache.load(meta.files);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = level * dbToGain(meta.gainDb) * (0.6 + Math.random() * 0.4);
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.6;
    src.connect(g).connect(pan).connect(this.outdoor);
    src.start();
    src.onended = () => pan.disconnect();
  }

  private ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => this.pump(), 400);
    this.pump();
  }

  private pump() {
    const now = this.ctx.currentTime;
    for (const [id, bed] of this.beds) {
      if (bed.releaseAt && now > bed.releaseAt) {
        for (const s of bed.segments) {
          try {
            s.stop();
          } catch {
            /* */
          }
        }
        bed.level.disconnect();
        this.beds.delete(id);
        continue;
      }
      if (!bed.buffer || bed.target <= 0) continue;
      const meta = this.manifest.beds[id];
      const L = meta.loopEnd - meta.loopStart;
      if (bed.nextT !== 0 && bed.nextT < now + 0.02) bed.nextT = 0; // resumed after a pause
      if (bed.nextT === 0) {
        // first segment: random entry point for variety, short fade in
        const off = Math.random() * (L - 1);
        bed.nextT = this.segment(bed, now + 0.05, meta.loopStart + off, L - off);
      }
      while (bed.nextT - now < 2.0) {
        bed.nextT = this.segment(bed, bed.nextT, meta.loopStart, L);
      }
    }
    if (this.thunderOn && this.thunderAt && now >= this.thunderAt) {
      void this.thunder();
      this.thunderAt = now + 18 + Math.random() * 30;
    }
    if (this.beds.size === 0 && !this.thunderOn && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Schedule one segment [offset, offset+dur) at time t with XF fades; returns the next start time. */
  private segment(bed: Bed, t: number, offset: number, dur: number): number {
    const src = this.ctx.createBufferSource();
    src.buffer = bed.buffer;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + XF);
    env.gain.setValueAtTime(1, t + dur);
    env.gain.linearRampToValueAtTime(0, t + dur + XF);
    src.connect(env).connect(bed.level);
    src.start(t, offset, dur + XF + 0.01);
    bed.segments.add(src);
    src.onended = () => {
      bed.segments.delete(src);
      env.disconnect();
    };
    return t + dur;
  }
}
