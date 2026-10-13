# Parity tracking

Target: the supplied Windows build of OpenNBS, in Chromium, entirely client-side.

This file describes implemented behavior, not a certification of exact parity.
The provided GameMaker compiler/runtime is not installed in the development
environment, so a native reference build and screenshot/audio oracle could not
be run. The existing HTML5 configuration does not remove startup calls to native
MIDI, window, Python, process and filesystem extensions. The browser implementation
therefore uses TypeScript rather than an unverified GameMaker export.

## Implemented and exercised

| Area | Browser implementation | Reference |
|---|---|---|
| NBS | Read 0–6; write 0–6; metadata, layer properties, loop data, signed pitch, custom instruments, legacy v5 limits | `open_song_nbs`, `save_song` |
| Editing | Place/change/erase, rectangular/additive selection, move, clipboard, layer management, undo/redo, tabs | `control_draw`, action/selection scripts |
| Rendering | Original sprites, 32px grid, 266px layer panel, original 39px piano keys, theme palettes, accents, scaling | `control_draw`, `draw_block`, `draw_piano_key` |
| Macros | Tremolo, stereo, arpeggio, portamento, vibrato, stagger, chorus, volume LFO, fades, replace key, setters and reset | `macro_*`, `draw_window_macro_*` |
| Audio | Original samples, gain/pan/pitch, tempo changes, metronome, loop playback, live recording, sound stoppers | `play_sound`, playback code |
| Persistence | Recent songs, crash recovery, native Chromium file handles, download fallback, settings.ini exchange | browser adapters |
| Patterns | Native selection codes; NBP v0–2 parsing and v2 writing with custom definitions | `pattern_import`, `pattern_export` |
| MIDI | SMF 0/1, running status, tempo events, source GM/drum mappings, sustained notes, Web MIDI input | `midi_instruments`, `import_midi` |
| Exports | Native NBS, NBP, custom-sound ZIP, offline-rendered WAV/MP3/AIFF/FLAC, basic vanilla-sound data pack | browser codecs and local FFmpeg WASM |
| Distribution | Static production build, install manifest, production offline cache | browser adapters |

## Partial parity / remaining implementation

- **Visual parity:** menus and dialogs use DOM controls. Most dialogs do not yet
  match desktop geometry exactly. No native-vs-browser pixel comparison has run.
  Layer controls and the timeline also need complete interaction parity.
- **Preferences:** the generator inventories source settings; the current UI exposes
  the implemented subset. Import/export preserves recognized settings, but does not
  make all of them operative. Original preference grouping, translations, typography,
  acrylic/liquid glass, note chart, dynamic wallpaper and animations remain incomplete.
- **Selection:** floating-selection placement rules, locked-destination handling,
  all selection expansion modes and some context-menu actions need further porting.
- **Macros:** algorithms are source-derived and representative outputs are tested;
  exact dialogs, all setter modes, Alt-to-retain-selection, and every edge case remain.
- **Audio:** Web Audio panning/resampling are not verified against GameMaker's audio
  engine. Sound-stopper edge cases, recording quantization, reference-audio transport
  and looping synchronization, voice limits, and player/drop mode need more work.
- **MIDI:** basic options are functional. Original per-part mappings, precision,
  tempo-changer import, fade controls, pedal/pitch-wheel handling are incomplete.
- **Minecraft:** schematic/branch/track/structure import/export is not implemented.
  The data-pack exporter supports vanilla in-range notes and tick quantization only;
  it rejects unsupported custom/out-of-range sounds rather than silently dropping
  them. Resource-pack generation, stereo positioning, loop controls, visualizers,
  command-source catalogs and Minecraft version-specific options remain.
- **Audio export:** WAV, MP3, AIFF and FLAC are implemented and browser-tested;
  the full original FFmpeg/Python rendering options remain incomplete.
- **Resource packs:** custom samples and packaged songs work. Minecraft installation
  sound discovery and sounds.json mappings are not implemented.
- **Large projects:** no native performance-parity benchmark has run. History uses
  bounded whole-song snapshots; a patch-based history would reduce memory usage.

## Browser adaptations

Native taskbar effects, desktop wallpaper discovery, executable auto-updates,
Discord RPC, protocol registration, unrestricted path access and single-instance
TCP coordination have no direct normal-browser equivalent. Reserved shortcuts are
owned by Chromium unless a supported fullscreen keyboard-lock mode releases them.
Autosave can overwrite an already-authorized native file; the download-only fallback
stores autosaves in browser storage. Recovery is independent of autosave settings.

## Next parity gates

1. Build the supplied Windows source with GameMaker 2022.0.3 LTS and capture the
   default editor, each dialog/theme, input sequences and sample audio outputs.
2. Port remaining source functions by subsystem and add behavior fixtures for each.
3. Compare native/browser saved files, macro results, timing, export contents and
   screenshots; close the discrepancies above before calling the port complete.
