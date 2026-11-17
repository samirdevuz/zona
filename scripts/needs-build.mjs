// Exit code 0 = a (re)build is needed, 1 = the build is up to date.
// Used by start.bat / start.sh so a fresh checkout or a `git pull` rebuilds automatically.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const outputs = ['packages/client/dist/index.html', 'packages/server/dist/main.js'];
const inputs = ['packages/shared/src', 'packages/server/src', 'packages/client/src', 'packages/client/public', 'packages/client/index.html', 'package.json'];

function newest(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let m = 0;
  for (const name of readdirSync(path)) m = Math.max(m, newest(join(path, name)));
  return m;
}

if (outputs.some((p) => !existsSync(p))) process.exit(0);
const builtAt = Math.min(...outputs.map((p) => statSync(p).mtimeMs));
const changedAt = Math.max(...inputs.map(newest));
process.exit(changedAt > builtAt ? 0 : 1);
