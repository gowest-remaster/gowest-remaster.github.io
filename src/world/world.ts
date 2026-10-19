// World3D implementation: every gameplay view is a pre-rendered 2.5D plate (docs/world/sets.md "Plates") with a
// thin live layer composited on top (people, animals, weather, the windmill head, smoke, fire, ghosts, FX). Moving
// between places is a cross-dissolve between two fixed cameras; interiors are plated rooms with live pick props.
import * as THREE from 'three/webgpu';
import type { DisasterKind, PickTarget, Place, Quality, World3D, WorldView } from './api';
import { uWorkFront, uTime, uWind, uWindDir, uSunDir, uSunColor, uCloudOffset, uLightning, fieldData, STAGES, CROPS } from './engine/tsl';
import { pending, setMaxAnisotropy } from './engine/tex';
import { Environment } from './engine/environment';
import { Post } from './engine/post';
import { Weather } from './env/weather';
import { errText, PlateView } from './plates/plates';
import { LOW_MEMORY, memStats } from '../lowmem';
import { crumb, crashError, setMemProvider } from '../crashlog';
import { texture as tslTexture, uv as tslUV, vec4 as tslVec4 } from 'three/tsl';
import { FieldCrew } from './places/fieldCrew';
import { SquareMarks } from './places/squareMarks';
import { BARN, FIELD, HOME, MAILBOX, MAX_SQUARES, STREET, WINDMILL, squareCenter, terrainHeight } from './env/layout';
import { LifeLivestock, LifeFamily, LifeTownCrowd, updateLifeKit, type LiveJob } from './places/life';
import { initGltf, getSharedDraco } from './engine/gltf';
import { TownExtras } from './places/town';
import { Disasters, type DisasterHost } from './fx/disasters';
import { makeGhost, massingGhost, uGhostHover } from './fx/ghosts';
import { KitHomestead } from './places/homesteadKit';
import { CameraRig, outdoorShot } from './camera';
import type { InteriorSet } from './interiors/base';

const QUALITY: Record<Quality, { pr: (dpr: number) => number; ao: boolean; ssr: boolean; bloom: boolean; shadow: number; stagger: number }> = {
  // Over pre-rendered plates only the live figures are rendered, so the tiers differ in what still shows: pixel
  // ratio (actor sharpness) and shadow resolution. Bloom, GTAO and SSR were compared on the plated views and add
  // nothing visible (the plate carries its own glow and occlusion), so they are off at every level; 'ultra' is
  // kept for the API and equals 'high'. Every level shares the same scene-pass layout (MSAA): no recompiles.
  low: { pr: (d) => Math.min(d, 1), ao: false, ssr: false, bloom: false, shadow: 1024, stagger: 2 },
  med: { pr: (d) => Math.min(d, 1.5), ao: false, ssr: false, bloom: false, shadow: 2048, stagger: 1 },
  high: { pr: (d) => Math.min(d, 2), ao: false, ssr: false, bloom: false, shadow: 2048, stagger: 1 },
  ultra: { pr: (d) => Math.min(d, 2), ao: false, ssr: false, bloom: false, shadow: 2048, stagger: 1 },
};
const QORDER: Quality[] = ['low', 'med', 'high', 'ultra'];
/** plates are lifted over their graded exposure so late-day keys read warm and clear (user: 'very dark') */
const PLATE_EXPOSURE_LIFT = 1.55;
/** lift for one baked key: low-sun keys (5-10 deg) need the full lift, higher-sun keys less (Cycles prairie with
 *  real grass self-shadowing reads darker than the live terrain at the same exposure) */
const plateLift = (k?: { sunDir?: number[]; sunIntensity?: number }): number =>
  // sunless keys (overcast, snow) are graded bright already: lifted like the sunny ones, skies and snow blew out
  k?.sunIntensity === 0 ? 1.08 : k?.sunDir ? THREE.MathUtils.lerp(PLATE_EXPOSURE_LIFT, 1.3, THREE.MathUtils.smoothstep(k.sunDir[1], 0.12, 0.4)) : PLATE_EXPOSURE_LIFT;
const INTERIORS: Place[] = ['house', 'store', 'bank'];
/** places that show the homestead's live layer / the town crowd */
const HOME_SIDE: Place[] = ['title', 'homestead', 'pen', 'field'];
const TOWN_SIDE: Place[] = ['mainStreet', 'elevator'];

/** outdoor plate views kept loaded at once in the low-memory profile: only the current one */
const LOW_MEMORY_VIEWS = 1;
/** lighting audit (2026-10-17): rooms that read too dark at their baked exposure, per key */
const INTERIOR_LIFT: Record<string, Record<string, number>> = {
  house_sodFurnished: { evening: 1.12 },
  house_frame: { day: 1.15, evening: 1.4 },
  bank: { day: 1.05, evening: 1.4 },
};

export const DEFAULT_VIEW: WorldView = {
  year: 1880,
  month: 4,
  hour: 9.5,
  season: 'spring',
  weather: 'clear',
  wind: 0.45,
  snowCover: 0,
  field: Array.from({ length: 8 }, () => ({ stage: 'prairie' as const, crop: null, growth: 0 })),
  house: 'wagon',
  barn: false,
  windmill: false,
  fence: 0,
  stove: false,
  animals: { cows: 0, horses: 2, pigs: 0, chickens: 0 },
  family: 3,
  townGrowth: 0,
  ownedBusinesses: [false, false, false, false],
  extras: [],
};

interface Pickable {
  target: PickTarget;
  objects: THREE.Object3D[];
  anchor: () => THREE.Vector3;
  places: Place[];
}


const key = (t: PickTarget): string =>
  t.kind === 'place' ? `place:${t.place}` : t.kind === 'square' ? `square:${t.index}` : t.kind === 'build' ? `build:${t.item}` : t.kind === 'prop' ? `prop:${t.id}` : 'mailbox';

