import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, velocity, metalness, roughness, vec2, vec3, vec4, float, uniform, Fn, screenUV, mix, smoothstep,
  renderOutput, luminance, hash, packNormalToRGB, unpackRGBToNormal, sample, time, select, convertToTexture, screenSize, max, min,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { outline } from 'three/addons/tsl/display/OutlineNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export interface PostOptions {
  ao: boolean;
  ssr: boolean;
  taa: boolean;
  /** MSAA sample count for the scene pass when `taa` is off (default 4): crisp, stable edges with no history blur */
  msaa?: number;
  /** bloom (default true) */
  bloom?: boolean;
  /** subtle depth of field (focus/range/bokeh via uFocus, uFocusRange, uBokeh) */
  dof?: boolean;
  /** objects to outline (hover / selection); the array may be mutated later */
  outline?: THREE.Object3D[];
}

export class Post {
  pipeline: THREE.RenderPipeline;
  scenePass: N;
  uAO = uniform(1);
  uSSR = uniform(0);
  uVignette = uniform(0.3);
  uGrain = uniform(0.03);
  uWarm = uniform(0.55);
  uBloom = uniform(0.12);
  /** post-TRAA sharpening amount (0 off) */
  uSharpen = uniform(0.8);
  bloomNode: N = null;
  aoNode: N = null;
  outlineNode: N = null;
  taaNode: N = null;
  fxaaNode: N = null;
  uOutlinePulse = uniform(0);
  /** focus distance (m), distance over which things go fully soft (m), bokeh size */
  uFocus = uniform(25);
  uFocusRange = uniform(60);
  uBokeh = uniform(1.2);
  dofNode: N = null;
  ssrNode: N = null;

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, o: PostOptions) {
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false;
    // MSAA forward pass unless TRAA is requested; the MRT layout (output + normal) is the same for every quality so
    // switching levels never recompiles the scene's materials
    const sp = o.taa ? pass(scene, camera) : pass(scene, camera, { samples: o.msaa ?? 4 });
    this.scenePass = sp;
    // MRT only when an effect needs it (GTAO/SSR/TRAA, ultra): a colour target that some material doesn't write
    // makes its pipeline invalid and drops the whole command buffer
    const needMRT = o.ao || o.ssr || o.taa;
    const outs: Record<string, N> = { output };
    if (needMRT) outs.normal = packNormalToRGB(normalView);
    if (o.taa) outs.velocity = velocity;
    if (o.ssr) outs.metalrough = vec2(metalness, roughness);
    if (needMRT) {
      sp.setMRT(mrt(outs));
      sp.getTexture('normal').type = THREE.UnsignedByteType;
    }
    if (o.ssr) sp.getTexture('metalrough').type = THREE.UnsignedByteType;
    const color = sp.getTextureNode('output');
    const depth = sp.getTextureNode('depth');
    const nrmTex: N = needMRT ? sp.getTextureNode("normal") : null;
    const normalS: N = needMRT ? sample((uvn: N) => unpackRGBToNormal(nrmTex.sample(uvn))) : null;
    let hdr: N = color;
    if (o.ao) {
      const a = ao(depth, normalS, camera);
      a.resolutionScale = 0.5;
      a.radius.value = 1.2;
      a.thickness.value = 1.5;
      a.scale.value = 1.1;
      a.samples.value = 12;
      this.aoNode = a;
      const aoV = a.getTextureNode().sample(screenUV).r;
      hdr = hdr.mul(vec4(vec3(mix(float(1), aoV, this.uAO)), 1));
    }
    if (o.ssr) {
      const mr = sp.getTextureNode('metalrough');
      const s = ssr(color, depth, normalS, { metalnessNode: mr.r, roughnessNode: mr.g, reflectNonMetals: true, camera } as N);
      s.resolutionScale = 0.5;
      s.maxDistance.value = 60;
      s.thickness.value = 0.25;
      this.ssrNode = s;
      hdr = hdr.add(vec4(s.rgb.mul(this.uSSR), 0));
    }
    let aa: N = hdr;
    if (o.taa) {
      const t = traa(hdr, depth, sp.getTextureNode('velocity'), camera);
      t.useSubpixelCorrection = false;
      aa = t;
      this.taaNode = t;
    }
    if (o.taa) {
      // contrast-adaptive sharpen after the temporal resolve: TRAA's history blend softens fine detail (grass,
      // shingles, signs). Clamped to the 3x3-cross range so it never rings or halos.
      const src = convertToTexture(aa);
      const px = vec2(1).div(screenSize);
      aa = Fn(() => {
        const c = src.sample(screenUV);
        const n = src.sample(screenUV.add(vec2(0, px.y)));
        const so = src.sample(screenUV.sub(vec2(0, px.y)));
        const e = src.sample(screenUV.add(vec2(px.x, 0)));
        const w = src.sample(screenUV.sub(vec2(px.x, 0)));
        const lo = min(min(min(n.rgb, so.rgb), min(e.rgb, w.rgb)), c.rgb);
        const hi = max(max(max(n.rgb, so.rgb), max(e.rgb, w.rgb)), c.rgb);
        const blur = n.rgb.add(so.rgb).add(e.rgb).add(w.rgb).mul(0.25);
        const sharp = c.rgb.add(c.rgb.sub(blur).mul(this.uSharpen));
        return vec4(sharp.clamp(lo, hi), c.a);
      })();
    }
    if (o.dof) {
      const d = dof(aa, sp.getViewZNode(), this.uFocus, this.uFocusRange, this.uBokeh);
      this.dofNode = d;
      aa = d;
    }
    // sanitise before bloom: a single NaN/Inf or extreme specular pixel (grass blade at a grazing sun) blooms into a
    // bright "sun flare" dot; clamp to a sane HDR range
    const pre = aa;
    aa = Fn(() => {
      const c = vec4(pre).toVar();
      return vec4(c.rgb.clamp(0, 48), c.a);
    })();
    let withBloom: N = aa;
    if (o.bloom !== false) {
      this.bloomNode = bloom(aa, 0.5, 0.4, 1.4);
      withBloom = aa.add(this.bloomNode.mul(this.uBloom));
    }
    if (o.outline) {
      const ol = outline(scene, camera, { selectedObjects: o.outline, edgeThickness: float(1.5), edgeGlow: this.uOutlinePulse, downSampleRatio: 2 } as N);
      const { visibleEdge, hiddenEdge } = ol as N;
      const col = vec3(1.0, 0.78, 0.38);
      withBloom = withBloom.add(vec4(col.mul(visibleEdge.mul(2.2).add(hiddenEdge.mul(0.6))), 0));
      this.outlineNode = ol;
    }
    const mapped = renderOutput(withBloom);
    const graded = Fn(() => {
      const c = mapped.rgb.toVar();
      // storybook warmth: warm highlights, slightly cool shadows, gentle S-curve
      const l = luminance(c);
      const warm = c.mul(vec3(1.035, 1.0, 0.94));
      const cool = c.mul(vec3(0.965, 1.0, 1.045));
      c.assign(mix(c, mix(cool, warm, smoothstep(0.12, 0.7, l)), this.uWarm));
      c.assign(mix(c, c.mul(c).mul(float(3).sub(c.mul(2))), 0.18));
      const q = screenUV.sub(0.5).mul(vec2(1.6, 1));
      c.mulAssign(float(1).sub(this.uVignette.mul(smoothstep(0.38, 1.05, q.length()))));
      const g = hash(screenUV.mul(vec2(2731.3, 1913.7)).add(time.mul(17.13)).dot(vec2(1, 157))).sub(0.5);
      c.addAssign(g.mul(this.uGrain).mul(float(1).sub(l.mul(0.6))));
      return vec4(c, 1);
    })();
    this.pipeline.outputNode = graded;
    void fxaa;
    void select;
  }

  render(): void {
    this.pipeline.render();
  }
  dispose(): void {
    this.pipeline.dispose();
    this.aoNode?.dispose?.();
    this.ssrNode?.dispose?.();
    this.bloomNode?.dispose?.();
    this.outlineNode?.dispose?.();
    this.taaNode?.dispose?.();
    this.fxaaNode?.dispose?.();
    this.dofNode?.dispose?.();
    this.scenePass?.dispose?.();
  }
}
