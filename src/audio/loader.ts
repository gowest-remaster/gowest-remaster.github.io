// Manifest + buffer loading. Picks Opus/Ogg where the browser decodes it, else AAC/m4a, and falls
// back to the other format if decoding fails. Decoded buffers are cached with a byte budget (LRU).
import { LOW_MEMORY, memStats } from '../lowmem.ts';
import type { AmbienceManifest, FileSet, MusicManifest, SfxManifest, VoiceManifest } from './types.ts';

export const AUDIO_BASE = `${import.meta.env.BASE_URL}assets/audio/`;

export interface Manifests {
  music: MusicManifest;
  ambience: AmbienceManifest;
  sfx: SfxManifest;
  voice: VoiceManifest;
}

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(AUDIO_BASE + path);
    if (!r.ok) return fallback;
    return (await r.json()) as T;
  } catch {
    return fallback;
  }
}

export async function loadManifests(): Promise<Manifests> {
  const [music, ambience, sfx, voice] = await Promise.all([
    getJson<MusicManifest>('music/manifest.json', { version: 1, contexts: {}, cues: {} }),
    getJson<AmbienceManifest>('ambience/manifest.json', { version: 1, beds: {}, oneshots: {} }),
    getJson<SfxManifest>('ui/manifest.json', { version: 1, sfx: {} }),
    getJson<VoiceManifest>('voice/manifest.json', { version: 1, lines: {} }),
  ]);
  return { music, ambience, sfx, voice };
}

function opusPreferred(): boolean {
  try {
    const a = document.createElement('audio');
    const ogg = a.canPlayType('audio/ogg; codecs="opus"');
    // Safari reports "maybe" for Ogg Opus in some versions but decodes it unreliably in WebAudio.
    const safari = /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent);
    return ogg !== '' && !safari;
  } catch {
    return false;
  }
}

export class BufferCache {
  private cache = new Map<string, AudioBuffer>();
  private inflight = new Map<string, Promise<AudioBuffer | null>>();
  private bytes = 0;
  private readonly preferOgg = opusPreferred();
  /** Paths never evicted (short sfx). */
  private pinned = new Set<string>();

  private ctx: BaseAudioContext;
  private budgetBytes: number;

  // (decoded PCM is ~11 MB per stereo minute: a phone keeps about the current music track plus short sounds)
  constructor(ctx: BaseAudioContext, budgetBytes = (LOW_MEMORY ? 40 : 160) * 1024 * 1024) {
    this.ctx = ctx;
    this.budgetBytes = budgetBytes;
  }

  has(files: FileSet): boolean {
    return this.cache.has(files.ogg) || this.cache.has(files.m4a);
  }

  peek(files: FileSet): AudioBuffer | null {
    const k = this.cache.has(files.ogg) ? files.ogg : files.m4a;
    const b = this.cache.get(k);
    if (b) {
      // refresh LRU order
      this.cache.delete(k);
      this.cache.set(k, b);
    }
    return b ?? null;
  }

  load(files: FileSet, pin = false): Promise<AudioBuffer | null> {
    const hit = this.peek(files);
    if (hit) return Promise.resolve(hit);
    const key = files.ogg;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const order = this.preferOgg ? [files.ogg, files.m4a] : [files.m4a, files.ogg];
    const p = (async () => {
      for (const path of order) {
        try {
          const r = await fetch(AUDIO_BASE + path);
          if (!r.ok) continue;
          const data = await r.arrayBuffer();
          const buf = await this.ctx.decodeAudioData(data);
          this.store(path, buf, pin);
          return buf;
        } catch {
          /* try the other format */
        }
      }
      console.warn('[audio] could not load', files.ogg);
      return null;
    })();
    this.inflight.set(key, p);
    p.finally(() => this.inflight.delete(key));
    return p;
  }

  private store(path: string, buf: AudioBuffer, pin: boolean) {
    const size = buf.length * buf.numberOfChannels * 4;
    this.cache.set(path, buf);
    this.bytes += size;
    memStats.audioBytes += size;
    if (pin) this.pinned.add(path);
    for (const [k, b] of this.cache) {
      if (this.bytes <= this.budgetBytes) break;
      if (this.pinned.has(k) || k === path) continue;
      this.cache.delete(k);
      this.bytes -= b.length * b.numberOfChannels * 4;
      memStats.audioBytes -= b.length * b.numberOfChannels * 4;
    }
  }
}
