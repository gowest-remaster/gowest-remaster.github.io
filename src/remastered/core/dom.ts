// DOM helpers for the Remastered overlay. `h()` is a tiny hyperscript; `svg()` builds SVG nodes.
// prose()/linesBlock() also underline glossary words (core/glossary.ts) without changing text.
import { glossify } from './glossary.ts';
type Child = Node | string | number | null | undefined | false;
export type Children = (Child | Child[])[];
type Attrs = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> | string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Children): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

function applyAttrs(el: Element, attrs: Attrs | null) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.setAttribute('class', String(v));
    else if (k === 'style' && typeof v === 'object') Object.assign((el as HTMLElement).style, v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign((el as HTMLElement).dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'html') (el as HTMLElement).innerHTML = String(v);
    else if (k in el && typeof v !== 'string' && !(el instanceof SVGElement)) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function append(el: Element, children: Children) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Children): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVGNS, tag);
  applyAttrs(el, attrs);
  append(el, children);
  return el;
}

/** Paragraph-split verbatim text: blank lines separate paragraphs, soft wraps flow. */
export function prose(text: string, cls = 'prose', gloss = true): HTMLElement {
  const div = h('div', { class: cls });
  for (const para of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const t = para.replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
    if (t) div.append(h('p', null, t));
  }
  return gloss ? glossify(div) : div;
}

/** Keep line breaks (letters, poems): each line its own block, blank lines as gaps. */
export function linesBlock(text: string, cls = 'lines', gloss = true): HTMLElement {
  const div = h('div', { class: cls });
  for (const l of text.replace(/\r/g, '').split('\n')) div.append(l.trim() ? h('div', null, l.replace(/ {2,}/g, ' ')) : h('div', { class: 'gap' }));
  return gloss ? glossify(div) : div;
}

function clear(el: Element) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** Replace children in one go. */
export function put(el: Element, ...children: Children) {
  clear(el);
  append(el, children);
  return el;
}

/** Inline SVG icon from the icon set (core/icons.ts). */
export function icon(svgMarkup: string, cls = 'ico'): HTMLElement {
  const s = h('span', { class: cls, 'aria-hidden': 'true' });
  s.innerHTML = svgMarkup;
  return s;
}
