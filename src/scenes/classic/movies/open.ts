// OPEN.DIR (the opening video over POSTER3) and PLAY.DIR (bookmark check: a saved game with a
// goal continues, a fresh player goes to INTRO). Ports OPEN MovieScript 1 and ScoreScripts
// 5-13, PLAY ScoreScript 1. Spec: docs/spec/01-framework.md §1.2-1.3.
import type { ClassicContext, MovieFactory, MovieName } from '../context.ts';
import { game } from '../../../engine/game.ts';
import { saves } from '../../../engine/save.ts';
import { openVideo, startVideo } from '../front/util.ts';

/** PLAY: continue a saved game at its location, else start the introduction. */
export async function playMovie(c: ClassicContext) {
  if (c.g.x.afterEog === 'intro') {
    // CALEND end-of-game menu "start a new game"
    c.g.x.afterEog = undefined;
    game.state = null;
    c.g.runningMode = 'newGame';
    await c.goMovie('INTRO');
    return;
  }
  const p = game.profile;
  const rec = p ? await saves.load(p.id) : undefined;
  if (rec && rec.state.begin.goal > 0 && !rec.state.extra.ended && (await game.resume())) {
    game.setLook('classic');
    const s = game.state!;
    const where: Record<string, [MovieName, string | undefined]> = {
      field: ['FIELD', undefined],
      town: ['TSTREET1', s.date.year < 1890 ? 'S1' : 'S2'],
      house: [s.globals.whatHouse >= 3 ? 'HOUSE3' : s.globals.whatHouse === 2 ? 'HOUSE2' : 'HOUSE1', undefined],
    };
    const [m, f] = where[game.scene] ?? ['CALEND', 'Start'];
    await c.goMovie(m, f);
    return;
  }
  game.state = null;
  c.g.runningMode = 'newGame';
  await c.goMovie('INTRO');
}

const factory: MovieFactory = (c) => {
  const d = c.d;
  let video: HTMLVideoElement | null = null;
  let started = false;
  let leaving = false;
  let canPlay = true;

  let closed = false;
  const closeOpening = () => {
    closed = true;
    d.cursor(4);
    video?.pause();
    d.sprite(2).video = null;
    d.go('end');
  };

  return {
    async startMovie() {
      d.cursor(4);
      video = await openVideo('DATA\\QT\\OPEN\\OPEN.mp4');
      if (video) video.loop = false;
      d.cursor(0);
    },
    stopMovie() {
      video?.pause();
    },
    scripts: {
      // 5: start the video
      5: { exitFrame: () => d.cursor(0) },
      // 6: while the video is running (click, Space or Esc skips)
      6: {
        async exitFrame() {
          if (!started) {
            started = true;
            canPlay = !!video && (await startVideo(video));
            if (closed) return video?.pause();
            if (canPlay) d.sprite(2).video = video;
          }
          if (closed) return;
          if (canPlay && video && !video.ended && !video.error) d.go(d.frame);
          else closeOpening();
        },
        mouseUp: () => closeOpening(),
        keyDown(k: string) {
          if (k === ' ' || k === 'Escape') closeOpening();
          return false;
        },
      },
      10: { exitFrame() {} },
      11: { exitFrame() {} },
      13: { exitFrame: () => d.go(d.frame) },
      // 7: leave the opening movie -> PLAY
      7: {
        exitFrame() {
          if (leaving) return;
          leaving = true;
          d.stop();
          void playMovie(c);
        },
      },
    },
  };
};

export default factory;
