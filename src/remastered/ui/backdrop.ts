// The title backdrop: a pre-rendered Cycles loop of the homestead (public/world/title/), shown behind
// the title menu and the New Game pages instead of rendering the live world. The world is told it is
// 'covered' (it draws nothing, but keeps streaming and compiling the homestead in the background);
// when the player enters the game the backdrop fades into the live homestead.
//  - sources: title.mp4 (the better codec) or title-h264.mp4, chosen by canPlayType, falling back on error;
//  - muted, autoplay, loop, playsinline, object-fit cover, poster first;
//  - reduced motion: the poster only;
//  - no video yet: poster.webp, or our own still (assets/rm/title-still.jpg) when that's missing too.
import gsap from 'gsap';
import type { App } from '../core/app.ts';
import { h } from '../core/dom.ts';
import { reducedMotion } from '../core/settings.ts';

const BASE = import.meta.env.BASE_URL;
const DIR = `${BASE}world/title/`;
const STILL = `${BASE}assets/rm/title-still.jpg`;

let el: HTMLElement | null = null;
let video: HTMLVideoElement | null = null;
let shown = false;
let fading: gsap.core.Tween | null = null;

/** HEVC or AV1 for title.mp4 when the browser plays it; H.264 otherwise. */
function sources(v: HTMLVideoElement): string[] {
  const best = ['video/mp4; codecs="av01.0.08M.08"', 'video/mp4; codecs="hvc1.1.6.L120.90"', 'video/mp4; codecs="hev1.1.6.L120.90"'].some((t) => v.canPlayType(t) === 'probably');
  const h264 = v.canPlayType('video/mp4; codecs="avc1.640028"') !== '';
  const list = best ? [`${DIR}title.mp4`, `${DIR}title-h264.mp4`] : [`${DIR}title-h264.mp4`, `${DIR}title.mp4`];
  return h264 || best ? list : [];
}

function build(app: App) {
  const img = h('img', { class: 'bd-still', alt: '', src: `${DIR}poster.webp`, decoding: 'async' }) as HTMLImageElement;
  img.addEventListener('error', () => img.src !== new URL(STILL, location.href).href && (img.src = STILL), { once: true });
  el = h('div', { class: 'rm-backdrop', 'aria-hidden': 'true', hidden: true }, img);
  app.worldHost.after(el);
  if (reducedMotion()) return;
  const v = h('video', { class: 'bd-video', muted: true, autoplay: true, loop: true, playsinline: true, preload: 'auto', poster: `${DIR}poster.webp` }) as HTMLVideoElement;
  v.muted = true;
  v.defaultMuted = true;
  v.setAttribute('muted', '');
  v.setAttribute('playsinline', '');
  const list = sources(v);
  if (!list.length) return;
  let i = 0;
  v.src = list[0];
  v.addEventListener('error', () => {
    if (++i < list.length) v.src = list[i];
    else v.remove();
  });
  // the video only covers the still once it actually has frames (no black flash while it buffers)
  v.addEventListener('playing', () => v.classList.add('on'), { once: true });
  el.append(v);
  video = v;
}

/** Show the backdrop (the title and the pre-game pages). The world is covered and draws nothing. */
export function showBackdrop(app: App) {
  if (!el) build(app);
  fading?.kill();
  fading = null;
  el!.style.opacity = '';
  el!.hidden = false;
  if (!shown) {
    shown = true;
    app.root.classList.add('has-backdrop');
    void video?.play().catch(() => undefined);
  }
}

/** Fade the backdrop into the live world (Continue, New Game's arrival, Load). */
export function hideBackdrop(app: App, opts: { instant?: boolean } = {}) {
  if (!el || !shown) return;
  shown = false;
  // tell the world to draw again first, so the frame under the fade is live
  app.root.classList.remove('has-backdrop');
  const done = () => {
    if (shown || !el) return;
    el.hidden = true;
    el.style.opacity = '';
    video?.pause();
  };
  if (opts.instant || reducedMotion()) return done();
  fading = gsap.to(el, { opacity: 0, duration: 1.1, ease: 'power2.inOut', onComplete: done });
}

export const backdropShown = () => shown;
