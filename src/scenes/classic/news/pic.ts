// `set the fileName of cast "Pic" to <path>`: the newspaper article PICTs
// (DATA\PICT\NEWS\NEWS1|NEWS2\<year><n>.PCT) are linked files loaded at run time. We load the
// extracted PNG, apply the sprite's ink to white (matte: white connected to the edge;
// backgroundTransparent: all white) and draw it in the sprite channel.
// Placement: full-screen (640x480) article PICTs are laid out in stage coordinates and are drawn
// at (0,0); smaller crops are centred on the stage (the linked member's registration resets to
// the image centre on import).
import { extUrl } from '../dir/cast.ts';
import type { DirPlayer } from '../dir/player.ts';

const cache = new Map<string, Promise<HTMLCanvasElement | null>>();

export function loadPic(path: string, ink: 'matte' | 'bgTransparent'): Promise<HTMLCanvasElement | null> {
  const key = `${path}|${ink}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const url = await extUrl(path.replace(/\.pct$/i, '') + '.png');
      if (!url) return null;
      const img = new Image();
      img.src = url;
      try {
        await img.decode();
      } catch {
        return null;
      }
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const w = c.width;
      const h = c.height;
      const white = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) white[i] = d.data[i * 4] === 255 && d.data[i * 4 + 1] === 255 && d.data[i * 4 + 2] === 255 ? 1 : 0;
      let clear = white;
      if (ink === 'matte') {
        clear = new Uint8Array(w * h);
        const st: number[] = [];
        const push = (i: number) => {
          if (white[i] && !clear[i]) {
            clear[i] = 1;
            st.push(i);
          }
        };
        for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
        for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
        while (st.length) {
          const i = st.pop()!;
          const x = i % w;
          if (x > 0) push(i - 1);
          if (x < w - 1) push(i + 1);
          if (i >= w) push(i - w);
          if (i < w * (h - 1)) push(i + w);
        }
      }
      for (let i = 0; i < w * h; i++) if (clear[i]) d.data[i * 4 + 3] = 0;
      ctx.putImageData(d, 0, 0);
      return c;
    })();
    cache.set(key, p);
  }
  return p;
}

/** Put a loaded picture into sprite channel `ch` (shown on stage, Director-style placement). */
export function showPic(d: DirPlayer, ch: number, c: HTMLCanvasElement | null) {
  const s = d.sprite(ch);
  d.puppetSprite(ch, true);
  if (!c) {
    d.setVisible(ch, false);
    return;
  }
  s.member = null;
  s.type = 'pic';
  s.video = c;
  s.width = c.width;
  s.height = c.height;
  const full = c.width >= 640 && c.height >= 480;
  d.setLoc(ch, full ? 0 : Math.round((640 - c.width) / 2), full ? 0 : Math.round((480 - c.height) / 2));
  d.setVisible(ch, true);
}

/** NewsDir: `<year><n>` lives in NEWS1 up to 1893, NEWS2 after. */
export function articlePath(year: number, article: number) {
  const pic = `${year}${article}`;
  const dir = year > 1893 ? 'News2' : 'News1';
  return `DATA\\PICT\\News\\${dir}\\${pic}`;
}
