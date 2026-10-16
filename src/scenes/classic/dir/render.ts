// Bitmap member -> canvas through a palette and an ink, as Director 4 draws in 8-bit mode.
// Index 0 is white and 255 black in every Director palette; inks key on palette indices:
//   copy                     opaque rectangle
//   matte                    white (index 0) pixels flood-connected to the bitmap edge are clear
//   backgroundTransparent /  pixels equal to the sprite's back colour index are clear
//   transparent
//   notGhost                 white pixels are clear
//   reverse / notReverse     drawn as a difference blend by the compositor (XOR-like)
// 1-bit bitmaps map 1 -> fore index, 0 -> back index before the ink applies.
import type { Member } from './cast.ts';

const cache = new WeakMap<Member, Map<string, HTMLCanvasElement>>();
const masks = new WeakMap<HTMLCanvasElement, Uint8Array>();

export interface InkParams {
  ink: number;
  fore: number;
  back: number;
}

export function inkKind(ink: number): 'copy' | 'matte' | 'bgTransparent' | 'notGhost' | 'reverse' {
  switch (ink & 0x3f) {
    case 8:
      return 'matte';
    case 1:
    case 36:
      return 'bgTransparent';
    case 7:
    case 3:
      return 'notGhost';
    case 2:
    case 6:
      return 'reverse';
    default:
      return 'copy';
  }
}

/** Canvas for a bitmap member under a palette (identified by `palKey`) and ink. */
export function memberCanvas(m: Member, pal: Uint8Array, palKey: string, p: InkParams): HTMLCanvasElement | null {
  if (!m.w || !m.h || (!m.idx && !m.rgba)) return null;
  const kind = inkKind(p.ink);
  const oneBit = (m.depth ?? 8) === 1;
  const key = `${palKey}|${kind}|${oneBit || kind === 'bgTransparent' ? `${p.fore},${p.back}` : ''}`;
  let per = cache.get(m);
  if (!per) {
    per = new Map();
    cache.set(m, per);
  }
  const hit = per.get(key);
  if (hit) return hit;
  const w = m.w;
  const h = m.h;
  const n = w * h;
  // effective indices
  let idx: Uint8Array;
  let white: Uint8Array; // 1 where the pixel is "white" for keying
  const out = new Uint8ClampedArray(n * 4);
  if (m.rgba) {
    const src = m.rgba;
    white = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      out[j] = src[j];
      out[j + 1] = src[j + 1];
      out[j + 2] = src[j + 2];
      out[j + 3] = 255;
      white[i] = src[j] === 255 && src[j + 1] === 255 && src[j + 2] === 255 ? 1 : 0;
    }
    idx = white; // unused for colour below
  } else {
    const src = m.idx!;
    if (oneBit) {
      idx = new Uint8Array(n);
      for (let i = 0; i < n; i++) idx[i] = src[i] ? p.fore : p.back;
    } else idx = src;
    white = new Uint8Array(n);
    const keyIdx = kind === 'bgTransparent' ? p.back : 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const v = idx[i] * 3;
      out[j] = pal[v];
      out[j + 1] = pal[v + 1];
      out[j + 2] = pal[v + 2];
      out[j + 3] = 255;
      white[i] = idx[i] === keyIdx ? 1 : 0;
    }
  }
  if (kind === 'bgTransparent' || kind === 'notGhost') {
    for (let i = 0; i < n; i++) if (white[i]) out[i * 4 + 3] = 0;
  } else if (kind === 'matte') {
    const clear = edgeFlood(white, w, h);
    for (let i = 0; i < n; i++) if (clear[i]) out[i * 4 + 3] = 0;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(out, w, h), 0, 0);
  // hit mask for matte sprites (Director hit-tests matte sprites by their opaque pixels)
  if (kind === 'matte' || kind === 'bgTransparent') {
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = out[i * 4 + 3] ? 1 : 0;
    masks.set(c, mask);
  }
  per.set(key, c);
  return c;
}

export function hitMask(c: HTMLCanvasElement) {
  return masks.get(c);
}

/** Pixels with `key` set that are 4-connected to the border. */
function edgeFlood(key: Uint8Array, w: number, h: number): Uint8Array {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => {
    if (key[i] && !seen[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  return seen;
}

export function rgbOf(pal: Uint8Array, index: number) {
  const v = (index & 255) * 3;
  return `rgb(${pal[v]},${pal[v + 1]},${pal[v + 2]})`;
}
