// GameMaker frame order is significant: never sort the UUID-named images.
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('NoteBlockStudio');
const out = path.resolve('public/assets');
await mkdir(out, { recursive: true });
await mkdir('src/generated', { recursive: true });
const manifest = { sprites: {}, instruments: [], songs: [], patterns: [], sounds: [], icons: {}, settings: [], scripts: [], midi: [], drums: [] };
const parseYY = text => JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
for (const name of await readdir(path.join(root, 'sprites'))) {
  const dir = path.join(root, 'sprites', name);
  const yy = parseYY(await readFile(path.join(dir, name + '.yy'), 'utf8'));
  await mkdir(path.join(out, name), { recursive: true });
  const frames = [];
  for (const [index, frame] of (yy.frames ?? []).entries()) {
    const dest = `${name}/${index}.png`;
    await copyFile(path.join(dir, frame.name + '.png'), path.join(out, dest));
    frames.push('assets/' + dest);
  }
  manifest.sprites[name] = { width: yy.width, height: yy.height, frames };
}
const create = await readFile(path.join(root, 'scripts/control_create/control_create.gml'), 'utf8');
for (const m of create.matchAll(/new_instrument\("([^"]+)",\s*"([^"]+)",\s*false(?:,\s*(true|false))?\)/g)) {
  manifest.instruments.push({ name: m[1], file: m[2], key: 45, press: m[3] === 'true' });
}
async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const e of await readdir(from, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) await copyTree(path.join(from, e.name), path.join(to, e.name));
    else await copyFile(path.join(from, e.name), path.join(to, e.name));
  }
}
await copyTree(path.join(root, 'datafiles/Data/Sounds'), path.join(out, 'sounds'));
await copyTree(path.join(root, 'datafiles/Songs'), path.join(out, 'songs'));
await copyTree(path.join(root, 'datafiles/Patterns'), path.join(out, 'patterns'));
async function listFiles(dir, prefix = '') {
  const result = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) result.push(...await listFiles(path.join(dir, e.name), prefix + e.name + '/'));
    else if (!e.name.startsWith('.')) result.push(prefix + e.name);
  }
  return result;
}
manifest.songs = (await listFiles(path.join(out, 'songs'))).filter(f => f.endsWith('.nbs'));
manifest.patterns = await listFiles(path.join(out, 'patterns'));
manifest.sounds = await listFiles(path.join(out, 'sounds'));
await copyFile(path.join(root, 'LICENSE'), path.join(out, 'LICENSE.OpenNBS.txt'));
await copyFile(path.join(root, 'datafiles/Data/icon.ico'), path.join(out, 'icon.ico'));
await mkdir(path.join(out, 'ffmpeg'), { recursive: true });
for (const name of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) await copyFile(path.join('node_modules/@ffmpeg/core/dist/esm', name), path.join(out, 'ffmpeg', name));
const icons = await readFile(path.join(root, 'scripts/icons_init/icons_init.gml'), 'utf8');
icons.match(/enum icons\s*{([^}]+)}/s)[1].split(',').map(s => s.trim()).filter(Boolean).forEach((s, i) => manifest.icons[s] = i);
const settings = await readFile(path.join(root, 'scripts/load_settings/load_settings.gml'), 'utf8');
for (const m of settings.matchAll(/(\w+)\s*=\s*ini_read_(real|string)\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g)) {
  const value = create.match(new RegExp('^\\s*' + m[5] + '\\s*=\\s*(-?[0-9.]+|true|false|"[^"]*")', 'm'))?.[1];
  manifest.settings.push({ variable: m[1], type: m[2], section: m[3], key: m[4], default: value === undefined ? null : value.startsWith('"') ? value.slice(1, -1) : value === 'true' ? 1 : value === 'false' ? 0 : Number(value) });
}
manifest.scripts = await readdir(path.join(root, 'scripts'));
const midi = await readFile(path.join(root, 'scripts/midi_instruments/midi_instruments.gml'), 'utf8');
for (const [name, target] of [['midi_ins', manifest.midi], ['midi_drum', manifest.drums]]) {
  const pattern = new RegExp(name + '\\[a, 0\\] = "([^"]*)"[^\\n]*\\n\\s*' + name + '\\[a, 1\\] = (-?\\d+) ' + name + '\\[a, 2\\] = (-?\\d+)', 'g');
  for (const m of midi.matchAll(pattern)) target.push({ name: m[1], instrument: Number(m[2]), pitch: Number(m[3]) });
}
await writeFile('src/generated/assets.json', JSON.stringify(manifest));
console.log(`Extracted ${Object.keys(manifest.sprites).length} sprites, ${manifest.instruments.length} instruments, ${manifest.songs.length} songs, ${manifest.settings.length} setting records; inventoried ${manifest.scripts.length} scripts.`);
