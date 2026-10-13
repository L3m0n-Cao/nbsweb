import './style.css';
import { assets, assetUrl, iconHtml, spriteUrl } from './assets';
import { AudioEngine } from './audio';
import { escapeHtml as esc, fieldHtml, formDialog, message, openDialog, type Field } from './dialog';
import { GridRenderer, PianoRenderer, type EditorView } from './editor';
import { applyMacro, macroNames, type Macro, type MacroOptions } from './macros';
import { cell, clamp, endTick, ensureLayers, History, keyName, newLayer, newSong, normalize, tempoMap, tickSeconds, type Instrument, type Note, type Song } from './model';
import { readNbs, writeNbs } from './nbs';
import { parseSelection, readPattern, selectionCode, writePattern } from './patterns';
import { Settings } from './settings';
import { compressNotes, moveNotes } from './selection';
import { getStored, pickFiles, pickSoundFolder, putStored, saveFile, type FileHandle } from './storage';
import { unzipSync, zipSync } from 'fflate';
import { importMidi } from './midi';
import { exportDatapack } from './datapack';
import { encodeAudio, type AudioFormat } from './audio-export';

const settings = new Settings(), audio = new AudioEngine();
interface Tab { history: History; handle?: FileHandle; selected: Set<string>; x: number; y: number; marker: number; section?: [number, number]; reference?: AudioEngine['reference']; instrument: number }
const tabs: Tab[] = []; let active = 0;
const tab = () => tabs[active], song = () => tab().history.song;
let instrument = 0, selectedKey = 39, velocity = 100, pan = 100, pitch = 0, mode = 0, record = false, loop = false;
let clipboard: { notes: Note[]; instruments: Instrument[] } | undefined;
let hover: EditorView['hover'], marquee: EditorView['marquee'], statusMessage = '', statusUntil = 0;
let pianoBindings: Record<string, number> = Object.fromEntries([...('1Q2W3ER5T6YU8I9O0PZSXDCVG')].map((key, i) => [key.toLowerCase(), 33 + i]));
try { pianoBindings = JSON.parse(localStorage.getItem('nbs-piano-bindings') ?? 'null') ?? pianoBindings; } catch { /* keep defaults */ }
const root = document.querySelector<HTMLDivElement>('#app')!;
root.innerHTML = `<nav id="menubar" aria-label="Main menu"></nav><div id="tabs" role="tablist"></div><div id="toolbar" role="toolbar" aria-label="Song tools"></div>
  <main id="workspace"><aside id="layers"><div class="layer-heading">Layers</div><div id="layer-rows"></div></aside><div id="grid-wrap"><canvas id="grid" tabindex="0" aria-label="Note editor"></canvas><input id="vertical-scroll" type="range" aria-label="Scroll layers" min="0" max="100" value="0"><input id="horizontal-scroll" type="range" aria-label="Scroll timeline" min="0" max="100" value="0"></div></main>
  <div id="controls"><div id="macrobar" role="toolbar" aria-label="Macros"></div><button id="tempo" title="Set song tempo"></button><button id="tap-tempo" title="Tempo tapper">Tap tempo</button><label class="volume-label">Volume <input id="volume" aria-label="Master volume" type="range" min="0" max="100" value="100"></label><span id="position"></span><button id="fullscreen" title="Fullscreen editor">⛶</button></div>
  <div id="piano-wrap"><button id="piano-left" aria-label="Scroll piano left">‹</button><canvas id="piano" aria-label="Piano keyboard"></canvas><button id="piano-right" aria-label="Scroll piano right">›</button></div><div id="status" role="status"></div><div id="drop-overlay">Drop songs, patterns, MIDI files, or sound files to open</div>`;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
const view = (): EditorView => ({ song: song(), settings, selected: tab().selected, marker: audio.playing ? audio.position : tab().marker,
  playing: audio.playing, x: tab().x, y: tab().y, key: selectedKey, instrument, mode, section: tab().section, hover, marquee, pianoBindings });
