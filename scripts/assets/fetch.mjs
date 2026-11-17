// Download the CC0 source archives listed in sources.json into assets-src/<key>/ (not committed).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

async function download(url, sha256, key) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha256 && sha !== sha256) throw new Error(`${key}: checksum mismatch (${sha})`);
  return buf;
}

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
  if (s.files) {
    // Single files (sounds): name -> [url, sha256].
    for (const [name, [url, want]] of Object.entries(s.files)) {
      console.log(`${key}: downloading ${url}`);
      const data = await download(url, want, key);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), data);
    }
    writeFileSync(join(dir, '.done'), 'ok');
    continue;
  }
  console.log(`${key}: downloading ${s.url}`);
  const buf = await download(s.url, s.sha256, key);
  const sha = s.sha256;
  const files = s.url.endsWith('.7z') ? await un7z(buf) : unzipSync(buf);
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/') || name.includes('__MACOSX') || name.includes('..')) continue;
    const out = join(dir, name);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
  }
  writeFileSync(join(dir, '.done'), sha);
}
