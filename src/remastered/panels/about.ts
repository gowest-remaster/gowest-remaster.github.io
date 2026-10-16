// "About this remaster" (sheet, also embedded on the title): what's new, every original bug
// the Remastered rules fix (from src/sim/BUGFIXES.md when present, else the fidelity
// registry), the original credits, and asset/font credits.
import { session } from '../core/session.ts';
import { reproduces } from '../../sim/index.ts';
import '../styles/flows.css';
import '../styles/books.css';
import type { App } from '../core/app.ts';
import { h, put } from '../core/dom.ts';
import { registerPanel } from '../core/registry.ts';
import { QUIRKS, type Quirk } from '../../sim/index.ts';
import { loadContent } from '../../content/content.ts';
import { areaOf, AREAS } from '../../game/rules-info.ts';
import { sheetFrame, tabs } from '../ui/kit.ts';

type Tab = 'new' | 'fixes' | 'credits';
const bugfixMd = import.meta.glob('../../sim/BUGFIXES.md', { query: '?raw', import: 'default' });

const WHATS_NEW: [string, string][] = [
  ['A living homestead', 'The farm and Longview are a real-time 3D world that changes with the seasons and grows over forty years.'],
  ['Always know what to do next', 'A hotbar that never hides, live badges, a Today card and the Almanac show what’s coming and what each choice costs.'],
  ['Time as fast as you like', 'Advance runs to the next stop at your speed and pauses itself when a letter, deadline or disaster needs you.'],
  ['Every choice previewed', 'Field jobs show days, wages and finish dates; letters show their effect on money, standing and upkeep before you answer.'],
  ['No more typing arithmetic', 'Seeds come in sacks that fit a square, a cart with “fetch from the box”, and a loan visualizer that shows what you’ll owe.'],
  ['History you can touch', 'Letters with their letterheads, a typeset Longview Gazette, subtitled town talk with replay, and a family album.'],
  ['Kind to every player', 'Text size, dyslexia-friendly type, colorblind palettes, captions for every voice, full keyboard play, Undo and Rewind.'],
  ['Faithful underneath', 'Every rule, letter, newspaper and voice is the original. Fixes to the 1996 bugs are listed under “What we fixed”.'],
];

async function fixesNode(): Promise<HTMLElement> {
  const load = Object.values(bugfixMd)[0];
  if (load) {
    try {
      const md = (await load()) as string;
      return mdNode(md);
    } catch {
      /* fall through */
    }
  }
  const byArea = new Map<string, Quirk[]>();
  for (const [id, q] of Object.entries(QUIRKS) as [string, Quirk][]) {
    const a = areaOf(id as never);
    if (!byArea.has(a)) byArea.set(a, []);
    byArea.get(a)!.push(q);
  }
  const wrap = h('div', { class: 'stack' }, h('p', { class: 'muted', style: 'margin:0' }, 'The original game had some bugs. Remastered rules fix them; Classic rules keep them exactly as they were in 1996. A few are kept on purpose (marked “kept”).'));
  for (const area of AREAS) {
    const list = byArea.get(area);
    if (!list?.length) continue;
    wrap.append(
      h('h3', { style: 'font-family:var(--display);font-weight:400;margin:.6rem 0 .2rem' }, area),
      h('div', { class: 'fix-list' }, ...list.map((q) => h('div', { class: `fix${q.remasteredKeeps ? ' kept' : ''}` }, h('div', { class: 'fix-h' }, q.description, q.remasteredKeeps ? h('span', { class: 'pill brass', style: 'margin-left:.4rem' }, 'kept') : null), h('div', null, `Now: ${q.remastered}`), h('div', { class: 'fix-o' }, `1996: ${q.classic}`)))),
    );
  }
  return wrap;
}