const grid = new GridRenderer($<HTMLCanvasElement>('#grid'), view), piano = new PianoRenderer($<HTMLCanvasElement>('#piano'), view);
function notify(text: string) { statusMessage = text; statusUntil = performance.now() + 5000; }
function error(err: unknown) { console.error(err); message('Note Block Studio', err instanceof Error ? err.message : String(err)); }
function run(fn: () => void | Promise<unknown>) { try { Promise.resolve(fn()).catch(error); } catch (err) { error(err); } }
function addTab(s = newSong(), handle?: FileHandle) {
  audio.stop(); audio.reference = undefined; tabs.push({ history: new History(s), handle, selected: new Set(), x: 0, y: 0, marker: 0, instrument: 0 }); active = tabs.length - 1; instrument = 0; loop = s.loop; refresh();
}
function switchTab(index: number) { if (audio.playing) tab().marker = audio.position; audio.stop(false); active = index; audio.reference = tab().reference; loop = song().loop; instrument = Math.min(tab().instrument, song().instruments.length - 1); refresh(); }
function edit(fn: (s: Song) => void) { audio.stop(false); tab().history.edit(fn); refresh(); scheduleRecovery(); }
function selectedNotes() { return song().notes.filter(n => tab().selected.has(cell(n))); }
function transform(fn: (notes: Note[]) => Note[]) {
  const ids = new Set(tab().selected), input = selectedNotes(); if (!input.length) return;
  let output: Note[] = [];
  edit(s => { output = fn(structuredClone(input)); s.notes = s.notes.filter(n => !ids.has(cell(n))).concat(output); });
  tab().selected = new Set(output.map(cell)); refresh();
}
function chooseInstrument(i: number, preview = true) { instrument = i; tab().instrument = i; velocity = 100; pan = 100; pitch = 0; if (preview) playKey(selectedKey); refresh(); }
function playKey(key: number, vel = velocity) {
  if (settings.n('select_lastpressed')) selectedKey = key;
  if (record) {
    const tick = Math.ceil(audio.playing ? audio.position : tab().marker), s = song(); let layer = 0;
    while (s.notes.some(n => n.tick === tick && n.layer === layer) || s.layers[layer]?.locked) layer++;
    tab().history.edit(s => { s.notes.push({ tick, layer, instrument, key, velocity: vel, pan, pitch }); }); scheduleRecovery(); refresh();
    if (!audio.playing) run(togglePlay);
  }
  run(() => audio.preview(song().instruments[instrument], { tick: 0, layer: 0, instrument, key, velocity: vel, pan, pitch }));
}
function refresh() {
  if (!tabs.length) return;
  const s = song(), h = tab().history, dark = settings.n('theme') === 2 || (settings.n('theme') === 3 && !!settings.n('fdark'));
  document.body.dataset.theme = String(settings.n('theme')); document.body.classList.toggle('dark', dark);
  document.documentElement.style.setProperty('--accent', settings.s('accent'));
  const scale = clamp(settings.n('window_scale') || 1, .5, 4); document.documentElement.style.setProperty('--scale', String(scale));
  root.classList.toggle('hide-layers', !settings.n('show_layers')); root.classList.toggle('hide-piano', !settings.n('show_piano'));
  root.classList.toggle('single-tab', tabs.length === 1);
  root.style.setProperty('--layer-background', `url("${spriteUrl('spr_layerbox', settings.n('theme') === 3 ? 2 + +dark : settings.n('theme') === 2 ? 1 : 0)}")`);
  document.title = `${h.dirty ? '* ' : ''}${s.name || s.filename.replace(/\.nbs$/i, '') || 'Untitled song'} — Note Block Studio`;
  $('#tabs').innerHTML = tabs.map((t, i) => `<div class="song-tab ${active === i ? 'active' : ''}"><button role="tab" aria-selected="${i === active}" data-tab="${i}">${esc(t.history.song.name || t.history.song.filename || 'Untitled song')}${t.history.dirty ? ' *' : ''}</button><button data-close="${i}" aria-label="Close ${esc(t.history.song.name || 'Untitled song')}">×</button></div>`).join('') + '<button class="new-tab" data-cmd="new" aria-label="New song">+</button>';
  const icon = (name: string) => iconHtml(name, dark, settings.n('theme') !== 3);
  const tool = (id: string, label: string, image: string, on = false, disabled = false) => `<button class="tool ${on ? 'on' : ''}" data-cmd="${id}" title="${esc(label)}" aria-label="${esc(label)}" ${disabled ? 'disabled' : ''}>${icon(image)}</button>`;
  $('#toolbar').innerHTML = tool('new', 'New song (Ctrl+N)', 'NEW') + tool('open', 'Open song (Ctrl+O)', 'OPEN') + tool('save', 'Save song (Ctrl+S)', 'SAVE') + '<i></i>' +
    tool('play', 'Play / Pause song (Space)', audio.playing ? 'PAUSE' : 'PLAY') + tool('stop', 'Stop song (Enter)', 'STOP') + tool('back', 'Rewind song', 'BACK') + tool('forward', 'Fast-forward song', 'FORWARD') + tool('record', 'Record key presses', 'RECORD', record) + tool('loop', 'Toggle looping', loop ? 'LOOP' : 'LOOP_INACTIVE', loop) + tool('metronome', 'Toggle metronome', audio.metronome ? 'METRONOME_1' : 'METRONOME_INACTIVE', audio.metronome) + '<i></i>' +
    ['key', 'velocity', 'panning', 'pitch'].map((label, i) => tool(`mode:${i}`, `Edit note ${label}`, ['EDITMODE_KEY', 'EDITMODE_VEL', 'EDITMODE_PAN', 'EDITMODE_PIT'][i], mode === i)).join('') + '<i></i>' +
    `<div id="instrument-tools">${s.instruments.slice(0, 20).map((ins, i) => tool(`instrument:${i}`, ins.name, `INS_${i + 1}`, instrument === i)).join('')}</div>` + tool('instruments', 'Instrument settings', 'INSTRUMENTS') + '<i></i>' + tool('undo', 'Undo (Ctrl+Z)', 'UNDO', false, !h.canUndo) + tool('redo', 'Redo (Ctrl+Y)', 'REDO', false, !h.canRedo) + tool('copy', 'Copy (Ctrl+C)', 'COPY', false, !tab().selected.size) + tool('cut', 'Cut (Ctrl+X)', 'CUT', false, !tab().selected.size) + tool('paste', 'Paste (Ctrl+V)', 'PASTE') + tool('delete', 'Delete', 'DELETE', false, !tab().selected.size) + tool('info', 'Song info', 'INFORMATION') + tool('properties', 'Song properties', 'PROPERTIES');
  const compatible = s.notes.every(n => n.instrument < 20 && n.key >= 33 && n.key <= 57 && !n.pitch);
  $('#toolbar').insertAdjacentHTML('beforeend', `<button class="compatibility ${compatible ? 'ok' : ''}" data-cmd="compatibility">${compatible ? 'Fully compatible' : 'Data pack / resource pack'} <img src="${spriteUrl('spr_minecraft_f', compatible ? 0 : 1)}" alt=""></button>`);
  $('#macrobar').innerHTML = tab().selected.size ? macroNames.map((name, i) => `<button class="macro" data-cmd="macro:${name}" title="${name}" aria-label="${name}"><img alt="" src="${spriteUrl('spr_macroicons', i)}"></button>`).join('') : '';
  $('#tempo').textContent = `${settings.n('use_bpm') ? 'BPM' : 'Tempo'}: ${+(s.tempo * (settings.n('use_bpm') ? 15 : 1)).toFixed(2)}`;
  $<HTMLInputElement>('#volume').value = String(settings.n('mastervol') * 100);
  audio.volume = settings.n('mastervol'); audio.stereo = !settings.n('realstereo'); audio.layerVolumes = !!settings.n('realvolume'); audio.loop = loop;
  renderLayers(); grid.draw(); piano.draw();
  $<HTMLInputElement>('#horizontal-scroll').max = String(Math.max(128, endTick(s) + 32, tab().x)); $<HTMLInputElement>('#horizontal-scroll').value = String(tab().x);
  $<HTMLInputElement>('#vertical-scroll').max = String(Math.max(32, s.layers.length + 8, tab().y)); $<HTMLInputElement>('#vertical-scroll').value = String(tab().y);
}
function renderLayers() {
  const rows = Math.max(1, Math.ceil(($('#workspace').clientHeight / (settings.n('window_scale') || 1) - 32) / 32));
  const fluent = settings.n('theme') === 3, dark = document.body.classList.contains('dark');
  const layerIcon = (i: number) => `<img alt="" draggable="false" src="${spriteUrl(fluent ? 'spr_layericons_f_hires' : 'spr_layericons', i + (fluent && !dark ? 9 : 0))}">${fluent ? `<span class="layer-accent" style="mask-image:url('${spriteUrl('spr_layericons_f_hires', i + 18)}')"></span>` : ''}`;
  const valueIcon = (type: 'volume' | 'stereo', value: number) => `<img alt="" src="${spriteUrl(fluent ? `spr_${type}_f_hires` : `spr_${type}`, fluent ? +!dark : Math.floor(value / (type === 'volume' ? 30 : 50)))}">${fluent ? `<span class="layer-accent value-accent" style="mask-image:url('${spriteUrl(`spr_${type}_f_hires`, Math.floor(value / (type === 'volume' ? 30 : 50)) + 2)}')"></span>` : ''}`;
  $('#layer-rows').innerHTML = Array.from({ length: rows }, (_, offset) => {
    const i = tab().y + offset, l = song().layers[i] ?? newLayer();
    return `<div class="layer ${l.locked ? 'locked' : ''}" data-layer="${i}"><button class="layer-name" data-layer-action="name" title="Rename layer">${esc(l.name || `Layer ${i + 1}`)}</button><button class="layer-volume" data-layer-action="volume" aria-label="Layer ${i + 1} volume" title="Volume: ${l.volume}% — drag to adjust">${valueIcon('volume', l.volume)}</button><button class="layer-pan" data-layer-action="pan" aria-label="Layer ${i + 1} panning" title="Panning: ${l.pan - 100} — drag to adjust">${valueIcon('stereo', l.pan)}</button>${[['lock', 'Lock / mute layer'], ['solo', 'Solo layer'], ['select', 'Select layer'], ['add', 'Insert layer'], ['remove', 'Remove layer'], ['up', 'Move layer up'], ['down', 'Move layer down']].map(([action, title], j) => `<button data-layer-action="${action}" title="${title}" aria-label="${title}" class="${(action === 'lock' && l.locked) || (action === 'solo' && l.solo) ? 'on' : ''}">${layerIcon(j)}</button>`).join('')}</div>`;
  }).join('');
}
function selectedEdit(property: 'key' | 'velocity' | 'pan' | 'pitch', amount: number) { transform(notes => notes.map(n => ({ ...n, [property]: n[property] + amount }))); }
function copy() {
  const notes = selectedNotes(); if (!notes.length) return;
  clipboard = { notes: structuredClone(notes), instruments: structuredClone(song().instruments) };
  navigator.clipboard?.writeText(selectionCode(notes)).catch(() => {}); notify(`Copied ${notes.length} note blocks`);
}
async function paste() {
  if (!clipboard) { const code = await navigator.clipboard.readText(); clipboard = { notes: parseSelection(code), instruments: structuredClone(song().instruments) }; }
  if (!clipboard.notes.length) return;
  const target = hover ?? { tick: Math.floor(tab().marker), layer: tab().y }, minTick = Math.min(...clipboard.notes.map(n => n.tick)), minLayer = Math.min(...clipboard.notes.map(n => n.layer));
  let added: Note[] = [];
  edit(s => {
    const remap = new Map<number, number>();
    for (const n of clipboard!.notes) if (n.instrument >= 20 && !remap.has(n.instrument)) {
      const ins = clipboard!.instruments[n.instrument]; if (!ins) throw new Error('The clipboard is missing a custom instrument.');
      let id = s.instruments.findIndex(v => JSON.stringify(v) === JSON.stringify(ins));
      if (id < 0) { if (s.instruments.length >= 256) throw new Error('Too many custom instruments.'); id = s.instruments.length; s.instruments.push(structuredClone(ins)); } remap.set(n.instrument, id);
    }
    added = clipboard!.notes.map(n => ({ ...n, instrument: remap.get(n.instrument) ?? n.instrument, tick: n.tick - minTick + target.tick, layer: n.layer - minLayer + target.layer })); s.notes.push(...added);
  });
  tab().selected = new Set(added.map(cell)); refresh();
}
async function openFiles() { for (const { file, handle } of await pickFiles(undefined, true)) await openFile(file, handle); }
async function openFile(file: File, handle?: FileHandle) {
  const bytes = new Uint8Array(await file.arrayBuffer()), ext = file.name.split('.').at(-1)?.toLowerCase();
  if (ext === 'nbs') { addTab(readNbs(bytes, file.name), handle); await remember(song()); }
  else if (ext === 'mid' || ext === 'midi') midiDialog(bytes, file.name);
  else if (ext === 'nbp') {
    const pattern = readPattern(bytes), instruments = structuredClone(song().instruments);
    for (const [id, ins] of pattern.instruments) instruments[id] = ins;
    clipboard = { notes: pattern.notes, instruments }; await paste();
  } else if (ext === 'zip') {
    const files = unzipSync(bytes), nbsNames = Object.keys(files).filter(n => /\.nbs$/i.test(n));
    if (!nbsNames.length) throw new Error('No NBS song was found in this archive.');
    for (const [name, data] of Object.entries(files)) if (/\.(ogg|wav|mp3|flac)$/i.test(name)) { const basename = name.split('/').at(-1)!; await audio.install(basename, data); await audio.install(name, data); }
    for (const name of nbsNames) { addTab(readNbs(files[name], name.split('/').at(-1)!)); await remember(song()); }
  } else if (/^(ogg|wav|mp3|flac)$/.test(ext ?? '')) {
    await audio.install(file.name, bytes); edit(s => { if (s.instruments.length >= 256) throw new Error('Too many custom instruments.'); s.instruments.push({ name: file.name.replace(/\.[^.]+$/, ''), file: file.name, key: 45, press: true }); }); chooseInstrument(song().instruments.length - 1);
  } else throw new Error(`Unsupported file: ${file.name}`);
  notify(`Opened ${file.name}`);
}
async function save(asNew = false) {
  const t = tab(), s = t.history.song, snapshot = structuredClone(s), name = s.filename || `${s.name || 'Untitled song'}.nbs`;
  const result = await saveFile(writeNbs(snapshot), name, asNew ? undefined : t.handle);
  if (result === null) return;
  snapshot.filename = result?.name ?? name;
  if (result) t.handle = result;
  t.history.song.filename = snapshot.filename;
  t.history.saved = JSON.stringify(snapshot); await remember(snapshot); scheduleRecovery(); refresh(); notify('Song saved');
}
async function remember(s: Song) {
  const recent = await getStored<Song[]>('state', 'recent') ?? [];
  await putStored('state', 'recent', [structuredClone(s), ...recent.filter(v => v.id !== s.id)].slice(0, 11));
}
let recoveryTimer: ReturnType<typeof setTimeout>;
function scheduleRecovery() { clearTimeout(recoveryTimer); recoveryTimer = setTimeout(() => run(() => putStored('state', 'recovery', tabs.filter(t => t.history.dirty).map(t => t.history.song))), 750); }
function closeTab(index: number) {
  const close = () => { audio.stop(); tabs.splice(index, 1); active = Math.max(0, Math.min(active, tabs.length - 1)); if (!tabs.length) addTab(); else refresh(); scheduleRecovery(); };
  if (!tabs[index].history.dirty) { close(); return; }
  openDialog('Save changes?', `<p>Save changes to ${esc(tabs[index].history.song.name || 'Untitled song')}?</p>`, [{ label: 'Cancel' }, { label: 'Discard', run: close }, { label: 'Save', primary: true, run: async () => { switchTab(index); await save(); if (tab().history.dirty) throw new Error('The song has not been saved.'); close(); } }]);
}

