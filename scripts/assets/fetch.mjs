// Download the CC0 source archives listed in sources.json into assets-src/<key>/ (not committed).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
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
  for (const [name, data] of Object.entries(unzipSync(buf))) {
    if (name.endsWith('/') || name.includes('__MACOSX') || name.includes('..')) continue;
    const out = join(dir, name);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, data);
  }
  writeFileSync(join(dir, '.done'), sha);
}
