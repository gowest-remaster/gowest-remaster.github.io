// Scoped styles for the Dev Cut UI. Paper/ink palette from the Remastered mockup
// (walnut frame, parchment panels, brass buttons). Tokens fall back to the mockup values
// when the host page has not defined --parch, --ink, etc.
export const DEVCUT_CSS = /* css */ `
.dc-root, .dc-panel, .dc-offer, .dc-badge {
  --dc-wood: var(--wood, #3b2516); --dc-wood-hi: var(--wood-hi, #5a3a22); --dc-wood-lo: var(--wood-lo, #24160c);
  --dc-parch: var(--parch, #f4e7c9); --dc-parch-edge: var(--parch-edge, #c9ab74); --dc-parch-shade: var(--parch-shade, #eadbb6);
  --dc-ink: var(--ink, #3a2816); --dc-ink-soft: var(--ink-soft, #6b5238);
  --dc-brass: var(--brass, #c79a4b); --dc-brass-hi: var(--brass-hi, #f1d38d); --dc-brass-lo: var(--brass-lo, #7d5a26);
  --dc-green: var(--green, #4c6b2f); --dc-red: var(--red, #8e2f22);
  --dc-display: var(--display, 'Libre Caslon Display', 'Hoefler Text', 'Iowan Old Style', Georgia, serif);
  --dc-serif: var(--serif, 'Libre Caslon Text', 'Iowan Old Style', Palatino, Georgia, serif);
}
.dc-root { position: relative; box-sizing: border-box; height: 100%; overflow: auto; color: var(--dc-parch);
  font-family: var(--dc-serif); font-size: 15px; line-height: 1.45; padding: 16px;
  background: repeating-linear-gradient(92deg, rgba(255,255,255,.018) 0 2px, transparent 2px 7px), radial-gradient(120% 80% at 50% 0%, var(--dc-wood-hi), var(--dc-wood-lo)); }
.dc-root *, .dc-panel *, .dc-offer * { box-sizing: border-box; }
.dc-wrap { max-width: 1040px; margin: 0 auto; display: grid; gap: 14px; }
.dc-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 6px 16px; }
.dc-plaque { font-family: var(--dc-display); font-size: clamp(22px, 4vw, 32px); color: var(--dc-brass-hi); margin: 0; letter-spacing: .02em; }
.dc-plaque small { display: block; font-family: var(--dc-serif); font-size: 12px; letter-spacing: .2em; text-transform: uppercase; color: var(--dc-parch-edge); }
.dc-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.dc-tab { font: inherit; font-size: 14px; cursor: pointer; border-radius: 6px; border: 1px solid var(--dc-brass-lo); padding: 5px 10px; background: rgba(0,0,0,.25); color: var(--dc-parch); }
.dc-tab[aria-selected="true"] { background: linear-gradient(var(--dc-brass-hi), var(--dc-brass)); color: var(--dc-wood-lo); }
.dc-intro { margin: 0; color: var(--dc-parch-edge); font-style: italic; max-width: 70ch; }
.dc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
.dc-panel { background: var(--dc-parch); color: var(--dc-ink); border: 1px solid var(--dc-parch-edge); border-radius: 8px;
  box-shadow: 0 10px 28px rgba(30,15,0,.35), inset 0 0 0 3px var(--dc-parch-shade); padding: 12px 14px; min-width: 0; font-family: var(--dc-serif); }
.dc-panel h3 { font-family: var(--dc-display); font-weight: 400; font-size: 19px; margin: 0 0 6px; text-wrap: balance; }
.dc-panel p { margin: 0 0 8px; overflow-wrap: anywhere; }
.dc-intro .dc-badge { color: var(--dc-parch-edge); border-color: var(--dc-parch-edge); }
.dc-lbl { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--dc-ink-soft); }
.dc-facts { margin: 6px 0 0; padding: 8px 0 0 16px; border-top: 1px solid var(--dc-parch-shade); font-size: 13px; color: var(--dc-ink-soft); }
.dc-facts li { margin: 2px 0; overflow-wrap: anywhere; }
.dc-facts cite { display: block; font-style: normal; font-size: 11px; color: var(--dc-brass-lo); overflow-wrap: anywhere; }
.dc-btn { font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid var(--dc-brass-lo); padding: 6px 12px; background: linear-gradient(var(--dc-brass-hi), var(--dc-brass)); color: var(--dc-wood-lo); }
.dc-btn.ghost { background: transparent; color: var(--dc-ink); border-color: var(--dc-parch-edge); }
.dc-btn:disabled { opacity: .5; cursor: not-allowed; }
.dc-btn:focus-visible, .dc-tab:focus-visible, .dc-thumb:focus-visible, .dc-root input:focus-visible { outline: 2px solid var(--dc-brass-hi); outline-offset: 2px; }
.dc-badge { display: inline-block; font-family: var(--dc-serif); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; border-radius: 3px; padding: 0 5px; margin-left: 6px; vertical-align: 2px; line-height: 16px; white-space: nowrap;
  background: transparent; color: var(--dc-brass-lo); border: 1px dashed var(--dc-brass-lo); }
.dc-badge.original { border-style: solid; color: var(--dc-green); border-color: var(--dc-green); }
.dc-badge.adapted { color: var(--dc-ink-soft); border-color: var(--dc-ink-soft); }
.dc-badge.unheard { color: var(--dc-red); border-color: var(--dc-red); }
.dc-lines .dc-gap { height: .7em; }
.dc-pix { image-rendering: pixelated; image-rendering: crisp-edges; max-width: 100%; height: auto; display: block; background: var(--dc-parch-shade); border-radius: 4px; }
.dc-thumb { display: grid; gap: 6px; align-content: start; text-align: left; font: inherit; color: inherit; cursor: zoom-in; border: 1px solid var(--dc-parch-edge); border-radius: 6px; padding: 8px; background: var(--dc-parch); color: var(--dc-ink); box-shadow: inset 0 0 0 3px var(--dc-parch-shade); }
.dc-thumb small { overflow-wrap: anywhere; }
.dc-thumb img { width: 100%; height: 150px; object-fit: contain; }
.dc-thumb b { font-weight: 400; font-family: var(--dc-display); font-size: 16px; }
.dc-thumb small { color: var(--dc-ink-soft); font-size: 12px; }
.dc-lightbox { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 16px; background: rgba(20,12,4,.86); }
.dc-lightbox .dc-panel { max-width: min(92vw, 860px); max-height: 92vh; overflow: auto; }
.dc-lightbox img { width: 100%; max-height: 64vh; object-fit: contain; cursor: zoom-out; }
.dc-sound { display: grid; gap: 6px; }
.dc-sound audio, .dc-sound video { width: 100%; }
.dc-credits { columns: 2 220px; column-gap: 24px; text-align: center; font-size: 14px; }
.dc-credits .role { font-family: var(--dc-display); color: var(--dc-ink-soft); margin-top: 10px; break-after: avoid; }
.dc-credits .role + .role { margin-top: 0; }
.dc-credits .name { letter-spacing: .04em; white-space: pre-wrap; }
.dc-telegram { font-family: 'Courier New', ui-monospace, monospace; background: #efe3c2; border: 1px solid var(--dc-parch-edge); padding: 12px; white-space: pre-wrap; font-size: 14px; }
.dc-redacted { background: var(--dc-ink); color: var(--dc-ink); border-radius: 2px; padding: 0 .3em; user-select: none; }
.dc-close { position: absolute; top: 12px; right: 12px; }
/* Gramophone */
.dc-gramo { width: min(100%, 340px); display: grid; gap: 10px; justify-items: center; text-align: center; }
.dc-gramo img.dc-pix { width: 166px; max-width: 60%; }
.dc-record { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; width: 100%; }
.dc-record .title { font-family: var(--dc-display); font-size: 18px; }
.dc-record .line { font-size: 13px; color: var(--dc-ink-soft); }
.dc-vol { width: 100%; display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; font-size: 13px; }
.dc-vol input { width: 100%; accent-color: var(--dc-brass-lo); }
.dc-row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
/* Freight offer card (sits beside the elevator's two .offer cards) */
.dc-offer { border: 1px solid var(--dc-parch-edge); border-radius: 6px; padding: 8px 10px; background: rgba(255,255,255,.35); display: grid; gap: 6px; align-content: start; color: var(--dc-ink); font-family: var(--dc-serif); }
.dc-offer .big { font-family: var(--dc-display); font-size: 24px; font-variant-numeric: tabular-nums lining-nums; }
.dc-offer input[type=radio] { accent-color: var(--dc-brass-lo); }
.dc-offer label { display: grid; grid-template-columns: auto 1fr auto; gap: 6px; align-items: baseline; font-size: 13px; cursor: pointer; }
.dc-offer .muted { color: var(--dc-ink-soft); font-size: 13px; }
.dc-offer .warn { color: var(--dc-red); font-size: 13px; }
@media (max-width: 600px) { .dc-root { padding: 12px; } .dc-credits { columns: 1; } }
`;
