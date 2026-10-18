# Go West! — The Homesteader’s Challenge (remake)

A browser remake of *Go West! The Homesteader’s Challenge* (Edunetics, 1996), the Kansas-homesteading
game. It runs entirely in the browser.

**Play it:** https://gowest-remaster.github.io/

It comes in two looks that share one simulation and one save:

- **Remastered** (default): a pre-rendered 3D homestead and town with a new interface.
- **Classic**: a replica of the original 1996 screens. Open it with `?look=classic`, or switch at New Game.

Saves stay in your browser (IndexedDB/localStorage). Nothing is sent anywhere.

## Credits and licences

- **In-game credits:** title screen → *About this remaster* → *Credits*. They list the original team and every
  third-party asset.
- **3D models, textures and skies:** [`public/world/ATTRIBUTION.json`](public/world/ATTRIBUTION.json) lists each
  CC-BY / CC0 asset with its author, source URL and the files it is used in.
- **Music, voice and sound:** [`public/assets/audio/LICENSES.md`](public/assets/audio/LICENSES.md).
- **Fonts:** Google Fonts under the SIL Open Font License, bundled in `public/fonts/`.
- **Decoders:** three.js Draco and Basis transcoders in `public/world/libs/` keep their own licences.
- The original game’s art, text, voice and music belong to their rights holders. They are included only to
  preserve and replay the 1996 game.

## Build

Requires [Bun](https://bun.sh).

```sh
bun install
bun run dev        # local dev server
bun run build      # type-check + production build into dist/
bun run preview    # serve dist/
```

The site is served from the root. To build for a sub-path instead (a GitHub Pages project site), set the base:

```sh
BASE_PATH=/<repo>/ bun run build
```

The `pages` workflow in `.github/workflows/` builds and deploys to GitHub Pages on every push to `main`.