async function togglePlay() {
  if (audio.playing) { tab().marker = audio.position; audio.stop(false); }
  else {
    let start = tab().marker;
    if (start > endTick(song())) start = 0;
    if (settings.n('marker_start') && tab().section) start = tab().section![0];
    audio.section = settings.n('marker_end') ? tab().section : undefined;
    await audio.play(song(), start);
  }
  refresh();
}
audio.onStop = () => { tab().marker = 0; refresh(); };
async function command(id: string) {
  if (id.startsWith('instrument:')) { chooseInstrument(Number(id.split(':')[1])); return; }
  if (id.startsWith('mode:')) { mode = Number(id.split(':')[1]); refresh(); return; }
  if (id.startsWith('macro:')) { macroDialog(id.slice(6) as Macro); return; }
  switch (id) {
    case 'new': addTab(); break;
    case 'open': await openFiles(); break;
    case 'save': await save(); break;
    case 'save-as': await save(true); break;
    case 'close': closeTab(active); break;
    case 'play': await togglePlay(); break;
    case 'stop': audio.stop(); tab().marker = 0; refresh(); break;
    case 'back': audio.stop(false); tab().marker = Math.max(0, tab().marker - 4); break;
    case 'forward': audio.stop(false); tab().marker += 4; break;
    case 'record': record = !record; audio.recording = record; if (!record) audio.stop(false); refresh(); break;
    case 'loop': loop = !loop; audio.loop = loop; refresh(); break;
    case 'metronome': audio.metronome = !audio.metronome; refresh(); break;
    case 'undo': audio.stop(false); tab().history.undo(); tab().selected.clear(); refresh(); scheduleRecovery(); break;
    case 'redo': audio.stop(false); tab().history.redo(); tab().selected.clear(); refresh(); scheduleRecovery(); break;
    case 'copy': copy(); break;
    case 'cut': copy(); transform(() => []); break;
    case 'paste': await paste(); break;
    case 'delete': transform(() => []); break;
    case 'select-all': tab().selected = new Set(song().notes.filter(n => !song().layers[n.layer]?.locked).map(cell)); refresh(); break;
    case 'deselect': tab().selected.clear(); refresh(); break;
    case 'invert': tab().selected = new Set(song().notes.filter(n => !tab().selected.has(cell(n)) && !song().layers[n.layer]?.locked).map(cell)); refresh(); break;
    case 'select-instrument': tab().selected = new Set(song().notes.filter(n => n.instrument === instrument).map(cell)); refresh(); break;
    case 'select-other': tab().selected = new Set(song().notes.filter(n => n.instrument !== instrument).map(cell)); refresh(); break;
    case 'expand': transform(notes => { const min = Math.min(...notes.map(n => n.tick)); return notes.map(n => ({ ...n, tick: min + (n.tick - min) * 2 })); }); break;
    case 'compress': transform(compressNotes); break;
    case 'transpose-range': transform(notes => notes.map(n => { while (n.key < 33) n.key += 12; while (n.key > 57) n.key -= 12; return n; })); break;
    case 'info': infoDialog(); break;
    case 'properties': propertiesDialog(); break;
    case 'stats': message('Song statistics', `${song().notes.length} note blocks\n${song().layers.length} layers\n${endTick(song()) + 1} ticks\n${tickSeconds(endTick(song()) + 1, tempoMap(song())).toFixed(2)} seconds\n${new Set(song().notes.map(n => n.instrument)).size} instruments used\n${song().stats[0]} minutes spent editing`); break;
    case 'preferences': preferencesDialog(); break;
    case 'instruments': instrumentsDialog(); break;
    case 'save-options': saveOptionsDialog(); break;
    case 'tempo': tempoDialog(); break;
    case 'tap': tapDialog(); break;
    case 'clip': clipDialog(); break;
    case 'audio-export': audioExportDialog(); break;
    case 'datapack': datapackDialog(); break;
    case 'pattern-export': await saveFile(writePattern(song(), selectedNotes()), 'Untitled pattern.nbp'); break;
    case 'bundle': await bundleExport(); break;
    case 'reference': await referenceDialog(); break;
    case 'background': await backgroundImport(); break;
    case 'midi-devices': await midiDevices(); break;
    case 'recent': await recentDialog('recent'); break;
    case 'restore': await recentDialog('recovery'); break;
    case 'examples': examplesDialog(); break;
    case 'fullscreen': if (document.fullscreenElement) await document.exitFullscreen(); else { await root.requestFullscreen(); const keyboard = (navigator as Navigator & { keyboard?: { lock(): Promise<void> } }).keyboard; await keyboard?.lock().catch(() => {}); } break;
    case 'compatibility': message('Minecraft compatibility', `${song().notes.filter(n => n.instrument >= 20).length} custom-instrument notes\n${song().notes.filter(n => n.key < 33 || n.key > 57).length} notes outside Minecraft’s two-octave range\n${song().notes.filter(n => n.pitch).length} fine-tuned notes\n\nData packs can play out-of-range pitches. Custom sounds need a matching resource pack.`); break;
    case 'about': message('About Note Block Studio', 'Open Note Block Studio — browser port\nSource baseline: 3.12.0-beta.6 / NBS v6\nOriginal application © 2026 OpenNBS, MIT licensed.\n\nThis browser port is under development. See Browser port status for remaining parity work.'); break;
    case 'port-status': portStatus(); break;
    case 'shortcuts': shortcutDialog(); break;
    case 'website': window.open('https://opennbs.org/', '_blank', 'noopener'); break;
  }
}