export class WorldImpl implements World3D {
  private host!: HTMLElement;
  private canvas!: HTMLCanvasElement;
  /** internal (not part of World3D): exposed for lookdev and kit dev tooling */
  renderer!: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.3, 9000);
  rig!: CameraRig;
  private post: Post | null = null;
  private interiorPost = new Map<Place, Post>();
  private env!: Environment;
  private weather = new Weather();
  private livestock = new LifeLivestock();
  private townCrowd = new LifeTownCrowd();
  private family = new LifeFamily();
  private town: TownExtras | null = null;
  private crew = new FieldCrew();
  /** 2.5D plate for the current view (docs/world/sets.md "Plates") */
  private plate: PlateView | null = null;
  private plates = new Map<string, Promise<PlateView | null>>();
  private marks = new SquareMarks();
  private disasters!: Disasters;
  private parts!: KitHomestead['parts'];
  private home!: KitHomestead;
  private interiors = new Map<string, InteriorSet>();
  private pickables: Pickable[] = [];
  private ghosts = new Map<string, THREE.Object3D>();
  private outlineSel: THREE.Object3D[] = [];
  private interactive: 'all' | 'none' | Set<string> = 'all';
  private selected = new Set<number>();
  private hoverKey: string | null = null;
  private hoverSquare = -1;
  private pickFns: ((t: PickTarget) => void)[] = [];
  private hoverFns: ((t: PickTarget | null) => void)[] = [];
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDirty = false;
  private fade!: HTMLDivElement;
  private hud: HTMLDivElement | null = null;

  private view: WorldView = structuredClone(DEFAULT_VIEW);
  private envOv: Partial<{ weather: WorldView['weather']; drought: number; snow: number; wind: number; hour: number; darken: number }> | null = null;
  private squareStage = new Float32Array(MAX_SQUARES);
  private squareOverride = new Map<number, number>();
  private snap = true;
  private place: Place = 'title';
  private quality_: Quality = 'med';
  private qualityCap: Quality = 'high';
  private auto = true;
  private paused = false;
  private disposed = false;
  private timer = new THREE.Timer();
  private simTime = 0;
  private frameTimes: number[] = [];
  private fps_ = 60;
  private lightningT = 8;
  private backend = 'WebGPU';
  private monthPass: { from: WorldView; to: WorldView; t: number; dur: number; resolve: () => void } | null = null;
  private fieldWork: { kind: 'plow' | 'plant' | 'harvest'; squares: number[]; t: number; dur: number; resolve: () => void; done: number } | null = null;
  exposure = 0.62;
  debug = { forceWebGL: false };

  get quality(): Quality {
    return this.quality_;
  }
  get fps(): number {
    return this.fps_;
  }
  get backendName(): string {
    return this.backend;
  }
  get currentPlace(): Place {
    return this.place;
  }
  debugInfo(): { backend: string; place: Place; quality: Quality; fps: number } {
    return { backend: this.backend, place: this.place, quality: this.quality_, fps: this.fps_ };
  }

  /** Re-pack split plate images into one RGBA texture on the GPU (see PlateView.packer). The images carry no alpha
   *  (iOS Safari premultiplies alpha on decode), so the multiplier / layer alpha arrive in a second image and are
   *  combined here; exact 8-bit copies (nearest sampling, no colour management, no tone mapping). */
  private packedRT = new Map<THREE.Texture, THREE.RenderTarget>();
  private packTexture(a: THREE.Texture, aux: THREE.Texture | null, mode: 'rgbm' | 'data' | 'copy'): THREE.Texture {
    const img = (a.image ?? (a as THREE.Texture & { source: { data: { width: number; height: number } } }).source.data) as { width: number; height: number };
    const rtSrc = this.packedRT.get(a);
    const w = rtSrc ? rtSrc.width : img.width;
    const h = rtSrc ? rtSrc.height : img.height;
    const rt = new THREE.RenderTarget(w, h, { depthBuffer: false, type: THREE.UnsignedByteType, generateMipmaps: false });
    const t = rt.texture;
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = t.magFilter = mode === 'data' ? THREE.NearestFilter : THREE.LinearFilter;
    if (rtSrc) t.minFilter = t.magFilter = a.magFilter;
    const ta = tslTexture(a, tslUV());
    const tb = aux ? tslTexture(aux, tslUV()) : null;
    const m = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false, blending: THREE.NoBlending });
    m.toneMapped = false;
    // outputNode: the raw RGBA as written (a colorNode's alpha is replaced by the material's opacity)
    m.outputNode = (mode === 'rgbm' ? tslVec4(ta.rgb, tb!.r) : mode === 'data' ? tslVec4(ta.rgb, tb!.g) : ta) as never;
    const quad = new THREE.QuadMesh(m);
    const r = this.renderer as unknown as { getRenderTarget(): THREE.RenderTarget | null; setRenderTarget(t: THREE.RenderTarget | null): void; getMRT(): unknown; setMRT(m: unknown): void };
    const prevRT = r.getRenderTarget();
    const prevMRT = r.getMRT();
    r.setMRT(null);
    r.setRenderTarget(rt);
    quad.render(this.renderer);
    r.setRenderTarget(prevRT);
    r.setMRT(prevMRT);
    m.dispose();
    this.packedRT.set(t, rt);
    return t;
  }

  /** remember to start in the low-memory profile next time (touch devices) */
  private lowMemoryNextTime(): void {
    try {
      if (matchMedia('(pointer: coarse)').matches) localStorage.setItem('gw-lowmem', '1');
    } catch {
      /* storage blocked */
    }
  }

  /** The renderer can't continue: a message on the boot splash if it is still up, else over the world. */
  private fatal(text: string): void {
    console.error('[world]', text);
    this.lowMemoryNextTime();
    const splash = (window as unknown as { __gwFatal?: (t: string) => void }).__gwFatal;
    if (splash && document.getElementById('gw-boot')) return splash(text);
    if (!this.host || this.host.querySelector('.world-fatal')) return;
    const d = document.createElement('div');
    d.className = 'world-fatal';
    d.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;background:rgba(28,20,12,.86);color:#f4ead6;font:16px/1.5 Georgia,serif;text-align:center;padding:24px;z-index:50';
    d.innerHTML = `<div><p style="margin:0 0 12px">${text}<br>The game is saved; reloading continues where you left off.</p><button style="font:inherit;padding:10px 18px;min-height:44px">Reload</button></div>`;
    d.querySelector('button')!.addEventListener('click', () => location.reload());
    this.host.appendChild(d);
  }

  // ------------------------------------------------------------------ mount / scene build
  async mount(host: HTMLElement): Promise<void> {
    this.host = host;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none';
    host.appendChild(this.canvas);
    this.fade = document.createElement('div');
    this.fade.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .35s ease';
    host.appendChild(this.fade);
    if (new URLSearchParams(location.search).get('platetest') === '1') {
      void import('./plates/selftest').then(async (m) => {
        const lines = await m.plateDecodeSelfTest().catch((e) => [`self-test failed: ${e}`]);
        // the shipping path: split images -> GPU re-pack (needs the renderer: wait for it)
        while (!this.renderer) await new Promise((res) => setTimeout(res, 100));
        try {
          const base = `${import.meta.env.BASE_URL}world/plates/_selftest/split`;
          const r = await PlateView.loadSplit(`${base}.c.webp`, `${base}.ma.webp`);
          const rt = this.packedRT.get(r.rgbm)!;
          const px = await (this.renderer as unknown as { readRenderTargetPixelsAsync(rt: THREE.RenderTarget, x: number, y: number, w: number, h: number): Promise<Uint8Array> }).readRenderTargetPixelsAsync(rt, 0, 0, 4, 1);
          const want = [200, 100, 50, 255, 200, 100, 50, 128, 200, 100, 50, 32, 10, 20, 30, 1];
          const ok = want.every((v, i) => Math.abs(v - px[i]) <= 1);
          lines.push(`split + GPU re-pack (shipping path): ${ok ? 'ok' : 'WRONG'} [${Array.from(px).join(',')}]`);
        } catch (e) {
          lines.push(`split re-pack failed: ${e}`);
        }
        console.log('[platetest]', lines.join('\n'));
        const d = document.createElement('pre');
        d.id = 'platetest';
        d.style.cssText = 'position:fixed;left:8px;top:8px;z-index:100001;background:#000c;color:#fff;font:12px/1.4 monospace;padding:8px;white-space:pre-wrap;max-width:90vw';
        d.textContent = 'plate decode self-test\n' + lines.join('\n');
        document.body.appendChild(d);
      });
    }
    const r = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', forceWebGL: this.debug.forceWebGL });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    await r.init();
    this.renderer = r;
    // plates stream their remaining lighting keys only while nothing is happening (no transition, input, flight)
    PlateView.whenQuiet = () =>
      new Promise<void>((res) => {
        const check = () => {
          const quiet = !this.loading && !this.dissolving && !this.monthPass && performance.now() - this.lastInput > 1500 && !document.hidden;
          if (quiet) res();
          else setTimeout(check, 400);
        };
        setTimeout(check, 600);
      });
    // a lost GPU device (out of memory, a driver reset) leaves a frozen canvas: say so and offer a way on
    r.onDeviceLost = (info: { message?: string; reason?: string | null }) => {
      crashError('gpu-lost', `${info.reason ?? ''} ${info.message ?? ''}`);
      this.fatal(`The graphics device stopped (${info.reason ?? info.message ?? 'unknown'}).`);
    };
    setMemProvider(() => this.memLine());
    const rr = r as unknown as { onError: (e: { type?: string; message?: string }) => void };
    const onErr = rr.onError.bind(r);
    rr.onError = (e) => {
      if (e?.type === 'GPUOutOfMemoryError') this.lowMemoryNextTime();
      crashError(`gpu ${e?.type ?? 'error'}`, e?.message ?? '');
      onErr(e);
    };
    PlateView.onWarn = (m) => crashError('plate', m);
    PlateView.initTexture = (t) => r.initTexture(t);
    PlateView.packer = (a, aux, mode) => this.packTexture(a, aux, mode);
    PlateView.freeTexture = (t) => {
      const rt = this.packedRT.get(t);
      if (rt) {
        this.packedRT.delete(t);
        rt.dispose();
      } else t.dispose();
    };
    PlateView.releaseAfterUpload = !(r.backend as unknown as { isWebGLBackend?: boolean }).isWebGLBackend;
    if (LOW_MEMORY) {
      PlateView.lowRes = true;
      PlateView.streamAll = false;
      // DPR 1 and 1024 shadows: at a phone's DPR 3 every full-screen target (MSAA colour + normals + resolves)
      // is 9x the pixels for little visible gain over half-resolution plates
      this.qualityCap = 'low';
      this.quality_ = 'low';
    }
    if (new URLSearchParams(location.search).get('memdebug') === '1') this.memDebug();
    this.scene.matrixWorldAutoUpdate = false; // updated once per frame in frame()
    r.info.autoReset = false; // per-frame totals across all passes (reset in frame())
    this.backend = (r.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    if (this.backend === 'WebGL2') {
      // WebGL2 fallback (no WebGPU, e.g. Brave defaults): GLSL programs link slowly and draw calls cost more, so
      // start at 'low' and let the governor climb at most to 'med'
      this.webglCap = true;
      this.quality_ = 'low';
      this.qualityCap = QORDER[Math.min(QORDER.indexOf(this.qualityCap), QORDER.indexOf('med'))];
    }
    setMaxAnisotropy(8);
    initGltf(r);
    this.buildOutdoor();
    this.applyQuality();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
    this.canvas.addEventListener('pointermove', (e) => this.onPointer(e));
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown']) window.addEventListener(ev, () => (this.lastInput = performance.now()), { passive: true });
    this.canvas.addEventListener('pointerleave', () => {
      this.pointer.set(9, 9);
      this.pointerDirty = true;
    });
    this.canvas.addEventListener('pointerdown', (e) => (this.lastPointerType = e.pointerType));
    this.canvas.addEventListener('click', (e) => this.onClick(e));
    // the game surface handles its own taps: no browser pan / pinch-zoom / double-tap zoom on it
    this.canvas.style.touchAction = 'none';
    await this.env.ready();
    this.rig = new CameraRig(this.camera, outdoorShot('title', 8)!);
    this.applyView(true);
    // boot behind a hidden canvas: the title's plate and the live layer stream in and compile their shaders (in
    // idle-sliced chunks) before anything is shown, so the title never stutters once it is up
    const pv = await this.plateFor('title');
    this.setPlate(pv);
    this.rig.set(this.shotFor('title'));
    this.canvas.style.opacity = '0';
    this.renderer.setAnimationLoop(() => this.frame());
    await Promise.race([this.home.ready, new Promise((r) => setTimeout(r, 3500))]);
    // then until nothing new has streamed in for ~0.75 s (animals, people): no pop-in after the reveal
    await this.waitStable(3000);
    if (pv) await this.compilePlate(pv);
    if (this.post) {
      this.scene.updateMatrixWorld();
      await Promise.race([this.compileWith(this.post, this.scene, this.camera), new Promise((r) => setTimeout(r, 1500))]);
    }
    this.canvas.style.transition = 'opacity .6s ease';
    this.canvas.style.opacity = '1';
    await Promise.all(pending);
  }

  private buildOutdoor(): void {
    const scene = this.scene;
    // one cascade over the playable area of the fixed gameplay cameras, every frame: no cascade seams, no
    // alternating far-cascade refresh (it read as shadows popping)
    this.env = new Environment(this.renderer, scene, { cascades: 1, shadowFar: 160 });
    this.env.onEnvChange = (tex) => {
      for (const i of this.interiors.values()) i.setEnvironment(tex);
    };
    // homestead live layer (windmill head, smoke, fire, flag, field fence) + invisible pick proxies
    this.home = new KitHomestead();
    scene.add(this.home.group, this.home.fireLight);
    this.parts = this.home.parts;
    void this.home.ready.then(() => {
      this.refreshGhosts();
      this.applySetVisibility(); // the windmill streamed in after the plate decided what it covers
      this.prefetchAround(this.place);
    });
    scene.add(this.livestock.group, this.family.group);
    this.town = new TownExtras();
    scene.add(this.town.group);
    scene.add(this.townCrowd.group);
    scene.add(this.crew.group, this.marks.group);
    void this.home.ready.then(() => this.crew.preload());
    scene.add(this.weather.group);
    const host: DisasterHost = {
      envOverride: (o) => (this.envOv = o),
      squares: () => this.view.field.length,
      setSquareStage: (i, st) => this.squareOverride.set(i, st),
    };
    this.disasters = new Disasters(host);
    scene.add(this.disasters.group);
    // ghosts (blueprints) for buildables
    const hg = massingGhost(7.0, 5.4, 2.25, 3.25);
    hg.position.set(HOME.x, terrainHeight(HOME.x, HOME.z), HOME.z);
    hg.rotation.y = 0.26;
    this.ghosts.set('build:house', hg);
    const bg = massingGhost(12, 8, 3.4, 6.3, 0.45);
    bg.position.set(BARN.x, terrainHeight(BARN.x, BARN.z) - 0.1, BARN.z);
    bg.rotation.y = -0.17;
    this.ghosts.set('build:barn', bg);
    // windmill/fence ghosts are drawn from the kit models once loaded (refreshGhosts); placeholders until then
    this.ghosts.set('build:windmill', new THREE.Group());
    this.ghosts.set('build:woodFence', new THREE.Group());
    for (const g of this.ghosts.values()) {
      g.visible = false;
      scene.add(g);
    }
    this.buildPickables();
  }

  private buildPickables(): void {
    const at = (x: number, z: number, dy: number) => () => new THREE.Vector3(x, terrainHeight(x, z) + dy, z);
    const P = (target: PickTarget, objects: THREE.Object3D[], anchor: () => THREE.Vector3, places: Place[]) => this.pickables.push({ target, objects, anchor, places });
    const hub: Place[] = ['homestead', 'title'];
    P({ kind: 'place', place: 'house' }, [this.parts.sod, this.parts.frame, this.parts.wagon], at(HOME.x, HOME.z, 4.2), hub);
    P({ kind: 'place', place: 'pen' }, [this.parts.barn, this.parts.pen], at(BARN.x, BARN.z, 7.5), hub);
    P({ kind: 'mailbox' }, [this.parts.mailbox], at(MAILBOX.x, MAILBOX.z, 1.7), hub);
    P({ kind: 'place', place: 'field' }, [], () => new THREE.Vector3(FIELD.x0 + 40, terrainHeight(FIELD.x0 + 40, FIELD.z0 - 60) + 3, FIELD.z0 - 60), hub);
    P({ kind: 'place', place: 'mainStreet' }, [], () => new THREE.Vector3(-760, 25, -1330), hub);
    for (const item of ['house', 'barn', 'windmill', 'woodFence'] as const) {
      const g = this.ghosts.get(`build:${item}`)!;
      const anchor = item === 'house' ? at(HOME.x, HOME.z, 4.2) : item === 'barn' ? at(BARN.x, BARN.z, 7.5) : item === 'windmill' ? at(WINDMILL.x, WINDMILL.z, 11) : at(BARN.x, BARN.z + 14, 2);
      P({ kind: 'build', item }, [g], anchor, ['homestead', 'pen', 'title']);
    }
    P({ kind: 'build', item: 'barbedFence' }, [], () => new THREE.Vector3(FIELD.x0 - 3, terrainHeight(FIELD.x0, FIELD.z0) + 1.5, FIELD.z0 + 3), ['homestead', 'field']);
    for (let i = 0; i < MAX_SQUARES; i++) {
      const c = squareCenter(i);
      P({ kind: 'square', index: i }, [], () => new THREE.Vector3(c.x, terrainHeight(c.x, c.z) + 1, c.z), ['field', 'homestead']);
    }
    const town = this.town!;
    for (const [id, place] of [['store', 'store'], ['bank', 'bank'], ['elevator', 'elevator']] as const) {
      P({ kind: 'place', place }, [], () => town.anchors[id].clone(), ['mainStreet', 'elevator']);
    }
    for (let b = 0; b < 4; b++) P({ kind: 'prop', id: `business:${b}` }, [], () => town.anchors[`business:${b}`].clone(), ['mainStreet']);
    P({ kind: 'prop', id: 'freightOffice' }, [], () => town.anchors.freightOffice.clone(), ['mainStreet', 'elevator']);
  }

  /** rebuild the windmill / pen blueprint ghosts from the loaded kit models, keeping visibility + picking */
  private refreshGhosts(): void {
    const swap = (key: string, src: THREE.Object3D | undefined) => {
      if (!src) return;
      const old = this.ghosts.get(key)!;
      const g = makeGhost(src);
      src.updateWorldMatrix(true, false);
      g.position.setFromMatrixPosition(src.matrixWorld);
      g.quaternion.setFromRotationMatrix(src.matrixWorld);
      g.visible = old.visible;
      this.scene.remove(old);
      this.scene.add(g);
      this.ghosts.set(key, g);
      for (const p of this.pickables) p.objects = p.objects.map((o) => (o === old ? g : o));
    };
    swap('build:windmill', this.home.loaded.windmill);
    swap('build:woodFence', this.home.loaded.pen);
  }

  // ------------------------------------------------------------------ quality
  /** With the governor on (default) this is the cap: the world starts at 'med' (or the cap, if lower) and climbs
   *  (to 'high' at most) on frame-time headroom, see governor(). With setAutoQuality(false) it applies the level. */
  setQuality(q: Quality): void {
    if (this.webglCap && QORDER.indexOf(q) > QORDER.indexOf('med')) q = 'med';
    this.qualityCap = q;
    const next = this.auto ? QORDER[Math.min(QORDER.indexOf(this.quality_), QORDER.indexOf(q))] : q;
    if (next !== this.quality_) {
      this.quality_ = next;
      this.applyQuality();
    }
  }
  /** Contract addition: enable/disable the auto-quality governor (on by default; it never exceeds setQuality's level). */
  setAutoQuality(on: boolean): void {
    this.auto = on;
  }

  /** post pipelines are built once per quality and kept: switching quality (the governor, the UI's own ladder,
   *  weather turning wet) then costs no shader compiles and never stalls a frame */
  private postCache = new Map<string, Post>();
  private applyQuality(): void {
    if (!this.env) return; // setQuality before init: init applies it
    const q = QUALITY[this.quality_];
    const sm = LOW_MEMORY ? Math.min(q.shadow, 1024) : q.shadow;
    this.env.sun.shadow.mapSize.set(sm, sm);
    this.buildPost();
    this.resize();
  }

  private postWet = false;
  private buildPost(): void {
    const q = QUALITY[this.quality_];
    const wk = this.envOv?.weather ?? this.view.weather;
    this.postWet = wk === 'rain' || wk === 'storm';
    if (this.env) this.env.shadowStagger = q.stagger;
    // no depth of field outdoors: a shallow focus on a wide landscape reads as a tilt-shift toy miniature; real
    // landscape photographs are sharp front to back and let aerial perspective carry the depth
    // ultra (screenshots): GTAO + SSR need a resolved depth buffer, so it renders without MSAA (TRAA instead)
    const opts = { ao: q.ao, ssr: q.ssr && this.postWet, taa: q.ao, bloom: q.bloom, dof: false, outline: this.outlineSel };
    const k = JSON.stringify([opts.ao, opts.ssr, opts.bloom]);
    let p = this.postCache.get(k);
    if (!p) {
      p = new Post(this.renderer, this.scene, this.camera, opts);
      this.postCache.set(k, p);
    }
    this.post = p;
  }

  private resize(): void {
    if (!this.renderer) return;
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(QUALITY[this.quality_].pr(window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    for (const i of this.interiors.values()) {
      i.camera.aspect = w / h;
      i.camera.updateProjectionMatrix();
    }
    if (this.rig) this.applySafeArea();
  }

  /** Frame-time governor. Frames are capped (60 in play), so fps can't show headroom: it watches missed frames
   *  (an interval well over the cap) and the CPU cost of a frame instead. Steps down when frames are missed, and
   *  climbs only with clear headroom; a tier it had to leave is never retried this session (no oscillation).
   *  Windows with a transition, load or a lower frame cap (UI / idle) don't count. */
  private governor(interval: number, cpuMs: number): void {
    if (!this.auto) return;
    const busyLoad = this.loading || this.dissolving || !!this.monthPass || document.hidden;
    if (busyLoad || this.activity !== 'play') {
      this.gov = { frames: 0, missed: 0, cpu: 0, t: 0, good: this.gov.good };
      return;
    }
    const g = this.gov;
    g.frames++;
    if (interval > 1000 / 60 * 1.45) g.missed++;
    g.cpu += cpuMs;
    g.t += interval;
    if (g.t < 2500) return;
    const miss = g.missed / g.frames;
    const cpu = g.cpu / g.frames;
    this.gov = { frames: 0, missed: 0, cpu: 0, t: 0, good: g.good };
    const idx = QORDER.indexOf(this.quality_);
    const cap = QORDER.indexOf(this.qualityCap);
    if (miss > 0.12 && idx > 0) {
      this.govBlocked.add(this.quality_);
      this.quality_ = QORDER[idx - 1];
      this.gov.good = 0;
      this.applyQuality();
    } else if (miss < 0.02 && cpu < 7 && idx < Math.min(cap, QORDER.indexOf('high')) && !this.govBlocked.has(QORDER[idx + 1])) {
      if (++this.gov.good >= 2) {
        this.gov.good = 0;
        this.quality_ = QORDER[idx + 1];
        this.applyQuality();
      }
    } else this.gov.good = 0;
  }
  private gov = { frames: 0, missed: 0, cpu: 0, t: 0, good: 0 };
  private govBlocked = new Set<Quality>();

  // ------------------------------------------------------------------ view
  setView(view: WorldView, opts?: { instant?: boolean }): void {
    const prevWet = this.view.weather === 'rain' || this.view.weather === 'storm';
    const v0 = this.view;
    if (v0.house !== view.house || v0.barn !== view.barn || v0.windmill !== view.windmill || v0.fence !== view.fence || v0.year !== view.year) crumb('state', `${view.year}/${view.month} ${view.house}${view.barn ? '+barn' : ''}${view.windmill ? '+windmill' : ''} fence${view.fence}`);
    // low-memory: a month pass walks the squares through new variants: drop the images no square shows any more
    if (LOW_MEMORY && (v0.month !== view.month || v0.year !== view.year)) this.plate?.trimSquares();
    this.view = structuredClone(view);
    this.squareOverride.clear();
    this.applyView(!!opts?.instant);
    for (const pv of [this.plate, this.interiorPlates.get(this.plateName(this.place))]) if (pv) void this.ensurePlateKeys(pv);
    const wet = view.weather === 'rain' || view.weather === 'storm';
    if (wet !== prevWet && this.post) this.buildPost();
  }

  private applyView(instant: boolean): void {
    const v = this.view;
    if (instant) this.snap = true;
    // Phones: the homestead's live layer (windmill, fences, animals, family) and the town crowd only change while
    // they are on screen. A purchase in the store used to load and build homestead models for a view nobody saw
    // (the last thing before an iPhone memory kill); now that waits until the player is back.
    const home = !LOW_MEMORY || HOME_SIDE.includes(this.place);
    const town = !LOW_MEMORY || TOWN_SIDE.includes(this.place);
    if (home) {
      const sig = JSON.stringify([v.house, v.barn, v.windmill, v.fence, v.year, v.field.length, v.animals, v.family, v.extras, v.mail]);
      const changed = sig !== this.liveSigHome;
      this.liveSigHome = sig;
      if (changed) crumb('liveRebuild start', `@${this.place} homestead ${v.house}${v.barn ? '+barn' : ''}${v.windmill ? '+windmill' : ''} fence${v.fence}`);
      this.home.apply(v);
      const jobs = [
        this.livestock.setCounts(v.animals, v.barn || v.fence >= 1),
        this.family.setCount(v.family, [v.year - 1880, v.year - 1884, v.year - 1889].filter((a) => a >= 0)),
      ].filter((j): j is LiveJob => !!j);
      if (jobs.length) crumb('liveRebuild load', jobs.map((j) => j.what).join(' · '));
      if (changed || jobs.length) {
        const t0 = performance.now();
        void Promise.all(jobs.map((j) => j.done.catch(() => undefined))).then(() => crumb('liveRebuild end', `${Math.round(performance.now() - t0)} ms`));
      }
    } else this.liveDeferred = true;
    if (town) this.townCrowd.setGrowth(v.townGrowth);
    else this.liveDeferred = true;
    for (const i of this.interiors.values()) (i as InteriorSet & { setExtras(e: string[], stove?: boolean): void }).setExtras(v.extras, v.stove);
    this.applySetVisibility();
  }

  private liveSigHome = '';
  /** a live-layer change waited for the player to come back (phones) */
  private liveDeferred = false;

  // ------------------------------------------------------------------ environment
  private applyEnvironment(dt: number): void {
    const v = this.view;
    const ov = this.envOv;
    const weather = ov?.weather ?? v.weather;
    if (this.snap) this.env.snap = true;
    this.snap = false;
    // in the street canyon a low sun leaves most surfaces in shade: lift the sky fill so the town reads
    const lowSun = 1 - THREE.MathUtils.smoothstep((uSunDir.value as THREE.Vector3).y, 0.1, 0.3);
    const fill = this.place === 'mainStreet' || this.place === 'elevator' ? 1 + 0.9 * lowSun : 1;
    // live figures are lit by the sky the plate's key was baked under
    let sky: string | undefined;
    if (this.plate?.json?.keys && !this.activeInterior()) {
      const [ka, kb, kt] = this.plateKeys(this.plate);
      sky = this.plate.json.keys[kt < 0.5 ? ka : kb]?.hdri;
    }
    this.env.update(
      { weather, month: v.month, hour: ov?.hour ?? v.hour, wind: ov?.wind ?? v.wind, snowCover: ov?.snow ?? v.snowCover, drought: ov?.drought ?? v.drought ?? 0, darken: sky ? 0 : ov?.darken, fill, sky },
      dt,
      this.camera,
      !!this.monthPass,
    );
    // a plate is lit by its baked key: live actors take that key's sun so they sit in the same light
    const pk = this.plate?.json?.keys;
    if (this.plate && pk) {
      const [a, b, t] = this.plateKeys(this.plate);
      const A = pk[a];
      const B = pk[b] ?? A;
      if (A && B) {
        const d = (uSunDir.value as THREE.Vector3).fromArray(A.sunDir).lerp(new THREE.Vector3().fromArray(B.sunDir), t).normalize();
        const ca = new THREE.Color().fromArray(A.sunColor).multiplyScalar(A.sunIntensity);
        const cb = new THREE.Color().fromArray(B.sunColor).multiplyScalar(B.sunIntensity);
        (uSunColor.value as THREE.Color).copy(ca).lerp(cb, t);
        this.env.sun.position.copy(d).multiplyScalar(400).add(this.camera.position);
        this.env.sun.target.position.copy(this.camera.position);
      }
    }
    this.weather.setLight(this.env.horizon.clone().multiplyScalar(0.55));
    this.renderer.toneMappingExposure = this.exposure * this.env.cameraExposure;
    if (this.plate && pk) {
      // expose for the plate's key (it was graded for that exposure); lifted so low-sun keys read warm, not gloomy.
      // Live actors share the renderer exposure, so they stay matched.
      const [a, b, t] = this.plateKeys(this.plate);
      const ea = pk[a]?.exposure ?? this.renderer.toneMappingExposure;
      const eb = pk[b]?.exposure ?? ea;
      // a cinematic darken (month-pass dusk, disasters) dims plate and live figures together, through the exposure
      this.renderer.toneMappingExposure = THREE.MathUtils.lerp(ea * plateLift(pk[a]), eb * plateLift(pk[b] ?? pk[a]), t) * (1 - (ov?.darken ?? 0) * 0.85);
    }
    if (this.post) this.post.uSSR.value = THREE.MathUtils.smoothstep(this.env.live.wet, 0.2, 0.7);
  }


  /** the plate keys to show (a, b, blend): from the hour / weather / snow cover, or a disaster's override (a
   *  blizzard blends the current key toward 'snow' as the cover builds) */
  private plateKeys(pv: PlateView): [string, string, number] {
    const v = this.view;
    const ov = this.envOv;
    const weather = ov?.weather ?? v.weather;
    if (ov?.snow !== undefined && v.snowCover <= 0.5 && pv.keys.includes('snow')) {
      const [a] = pv.keyFor(ov.hour ?? v.hour, weather === 'snow' ? 'clear' : weather, 0);
      return [a, 'snow', THREE.MathUtils.smoothstep(ov.snow, 0.35, 0.95)];
    }
    return pv.keyFor(ov?.hour ?? v.hour, weather, v.snowCover);
  }

  private updateFieldData(dt: number): void {
    const v = this.view;
    const n = Math.min(MAX_SQUARES, v.field.length);
    for (let i = 0; i < MAX_SQUARES; i++) {
      const sq = i < n ? v.field[i] : null;
      const o = i * 4;
      const stage = this.squareOverride.get(i) ?? (sq ? STAGES.indexOf(sq.stage) : 0);
      const crop = sq?.crop ? CROPS.indexOf(sq.crop) : 0;
      const grow = sq?.growth ?? 0;
      fieldData[o] = stage;
      fieldData[o + 1] = crop;
      fieldData[o + 2] += (grow - fieldData[o + 2]) * Math.min(1, dt * 2 + (this.snap ? 1 : 0));
      fieldData[o + 3] = (this.selected.has(i) ? 1 : 0) + (this.hoverSquare === i ? 2 : 0);
      this.squareStage[i] = stage;
    }
  }

  // ------------------------------------------------------------------ places
  /** bumps on every goTo: an older goTo still awaiting assets must not apply its place / plate afterwards */
  private goGen = 0;
  /** diagnostics: preparation timings per outdoor place (ms: plate load, plate compile + upload, live compile) */
  prepTimes = new Map<Place, { load: number; compile: number; live: number }>();
  /** diagnostics: timing of the last cross-dissolve (performance.now ms) */
  lastDissolve: { start: number; end: number } | null = null;
  private dissolving = false;
  async goTo(place: Place, opts?: { instant?: boolean }): Promise<void> {
    const instant = !!opts?.instant;
    const gen = ++this.goGen;
    // 1. everything the target needs (plate + its keys and layers, interior room, shaders) loads while the current
    //    view stays on screen and animating
    // never switch to a view whose plate and images aren't ready (instant hops too; they just report no progress)
    this.hopping.add(this.plateName(place));
    try {
      await this.preparePlace(place, !instant);
    } finally {
      this.hopping.delete(this.plateName(place));
    }
    if (gen !== this.goGen) return;
    const isInt = INTERIORS.includes(place);
    // (the target's current lighting keys are loaded before the cut: no key popping in after the dissolve)
    crumb('hop', `${this.place} -> ${place}`);
    this.hopping.add(this.plateName(place));
    let tpv: PlateView | null;
    try {
      tpv = isInt ? await this.interiorPlateRetry(place, await this.ensureInterior(place)) : await this.plateForRetry(place);
    } finally {
      this.hopping.delete(this.plateName(place));
    }
    if (!tpv) {
      // never switch to a view without its picture: stay on the current one (the UI keeps working; a later visit
      // tries again)
      crumb('hop-aborted', `${place}: no plate after 3 tries`);
      return;
    }
    if (tpv) await this.ensurePlateKeys(tpv).catch((e) => crumb('plate', `keys ${place}: ${errText(e)}`));
    if (gen !== this.goGen) return;
    // 2. freeze the outgoing frame on an overlay, switch everything underneath in one go, and cross-dissolve.
    //    No camera flights: with pre-rendered views a 3D flight shows the live world, then pops to the plate.
    const snap = instant ? null : await this.snapshot();
    this.place = place;
    if (this.liveDeferred) {
      this.liveDeferred = false;
      this.applyView(false);
    }
    this.setHover(null);
    if (!isInt) {
      await this.usePlate(place, gen);
      if (gen !== this.goGen) return void snap?.remove();
      this.rig.set(this.shotFor(place));
      this.rig.update();
    }
    // a superseded goTo may have left the old black fade up: clear it
    if (this.fade.style.opacity !== '0') this.fadeTo(0, true);
    if (snap) {
      // two rendered frames of the new view underneath before the dissolve starts: nothing pops during it
      this.dissolving = true;
      await this.frames(4);
      const t0 = performance.now();
      await this.dissolve(snap);
      this.dissolving = false;
      this.lastDissolve = { start: t0, end: performance.now() };
    }
    this.prefetchAround(place);
    if (LOW_MEMORY) {
      this.trimInteriors();
      for (const p of this.plates.values()) void p.then((pv) => pv?.trimSquares());
    }
  }

  /** Low-memory profile: only the current room stays loaded (its plate, pick props and post targets). */
  private trimInteriors(): void {
    const cur = INTERIORS.includes(this.place) ? this.interiorKey(this.place) : null;
    for (const [k, set] of [...this.interiors]) {
      if (k === cur) continue;
      this.interiors.delete(k);
      this.placeReady.delete('int:' + k);
      const view = k === 'sod' || k === 'sodFurnished' || k === 'frame' ? `house_${k}` : k;
      const pv = this.interiorPlates.get(view);
      this.interiorPlates.delete(view);
      this.interiorPlateLoads.delete(view);
      pv?.dispose();
      for (const [pk, post] of [...this.interiorPost]) if (String(pk).startsWith(k + ':')) (post.dispose(), this.interiorPost.delete(pk));
      set.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
  }

  /** ?memdebug=1: a small overlay with the memory this page holds (GPU textures by kind, render targets, decoded
   *  audio, JS heap where the browser reports it), updated every 2 s: real numbers from a phone. */
  private memDebug(): void {
    const box = document.createElement('pre');
    box.style.cssText = 'position:fixed;right:6px;top:6px;z-index:100002;margin:0;padding:6px 8px;background:#000b;color:#cfe;font:11px/1.35 ui-monospace,monospace;pointer-events:none';
    document.body.appendChild(box);
    const mb = (b: number) => (b / 1048576).toFixed(0).padStart(4) + ' MB';
    const bytes = (t: THREE.Texture) => {
      const im = (t.image ?? null) as { width?: number; height?: number } | null;
      const rt = this.packedRT.get(t);
      const w = rt?.width ?? im?.width ?? 0;
      const h = rt?.height ?? im?.height ?? 0;
      return w * h * (t.type === THREE.HalfFloatType || t.type === THREE.FloatType ? 8 : 4);
    };
    setInterval(async () => {
      const seen = new Set<THREE.Texture>();
      let plates = 0;
      let live = 0;
      let geo = 0;
      const pvs: PlateView[] = [];
      for (const p of this.plates.values()) {
        const pv = await p;
        if (pv) pvs.push(pv);
      }
      for (const pv of this.interiorPlates.values()) if (pv) pvs.push(pv);
      for (const pv of pvs) for (const t of pv.textures) if (!seen.has(t)) (seen.add(t), (plates += bytes(t)));
      const scan = (root: THREE.Object3D) =>
        root.traverse((o) => {
          const g = (o as THREE.Mesh).geometry;
          if (g) for (const a of Object.values(g.attributes)) geo += (a as THREE.BufferAttribute).array?.byteLength ?? 0;
          const ms = (o as THREE.Mesh).material;
          for (const m of Array.isArray(ms) ? ms : ms ? [ms] : []) for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture && !seen.has(v as THREE.Texture)) (seen.add(v as THREE.Texture), (live += bytes(v as THREE.Texture)));
        });
      scan(this.scene);
      for (const i of this.interiors.values()) scan(i.scene);
      const c = this.canvas;
      const posts = this.postCache.size + this.interiorPost.size;
      const rt = c.width * c.height * (8 + 8 + 4) * 4 * posts + c.width * c.height * 4 * 3;
      const sm = this.env?.sun.shadow.mapSize;
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      box.textContent = [
        `plates  ${mb(plates)}  (${pvs.map((p) => p.view).join(', ')})`,
        `live tx ${mb(live)}`,
        `geom    ${mb(geo)}`,
        `targets ${mb(rt)}  (${posts} post, ${c.width}x${c.height})`,
        `shadow  ${mb(sm ? sm.x * sm.y * 4 : 0)}`,
        `audio   ${mb(memStats.audioBytes)}`,
        `js heap ${heap ? mb(heap) : '   n/a'}`,
        `profile ${LOW_MEMORY ? 'low-memory' : 'full'} · ${this.quality_} · ${this.backend}`,
      ].join('\n');
    }, 2000);
  }

  private compiledPlates = new WeakSet<PlateView>();
  /** no ahead-of-time pipeline compiles (low-memory profile; ?aot=1 forces them on) */
  private aotOff = LOW_MEMORY && new URLSearchParams(location.search).get('aot') !== '1';
  /** the shadow matte material, one per strength (built + compiled ahead, not at the cut) */
  private shadowMats = new Map<number, THREE.Material>();
  private prepProxy(pv: PlateView): void {
    if (!pv.proxy || pv.proxy.userData.matte) return;
    pv.proxy.userData.matte = true;
    const k = pv.json?.shadowMatte?.strength ?? 0.8;
    let mat = this.shadowMats.get(k);
    if (!mat) this.shadowMats.set(k, (mat = new THREE.ShadowNodeMaterial({ opacity: k, depthWrite: false })));
    pv.proxy.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = mat!;
      m.receiveShadow = true;
      m.castShadow = false;
    });
  }
  private uploaded = new WeakSet<THREE.Texture>();
  private async compilePlate(pv: PlateView): Promise<void> {
    if (this.compiledPlates.has(pv) || !this.post) return;
    this.compiledPlates.add(pv);
    // WebGL2 fallback: ahead-of-time compiles are slower than just drawing (GLSL links on the main thread either
    // way, and every awaited compile adds a frame): upload the images only
    // (and on phones: Safari builds each pipeline slowly, so ahead-of-time compiles made a hop wait 8-16 s; drawing
    // compiles what is actually on screen, once, during the dissolve)
    if (this.backend !== 'WebGPU' || this.aotOff) return void (await this.uploadPlate(pv));
    const vis: [THREE.Object3D, boolean][] = [];
    pv.quad.traverse((o) => {
      vis.push([o, o.visible]);
      o.visible = true;
    });
    pv.quad.updateMatrixWorld(true);
    const sp = this.post.scenePass as { renderTarget: THREE.RenderTarget; getMRT(): unknown };
    const r = this.renderer as unknown as { compileAsync(o: THREE.Object3D, c: THREE.Camera, t: THREE.Object3D): Promise<void>; getRenderTarget(): THREE.RenderTarget | null; setRenderTarget(t: THREE.RenderTarget | null): void; getMRT(): unknown; setMRT(m: unknown): void };
    const rt = r.getRenderTarget();
    const mrt = r.getMRT();
    // one quad at a time, at most ~6 ms of synchronous node building per frame: the current view keeps animating
    const quads: THREE.Object3D[] = [];
    pv.quad.traverse((o) => ((o as THREE.Mesh).isMesh && o !== pv.quad ? quads.push(o) : 0));
    if (pv.proxy) {
      this.prepProxy(pv);
      pv.proxy.updateMatrixWorld(true);
      quads.push(pv.proxy);
    }
    const jobs: Promise<void>[] = [];
    let slice = performance.now();
    for (const child of [...quads, pv.quad]) {
      if (performance.now() - slice > 6) {
        await this.nextFrame();
        slice = performance.now();
      }
      r.setRenderTarget(sp.renderTarget);
      r.setMRT(sp.getMRT());
      let job: Promise<void>;
      try {
        job = this.asScenePass(() => r.compileAsync(child === pv.quad ? Object.assign(new THREE.Group(), {}).add(pv.quad.clone(false)) : child, this.camera, this.scene));
      } finally {
        r.setRenderTarget(rt);
        r.setMRT(mrt);
      }
      // (awaited one at a time: overlapping compiles see each other's render-target / MRT state and build
      // pipelines against the wrong bind group layout)
      await job.catch(() => undefined);
    }
    await Promise.all(jobs);
    for (const [o, v] of vis) o.visible = v;
    await this.uploadPlate(pv);
    // the world state may have changed while compiling (saved visibility is stale): re-derive it for the live plate
    if (pv === this.plate) this.applySetVisibility();
  }

  /** The camera for a place: a pre-rendered view's own camera (plate.json; its fovY includes the overscan) so the
   *  live layer always lines up with whatever plate is published, else the authored outdoorShot. */
  private shotFor(place: Place): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
    const c = this.plate?.json?.camera;
    if (c && !INTERIORS.includes(place)) {
      return { pos: new THREE.Vector3().fromArray(c.pos), look: new THREE.Vector3().fromArray(c.look), fov: c.fovY / (this.plate?.json?.overscan ?? 1) };
    }
    return outdoorShot(place, this.view.field.length)!;
  }

  /** A still of the current view on an overlay. A WebGPU canvas can only be read in the same task that rendered it
   *  (its texture is released at present), so the copy happens right after the next frame's render. */
  private snapRequest: ((c: HTMLCanvasElement | null) => void) | null = null;
  private snapshot(): Promise<HTMLCanvasElement | null> {
    return new Promise((res) => {
      this.snapRequest = res;
      // a paused / covered world renders no frame: no still, a plain cut
      setTimeout(() => {
        if (this.snapRequest === res) {
          this.snapRequest = null;
          res(null);
        }
      }, 250);
    });
  }
  private takeSnapshot(): void {
    const res = this.snapRequest;
    if (!res) return;
    this.snapRequest = null;
    try {
      const c = document.createElement('canvas');
      c.width = this.canvas.width;
      c.height = this.canvas.height;
      c.getContext('2d')!.drawImage(this.canvas, 0, 0);
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:1;transform-origin:50% 50%;will-change:opacity,transform';
      this.host.insertBefore(c, this.fade);
      res(c);
    } catch {
      res(null);
    }
  }

  /** fade the frozen outgoing frame away (with a slight push-in), ~0.38 s, then drop it */
  private dissolve(snap: HTMLCanvasElement): Promise<void> {
    return new Promise((res) => {
      const a = snap.animate(
        [
          { opacity: 1, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(1.03)' },
        ],
        { duration: 380, easing: 'ease-in-out', fill: 'forwards' },
      );
      const done = () => {
        snap.remove();
        res();
      };
      a.onfinish = done;
      a.oncancel = done;
    });
  }

  // ------------------------------------------------------------------ place preparation / idle prefetch
  private placeReady = new Map<string, Promise<void>>();
  private loadFns = new Set<(e: { place: Place; progress: number; done: boolean }) => void>();
  loading: { place: Place; progress: number } | null = null;
  private lastInput = 0;
  private webglCap = false;

  onLoadProgress(fn: (e: { place: Place; progress: number; done: boolean }) => void): () => void {
    this.loadFns.add(fn);
    return () => this.loadFns.delete(fn);
  }

  private placeKey(place: Place): string {
    return INTERIORS.includes(place) ? 'int:' + this.interiorKey(place) : place === 'title' ? 'homestead' : place === 'field' ? this.plateName('field') : place;
  }

  /** Assets + shader pipelines for `place`. `report`: drive world.loading / onLoadProgress while waiting. */
  private preparePlace(place: Place, report: boolean): Promise<void> {
    const key = this.placeKey(place);
    let p = this.placeReady.get(key);
    const emit = (progress: number, done = false) => {
      if (!report) return;
      this.loading = done ? null : { place, progress };
      for (const f of this.loadFns) f({ place, progress, done });
    };
    if (!p) {
      p = (async () => {
        if (INTERIORS.includes(place)) {
          const set = await this.ensureInterior(place);
          // a pre-rendered room needs no live-room shader compile (its meshes are hidden): just the plate
          const pv = await this.interiorPlateRetry(place, set);
          if (!pv) {
            if (this.placeReady.get(key) === p) this.placeReady.delete(key);
          } else {
            await this.ensurePlateKeys(pv);
            await this.uploadPlate(pv);
          }
        } else {
          // build the plate's own pipelines now (one material per layer and key), not on its first frame mid-dissolve
          const t0 = performance.now();
          const pv = await this.plateFor(place);
          if (!pv) {
            if (this.placeReady.get(key) === p) this.placeReady.delete(key);
          } else {
            await this.ensurePlateKeys(pv);
            const t1 = performance.now();
            await this.compilePlate(pv);
            const t2 = performance.now();
            await this.compileLive(pv);
            this.prepTimes.set(place, { load: Math.round(t1 - t0), compile: Math.round(t2 - t1), live: Math.round(performance.now() - t2) });
          }
        }
      })().catch((e) => {
        console.warn('prepare failed', place, e);
        crashError('prepare', `${place}: ${errText(e)}`);
        if (this.placeReady.get(key) === p) this.placeReady.delete(key);
      });
      this.placeReady.set(key, p);
    }
    let settled = false;
    void p.then(() => (settled = true));
    return Promise.resolve().then(async () => {
      if (settled) return;
      // no indicator at all for loads under 300 ms; then coarse progress (asset streams don't report bytes)
      let k = 0.1;
      let shown = false;
      const iv = setInterval(() => {
        shown = true;
        emit((k = Math.min(0.9, k + (0.9 - k) * 0.15)));
      }, 300);
      await p;
      clearInterval(iv);
      if (shown) emit(1, true);
    });
  }

  /** Upload every image of a plate now, about one full-size image per frame (left to the first frame, the town's
   *  ~30 layers stalled the cut by ~1 s), then drop the decoded CPU copies (WebGPU). */
  private async uploadPlate(pv: PlateView): Promise<void> {
    let px = 0;
    for (const t of pv.textures) {
      if (this.uploaded.has(t) || (t as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture) continue;
      this.uploaded.add(t);
      this.renderer.initTexture(t);
      const img = t.image as { width?: number; height?: number } | null;
      px += (img?.width ?? 512) * (img?.height ?? 512);
      if (px > 3e6) {
        px = 0;
        await this.nextFrame();
      }
    }
    if (PlateView.releaseAfterUpload) pv.releaseImages();
  }

  /** Low-memory profile: keep the current outdoor view and the last one; dispose the rest (GPU textures and
   *  pipelines' materials) and forget their preparation so a revisit loads them again. */
  private recentViews: string[] = [];
  /** plate views an in-flight goTo is waiting for (never evicted under it) */
  private hopping = new Set<string>();
  private trimPlates(current: string): void {
    this.recentViews = [current, ...this.recentViews.filter((v) => v !== current)];
    if (!LOW_MEMORY) return;
    const keep = new Set(this.recentViews.slice(0, LOW_MEMORY_VIEWS));
    this.recentViews = [...keep];
    // every other loaded outdoor view goes (including ones loaded before the first trim, e.g. the title's)
    for (const v of [...this.plates.keys()]) {
      if (keep.has(v) || this.hopping.has(v)) continue; // (another hop is waiting for it)
      const p = this.plates.get(v);
      this.plates.delete(v);
      this.placeReady.delete(v);
      void p?.then((pv) => pv && pv !== this.plate && pv.dispose());
    }
  }

  /** the lighting keys the current hour / weather show on this plate, loaded now (the rest stream when idle) */
  private ensurePlateKeys(pv: PlateView): Promise<unknown> {
    const [a, b, t] = INTERIORS.some((p) => this.plateName(p) === pv.view) ? pv.keyFor(this.view.hour, this.view.weather, 0) : this.plateKeys(pv);
    return Promise.all([pv.ensureKey(a), t > 0.001 ? pv.ensureKey(b) : null]).then(() => {
      // low-memory profile: only the keys on screen stay loaded
      if (LOW_MEMORY) for (const k of [...pv.loadedKeys]) if (k !== a && !(t > 0.001 && k === b)) pv.evictKey(k);
    });
  }

  /** The live layer's pipelines as seen from a plate's camera (people, horses, animals, the homestead's live
   *  parts): built while the current view is still up, not at the cut. */
  private liveSig = -1;
  private async compileLive(pv: PlateView): Promise<void> {
    if (!this.post || !pv.json?.camera || this.backend !== 'WebGPU' || this.aotOff) return;
    // the live camera itself (not a clone at the plate's shot): render state is cached per scene + camera +
    // target, so a clone built everything a second time at the cut. Frustum culling is off while compiling.
    const cam = this.camera;
    const roots = [this.townCrowd.group, this.town?.group, this.livestock.group, this.family.group, this.home.group].filter(Boolean) as THREE.Object3D[];
    // pipelines are per material + scene, not per camera: once compiled, only new live content needs it again
    let sig = 0;
    for (const g of roots) g.traverse((o) => ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints ? sig++ : 0));
    if (sig === this.liveSig) return;
    this.liveSig = sig;
    // hidden parts included (LOD levels: three LODs and the life kit's per-distance meshes show one level at a
    // time; the others were built at the first switch, ~6 ms per figure, 100 ms at the cut to town)
    await this.compileWith(this.post, this.scene, cam, roots, true);
  }

  /** `hidden`: also compile invisible objects (made visible only around each synchronous compile call, so no frame
   *  ever renders them) */
  private async compileWith(post: Post, scene: THREE.Scene, cam: THREE.Camera, roots?: THREE.Object3D[], hidden = false): Promise<void> {
    const r = this.renderer as THREE.WebGPURenderer & { compileAsync(s: THREE.Object3D, c: THREE.Camera): Promise<void> };
    const sp = post.scenePass as { renderTarget: THREE.RenderTarget; getMRT(): unknown };
    const rt = r.getRenderTarget();
    const mrt = (r as unknown as { getMRT(): unknown }).getMRT();
    // (the scene-pass target is set only around each synchronous compileAsync call and always restored: left set,
    // the post pipeline's final output would render into the texture it samples -> invalid command buffers)
    // node building is synchronous CPU work: compile in chunks of ~40 meshes with an idle gap between them so the
    // prefetch never produces a long task
    const chunks: THREE.Object3D[] = [];
    const count = (o: THREE.Object3D) => {
      let n = 0;
      (hidden ? o.traverse.bind(o) : o.traverseVisible.bind(o))((c: THREE.Object3D) => ((c as THREE.Mesh).isMesh || (c as THREE.Points).isPoints ? n++ : 0));
      return n;
    };
    const split = (o: THREE.Object3D) => {
      if (!o.visible && !hidden) return;
      const n = count(o);
      if (n === 0) return;
      if (n <= 2 || o.children.length === 0) chunks.push(o);
      else {
        if ((o as THREE.Mesh).isMesh) chunks.push(Object.assign(new THREE.Object3D(), { children: [] }) && o);
        for (const c of o.children) split(c);
      }
    };
    for (const c of roots ?? scene.children) split(c);
    const jobs: Promise<void>[] = [];
    let slice = performance.now();
    for (const chunk of chunks) {
      if (this.disposed) return;
      // node building is synchronous: at most ~6 ms of it per frame, then let the frame render
      if (performance.now() - slice > 6) {
        await this.nextFrame();
        slice = performance.now();
      }
      r.setRenderTarget(sp.renderTarget);
      (r as unknown as { setMRT(m: unknown): void }).setMRT(sp.getMRT());
      let job: Promise<void>;
      try {
        const culled: THREE.Object3D[] = [];
        const shown: THREE.Object3D[] = [];
        chunk.traverse((o) => {
          if (o.frustumCulled) (culled.push(o), (o.frustumCulled = false));
          if (hidden && !o.visible) (shown.push(o), (o.visible = true));
        });
        // (object, camera, targetScene): projects only the chunk, lit like the scene it lives in
        job = this.asScenePass(() => (r as unknown as { compileAsync(s: THREE.Object3D, c: THREE.Camera, t: THREE.Object3D): Promise<void> }).compileAsync(chunk, cam, scene));
        culled.forEach((o) => (o.frustumCulled = true));
        shown.forEach((o) => (o.visible = false));
      } finally {
        r.setRenderTarget(rt);
        (r as unknown as { setMRT(m: unknown): void }).setMRT(mrt);
      }
      // (awaited one at a time: overlapping compiles see each other's render-target / MRT state and build
      // pipelines against the wrong bind group layout)
      await job.catch(() => undefined);
    }
    await Promise.all(jobs);
  }

  /** Run a compileAsync as if inside the post pipeline's scene pass: render state is cached per render context,
   *  whose key includes the render call depth, and the scene pass renders one level deep (post quad -> pass). A
   *  compile at depth 0 built everything a second time on the first real frame (100 ms tasks at the cut). */
  private asScenePass<T>(fn: () => T): T {
    const rc = (this.renderer as unknown as { _renderContexts: { get(rt: unknown, mrt?: unknown, depth?: number): unknown } })._renderContexts;
    const get = rc.get;
    rc.get = (rt, mrt = null, depth) => get.call(rc, rt, mrt, depth ?? 1);
    try {
      return fn();
    } finally {
      rc.get = get;
    }
  }

  /** resolves just after the next animation frame has run (its render task done) */
  private nextFrame(): Promise<void> {
    return new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));
  }

  private interiorPostFor(place: Place, int: InteriorSet): Post {
    const ik = (this.interiorKey(place) + ':' + QUALITY[this.quality_].ao) as Place;
    let p = this.interiorPost.get(ik);
    if (!p) {
      const q = QUALITY[this.quality_];
      p = new Post(this.renderer, int.scene, int.camera, { ao: q.ao, ssr: false, taa: q.ao, bloom: q.bloom, dof: false, outline: this.outlineSel });
      this.interiorPost.set(ik, p);
    }
    return p;
  }

  /** Idle prefetch of the places reachable from where the camera is (not the whole world): from the homestead
   *  Main Street and the house, from Main Street the store, bank and elevator. One at a time, idle only. */
  private prefetchGen = 0;
  private prefetchAround(place: Place): void {
    if (LOW_MEMORY) return; // (each prefetched view is ~50-200 MB of textures on a phone)
    const next: Partial<Record<Place, Place[]>> = {
      title: ['mainStreet', 'house'],
      homestead: ['mainStreet', 'house'],
      field: ['mainStreet'],
      pen: ['mainStreet'],
      mainStreet: ['store', 'bank', 'elevator'],
      elevator: ['store', 'bank'],
      store: ['bank'],
      bank: ['store'],
    };
    const order = next[place] ?? [];
    const gen = ++this.prefetchGen;
    const idle = () => new Promise<void>((r) => ((window as unknown as { requestIdleCallback?: (f: () => void, o?: object) => void }).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200)))(() => r(), { timeout: 2000 }));
    // only while nothing is happening: no input for 2 s, camera at rest, no month pass / field work / transition
    const quiet = () =>
      performance.now() - this.lastInput > 2000 && !this.monthPass && !this.fieldWork && !this.loading && !this.dissolving && !document.hidden;
    void (async () => {
      await new Promise((r) => setTimeout(r, 3000));
      for (const p of order) {
        if (this.disposed || gen !== this.prefetchGen) return;
        do await idle();
        while (!quiet());
        if (gen !== this.prefetchGen) return;
        await this.preparePlace(p, false);
      }
    })();
  }

  /** resolves once the scene's renderable count has been unchanged for 3 checks (250 ms apart), or after maxMs */
  private waitStable(maxMs: number): Promise<void> {
    const t0 = performance.now();
    let last = -1;
    let same = 0;
    return new Promise((res) => {
      const tick = () => {
        let n = 0;
        this.scene.traverse((o) => ((o as THREE.Mesh).isMesh ? n++ : 0));
        same = n === last ? same + 1 : 0;
        last = n;
        // LOD hysteresis on every kit LOD (no flicker when the gameplay camera breathes at a switch distance)
        this.scene.traverse((o) => {
          if ((o as THREE.LOD).isLOD) for (const l of (o as THREE.LOD).levels as { hysteresis: number }[]) l.hysteresis = Math.max(l.hysteresis ?? 0, 0.1);
        });
        if (same >= 3 || performance.now() - t0 > maxMs) res();
        else setTimeout(tick, 250);
      };
      tick();
    });
  }

  /** plate view name for a place (interiors by house state) */
  private plateName(place: Place): string {
    if (place === 'field' && this.view.field.length > 8) return 'field16'; // second-claim framing (all 16 squares)
    return place === 'house' ? `house_${this.interiorKey('house')}` : place === 'title' ? 'homestead' : place;
  }

  /** the plate keys the current hour / weather will show (loaded first; the rest stream in later) */
  private neededKeys(): string[] {
    const v = this.view;
    if (v.snowCover > 0.5) return ['snow'];
    if (v.weather === 'overcast' || v.weather === 'rain' || v.weather === 'storm') return ['overcast'];
    if (v.hour < 14.5) return ['morning'];
    if (v.hour > 17.5) return ['golden'];
    return ['morning', 'golden'];
  }

  /** the (cached) plate for an outdoor place, or null when it has none */
  private plateFor(place: Place): Promise<PlateView | null> {
    const name = this.plateName(place);
    let p = this.plates.get(name);
    if (!p) {
      p = PlateView.load(name, undefined, [], this.neededKeys()).then((pv) => {
        // a failed load (a fetch / decode / upload that failed on a phone under memory pressure) is not cached: the
        // next request loads it again instead of showing an empty view until something else evicts it
        if (!pv) {
          crumb('plate-failed', name);
          if (this.plates.get(name) === p) this.plates.delete(name);
        }
        return pv;
      });
      this.plates.set(name, p);
    }
    return p;
  }

  /** the plate for an outdoor place, retried (with a short back-off) until one loads; null after 3 failures */
  private async plateForRetry(place: Place): Promise<PlateView | null> {
    for (let i = 0; i < 3; i++) {
      const pv = await this.plateFor(place);
      if (pv && !pv.disposed) return pv;
      if (pv?.disposed) this.plates.delete(this.plateName(place)); // evicted while this hop waited: load it again
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    return null;
  }

  /** short memory line for the crash breadcrumbs (MB): plates, audio, render size */
  private memLine(): string {
    let tex = 0;
    const seen = new Set<THREE.Texture>();
    for (const pv of [this.plate, ...this.interiorPlates.values()]) {
      if (!pv) continue;
      for (const t of pv.textures) {
        if (seen.has(t)) continue;
        seen.add(t);
        const rt = this.packedRT.get(t);
        const im = t.image as { width?: number; height?: number } | null;
        tex += (rt?.width ?? im?.width ?? 0) * (rt?.height ?? im?.height ?? 0) * 4;
      }
    }
    const mem = (this.renderer?.info as unknown as { memory?: { textures: number; geometries: number } })?.memory;
    const workers = (getSharedDraco() as unknown as { workerPool?: unknown[] } | null)?.workerPool?.length ?? 0;
    return `plates ${Math.round(tex / 1048576)} MB · audio ${Math.round(memStats.audioBytes / 1048576)} MB · ${mem?.textures ?? '?'} tex ${mem?.geometries ?? '?'} geo · ${workers} decoders · ${this.canvas?.width}x${this.canvas?.height} ${this.quality_}`;
  }

  private async usePlate(place: Place, gen: number): Promise<void> {
    if (INTERIORS.includes(place)) return;
    const pv = await this.plateForRetry(place);
    if (gen !== this.goGen) return; // a newer goTo superseded this one: don't install a stale plate
    // never swap the picture for nothing: a plate that failed keeps the old view up (the next visit retries)
    if (!pv) {
      crumb('plate-kept', `${place}: kept ${this.plate?.view ?? 'none'}`);
      return;
    }
    this.setPlate(pv);
    this.trimPlates(this.plateName(place));
  }

  private setPlate(pv: PlateView | null): void {
    if (pv === this.plate) return;
    if (this.plate) {
      this.plate.quad.removeFromParent();
      this.plate.proxy?.removeFromParent();
    }
    this.plate = pv;
    if (pv) {
      pv.quad.visible = true;
      this.scene.add(pv.quad);
      // ground-only proxy (proxy_ground.glb) as a shadow matte: live actors cast onto the plate's ground
      if (pv.proxy) {
        this.prepProxy(pv);
        this.scene.add(pv.proxy);
      }
    }
    this.applySetVisibility();
  }

  /** Interior plate: the room becomes the pre-rendered plate; only meshes flagged userData.live stay drawn
   *  (pick props keep raycasting: the raycaster ignores visibility). */
  private interiorPlates = new Map<string, PlateView | null>();
  private interiorPlateLoads = new Map<string, Promise<PlateView | null>>();
  /** load (once) the room's plate and install it in the room scene (live room meshes hidden) */
  private loadInteriorPlate(place: Place, set: InteriorSet): Promise<PlateView | null> {
    const name = this.plateName(place);
    let p = this.interiorPlateLoads.get(name);
    if (!p) {
      p = PlateView.load(name, undefined, [], [this.view.hour >= 16.5 ? 'evening' : 'day']).then((pv) => {
        if (!pv) {
          // every room has a plate: one that failed to load (memory pressure) is not remembered, the next try loads it
          crumb('plate-failed', name);
          if (this.interiorPlateLoads.get(name) === p) this.interiorPlateLoads.delete(name);
          return pv;
        }
        this.interiorPlates.set(name, pv);
        if (pv) {
          set.scene.traverse((o) => {
            if ((o as THREE.Mesh).isMesh && !o.userData.live) o.visible = false;
          });
          set.scene.add(pv.quad);
        }
        return pv;
      });
      this.interiorPlateLoads.set(name, p);
    }
    return p;
  }

  private async interiorPlateRetry(place: Place, set: InteriorSet): Promise<PlateView | null> {
    for (let i = 0; i < 3; i++) {
      const pv = await this.loadInteriorPlate(place, set);
      if (pv && !pv.disposed) return pv;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
    return null;
  }

  /** square variant name for the baked-square images (sets.md) */
  private squareVariant(stage: number, crop: number): string {
    const st = STAGES[stage] ?? 'prairie';
    if (st === 'prairie' || st === 'plowed' || st === 'planted' || st === 'burnt') return st;
    return `${CROPS[crop] ?? 'wheat'}_${st}`;
  }

  /** Drive the plate's baked squares from the field state (each square holds its last image while the next
   *  variant streams in). */
  private updateBakedSquares(): void {
    const pv = this.plate;
    const n = Math.min(MAX_SQUARES, this.view.field.length);
    if (!pv || !pv.squareQuads.length) return;
    const [ka, kb] = this.plateKeys(pv);
    const wf = uWorkFront.value as THREE.Vector4;
    for (let i = 0; i < 16; i++) {
      if (i >= n) {
        pv.setSquare(i, null, ka, kb);
        continue;
      }
      const stage = fieldData[i * 4];
      const crop = fieldData[i * 4 + 1];
      const work = wf.w > 0 && wf.x === i ? { variant: this.squareVariant(wf.z, crop), front: wf.y } : undefined;
      pv.setSquare(i, this.squareVariant(stage, crop), ka, kb, work);
    }
  }

  /** the plate's state layers follow the game state; the live windmill keeps only its turning head where the plate
   *  bakes the tower */
  private applySetVisibility(): void {
    if (!this.plate) return;
    // with state layers only parts that have a layer are baked; a plate without layers bakes everything into the base
    const ids = (this.plate.layers ?? []).map((l) => l.id);
    const towerBaked = ids.length === 0 || ids.some((i) => i.startsWith('windmill'));
    this.parts.windmill.traverse((o) => {
      // (Aermotor: Tower_LOD*, Pump; Halladay scan: S_M_HalTower*; stock tank): everything but the turning head
      // (LODs rewrite .visible every frame: park baked parts on an unrendered layer instead)
      if ((o as THREE.Mesh).isMesh && !/^(Head|Wheel|Tail|Vane|PumpRod)/i.test(o.name) && !/^(Head|Wheel|Tail)/i.test(o.parent?.name ?? '')) {
        if (towerBaked) o.layers.set(29);
        else if (o.layers.mask === 1 << 29) o.layers.set(0);
      }
    });
    const v = this.view;
    this.plate.applyState({ house: v.house, barn: v.barn, windmill: v.windmill, year: v.year, fence: v.fence, extras: v.extras, townGrowth: v.townGrowth, business0: !!v.ownedBusinesses[0], business1: !!v.ownedBusinesses[1], business2: !!v.ownedBusinesses[2], business3: !!v.ownedBusinesses[3], freightOffice: v.extras.includes('freightOffice'), era: v.year >= 1888 ? 'aermotor' : 'halladay' });
  }

  private fadeTo(o: number, instant: boolean): Promise<void> {
    this.fade.style.transition = instant ? 'none' : 'opacity .35s ease';
    this.fade.style.opacity = String(o);
    return new Promise((r) => setTimeout(r, instant ? 0 : 380));
  }

  private interiorKey(place: Place): string {
    if (place === 'house') return this.view.house === 'frame' ? 'frame' : this.view.house === 'sodFurnished' ? 'sodFurnished' : 'sod';
    return place;
  }

  private async ensureInterior(place: Place): Promise<InteriorSet> {
    const k = this.interiorKey(place);
    let set = this.interiors.get(k);
    if (!set) {
      // lazy: interiors load the first time the camera goes inside. A plated room needs only its pick geometry;
      // the kit room (models, textures, lights) loads only for a view without a plate
      const view = this.plateName(place);
      const { PlatedInterior } = await import('./interiors/plated');
      if (await PlatedInterior.available(view)) {
        const pi = new PlatedInterior(view);
        await pi.ready;
        set = pi;
      } else if (k === 'sod' || k === 'sodFurnished' || k === 'frame') {
        const { HomesteadInteriorSet } = await import('./interiors/homestead');
        const hs = new HomesteadInteriorSet(k);
        await hs.ready;
        set = hs;
      } else if (k === 'store') {
        const m = await import('./kits/town/interiors/store');
        set = new m.TownStoreInterior() as unknown as InteriorSet;
      } else {
        const m = await import('./kits/town/interiors/bank');
        set = new m.TownBankInterior() as unknown as InteriorSet;
      }
      const env = this.env.shownEnv ? this.env.skies.entries.get(this.env.shownEnv)?.env : null;
      if (env) set.setEnvironment(env);
      (set as InteriorSet & { setExtras(e: string[], stove?: boolean): void }).setExtras(this.view.extras, this.view.stove);
      this.interiors.set(k, set);
      this.resize();
      await Promise.all(pending);
    }
    return set;
  }

  private activeInterior(): InteriorSet | null {
    return INTERIORS.includes(this.place) ? this.interiors.get(this.interiorKey(this.place)) ?? null : null;
  }

  // ------------------------------------------------------------------ picking
  onPick(fn: (t: PickTarget) => void): void {
    this.pickFns.push(fn);
  }
  onHover(fn: (t: PickTarget | null) => void): void {
    this.hoverFns.push(fn);
  }
  setInteractive(targets: PickTarget[] | 'all' | 'none'): void {
    this.interactive = targets === 'all' || targets === 'none' ? targets : new Set(targets.map(key));
  }
  setSelectedSquares(indices: number[]): void {
    this.selected = new Set(indices);
  }
  setGhosts(items: PickTarget[]): void {
    const want = new Set(items.map(key));
    for (const [k, g] of this.ghosts) g.visible = want.has(k);
  }

  private isInteractive(t: PickTarget): boolean {
    if (this.interactive === 'all') return t.kind !== 'build' || (this.ghosts.get(key(t))?.visible ?? false);
    if (this.interactive === 'none') return false;
    return this.interactive.has(key(t));
  }

  private onPointer(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.pointerDirty = true;
  }

  /** Touch has no hover: the first tap on a target shows its label (the hover callbacks), a second tap on the same
   *  target acts. Bare ground / a different target just moves the "hover". Mouse clicks act at once, as before. */
  private lastPointerType = 'mouse';
  private armed: string | null = null;
  private onClick(e: MouseEvent): void {
    this.onPointer(e as PointerEvent);
    const t = this.pickAt(this.pointer);
    if (this.lastPointerType === 'touch') {
      const k = t ? key(t) : null;
      // squares act on the first tap (selecting squares is the action)
      if (k !== this.armed && t?.kind !== 'square') {
        this.armed = k;
        this.setHover(t);
        return;
      }
      this.armed = null;
    }
    if (t) for (const f of this.pickFns) f(t);
  }

  /** Raycast the current place's pickables; field squares via a terrain march. */
  pickAt(ndc: THREE.Vector2): PickTarget | null {
    if (this.disasters?.playing) return null;
    const int = this.activeInterior();
    if (int) {
      this.raycaster.setFromCamera(ndc, int.camera);
      const objs = [...int.props.values()];
      const hit = this.raycaster.intersectObjects(objs, true)[0];
      if (!hit) return null;
      let o: THREE.Object3D | null = hit.object;
      while (o && o.userData.pickId === undefined) o = o.parent;
      const t: PickTarget | null = o ? { kind: 'prop', id: o.userData.pickId as string } : null;
      return t && this.isInteractive(t) ? t : null;
    }
    this.raycaster.setFromCamera(ndc, this.camera);
    // (house / barn / pen / mailbox are invisible proxy boxes: the plate draws the building, the raycaster ignores
    // material visibility; their containers follow the game state)
    const vis = (o: THREE.Object3D) => o.visible;
    const cands = this.pickables.filter((p) => p.places.includes(this.place) && p.objects.some(vis) && this.isInteractive(p.target));
    let best: { d: number; t: PickTarget } | null = null;
    for (const p of cands) {
      const hit = this.raycaster.intersectObjects(p.objects.filter(vis), true)[0];
      if (hit && (!best || hit.distance < best.d)) best = { d: hit.distance, t: p.target };
    }
    // anchor-only targets (field/main street/town buildings): screen-space proximity to the label anchor
    for (const p of this.pickables) {
      if (p.objects.length || !p.places.includes(this.place) || !this.isInteractive(p.target) || p.target.kind === 'square') continue;
      if (p.target.kind === 'place' && p.target.place === 'field' && this.place === 'field') continue;
      const a = p.anchor().project(this.camera);
      if (a.z > 1) continue;
      const dx = (a.x - ndc.x) * this.camera.aspect;
      const dy = a.y - ndc.y;
      if (Math.hypot(dx, dy) < 0.07) {
        const d = p.anchor().distanceTo(this.camera.position);
        if (!best || d < best.d) best = { d, t: p.target };
      }
    }
    if (best) return best.t;
    // field squares: march the ray against the terrain
    const ro = this.raycaster.ray.origin;
    const rd = this.raycaster.ray.direction;
    let tHit = -1;
    for (let t = 1; t < 2500; t *= 1.03) {
      const x = ro.x + rd.x * t;
      const z = ro.z + rd.z * t;
      if (ro.y + rd.y * t < terrainHeight(x, z)) {
        tHit = t;
        break;
      }
    }
    if (tHit > 0) {
      const x = ro.x + rd.x * tHit;
      const z = ro.z + rd.z * tHit;
      const idx = this.squareAt(x, z);
      if (idx >= 0) {
        const t: PickTarget = { kind: 'square', index: idx };
        if ((this.place === 'field' || this.isInteractive(t)) && this.isInteractive(t)) return t;
      }
    }
    return null;
  }

  squareAt(x: number, z: number): number {
    const pitch = FIELD.square + FIELD.gap;
    const lx = x - FIELD.x0;
    const lz = FIELD.z0 - z;
    if (lx < 0 || lz < 0) return -1;
    const cx = Math.floor(lx / pitch);
    const cz = Math.floor(lz / pitch);
    if (cx > 3 || cz > 3 || lx - cx * pitch > FIELD.square || lz - cz * pitch > FIELD.square) return -1;
    const claim = cx >> 1;
    const idx = claim * 8 + cz * 2 + (cx & 1);
    return idx < this.view.field.length ? idx : -1;
  }

  private setHover(t: PickTarget | null): void {
    const k = t ? key(t) : null;
    if (k === this.hoverKey) return;
    this.hoverKey = k;
    this.hoverSquare = t?.kind === 'square' ? t.index : -1;
    this.outlineSel.length = 0;
    uGhostHover.value = t?.kind === 'build' ? 1 : 0;
    if (t && t.kind !== 'square') {
      const int = this.activeInterior();
      if (int && t.kind === 'prop') {
        // (a plated room's props are invisible pick meshes: no outline)
        const o = int.props.get(t.id);
        if (o && !this.interiorPlates.get(this.plateName(this.place))) this.outlineSel.push(o);
      } else if (t.kind === 'build') {
        // outdoors only the blueprint ghosts outline (buildings are part of the plate)
        const p = this.pickables.find((pp) => key(pp.target) === k);
        if (p) for (const o of p.objects) if (o.visible) this.outlineSel.push(o);
      }
    }
    this.canvas.style.cursor = t ? 'pointer' : 'default';
    for (const f of this.hoverFns) f(t);
  }

  project(t: PickTarget): { x: number; y: number } | null {
    const int = this.activeInterior();
    let p: THREE.Vector3 | null = null;
    let cam: THREE.Camera = this.camera;
    if (int && t.kind === 'prop') {
      const o = int.props.get(t.id);
      if (!o) return null;
      const box = new THREE.Box3().setFromObject(o);
      p = box.getCenter(new THREE.Vector3());
      p.y = box.max.y + 0.05;
      cam = int.camera;
    } else {
      const pk = this.pickables.find((pp) => key(pp.target) === key(t));
      if (!pk) return null;
      p = pk.anchor();
    }
    const v = p.clone().project(cam);
    if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return null;
    return { x: ((v.x + 1) / 2) * this.host.clientWidth, y: ((1 - v.y) / 2) * this.host.clientHeight };
  }

  // ------------------------------------------------------------------ cinematics
  /** Disasters play at a plated camera (the field, or the homestead for drought / blizzard): the world dissolves
   *  there first. Scorched / stripped squares stay until the next setView. */
  async playDisaster(kind: DisasterKind): Promise<void> {
    const at = Disasters.placeFor(kind);
    if (this.place !== at) await this.goTo(at);
    // the lighting key the cinematic turns to must be on hand before it starts (keys otherwise stream when idle)
    const want = kind === 'blizzard' ? 'snow' : kind === 'tornado' || kind === 'hail' || kind === 'flood' || kind === 'grasshoppers' ? 'overcast' : kind === 'fire' ? 'golden' : null;
    if (want && this.plate) await this.plate.ensureKey(want);
    return this.disasters.play(kind);
  }

  playFieldWork(kind: 'plow' | 'plant' | 'harvest', squares: number[], seconds: number): Promise<void> {
    this.skipWork();
    const stageTo = kind === 'plow' ? 1 : kind === 'plant' ? 2 : 6;
    for (const i of squares) if (kind === 'harvest') this.squareOverride.delete(i);
    return new Promise((resolve) => {
      this.fieldWork = { kind, squares: [...squares], t: 0, dur: Math.max(0.5, seconds), resolve, done: 0 };
      if (squares.length) void this.crew.work(kind, squares[0]);
      void stageTo;
    });
  }

  private skipWork(): void {
    const w = this.fieldWork;
    if (!w) return;
    const st = w.kind === 'plow' ? 1 : w.kind === 'plant' ? 2 : 6;
    for (const i of w.squares) this.squareOverride.set(i, st);
    this.fieldWork = null;
    this.crew.stop();
    (uWorkFront.value as THREE.Vector4).set(-1, 0, 0, 0);
    w.resolve();
  }

  playMonthPass(next: WorldView, seconds: number): Promise<void> {
    this.skipMonth();
    const from = structuredClone(this.view);
    return new Promise((resolve) => {
      this.monthPass = { from, to: structuredClone(next), t: 0, dur: Math.max(0.5, seconds), resolve };
    });
  }

  private skipMonth(): void {
    const m = this.monthPass;
    if (!m) return;
    this.monthPass = null;
    if (this.envOv && !this.disasters.playing) this.envOv = null;
    this.setView(m.to);
    m.resolve();
  }

  skip(): void {
    this.disasters?.skip();
    this.skipWork();
    this.skipMonth();
  }

  /**
   * UI-aware framing (contract addition): fractions of the viewport covered by HTML UI on each side. The
   * camera's principal point shifts (setViewOffset) so every shot is centred in the visible area, and the
   * field of view widens slightly to keep the subject's size.
   */
  setSafeArea(a: { left?: number; right?: number; top?: number; bottom?: number }): void {
    this.safe = { left: a.left ?? 0, right: a.right ?? 0, top: a.top ?? 0, bottom: a.bottom ?? 0 };
    this.applySafeArea();
  }
  private safe = { left: 0, right: 0, top: 0, bottom: 0 };
  private applySafeArea(): void {
    const w = this.host?.clientWidth || window.innerWidth;
    const h = this.host?.clientHeight || window.innerHeight;
    const { left, right, top, bottom } = this.safe;
    for (const cam of [this.camera, ...[...this.interiors.values()].map((i) => i.camera)]) {
      if (!left && !right && !top && !bottom) cam.clearViewOffset();
      else cam.setViewOffset(w, h, ((right - left) * w) / 2, ((bottom - top) * h) / 2, w, h);
    }
    this.rig.fovScale = 1 + Math.max(right + left, top + bottom) * 0.35;
    for (const i of this.interiors.values()) i.fovScale = this.rig.fovScale;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) this.renderer.setAnimationLoop(null);
    else {
      this.timer.update();
      this.renderer.setAnimationLoop(() => this.frame());
    }
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.postCache.forEach((p) => p.dispose());
    this.interiorPost.forEach((p) => p.dispose());
    this.renderer.dispose();
    this.canvas.remove();
    this.fade.remove();
    this.hud?.remove();
  }

  // ------------------------------------------------------------------ frame
  // ------------------------------------------------------------------ frame governor
  private activity: 'idle' | 'ui' | 'play' | 'covered' = 'play';
  private lastFrameAt = 0;
  private frameInterval = 16.7;
  /** ?uncap=1: no frame cap (benchmarks) */
  private uncapped = new URLSearchParams(location.search).get('uncap') === '1';
  /** Contract addition: how much the world needs to render. 'play' caps at 60 fps (also on 120 Hz displays),
   *  'ui' (a full panel open) and 'idle' (nothing animating) render at 24 fps, 'covered' (a full-screen sheet
   *  hides the canvas) renders nothing. Transitions, month passes and field work always run at 60. */
  setActivity(a: 'idle' | 'ui' | 'play' | 'covered'): void {
    this.activity = a;
  }

  private frame(): void {
    if (this.disposed) return;
    {
      const now = performance.now();
      const busy = !!(this.monthPass || this.fieldWork || this.dissolving || this.loading || this.disasters?.playing);
      const a = busy ? 'play' : this.activity;
      // (30 = every other 60 Hz vsync: an even cadence; 24 judders against 60 Hz displays)
      const minGap = a === 'play' ? 1000 / 60 - 2 : a === 'covered' ? Infinity : 1000 / 30 - 2;
      if (now - this.lastFrameAt < minGap && !this.uncapped) return;
      this.frameInterval = now - this.lastFrameAt;
      this.lastFrameAt = now;
    }
    const cpu0 = performance.now();
    const inf = this.renderer.info.render as unknown as { drawCalls: number; triangles: number };
    this.lastStats.drawCalls = inf.drawCalls;
    this.lastStats.triangles = inf.triangles;
    this.renderer.info.reset();
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.simTime += dt;
    const t = this.simTime;
    uTime.value = t;
    // month pass: sweep the sun through a day while the view cross-fades to the next month
    if (this.monthPass) {
      const m = this.monthPass;
      m.t += dt / m.dur;
      const k = Math.min(1, m.t);
      // sweep the sun to evening, dip through dusk, rise into the next month's morning (never full night)
      this.view.hour = k < 0.5 ? THREE.MathUtils.lerp(m.from.hour, 19, k * 2) : THREE.MathUtils.lerp(6.6, m.to.hour, (k - 0.5) * 2);
      this.envOv = { ...(this.envOv ?? {}), darken: Math.max(0, 1 - Math.abs(k - 0.5) * 9) * 0.6 };
      if (k > 0.5 && this.view.month !== m.to.month) {
        const hour = this.view.hour;
        this.view = structuredClone(m.to);
        this.view.hour = hour;
        this.applyView(false);
      }
      if (k >= 1) this.skipMonth();
    }
    // field work: squares flip one by one with a dust puff of progress
    if (this.fieldWork) {
      const w = this.fieldWork;
      w.t += dt;
      const st = w.kind === 'plow' ? 1 : w.kind === 'plant' ? 2 : 6;
      const n = Math.floor((w.t / w.dur) * w.squares.length);
      while (w.done < Math.min(n, w.squares.length)) this.squareOverride.set(w.squares[w.done++], st);
      const frac = Math.min(1, (w.t / w.dur) * w.squares.length - w.done);
      if (w.done < w.squares.length) {
        void this.crew.work(w.kind, w.squares[w.done]);
        this.crew.front = frac;
        (uWorkFront.value as THREE.Vector4).set(w.squares[w.done], frac, st, 1);
      } else (uWorkFront.value as THREE.Vector4).set(-1, 0, 0, 0);
      if (w.t >= w.dur) this.skipWork();
    }
    this.applyEnvironment(dt);
    this.updateFieldData(dt);
    const wind = uWind.value as number;
    const wd = uWindDir.value as THREE.Vector2;
    const cv = uCloudOffset.value as THREE.Vector2;
    cv.x -= wd.x * dt * (6 + wind * 18);
    cv.y -= wd.y * dt * (6 + wind * 18);
    this.lightningT -= dt;
    let flash = 0;
    if ((this.envOv?.weather ?? this.view.weather) === 'storm') {
      if (this.lightningT < 0) this.lightningT = 4 + Math.random() * 9;
      if (this.lightningT < 0.35) flash = Math.max(0, Math.sin(this.lightningT * 60) * (this.lightningT / 0.35));
    }
    uLightning.value = flash;
    if (this.pointerDirty && !this.paused) {
      this.pointerDirty = false;
      this.setHover(this.pickAt(this.pointer));
    }
    if (this.post) this.post.uOutlinePulse.value = (Math.sin(t * 3) * 0.5 + 0.5) * 0.6;
    const int = this.activeInterior();
    if (int) {
      int.update(t, dt, true);
      const p = this.interiorPostFor(this.place, int);
      const ex = this.renderer.toneMappingExposure;
      this.renderer.toneMappingExposure = int.exposure;
      const ip = this.interiorPlates.get(this.plateName(this.place));
      if (ip) {
        const [a, b, k] = ip.keyFor(this.view.hour, this.view.weather, 0);
        ip.setKeys(a, b, k);
        const pk = ip.json?.keys;
        // interior plates are exposed per room in the bake (radianceScale): use their exposure as-is
        if (pk?.[a]?.exposure) {
          const lift = INTERIOR_LIFT[ip.view] ?? {};
          this.renderer.toneMappingExposure = THREE.MathUtils.lerp(pk[a].exposure! * (lift[a] ?? 1), (pk[b]?.exposure ?? pk[a].exposure!) * (lift[b] ?? 1), k);
        }
        const v = this.view;
        ip.applyState({ house: v.house, barn: v.barn, windmill: v.windmill, year: v.year, fence: v.fence, extras: v.extras, stove: v.stove });
      }
      int.scene.matrixWorldAutoUpdate = false;
      int.scene.updateMatrixWorld();
      p.render();
      this.takeSnapshot();
      this.renderer.toneMappingExposure = ex;
    } else {
      this.rig.update();
      this.regionCull();
      this.crew.update(dt, this.camera);
      this.updateBakedSquares();
      // the squares are baked images (no live terrain wash): every selected / hovered square gets the edge glow
      this.marks.set(this.selected, this.hoverSquare, this.place === 'field', () => true);
      this.home.update(t, dt, wind, wd);
      this.weather.setScreenFx(this.disasters.screenFx.hail, this.disasters.screenFx.dust);
      this.weather.update(dt, t, this.camera, this.env.live.rain, this.env.live.snowFall, wind, (this.envOv?.weather ?? this.view.weather) === 'storm');
      updateLifeKit(dt, this.camera);
      this.family.update(t, dt);
      if (this.place === 'mainStreet' || this.place === 'elevator') this.town?.update(t, dt, this.camera);
      this.disasters.update(t, dt);
      const wet = (this.envOv?.weather ?? this.view.weather) === 'rain' || (this.envOv?.weather ?? this.view.weather) === 'storm';
      if (wet !== this.postWet) this.buildPost();
      if (this.plate) {
        const [a, b, t] = this.plateKeys(this.plate);
        // (low-memory profile: a key the hour moves into mid-month, e.g. the month pass's dusk, loads on demand)
        if (LOW_MEMORY && t > 0.001 && !this.plate.loadedKeys.has(b)) void this.plate.ensureKey(b);
        this.plate.setKeys(a, b, t);
      }
      // one world-matrix walk per frame (the renderer would redo it for every pass: main + each shadow cascade)
      this.scene.updateMatrixWorld();
      this.post?.render();
      this.takeSnapshot();
    }
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps_ = 1 / Math.max(avg, 1e-4);
    this.governor(this.frameInterval, performance.now() - cpu0);
  }

  /** Region culling: the town's people and horses (1.3 km from the claim) and the homestead's animals and family
   *  are hidden and frozen (no matrix walks) when the camera is at the other end of the map. */
  private regionState = { town: true, home: true };
  private regionCull(): void {
    const c = this.camera.position;
    const town = Math.hypot(c.x - STREET.x, c.z - (STREET.z0 + STREET.z1) / 2) < 480;
    const home = Math.hypot(c.x - HOME.x, c.z - HOME.z) < 600;
    if (town !== this.regionState.town) {
      this.regionState.town = town;
      for (const g of [this.townCrowd.group, this.town?.group]) if (g) g.visible = g.matrixWorldAutoUpdate = town;
    }
    if (home !== this.regionState.home) {
      this.regionState.home = home;
      for (const g of [this.livestock.group, this.family.group, this.home.group]) g.visible = g.matrixWorldAutoUpdate = home;
    }
  }

  private lastStats = { drawCalls: 0, triangles: 0 };
  /** diagnostics: last frame's draw calls / triangles (all passes) and the pipeline + shader program caches */
  renderStats(): { drawCalls: number; triangles: number; pipelines: number; vertexPrograms: number; fragmentPrograms: number } {
    const pl = (this.renderer as unknown as { _pipelines: { caches: Map<string, unknown>; programs: { vertex: Map<string, unknown>; fragment: Map<string, unknown> } } })._pipelines;
    return { ...this.lastStats, pipelines: pl.caches.size, vertexPrograms: pl.programs.vertex.size, fragmentPrograms: pl.programs.fragment.size };
  }

  /** harness helper: resolves when every weather sky has streamed in */
  skiesAll(): Promise<void> {
    return this.env.skies.all;
  }

  /** test helper: wait n rendered frames */
  frames(n: number): Promise<void> {
    return new Promise((res) => {
      let i = 0;
      const tick = () => (++i >= n ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
  }
}
