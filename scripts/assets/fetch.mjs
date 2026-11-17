// Download the CC0 source archives listed in sources.json into assets-src/<key>/ (not committed).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Extract a .7z archive in memory (7-Zip compiled to WebAssembly: no system tool needed). */
async function un7z(buf) {
  const { default: SevenZip } = await import('7z-wasm');
  const sz = await SevenZip({ print: () => {}, printErr: () => {} });
  sz.FS.writeFile('/in.7z', buf);
  sz.callMain(['x', '/in.7z', '-o/out', '-y']);
  const out = {};
  const walk = (dir, rel) => {
    for (const name of sz.FS.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      const path = `${dir}/${name}`;
      if (sz.FS.isDir(sz.FS.stat(path).mode)) walk(path, `${rel}${name}/`);
      else out[`${rel}${name}`] = sz.FS.readFile(path);
    }
  };
  walk('/out', '');
  return out;
}
const sources = JSON.parse(readFileSync(join(ROOT, 'scripts/assets/sources.json'), 'utf8'));
for (const [key, s] of Object.entries(sources)) {
  const dir = join(ROOT, 'assets-src', key);
  if (existsSync(join(dir, '.done'))) {
    console.log(`${key}: already fetched`);
    continue;
  }
  console.log(`${key}: downloading ${s.url}`);
  const res = await fetch(s.url);
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const sha = createHash('sha256').update(buf).digest('hex');
  if (s.sha256 && sha !== s.sha256) throw new Error(`${key}: checksum mismatch (${sha})`);
  const files = s.url.endsWith('.7z') ? await un7z(buf) : unzipSync(buf);
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/') || name.includes('__MACOSX') || name.includes('..')) continue;
    const out = join(dir, name);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
  }
  writeFileSync(join(dir, '.done'), sha);
}
