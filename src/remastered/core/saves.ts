// Remastered saves: one autosave per profile (shared with the Classic app through
// engine/save.ts, so switching look reloads the same game), 3 manual slots, a quicksave,
// and a rewind ring of the last 24 monthly autosaves. Stored in IndexedDB.
import type { GameState } from '../../sim/index.ts';
import { saves as sharedSaves, type EditionInfo, type Profile } from '../../engine/save.ts';
import type { Journal } from './journal.ts';

export type SaveKind = 'auto' | 'slot' | 'quick' | 'ring';

export interface RmSave {
  id: string;
  profileId: string;
  kind: SaveKind;
  slot: number;
  savedAt: number;
  edition: EditionInfo;
  place: string;
  state: GameState;
  journal: Journal;
  label: string;
}

const DB = 'gowest-remastered';
let dbp: Promise<IDBDatabase> | null = null;
function db() {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('records')) {
          const st = d.createObjectStore('records', { keyPath: 'id' });
          st.createIndex('profile', 'profileId');
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  return dbp;
}

async function req<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('records', mode);
    const q = fn(t.objectStore('records'));
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

const RING = 24;
const idOf = (pid: string, kind: SaveKind, slot = 0) => `${pid}|${kind}|${slot}`;

export const rmSaves = {
  profiles: () => sharedSaves.listProfiles(),
  createProfile: (name: string, devcut = false) => sharedSaves.createProfile(name, devcut),
  putProfile: (p: Profile) => sharedSaves.putProfile(p),
  deleteProfile: async (id: string) => {
    await sharedSaves.deleteProfile(id);
    const all = await rmSaves.list(id);
    for (const r of all) await req('readwrite', (s) => s.delete(r.id));
  },

  async list(profileId: string): Promise<RmSave[]> {
    const all = await req<RmSave[]>('readonly', (s) => s.index('profile').getAll(profileId) as IDBRequest<RmSave[]>);
    return all.sort((a, b) => b.savedAt - a.savedAt);
  },

  async get(profileId: string, kind: SaveKind, slot = 0): Promise<RmSave | undefined> {
    return req<RmSave | undefined>('readonly', (s) => s.get(idOf(profileId, kind, slot)) as IDBRequest<RmSave | undefined>);
  },

  async latest(profileId: string): Promise<RmSave | undefined> {
    const all = await rmSaves.list(profileId);
    const auto = all.find((r) => r.kind === 'auto');
    // A classic-look session may have written a newer shared save.
    const shared = await sharedSaves.load(profileId);
    if (shared && (!auto || shared.savedAt > auto.savedAt + 1000)) {
      return { id: idOf(profileId, 'auto'), profileId, kind: 'auto', slot: 0, savedAt: shared.savedAt, edition: shared.edition, place: 'homestead', state: shared.state, journal: auto?.journal ?? emptyJournalLike(), label: 'Autosave' };
    }
    return auto ?? all[0];
  },

  async write(rec: Omit<RmSave, 'id'>) {
    const full: RmSave = { ...rec, id: idOf(rec.profileId, rec.kind, rec.slot) };
    await req('readwrite', (s) => s.put(full));
    if (rec.kind === 'auto') {
      await sharedSaves.write({ profileId: rec.profileId, savedAt: rec.savedAt, edition: rec.edition, scene: 'board', state: rec.state });
    }
    return full;
  },

  /** Push a monthly rewind point (keeps the last 24). */
  async pushRing(rec: Omit<RmSave, 'id' | 'kind' | 'slot'>) {
    const ring = (await rmSaves.list(rec.profileId)).filter((r) => r.kind === 'ring');
    const used = new Set(ring.map((r) => r.slot));
    let slot = 0;
    while (used.has(slot) && slot < RING) slot++;
    if (slot >= RING) slot = ring.sort((a, b) => a.savedAt - b.savedAt)[0].slot;
    await rmSaves.write({ ...rec, kind: 'ring', slot });
  },

  async remove(id: string) {
    await req('readwrite', (s) => s.delete(id));
  },

  async clearGame(profileId: string) {
    const all = await rmSaves.list(profileId);
    for (const r of all) if (r.kind !== 'slot') await req('readwrite', (s) => s.delete(r.id));
    await sharedSaves.clear(profileId);
  },
};

function emptyJournalLike(): Journal {
  return { v: 1, farm: [], snapshots: [], standing: [], upkeep: [], talks: [], papers: [], summaries: [], keepsakes: [], notes: {}, years: [], lore: [], seenFirst: [], bookmarks: [] };
}
