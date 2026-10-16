// The intro as three chapters: the original narration (INTRO1–3) with its slideshow pictures,
// cued at the original score times, a slow Ken Burns drift, and timed subtitles from the
// transcript segments. Skip chapter / skip intro at any time.
import gsap from 'gsap';
import '../styles/flows.css';
import { getContent } from '../../game/text.ts';
import type { App } from '../core/app.ts';
import { rmArt } from '../core/art.ts';
import { audio } from '../core/audio.ts';
import { h } from '../core/dom.ts';
import { registerPanel } from '../core/registry.ts';
import { reducedMotion, rm } from '../core/settings.ts';
import { btn } from '../ui/kit.ts';

/**
 * One picture of the slideshow. `img` is a whole score frame composited from all of its sprites
 * (scripts/prepare_intro_composites.py: `f<frame>`), so nothing the original drew on top of a
 * picture goes missing. `steps` are later score frames of the same picture (an overlay appears,
 * a station zooms in): each is a complete composite, faded in over the last without restarting
 * the camera drift. `driver` animates the stage driver's talking head and waving hand.
 */
interface Slide {
  at: number;
  img: string;
  full?: boolean;
  steps?: { at: number; img: string }[];
  driver?: boolean;
}
interface Chapter {
  voice: string;
  title: string;
  slides: Slide[];
}

const st = (at: number, f: number) => ({ at, img: `f${f}` });
// Cue times (seconds) from the INTRO score (docs/spec/01-framework.md Appendix B).
export const CHAPTERS: Chapter[] = [
  {
    voice: 'INTRO.INTRO1',
    title: 'Chapter I · The Promise of the West',
    slides: [
      { at: 0, img: 'f2' },
      { at: 6.55, img: 'f3' },
      { at: 15.07, img: 'f4' },
      { at: 21.67, img: 'f5', full: true, steps: [st(24.92, 6), st(25.78, 7), st(26.65, 8)] },
      { at: 28.88, img: 'f9' },
      { at: 37.45, img: 'f10', full: true },
      { at: 58.42, img: 'f11' },
      { at: 63.87, img: 'f12' },
      { at: 68.65, img: 'f13', full: true, steps: [st(74.03, 14), st(87.0, 17), st(87.9, 18), st(88.4, 19), st(90.12, 20), st(91.7, 21), st(98.35, 23), st(103.37, 25), st(104.53, 27), st(106.88, 29)] },
      { at: 107.87, img: 'f30' },
      { at: 114.53, img: 'f31', steps: [st(123.9, 32), st(126.62, 33), st(130.05, 34)] },
    ],
  },
  {
    voice: 'INTRO.INTRO2',
    title: 'Chapter II · The Land Office',
    slides: [
      { at: 0, img: 'f38' },
      { at: 6.95, img: 'f39' },
      { at: 11.53, img: 'f40' },
      { at: 13.58, img: 'INTRO07', full: true },
    ],
  },
  {
    voice: 'INTRO.INTRO3',
    title: 'Chapter III · The Road to the Homestead',
    slides: [
      { at: 0, img: 'INTRO07', full: true },
      { at: 8.57, img: 'f51', full: true, driver: true },
    ],
  },
];
// the driver's talking head and hand (score frame 52, channels 3 and 4), in 640×480 stage units
const DRIVER = { talk: { x: 446, y: 52, w: 78, h: 77, frames: 6 }, hand: { x: 362, y: 95, w: 93, h: 90, frames: 6 } };

function voiceLine(id: string) {
  return getContent().voice.lines.find((l) => l.id === id);
}

