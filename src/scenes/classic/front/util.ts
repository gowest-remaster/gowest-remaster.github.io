// Helpers shared by the front-of-game ports (LOGIN, OPEN, INTRO): Edunetics-style buttons,
// score markers, Lingo property-list parsing, external video, and user profiles.
import type { DirPlayer } from '../dir/player.ts';
import { extUrl } from '../dir/cast.ts';
import { csound } from '../dir/sound.ts';
import { saves, type Profile } from '../../../engine/save.ts';

/**
 * LOGIN/INTRO `bPressBtn()`: named art "btn X,up" / "btn X,dwn"; the down art follows the
 * mouse while it is held; returns true when released over the button. "...,dim" art is inert.
 */
export async function pressBtn(d: DirPlayer, ch = d.clickOn): Promise<boolean> {
  const s = d.sprite(ch);
  const name = s.member?.name ?? '';
  if (!name.startsWith('btn')) return false;
  const parts = name.split(',');
  if (parts[parts.length - 1] === 'dim') return true; // original returns its initial 1 here
  const base = parts[0];
  const down = d.member(`${base},dwn`);
  const up = d.member(`${base},up`);
  const wasPuppet = s.puppet;
  d.puppetSprite(ch, true);
  if (down) d.setCast(ch, down);
  let isDown = true;
  if (d.rollOver(ch)) {
    await d.trackMouse(() => {
      const over = d.rollOver(ch);
      if (over && !isDown) {
        if (down) d.setCast(ch, down);
        isDown = true;
      } else if (!over && isDown) {
        if (up) d.setCast(ch, up);
        isDown = false;
      }
    });
  }
  if (up) d.setCast(ch, up);
  d.puppetSprite(ch, wasPuppet);
  return isDown;
}

/** Labels sorted by frame. */
function labelList(d: DirPlayer): [string, number][] {
  return Object.entries(d.movie?.score.labels ?? {}).sort((a, b) => a[1] - b[1]);
}

/** Lingo `marker(n)`: 0 = the label at/before the current frame, 1 = the next label, -1 = previous... */
export function marker(d: DirPlayer, n: number): number {
  const ls = labelList(d);
  let i = -1;
  for (let k = 0; k < ls.length; k++) if (ls[k][1] <= d.frame) i = k;
  const j = i + n;
  if (j < 0) return ls[0]?.[1] ?? 1;
  if (j >= ls.length) return d.movie?.score.frameCount ?? d.frame;
  return ls[j][1];
}

/** Lingo `the frameLabel`: the label on exactly this frame, or "". */
export function frameLabelHere(d: DirPlayer): string {
  for (const [k, v] of labelList(d)) if (v === d.frame) return k;
  return '';
}

/** Parse a Lingo property list of integers, e.g. "[0: 0, 1: 160, 2: 393]" -> Map. */
export function parsePropList(s: string): Map<number, number> {
  const m = new Map<number, number>();
  const re = /(-?\d+)\s*:\s*(-?\d+)/g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(s))) m.set(Number(x[1]), Number(x[2]));
  return m;
}

/** `go` and let the player enter the frame before continuing (outside exitFrame). */
export async function goNow(d: DirPlayer, f: number | string) {
  d.go(f);
  await Promise.resolve();
  await Promise.resolve();
}

/** An external QuickTime movie as an HTML video (falls back to muted, or null if it cannot play). */
export async function openVideo(path: string): Promise<HTMLVideoElement | null> {
  const url = await extUrl(path);
  if (!url) return null;
  const v = document.createElement('video');
  v.src = url;
  v.playsInline = true;
  v.preload = 'auto';
  v.volume = Math.min(1, csound.level / 7);
  return v;
}

/** Start a video; resolves false when the browser cannot play it (codec, autoplay). */
export async function startVideo(v: HTMLVideoElement): Promise<boolean> {
  // play() can stay pending forever when the codec is missing: give up after a while
  const attempt = () =>
    Promise.race([
      v.play().then(() => true),
      new Promise<boolean>((_, rej) => setTimeout(() => rej(new Error('video timeout')), 2500)),
    ]);
  try {
    return await attempt();
  } catch {
    if (v.error) return false;
    try {
      v.muted = true;
      return await attempt();
    } catch {
      v.pause();
      return false;
    }
  }
}

// ------------------------------------------------------------------ users (LOGIN)
/** An Edunetics user = an engine profile named by the (upper-case) user ID. */
export interface UserProfile extends Profile {
  first?: string;
  last?: string;
}

export async function findUser(id: string): Promise<UserProfile | null> {
  const list = (await saves.listProfiles()) as UserProfile[];
  return list.find((p) => p.name.toUpperCase() === id.toUpperCase()) ?? null;
}

export async function createUser(id: string, first: string, last: string): Promise<UserProfile> {
  const p = (await saves.createProfile(id.toUpperCase())) as UserProfile;
  p.first = first;
  p.last = last;
  await saves.putProfile(p);
  return p;
}