interface MenuItem { label: string; cmd?: string; key?: string; icon?: string; disabled?: boolean; children?: MenuItem[]; run?: () => void }
const separator: MenuItem = { label: '-' };
function menus(): Record<string, MenuItem[]> {
  const empty = !tab().selected.size;
  return {
    File: [{ label: 'New song', cmd: 'new', key: 'Ctrl+N', icon: 'NEW' }, { label: 'Open song…', cmd: 'open', key: 'Ctrl+O', icon: 'OPEN' }, { label: 'Recent songs…', cmd: 'recent' }, separator,
      { label: 'Save song', cmd: 'save', key: 'Ctrl+S', icon: 'SAVE' }, { label: 'Save song as a new file…', cmd: 'save-as', icon: 'SAVE_AS' }, { label: 'Save options…', cmd: 'save-options' }, { label: 'Restore unsaved files…', cmd: 'restore' }, separator,
      { label: 'Import…', children: [{ label: 'Pattern…', cmd: 'open' }, { label: 'MIDI…', cmd: 'open' }, { label: 'Reference audio…', cmd: 'reference' }, { label: 'Background image…', cmd: 'background' }] },
      { label: 'Export…', children: [{ label: 'Song with custom sounds…', cmd: 'bundle' }, { label: 'Pattern…', cmd: 'pattern-export', disabled: empty }, { label: 'Audio track…', cmd: 'audio-export' }, { label: 'Data pack…', cmd: 'datapack' }] }, separator, { label: 'Close song', cmd: 'close', key: 'Ctrl+W' }],
    Edit: [{ label: 'Undo', cmd: 'undo', key: 'Ctrl+Z', icon: 'UNDO', disabled: !tab().history.canUndo }, { label: 'Redo', cmd: 'redo', key: 'Ctrl+Y', icon: 'REDO', disabled: !tab().history.canRedo }, separator,
      { label: 'Copy', cmd: 'copy', key: 'Ctrl+C', icon: 'COPY', disabled: empty }, { label: 'Cut', cmd: 'cut', key: 'Ctrl+X', icon: 'CUT', disabled: empty }, { label: 'Paste', cmd: 'paste', key: 'Ctrl+V', icon: 'PASTE' }, { label: 'Delete', cmd: 'delete', key: 'Delete', icon: 'DELETE', disabled: empty }, separator,
      { label: 'Select all', cmd: 'select-all', key: 'Ctrl+A' }, { label: 'Deselect all', cmd: 'deselect' }, { label: 'Invert selection', cmd: 'invert', key: 'Ctrl+I' }, separator,
      { label: `Select all ${song().instruments[instrument]?.name}`, cmd: 'select-instrument' }, { label: `Select all but ${song().instruments[instrument]?.name}`, cmd: 'select-other' }, separator,
      ...[['Increase', 1, 'Ctrl+E'], ['Decrease', -1, 'Ctrl+D'], ['Increase by octave / 10', 12, 'Ctrl+R'], ['Decrease by octave / 10', -12, 'Ctrl+F']].map(([label, delta, key]) => ({ label: String(label), key: String(key), disabled: empty, run: () => selectedEdit(['key', 'velocity', 'pan', 'pitch'][mode] as 'key', Math.abs(Number(delta)) === 12 && mode !== 0 ? Math.sign(Number(delta)) * 10 : Number(delta)) })),
      { label: 'Change instrument…', disabled: empty, children: song().instruments.map((ins, i) => ({ label: ins.name, run: () => transform(notes => notes.map(n => ({ ...n, instrument: i }))) })) }, separator,
      { label: 'Expand selection', cmd: 'expand', disabled: empty }, { label: 'Compress selection', cmd: 'compress', disabled: empty }, { label: 'Macros…', disabled: empty, children: macroNames.map((name, i) => ({ label: name, cmd: `macro:${name}`, key: `Ctrl+Shift+${'ASDFGHJKQWERTYU'[i]}` })) }, { label: 'Transpose notes outside octave range', cmd: 'transpose-range', disabled: empty }, { label: 'Clip editor…', cmd: 'clip', key: 'Ctrl+Shift+P' }],
    Settings: [{ label: 'Instrument', children: song().instruments.map((ins, i) => ({ label: `${i === instrument ? '✓ ' : ''}${ins.name}`, cmd: `instrument:${i}` })) }, { label: 'Instrument settings…', cmd: 'instruments', icon: 'INSTRUMENTS' }, separator,
      { label: 'Song info…', cmd: 'info', icon: 'INFORMATION' }, { label: 'Song properties…', cmd: 'properties', icon: 'PROPERTIES' }, { label: 'Song stats…', cmd: 'stats' }, separator,
      { label: 'MIDI device manager', cmd: 'midi-devices', icon: 'MIDI_INPUT' }, { label: 'Preferences…', cmd: 'preferences', key: 'Ctrl+P' }],
    Help: [{ label: 'Example songs…', cmd: 'examples' }, { label: 'Keyboard and mouse controls…', cmd: 'shortcuts' }, { label: 'Browser port status…', cmd: 'port-status' }, separator, { label: 'Visit Note Block Studio website', cmd: 'website', icon: 'INTERNET' }, { label: 'About…', cmd: 'about' }],
  };
}
let menuRoot: HTMLElement | undefined;
function closeMenu() { document.querySelectorAll('.menu').forEach(e => e.remove()); menuRoot = undefined; document.querySelectorAll('.menubar-active').forEach(e => e.classList.remove('menubar-active')); }
function showMenu(items: MenuItem[], x: number, y: number, parent?: HTMLElement) {
  if (!parent) closeMenu();
  const menu = document.createElement('div'); menu.className = 'menu'; menu.setAttribute('role', 'menu');
  items.forEach(item => {
    if (item.label === '-') { menu.append(document.createElement('hr')); return; }
    const button = document.createElement('button'); button.setAttribute('role', 'menuitem'); button.setAttribute('aria-label', item.label); button.disabled = !!item.disabled;
    button.innerHTML = `<span class="menu-icon">${item.icon ? iconHtml(item.icon, document.body.classList.contains('dark'), settings.n('theme') !== 3) : ''}</span><span>${esc(item.label)}</span><kbd>${esc(item.key ?? '')}</kbd>${item.children ? '<span>›</span>' : ''}`;
    button.onclick = e => { e.stopPropagation(); if (item.children) { let sibling = menu.nextElementSibling; while (sibling?.classList.contains('menu')) { const next = sibling.nextElementSibling; sibling.remove(); sibling = next; } const rect = button.getBoundingClientRect(); showMenu(item.children, rect.right - 4, rect.top, menu); } else { closeMenu(); run(() => item.run ? item.run() : command(item.cmd!)); } };
    menu.append(button);
  });
  document.body.append(menu); if (!parent) menuRoot = menu;
  const rect = menu.getBoundingClientRect(); menu.style.left = `${Math.max(0, Math.min(x, innerWidth - rect.width - 4))}px`; menu.style.top = `${Math.max(0, Math.min(y, innerHeight - rect.height - 4))}px`;
  menu.addEventListener('keydown', e => {
    const items = [...menu.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)')], i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
    if (e.key === 'Escape') closeMenu();
  });
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
$('#menubar').innerHTML = ['File', 'Edit', 'Settings', 'Help'].map(name => `<button data-menu="${name}" aria-haspopup="menu">${name}</button>`).join('') + '<span>Note Block Studio</span>';
$('#menubar').addEventListener('click', e => { const button = (e.target as HTMLElement).closest<HTMLElement>('[data-menu]'); if (!button) return; const rect = button.getBoundingClientRect(); showMenu(menus()[button.dataset.menu!], rect.left, rect.bottom); button.classList.add('menubar-active'); });
document.addEventListener('pointerdown', e => { if (!(e.target as HTMLElement).closest('.menu,[data-menu]')) closeMenu(); });
root.addEventListener('click', e => {
  const target = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd],[data-tab],[data-close]'); if (!target) return;
  if (target.dataset.cmd) run(() => command(target.dataset.cmd!));
  if (target.dataset.tab) switchTab(Number(target.dataset.tab));
  if (target.dataset.close) closeTab(Number(target.dataset.close));
});

