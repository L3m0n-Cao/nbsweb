import { strToU8, zipSync } from 'fflate';
import { endTick, tempoMap, tickSeconds, type Song } from './model';
const instruments = ['harp', 'bass', 'basedrum', 'snare', 'hat', 'guitar', 'flute', 'bell', 'chime', 'xylophone', 'iron_xylophone', 'cow_bell', 'didgeridoo', 'bit', 'banjo', 'pling', 'trumpet', 'trumpet_exposed', 'trumpet_weathered', 'trumpet_oxidized'];
// A self-contained scoreboard player. Each player can start/stop independently.
export function exportDatapack(song: Song, namespace: string, description: string, packFormat = 48, radius = 64, includeLocked = false) {
  if (!/^[a-z0-9_]+$/.test(namespace)) throw new Error('Namespace must contain only lowercase letters, digits and underscores.');
  const folder = packFormat >= 48 ? 'function' : 'functions', tagFolder = packFormat >= 48 ? 'function' : 'functions';
  const files: Record<string, Uint8Array> = {}, map = tempoMap(song), objective = `nbs_${namespace}`.slice(0, 16);
  const add = (name: string, text: string) => files[name] = strToU8(text);
  const fn = (name: string, text: string) => add(`data/${namespace}/${folder}/${name}.mcfunction`, text + '\n');
  add('pack.mcmeta', JSON.stringify({ pack: { pack_format: packFormat, description } }, null, 2));
  add(`data/minecraft/tags/${tagFolder}/load.json`, JSON.stringify({ values: [`${namespace}:load`] }));
  add(`data/minecraft/tags/${tagFolder}/tick.json`, JSON.stringify({ values: [`${namespace}:tick`] }));
  fn('load', `scoreboard objectives add ${objective} dummy`);
  fn('start', `scoreboard players set @s ${objective} 0\ntag @s add ${namespace}_playing`);
  fn('stop', `tag @s remove ${namespace}_playing\nscoreboard players reset @s ${objective}`);
  fn('tick', `execute as @a[tag=${namespace}_playing] at @s run function ${namespace}:play`);
  const columns = new Map<number, string[]>();
  for (const n of song.notes) {
    const layer = song.layers[n.layer]; if (!includeLocked && layer?.locked) continue;
    const ins = song.instruments[n.instrument]; if (ins?.name === 'Tempo Changer') continue;
    if (!ins || n.instrument >= 20) throw new Error('This data-pack exporter currently requires vanilla instruments. Custom sounds and Sound Stopper export need the resource-pack exporter.');
    const pitch = .5 * 2 ** ((n.key - 33 + n.pitch / 100) / 12);
    if (pitch < .5 || pitch > 2) throw new Error('Out-of-range notes require an extra-notes resource pack. Transpose notes into Minecraft range before using this exporter.');
    const tick = Math.round(tickSeconds(n.tick, map) * 20), volume = n.velocity / 100 * (layer?.volume ?? 100) / 100;
    if (!columns.has(tick)) columns.set(tick, []);
    columns.get(tick)!.push(`playsound minecraft:block.note_block.${instruments[n.instrument]} record @a[distance=..${radius}] ~ ~ ~ ${volume.toFixed(4)} ${pitch.toFixed(6)}`);
  }
  const commands: string[] = [];
  for (const [tick, lines] of [...columns].sort((a, b) => a[0] - b[0])) { fn(`notes/${tick}`, lines.join('\n')); commands.push(`execute if score @s ${objective} matches ${tick} run function ${namespace}:notes/${tick}`); }
  const end = Math.max(1, Math.ceil(tickSeconds(endTick(song) + 1, map) * 20));
  commands.push(`scoreboard players add @s ${objective} 1`);
  commands.push(`execute if score @s ${objective} matches ${end}.. run function ${namespace}:stop`);
  fn('play', commands.join('\n'));
  add('README.txt', `Place this ZIP in your world's datapacks folder and run /reload.\nStart as a player: /function ${namespace}:start\nStop: /function ${namespace}:stop\nTiming is quantized to Minecraft's 20 Hz tick rate. This exporter does not include panning, automatic loops, or resource packs.\n`);
  return zipSync(files);
}
