// Original cast art lookups (portraits, letterheads, signatures) without pulling in Pixi.
// Reads public/assets/orig/manifest.json once; Remastered-only extras (album pictures, intro
// slides, newspaper pages) live in public/assets/rm/ (scripts/prepare-remastered-assets.ts).
import { devcutPortrait, devcutSignature } from './text.ts';

const BASE = `${import.meta.env.BASE_URL}assets/`;
let manifest: Record<string, { file: string }> = {};
let rmManifest: Record<string, string> = {};

export async function loadArt() {
  try {
    manifest = await (await fetch(`${BASE}orig/manifest.json`)).json();
  } catch {
    manifest = {};
  }
  try {
    const r = await fetch(`${BASE}rm/manifest.json`);
    if (r.ok) rmManifest = await r.json();
  } catch {
    rmManifest = {};
  }
}

const url = (key: string) => (manifest[key] ? BASE + manifest[key].file : null);

/** DBox portrait (the original dialog box art; the person stands at its right edge). */
export function portrait(dbox: string | null | undefined): string | null {
  if (!dbox || dbox === 'DBox0' || dbox === '0') return null;
  return url(`CALEND.${dbox}`) ?? url(`FIELD.${dbox}`) ?? devcutPortrait(dbox);
}
export function letterhead(had: string | null | undefined) {
  return had && had !== '0' ? url(`CALEND.${had}`) : null;
}
export function signature(sig: string | null | undefined) {
  return sig && sig !== '0' ? url(`CALEND.${sig.toUpperCase()}`) ?? url(`CALEND.${sig}`) ?? devcutSignature(sig) : null;
}
/** Remastered extra art by key (e.g. "album/12", "intro/INTRO01", "news/1880/front"). */
export function rmArt(key: string): string | null {
  const f = rmManifest[key];
  return f ? `${BASE}rm/${f}` : null;
}

/** Who speaks for a DBox portrait (new UI copy for the name plate). */
export function speakerFor(dbox: string | null | undefined, names: string[] = []): string | null {
  const n = (i: number) => (names[i] && names[i] !== 'a' ? names[i] : null);
  switch (dbox) {
    case 'DBox2':
    case 'DBox13':
      return 'Lilly Mae';
    case 'DBox12':
      return n(1) ?? 'Your daughter';
    case 'DBox23':
      return n(2) ?? 'Your son';
    case 'DBox01':
    case 'DBox32':
      return n(0) ?? 'Your son';
    case 'DBox1':
    case 'DBox19':
    case 'NeibY':
    case 'NeibO':
      return 'Your neighbor';
    case 'DBox8':
      return 'The banker';
    case 'DBox9':
      return 'The teacher';
    case 'DBox11':
      return 'The doctor';
    case 'DBox5':
      return 'Your neighbor';
    default:
      return null;
  }
}

/** Default portrait for messages the sim emits without one (mirrors ui/prompts.ts). */
export function defaultBox(id: string, year: number): string | undefined {
  if (/^(NoPlow|Noplow|NoPlant|NoHarv|StopPlow|StopHarv|FDBK|EndHarv|OneWor|ManyWor|NoMoney|Tractor)/.test(id)) return year < 1887 ? 'NeibY' : 'NeibO';
  if (/^SEG(6|7)/.test(id)) return 'DBox5';
  if (/^(Loan|SEG0|BigReturn|NothingToReturn|TakeMoney|needharvest|OK)/.test(id)) return 'DBox8';
  if (/^NoM\d|^NOM\d/.test(id)) return year < 1887 ? 'DBox1' : 'DBox19';
  return undefined;
}
