// The Family Album as a scrapbook (§5.10): a leather album with two-page spreads. Pages 1–2
// are the original fixed entries; pages 3–50 are the family's diary (typing saves as you go,
// captions can be inserted or replace the text, photographs from the original album in mats).
// A Keepsakes section collects the family's real story by itself; Print uses the original
// print layout (name, game date, picture, the Library of Congress line).
import '../styles/books.css';
import { albumCaptions, albumMaxPictures, type GameState } from '../../sim/index.ts';
import { loadContent, type AlbumFile } from '../../content/content.ts';
import { rmArt } from '../core/art.ts';
import { h, icon, linesBlock, put } from '../core/dom.ts';
import { monthName } from '../core/format.ts';
import { ICONS, type IconName } from '../core/icons.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { audio, syncScene } from '../core/audio.ts';
import { letterText } from '../core/text.ts';
import type { Keepsake } from '../core/journal.ts';
import { btn, modal, segmented, sheetFrame, tabs, toast } from '../ui/kit.ts';
import type { PanelEnv } from './index.ts';

let album: AlbumFile | null = null;
const PICTURE_NAMES = ['', 'Harvest crew with a horse team', 'On the hay rake', 'The threshing wagon', 'Covered wagon and mules', 'Windmill and house in a dust storm', 'Steam engine threshing wheat', 'The hay loader', 'Main street with a buggy', 'A frame shack', 'The kitchen stove', 'Plowing with a team', 'Farmer with a white horse', 'The steam locomotive', 'A sod shanty', 'The sod house wall', 'House with a porch', 'The well'];

function captionText(id: string): string {
  if (!album) return id;
  const all = [...album.generalCaptions, ...album.datedCaptions];
  return all.find((c) => c.name === id)?.text ?? id;
}
function datedOf(id: string) {
  const d = album?.datedCaptions.find((c) => c.name === id);
  return d ? `${monthName(d.unlockMonth, 'short')} ${d.unlockYear}` : null;
}

const KS_ICON: Record<Keepsake['kind'], IconName> = { letter: 'letter', baby: 'baby', harvest: 'wheat', disaster: 'fire', built: 'hammer', business: 'street', paper: 'news', talk: 'talk', claim: 'sign', loan: 'bank', wedding: 'ring', milestone: 'heart' };

