import { defineConfig, type Plugin } from 'vite';
import { resolve, relative } from 'node:path';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';

/** Build output = what ships: drop the public/ files the release export excludes (tools/release/public-exclude.txt,
 *  rsync patterns anchored at public/), so preview builds measure and serve the real download. */
function shipPrune(): Plugin {
  let outDir = '';
  return {
    name: 'ship-prune',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      const list = resolve(import.meta.dirname, '../tools/release/public-exclude.txt');
      if (!existsSync(list)) return;
      const rx = readFileSync(list, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((p) => {
          const dir = p.endsWith('/');
          const body = p.replace(/^\//, '').replace(/\/$/, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
          return new RegExp((p.startsWith('/') ? '^' : '(^|/)') + body + (dir ? '/' : '(/|$)'));
        });
      const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(resolve(d, n)).isDirectory() ? walk(resolve(d, n)) : [resolve(d, n)]));
      for (const f of walk(outDir)) {
        const rel = relative(outDir, f);
        if (rel.startsWith('assets/') && /\.(js|css|wasm)$/.test(rel)) continue; // bundler output, not public/
        if (rx.some((r) => r.test(rel))) rmSync(f);
      }
    },
  };
}

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/: BASE_PATH=/go-west/ bun run build
  base: process.env.BASE_PATH || '/',
  plugins: [shipPrune()],
  // One three.js instance: addons import 'three', the world imports 'three/webgpu' (a superset build that
  // includes the core). Map the bare specifier to the WebGPU build, as three's own WebGPU examples do.
  resolve: {
    alias: [{ find: /^three$/, replacement: 'three/webgpu' }],
    dedupe: ['three'],
  },
  // pre-bundle the 3D world's deps so the dev server never full-reloads mid-session to optimize one
  optimizeDeps: {
    include: [
      'three/webgpu',
      'three/tsl',
      'three/addons/csm/CSMShadowNode.js',
      'three/addons/controls/OrbitControls.js',
      'three/addons/loaders/DRACOLoader.js',
      'three/addons/loaders/KTX2Loader.js',
      'three/addons/libs/meshopt_decoder.module.js',
      'three/addons/utils/SkeletonUtils.js',
      'three/addons/loaders/GLTFLoader.js',
      'three/addons/loaders/HDRLoader.js',
      'three/addons/tsl/display/BloomNode.js',
      'three/addons/tsl/display/FXAANode.js',
      'three/addons/tsl/display/GTAONode.js',
      'three/addons/tsl/display/OutlineNode.js',
      'three/addons/tsl/display/SSRNode.js',
      'three/addons/tsl/display/TRAANode.js',
      'three/addons/utils/BufferGeometryUtils.js',
    ],
  },
  build: {
    // Both apps load lazily from main.ts (Classic: PixiJS + Howler; Remastered: the HTML overlay, with the
    // audio.html are dev pages (the release export builds index.html only).
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html') },
    },
  },
});
