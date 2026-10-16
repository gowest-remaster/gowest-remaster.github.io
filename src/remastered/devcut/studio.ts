// The Studio: a quiet room off the title screen with the developers' traces
// (docs/spec/05-developers-cut.md §6). Self-contained; mount it into any element.
import { sourceBadge } from './badge.ts';
import { assetUrl, loadCredits, loadDevcut, loadStudio, type DevcutContent, type StudioArt, type StudioCard, type StudioContent } from './content.ts';
import { ensureStyles, h } from './dom.ts';

export interface StudioOptions {
  /** Workbench tool handlers by tool id (NewForRaz, MClick, ...). Tools without one show as unavailable. */
  tools?: Record<string, () => void>;
  /** Called when the visitor presses "Leave the Studio" (the button is hidden without it). */
  onClose?: () => void;
  /** Room to open first (credits, traces, telegram, art, sound, index, workbench). */
  room?: string;
}

/** Mount the Studio into `host`. Returns an unmount function. */
export function mountStudio(host: HTMLElement, opts: StudioOptions = {}): () => void {
  ensureStyles(host.ownerDocument);
  const root = h('div', { class: 'dc-root', role: 'region', 'aria-label': 'Cut Content' });
  const wrap = h('div', { class: 'dc-wrap' }, h('p', { class: 'dc-intro' }, 'Opening the archive…'));
  root.append(wrap);
  host.append(root);
  let alive = true;
  const cleanups: (() => void)[] = [];

  Promise.all([loadStudio(), loadDevcut(), loadCredits()])
    .then(([studio, dc, credits]) => alive && render(studio, dc, credits.text))
    .catch((e) => alive && wrap.replaceChildren(h('p', { class: 'dc-intro' }, `Cut Content could not open: ${String(e)}`)));

  function render(studio: StudioContent, dc: DevcutContent, creditsText: string) {
    const body = h('div', { role: 'tabpanel', class: 'dc-wrap' });
    const tabs = h('div', { class: 'dc-tabs', role: 'tablist', 'aria-label': 'Cut Content rooms' });
    const btns = new Map<string, HTMLButtonElement>();
    const show = (id: string) => {
      stopMedia(body);
      for (const [k, b] of btns) b.setAttribute('aria-selected', String(k === id));
      const room = studio.rooms.find((r) => r.id === id) ?? studio.rooms[0];
      body.setAttribute('aria-label', room.title);
      body.replaceChildren(h('p', { class: 'dc-intro' }, room.intro.text, sourceBadge(room.intro.source)), ROOMS[room.id]?.() ?? h('div'));
    };
    // the workbench lists the developers' own tools; show only the ones this build can run
    const usable = studio.workbench.filter((t) => Object.hasOwn(opts.tools ?? {}, t.id));
    for (const r of studio.rooms.filter((r) => r.id !== 'workbench' || usable.length)) {
      const b = h('button', { class: 'dc-tab', role: 'tab', type: 'button', onclick: () => show(r.id) }, r.title);
      btns.set(r.id, b);
      tabs.append(b);
    }
    tabs.addEventListener('keydown', (e) => {
      const ids = [...btns.keys()];
      const cur = ids.findIndex((k) => btns.get(k) === document.activeElement);
      if (cur < 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      const next = ids[(cur + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
      btns.get(next)!.focus();
      show(next);
    });

    const ROOMS: Record<string, () => HTMLElement> = {
      credits: () => creditsRoom(studio, creditsText),
      traces: () => h('div', { class: 'dc-grid' }, studio.traces.map(cardEl)),
      telegram: () => telegramRoom(studio, dc),
      art: () => artRoom(studio.artViewer),
      sound: () => soundRoom(studio),
      index: () => indexRoom(studio, dc),
      workbench: () => workbenchRoom(usable, opts.tools ?? {}),
    };

    const head = h(
      'div',
      { class: 'dc-head' },
      h('h2', { class: 'dc-plaque' }, h('small', null, 'Cut Content'), studio.plaque.text),
      opts.onClose ? h('button', { class: 'dc-btn', type: 'button', onclick: () => opts.onClose?.() }, 'Back') : null,
    );
    wrap.replaceChildren(head, tabs, body);
    show(opts.room ?? 'credits');
  }

  // Art lightbox: Escape closes it; focus returns to the thumbnail.
  function artRoom(items: StudioArt[]): HTMLElement {
    const grid = h('div', { class: 'dc-grid' });
    for (const a of items) {
      const thumb = h(
        'button',
        { class: 'dc-thumb', type: 'button', onclick: () => openLightbox(a, thumb) },
        h('img', { class: 'dc-pix', src: assetUrl(a.asset), alt: a.title, loading: 'lazy' }),
        h('b', null, a.title, sourceBadge(a.badge)),
        h('small', null, a.path),
      );
      grid.append(thumb);
    }
    return grid;
  }
  function openLightbox(a: StudioArt, from: HTMLElement) {
    const close = () => {
      box.remove();
      document.removeEventListener('keydown', onKey);
      from.focus();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const box = h(
      'div',
      { class: 'dc-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': a.title, onclick: (e: Event) => e.target === box && close() },
      h(
        'div',
        { class: 'dc-panel' },
        h('img', { class: 'dc-pix', src: assetUrl(a.asset), alt: a.title, onclick: close }),
        h('h3', null, a.title, sourceBadge(a.badge)),
        h('p', null, a.caption, sourceBadge(a.source)),
        h('div', { class: 'dc-lbl' }, a.path),
        h('div', { class: 'dc-row', style: 'justify-content:flex-end;margin-top:8px' }, h('button', { class: 'dc-btn', type: 'button', onclick: close }, 'Close')),
      ),
    );
    document.addEventListener('keydown', onKey);
    cleanups.push(() => document.removeEventListener('keydown', onKey));
    root.append(box);
    box.querySelector<HTMLButtonElement>('button')?.focus();
  }

  return () => {
    alive = false;
    stopMedia(root);
    cleanups.forEach((f) => f());
    root.remove();
  };
}

// ---------------------------------------------------------------- rooms

function cardEl(c: StudioCard): HTMLElement {
  return h(
    'article',
    { class: 'dc-panel' },
    h('h3', null, c.title, c.badge ? sourceBadge(c.badge) : null),
    h('p', null, c.caption, sourceBadge(c.source)),
    c.assets?.length ? h('div', { class: 'dc-sound' }, c.assets.map(media)) : null,
    c.facts.length
      ? h('ul', { class: 'dc-facts' }, c.facts.map((f) => h('li', null, redact(f.text, c.redacted), h('cite', null, f.cite))))
      : null,
  );
}

/** The PrintOMatic key is never shown; the data already says REDACTED, this styles it. */
function redact(text: string, on?: boolean): Node {
  if (!on || !text.includes('REDACTED')) return document.createTextNode(text);
  const span = h('span');
  const [a, b] = text.split('REDACTED');
  span.append(a, h('span', { class: 'dc-redacted', 'aria-label': 'redacted' }, '██████████'), b);
  return span;
}

function media(url: string): HTMLElement {
  const src = assetUrl(url);
  if (/\.(png|jpe?g|gif)$/i.test(url)) return h('img', { class: 'dc-pix', src, alt: '', loading: 'lazy' });
  if (/\.mp4$/i.test(url)) return h('video', { src, controls: true, preload: 'none', playsInline: true });
  return h('audio', { src, controls: true, preload: 'none' });
}

function stopMedia(el: HTMLElement) {
  el.querySelectorAll<HTMLMediaElement>('audio, video').forEach((m) => m.pause());
}

function creditsRoom(studio: StudioContent, text: string): HTMLElement {
  const isName = (l: string) => {
    const core = l.replace(/\([^)]*\)/g, '');
    return /[A-Z]/.test(core) && core === core.toUpperCase();
  };
  const groups = text.replace(/\r/g, '').split(/\n\s*\n/).map((g) => g.split('\n').filter((l) => l.trim()));
  const list = h('div', { class: 'dc-credits' });
  for (const g of groups.filter((x) => x.length)) {
    const block = h('div', { style: 'break-inside: avoid' });
    for (const l of g) block.append(h('div', { class: isName(l.trim()) ? 'name' : 'role' }, l.trim())); // verbatim: double spaces kept (pre-wrap)
    list.append(block);
  }
  return h(
    'div',
    { class: 'dc-wrap' },
    h('div', { class: 'dc-panel' }, h('p', null, studio.credits.curatorNote.text, sourceBadge(studio.credits.curatorNote.source)), list),
    h('div', { class: 'dc-grid' }, studio.credits.highlights.map(cardEl)),
  );
}

function telegramRoom(studio: StudioContent, dc: DevcutContent): HTMLElement {
  const tel = dc.texts['BANK09.Tel'];
  return h(
    'div',
    { class: 'dc-grid' },
    h('div', { class: 'dc-panel' }, h('div', { class: 'dc-lbl' }, 'BANK09 field Tel, as shipped', sourceBadge('original')), h('div', { class: 'dc-telegram' }, tel?.text ?? '')),
    cardEl(studio.telegram),
  );
}

function soundRoom(studio: StudioContent): HTMLElement {
  return h(
    'div',
    { class: 'dc-grid' },
    studio.soundBooth.map((s) =>
      h(
        'article',
        { class: 'dc-panel dc-sound' },
        h('h3', null, s.title, s.audited ? null : sourceBadge('unheard')),
        h('p', null, s.caption, sourceBadge(s.source)),
        media(s.asset),
        h('div', { class: 'dc-lbl' }, `${s.path}${s.seconds ? ` · ${s.seconds} s` : ''}`),
      ),
    ),
  );
}

function indexRoom(studio: StudioContent, dc: DevcutContent): HTMLElement {
  const byId = new Map(dc.items.map((i) => [i.id, i]));
  const items = studio.index.map((i) => {
    const full = byId.get(i.id);
    return h(
      'article',
      { class: 'dc-panel' },
      h('div', { class: 'dc-lbl' }, `${i.kind} · ${i.id}`),
      h('h3', null, i.title, i.reconstructed ? h('span', { class: 'dc-badge', title: 'Original material plus some new writing, art or audio made for the remake' }, 'part reconstructed') : sourceBadge('original')),
      full?.trigger ? h('p', { style: 'font-size:13px' }, full.trigger) : null,
      full?.spec ? h('div', { class: 'dc-lbl' }, `spec ${full.spec}`) : null,
    );
  });
  const notes = studio.studioNotes.map((n) =>
    h(
      'article',
      { class: 'dc-panel' },
      h('div', { class: 'dc-lbl' }, 'studio note'),
      h('h3', null, n.title),
      h('p', null, n.caption, sourceBadge(n.source)),
      n.text ? h('div', { class: 'dc-telegram' }, n.text) : null,
      n.a && n.b ? h('div', { class: 'dc-grid' }, h('div', { class: 'dc-telegram' }, n.a), h('div', { class: 'dc-telegram' }, n.b)) : null,
      n.path ? h('div', { class: 'dc-lbl' }, n.path) : null,
    ),
  );
  return h('div', { class: 'dc-grid' }, items, notes);
}

function workbenchRoom(tools: StudioContent['workbench'], handlers: Record<string, () => void>): HTMLElement {
  return h(
    'div',
    { class: 'dc-grid' },
    tools.map((t) => {
      const fn = handlers[t.id];
      return h(
        'article',
        { class: 'dc-panel' },
        h('h3', null, t.id, t.reconstructed ? sourceBadge('reconstructed') : null),
        h('p', null, t.caption, sourceBadge(t.source)),
        h('div', { class: 'dc-lbl' }, t.original),
        h('div', { class: 'dc-row', style: 'justify-content:flex-start;margin-top:8px' }, h('button', { class: 'dc-btn', type: 'button', onclick: () => fn?.() }, 'Use')),
      );
    }),
  );
}

