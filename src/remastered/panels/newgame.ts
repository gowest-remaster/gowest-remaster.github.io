// New Game: a short illustrated book. Name · Edition · Rules · Assists · the Story (three
// chapters woven in, as in 1996) · Goal · Claim certificate. Then onto the homestead.
import gsap from 'gsap';
import '../styles/flows.css';
import { getContent, lines, member } from '../../game/text.ts';
import { newGame, type FidelityMode } from '../../sim/index.ts';
import type { EditionId, EditionInfo, Look, Profile } from '../../engine/save.ts';
import { updateSettings } from '../../engine/settings.ts';
import type { App } from '../core/app.ts';
import { showBackdrop } from '../ui/backdrop.ts';
import { rmArt } from '../core/art.ts';
import { audio } from '../core/audio.ts';
import { h, icon, put } from '../core/dom.ts';
import { ICONS, type IconName } from '../core/icons.ts';
import { emptyJournal, snapshot } from '../core/journal.ts';
import { registerPanel } from '../core/registry.ts';
import { rmSaves } from '../core/saves.ts';
import { session } from '../core/session.ts';
import { applyPreset, reducedMotion, rm, type AssistPreset } from '../core/settings.ts';
import { btn, setDisabled, toast } from '../ui/kit.ts';
import { chapterView } from './intro.ts';
import { isTouch } from '../ui/compact.ts';
import { ORNAMENT } from './title.ts';


type Step = 'name' | 'edition' | 'rules' | 'assists' | 'story1' | 'goal' | 'story2' | 'claim' | 'story3';
const ORDER: Step[] = ['name', 'edition', 'rules', 'assists', 'story1', 'goal', 'story2', 'claim', 'story3'];
const RAIL: { label: string; steps: Step[] }[] = [
  { label: 'Homesteader', steps: ['name'] },
  { label: 'Edition', steps: ['edition'] },
  { label: 'Rules', steps: ['rules'] },
  { label: 'Help', steps: ['assists'] },
  { label: 'The Story', steps: ['story1', 'story2', 'story3'] },
  { label: 'Goal', steps: ['goal'] },
  { label: 'Claim', steps: ['claim'] },
];

const GOALS: { n: number; balloon: string; icon: IconName; title: string; plain: string; check: string; voice: string }[] = [
  { n: 1, balloon: 'farmer', icon: 'wheat', title: 'Farmer', plain: 'Build a thriving farm and a happy family.', check: 'Checked in August 1902', voice: 'INTRO.SND farmerBaloon' },
  { n: 2, balloon: 'business', icon: 'store', title: 'Businessperson', plain: 'Own the shops and hotel of Longview.', check: 'Checked in June 1909', voice: 'INTRO.SND businessBaloon' },
  { n: 3, balloon: 'politics', icon: 'star', title: 'Politician', plain: 'Earn the town’s trust and become mayor.', check: 'Checked in June 1915', voice: 'INTRO.SND politicsBaloon' },
];

const proper = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/(^|\s)(\S)(\S*)/g, (_m, a: string, b: string, c: string) => a + b.toUpperCase() + c.toLowerCase());

