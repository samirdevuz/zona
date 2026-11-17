// Dev tool: render GLBs from packages/client/public/assets with preview.html into a PNG.
// node scripts/assets/dev/shot.mjs out.png "files=models/jeep.glb,models/tank.glb&yaw=0.7"
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';
const [out, query] = process.argv.slice(2);
const root = new URL('../../..', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json' };
const srv = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = p === '/' ? 'scripts/assets/dev/preview.html' : p;
    const data = await readFile(join(root, file));
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const port = srv.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', (e) => console.error(e.message));
await page.goto(`http://localhost:${port}/?${query}`);
await page.waitForFunction(() => globalThis.document.title === 'done', null, { timeout: 60000 });
await page.locator('canvas').screenshot({ path: out });
await browser.close();
srv.close();
