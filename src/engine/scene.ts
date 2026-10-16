// Scene manager with smooth fades for the Classic app. A scene owns a Pixi container (drawn in
// 640x480 stage units) and an HTML layer in the overlay; the only scene type is the Classic
// replica (scenes/classic/scene.ts), which enters the 1996 movie matching the scene id.
import { Container, Ticker } from 'pixi.js';
import gsap from 'gsap';
import type { Stage } from './stage.ts';
import { pushKeys } from './input.ts';

export type SceneId = 'title' | 'board' | 'field' | 'town' | 'house';

export interface Scene {
  readonly id: SceneId;
  readonly root: Container;
  readonly layer: HTMLElement;
  /** Called after the scene is attached; may load assets. */
  enter(): Promise<void> | void;
  exit(): void;
  update?(dt: number): void;
  /** Escape key when no dialog is open. */
  back?(): void;
}

export abstract class BaseScene implements Scene {
  abstract readonly id: SceneId;
  readonly root = new Container();
  readonly layer: HTMLElement;
  constructor() {
    this.layer = document.createElement('div');
    this.layer.className = 'scene-layer';
  }
  abstract enter(): Promise<void> | void;
  exit() {
    // stop tweens on display objects before they are destroyed
    const kill = (c: Container) => {
      gsap.killTweensOf(c);
      gsap.killTweensOf(c.position);
      gsap.killTweensOf(c.scale);
      for (const ch of c.children) kill(ch as Container);
    };
    kill(this.root);
    this.root.destroy({ children: true });
    this.layer.remove();
  }
}

export type SceneFactory = (id: SceneId) => Scene;

export class SceneManager {
  current: Scene | null = null;
  private busy = false;
  private popKeys: (() => void) | null = null;

  private stage: Stage;
  private factory: SceneFactory;

  constructor(stage: Stage, factory: SceneFactory) {
    this.stage = stage;
    this.factory = factory;
    Ticker.shared.add((t) => this.current?.update?.(t.deltaMS / 1000));
  }

  private queued: SceneId | null = null;

  async go(id: SceneId, opts: { instant?: boolean } = {}): Promise<void> {
    if (this.busy) {
      this.queued = id;
      return;
    }
    this.busy = true;
    const fade = this.stage.fade;
    try {
      if (this.current && !opts.instant) await gsap.to(fade, { opacity: 1, duration: 0.28, ease: 'power1.in' });
      else fade.style.opacity = '1';
      const prev = this.current;
      this.popKeys?.();
      if (prev) prev.exit();
      const next = this.factory(id);
      this.current = next;
      this.stage.root.addChild(next.root);
      this.stage.ui.appendChild(next.layer);
      await next.enter();
      this.popKeys = pushKeys({ escape: () => (next.back ? (next.back(), true) : false) });
      await gsap.to(fade, { opacity: 0, duration: opts.instant ? 0.6 : 0.4, ease: 'power1.out' });
    } finally {
      this.busy = false;
    }
    if (this.queued) {
      const q = this.queued;
      this.queued = null;
      if (q !== this.current?.id) await this.go(q);
    }
  }
}
