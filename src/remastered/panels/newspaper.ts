// The Longview Gazette (§5.11): every issue reached, typeset as a broadsheet with the
// verbatim transcriptions ("Read clearly"), or the original printed page and article art.
import '../styles/books.css';
import { newspaperIssues, type GameState } from '../../sim/index.ts';
import { loadContent, type NewsArticle, type NewsFile, type NewsIssue } from '../../content/content.ts';
import { rmArt } from '../core/art.ts';
import { h, prose, put } from '../core/dom.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { audio } from '../core/audio.ts';
import { btn, segmented, sheetFrame } from '../ui/kit.ts';
import type { PanelEnv } from './index.ts';

let news: NewsFile | null = null;
const loadNews = async () => (news ??= await loadContent('news.json'));

function article(iss: NewsIssue, a: NewsArticle, lead: boolean, zoom: (src: string, alt: string) => void) {
  const img = rmArt(`news/${iss.year}/${a.n}`);
  const cap = a.caption && a.caption !== 'none' ? a.caption.replace(/\s*\[[^\]]*\]\s*$/, '') : null;
  const fig = img
    ? h('figure', { class: 'np-fig' }, (() => {
        const i = h('img', { src: img, alt: a.headline ?? '', loading: 'lazy' });
        i.addEventListener('click', () => zoom(img, a.headline ?? ''));
        return i;
      })(), cap ? h('figcaption', null, cap) : null)
    : null;
  return h('article', { class: `np-art${lead ? ' lead' : ''}` },
    a.headline ? h('h3', { class: 'np-head' }, a.headline) : null,
    h('div', { class: 'np-rule' }),
    fig,
    prose(a.text, 'np-text verbatim'));
}

export function register({ app }: PanelEnv) {
  registerPanel({
    id: 'newspaper',
    title: 'The Longview Gazette',
    kind: 'sheet',
    size: 'xl',
    readOnly: true,
    available: (s) => (newspaperIssues(s) > 0 ? null : 'The first Longview Gazette comes out in August 1880.'),
    mount(ctx) {
      let issue = Number(ctx.params.issue) || 0;
      let mode: 'clear' | 'page' = 'clear';
      audio.sfx('paper');
      const { el, body } = sheetFrame({ title: 'The Longview Gazette', icon: 'news', onClose: () => app.closeSheet('newspaper'), cls: 'newspaper', foot: [] });
      const foot = el.querySelector('.sheet-foot') as HTMLElement;
      const zoomLayer = h('div', { class: 'np-zoom', hidden: true });
      zoomLayer.addEventListener('click', () => (zoomLayer.hidden = true));
      el.append(zoomLayer);
      const zoom = (src: string, alt: string) => {
        put(zoomLayer, h('img', { src, alt }), h('div', { class: 'small' }, 'Click anywhere to close'));
        zoomLayer.hidden = false;
      };

      function render(s: GameState) {
        const n = newspaperIssues(s);
        if (!news) {
          put(body, h('div', { class: 'empty' }, 'Unfolding the paper…'));
          void loadNews().then(() => render(session.s));
          return;
        }
        if (!issue || issue > n) issue = n;
        const iss = news.issues[issue - 1];
        if (!iss) return void put(body, h('div', { class: 'empty' }, 'No newspaper yet.'));
        if (!session.journal.papers.includes(issue)) session.journal.papers.push(issue);
        const seg = segmented({ options: [{ value: 'clear' as const, label: 'Read clearly' }, { value: 'page' as const, label: 'Original page' }], value: mode, onChange: (v) => ((mode = v), render(s)), label: 'View' });
        const front = rmArt(`news/${iss.year}/front`);
        const [lead, ...rest] = iss.articles;
        const paper = mode === 'clear'
          ? h('div', { class: 'broadsheet' },
              h('header', { class: 'np-mast' },
                h('div', { class: 'np-ears' }, h('span', null, 'Buffalo County, Kansas'), h('span', null, iss.dateText)),
                h('h1', null, 'The Longview Gazette'),
                h('div', { class: 'np-dateline' }, h('span', null, `Longview, ${iss.dateText}`))),
              lead ? article(iss, lead, true, zoom) : null,
              h('div', { class: 'np-cols' }, ...rest.map((a) => article(iss, a, false, zoom))),
              h('footer', { class: 'np-note small muted' }, 'Typeset from the original pages. Unreadable words are marked [illegible]; the spelling is the paper’s own.'))
          : h('div', { class: 'np-page' },
              front ? (() => { const i = h('img', { src: front, alt: `Front page, ${iss.dateText}` }); i.addEventListener('click', () => zoom(front, iss.dateText)); return i; })() : h('p', { class: 'empty' }, 'The original page is not available.'),
              h('div', { class: 'np-thumbs' }, ...iss.articles.map((a) => { const src = rmArt(`news/${iss.year}/${a.n}`); if (!src) return null; const i = h('img', { src, alt: a.headline ?? '' }); i.addEventListener('click', () => zoom(src, a.headline ?? '')); return i; })));
        put(body, h('div', { class: 'np-bar' }, seg.el), paper);
        const prev = btn('Earlier issue', { kind: 'ghost', small: true, icon: 'back', disabled: issue <= 1 ? 'This is the first issue.' : false, onClick: () => { issue--; render(s); body.scrollTop = 0; } });
        const next = btn('Later issue', { kind: 'ghost', small: true, disabled: issue >= n ? 'This is the newest issue.' : false, onClick: () => { issue++; render(s); body.scrollTop = 0; } });
        const list = h('select', { class: 'np-pick', 'aria-label': 'Choose an issue' }, ...news.issues.slice(0, n).map((x, i) => h('option', { value: String(i + 1), selected: i + 1 === issue }, x.dateText))) as HTMLSelectElement;
        list.addEventListener('change', () => { issue = Number(list.value); render(s); body.scrollTop = 0; });
        put(foot, prev, list, next, h('span', { class: 'small muted' }, `Issue ${issue} of ${n} so far`));
      }
      return { el, update: (s) => render(s), crumb: () => (news?.issues[issue - 1]?.dateText ?? null) };
    },
  });
}
