// Cast libraries of the Classic edition: a movie's own cast plus the shared cast (SHARED.DIR,
// castIds 3000-3648, which never overlap movie casts). Bitmaps are kept as palette indices and
// drawn through the active palette (render.ts). Field (text) members are mutable, like Lingo's
// `put ... into field "X"`; edits to SHARED fields persist across movies as in the original.
import type { CastFile, CastMember, ScoreFile } from './types.ts';

export const CLASSIC_BASE = `${import.meta.env.BASE_URL}assets/classic/`;

export interface Member extends CastMember {
  id: number;
  lib: string;
  /** palette indices (w*h) for 8-bit and 1-bit bitmaps */
  idx?: Uint8Array;
  /** RGBA for direct-colour bitmaps */
  rgba?: Uint8ClampedArray;
  /** bumps on every change (text edits) so renders can be cached */
  version: number;
}

export class CastLib {
  readonly members = new Map<number, Member>();
  private byName = new Map<string, number>();
  readonly palettes = new Map<number, Uint8Array>();
  private loaded = false;
  private loading: Promise<void> | null = null;

  readonly name: string;

  constructor(name: string, file: CastFile) {
    this.name = name;
    for (const [k, m] of Object.entries(file.members)) {
      const id = Number(k);
      const mem: Member = { ...m, id, lib: name, version: 0 };
      this.members.set(id, mem);
      const key = (m.name ?? '').toLowerCase();
      if (key && !this.byName.has(key)) this.byName.set(key, id);
    }
    for (const [k, cols] of Object.entries(file.palettes)) this.palettes.set(Number(k), paletteBytes(cols));
  }

  get(id: number) {
    return this.members.get(id);
  }

  idOf(name: string) {
    return this.byName.get(name.toLowerCase());
  }

  /** Decode every bitmap of this library (palette indices). */
  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (!this.loading) {
      this.loading = (async () => {
        const list = [...this.members.values()].filter((m) => m.type === 'bitmap' && m.w);
        await pool(list, 12, (m) => loadBitmap(this.name, m));
        this.loaded = true;
      })();
    }
    return this.loading;
  }
}

export function paletteBytes(cols: (string | number[])[]): Uint8Array {
  const out = new Uint8Array(256 * 3);
  cols.forEach((c, i) => {
    if (typeof c === 'string') {
      const v = parseInt(c.slice(1), 16);
      out[i * 3] = (v >> 16) & 255;
      out[i * 3 + 1] = (v >> 8) & 255;
      out[i * 3 + 2] = v & 255;
    } else {
      out[i * 3] = c[0];
      out[i * 3 + 1] = c[1];
      out[i * 3 + 2] = c[2];
    }
  });
  return out;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const t = items[i++];
      try {
        await fn(t);
      } catch (e) {
        console.warn('classic: load failed', e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

const scratch = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/** Fetch an index PNG and read the grey values back as palette indices. */
async function loadBitmap(lib: string, m: Member) {
  // lossless WebP (pixel-exact with the original PNG; 2026-10-17 size pass)
  const res = await fetch(`${CLASSIC_BASE}${lib}/b/${m.id}.webp`);
  if (!res.ok) return;
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = scratch!;
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  bmp.close();
  m.w = c.width;
  m.h = c.height;
  if (m.direct) {
    m.rgba = new Uint8ClampedArray(data);
    return;
  }
  const idx = new Uint8Array(c.width * c.height);
  for (let i = 0, j = 0; i < idx.length; i++, j += 4) idx[i] = data[j];
  m.idx = idx;
}

// ------------------------------------------------------------------ registry
const libs = new Map<string, Promise<CastLib>>();
const scores = new Map<string, Promise<ScoreFile>>();
let builtin: Promise<Record<string, Uint8Array>> | null = null;

export function castLib(name: string): Promise<CastLib> {
  let p = libs.get(name);
  if (!p) {
    p = fetch(`${CLASSIC_BASE}${name}/cast.json`)
      .then((r) => r.json() as Promise<CastFile>)
      .then((f) => new CastLib(name, f));
    libs.set(name, p);
  }
  return p;
}

export function scoreOf(name: string): Promise<ScoreFile> {
  let p = scores.get(name);
  if (!p) {
    p = fetch(`${CLASSIC_BASE}${name}/score.json`).then((r) => r.json() as Promise<ScoreFile>);
    scores.set(name, p);
  }
  return p;
}

export function builtinPalettes(): Promise<Record<string, Uint8Array>> {
  if (!builtin) {
    builtin = fetch(`${CLASSIC_BASE}builtin_palettes.json`)
      .then((r) => r.json() as Promise<Record<string, string[]>>)
      .then((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, paletteBytes(v)])));
  }
  return builtin;
}

let extIndex: Promise<Record<string, string>> | null = null;
/** Resolve an original external file path (any case, `\` or `/`, any prefix up to DATA) to a URL. */
export async function extUrl(path: string): Promise<string | null> {
  if (!extIndex) extIndex = fetch(`${CLASSIC_BASE}ext/index.json`).then((r) => r.json());
  const idx = await extIndex;
  let p = path.replace(/\\/g, '/').replace(/^.*?(?=data\/)/i, '').toLowerCase();
  if (!idx[p]) {
    // .WAV in Lingo, .wav on disk; also try without the extension variants
    const alt = Object.keys(idx).find((k) => k === p || k.replace(/\.[a-z0-9]+$/, '') === p.replace(/\.[a-z0-9]+$/, ''));
    if (!alt) return null;
    p = alt;
  }
  return `${CLASSIC_BASE}ext/${idx[p]}`;
}
