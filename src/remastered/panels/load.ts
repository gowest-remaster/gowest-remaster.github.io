// Load: profiles on the left; that profile's autosave, three slots, quicksave and the rewind
// ring (the last 24 months as tear-off calendar pages) on the right.
import '../styles/flows.css';
import type { App } from '../core/app.ts';
import { h, put } from '../core/dom.ts';
import { GOAL_NAMES, money, MONTHS_CAPS, monthName } from '../core/format.ts';
import { registerPanel } from '../core/registry.ts';
import { rmSaves, type RmSave } from '../core/saves.ts';
import { rm } from '../core/settings.ts';
import type { Profile } from '../../engine/save.ts';
import { btn, confirm, sheetFrame, toast } from '../ui/kit.ts';
import { enterSave } from './title.ts';

const KIND_LABEL: Record<string, string> = { auto: 'Autosave', quick: 'Quicksave', slot: 'Slot', ring: 'Rewind' };

export function loadView(app: App, onClose: () => void) {
  const frame = sheetFrame({ title: 'Load a game', sub: 'Every month is saved for you. Pick a page to return to it.', icon: 'save', onClose });
  let profiles: Profile[] = [];
  let sel: Profile | null = null;

  const saveCard = (r: RmSave) => {
    const s = r.state;
    const b = h(
      'button',
      { type: 'button', class: 'save-card' },
      h('span', { class: 'sc-k' }, r.kind === 'slot' ? `Slot ${r.slot}` : KIND_LABEL[r.kind]),
      h('span', { class: 'sc-d' }, `${monthName(s.date.mon)} ${s.date.year}`),
      h('small', null, `${`${s.name.first} ${s.name.last}`.trim()} · ${GOAL_NAMES[s.begin.goal] ?? ''} · cash ${money(s.propet.cash)}`),
      h('small', null, `${r.edition.rules.mode === 'classic' ? 'Classic rules' : (s.extra as { frontier?: unknown }).frontier ? 'Frontier rules (retired: continues with the Remastered rules)' : 'Remastered rules'}${r.edition.look === 'classic' ? ' · Classic look' : ''}${s.devcut?.enabled ? ' · Developer’s Cut' : ''} · saved ${new Date(r.savedAt).toLocaleString()}`),
      s.extra.ended ? h('small', { class: 'bad' }, 'This story has ended') : null,
    );
    b.addEventListener('click', () => sel && void go(r));
    return b;
  };

  async function go(r: RmSave) {
    onClose();
    await enterSave(app, r, sel!);
  }

  async function renderProfile() {
    if (!sel) return put(frame.body, h('p', { class: 'empty' }, 'No homesteaders yet. Start a New Game from the title.'));
    const all = await rmSaves.list(sel.id);
    const main = all.filter((r) => r.kind !== 'ring');
    const ring = all.filter((r) => r.kind === 'ring').sort((a, b) => b.state.date.year * 12 + b.state.date.mon - (a.state.date.year * 12 + a.state.date.mon));
    const right = h(
      'div',
      { class: 'load-saves' },
      h('div', null, h('div', { class: 'eyebrow' }, 'Saves'), main.length ? h('div', { class: 'save-grid' }, ...main.map(saveCard)) : h('p', { class: 'empty' }, 'No saves for this homesteader yet.')),
      rm().assists.rewind && ring.length
        ? h(
            'div',
            null,
            h('div', { class: 'eyebrow' }, 'Rewind to an earlier month'),
            h(
              'div',
              { class: 'ring-pages' },
              ...ring.map((r) => {
                const p = h('button', { type: 'button', class: 'ring-page', title: `Rewind to ${monthName(r.state.date.mon)} ${r.state.date.year}` }, h('span', { class: 'rp-m' }, MONTHS_CAPS[r.state.date.mon - 1]), h('span', { class: 'rp-y' }, String(r.state.date.year)));
                p.addEventListener('click', async () => {
                  if (await confirm(`Rewind to ${monthName(r.state.date.mon)} ${r.state.date.year}?`, [h('p', null, 'Everything after that month will be undone. The weather and prices will be the same if you make the same choices.')], 'Rewind')) void go(r);
                });
                return p;
              }),
            ),
          )
        : null,
      h(
        'div',
        { class: 'row' },
        btn('Delete this homesteader', {
          kind: 'ghost',
          small: true,
          icon: 'close',
          onClick: async () => {
            if (!sel) return;
            if (!(await confirm(`Delete ${sel.name}?`, [h('p', null, 'All of this homesteader’s saves will be gone for good.')], 'Delete'))) return;
            await rmSaves.deleteProfile(sel.id);
            toast(`${sel.name} was deleted.`, { icon: 'close' });
            sel = null;
            await refresh();
          },
        }),
      ),
    );
    put(frame.body, h('div', { class: 'load-wrap' }, profileList(), right));
  }

  function profileList() {
    return h(
      'div',
      { class: 'load-profiles' },
      h('div', { class: 'eyebrow' }, 'Homesteaders'),
      ...profiles.map((p) => {
        const b = h('button', { type: 'button', class: `lp${sel?.id === p.id ? ' sel' : ''}` }, h('b', null, p.name, p.devcut ? ' ✦' : ''), h('small', null, `last played ${new Date(p.lastPlayed).toLocaleDateString()}`));
        b.addEventListener('click', () => {
          sel = p;
          void renderProfile();
        });
        return b;
      }),
    );
  }

  async function refresh() {
    profiles = await rmSaves.profiles();
    sel = sel ?? profiles[0] ?? null;
    await renderProfile();
  }
  void refresh();
  return { el: frame.el };
}

export function register(app: App) {
  registerPanel({ id: 'load', title: 'Load', kind: 'sheet', readOnly: true, size: 'lg', mount: () => loadView(app, () => app.closeSheet('load')) });
}
