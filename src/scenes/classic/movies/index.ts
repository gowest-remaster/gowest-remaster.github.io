// Movie registry: each original movie's port, loaded on demand (one chunk per movie).
import type { MovieFactory, MovieName } from '../context.ts';

const LOADERS: Record<MovieName, () => Promise<MovieFactory>> = {
  LOGIN: () => import('./login.ts').then((m) => m.default),
  OPEN: () => import('./open.ts').then((m) => m.default),
  INTRO: () => import('./intro.ts').then((m) => m.default),
  CALEND: () => import('./calend.ts').then((m) => m.default),
  FIELD: () => import('./field.ts').then((m) => m.default),
  TSTREET1: () => import('./tstreet1.ts').then((m) => m.default),
  STORE: () => import('./store.ts').then((m) => m.default),
  BANK09: () => import('./bank09.ts').then((m) => m.default),
  TTALK: () => import('./ttalk.ts').then((m) => m.default),
  HOUSE1: () => import('./house.ts').then((m) => m.house1),
  HOUSE2: () => import('./house.ts').then((m) => m.house2),
  HOUSE3: () => import('./house.ts').then((m) => m.house3),
  BHOUSE1: () => import('./house.ts').then((m) => m.bhouse1),
  ALBUM: () => import('./album.ts').then((m) => m.default),
  NEWS: () => import('./news.ts').then((m) => m.default),
};

export function loadMovieFactory(name: MovieName): Promise<MovieFactory> {
  return LOADERS[name]();
}
