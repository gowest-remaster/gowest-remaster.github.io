// The 4:3 stage: a Pixi canvas plus an HTML overlay of the same rect, scaled to the window
// and letterboxed inside a decorative frame. All scene code works in the original 640x480
// coordinate space (`STAGE_W` x `STAGE_H`); the root container is scaled to the window.
import { Application, Container } from 'pixi.js';

export const STAGE_W = 640;
export const STAGE_H = 480;

export interface Stage {
  app: Application;
  /** Scaled to the window; children use 640x480 coordinates. */
  root: Container;
  /** HTML overlay exactly over the canvas. `--u` = CSS px per stage px. */
  ui: HTMLElement;
  /** Element covering the stage used for fades. */
  fade: HTMLElement;
  /** Current CSS px per stage px. */
  scale(): number;
}

export async function createStage(host: HTMLElement): Promise<Stage> {
  host.innerHTML = '';
  const frame = document.createElement('div');
  frame.className = 'stage-frame';
  const wrap = document.createElement('div');
  wrap.className = 'stage-wrap';
  frame.appendChild(wrap);
  host.appendChild(frame);

  const app = new Application();
  await app.init({
    width: STAGE_W,
    height: STAGE_H,
    background: '#0d0a07',
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    preference: 'webgl',
  });
  app.canvas.className = 'stage-canvas';
  wrap.appendChild(app.canvas);

  const ui = document.createElement('div');
  ui.className = 'ui-root';
  wrap.appendChild(ui);
  const fade = document.createElement('div');
  fade.className = 'stage-fade';
  wrap.appendChild(fade);

  const root = new Container();
  app.stage.addChild(root);

  let s = 1;
  const layout = () => {
    const pad = Math.max(10, Math.min(window.innerWidth, window.innerHeight) * 0.025);
    const availW = window.innerWidth - pad * 2;
    const availH = window.innerHeight - pad * 2;
    s = Math.max(0.5, Math.min(availW / STAGE_W, availH / STAGE_H));
    const w = Math.round(STAGE_W * s);
    const h = Math.round(STAGE_H * s);
    wrap.style.width = `${w}px`;
    wrap.style.height = `${h}px`;
    app.renderer.resize(w, h);
    root.scale.set(w / STAGE_W, h / STAGE_H);
    document.documentElement.style.setProperty('--u', String(w / STAGE_W));
  };
  layout();
  window.addEventListener('resize', layout);
  return { app, root, ui, fade, scale: () => s };
}
