// HOUSE1 (sod house), HOUSE2 (furnished sod house), HOUSE3 (wooden house) and BHOUSE1 (an
// unused older copy of HOUSE1 that nothing jumps to; kept playable as HOUSE1). The logic is the
// SHARED house scripts (shared/house.ts); the movies differ only in art and sprite layout.
import type { MovieFactory } from '../context.ts';
import { makeHouse } from '../shared/house.ts';

export const house1: MovieFactory = (c) => makeHouse(c, 1, 'HOUSE1');
export const house2: MovieFactory = (c) => makeHouse(c, 2, 'HOUSE2');
export const house3: MovieFactory = (c) => makeHouse(c, 3, 'HOUSE3');
export const bhouse1: MovieFactory = (c) => makeHouse(c, 1, 'BHOUSE1');