function infoDialog() { const s = song(); formDialog('Song information', [
  { name: 'name', label: 'Song name', value: s.name }, { name: 'author', label: 'Song author', value: s.author }, { name: 'originalAuthor', label: 'Original author', value: s.originalAuthor }, { name: 'description', label: 'Description', type: 'textarea', value: s.description },
], v => edit(s => Object.assign(s, v))); }
function propertiesDialog() { const s = song(); formDialog('Song properties', [
  { name: 'tempo', label: 'Tempo (ticks per second)', type: 'number', min: .01, max: 655.35, step: .01, value: s.tempo }, { name: 'timeSignature', label: 'Time signature', type: 'number', min: 2, max: 8, value: s.timeSignature }, { name: 'loop', label: 'Loop song', type: 'checkbox', value: s.loop }, { name: 'loopCount', label: 'Maximum loops (0 = unlimited)', type: 'number', min: 0, max: 255, value: s.loopCount }, { name: 'loopStart', label: 'Loop start tick', type: 'number', min: 0, max: endTick(s), value: s.loopStart },
], v => { edit(s => { s.tempo = +v.tempo; s.timeSignature = +v.timeSignature; s.loop = !!+v.loop; s.loopCount = +v.loopCount; s.loopStart = +v.loopStart; }); loop = song().loop; refresh(); }); }
function saveOptionsDialog() { formDialog('Save options', [{ name: 'version', label: 'NBS file version', options: Array.from({ length: 7 }, (_, i) => [String(i), i === 6 ? '6 — current (20 vanilla instruments)' : `${i} — legacy`] as [string, string]), value: song().version, help: 'Versions below 4 cannot store per-note velocity, panning, fine pitch, or looping.' }], v => edit(s => { s.version = +v.version; })); }
function tempoDialog() { formDialog('Set tempo', [{ name: 'tempo', label: settings.n('use_bpm') ? 'Beats per minute' : 'Ticks per second', type: 'number', min: .01, max: settings.n('use_bpm') ? 9830.25 : 655.35, step: .01, value: song().tempo * (settings.n('use_bpm') ? 15 : 1) }], v => edit(s => { s.tempo = +v.tempo / (settings.n('use_bpm') ? 15 : 1); })); }
function tapDialog() {
  let taps: number[] = [], bpm = song().tempo * 15;
  const dialog = openDialog('Tempo tapper', '<p>Click the button or press Space in time with the music.</p><button type="button" class="tap-target">Tap</button><output class="tap-output">— BPM</output>', [{ label: 'Cancel' }, { label: 'Apply', primary: true, run: () => edit(s => { s.tempo = Math.round(bpm / 15 * 100) / 100; }) }]);
  const tap = () => { const now = performance.now(); if (now - (taps.at(-1) ?? now) > 3000) taps = []; taps.push(now); if (taps.length > 16) taps.shift(); if (taps.length > 1) bpm = 60000 * (taps.length - 1) / (now - taps[0]) * (settings.n('tapdouble') ? 2 : 1); dialog.querySelector('output')!.textContent = `${bpm.toFixed(1)} BPM`; };
  dialog.querySelector<HTMLButtonElement>('.tap-target')!.onclick = tap; dialog.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); tap(); } });
}
function macroDialog(name: Macro) {
  if (!tab().selected.size) { notify('Select note blocks first'); return; }
  const apply = (options: MacroOptions = {}) => transform(notes => applyMacro(name, notes, options));
  if (['Vibrato', 'Chorus', 'Volume LFO', 'Fade in', 'Fade out', 'Replace key', 'Reset'].includes(name)) { apply(); return; }
  const fields: Field[] = [];
  if (name === 'Tremolo') fields.push({ name: 'fade', label: 'Fading', options: [['none', 'No fading'], ['in', 'Fade in'], ['out', 'Fade out']], value: 'none' }, { name: 'automatic', label: 'Automatic fade', type: 'checkbox', value: true }, { name: 'decay', label: 'Attack / Decay', type: 'number', min: 1, max: 100, value: 20 }, { name: 'sustain', label: 'Sustain', type: 'number', min: 1, max: 100, value: 20 }, { name: 'spacing', label: 'Spacing (ticks)', type: 'number', min: 1, max: 2, value: 1 });
  else if (name === 'Arpeggio' || name === 'Stagger') fields.push({ name: 'pattern', label: 'Pattern', value: name === 'Arpeggio' ? '0|4|7' : '0|1|2', help: name === 'Stagger' ? 'Relative layers, separated by pipes. May replace lower note blocks.' : 'Relative keys, separated by pipes.' });
  else {
    if (name === 'Replace key') fields.push({ name: 'from', label: 'Replace key', type: 'number', min: 0, max: 87, value: selectedKey });
    fields.push({ name: 'value', label: ({ Stereo: 'Stereo width', Portamento: 'Cent shift', 'Set velocity': 'Velocity', 'Set panning': 'Panning (0 = left, 100 = center, 200 = right)', 'Set pitch': 'Fine pitch (cents)', 'Replace key': 'With key' } as Record<string, string>)[name], type: 'number', min: name.includes('pitch') || name === 'Portamento' ? -1200 : 0, max: name === 'Set panning' ? 200 : name === 'Replace key' ? 87 : name.includes('pitch') || name === 'Portamento' ? 1200 : 100, value: name === 'Set pitch' ? 0 : name === 'Replace key' ? selectedKey : 100 });
    if (name === 'Stereo' || name === 'Portamento') { fields.unshift({ name: 'reverse', label: 'Reversed', type: 'checkbox', value: false }); fields.find(f => f.name === 'value')!.value = name === 'Stereo' ? 50 : 0; }
    if (name === 'Set velocity') { fields.push(check('percentvel', 'Percent')); fields.find(f => f.name === 'value')!.max = 1000; }
    if (name === 'Set pitch') fields.push(check('addpitch', 'Add mode'));
    if (name === 'Set panning') Object.assign(fields.find(f => f.name === 'value')!, { label: 'Panning (−100 left, 0 center, 100 right)', min: -100, max: 100, value: 0 });
  }
  formDialog(name, fields, v => {
    if (v.percentvel !== undefined) settings.set('percentvel', +v.percentvel);
    if (v.addpitch !== undefined) settings.set('addpitch', +v.addpitch);
    apply({ value: v.value === undefined ? undefined : +v.value + (name === 'Set panning' ? 100 : 0), from: +v.from, reverse: !!+v.reverse, pattern: v.pattern, spacing: +v.spacing, fade: v.fade, automatic: !!+v.automatic, decay: +v.decay, sustain: +v.sustain, percent: !!+v.percentvel, add: !!+v.addpitch });
  });
}
function clipDialog() { formDialog('Clip editor', [{ name: 'code', label: 'Selection code', type: 'textarea', value: selectionCode(selectedNotes()), help: 'Native Note Block Studio selection code. Columns end in -1.' }], v => { clipboard = { notes: parseSelection(v.code), instruments: structuredClone(song().instruments) }; return paste(); }, 'Paste'); }
function instrumentsDialog() {
  const dialog = openDialog('Instrument settings', `<div class="instrument-list">${song().instruments.map((ins, i) => `<button type="button" data-ins="${i}"><img src="${spriteUrl('spr_instrumenticons', Math.min(i, 19))}" alt=""><span>${esc(ins.name)}</span><small>${esc(ins.file || 'Silent control instrument')}</small></button>`).join('')}</div><div class="inline-actions"><button type="button" data-add-sound>Import sound…</button><button type="button" data-tempo-changer>Add Tempo Changer</button><button type="button" data-sound-stopper>Add Sound Stopper</button></div>`);
  dialog.querySelectorAll<HTMLButtonElement>('[data-ins]').forEach(b => b.onclick = () => {
    const index = +b.dataset.ins!, ins = song().instruments[index];
    formDialog(ins.name, [{ name: 'name', label: 'Name', value: ins.name }, { name: 'file', label: 'Sound filename', value: ins.file }, { name: 'key', label: 'Base key', type: 'number', min: 0, max: 87, value: ins.key }, { name: 'press', label: 'Press piano keys', type: 'checkbox', value: ins.press }], v => { edit(s => { s.instruments[index] = { name: v.name, file: v.file, key: +v.key, press: !!+v.press }; }); chooseInstrument(index, false); });
  });
  dialog.querySelector<HTMLButtonElement>('[data-add-sound]')!.onclick = () => run(async () => { for (const { file } of await pickFiles('.ogg,.wav,.mp3,.flac', true)) await openFile(file); dialog.close(); instrumentsDialog(); });
  const folderButton = document.createElement('button'); folderButton.type = 'button'; folderButton.textContent = 'Import sound folder…';
  dialog.querySelector('.inline-actions')!.prepend(folderButton);
  const folderStatus = document.createElement('p'); folderStatus.setAttribute('role', 'status');
  folderStatus.textContent = 'Select your sounds folder to resolve song sound paths, including subfolders. Imported sounds are kept in this browser.';
  dialog.querySelector('.dialog-body')!.append(folderStatus);
  folderButton.onclick = async () => {
    folderButton.disabled = true; let count = 0;
    try {
      const files = await pickSoundFolder(); if (!files) return;
      audio.stop(false); refresh();
      for await (const { path, file } of files) {
        folderStatus.textContent = `Importing ${path}… (${count} sounds saved)`;
        await audio.storeSound(path, new Uint8Array(await file.arrayBuffer())); count++;
      }
      folderStatus.textContent = count ? `Imported ${count} sounds. You can now play songs using these paths.` : 'No supported sound files found. Select the sounds folder containing OGG, WAV, MP3 or FLAC files.';
      notify(folderStatus.textContent);
    } catch (err) { folderStatus.textContent = `Imported ${count} sounds before import stopped: ${err instanceof Error ? err.message : String(err)}`; }
    finally { folderButton.disabled = false; }
  };
  for (const [attribute, name] of [['data-tempo-changer', 'Tempo Changer'], ['data-sound-stopper', 'Sound Stopper']]) dialog.querySelector<HTMLButtonElement>(`[${attribute}]`)!.onclick = () => { edit(s => { if (s.instruments.length >= 256) throw new Error('Too many instruments.'); s.instruments.push({ name, file: '', key: 45, press: false }); }); chooseInstrument(song().instruments.length - 1, false); dialog.close(); };
}

function preferencesDialog() {
  const groups: Record<string, Field[]> = {
    General: [check('show_welcome', 'Show welcome screen'), check('autosave', 'Auto-save recovery snapshots'), num('autosavemins', 'Auto-save interval (minutes)', 1, 60), check('use_bpm', 'Display tempo in beats per minute'), check('tapdouble', 'Double tapped tempo')],
    Appearance: [choice('theme', 'Theme', ['Windows', 'Classic', 'Dark', 'Fluent']), check('fdark', 'Fluent dark mode'), { name: 'accent', label: 'Accent colour', type: 'color', value: settings.s('accent') }, { name: 'window_scale', label: 'Window scale', options: [.5, .67, .75, .8, .9, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4].map(n => [String(n), `${n * 100}%`]), value: settings.n('window_scale') }, check('blackout', 'Black note area'), check('show_layers', 'Show layers'), check('show_piano', 'Show piano')],
    'Note blocks': [check('use_colors', 'Use colours'), check('use_icons', 'Use instrument icons'), check('use_shapes', 'Use instrument shapes'), check('show_numbers', 'Show note values'), check('show_octaves', 'Show octave numbers'), check('show_incompatible', 'Highlight incompatible notes'), check('fade', 'Always show full note opacity'), { ...num('selection_alpha', 'Selection opacity', 0, 1), step: .05 }],
    Piano: [num('keysmax', 'Maximum white keys to show', 8, 52), check('show_keynames', 'Show key names'), check('show_keynumbers', 'Show Minecraft click counts'), check('show_keyboard', 'Show keyboard bindings'), check('show_outofrange', 'Highlight keys outside Minecraft range'), check('keynames_flat', 'Use flat key names'), check('select_lastpressed', 'Select last pressed key')],
    Editing: [choice('mousewheel', 'Mouse wheel', ['Scroll', 'Change instrument', 'Change key']), num('mousewheel_scroll_speed', 'Scroll speed', 1, 10), check('changepitch', 'Scroll on a note to change its value'), check('layerhov_vppreview', 'Apply layer volume and panning to preview')],
    Playback: [check('realvolume', 'Apply layer volumes'), { name: 'realstereo', label: 'Stereo playback', type: 'checkbox', value: !settings.n('realstereo') }, check('marker_follow', 'Follow playback marker'), choice('marker_pagebypage', 'Follow mode', ['Scroll', 'Page by page', 'Centered']), check('marker_start', 'Start playing in section'), check('marker_end', 'Stop playing after section')],
  };
  const dialog = openDialog('Preferences', `<div class="preferences"><nav>${Object.keys(groups).map((g, i) => `<button type="button" data-pref="${esc(g)}" class="${i === 0 ? 'active' : ''}">${esc(g)}</button>`).join('')}</nav><section id="pref-content"></section></div><div class="inline-actions"><button type="button" data-import-settings>Import settings.ini…</button><button type="button" data-export-settings>Export settings.ini…</button><button type="button" data-reset-settings>Restore defaults</button></div>`, [{ label: 'Close', primary: true }]);
  dialog.classList.add('wide');
  const show = (group: string) => {
    dialog.querySelector('#pref-content')!.innerHTML = `<h3>${esc(group)}</h3>` + groups[group].map(f => fieldHtml({ ...f, value: f.name === 'realstereo' ? !settings.n('realstereo') : f.type === 'checkbox' ? !!settings.n(f.name) : settings.values[f.name] })).join('');
    dialog.querySelectorAll<HTMLInputElement | HTMLSelectElement>('#pref-content input,#pref-content select').forEach(input => input.onchange = () => {
      const raw = input instanceof HTMLInputElement && input.type === 'checkbox' ? +input.checked : input.value;
      settings.set(input.name, input.name === 'accent' ? String(raw) : input.name === 'realstereo' ? +!raw : Number(raw)); refresh();
    });
  };
  dialog.querySelectorAll<HTMLButtonElement>('[data-pref]').forEach(b => b.onclick = () => { dialog.querySelectorAll('[data-pref]').forEach(el => el.classList.toggle('active', el === b)); show(b.dataset.pref!); }); show('General');
  dialog.querySelector<HTMLButtonElement>('[data-import-settings]')!.onclick = () => run(async () => { const files = await pickFiles('.ini'); if (files[0]) { settings.importIni(await files[0].file.text()); refresh(); show('General'); } });
  dialog.querySelector<HTMLButtonElement>('[data-export-settings]')!.onclick = () => run(() => saveFile(settings.exportIni(), 'settings.ini'));
  dialog.querySelector<HTMLButtonElement>('[data-reset-settings]')!.onclick = () => { localStorage.removeItem('nbs-settings'); settings.values = new Settings().values; refresh(); show('General'); };
}
function check(name: string, label: string): Field { return { name, label, type: 'checkbox', value: !!settings.n(name) }; }
function num(name: string, label: string, min: number, max: number): Field { return { name, label, type: 'number', min, max, value: settings.n(name) }; }
function choice(name: string, label: string, options: string[]): Field { return { name, label, options: options.map((o, i) => [String(i), o]), value: settings.n(name) }; }