/** Tiny Markdown renderer for headings, lists and paragraphs (BUGFIXES.md). */
function mdNode(md: string): HTMLElement {
  const root = h('div', { class: 'about-md' });
  let list: HTMLElement | null = null;
  const inline = (t: string) => {
    const span = h('span');
    span.innerHTML = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\*(.+?)\*/g, '<i>$1</i>');
    return span;
  };
  for (const raw of md.split('\n')) {
    const l = raw.trimEnd();
    const hm = l.match(/^(#{1,4})\s+(.*)/);
    if (hm) {
      list = null;
      root.append(h(hm[1].length <= 2 ? 'h2' : 'h3', null, inline(hm[2])));
    } else if (/^\s*[-*]\s+/.test(l)) {
      if (!list) root.append((list = h('ul')));
      list.append(h('li', null, inline(l.replace(/^\s*[-*]\s+/, ''))));
    } else if (l.trim()) {
      list = null;
      root.append(h('p', null, inline(l)));
    } else list = null;
  }
  return root;
}

export function aboutSheet(onClose: () => void) {
  let tab: Tab = 'new';
  const t = tabs<Tab>({ tabs: [{ id: 'new', label: 'What’s new' }, { id: 'fixes', label: 'What we fixed' }, { id: 'credits', label: 'Credits' }], value: tab, onChange: (v) => ((tab = v), void render()) });
  const frame = sheetFrame({ title: 'About this remaster', sub: 'Go West! The Homesteader’s Challenge (1996), remade with love.', icon: 'book', onClose, tabs: t.el });
  async function render() {
    if (tab === 'new') {
      put(frame.body, h('div', { class: 'about-cols' }, ...WHATS_NEW.map(([a, b]) => h('div', null, h('h3', null, a), h('p', { style: 'margin:0' }, b)))));
    } else if (tab === 'fixes') {
      put(frame.body, h('p', { class: 'empty' }, 'Opening the ledger of fixes…'));
      const n = await fixesNode();
      if (tab === 'fixes') put(frame.body, n);
    } else {
      put(frame.body, h('p', { class: 'empty' }, 'Unrolling the credits…'));
      let orig = '';
      try {
        const c = await loadContent('credits.json');
        // CREDITS (ui quirk): the 1996 scroller stopped at line 105 of 124.
        const st = session.state;
        const cut = !!st && reproduces(st.fidelity, 'CREDITS');
        orig = (c.lines?.length ? (cut ? c.lines.slice(0, 105) : c.lines).join('\n') : c.text).replace(/^\s+/, '').replace(/\n{3,}/g, '\n\n');
      } catch {
        orig = '';
      }
      const assets = await assetCredits();
      if (tab !== 'credits') return;
      put(
        frame.body,
        h(
          'div',
          { class: 'about-cols' },
          h('div', null, h('h3', null, 'The original, 1996'), h('div', { class: 'credits-roll verbatim' }, orig || 'Edunetics, 1996.')),
          h(
            'div',
            null,
            h('h3', null, 'This remaster'),
            h('p', null, 'Rules decompiled from the original Lingo and kept faithful; every letter, newspaper, town talk and voice is the original.'),
            h('h3', null, 'Fonts'),
            h('p', null, 'Libre Caslon Display & Text (Pablo Impallari), IM Fell English SC (Igino Marini), Pinyon Script, Atkinson Hyperlegible (Braille Institute) — SIL Open Font License, bundled for offline play.'),
            h('h3', null, 'Textures, skies and props'),
            h('p', null, 'Poly Haven (polyhaven.com), CC0 public domain.'),
            h('h3', null, 'Photographs'),
            h('p', null, 'The album photographs and intro engravings are the original game’s, from the Library of Congress collections.'),
            h('h3', null, 'Music'),
            h('p', null, 'The theme is the original 1996 “GANCOUA” by Ganelin, newly arranged. The music is rendered with the GeneralUser GS v2.0.3 SoundFont by S. Christian Collins, whose license allows use “without restriction for your own music creation, private or commercial”.'),
          ),
        ),
        assets,
      );
    }
  }
  void render();
  return { el: frame.el };
}

interface CreditEntry {
  title?: string;
  author?: string;
  license?: string;
  url?: string;
  credit?: string;
}
const CMU_LINE = 'The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.';
const SECTION_NAME: Record<string, string> = { life: 'People and animals', town: 'Longview and the farm', nature: 'Nature', farm: 'The farm' };

/** 3D asset credits, read from public/world/ATTRIBUTION.json (kept by the asset pipeline). */
async function assetCredits(): Promise<HTMLElement> {
  let data: Record<string, unknown> = {};
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}world/ATTRIBUTION.json`, { cache: 'no-cache' });
    if (r.ok) data = await r.json();
  } catch {
    data = {};
  }
  const sections = Object.entries(data).filter(([, v]) => Array.isArray(v)) as [string, CreditEntry[]][];
  const all = sections.flatMap(([, v]) => v);
  const hasCmu = all.some((e) => /cmu/i.test(`${e.url ?? ''} ${e.title ?? ''}`));
  const row = (e: CreditEntry) =>
    h('li', null,
      h('b', null, e.title ?? 'Untitled'),
      e.author ? ` by ${e.author}` : '',
      e.license ? h('span', { class: 'pill brass', style: 'margin-left:.4rem' }, e.license) : null,
      e.url ? h('div', { class: 'tiny' }, h('a', { href: e.url, target: '_blank', rel: 'noopener' }, e.url)) : null,
      e.credit ? h('div', { class: 'small muted' }, e.credit) : null);
  return h('section', { class: 'asset-credits' },
    h('h3', null, '3D asset credits'),
    h('p', { class: 'small muted' }, 'Models used under Creative Commons Attribution and similar licenses. Thank you to their makers.'),
    sections.length
      ? h('div', { class: 'asset-credit-cols' }, ...sections.map(([k, list]) => h('div', null, h('h4', null, SECTION_NAME[k] ?? k[0].toUpperCase() + k.slice(1)), h('ul', { class: 'asset-credit-list' }, ...list.map(row)))))
      : h('p', { class: 'small muted' }, 'The asset list could not be loaded.'),
    hasCmu ? null : h('p', { class: 'small' }, h('b', null, 'Motion: '), CMU_LINE));
}

export function register(app: App) {
  registerPanel({ id: 'about', title: 'About this remaster', kind: 'sheet', readOnly: true, size: 'lg', mount: () => aboutSheet(() => app.closeSheet('about')) });
}
