// Tiny DOM helpers for the overlay UI.
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> | string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Paragraph-split verbatim text: blank lines separate paragraphs, soft wraps flow. */
export function prose(text: string, cls = 'prose'): HTMLElement {
  const div = h('div', { class: cls });
  for (const para of text.split(/\n\s*\n/)) {
    const t = para.replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
    if (t) div.append(h('p', null, t));
  }
  return div;
}

export const money = (n: number) => {
  const neg = n < 0;
  const v = Math.abs(n);
  const s = Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg ? '−' : ''}$${s}`;
};
