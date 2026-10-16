// Keyboard routing. Handlers form a stack: the top one (a dialog, then the scene) gets
// Enter (confirm) and Escape (back/cancel). Return true when the key was handled.
export interface KeyHandler {
  enter?(): boolean | void;
  escape?(): boolean | void;
  key?(e: KeyboardEvent): boolean | void;
  /** Swallow keys so handlers below never see them. */
  modal?: boolean;
}

const stack: KeyHandler[] = [];

export function pushKeys(h: KeyHandler): () => void {
  stack.push(h);
  return () => {
    const i = stack.lastIndexOf(h);
    if (i >= 0) stack.splice(i, 1);
  };
}

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement | null;
  const inText = target && (target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'checkbox' && (target as HTMLInputElement).type !== 'radio'));
  for (let i = stack.length - 1; i >= 0; i--) {
    const h = stack[i];
    let handled: boolean | void = false;
    if (h.key) handled = h.key(e);
    if (!handled && e.key === 'Enter' && h.enter && !(inText && target?.tagName === 'TEXTAREA')) handled = h.enter() !== false;
    else if (!handled && e.key === 'Escape' && h.escape) handled = h.escape() !== false;
    if (handled) {
      e.preventDefault();
      return;
    }
    // A modal handler swallows everything below it.
    if (h.modal) return;
  }
});