export function register({ app }: PanelEnv) {
  registerPanel({
    id: 'album',
    title: 'Family Album',
    kind: 'sheet',
    size: 'xl',
    available: (s) => (s.propet.house > 0 ? null : 'The album lives in the house. Your neighbors raise it when you first press Advance.'),
    mount(ctx) {
      let section: 'diary' | 'keepsakes' = (ctx.params.section as 'diary' | 'keepsakes') ?? 'diary';
      const s0 = session.s;
      let spread = Math.max(1, Number(ctx.params.page) || s0.album.curPage || 1);
      if (spread % 2 === 0) spread -= 1;
      const timers = new Map<number, number>();
      const tb = tabs({ tabs: [{ id: 'diary' as const, label: 'Diary' }, { id: 'keepsakes' as const, label: 'Keepsakes' }], value: section, onChange: (v) => ((section = v), render()) });
      const { el, body } = sheetFrame({ title: 'Family Album', icon: 'album', tabs: tb.el, onClose: () => app.closeSheet('album'), cls: 'album', foot: [] });
      const foot = el.querySelector('.sheet-foot') as HTMLElement;

      const pending = new Map<number, string>();
      const commit = (page: number) => {
        const text = pending.get(page);
        pending.delete(page);
        window.clearTimeout(timers.get(page));
        if (text !== undefined && session.state) session.run({ type: 'setAlbumPage', page, text }, 'Wrote in the album');
      };
      const saveText = (page: number, text: string) => {
        pending.set(page, text);
        window.clearTimeout(timers.get(page));
        timers.set(page, window.setTimeout(() => commit(page), 450));
      };
      const flush = () => {
        for (const p of [...pending.keys()]) commit(p);
      };

      async function chooseCaption(page: number, ta: HTMLTextAreaElement) {
        const s = session.s;
        const ids = albumCaptions(s);
        let mode: 'insert' | 'replace' = ta.value.trim() ? 'insert' : 'replace';
        let picked: string | null = null;
        const seg = segmented({ options: [{ value: 'insert' as const, label: 'Add to my page' }, { value: 'replace' as const, label: 'Replace my page' }], value: mode, onChange: (v) => (mode = v) });
        const list = h('div', { class: 'cap-list' }, ...ids.map((id) => {
          const b = h('button', { type: 'button', class: 'cap-item' }, datedOf(id) ? h('span', { class: 'pill brass' }, datedOf(id)!) : null, h('span', { class: 'verbatim' }, captionText(id)));
          b.addEventListener('click', () => {
            list.querySelectorAll('.cap-item.on').forEach((x) => x.classList.remove('on'));
            b.classList.add('on');
            picked = id;
          });
          return b;
        }));
        const ok = await modal<boolean>({ title: 'Choose a caption', cls: 'wide', body: [h('p', { class: 'small muted' }, 'Captions from the original album. New ones appear as history happens.'), seg.el, list], actions: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Use this caption', value: true, kind: 'go', disabled: () => null }], dismiss: false });
        if (!ok || !picked) return;
        const t = captionText(picked);
        ta.value = mode === 'insert' && ta.value.trim() ? `${ta.value.trimEnd()}\n\n${t}` : t;
        flush();
        session.run({ type: 'setAlbumPage', page, text: ta.value }, 'Added a caption to the album');
      }

      async function choosePicture(page: number) {
        const s = session.s;
        const max = albumMaxPictures(s);
        let picked = s.album.pictures[page - 1] ?? 0;
        const grid = h('div', { class: 'pic-grid' },
          ...Array.from({ length: max + 1 }, (_, n) => {
            const src = n ? rmArt(`album/${n}`) : null;
            const b = h('button', { type: 'button', class: `pic-opt${n === picked ? ' on' : ''}`, title: n ? PICTURE_NAMES[n] : 'No picture' }, src ? h('img', { src, alt: PICTURE_NAMES[n] }) : h('span', { class: 'small muted' }, 'No picture'));
            b.addEventListener('click', () => {
              grid.querySelectorAll('.pic-opt.on').forEach((x) => x.classList.remove('on'));
              b.classList.add('on');
              picked = n;
            });
            return b;
          }));
        const ok = await modal<boolean>({ title: 'Choose a photograph', cls: 'wide', body: [grid, max < 17 ? h('p', { class: 'small muted' }, 'A Kodak camera from the General Store adds 12 more photographs.') : null], actions: [{ label: 'Cancel', value: false, kind: 'ghost' }, { label: 'Paste it in', value: true, kind: 'go' }], dismiss: false });
        if (ok) {
          session.run({ type: 'setAlbumPage', page, picture: picked }, 'Changed an album photograph');
          render();
        }
      }

      function enlarge(n: number) {
        const src = rmArt(`album/${n}`);
        if (src) void modal({ title: PICTURE_NAMES[n], cls: 'wide photo-modal', body: [h('img', { src, alt: PICTURE_NAMES[n], class: 'photo-big' })], actions: [{ label: 'Close', value: true, kind: 'ghost' }], dismiss: true });
      }

      function photo(page: number, n: number, editable: boolean) {
        const src = n ? rmArt(`album/${n}`) : null;
        const frame = h('div', { class: `photo${src ? '' : ' empty-photo'}` },
          h('i', { class: 'corner tl' }), h('i', { class: 'corner tr' }), h('i', { class: 'corner bl' }), h('i', { class: 'corner br' }),
          src ? h('img', { src, alt: PICTURE_NAMES[n] }) : h('span', null, editable ? 'Paste a photograph' : ''));
        frame.addEventListener('click', () => (src && !editable ? enlarge(n) : editable ? void choosePicture(page) : undefined));
        return h('div', { class: 'photo-wrap' }, frame, editable ? h('div', { class: 'row center' }, btn(src ? 'Change photo' : 'Add a photo', { kind: 'link', small: true, icon: 'album', onClick: () => void choosePicture(page) }), src ? btn('Enlarge', { kind: 'link', small: true, onClick: () => enlarge(n) }) : null) : null);
      }

      function pageEl(s: GameState, page: number) {
        if (page > 50) return h('div', { class: 'apage blank' });
        const pic = s.album.pictures[page - 1] ?? 0;
        if (page <= 2) {
          const t = page === 1 ? album?.page1.text : album?.page2.text;
          return h('div', { class: 'apage fixed' }, h('div', { class: 'pg-no' }, String(page)), photo(page, pic || (page === 1 ? 8 : 4), false), t ? linesBlock(t, 'lines diary-fixed verbatim') : null);
        }
        const ta = h('textarea', { class: 'diary', rows: 9, placeholder: 'Write about your family’s days…', 'aria-label': `Album page ${page}` }) as HTMLTextAreaElement;
        ta.value = pending.get(page) ?? s.album.texts[page - 1] ?? '';
        if (session.blocked) {
          // the sim takes no album writes while a letter waits: say so instead of losing the words
          ta.readOnly = true;
          ta.placeholder = 'A letter is waiting for your answer. Answer it, then write here.';
        }
        ta.addEventListener('input', () => saveText(page, ta.value));
        return h('div', { class: 'apage' }, h('div', { class: 'pg-no' }, String(page)), photo(page, pic, true), ta, btn('Choose a caption', { kind: 'link', small: true, icon: 'book', onClick: () => void chooseCaption(page, ta) }));
      }

      function diary() {
        const s = session.s;
        put(body, h('div', { class: 'album-book' }, pageEl(s, spread), h('div', { class: 'spine' }), pageEl(s, spread + 1)));
        const prev = btn('Previous pages', { kind: 'ghost', small: true, icon: 'back', disabled: spread <= 1 ? 'This is the first page.' : false, onClick: () => { flush(); spread -= 2; render(); } });
        const next = btn('Next pages', { kind: 'ghost', small: true, disabled: spread >= 49 ? 'This is the last page.' : false, onClick: () => { flush(); spread += 2; render(); } });
        const pick = h('select', { 'aria-label': 'Go to page', class: 'np-pick' }, ...Array.from({ length: 25 }, (_, i) => h('option', { value: String(i * 2 + 1), selected: i * 2 + 1 === spread }, `Pages ${i * 2 + 1}–${i * 2 + 2}${(s.album.texts[i * 2] || s.album.texts[i * 2 + 1]) && i ? ' ✎' : ''}`))) as HTMLSelectElement;
        pick.addEventListener('change', () => { flush(); spread = Number(pick.value); render(); });
        put(foot, prev, pick, next, h('span', { class: 'grow' }), btn('Print the album', { kind: 'ghost', small: true, icon: 'print', onClick: () => printAlbum() }));
      }

      function keepsakes() {
        const ks = [...session.journal.keepsakes];
        put(foot, h('span', { class: 'small muted' }, 'Keepsakes are gathered by themselves as your family’s story unfolds.'));
        if (!ks.length) return void put(body, h('div', { class: 'empty' }, 'Letters, births, harvests and milestones will be kept here.'));
        const byYear = new Map<number, Keepsake[]>();
        for (const k of ks) byYear.set(k.year, [...(byYear.get(k.year) ?? []), k]);
        put(body, h('div', { class: 'keepsakes' }, ...[...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([y, list]) =>
          h('section', { class: 'ks-year' }, h('h3', { class: 'ks-y' }, String(y)), h('div', { class: 'ks-grid' }, ...list.map((k) => {
            const card = h('div', { class: `ks ks-${k.kind}` }, icon(ICONS[k.kind === 'disaster' ? (/fire/i.test(k.title) ? 'fire' : /hopper/i.test(k.title) ? 'leaf' : /cattle/i.test(k.title) ? 'pen' : /winter/i.test(k.title) ? 'snow' : 'warn') : KS_ICON[k.kind] ?? 'star'], 'ico ks-ico'), h('div', null, h('div', { class: 'ks-t' }, k.kind === 'letter' ? 'A letter' : k.title), h('div', { class: 'small muted' }, `${monthName(k.mon)} ${k.year}${k.detail && k.kind !== 'letter' ? ` · ${k.detail}` : ''}`)));
            if (k.kind === 'letter' && k.ref) {
              const lt = letterText(session.s, k.ref, true);
              card.append(h('div', { class: 'ks-ex verbatim small' }, lt.text.split('\n').find((l) => l.trim() && !/^dear/i.test(l.trim()))?.slice(0, 90) ?? ''));
              card.classList.add('clickable');
              card.addEventListener('click', () => void modal({ title: `${monthName(k.mon)} ${k.year}`, cls: 'wide', body: [linesBlock(lt.text, 'lines verbatim letter-text')], actions: [{ label: 'Fold it away', value: true, kind: 'ghost' }], dismiss: true }));
            }
            return card;
          }))))));
      }

      function printAlbum() {
        const s = session.s;
        const pages = Array.from({ length: 50 }, (_, i) => i + 1).filter((p) => p <= 2 || s.album.texts[p - 1]?.trim() || s.album.pictures[p - 1]);
        const dateStr = `${monthName(s.date.mon).slice(0, 3)}. ${s.date.day}, ${s.date.year}`;
        const root = h('div', { class: 'album-print' }, ...pages.map((p) => {
          const pic = s.album.pictures[p - 1] || (p === 1 ? 8 : p === 2 ? 4 : 0);
          const src = pic ? rmArt(`album/${pic}`) : null;
          const text = p === 1 ? album?.page1.text ?? '' : p === 2 ? album?.page2.text ?? '' : s.album.texts[p - 1] ?? '';
          return h('section', { class: 'ap-page' }, h('div', { class: 'ap-left' }, h('div', null, h('b', null, 'Name : '), `${s.name.first} ${s.name.last}`), h('div', null, h('b', null, 'Date : '), dateStr), src ? h('img', { src, alt: '' }) : null, h('div', { class: 'ap-loc' }, 'All rights reserved to the Library of Congress.')), h('div', { class: 'ap-right' }, linesBlock(text, 'lines')));
        }));
        document.body.append(root);
        document.documentElement.classList.add('printing-album');
        const done = () => {
          root.remove();
          document.documentElement.classList.remove('printing-album');
          window.removeEventListener('afterprint', done);
        };
        window.addEventListener('afterprint', done);
        window.print();
        window.setTimeout(done, 1500);
        toast(`Printing ${pages.length} pages.`, { icon: 'print' });
      }

      function render() {
        if (!album) {
          put(body, h('div', { class: 'empty' }, 'Opening the album…'));
          void loadContent('album.json').then((a) => ((album = a), render()));
          return;
        }
        if (section === 'diary') diary();
        else keepsakes();
      }
      render();
      syncScene('album', session.s);
      audio.sfx('paper');
      let wasBlocked = session.blocked;
      return { el, update: () => { if (session.blocked !== wasBlocked) { wasBlocked = session.blocked; render(); } }, destroy: () => { flush(); syncScene(app.placeId, session.state); }, crumb: () => (section === 'diary' ? `Pages ${spread}–${spread + 1}` : 'Keepsakes') };
    },
  });
}
