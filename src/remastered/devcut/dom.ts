// DOM helpers for the Dev Cut UI pieces: the overlay's `h()` and the scoped Dev Cut stylesheet.
import { DEVCUT_CSS } from './styles.ts';

export { h } from '../core/dom.ts';

/** Inject the Dev Cut stylesheet once per document. */
export function ensureStyles(doc: Document = document) {
  if (doc.getElementById('dc-styles')) return;
  const style = doc.createElement('style');
  style.id = 'dc-styles';
  style.textContent = DEVCUT_CSS;
  doc.head.append(style);
}
