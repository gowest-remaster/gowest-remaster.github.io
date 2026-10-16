// Picks the 3D world: the real three.js world (src/world/index.ts, createWorld) when it exists
// and starts, else the DOM placeholder. `?world=stub` forces the placeholder (tests, old GPUs).
import type { World3D } from '../../world/api.ts';
import { createStubWorld } from '../world-stub.ts';

const mods = import.meta.glob('../../world/index.ts');

export let worldKind: 'real' | 'stub' = 'stub';

export async function createWorld(host: HTMLElement): Promise<World3D> {
  const forceStub = new URLSearchParams(location.search).get('world') === 'stub';
  const load = Object.values(mods)[0];
  if (load && !forceStub) {
    try {
      const mod = (await load()) as { createWorld?: (opts?: unknown) => World3D | Promise<World3D>; default?: unknown };
      if (typeof mod.createWorld === 'function') {
        const w = await mod.createWorld();
        await w.mount(host);
        worldKind = 'real';
        return w;
      }
    } catch (e) {
      console.warn('3D world failed to start; using the painted placeholder', e);
      host.replaceChildren();
    }
  }
  const w = createStubWorld();
  await w.mount(host);
  worldKind = 'stub';
  return w;
}
