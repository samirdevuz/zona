// Build the game's sound effects from the CC0 recordings in assets-src/ (see sources.json).
// Needs ffmpeg on PATH. Usage: npm run assets:fetch && npm run assets:audio
// Output: packages/client/public/assets/sounds/*.ogg and the `sounds` section of the asset manifest.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'assets-src');
const OUT = join(ROOT, 'packages/client/public/assets');
const sources = JSON.parse(readFileSync(join(ROOT, 'scripts/assets/sources.json'), 'utf8'));
const LIB = 'firearms/Prepared SFX Library';

/**
 * Clips: `shot` = take the n-th shot of a multi-shot recording (onsets found with
 * silencedetect), `len` seconds with a fade-out over the last 40 %, mono, peak -1 dBFS.
 * Near takes are recorded beside the shooter, mid takes ~50 m in front (used for far shots).
 */
const CLIPS = [
  ['shot.ar1', 'firearms', `${LIB}/AR-15/D_32P.wav`, { shot: 0, len: 0.7 }],
  ['shot.ar1.far', 'firearms', `${LIB}/AR-15/D_24P.wav`, { shot: 0, len: 1.5 }],
  ['shot.smg1', 'firearms', `${LIB}/Carl Gustav M45/G_31P.wav`, { shot: 0, len: 0.55 }],
  ['shot.smg1.far', 'firearms', `${LIB}/Carl Gustav M45/G_20P.wav`, { shot: 0, len: 1.3 }],
  ['shot.lmg1', 'firearms', `${LIB}/AK-47/C_28P.wav`, { shot: 0, len: 0.7 }],
  ['shot.lmg1.far', 'firearms', `${LIB}/AK-47/C_31P.wav`, { shot: 0, len: 1.5 }],
  ['shot.bolt1', 'firearms', `${LIB}/Mosin Nagant/M_21P.wav`, { shot: 0, len: 1.1 }],
  ['shot.bolt1.far', 'firearms', `${LIB}/Mosin Nagant/M_26P.wav`, { shot: 0, len: 1.8 }],
  ['shot.pistol', 'firearms', `${LIB}/1911/A_42P.wav`, { shot: 0, len: 0.6 }],
  ['shot.pistol.far', 'firearms', `${LIB}/1911/A_34P.wav`, { shot: 0, len: 1.4 }],
  ['explosion', 'chunky', 'chunky/chunky.mp3', { len: 2.6 }],
  ['explosion.far', 'distant', 'distant/distant.ogg', { len: 2.4 }],
  ['cannon', 'explosions', 'explosions/explosion1.ogg', { len: 2.2 }],
  ['reload.rifle', 'reloads', 'reloads/reload_ar.wav', { gain: -4 }],
  ['reload.pistol', 'reloads', 'reloads/reload_gun.wav', { gain: -4 }],
  ['ui.click', 'ui', 'ui/Audio/click_002.ogg', { gain: -6 }],
];

function onsets(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-40dB:d=0.3', '-f', 'null', '-'], { encoding: 'utf8' });
  return [...r.stderr.matchAll(/silence_end: ([0-9.]+)/g)].map((m) => Number(m[1]));
}

function peakDb(file, start, len) {
  const args = ['-hide_banner', ...(start ? ['-ss', String(start)] : []), ...(len ? ['-t', String(len)] : []), '-i', file, '-af', 'volumedetect', '-f', 'null', '-'];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  const m = r.stderr.match(/max_volume: (-?[0-9.]+) dB/);
  return m ? Number(m[1]) : 0;
}

const only = process.argv.slice(2);
mkdirSync(join(OUT, 'sounds'), { recursive: true });
const manifestPath = join(OUT, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.sounds ??= {};
for (const [id, srcKey, rel, o] of CLIPS) {
  if (only.length && !only.some((p) => id.startsWith(p))) continue;
  const file = join(SRC, rel);
  const start = o.shot !== undefined ? Math.max(0, onsets(file)[o.shot] - 0.01) : 0;
  const gain = -1 - peakDb(file, start, o.len) + (o.gain ?? 0);
  const filters = ['aformat=channel_layouts=mono', 'aresample=44100'];
  if (o.len) filters.push(`afade=t=out:st=${(o.len * 0.6).toFixed(3)}:d=${(o.len * 0.4).toFixed(3)}`);
  filters.push(`volume=${gain.toFixed(2)}dB`);
  const out = join(OUT, 'sounds', `${id}.ogg`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...(start ? ['-ss', start.toFixed(3)] : []), ...(o.len ? ['-t', String(o.len)] : []), '-i', file, '-af', filters.join(','), '-c:a', 'libvorbis', '-q:a', '4', out]);
  const src = sources[srcKey];
  manifest.sounds[id] = { file: `sounds/${id}.ogg`, license: src.license, source: `${src.title} by ${src.author} (${src.page})` };
  console.log(`${id.padEnd(18)} ${(statSync(out).size / 1024).toFixed(0).padStart(4)} KB  start=${start.toFixed(2)}s gain=${gain.toFixed(1)}dB`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
