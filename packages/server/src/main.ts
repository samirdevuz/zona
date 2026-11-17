import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { NET } from '@zona/shared';
import qrcode from 'qrcode-terminal';
import { WebSocketServer } from 'ws';
import { lanAddresses } from './lan';
import { Session, type Conn } from './session';
import { createStaticHandler } from './static';

const port = Number(process.env.PORT ?? NET.DEFAULT_PORT);
const debug = process.env.ZONA_DEBUG === '1';
const quiet = process.env.ZONA_QUIET === '1';
const clientDir = fileURLToPath(new URL('../../client/dist', import.meta.url));

const session = new Session({ debug, log: (m) => !quiet && console.log(m) });
const serveStatic = createStaticHandler(clientDir);
const server = createServer((req, res) => {
  // Test hook (ZONA_DEBUG=1 only): reset to an empty lobby between E2E tests.
  if (debug && req.url === '/__debug/reset') {
    session.reset();
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  serveStatic(req, res);
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: NET.MAX_MESSAGE_BYTES });

wss.on('connection', (ws) => {
  ws.binaryType = 'nodebuffer';
  const conn: Conn = {
    send: (data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    },
    close: () => ws.close(),
  };
  session.onConnect(conn);
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    try {
      session.onMessage(conn, data.toString());
    } catch (err) {
      console.error('[ws] message error', err);
    }
  });
  ws.on('close', () => session.onClose(conn));
  ws.on('error', () => ws.close());
});

// Fixed-rate world tick with drift compensation (GAME.md 3.3: 30 Hz).
const tickMs = 1000 / NET.SERVER_TICK_HZ;
let next = performance.now();
let lastWarn = 0;
function loop(): void {
  const now = performance.now();
  let steps = 0;
  while (now >= next && steps < 5) {
    try {
      session.tick();
    } catch (err) {
      console.error('[tick] error', err);
    }
    next += tickMs;
    steps++;
  }
  if (now - next > 250) next = now; // after a long stall, do not try to catch up
  if (session.tickMsMax > NET.TICK_WARN_MS && now - lastWarn > 10000) {
    lastWarn = now;
    console.warn(`[tick] slow tick: avg ${session.tickMsAvg.toFixed(1)} ms, max ${session.tickMsMax.toFixed(1)} ms`);
  }
  setTimeout(loop, Math.max(0, next - performance.now()));
}

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Close the other server or set PORT=3001.`);
  else console.error(err);
  process.exit(1);
});

server.listen(port, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log('');
  console.log('  ZONA server is running.');
  console.log(`  On this PC:        http://localhost:${port}`);
  for (const ip of ips) console.log(`  Friends on LAN:    http://${ip}:${port}`);
  if (ips.length === 0) console.log('  (No LAN address found - connect this PC to WiFi/LAN.)');
  if (debug) console.log('  Debug commands: ON (ZONA_DEBUG=1)');
  console.log('');
  if (ips[0] && !quiet) {
    qrcode.generate(`http://${ips[0]}:${port}`, { small: true }, (q: string) => console.log(q));
  }
  loop();
});

const shutdown = (): void => {
  console.log('\nShutting down.');
  wss.close();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
