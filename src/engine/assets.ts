// Original cast art registry for the Classic app's HTML dialogs (ui/prompts.ts portraits):
// public/assets/orig/manifest.json, written by scripts/prepare_assets.py.

export interface OrigEntry {
  file: string;
  /** stage rect in 640x480 coordinates */
  x: number;
  y: number;
  w: number;
  h: number;
  regX: number;
  regY: number;
  scale: number;
  /** hit polygon in original pixels (parallelogram sprites) */
  quad?: [number, number][] | null;
}

const BASE = `${import.meta.env.BASE_URL}assets/`;
let manifest: Record<string, OrigEntry> = {};

export async function loadManifest() {
  const res = await fetch(`${BASE}orig/manifest.json`);
  manifest = await res.json();
}

export function orig(key: string): OrigEntry {
  const e = manifest[key];
  if (!e) throw new Error(`unknown original asset ${key}`);
  return e;
}

export function hasOrig(key: string) {
  return key in manifest;
}

export function assetUrl(rel: string) {
  return BASE + rel;
}
