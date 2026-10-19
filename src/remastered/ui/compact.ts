// Phones in landscape (and any window under 500 px tall): the compact layout and touch mode.
//  - html.rm-compact: slim HUD, one top row (Back + crumb · Next pill · goal/mail/help/menu),
//    near-full-screen sheets and drawers that start under that row (styles/compact.css).
//  - html.rm-touch: coarse pointer: 44 px tap targets, no keyboard hints, press-and-hold tips.
// ?compact=1 / ?compact=0 and ?touch=1 / ?touch=0 force either for testing; ?mobile=1 implies touch.
const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const force = (k: string) => (q.get(k) === '1' ? true : q.get(k) === '0' ? false : null);
const mq = (s: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(s) : null);
const shortMQ = mq('(max-height: 500px)');
const coarseMQ = mq('(pointer: coarse)');
const fineMQ = mq('(pointer: fine)');
const listeners = new Set<(on: boolean) => void>();

export function isCompact(): boolean {
  return force('compact') ?? !!shortMQ?.matches;
}
export function isTouch(): boolean {
  const f = force('touch') ?? (q.get('mobile') === '1' ? true : null);
  if (f !== null) return f;
  if (coarseMQ?.matches) return true;
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0 && !fineMQ?.matches;
}
/** Called now and whenever the compact layout turns on or off. */
export function onCompact(cb: (on: boolean) => void) {
  listeners.add(cb);
  cb(isCompact());
  return () => listeners.delete(cb);
}

let last: boolean | null = null;
function apply() {
  const d = document.documentElement;
  const c = isCompact();
  d.classList.toggle('rm-compact', c);
  d.classList.toggle('rm-touch', isTouch());
  if (c !== last) {
    last = c;
    window.dispatchEvent(new Event('resize'));
    for (const cb of listeners) cb(c);
  }
}

/** Set the classes and keep them current (rotation, window resizes, a mouse plugged into a tablet). */
export function initCompact() {
  apply();
  for (const m of [shortMQ, coarseMQ, fineMQ]) m?.addEventListener?.('change', apply);
}

/**
 * Compact top row: the Next pill sits between the breadcrumb and the goal/mail/help/menu cluster
 * when there is room (else on a second row), and --ctop says where panels may start below it all.
 */
export function initCompactTopRow(root: HTMLElement) {
  const d = document.documentElement;
  const crumb = root.querySelector<HTMLElement>('.rm-crumb');
  const obj = root.querySelector<HTMLElement>('.rm-objective');
  let raf = 0;
  const sync = () => {
    raf = 0;
    if (!d.classList.contains('rm-compact')) return;
    const top = root.querySelector<HTMLElement>('.hud-top');
    const shown = (el: Element | null | undefined) => !!el && (el as HTMLElement).offsetParent !== null && el.getBoundingClientRect().height > 0;
    const cr = crumb && shown(crumb) ? crumb.getBoundingClientRect() : null;
    const tr = top && shown(top) ? top.getBoundingClientRect() : null;
    const left = cr && cr.width > 0 ? cr.right : 0;
    const right = tr ? tr.left : window.innerWidth;
    d.style.setProperty('--crumb-r', `${Math.round(left)}px`);
    d.style.setProperty('--top-l', `${Math.round(right)}px`);
    // room for the pill on the top row?
    const room = right - left - 16;
    d.classList.toggle('rm-obj-row2', room < 150);
    let bottom = Math.max(cr?.bottom ?? 0, tr?.bottom ?? 0);
    if (obj && !obj.hidden && shown(obj)) {
      const row = obj.querySelector('.obj-row');
      const hint = obj.querySelector<HTMLElement>('.obj-hint');
      if (row && shown(row)) bottom = Math.max(bottom, row.getBoundingClientRect().bottom);
      if (hint && !hint.hidden && shown(hint)) bottom = Math.max(bottom, hint.getBoundingClientRect().bottom);
    }
    const ctop = Math.round(Math.max(bottom, 44) + 6);
    if (d.style.getPropertyValue('--ctop') !== `${ctop}px`) {
      d.style.setProperty('--ctop', `${ctop}px`);
      window.dispatchEvent(new Event('rm-ctop'));
    }
  };
  const queue = () => (raf ||= requestAnimationFrame(sync));
  const ro = new ResizeObserver(queue);
  const watch = () => {
    for (const el of [crumb, obj, root.querySelector('.hud-top'), obj?.querySelector('.obj-row'), obj?.querySelector('.obj-hint')]) if (el) ro.observe(el);
  };
  watch();
  // only the few things that move the row: the crumb re-rendering, the pill/hint showing, has-screen
  const mo = new MutationObserver(() => (watch(), queue()));
  if (crumb) mo.observe(crumb, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  if (obj) mo.observe(obj, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  mo.observe(root, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', queue);
  onCompact(queue);
}

const A2HS_KEY = 'gowest.a2hs.dismissed';
/** iPhone/iPad Safari outside a home-screen app: Safari has no Fullscreen API, but a home-screen web app runs full screen. */
export function wantsInstallHint(): boolean {
  if (q.get('a2hs') === '1') return true;
  if (typeof navigator === 'undefined') return false;
  const ios = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || !!mq('(display-mode: standalone)')?.matches || !!mq('(display-mode: fullscreen)')?.matches;
  if (!ios || standalone) return false;
  try {
    return localStorage.getItem(A2HS_KEY) !== '1';
  } catch {
    return true;
  }
}
/** The small, one-time "Add to Home Screen" note for the title screen (null when not wanted). */
export function installHint(): HTMLElement | null {
  if (!wantsInstallHint()) return null;
  const el = document.createElement('div');
  el.className = 'a2hs';
  el.setAttribute('role', 'note');
  const share = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
  // only Safari offers Add to Home Screen reliably; Chrome, Firefox, Edge and in-app browsers on iOS say so in their UA
  const safari = !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//.test(navigator.userAgent);
  const steps = `<b>•••</b> → <b>Share</b> <span class="a2hs-ico">${share}</span> → <b>Add to Home Screen</b>`;
  el.innerHTML = safari ? `<span class="a2hs-t">For full screen: ${steps}</span>` : `<span class="a2hs-t">For full screen, open this page in <b>Safari</b>, then ${steps}</span>`;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'a2hs-x';
  x.setAttribute('aria-label', 'Dismiss');
  x.textContent = '×';
  x.addEventListener('click', () => {
    try {
      localStorage.setItem(A2HS_KEY, '1');
    } catch {
      /* private mode: it just comes back next time */
    }
    el.remove();
  });
  el.append(x);
  return el;
}

/**
 * Phones: a panel's main buttons (marked .phone-foot inside its body) move into the panel's footer, which
 * never scrolls away. Returns true when something was lifted. Desktop leaves the panel as it is.
 */
export function liftToFoot(body: HTMLElement, foot: HTMLElement): boolean {
  if (!isCompact()) return false;
  const els = [...body.querySelectorAll<HTMLElement>('.phone-foot')];
  if (!els.length) return false;
  foot.replaceChildren(...els);
  foot.hidden = false;
  return true;
}
