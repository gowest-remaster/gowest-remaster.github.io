// Crash breadcrumbs for devices whose console we can't see (phones). A small rolling log in localStorage: hops,
// state changes and memory as the world reports them, plus the last JS errors / GPU messages. If a session ends
// without the page closing normally (iOS killing the tab for memory looks exactly like that), the next start shows
// a dismissible card with the log so the player can screenshot it. `?crashlog=1` shows it any time.
const CRUMBS = 'gw-crumbs';
const ERRORS = 'gw-errors';
const ALIVE = 'gw-alive';
const MAX_CRUMBS = 40;
const MAX_ERRORS = 10;

type Entry = { t: string; k: string; d?: string };
const read = (key: string): Entry[] => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as Entry[];
  } catch {
    return [];
  }
};
const write = (key: string, list: Entry[], max: number) => {
  try {
    localStorage.setItem(key, JSON.stringify(list.slice(-max)));
  } catch {
    /* storage full / blocked */
  }
};
const stamp = () => new Date().toTimeString().slice(0, 8);

/** memory figures the world provides for each breadcrumb (MB) */
let memProvider: (() => string) | null = null;
export function setMemProvider(fn: () => string): void {
  memProvider = fn;
}

/** one breadcrumb: what happened (hop, state, action), with a short detail and the current memory */
export function crumb(kind: string, detail = ''): void {
  let mem = '';
  try {
    mem = memProvider?.() ?? '';
  } catch {
    /* */
  }
  const list = read(CRUMBS);
  list.push({ t: stamp(), k: kind, d: [detail, mem].filter(Boolean).join(' · ') });
  write(CRUMBS, list, MAX_CRUMBS);
}

/** an error worth keeping (JS error, unhandled rejection, GPU device lost / uncaptured error) */
export function crashError(kind: string, message: string): void {
  const list = read(ERRORS);
  list.push({ t: stamp(), k: kind, d: message.slice(0, 300) });
  write(ERRORS, list, MAX_ERRORS);
  crumb('error', `${kind}: ${message.slice(0, 120)}`);
}

let crashed = false;

/** install the handlers and work out whether the previous session ended unexpectedly (call first thing) */
export function installCrashLog(): void {
  try {
    crashed = !!localStorage.getItem(ALIVE);
    localStorage.removeItem(ALIVE);
  } catch {
    /* */
  }
  window.addEventListener('error', (e) => crashError('error', `${e.message} @ ${(e.filename ?? '').split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => crashError('rejection', String((e.reason as Error)?.stack ?? e.reason).split('\n').slice(0, 2).join(' ')));
  // a session is "alive" while the page is visible; closing / backgrounding it normally clears the flag
  const set = (on: boolean) => {
    try {
      if (on) localStorage.setItem(ALIVE, String(Date.now()));
      else localStorage.removeItem(ALIVE);
    } catch {
      /* */
    }
  };
  addEventListener('pagehide', () => set(false));
  document.addEventListener('visibilitychange', () => set(document.visibilityState === 'visible' && started));
  crumb('boot', `${crashed ? 'after an unexpected end · ' : ''}${navigator.userAgent.match(/(iPhone|iPad|Android|Mac OS X|Windows)[^;)]*/)?.[0] ?? ''}`);
}

let started = false;
/** the game is up (title shown): from now on an abrupt end counts as a crash; shows the card if the last one did */
export function sessionStarted(): void {
  started = true;
  try {
    if (document.visibilityState === 'visible') localStorage.setItem(ALIVE, String(Date.now()));
  } catch {
    /* */
  }
  if (crashed || new URLSearchParams(location.search).get('crashlog') === '1') showCard(crashed);
}

/** Diagnostics (the in-game menu): the same card any time, with the full log, the memory right now and every
 *  plate / load problem, so a player can send it after something went wrong that wasn't a crash. */
export function showDiagnostics(): void {
  showCard(false, true);
}

let open: HTMLElement | null = null;
function showCard(afterCrash: boolean, full = false): void {
  open?.remove();
  const crumbs = read(CRUMBS).slice(full ? -MAX_CRUMBS : -14);
  const errors = read(ERRORS).slice(full ? -MAX_ERRORS : -5);
  const fmt = (c: Entry) => `${c.t} ${c.k}${c.d ? ' — ' + c.d : ''}`;
  let now = '';
  try {
    now = memProvider?.() ?? '';
  } catch {
    /* */
  }
  const problems = crumbs.filter((c) => /^(plate|hop-aborted|prepare|error)/.test(c.k));
  const text = [
    afterCrash ? 'The last session ended unexpectedly.' : full ? 'Diagnostics' : 'Session log',
    ...(full ? [`${new Date().toISOString()} · ${navigator.userAgent}`, `screen ${screen.width}x${screen.height} @${devicePixelRatio} · window ${innerWidth}x${innerHeight}`, now ? `memory now: ${now}` : ''] : []),
    '',
    'Last steps:',
    ...crumbs.map(fmt),
    '',
    errors.length ? 'Errors:' : 'No errors recorded.',
    ...errors.map((e) => `${e.t} ${e.k}: ${e.d}`),
    ...(full ? ['', problems.length ? 'Plate / load problems:' : 'No plate or load problems recorded.', ...problems.map(fmt)] : []),
  ]
    .filter((l, i, a) => l !== '' || a[i - 1] !== '')
    .join('\n');
  const card = document.createElement('div');
  card.setAttribute('role', 'dialog');
  card.style.cssText =
    'position:fixed;left:calc(var(--safe-l, 0px) + 8px);bottom:calc(var(--safe-b, 0px) + 8px);z-index:100003;max-width:min(560px,92vw);max-height:70vh;display:flex;flex-direction:column;background:#2a2118f2;color:#f4ead6;border:1px solid #c79a4b;border-radius:8px;font:12px/1.4 ui-monospace,Menlo,monospace;box-shadow:0 8px 24px #0008';
  const pre = document.createElement('pre');
  pre.style.cssText = 'margin:0;padding:10px 12px;overflow:auto;white-space:pre-wrap';
  pre.textContent = text + `\n\nPlease ${full ? 'copy this' : 'take a screenshot of this'} and send it to us.`;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;padding:8px 12px;border-top:1px solid #c79a4b55;justify-content:flex-end';
  const btn = (label: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font:13px Georgia,serif;min-height:40px;padding:0 14px;border-radius:6px;border:1px solid #c79a4b;background:#48301b;color:#f4ead6';
    b.addEventListener('click', fn);
    row.appendChild(b);
  };
  btn('Copy', () => {
    const done = () => (row.firstElementChild!.textContent = 'Copied');
    // (the async clipboard can be missing outside a secure context: fall back to selecting the text)
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(text).then(done, () => selectAll(pre));
    else selectAll(pre);
  });
  btn('Close', () => (card.remove(), (open = null)));
  card.append(pre, row);
  document.body.appendChild(card);
  open = card;
}

function selectAll(el: HTMLElement): void {
  const r = document.createRange();
  r.selectNodeContents(el);
  const sel = getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
  try {
    document.execCommand('copy');
  } catch {
    /* the selection stays for a manual copy */
  }
}
