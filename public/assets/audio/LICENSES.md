# Audio licenses and provenance

## Music (`music/`)

- **Main theme:** "GANCOUA" (`DATA/SOUND/TOWNMAP/GANCOUA.MID`) is from the original 1996 *Go West!* game
  (music by Ganelin). The remake ships it for the same game, newly arranged:
  - `title` / `theme_full` are theme_cozy_v3.
  - `parlor` is solo piano.
  - `theme_guitar` (Hearthside) and `theme_daylight` are further full-theme arrangements.
  - `goal` quotes the opening phrase.
  - `finale` states the full theme.
- **New compositions** for this project: `home_summer`, `home_autumn`, `home_winter`, `field`, `interior`,
  `disaster`, `new_year`, all `sting_*`, plus the earlier leitmotif cues (`home_spring` = Prairie Morning,
  `town` = Main Street, `lamplight`, `harvest` = Harvest Home). They're written as MIDI in
  `tools/audio/score.py` and `tools/audio/compose.py`, and quote only short motifs of the theme.
- **Rendering:** the cues are rendered with FluidSynth and the **GeneralUser GS v2.0.3** SoundFont by
  S. Christian Collins. Its license (`tools/audio/sf/GeneralUser-GS-main/documentation/LICENSE.txt`) allows
  use "without restriction for your own music creation, private or commercial".
- **Build:** loops, mastering and encoding are done by `tools/audio/build_music.py`. No AI-generated music
  ships. The MusicGen experiments in `remaster/music/ai/` aren't used.

## Voice (`voice/`)

These are the **original 1996 *Go West!* voice recordings** (`assets/**/*.wav`, `assets/external/DATA/SOUND/**`),
shipped with the remake of the same game. They were not regenerated, cloned or replaced. Processing is limited
to DC removal, a 50 Hz rumble high-pass, a single linear gain to −18 LUFS (capped at −1.5 dBTP) and Opus/AAC
encoding, all done by `tools/audio/voice_pipeline.py`.

Caption timings come from faster-whisper (small.en, MIT license) word timestamps, aligned to the
hand-corrected transcripts in `src/content/voice.json`.

## Ambience (`ambience/`)

All ambience beds and thunder one-shots are **procedurally synthesized** by
`tools/audio/ambience.py` (with helpers in `tools/audio/audiolib.py`), using numpy/scipy noise shaping,
modal resonators and simple physical models. They're project-original works and contain **no
third-party samples or recordings**. Nothing was downloaded. Generation is deterministic (fixed seeds),
so `python tools/audio/ambience.py remake/public/assets/audio/ambience` reproduces the files.

| id | content |
|---|---|
| wind_light, wind_strong, grass_rustle, snow_wind | shaped noise bands with slow random gust envelopes |
| birds_morning | synthesized whistles modeled loosely on the western meadowlark's song, plus small-bird chirps |
| crickets_night | pulsed-tone cricket chirps and a faint tree-cricket trill over shaped noise |
| rain | shaped noise and resonant droplet impulses |
| town_bustle | wordless formant-filtered "murmur" (no speech), synthesized hoof clops, wagon creaks, anvil and wood hammer |
| hearth | fire roar from noise and impulse crackles |
| clock_tick | modal wooden ticks |
| windmill_creak | stick-slip friction creaks, rod clunk and blade whoosh |
| farm_animals | source-filter synthesized cattle and chickens over light wind |
| thunder_1..3 | layered noise rumbles |

No original-game recordings are used in the ambience. `assets/SHARED/3301-COWS.wav` was evaluated but not
used, because it has a constant herd/noise floor and is 8-bit.

## UI SFX (`ui/`)

paper, paper_soft, coin, coin_small, tick, chime, store_bell and stamp are **procedurally synthesized** by
`tools/audio/ui_sfx.py` (modal synthesis plus filtered noise). They're project-original, with no third-party
samples. The legacy `sfx/` folder (the old build's original-game effects) is unchanged.