function audioExportDialog() {
  formDialog('Export audio track', [{ name: 'format', label: 'Output format', options: [['wav', 'WAV'], ['mp3', 'MP3'], ['aiff', 'AIFF'], ['flac', 'FLAC']], value: 'wav' }, { name: 'sampleRate', label: 'Sample rate', options: ['8000', '11025', '16000', '22050', '44100', '48000', '88200', '96000', '176400', '192000', '352800', '384000'], value: '44100' }, { name: 'channels', label: 'Channels', options: [['1', 'Mono'], ['2', 'Stereo']], value: '2' }, { name: 'locked', label: 'Include locked layers', type: 'checkbox', value: false }], async (v, dialog) => {
    const progress = (text: string) => { notify(text); dialog.querySelector('h2')!.textContent = text; };
    progress('Rendering audio…');
    const snapshot = structuredClone(song()), sampleRate = clamp(+v.sampleRate, 8000, 96000);
    let data = await audio.render(snapshot, sampleRate, +v.channels, !!+v.locked);
    if (v.format !== 'wav' || sampleRate !== +v.sampleRate) data = new Uint8Array(await encodeAudio(data, v.format as AudioFormat, +v.sampleRate, progress));
    await saveFile(data, `${snapshot.name || 'Untitled song'}.${v.format}`); notify('Audio rendered');
  }, 'Export');
}
function datapackDialog() {
  formDialog('Export data pack', [{ name: 'namespace', label: 'Namespace', value: 'noteblock_song' }, { name: 'description', label: 'Description', value: song().name || 'Note Block Studio song' }, { name: 'format', label: 'Pack format', type: 'number', min: 4, max: 1000, value: 48 }, { name: 'radius', label: 'Playback radius', type: 'number', min: 1, max: 100000, value: 64 }, { name: 'locked', label: 'Include locked layers', type: 'checkbox', value: false }], async v => { await saveFile(exportDatapack(song(), v.namespace, v.description, +v.format, +v.radius, !!+v.locked), `${v.namespace}.zip`); }, 'Export');
}
async function bundleExport() {
  const s = song(), name = `${s.name || 'Untitled song'}.nbs`, files: Record<string, Uint8Array> = { [name]: writeNbs(s) };
  for (const ins of s.instruments.slice(20)) if (ins.file) {
    const data = await getStored<Uint8Array>('files', ins.file.replaceAll('\\', '/').toLowerCase());
    if (!data) throw new Error(`Load the custom sound ${ins.file} before packaging this song.`); files[ins.file.replaceAll('\\', '/')] = data;
  }
  await saveFile(zipSync(files), name.replace(/\.nbs$/, '.zip'));
}
async function referenceDialog() {
  const files = await pickFiles('.ogg,.wav,.mp3,.flac'); if (!files[0]) return;
  const context = await audio.init(), buffer = await context.decodeAudioData(await files[0].file.arrayBuffer());
  formDialog('Reference audio', [{ name: 'offset', label: 'Offset (milliseconds)', type: 'number', value: 0 }, { name: 'volume', label: 'Volume', type: 'number', min: 0, max: 100, value: 100 }, { name: 'mode', label: 'Playback', options: [['0', 'Muted'], ['1', 'Solo reference'], ['2', 'Mix with song']], value: '2' }], v => { audio.reference = { buffer, offset: +v.offset, volume: +v.volume, mode: +v.mode }; tab().reference = audio.reference; notify(`Reference: ${files[0].file.name}`); });
}
async function backgroundImport() { const files = await pickFiles('.png,.jpg,.jpeg,.webp'); if (!files[0]) return; const url = URL.createObjectURL(files[0].file); root.style.backgroundImage = `url("${url}")`; root.style.backgroundSize = 'cover'; }
function examplesDialog() {
  const dialog = openDialog('Example songs', `<div class="file-list">${assets.songs.map((name, i) => `<button type="button" data-example="${i}">${esc(name.replace(/\.nbs$/, ''))}</button>`).join('')}</div>`);
  dialog.querySelectorAll<HTMLButtonElement>('[data-example]').forEach(b => b.onclick = () => run(async () => { const name = assets.songs[+b.dataset.example!]; const response = await fetch(assetUrl(`assets/songs/${encodeURIComponent(name)}`)); if (!response.ok) throw new Error('Could not load example song.'); addTab(readNbs(new Uint8Array(await response.arrayBuffer()), name)); dialog.close(); }));
}
async function recentDialog(key: string) {
  const songs = await getStored<Song[]>('state', key) ?? [];
  const dialog = openDialog(key === 'recent' ? 'Recent songs' : 'Restore unsaved files', songs.length ? `<div class="file-list">${songs.map((s, i) => `<button type="button" data-recent="${i}">${esc(s.name || s.filename || 'Untitled song')}<small>${s.notes.length} notes</small></button>`).join('')}</div>` : '<p>No saved entries.</p>');
  dialog.querySelectorAll<HTMLButtonElement>('[data-recent]').forEach(b => b.onclick = () => { addTab(structuredClone(songs[+b.dataset.recent!])); if (key === 'recovery') tab().history.saved = ''; dialog.close(); refresh(); });
}
function midiDialog(bytes: Uint8Array, name: string) {
  formDialog('Import MIDI', [{ name: 'tempo', label: 'Target ticks per second', type: 'number', min: 1, max: 100, value: 10 }, { name: 'velocity', label: 'Import velocity', type: 'checkbox', value: true }, { name: 'duration', label: 'Repeat sustained notes', type: 'checkbox', value: false }, { name: 'octave', label: 'Octave shift', type: 'number', min: -7, max: 7, value: 0 }], v => { addTab(importMidi(bytes, name, +v.tempo, !!+v.velocity, !!+v.duration, +v.octave)); tab().history.saved = ''; refresh(); scheduleRecovery(); });
}
async function midiDevices() {
  if (!navigator.requestMIDIAccess) throw new Error('Web MIDI is not available in this browser. Use Chromium on HTTPS or localhost.');
  const access = await navigator.requestMIDIAccess();
  const dialog = openDialog('MIDI device manager', `<p>Enable an input to preview notes. Enable Record in the toolbar to record them.</p><div class="file-list">${[...access.inputs.values()].map(input => `<label class="field check-field"><span>${esc(input.name || input.id)}</span><input type="checkbox" data-midi="${esc(input.id)}" ${input.onmidimessage ? 'checked' : ''}></label>`).join('') || '<p>No MIDI input devices connected.</p>'}</div>`);
  dialog.querySelectorAll<HTMLInputElement>('[data-midi]').forEach(c => c.onchange = () => { const input = access.inputs.get(c.dataset.midi!)!; input.onmidimessage = c.checked ? e => { if (!e.data) return; const [status, key, vel] = e.data; if ((status & 0xf0) === 0x90 && vel > 0 && key >= 21 && key <= 108) playKey(key - 21, Math.round(vel / 127 * 100)); } : null; });
}
function shortcutDialog() { message('Keyboard and mouse controls', 'Left click: place or change a note\nLeft drag: select a rectangle\nDrag selected notes: move selection\nRight click / drag: erase notes\nMiddle click: pick note and instrument (Ctrl also picks properties)\nCtrl+click: add to selection\nMouse wheel over a note: change the active property\nShift+wheel: octave / fine adjustment\n\nSpace: play / pause    Enter: stop\nCtrl+N/O/S: new / open / save\nCtrl+Z/Y: undo / redo\nCtrl+C/X/V: copy / cut / paste\nCtrl+A/I: select all / invert selection\nDelete: delete selection\nArrow keys: move selection\nCtrl+E/D: increase / decrease note property\nCtrl+R/F: increase / decrease by octave or 10\nCtrl+P: preferences\nCtrl+Shift+A/S/D/F/G/H/J/K/Q/W/E/R/T/Y/U: macros\nCtrl+Shift+P: clip editor\nCtrl+Shift+I: tempo tapper\nCtrl+1…9 / Ctrl+Shift+1…9: instruments\n\nPiano: 1 Q 2 W 3 E R 5 T 6 Y U 8 I 9 O 0 P Z S X D C V G\nRight-click a piano key to change its binding.\n\nChromium reserves some shortcuts (including Ctrl+N, Ctrl+W and Ctrl+1…9). All actions also have menu controls. Fullscreen keyboard lock may make more shortcuts available.'); }
function portStatus() { message('Browser port status', 'Implemented: NBS 0–6 import/export, source sprites and sound samples, note/layer editing, selections, undo/redo, song tabs, playback, looping, tempo changes, macros, piano bindings, core preferences, settings.ini import/export, custom sounds, NBP patterns, MIDI import/input, WAV/MP3/AIFF/FLAC export, basic data-pack export, recovery, recent songs and production offline caching.\n\nRemaining parity work: exact desktop dialog rendering, all advanced preferences and languages, resource-pack sound mappings, schematic/track/branch/structure export, full MIDI and audio export options, full reference-audio UI, player mode, advanced sound-stopper behavior, and desktop-vs-browser visual/audio regression baselines.\n\nBrowser restrictions: native OS integrations and some browser-reserved shortcuts cannot behave identically in a normal tab.\n\nThis is a working port in progress, not verified full parity.'); }

