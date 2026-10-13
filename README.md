# OpenNBS Web

A local-first TypeScript/Canvas/Web Audio port of the supplied Windows GameMaker
application. Chromium is the primary browser. Songs and audio stay on the device;
the app needs only static hosting, with no application server or desktop helper.

**Status: working development port, not full feature or pixel parity.** Based on
[Open Note Block Studio](https://github.com/OpenNBS/NoteBlockStudio), version
`3.12.0-beta.6`, NBS version 6. See [PARITY.md](PARITY.md) for remaining work.

## Features

- Note and layer editing, selections, undo/redo, song tabs and source-derived macros.
- Original note sprites, piano artwork and instrument samples.
- NBS versions 0–6, NBP patterns, MIDI import and Web MIDI input.
- Custom sound files and recursive sound-folder import.
- Sample-based playback, looping, tempo changes and live recording.
- WAV, MP3, AIFF and FLAC exports, plus basic vanilla-sound data packs.
- Local recovery, recent songs and production offline caching.

## Requirements

- Node.js 22.12+ or a supported newer LTS, npm and Git.
- Chromium (Chrome or Edge recommended).
- The upstream source checkout below, which supplies the original assets.

## Get the source

Clone this repository. If it includes a registered `NoteBlockStudio` submodule,
clone with `--recurse-submodules`, or initialize it afterwards:

```sh
git submodule update --init --recursive
```

If `NoteBlockStudio/` is absent and there is no submodule registered, fetch the
upstream project separately and use the tested revision:

```sh
git clone https://github.com/OpenNBS/NoteBlockStudio.git NoteBlockStudio
git -C NoteBlockStudio checkout 51e4dab45fae77b108b9211645f829d38c4ed3b7
```

The build expects that folder next to `package.json`. Its contents are ignored by
default so the GameMaker source is not accidentally copied into this repository.
A registered submodule stores only the upstream URL and commit reference.

## Run

```sh
npm ci
npm run dev
```

Open http://localhost:5173 in Chromium. The asset extraction runs before starting
the dev server. The supplied `NoteBlockStudio` folder must be present.

```sh
npm run build
npm run preview
```

Deploy the **contents of `dist/`** to any HTTPS static host. Relative asset paths
support hosting at a subdirectory. `file://` is not supported. HTTPS or localhost
is needed for native file pickers, Web MIDI, clipboard and offline installation.
The production service worker caches the shell, sprite frames and vanilla sounds;
other sounds, examples and the FFmpeg encoder are cached when used. Imported sounds and recovery are
stored in IndexedDB. Clearing site data removes those local copies.

## Controls

- Click in the grid to place/change notes; drag to select; drag selected notes to move.
- Right click/drag erases; middle click picks a note; Ctrl+middle click also picks properties.
- Scroll on notes to change the active key/velocity/panning/pitch mode.
- Space plays/pauses; Enter stops; Ctrl+Z/Y undoes/redoes.
- Ctrl+A/C/X/V selects/copies/cuts/pastes. Delete removes selection.
- Original piano bindings and macro shortcuts are available under Help.
- Right click a piano key to rebind it. Layer volume/panning support dragging.
- Open or drop `.nbs`, `.nbp`, MIDI, or packaged song ZIP files. Import custom sound
  files through Instrument settings or drag-and-drop.
- To use an existing desktop sound library, choose **Settings → Instrument settings
  → Import sound folder…** and select its `sounds` folder (for example
  `%APPDATA%\Minecraft_Note_Block_Studio\data\sounds` on Windows).
  Subfolder paths are preserved and files are copied into browser storage; select
  the folder again to import later changes. Samples are decoded only when played.

Browser-owned shortcuts such as Ctrl+N/W and Ctrl+1–9 are not reliably interceptable
in a normal tab. Menu actions remain available; fullscreen keyboard lock is used
where Chromium permits it.

## Checks

```sh
npm run assets
npm test
npx playwright install chromium
npm run test:browser
npm run build
npm run test:offline
```

Unit tests include every supplied song, native pattern import, NBS versions 0–6,
legacy custom-instrument ID limits, signed fine pitch, macro outputs, rollback,
tempo-map integration, MIDI parsing and data-pack structure. Browser tests exercise
real editing, file downloads, playback, audible offline WAV rendering, recovery,
layer locking, MP3/AIFF/FLAC encoding and production offline reload.

## Structure

- `tools/extract-assets.mjs`: preserves GameMaker sprite-frame order; extracts
  instrument/MIDI definitions, bundled songs and settings inventory directly from source.
- `src/model.ts`, `nbs.ts`, `patterns.ts`, `binary.ts`: song/history model and file codecs.
- `src/macros.ts`: source-derived editing transformations.
- `src/audio.ts`: sample playback, scheduling, tempo changes and offline WAV rendering.
- `src/audio-export.ts`: locally hosted FFmpeg WebAssembly encoding for MP3, AIFF and FLAC.
- `src/midi.ts`, `datapack.ts`: browser-side import/export.
- `src/editor.ts`: canvas grid and original piano sprite rendering.
- `src/main.ts`: interactions, menus, dialogs and browser integration.
- `src/storage.ts`, `settings.ts`: native picker/download adapters and persistence.
- `src/generated/`, `public/assets/`, `dist/`: generated by the build.

The source is MIT licensed; the original attribution is retained in `LICENSE`
and the generated assets. Bundled resource assets retain their supplied notices.
The separately loaded FFmpeg WebAssembly core has its own GPL license; see
[third-party notices](public/THIRD_PARTY_NOTICES.txt) and `public/licenses/`.

## Repository contents

Commit the application source, tests, build tools, configuration, `package-lock.json`,
documentation and license notices. Generated assets are recreated from the upstream
checkout by `npm run assets`, `npm run dev` or `npm run build`.

`.gitignore` excludes dependencies, build output, generated assets, upstream source
files, test reports, local agent/editor state, environment files and logs. GitHub
hosts the code; deploying the app separately requires serving the built `dist/`
folder over HTTPS.
