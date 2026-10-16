// The parlour gramophone (05 §5.1). Original art (HOUSE2 SOUND03 card + SOUND02 slider) and
// the original slider logic from HOUSE1/ScoreScript 44-46: eight steps, level = (x-262)/9,
// applied on OK. The record list is the Dev Cut extension (labels are reconstructed).
import { reconstructedBadge } from './badge.ts';
import { assetUrl, type DcRecord, type DevcutContent } from './content.ts';
import { ensureStyles, h } from './dom.ts';

export interface GramophoneOptions {
  /** current music volume 0..1 */
  volume: number;
  /** id of the record now playing (a DcRecord id or a music cue id) */
  current?: string;
  /** show the two "Home on the Range" takes (after talk 120 was heard on this profile) */
  finaleHeard?: boolean;
  /** OK: apply the volume (0..1, in 8 steps as the original) */
  onVolume?: (volume: number) => void;
  /** OK: play this record. `music` is a src/audio music cue id; `url` a file to stream. */
  onRecord?: (record: DcRecord, src: { music?: string; url?: string }) => void;
  /** OK or X: the card closes (the host should unmount). */
  onClose?: () => void;
}

/** Original slider steps: x 262..325 / 9 = levels 0..7. */
export const GRAMOPHONE_STEPS = 7;
export const levelToVolume = (level: number) => Math.max(0, Math.min(GRAMOPHONE_STEPS, Math.round(level))) / GRAMOPHONE_STEPS;
export const volumeToLevel = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * GRAMOPHONE_STEPS);

/** Records available now. */
export function gramophoneRecords(dc: DevcutContent, finaleHeard = false): DcRecord[] {
  return dc.ui.gramophone.records.filter((r) => !r.requires || (r.requires === 'finaleHeard' && finaleHeard));
}

export function recordSource(r: DcRecord): { music?: string; url?: string } {
  return r.music ? { music: r.music } : { url: r.audio ? assetUrl(`assets/${r.audio}`) : undefined };
}

/** Mount the gramophone card into `host`. Returns an unmount function. */
export function mountGramophone(host: HTMLElement, dc: DevcutContent, opts: GramophoneOptions): () => void {
  ensureStyles(host.ownerDocument);
  const records = gramophoneRecords(dc, opts.finaleHeard);
  let idx = opts.current ? Math.max(0, records.findIndex((r) => r.id === opts.current || r.music === opts.current)) : 0;
  let level = volumeToLevel(opts.volume);

  const title = h('div', { class: 'title' });
  const line = h('div', { class: 'line' });
  const paint = () => {
    const r = records[idx];
    title.replaceChildren(r?.title ?? '—', reconstructedBadge());
    line.textContent = r?.line ?? '';
  };
  const step = (d: number) => {
    idx = (idx + d + records.length) % records.length;
    paint();
  };
  const slider = h('input', {
    type: 'range',
    min: '0',
    max: String(GRAMOPHONE_STEPS),
    step: '1',
    value: String(level),
    'aria-label': 'Volume',
    oninput: (e: Event) => (level = Number((e.target as HTMLInputElement).value)),
  });
  const ok = () => {
    opts.onVolume?.(levelToVolume(level));
    const r = records[idx];
    if (r) opts.onRecord?.(r, recordSource(r));
    opts.onClose?.();
  };
  const panel = h(
    'div',
    { class: 'dc-panel dc-gramo', role: 'dialog', 'aria-label': 'Gramophone' },
    h('img', { class: 'dc-pix', src: assetUrl(dc.ui.gramophone.card), alt: 'A brass-horned gramophone on a wooden cabinet' }),
    h('div', { class: 'dc-record' }, h('button', { class: 'dc-btn ghost', type: 'button', 'aria-label': 'Previous record', onclick: () => step(-1) }, '◀'), h('div', null, title, line), h('button', { class: 'dc-btn ghost', type: 'button', 'aria-label': 'Next record', onclick: () => step(1) }, '▶')),
    h('label', { class: 'dc-vol' }, h('span', null, 'Soft'), slider, h('span', null, 'Loud')),
    h('div', { class: 'dc-row' }, h('button', { class: 'dc-btn', type: 'button', onclick: ok }, 'OK'), h('button', { class: 'dc-btn ghost', type: 'button', onclick: () => opts.onClose?.() }, 'Close')),
  );
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') opts.onClose?.();
    else if (e.key === 'ArrowLeft' && e.target !== slider) step(-1);
    else if (e.key === 'ArrowRight' && e.target !== slider) step(1);
  };
  panel.addEventListener('keydown', onKey);
  paint();
  host.append(panel);
  panel.querySelector<HTMLButtonElement>('.dc-btn')?.focus();
  return () => panel.remove();
}
