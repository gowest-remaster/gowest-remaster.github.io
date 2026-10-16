// Bitmap fonts for the Classic edition. Glyph atlases are pre-rendered without antialiasing
// (scripts/prepare_classic.py): Arial / Times New Roman / Courier New / MS Sans Serif from
// TrueType at em = point size in pixels, and the game's own Windows bitmap font ASIFONT.FON
// (ASI_System, ASI_Mono) decoded glyph by glyph. Text is laid out like a Director 4 field:
// CR line breaks, word wrap at the box width, left/centre/right alignment, style runs.
import { CLASSIC_BASE } from './cast.ts';

interface FontMeta {
  ascent: number;
  descent: number;
  height: number;
  file: string;
  glyphs: Record<string, [number, number, number, number]>; // x, w, advance, xoff
  bitmap?: boolean;
}

export interface Font {
  key: string;
  meta: FontMeta;
  mask: HTMLCanvasElement;
  tinted: Map<string, HTMLCanvasElement>;
}

let index: Record<string, FontMeta> | null = null;
const fonts = new Map<string, Promise<Font>>();
const ready = new Map<string, Font>();

export async function loadFontIndex() {
  if (!index) index = await fetch(`${CLASSIC_BASE}fonts/fonts.json`).then((r) => r.json());
  return index!;
}

// Director for Windows drew a field's "size" with a TrueType em a little larger than the size;
// each text member records its line ascent/height, so we pick the em whose ascent matches.
// For styles set from Lingo (no recorded metrics) these sizes were observed in the members.
const EM_TABLE: Record<string, Record<number, number>> = {
  Arial: { 10: 10, 12: 13, 14: 14, 18: 19, 24: 26 },
  TimesNewRoman: { 12: 14, 14: 16, 18: 19 },
  CourierNew: { 12: 13 },
  MSSansSerif: { 12: 11, 14: 14 },
};

function family(face: string | null | undefined): string {
  const f = (face ?? 'Arial').toLowerCase();
  if (f.includes('times')) return 'TimesNewRoman';
  if (f.includes('courier') || f.includes('lineprinter')) return 'CourierNew';
  if (f.includes('sans serif')) return 'MSSansSerif';
  return 'Arial';
}

/** Map a Director font spec (and, when known, the member's recorded line ascent) to an atlas key. */
export function fontKey(face: string | null | undefined, size: number | null | undefined, style: number | null | undefined, ascent?: number | null): string {
  const f = (face ?? 'Arial').toLowerCase();
  const sz = size ?? 12;
  const st = (style ?? 0) & 3;
  if (f.startsWith('asi_system')) {
    if (sz <= 11) return 'ASI_System-8-0-fon13';
    return st & 1 ? 'ASI_System-10-1-fon16' : 'ASI_System-10-0-fon16';
  }
  if (f.startsWith('asi_mono')) return sz <= 11 ? 'ASI_Mono-8-0-fon10' : 'ASI_Mono-10-0-fon13';
  const fam = family(face);
  const s2 = fam === 'MSSansSerif' ? st & 1 : st;
  let em = EM_TABLE[fam]?.[sz] ?? Math.round(sz * 1.08);
  if (ascent && index) {
    // the em whose ascent equals the recorded one (largest such em)
    let best = em;
    let bestD = Infinity;
    for (let e = 8; e <= 32; e++) {
      const m = index[`${fam}-${e}-${s2}`];
      if (!m) continue;
      const d = Math.abs(m.ascent - ascent);
      if (d < bestD || (d === bestD && e > best)) ((best = e), (bestD = d));
    }
    em = best;
  }
  em = Math.max(8, Math.min(32, em));
  return `${fam}-${em}-${s2}`;
}

