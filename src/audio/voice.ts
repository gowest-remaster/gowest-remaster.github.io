// Voice lines: the original 1996 recordings (loudness-matched only), with caption cues.
import type { BufferCache } from './loader.ts';
import type { Caption, VoiceLine, VoiceManifest } from './types.ts';

export type VoiceEvent =
  | { type: 'start'; id: string; speaker: string; text: string }
  | { type: 'caption'; id: string; speaker: string; caption: Caption; index: number }
  | { type: 'clear'; id: string }
  | { type: 'end'; id: string; interrupted: boolean };

export interface VoiceHandle {
  id: string;
  line: VoiceLine | undefined;
  /** All caption cues up front (for UIs that render their own timing). */
  captions: Caption[];
  /** Subscribe to start / caption / clear / end events. Returns an unsubscribe function. */
  on(cb: (e: VoiceEvent) => void): () => void;
  /** Resolves when the line has finished (or was stopped). Never rejects. */
  done: Promise<void>;
  stop(): void;
}

export class VoicePlayer {
  readonly out: GainNode;
  private active = new Set<() => void>();
  private ctx: AudioContext;
  private cache: BufferCache;
  private manifest: VoiceManifest;
  /** Called with the number of lines currently speaking (director ducks music/ambience). */
  onActivity: ((speaking: number) => void) | null = null;

  constructor(ctx: AudioContext, cache: BufferCache, manifest: VoiceManifest, dest: AudioNode) {
    this.ctx = ctx;
    this.cache = cache;
    this.manifest = manifest;
    this.out = ctx.createGain();
    this.out.connect(dest);
  }

  line(id: string): VoiceLine | undefined {
    return this.manifest.lines[id];
  }

  get ids(): string[] {
    return Object.keys(this.manifest.lines);
  }

  preload(id: string) {
    const l = this.line(id);
    if (l) void this.cache.load(l.files);
  }

  stopAll() {
    for (const stop of [...this.active]) stop();
  }

  play(id: string, opts: { interrupt?: boolean; muted?: boolean } = {}): VoiceHandle {
    const line = this.line(id);
    const listeners = new Set<(e: VoiceEvent) => void>();
    const emit = (e: VoiceEvent) => {
      for (const cb of listeners) {
        try {
          cb(e);
        } catch (err) {
          console.error(err);
        }
      }
    };
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => (resolveDone = r));
    const timers: ReturnType<typeof setTimeout>[] = [];
    let src: AudioBufferSourceNode | null = null;
    let finished = false;
    let stopped = false;
    const finish = (interrupted: boolean) => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      emit({ type: 'clear', id });
      emit({ type: 'end', id, interrupted });
      this.active.delete(stopFn);
      this.onActivity?.(this.active.size);
      resolveDone();
    };
    const stopFn = () => {
      stopped = true;
      try {
        src?.stop();
      } catch {
        /* not started */
      }
      finish(true);
    };
    const handle: VoiceHandle = {
      id,
      line,
      captions: line?.captions ?? [],
      on(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      done,
      stop: stopFn,
    };
    if (!line) {
      console.warn('[audio] unknown voice line', id);
      queueMicrotask(() => finish(false));
      return handle;
    }
    if (opts.interrupt !== false) this.stopAll();
    this.active.add(stopFn);
    this.onActivity?.(this.active.size);
    void this.cache.load(line.files).then((buf) => {
      if (stopped) return;
      const scheduleCaptions = (startDelayMs: number) => {
        emit({ type: 'start', id, speaker: line.speaker, text: line.text });
        line.captions.forEach((c, index) => {
          timers.push(setTimeout(() => emit({ type: 'caption', id, speaker: line.speaker, caption: c, index }), startDelayMs + c.start * 1000));
        });
        const last = line.captions[line.captions.length - 1];
        if (last) timers.push(setTimeout(() => emit({ type: 'clear', id }), startDelayMs + (last.end + 0.25) * 1000));
      };
      if (!buf || opts.muted) {
        // No audio (missing file or voice muted): still show captions at speaking pace.
        scheduleCaptions(0);
        timers.push(setTimeout(() => finish(false), (line.duration + 0.2) * 1000));
        return;
      }
      src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.out);
      const t = this.ctx.currentTime + 0.12; // let the duck settle first
      src.start(t);
      scheduleCaptions(120);
      src.onended = () => finish(false);
    });
    return handle;
  }
}
