// Public entry of the real-time 3D world (see api.ts for the contract).
import type { World3D } from './api';
import { WorldImpl } from './world';

export type * from './api';
export { worldViewFromGame } from './fromGame';
export { DEFAULT_VIEW } from './world';

export function createWorld(opts: { forceWebGL?: boolean } = {}): World3D {
  const w = new WorldImpl();
  w.debug.forceWebGL = !!opts.forceWebGL;
  return w;
}