export function getFont(key: string): Promise<Font> {
  let p = fonts.get(key);
  if (!p) {
    p = (async () => {
      const idx = await loadFontIndex();
      const meta = idx[key] ?? idx['Arial-12-0'];
      const img = new Image();
      img.src = `${CLASSIC_BASE}fonts/${meta.file}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const v = d.data[i];
        d.data[i] = d.data[i + 1] = d.data[i + 2] = 0;
        d.data[i + 3] = v > 127 ? 255 : 0;
      }
      ctx.putImageData(d, 0, 0);
      const f: Font = { key, meta, mask: c, tinted: new Map() };
      ready.set(key, f);
      return f;
    })();
    fonts.set(key, p);
  }
  return p;
}

/** Synchronous access once loaded (render path); null if not yet loaded (it starts loading). */
export function fontNow(key: string): Font | null {
  const f = ready.get(key);
  if (!f) void getFont(key);
  return f ?? null;
}

function tint(f: Font, color: string) {
  let c = f.tinted.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = f.mask.width;
    c.height = f.mask.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(f.mask, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    f.tinted.set(color, c);
  }
  return c;
}

const charCode = (ch: string) => {
  const c = ch.charCodeAt(0);
  if (c < 256) return c;
  const map: Record<string, number> = { '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, '…': 0x85, '•': 0x95 };
  return map[ch] ?? 63;
};

export function advance(f: Font, ch: string) {
  const g = f.meta.glyphs[charCode(ch)] ?? f.meta.glyphs[63];
  return g ? g[2] : 0;
}

export interface TextRun {
  font: Font;
  color: string;
  underline: boolean;
  lineHeight: number;
  ascent: number;
}

export interface LayoutOpts {
  width: number;
  align?: number; // 0 left, 1 centre, -1 right
  wrap?: boolean;
  /** pick the font/colour/metrics for the character at this offset */
  runAt: (offset: number) => TextRun;
}

export interface LaidLine {
  start: number;
  end: number; // exclusive, without the break
  width: number;
  height: number;
  ascent: number;
}

/** Break text (CR or LF line breaks) into lines that fit `width`, Director-style word wrap. */
export function layout(text: string, o: LayoutOpts): LaidLine[] {
  const lines: LaidLine[] = [];
  const s = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
  let i = 0;
  const pushLine = (start: number, end: number) => {
    let w = 0;
    let h = 0;
    let a = 0;
    for (let k = start; k < Math.max(end, start + 1) && k <= s.length; k++) {
      const r = o.runAt(Math.min(k, Math.max(0, s.length - 1)));
      if (k < end) w += advance(r.font, s[k]);
      h = Math.max(h, r.lineHeight);
      a = Math.max(a, r.ascent);
    }
    // trailing spaces do not count for alignment
    let tw = w;
    for (let k = end - 1; k >= start && s[k] === ' '; k--) tw -= advance(o.runAt(k).font, ' ');
    lines.push({ start, end, width: tw, height: h, ascent: a });
  };
  while (i <= s.length) {
    let j = s.indexOf('\r', i);
    if (j < 0) j = s.length;
    // wrap the paragraph [i, j) at spaces; hard-break words wider than the box
    let lineStart = i;
    let w = 0;
    let lastSpace = -1;
    for (let k = i; k < j; k++) {
      const ch = s[k];
      const adv = advance(o.runAt(k).font, ch);
      // break only at spaces: a single word wider than the field overflows and is clipped
      // (Windows word-break; e.g. "SEPT." in the 37-px LocDate field stays on one line)
      if (o.wrap !== false && ch !== ' ' && w + adv > o.width && k > lineStart && lastSpace >= lineStart) {
        pushLine(lineStart, lastSpace);
        lineStart = lastSpace + 1;
        while (lineStart < k && s[lineStart] === ' ') lineStart++;
        lastSpace = -1;
        w = 0;
        for (let q = lineStart; q < k; q++) w += advance(o.runAt(q).font, s[q]);
      }
      w += adv;
      if (ch === ' ') lastSpace = k;
    }
    pushLine(lineStart, j);
    if (j >= s.length) break;
    i = j + 1;
  }
  return lines;
}

/** Draw laid-out text into ctx at (x, y) clipped to (w, h). */
export function drawLines(ctx: CanvasRenderingContext2D, text: string, lines: LaidLine[], x: number, y: number, w: number, o: LayoutOpts, yOffset = 0) {
  const s = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
  let cy = y - yOffset;
  for (const ln of lines) {
    let cx = x;
    if (o.align === 1) cx = x + Math.floor((w - ln.width) / 2);
    else if (o.align === -1) cx = x + w - ln.width;
    for (let k = ln.start; k < ln.end; k++) {
      const r = o.runAt(k);
      const f = r.font;
      const code = charCode(s[k]);
      const g = f.meta.glyphs[code] ?? f.meta.glyphs[63];
      if (g) {
        const [gx, gw, adv, xoff] = g;
        if (gw > 0) {
          const atlas = tint(f, r.color);
          const top = cy + ln.ascent - f.meta.ascent;
          ctx.drawImage(atlas, gx, 0, gw, f.meta.height, cx + xoff, top, gw, f.meta.height);
        }
        if (r.underline) {
          ctx.fillStyle = r.color;
          ctx.fillRect(cx, cy + ln.ascent + 1, adv, 1);
        }
        cx += adv;
      }
    }
    cy += ln.height;
  }
}
