// Settings (sheet, also embedded on the title): Display, Graphics, Audio, Assists, Look.
// Every change applies live and is remembered on this device.
import '../styles/flows.css';
import type { App } from '../core/app.ts';
import { h, put } from '../core/dom.ts';
import { registerPanel } from '../core/registry.ts';
import { session } from '../core/session.ts';
import { applyQuality, applyPreset, rm, setAssists, setRm, type Assists, type AssistPreset, type FontChoice, type Palette, type RmSettings } from '../core/settings.ts';
import { updateSettings } from '../../engine/settings.ts';
import { confirm, segmented, sheetFrame, slider, tabs, toast } from '../ui/kit.ts';
import type { Quality } from '../../world/api.ts';

type Tab = 'display' | 'graphics' | 'audio' | 'assists' | 'look';

export function settingsSheet(app: App, onClose: () => void, start: Tab = 'display') {
  let tab: Tab = start;
  const t = tabs<Tab>({
    tabs: [
      { id: 'display', label: 'Display & text' },
      { id: 'graphics', label: 'Graphics' },
      { id: 'audio', label: 'Sound & captions' },
      { id: 'assists', label: 'Assists' },
      { id: 'look', label: 'Look' },
    ],
    value: tab,
    onChange: (v) => {
      tab = v;
      render();
    },
  });
  const frame = sheetFrame({ title: 'Settings', sub: 'Changes apply right away and are remembered on this computer.', icon: 'gear', onClose, tabs: t.el });
  let fpsTimer = 0;

  const row = (label: string, hint: string | null, control: HTMLElement) => h('div', { class: 'set-row' }, h('div', { class: 'set-l' }, label, hint ? h('small', null, hint) : null), control);
  const toggle = (checked: boolean, label: string, hint: string, on: (v: boolean) => void) => {
    const cb = h('input', { type: 'checkbox', checked }) as HTMLInputElement;
    cb.addEventListener('change', () => on(cb.checked));
    return h('label', { class: 'toggle-row' }, cb, h('span', null, h('b', null, label), h('small', null, hint)));
  };

  function display() {
    const s = rm();
    const sample = h('div', { class: 'sample-text' }, h('div', { class: 'sample-h' }, 'April 1880 · Buffalo County, Kansas'), h('p', { style: 'margin:.3rem 0 0' }, 'Your neighbors raise the sod house in two days. The creek runs clear; the prairie grass is knee-high.'));
    return h(
      'div',
      { class: 'set-grid' },
      sample,
      row('Text size', 'Scales every word and button.', slider({ label: '', min: 90, max: 160, step: 5, value: Math.round(s.textScale * 100), format: (v) => `${v}%`, onInput: (v) => setRm({ textScale: v / 100 }) }).el),
      row('Typeface', 'Dyslexia-friendly uses Atkinson Hyperlegible with wider spacing.', segmented<FontChoice>({ value: s.font, options: [{ value: 'period', label: 'Period serif' }, { value: 'plain', label: 'Plain' }, { value: 'dyslexia', label: 'Dyslexia-friendly' }], onChange: (v) => setRm({ font: v }) }).el),
      row('Colors', 'Colorblind-safe palettes for charts, chips and badges.', segmented<Palette>({ value: s.palette, options: [{ value: 'standard', label: 'Standard' }, { value: 'deutan', label: 'Deuteranopia' }, { value: 'protan', label: 'Protanopia' }, { value: 'tritan', label: 'Tritanopia' }, { value: 'contrast', label: 'High contrast' }], onChange: (v) => setRm({ palette: v }) }).el),
      row('Place labels', 'Name plates over buildings in the world.', segmented<'always' | 'hover'>({ value: s.assists.labels, options: [{ value: 'always', label: 'Always show' }, { value: 'hover', label: 'On hover' }], onChange: (v) => setAssists({ labels: v }) }).el),
      row('Motion', 'Reduced motion turns camera moves into cuts and stills the cinematics.', segmented<RmSettings['reducedMotion']>({ value: s.reducedMotion, options: [{ value: 'auto', label: 'Follow system' }, { value: 'on', label: 'Reduced' }, { value: 'off', label: 'Full' }], onChange: (v) => setRm({ reducedMotion: v }) }).el),
    );
  }

  function graphics() {
    const s = rm();
    const fps = h('span', { class: 'num' }, '—');
    const tick = () => {
      fps.textContent = app.world ? `${Math.round(app.world.fps)} fps · ${app.world.quality}` : '—';
    };
    tick();
    window.clearInterval(fpsTimer);
    fpsTimer = window.setInterval(tick, 1000);
    return h(
      'div',
      { class: 'set-grid' },
      row(
        'Graphics quality',
        'Auto picks the best quality your computer can keep smooth.',
        segmented<Quality | 'auto' | 'performance'>({
          value: s.quality,
          options: [{ value: 'auto', label: 'Auto' }, { value: 'performance', label: 'Performance', hint: 'Lowest quality, fixed: smoothest on slower computers' }, { value: 'low', label: 'Low' }, { value: 'med', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }],
          onChange: (v) => {
            setRm({ quality: v });
            // a cap for the world's own governor (Auto lifts it); Performance pins Low
            applyQuality(app.world, v);
          },
        }).el,
      ),
      row('Running at', null, fps),
      ((): HTMLElement | null => {
        const info = app.world?.debugInfo?.();
        if (!info) return null;
        const webgl = /webgl/i.test(info.backend);
        return row('Renderer', webgl ? 'Your browser isn’t using WebGPU; the game will run faster in Chrome or Safari with WebGPU enabled.' : null, h('span', { class: 'num' }, info.backend));
      })(),
    );
  }

  function audioTab() {
    const s = rm();
    const vol = (k: 'master' | 'music' | 'ambience' | 'sfx' | 'voice', label: string, hint: string) =>
      row(label, hint, slider({ label: '', min: 0, max: 100, step: 5, value: Math.round(s[k] * 100), format: (v) => `${v}%`, onInput: (v) => setRm({ [k]: v / 100 } as Partial<RmSettings>) }).el);
    return h(
      'div',
      { class: 'set-grid' },
      vol('master', 'Master', 'Everything at once.'),
      vol('music', 'Music', 'The cozy theme and its seasonal variations.'),
      vol('ambience', 'Ambience', 'Wind, crickets, the bustle of town.'),
      vol('sfx', 'Sound effects', 'Coins, paper, hammer and plow.'),
      vol('voice', 'Voices', 'The townspeople of Longview, as recorded in 1996.'),
      toggle(s.captions, 'Subtitles for voices', 'Every spoken line appears as text, with the speaker’s name.', (v) => setRm({ captions: v })),
      toggle(s.soundCaptions, 'Sound captions', 'Short notes such as [coins jingle] or [roaring fire].', (v) => setRm({ soundCaptions: v })),
    );
  }

  function assists() {
    const a = rm().assists;
    const PRE: { id: Exclude<AssistPreset, 'custom'>; label: string; desc: string }[] = [
      { id: 'schoolhouse', label: 'Schoolhouse', desc: 'Picture hints, learning moments, every reminder.' },
      { id: 'homesteader', label: 'Homesteader', desc: 'Clear consequences and deadline reminders. Recommended.' },
      { id: 'original', label: 'Original 1996', desc: 'No tips or previews, just like the original.' },
    ];
    const cards = h(
      'div',
      { class: 'assist-grid' },
      ...PRE.map((p) => {
        const b = h('button', { type: 'button', class: `ccard${a.preset === p.id ? ' sel' : ''}`, style: 'min-height:0' }, h('h3', null, p.label), h('p', null, p.desc));
        b.addEventListener('click', () => {
          applyPreset(p.id);
          render();
        });
        return b;
      }),
    );
    const tg = (k: keyof Assists, label: string, hint: string) =>
      toggle(Boolean(a[k]), label, hint, (v) => {
        setAssists({ [k]: v } as Partial<Assists>);
        render();
      });
    return h(
      'div',
      { class: 'set-grid' },
      cards,
      a.preset === 'custom' ? h('div', { class: 'small muted' }, 'Custom: you changed individual assists below.') : null,
      row('Consequence chips', 'How much a decision card tells you before you choose.', segmented<Assists['chips']>({ value: a.chips, options: [{ value: 'story', label: 'Pictures' }, { value: 'clear', label: 'Clear' }, { value: 'detailed', label: 'Detailed' }, { value: 'off', label: 'Off' }], onChange: (v) => setAssists({ chips: v }) }).el),
      row('Guidance', 'Full: the next step, a glow on what to click, and a one-line hint the first time you visit a place. Light: the next step and the glow. Off: nothing (Help still lists what you can do).', segmented<Assists['guidance']>({ value: a.guidance ?? 'light', options: [{ value: 'full', label: 'Full' }, { value: 'light', label: 'Light' }, { value: 'off', label: 'Off' }], onChange: (v) => setAssists({ guidance: v }) }).el),
      row('Auto-pause', 'Extra stops the calendar makes for you.', segmented<Assists['autoPause']>({ value: a.autoPause, options: [{ value: 'all', label: 'Everything' }, { value: 'deadlines', label: 'Deadlines & money' }, { value: 'off', label: 'Off' }], onChange: (v) => setAssists({ autoPause: v }) }).el),
      h(
        'div',
        { class: 'toggles' },
        tg('learning', 'Learning moments', 'Tally your own store orders and other math moments.'),
        tg('undo', 'Undo', 'Take back your last purchase, savings move or letter answer (Ctrl+Z).'),
        tg('rewind', 'Rewind', 'Load any of the last 24 months from the Load screen.'),
        tg('seasonReveal', 'Farmer’s intuition', 'Shows the exact day summer heat and frost arrive this year.'),
        tg('ogradyOdds', 'Show the hauler’s odds', 'How often storms ruin part of O’Grady’s load.'),
      ),
    );
  }

  function look() {
    const cur = session.state ? session.edition.look : 'remastered';
    return h(
      'div',
      { class: 'set-grid' },
      h('p', { class: 'muted', style: 'margin:0' }, 'Switch between the new 3D Remastered look and the faithful 1996 Classic replica at any time. Your game, rules and progress stay exactly the same.'),
      h(
        'div',
        { class: 'choice-cards' },
        ...(['remastered', 'classic'] as const).map((l) => {
          const b = h('button', { type: 'button', class: `ccard${cur === l ? ' sel' : ''}` }, h('h3', null, l === 'remastered' ? 'Remastered' : 'Classic 1996'), h('p', null, l === 'remastered' ? 'Real-time 3D homestead, modern help, captions and charts.' : 'The original 640×480 art, sounds and pacing, as shipped in 1996.'));
          b.addEventListener('click', async () => {
            if (l === cur) return;
            if (!session.state) return toast('Start or continue a game first; the look is picked at New Game.', { icon: 'warn' });
            const ok = await confirm('Switch the look?', [h('p', null, `The game will save and reload in the ${l === 'classic' ? 'Classic 1996' : 'Remastered'} look.`)], 'Switch');
            if (!ok) return;
            await switchToLook(l);
          });
          return b;
        }),
      ),
    );
  }

  function render() {
    window.clearInterval(fpsTimer);
    put(frame.body, tab === 'display' ? display() : tab === 'graphics' ? graphics() : tab === 'audio' ? audioTab() : tab === 'assists' ? assists() : look());
  }
  render();
  return { el: frame.el, destroy: () => window.clearInterval(fpsTimer) };
}

export async function switchToLook(look: 'classic' | 'remastered') {
  session.setLook(look);
  await session.save('auto');
  if (session.profile) updateSettings({ lastProfile: session.profile.id });
  (window as unknown as { __gowestSwitchLook?: (l: string) => void }).__gowestSwitchLook?.(look);
}


export function register(app: App) {
  registerPanel({
    id: 'settings',
    title: 'Settings',
    kind: 'sheet',
    readOnly: true,
    size: 'lg',
    mount: ({ params }) => {
      const s = settingsSheet(app, () => app.closeSheet('settings'), (params.tab as Tab) ?? 'display');
      return { el: s.el, destroy: s.destroy };
    },
  });
}