export function register(app: App) {
  registerPanel({
    id: 'newgame',
    title: 'New Game',
    kind: 'screen',
    mount: () => {
      showBackdrop(app);
      const st = {
        step: 'name' as Step,
        name: '',
        profile: null as Profile | null,
        profiles: [] as Profile[],
        edition: 'remastered' as 'remastered' | 'classic',
        rules: 'remastered' as FidelityMode,
        devcut: false,
        goalRetry: false,
        goal: 0,
        first: '',
        last: '',
        signed: false,
      };
      const rail = h('nav', { class: 'ng-rail', 'aria-label': 'New game steps' });
      const stage = h('div', { class: 'ng-stage' });
      const backBtn = btn('Back', { kind: 'ghost', icon: 'back', onClick: () => prev() });
      const nextBtn = btn('Continue', { kind: 'go', onClick: () => next() });
      const hint = h('div', { class: 'ng-nav-hint' });
      const nav = h('div', { class: 'ng-nav' }, backBtn, hint, nextBtn);
      const book = h('div', { class: 'fs ng' }, h('div', { class: 'fs-vignette' }), rail, stage, nav);
      const root = h('div', { class: 'fs' }, book);
      let intro: ReturnType<typeof chapterView> | null = null;

      void rmSaves.profiles().then((ps) => {
        st.profiles = ps;
        if (st.step === 'name') render();
      });

      function renderRail() {
        const idx = ORDER.indexOf(st.step);
        put(
          rail,
          ...RAIL.map((r, i) => {
            const first = Math.min(...r.steps.map((s) => ORDER.indexOf(s)));
            const last = Math.max(...r.steps.map((s) => ORDER.indexOf(s)));
            const on = r.steps.includes(st.step);
            const done = idx > last || (r.label === 'The Story' && idx > first && !on);
            return h('div', { class: `ng-step${on ? ' on' : ''}${done && !on ? ' done' : ''}` }, h('span', { class: 'ng-seal' }, done && !on ? '✓' : String(i + 1)), h('span', { class: 'lbl' }, r.label));
          }),
        );
      }

      function go(step: Step) {
        intro?.destroy();
        intro = null;
        st.step = step;
        render();
      }
      function prev() {
        let i = ORDER.indexOf(st.step) - 1;
        while (i >= 0 && ORDER[i].startsWith('story')) i--;
        if (i < 0) return void app.go('title');
        go(ORDER[i]);
      }
      function next() {
        const why = blocker();
        if (why) return toast(why, { icon: 'warn' });
        if (st.step === 'name' && !st.profile && !st.name.trim()) st.name = 'Homesteader';
        const i = ORDER.indexOf(st.step);
        if (i === ORDER.length - 1) return void start();
        go(ORDER[i + 1]);
      }
      function blocker(): string | null {
        switch (st.step) {
          case 'name':
            return null;
          case 'goal':
            return st.goal ? null : 'Pick the goal of your choice.';
          case 'claim':
            return !st.first.trim() ? 'Write your first name on the claim.' : !st.last.trim() ? 'Write your family name on the claim.' : null;
          default:
            return null;
        }
      }
      function refreshNav() {
        const why = blocker();
        setDisabled(nextBtn, why);
        nextBtn.querySelector('.btn-label')!.textContent = st.step === 'claim' ? 'Sign the claim' : st.step === 'goal' ? 'This is my goal' : 'Continue';
        hint.textContent = why ?? (st.step === 'name' && !isTouch() ? 'Tip: hold Alt (Option) and press Enter to skip, just like the 1996 login.' : '');
      }

      // ---------------------------------------------------------------- pages
      function page(title: string, lede: string, ...body: (HTMLElement | null)[]) {
        const p = h('section', { class: 'ng-page' }, h('h2', { class: 'ng-h' }, title), h('div', { class: 'title-orn', html: ORNAMENT, style: 'margin:.5rem auto 0;width:16rem;color:var(--brass-lo);filter:none' }), h('p', { class: 'ng-lede' }, lede), ...body);
        return p;
      }
      const ccard = (o: { sel: boolean; icon: IconName; title: string; desc: string; bullets?: string[]; tag?: HTMLElement | null; disabled?: string | null; onClick: () => void }) => {
        const b = h('button', { type: 'button', class: `ccard${o.sel ? ' sel' : ''}`, title: o.disabled ?? '' }, o.tag ? h('span', { class: 'tagline' }, o.tag) : null, icon(ICONS[o.icon], 'ico cc-ico'), h('h3', null, o.title), h('p', null, o.desc), o.bullets ? h('ul', null, ...o.bullets.map((x) => h('li', null, x))) : null, o.disabled ? h('p', { class: 'small', style: 'color:var(--warn)' }, o.disabled) : null);
        if (o.disabled) b.disabled = true;
        b.addEventListener('click', () => {
          o.onClick();
          render();
        });
        return b;
      };

      function namePage() {
        const input = h('input', { type: 'text', class: 'big-input', maxLength: 16, placeholder: 'Your name', value: st.profile ? '' : st.name, autocomplete: 'off', 'aria-label': 'Your name' }) as HTMLInputElement;
        input.addEventListener('input', () => {
          st.name = input.value;
          st.profile = null;
          chips.querySelectorAll('.profile-chip').forEach((c) => c.classList.remove('sel'));
        });
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (e.altKey && !input.value.trim()) {
            st.name = 'Homesteader';
            toast('Alt held: welcome, Homesteader. (The 1996 login let you in the same way.)', { icon: 'key', tone: 'gold' });
          }
          next();
        });
        const chips = h(
          'div',
          { class: 'profile-chips' },
          ...st.profiles.map((p) => {
            const c = h('button', { type: 'button', class: `profile-chip${st.profile?.id === p.id ? ' sel' : ''}` }, icon(ICONS.people), p.name, p.devcut ? ' ✦' : '');
            c.addEventListener('click', () => {
              st.profile = p;
              st.name = p.name;
              input.value = '';
              render();
            });
            return c;
          }),
        );
        window.setTimeout(() => input.focus(), 50);
        return page(
          'Who is going west?',
          'Your name keeps your saves together. Grown-ups and kids can each have their own.',
          h('div', { class: 'profile-row' }, input, st.profiles.length ? h('div', { class: 'small muted' }, 'or continue as') : null, st.profiles.length ? chips : null, h('div', { class: 'alt-nod' }, 'Old hands know: holding Alt still opens doors.')),
        );
      }

      function editionPage() {
        return page(
          'Choose your edition',
          'How the game looks and sounds. You can switch looks later in Settings; your game stays the same.',
          h(
            'div',
            { class: 'choice-cards' },
            ccard({ sel: st.edition === 'remastered', icon: 'sparkle', title: 'Remastered', desc: 'A living 3D homestead, a helpful almanac, captions, charts and gentle reminders.', bullets: ['Real-time seasons and weather', 'Every choice previewed', 'Undo, rewind and autosave'], tag: h('span', { class: 'pill' }, 'Recommended'), onClick: () => ((st.edition = 'remastered'), (st.rules = st.rules === 'classic' ? 'remastered' : st.rules)) }),
            ccard({ sel: st.edition === 'classic', icon: 'book', title: 'Classic 1996', desc: 'The original game as it shipped: 640×480 art, the original sounds, pacing and screens.', bullets: ['Faithful replica', 'Original rules by default', 'For nostalgia and purists'], onClick: () => ((st.edition = 'classic'), (st.rules = 'classic')) }),
          ),
        );
      }

      function rulesPage() {
        return page(
          'Choose your rules',
          'Rules are fixed for the whole game. The story, letters and history are the same in both.',
          h(
            'div',
            { class: 'choice-cards' },
            ccard({ sel: st.rules === 'remastered', icon: 'check', title: 'Remastered', desc: 'The original rules with the 1996 bugs fixed: no lost grain, fair loans, honest money.', tag: h('span', { class: 'pill' }, 'Recommended'), onClick: () => (st.rules = 'remastered') }),
            ccard({ sel: st.rules === 'classic', icon: 'book', title: 'Classic 1996', desc: 'Exactly as shipped, every quirk intact. Grain spoils, money vanishes, deadlines bite.', onClick: () => (st.rules = 'classic') }),
          ),
        );
      }

      function assistsPage() {
        const a = rm().assists;
        const P: { id: Exclude<AssistPreset, 'custom'>; icon: IconName; title: string; desc: string; who: string }[] = [
          { id: 'schoolhouse', icon: 'book', title: 'Schoolhouse', desc: 'Picture hints, math moments at the store, reminders before every deadline.', who: 'Great for young homesteaders' },
          { id: 'homesteader', icon: 'home', title: 'Homesteader', desc: 'Clear previews of every choice and reminders for deadlines and money.', who: 'Recommended' },
          { id: 'original', icon: 'calendar', title: 'Original 1996', desc: 'No previews, no tips, no undo. Just you and the prairie.', who: 'For the bold' },
        ];
        const cb = (checked: boolean, title: string, sub: string, on: (v: boolean) => void, cls = '') => {
          const i = h('input', { type: 'checkbox', checked }) as HTMLInputElement;
          i.addEventListener('change', () => on(i.checked));
          return h('label', { class: `toggle-row ${cls}` }, i, h('span', null, h('b', null, title), h('small', null, sub)));
        };
        return page(
          'How much help would you like?',
          'Assists never change the rules. You can change them any time in Settings.',
          h('div', { class: 'assist-grid' }, ...P.map((p) => ccard({ sel: a.preset === p.id, icon: p.icon, title: p.title, desc: p.desc, bullets: [p.who], onClick: () => applyPreset(p.id) }))),
          h(
            'div',
            { class: 'toggles' },
            cb(st.goalRetry, 'A second chance at your goal', 'If you miss your goal on its date, it is checked once more a year later. Changes the story slightly.', (v) => (st.goalRetry = v)),
            cb(st.devcut, 'Developer’s Cut', 'Play with the letters, events and recordings that were made in 1996 but never shipped. Browse them any time from Cut Content on the title screen.', (v) => (st.devcut = v), 'devcut'),
          ),
        );
      }

      function goalPage() {
        const balloons = GOALS.map((g) => {
          const art = rmArt(`intro/balloon-${g.balloon}`);
          const b = h(
            'button',
            { type: 'button', class: `ccard goal-card${st.goal === g.n ? ' sel' : ''}` },
            art ? h('img', { class: 'balloon', src: art, alt: '' }) : icon(ICONS[g.icon], 'ico cc-ico'),
            h('h3', null, g.title),
            h('div', { class: 'gc-verb verbatim' }, goalLine(g.n)),
            h('p', null, g.plain),
            h('div', { class: 'gc-check' }, g.check),
          );
          b.addEventListener('click', () => {
            st.goal = g.n;
            const v = getContent().voice.lines.find((l) => l.id === g.voice);
            void audio.playVoice(g.voice, { speaker: 'Narrator', text: v?.text ?? null });
            render();
          });
          return b;
        });
        return page('What is your goal?', 'Every homesteader dreams of something. Your goal is checked on its date; until then, the Almanac shows how close you are.', h('div', { class: 'goal-cards' }, ...balloons));
      }

      function claimPage() {
        const raw = getContent().dialogs.bitmapText.claimForm.text;
        const after = raw.split('[First Name] [Last Name]')[1] ?? '';
        const body = after.split('[signature]')[0].trim();
        const [lead, ...rest] = body.split('•');
        const bullets = rest.map((b) => b.trim());
        const lastB = bullets.pop() ?? '';
        const dot = lastB.indexOf('.');
        const tail = dot >= 0 ? lastB.slice(dot + 1).trim() : '';
        if (dot >= 0) bullets.push(lastB.slice(0, dot));
        else bullets.push(lastB);
        const field = (ph: string, val: string, on: (v: string) => void) => {
          const i = h('input', { type: 'text', maxLength: 16, autocomplete: 'off', value: val, 'aria-label': ph }) as HTMLInputElement;
          i.addEventListener('input', () => {
            on(i.value);
            refreshNav();
          });
          i.addEventListener('keydown', (e) => e.key === 'Enter' && next());
          return h('label', { class: 'claim-field' }, i, h('small', null, ph));
        };
        const f1 = field('First Name', st.first, (v) => (st.first = v));
        const f2 = field('Last Name', st.last, (v) => (st.last = v));
        window.setTimeout(() => (f1.querySelector('input') as HTMLInputElement)?.focus(), 60);
        const officer = `<svg viewBox="0 0 160 46" width="150" height="42" fill="none" stroke="#2b2f5a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 34c6-18 10-26 12-24s-6 20-4 24 18-4 26-10-4 12 2 12 10-14 14-12-2 12 4 10 8-10 12-8 0 10 6 8 10-8 14-6M18 36c30 2 70 0 120-6"/></svg>`;
        const pad = sigPad();
        const clerk = getContent().voice.lines.find((l) => l.id === 'INTRO.SND claim form clerk');
        if (clerk) void audio.playVoice(clerk.id, { speaker: 'Land office clerk', text: clerk.text });
        const p = h(
          'section',
          { class: 'ng-page claim-page' },
          h('div', { class: 'claim-eagle' }, 'STATE OF KANSAS', h('small', null, 'UNITED STATES LAND OFFICE · LONGVIEW')),
          h('div', { class: 'claim-certifies' }, h('span', { class: 'lead' }, 'This Certifies that'), f1, f2),
          h('div', { class: 'claim-text verbatim' }, h('p', { style: 'margin:0' }, lead.trim()), h('ul', null, ...bullets.map((b) => h('li', null, b))), tail ? h('p', { style: 'margin:0' }, tail) : null),
          h(
            'div',
            { class: 'claim-sigs' },
            h('div', { class: 'sig-box' }, h('div', { class: 'line-under', html: officer, 'aria-label': 'Land officer’s signature' }), h('small', null, 'Signature of Land Officer')),
            h('div', { class: 'sig-box' }, h('div', { class: 'line-under', style: 'font-family:var(--display);font-size:1.1rem;min-width:8rem' }, 'APRIL 1, 1880'), h('small', null, 'Date')),
            h('div', { class: 'sig-box' }, h('div', { class: 'line-under' }, pad.el), h('small', null, 'Signature of Claim Filer'), h('small', { class: 'faint' }, 'Sign with the mouse (optional) · ', pad.clear)),
          ),
        );
        return p;
      }

      function sigPad() {
        const c = h('canvas', { class: 'sig-pad', width: 360, height: 72 }) as HTMLCanvasElement;
        const ctx = c.getContext('2d')!;
        ctx.strokeStyle = '#2b2f5a';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        let drawing = false;
        const pos = (e: PointerEvent) => {
          const r = c.getBoundingClientRect();
          return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
        };
        c.addEventListener('pointerdown', (e) => {
          drawing = true;
          c.setPointerCapture(e.pointerId);
          const [x, y] = pos(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
          st.signed = true;
          audio.sfx('pen');
        });
        c.addEventListener('pointermove', (e) => {
          if (!drawing) return;
          const [x, y] = pos(e);
          ctx.lineTo(x, y);
          ctx.stroke();
        });
        c.addEventListener('pointerup', () => (drawing = false));
        const clear = btn('Clear', { kind: 'link', small: true, cls: 'sig-clear', onClick: () => (ctx.clearRect(0, 0, c.width, c.height), (st.signed = false)) });
        return { el: c, clear };
      }

      function storyStep(n: number) {
        intro = chapterView(n, { label: 'The Story', onDone: () => next(), onSkipAll: () => skipStory() });
        put(stage);
        root.replaceChildren(intro.el);
        intro.start();
      }
      function skipStory() {
        intro?.destroy();
        intro = null;
        // keep the choices, skip the remaining chapters
        if (st.step === 'story1') go(st.goal ? 'claim' : 'goal');
        else if (st.step === 'story2') go('claim');
        else void start();
      }

      function render() {
        if (st.step.startsWith('story')) return storyStep(Number(st.step.slice(5)) - 1);
        if (root.firstChild !== book) root.replaceChildren(book);
        renderRail();
        const p =
          st.step === 'name' ? namePage() : st.step === 'edition' ? editionPage() : st.step === 'rules' ? rulesPage() : st.step === 'assists' ? assistsPage() : st.step === 'goal' ? goalPage() : claimPage();
        put(stage, p);
        if (!reducedMotion()) gsap.from(p, { opacity: 0, y: 14, duration: 0.3, ease: 'power2.out' });
        refreshNav();
      }

      async function start() {
        nextBtn.disabled = true;
        const first = proper(st.first) || 'Homesteader';
        const last = proper(st.last);
        let pr = st.profile;
        if (!pr) pr = await rmSaves.createProfile(proper(st.name) || first, st.devcut);
        else if (st.devcut && !pr.devcut) await rmSaves.putProfile((pr = { ...pr, devcut: true }));
        const look: Look = st.edition === 'classic' ? 'classic' : 'remastered';
        const mode: FidelityMode = st.rules === 'classic' ? 'classic' : 'remastered';
        const editionId: EditionId = st.edition === 'classic' ? (mode === 'classic' ? 'classic' : 'custom') : mode === 'remastered' ? 'remastered' : 'custom';
        const edition: EditionInfo = { edition: editionId, rules: { mode, overrides: {} }, look };
        await rmSaves.clearGame(pr.id);
        const seed = Math.floor(Math.random() * 2 ** 31);
        const state = newGame({ seed, goal: st.goal || 1, fidelity: { mode, overrides: {} }, firstName: first, lastName: last, assists: { goalRetry: st.goalRetry }, devcut: st.devcut });
        state.name = { first, last };
        const journal = emptyJournal();
        snapshot(journal, state);
        await session.load({ id: '', profileId: pr.id, kind: 'auto', slot: 0, savedAt: Date.now(), edition, place: 'homestead', state, journal, label: '' }, pr);
        await session.save('auto');
        updateSettings({ lastProfile: pr.id });
        if (look === 'classic') {
          (window as unknown as { __gowestSwitchLook?: (l: string) => void }).__gowestSwitchLook?.('classic');
          return;
        }
        app.closeScreen();
        await app.go('homestead', { force: true });
        toast(`Welcome to Buffalo County, ${first}.`, { icon: 'home', quiet: true });
      }

      const onKey = (e: KeyboardEvent) => {
        if (st.step.startsWith('story')) return;
        const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
        if (e.key === 'Escape') {
          e.preventDefault();
          prev();
        } else if (e.key === 'Enter' && !typing && !(e.target as HTMLElement)?.closest('button')) next();
      };
      window.addEventListener('keydown', onKey);
      render();
      return { el: root, destroy: () => (intro?.destroy(), window.removeEventListener('keydown', onKey)) };
    },
  });
}

function goalLine(n: number) {
  const g = lines('Goals').map((x) => x.trim()).filter(Boolean);
  return g[n - 1] ?? (member('Goals') ?? '').split('\n')[n - 1] ?? '';
}