// Native mouse behavior: a click paints; dragging the left button selects.
let drag: { tick: number; layer: number; button: number; ctrl: boolean; moving: boolean; moved: boolean; notes?: Note[]; ruler: boolean } | undefined;
const canvas = grid.canvas;
canvas.oncontextmenu = e => e.preventDefault();
canvas.onpointerdown = e => {
  if (audio.playing) return; canvas.focus(); canvas.setPointerCapture(e.pointerId); const p = grid.point(e); hover = p;
  const existing = song().notes.find(n => n.tick === p.tick && n.layer === p.layer);
  if (e.button === 1) { e.preventDefault(); if (existing) { instrument = existing.instrument; selectedKey = existing.key; velocity = e.ctrlKey ? existing.velocity : 100; pan = e.ctrlKey ? existing.pan : 100; pitch = e.ctrlKey ? existing.pitch : 0; playKey(selectedKey); refresh(); } return; }
  drag = { tick: p.tick, layer: p.layer, button: e.button, ctrl: e.ctrlKey, moving: !p.ruler && e.button === 0 && !!existing && tab().selected.has(cell(existing)) && !e.ctrlKey, moved: false, ruler: p.ruler };
  if (drag.moving) drag.notes = structuredClone(selectedNotes());
  if (p.ruler) { tab().marker = p.tick; if (!e.shiftKey) tab().section = undefined; }
  else if (e.button === 2) { tab().history.begin(); if (e.ctrlKey) tab().selected.delete(cell(p)); else erase(p.tick, p.layer); }
};
function erase(tick: number, layer: number) { if (!song().layers[layer]?.locked) song().notes = song().notes.filter(n => n.tick !== tick || n.layer !== layer); }
canvas.onpointermove = e => {
  const p = grid.point(e); hover = p;
  if (!drag) return;
  if (p.tick !== drag.tick || p.layer !== drag.layer) drag.moved = true;
  if (drag.ruler) { if (drag.moved) tab().section = [Math.min(drag.tick, p.tick), Math.max(drag.tick, p.tick) + 1]; }
  else if (drag.button === 2) { if (drag.ctrl) tab().selected.delete(cell(p)); else erase(p.tick, p.layer); }
  else if (!drag.moving && drag.moved) marquee = { x1: drag.tick, y1: drag.layer, x2: p.tick, y2: p.layer };
  else if (drag.moving && drag.notes) marquee = { x1: Math.min(...drag.notes.map(n => n.tick)) + p.tick - drag.tick, y1: Math.min(...drag.notes.map(n => n.layer)) + p.layer - drag.layer, x2: Math.max(...drag.notes.map(n => n.tick)) + p.tick - drag.tick, y2: Math.max(...drag.notes.map(n => n.layer)) + p.layer - drag.layer };
};
canvas.onpointerup = e => {
  const p = grid.point(e), d = drag; drag = undefined;
  if (!d) return;
  if (d.ruler) { marquee = undefined; refresh(); return; }
  if (d.button === 2) { tab().history.commit(); scheduleRecovery(); }
  else if (d.moving && d.moved) transform(notes => moveNotes(notes, p.tick - d.tick, p.layer - d.layer));
  else if (marquee && !d.moving) {
    const m = marquee; if (!d.ctrl) tab().selected.clear();
    for (const n of song().notes) if (n.tick >= Math.min(m.x1, m.x2) && n.tick <= Math.max(m.x1, m.x2) && n.layer >= Math.min(m.y1, m.y2) && n.layer <= Math.max(m.y1, m.y2) && !song().layers[n.layer]?.locked) tab().selected.add(cell(n));
  } else if (d.ctrl) { if (song().notes.some(n => cell(n) === cell(p))) tab().selected.add(cell(p)); }
  else if (tab().selected.size) tab().selected.clear();
  else if (!song().layers[p.layer]?.locked) {
    const ins = song().instruments[instrument];
    const place = (fine = pitch, vel = velocity, stereo = pan) => { edit(s => { s.notes = s.notes.filter(n => cell(n) !== cell(p)); s.notes.push({ tick: p.tick, layer: p.layer, instrument, key: selectedKey, velocity: vel, pan: stereo, pitch: fine }); s.stats[3]++; }); if (ins.file) playKey(selectedKey); };
    if (ins.name === 'Tempo Changer') formDialog('Tempo Changer', [{ name: 'bpm', label: 'Tempo (BPM)', type: 'number', min: 1, max: 32767, value: song().tempo * 15 }], v => place(+v.bpm));
    else if (ins.name === 'Sound Stopper') formDialog('Sound Stopper', [{ name: 'start', label: 'First layer (0-based)', type: 'number', min: 0, max: 32767, value: p.layer }, { name: 'end', label: 'Last layer (0-based)', type: 'number', min: 0, max: 65535, value: p.layer }], v => place(+v.start, ((+v.end >> 8) + 100) % 256, ((+v.end & 255) + 100) % 256));
    else place();
  }
  marquee = undefined; refresh();
};
canvas.onpointercancel = () => { drag = undefined; marquee = undefined; tab().history.commit(); refresh(); };
canvas.onpointerleave = () => { if (!drag) hover = undefined; };
canvas.addEventListener('wheel', e => {
  e.preventDefault(); if (audio.playing) return; const p = grid.point(e), delta = -Math.sign(e.deltaY), n = song().notes.find(n => cell(n) === cell(p));
  if (e.ctrlKey) { settings.set('window_scale', clamp(settings.n('window_scale') + delta * .1, .5, 4)); refresh(); return; }
  if (!p.ruler && n && settings.n('changepitch')) {
    const property = ['key', 'velocity', 'pan', 'pitch'][mode] as 'key', amount = delta * (mode === 0 ? e.shiftKey ? 12 : 1 : e.shiftKey ? 1 : 10);
    edit(() => { n[property] += amount; }); run(() => audio.preview(song().instruments[n.instrument], n));
  } else if (settings.n('mousewheel') === 1) chooseInstrument(clamp(instrument + delta, 0, song().instruments.length - 1));
  else if (settings.n('mousewheel') === 2) { selectedKey = clamp(selectedKey + delta, 0, 87); playKey(selectedKey); }
  else { const amount = Math.max(1, Math.round(Math.abs(e.deltaY || e.deltaX) / 40)) * settings.n('mousewheel_scroll_speed'); if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) tab().x = clamp(tab().x + Math.sign(e.deltaX || e.deltaY) * amount, 0, 65534); else tab().y = clamp(tab().y - delta * amount, 0, 65534); refresh(); }
}, { passive: false });
let valueDrag: { y: number; value: number; layer: number; property: 'volume' | 'pan'; moved: boolean } | undefined;
let suppressLayerClick = false;
$('#layers').addEventListener('pointerdown', e => {
  const event = e as PointerEvent, b = (event.target as HTMLElement).closest<HTMLElement>('[data-layer-action="volume"],[data-layer-action="pan"]');
  if (!b || event.button !== 0) return;
  const layer = +b.closest<HTMLElement>('[data-layer]')!.dataset.layer!, property = b.dataset.layerAction as 'volume' | 'pan';
  valueDrag = { y: event.clientY, value: (song().layers[layer] ?? newLayer())[property], layer, property, moved: false };
  $('#layers').setPointerCapture(event.pointerId);
});
$('#layers').addEventListener('pointermove', e => {
  const event = e as PointerEvent, d = valueDrag; if (!d) return;
  if (!d.moved && Math.abs(event.clientY - d.y) < 3) return;
  if (!d.moved) { tab().history.begin(); d.moved = true; }
  ensureLayers(song(), d.layer + 1);
  const value = clamp(d.value + (d.y - event.clientY) / (settings.n('window_scale') || 1), 0, d.property === 'volume' ? 100 : 200);
  song().layers[d.layer][d.property] = event.shiftKey ? Math.round(value) : Math.floor(value / 10) * 10;
  renderLayers(); notify(`${d.property === 'volume' ? 'Volume' : 'Panning'}: ${song().layers[d.layer][d.property]}`);
});
$('#layers').addEventListener('pointerup', () => {
  if (valueDrag?.moved) { suppressLayerClick = true; tab().history.commit(); scheduleRecovery(); refresh(); }
  valueDrag = undefined;
});
$('#layers').addEventListener('pointercancel', () => { valueDrag = undefined; tab().history.commit(); refresh(); });
$('#layers').addEventListener('wheel', e => { const event = e as WheelEvent; event.preventDefault(); tab().y = Math.max(0, tab().y + Math.sign(event.deltaY) * settings.n('mousewheel_scroll_speed')); refresh(); }, { passive: false });
$('#layers').addEventListener('click', e => {
  if (suppressLayerClick) { suppressLayerClick = false; return; }
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-layer-action]'); if (!b) return;
  const index = +b.closest<HTMLElement>('[data-layer]')!.dataset.layer!, action = b.dataset.layerAction!, l = song().layers[index] ?? newLayer();
  if (action === 'name' || action === 'volume' || action === 'pan') { formDialog(`Layer ${index + 1}`, [{ name: 'value', label: action === 'name' ? 'Layer name' : action === 'volume' ? 'Volume (%)' : 'Panning (0–200)', type: action === 'name' ? 'text' : 'number', min: 0, max: action === 'volume' ? 100 : 200, value: l[action] }], v => edit(s => { ensureLayers(s, index + 1); if (action === 'name') s.layers[index].name = v.value; else s.layers[index][action] = +v.value; })); return; }
  if (action === 'select') { tab().selected = new Set(song().notes.filter(n => n.layer === index).map(cell)); refresh(); return; }
  edit(s => {
    ensureLayers(s, index + 1);
    if (action === 'lock') { s.layers[index].locked = !l.locked; s.layers[index].solo = false; }
    if (action === 'solo') { s.layers[index].solo = !l.solo; s.layers[index].locked = false; }
    if (action === 'add') { s.layers.splice(index, 0, newLayer()); s.notes.forEach(n => { if (n.layer >= index) n.layer++; }); }
    if (action === 'remove') { s.layers.splice(index, 1); s.notes = s.notes.filter(n => n.layer !== index); s.notes.forEach(n => { if (n.layer > index) n.layer--; }); }
    if (action === 'up' || action === 'down') { const target = index + (action === 'up' ? -1 : 1); if (target < 0) return; ensureLayers(s, target + 1); [s.layers[index], s.layers[target]] = [s.layers[target], s.layers[index]]; s.notes.forEach(n => { if (n.layer === index) n.layer = target; else if (n.layer === target) n.layer = index; }); }
  });
});
piano.canvas.onpointerdown = e => { const key = piano.hit(e); if (key === undefined) return; if (e.button === 0) { selectedKey = key; playKey(key); } };
piano.canvas.oncontextmenu = e => {
  e.preventDefault(); const key = piano.hit(e); if (key === undefined) return;
  formDialog(`Keyboard binding — ${keyName(key)}`, [{ name: 'binding', label: 'Keyboard character (empty to clear)', value: Object.entries(pianoBindings).find(([, n]) => n === key)?.[0] ?? '' }], v => { for (const [c, n] of Object.entries(pianoBindings)) if (n === key) delete pianoBindings[c]; const char = [...v.binding.toLowerCase()][0]; if (char) pianoBindings[char] = key; localStorage.setItem('nbs-piano-bindings', JSON.stringify(pianoBindings)); });
};
$('#piano-left').onclick = () => { settings.set('piano_start', Math.max(0, settings.n('piano_start') - 1)); };
$('#piano-right').onclick = () => { settings.set('piano_start', Math.min(44, settings.n('piano_start') + 1)); };
$('#tempo').onclick = tempoDialog; $('#tap-tempo').onclick = tapDialog; $('#fullscreen').onclick = () => run(() => command('fullscreen'));
$<HTMLInputElement>('#volume').oninput = e => { settings.set('mastervol', +(e.target as HTMLInputElement).value / 100); audio.volume = settings.n('mastervol'); };
$<HTMLInputElement>('#horizontal-scroll').oninput = e => { tab().x = +(e.target as HTMLInputElement).value; };
$<HTMLInputElement>('#vertical-scroll').oninput = e => { tab().y = +(e.target as HTMLInputElement).value; renderLayers(); };
document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || (e.target as HTMLElement).matches('input,textarea,select')) return;
  const key = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (key === 'escape') { closeMenu(); tab().selected.clear(); marquee = undefined; refresh(); return; }
  if (menuRoot) return;
  let cmd = '';
  if (ctrl && e.shiftKey) {
    if (key === 'p') cmd = 'clip'; else if (key === 'i') cmd = 'tap'; else if (/^[1-9]$/.test(key)) cmd = `instrument:${+key + 8}`;
    else { const i = 'asdfghjkqwertyu'.indexOf(key); if (i >= 0) cmd = `macro:${macroNames[i]}`; }
  } else if (ctrl) {
    cmd = ({ n: 'new', o: 'open', s: 'save', w: 'close', z: 'undo', y: 'redo', c: 'copy', x: 'cut', v: 'paste', a: 'select-all', i: 'invert', p: 'preferences' } as Record<string, string>)[key] ?? '';
    if (/^[1-9]$/.test(key)) cmd = `instrument:${+key - 1}`;
    if (['e', 'd', 'r', 'f'].includes(key)) { e.preventDefault(); selectedEdit(['key', 'velocity', 'pan', 'pitch'][mode] as 'key', ({ e: 1, d: -1, r: mode === 0 ? 12 : 10, f: mode === 0 ? -12 : -10 } as Record<string, number>)[key]); return; }
  } else {
    if (e.code === 'Space') cmd = 'play'; else if (key === 'enter') cmd = 'stop'; else if (key === 'delete') cmd = 'delete';
    else if (key.startsWith('arrow')) { e.preventDefault(); if (tab().selected.size) transform(notes => moveNotes(notes, key === 'arrowright' ? 1 : key === 'arrowleft' ? -1 : 0, key === 'arrowdown' ? 1 : key === 'arrowup' ? -1 : 0)); else { if (key === 'arrowleft') tab().x = Math.max(0, tab().x - 1); if (key === 'arrowright') tab().x++; if (key === 'arrowup') tab().y = Math.max(0, tab().y - 1); if (key === 'arrowdown') tab().y++; refresh(); } return; }
    else if (key === 'home') tab().x = 0; else if (key === 'end') tab().x = endTick(song());
    else if (pianoBindings[key] !== undefined && !e.repeat) { e.preventDefault(); playKey(pianoBindings[key]); return; }
  }
  if (cmd) { e.preventDefault(); if (!e.repeat || !['play', 'record', 'loop'].includes(cmd)) run(() => command(cmd)); }
});
window.addEventListener('beforeunload', e => { if (tabs.some(t => t.history.dirty)) { e.preventDefault(); e.returnValue = ''; } });
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (!e.dataTransfer?.types.includes('Files')) return; e.preventDefault(); dragDepth++; root.classList.add('dragging'); });
window.addEventListener('dragover', e => { e.preventDefault(); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) root.classList.remove('dragging'); });
window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; root.classList.remove('dragging'); run(async () => { for (const file of e.dataTransfer?.files ?? []) await openFile(file); }); });
new ResizeObserver(() => { if (tabs.length) { grid.draw(); piano.draw(); renderLayers(); } }).observe($('#workspace'));
function frame() {
  if (tabs.length) {
    if (audio.playing && settings.n('marker_follow')) { const cols = Math.max(1, Math.floor(grid.width / 32)); if (settings.n('marker_pagebypage') === 2) tab().x = Math.max(0, Math.floor(audio.position - cols / 2)); else if (audio.position >= tab().x + cols || audio.position < tab().x) tab().x = Math.max(0, Math.floor(audio.position)); }
    grid.draw(); piano.draw(); const v = view();
    $('#position').textContent = `${tickSeconds(v.marker, tempoMap(song())).toFixed(2)} s / ${tickSeconds(endTick(song()) + 1, tempoMap(song())).toFixed(2)} s`;
    $('#status').textContent = performance.now() < statusUntil ? statusMessage : `Instrument: ${song().instruments[instrument]?.name ?? 'Unknown'}    │    Key: ${keyName(selectedKey)}    │    Tick: ${hover?.tick ?? 'None'}    │    Layer: ${hover ? hover.layer + 1 : 'None'}    │    Selected: ${tab().selected.size} / ${song().notes.length}`;
  }
  requestAnimationFrame(frame);
}
addTab(); requestAnimationFrame(frame);
let lastAutosave = Date.now();
setInterval(() => {
  if (!settings.n('autosave') || audio.playing || Date.now() - lastAutosave < Math.max(1, settings.n('autosavemins')) * 60000) return;
  lastAutosave = Date.now();
  if (tab().history.dirty && song().filename) {
    if (tab().handle) run(() => save());
    else run(async () => { await putStored('state', 'autosave', tabs.filter(t => t.history.dirty).map(t => t.history.song)); notify('Auto-saved to browser storage'); });
  }
}, 1000);
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(err => notify(`Offline cache could not be installed: ${err.message}`));
run(async () => {
  const recovery = await getStored<Song[]>('state', 'recovery');
  if (recovery?.length) {
    openDialog('Recover unsaved songs', `<p>${recovery.length} unsaved song${recovery.length === 1 ? '' : 's'} from your previous session can be restored.</p>`, [{ label: 'Later' }, { label: 'Restore', primary: true, run: () => { for (const s of recovery) { addTab(s); tab().history.saved = ''; } refresh(); } }]);
  } else if (settings.n('show_welcome')) {
    const dialog = openDialog('Welcome to Note Block Studio', `<div class="welcome"><img src="${spriteUrl('spr_logo')}" alt="Open Note Block Studio"><p>Create and edit Minecraft note block songs.</p><small>Browser port · based on 3.12.0-beta.6</small><div class="welcome-actions"><button type="button" data-welcome="new">New song</button><button type="button" data-welcome="open">Open song…</button><button type="button" data-welcome="examples">Example songs…</button></div><label class="field check-field"><span>Show this window on startup</span><input type="checkbox" checked id="welcome-check"></label></div>`, [{ label: 'Continue', primary: true }]);
    dialog.querySelectorAll<HTMLButtonElement>('[data-welcome]').forEach(b => b.onclick = () => { dialog.close(); if (b.dataset.welcome !== 'new') run(() => command(b.dataset.welcome!)); });
    dialog.querySelector<HTMLInputElement>('#welcome-check')!.onchange = e => settings.set('show_welcome', +(e.target as HTMLInputElement).checked);
  }
});