/** One chapter, filling `host`. Resolves via onDone (finished or skipped). */
export function chapterView(n: number, o: { onDone: () => void; onSkipAll?: () => void; label?: string }) {
  const ch = CHAPTERS[n];
  const vl = voiceLine(ch.voice);
  const segs = vl?.segments?.length ? vl.segments : vl?.text ? [{ start: 0, end: Math.max(8, vl.text.split(/\s+/).length / 2.6), text: vl.text }] : [];
  const total = Math.max(segs[segs.length - 1]?.end ?? 10, ch.slides[ch.slides.length - 1].at + 4) + 0.8;
  const pic = h('div', { class: 'intro-pic' });
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const slideEls = ch.slides.map((s) => {
    const src = rmArt(`intro/${s.img}`);
    const zoom = h('div', { class: 'intro-zoom' }, src ? h('img', { class: `main${s.full ? ' full' : ''}`, src, alt: '' }) : null);
    const steps = (s.steps ?? []).map((v) => {
      const img = h('img', { class: `main step${s.full ? ' full' : ''}`, src: rmArt(`intro/${v.img}`) ?? '', alt: '' });
      zoom.append(img);
      return { v, img };
    });
    // the driver's animated head and hand, over the composite's first frame
    const anim: HTMLImageElement[][] = [];
    if (s.driver)
      for (const part of ['talk', 'hand'] as const) {
        const d = DRIVER[part];
        const frames = Array.from({ length: d.frames }, (_, k) => h('img', { class: 'drv', src: rmArt(`intro/driver-${part}${k}`) ?? '', alt: '', style: { left: pct(d.x, 640), top: pct(d.y, 480), width: pct(d.w, 640), height: pct(d.h, 480), opacity: k === 0 ? '1' : '0' } }) as HTMLImageElement);
        zoom.append(...frames);
        anim.push(frames);
      }
    const el = h('div', { class: 'intro-slide' }, zoom);
    pic.append(el);
    return { s, el, zoom, steps, anim };
  });
  const cap = h('p', { 'aria-live': 'polite' });
  const bar = h('i');
  const skipCh = btn(n < CHAPTERS.length - 1 ? 'Skip chapter' : 'Skip', { kind: 'ghost', small: true, kbd: 'Space', onClick: () => finish() });
  const skipAll = o.onSkipAll ? btn('Skip the story', { kind: 'ghost', small: true, onClick: () => (stop(), o.onSkipAll!()) }) : null;
  const el = h(
    'div',
    { class: 'fs intro' },
    h('div', { class: 'intro-top' }, h('div', { class: 'intro-chapter' }, o.label ?? 'The Story', h('b', null, ch.title)), h('div', { class: 'intro-btns' }, skipCh, skipAll)),
    h('div', { class: 'intro-stage' }, h('div', { class: 'intro-frame' }, pic)),
    h('div', { class: 'intro-cap' }, rm().captions ? cap : null),
    h('div', { class: 'intro-progress' }, bar),
  );

  let raf = 0;
  let t0 = 0;
  let cur = -1;
  let curSeg = -1;
  let done = false;
  const shown = new Set<HTMLElement>();
  const rmo = reducedMotion();

  function show(i: number) {
    if (i === cur) return;
    const prev = slideEls[cur];
    cur = i;
    const next = slideEls[i];
    if (rmo) {
      if (prev) prev.el.style.opacity = '0';
      next.el.style.opacity = '1';
      return;
    }
    if (prev) gsap.to(prev.el, { opacity: 0, duration: 1.1 });
    gsap.fromTo(next.el, { opacity: 0 }, { opacity: 1, duration: 1.1 });
    const dur = (ch.slides[i + 1]?.at ?? total) - ch.slides[i].at + 1.2;
    // drift the whole picture (base, later steps and the driver together)
    gsap.fromTo(next.zoom, { scale: 1.04, xPercent: i % 2 ? -1.2 : 1.2 }, { scale: next.s.driver ? 1.06 : 1.12, xPercent: i % 2 ? 1.2 : -1.2, duration: dur, ease: 'none' });
  }

  function tick() {
    const t = (performance.now() - t0) / 1000;
    let i = 0;
    while (i + 1 < ch.slides.length && ch.slides[i + 1].at <= t) i++;
    show(i);
    for (const { v, img } of slideEls[i].steps) {
      if (t >= v.at && !shown.has(img)) {
        shown.add(img);
        if (rmo) img.style.opacity = '1';
        else gsap.to(img, { opacity: 1, duration: 0.5 });
      }
    }
    // the driver talks while the narration plays (about 8 frames a second, as the score's loop did)
    const sl = slideEls[i];
    if (sl.anim.length) {
      const talking = t < total - 1.2;
      const k = Math.floor(t * 8);
      sl.anim.forEach((frames, part) => {
        const n = frames.length;
        const want = part === 0 ? (talking ? k % n : 0) : Math.floor(k / 2) % n;
        frames.forEach((f, j) => (f.style.opacity = j === want ? '1' : '0'));
      });
    }
    let si = -1;
    for (let k = 0; k < segs.length; k++) if (t >= segs[k].start - 0.1) si = k;
    if (si !== curSeg && si >= 0) {
      curSeg = si;
      cap.textContent = segs[si].text.trim();
      if (!rmo) gsap.fromTo(cap, { opacity: 0 }, { opacity: 1, duration: 0.35 });
    }
    bar.style.width = `${Math.min(100, (t / total) * 100)}%`;
    if (t >= total) return finish();
    raf = requestAnimationFrame(tick);
  }

  function stop() {
    done = true;
    cancelAnimationFrame(raf);
    audio.stopVoice();
    window.removeEventListener('keydown', onKey, true);
  }
  function finish() {
    if (done) return;
    stop();
    o.onDone();
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      finish();
    }
  };

  return {
    el,
    start() {
      t0 = performance.now();
      window.addEventListener('keydown', onKey, true);
      void audio.playVoice(ch.voice, { speaker: 'Narrator', text: null });
      raf = requestAnimationFrame(tick);
    },
    destroy: stop,
  };
}

/** Replay the whole intro (from the Studio, menu or Help). */
export function register(app: App) {
  registerPanel({
    id: 'intro',
    title: 'The Story',
    kind: 'screen',
    mount: ({ params }) => {
      const host = h('div', { class: 'fs' });
      let n = Number(params.chapter ?? 0);
      let cv: ReturnType<typeof chapterView> | null = null;
      const back = () => {
        if (session_back) session_back();
      };
      const session_back = params.back === 'title' || !params.back ? () => void app.go('title') : () => app.closeScreen();
      const play = () => {
        cv?.destroy();
        if (n >= CHAPTERS.length) return back();
        cv = chapterView(n, { onDone: () => ((n += 1), play()), onSkipAll: back });
        host.replaceChildren(cv.el);
        cv.start();
      };
      play();
      return { el: host, destroy: () => cv?.destroy() };
    },
  });
}
