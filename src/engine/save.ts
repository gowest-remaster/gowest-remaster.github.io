// IndexedDB persistence: player profiles (like the original's user IDs) and one bookmark per
// profile. Saves are JSON-cloneable GameState snapshots plus presentation metadata.
import type { FidelityOptions, GameState } from '../sim/index.ts';

export type Look = 'remastered' | 'classic';
export type EditionId = 'remastered' | 'classic' | 'custom';

/** What New Game locked in (rules) plus the switchable look. */
export interface EditionInfo {
  edition: EditionId;
  rules: FidelityOptions;
  look: Look;
}

export interface Profile {
  id: string;
  name: string;
  created: number;
  lastPlayed: number;
  /** Developer's Cut unlocked (Alt/Option-click on the title). Content comes later. */
  devcut: boolean;
}

export interface SaveRecord {
  profileId: string;
  savedAt: number;
  edition: EditionInfo;
  scene: string;
  state: GameState;
}

const DB_NAME = 'gowest';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('profiles')) d.createObjectStore('profiles', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('saves')) d.createObjectStore('saves', { keyPath: 'profileId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx<T>(store: 'profiles' | 'saves', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const saves = {
  async listProfiles(): Promise<Profile[]> {
    const all = await tx<Profile[]>('profiles', 'readonly', (s) => s.getAll() as IDBRequest<Profile[]>);
    return all.sort((a, b) => b.lastPlayed - a.lastPlayed);
  },
  async getProfile(id: string): Promise<Profile | undefined> {
    return tx<Profile | undefined>('profiles', 'readonly', (s) => s.get(id) as IDBRequest<Profile | undefined>);
  },
  async putProfile(p: Profile) {
    await tx('profiles', 'readwrite', (s) => s.put(p));
  },
  async createProfile(name: string, devcut = false): Promise<Profile> {
    const p: Profile = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, created: Date.now(), lastPlayed: Date.now(), devcut };
    await this.putProfile(p);
    return p;
  },
  async deleteProfile(id: string) {
    await tx('profiles', 'readwrite', (s) => s.delete(id));
    await tx('saves', 'readwrite', (s) => s.delete(id));
  },
  async load(profileId: string): Promise<SaveRecord | undefined> {
    return tx<SaveRecord | undefined>('saves', 'readonly', (s) => s.get(profileId) as IDBRequest<SaveRecord | undefined>);
  },
  async write(rec: SaveRecord) {
    await tx('saves', 'readwrite', (s) => s.put(rec));
  },
  async clear(profileId: string) {
    await tx('saves', 'readwrite', (s) => s.delete(profileId));
  },
};
