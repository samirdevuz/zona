// Runs the game server (with auto-restart) and the Vite dev server side by side.
import { spawn } from 'node:child_process';

const isWin = process.platform === 'win32';
const npx = isWin ? 'npx.cmd' : 'npx';
const procs = [
  spawn(npx, ['tsx', 'watch', 'packages/server/src/main.ts'], { stdio: 'inherit', shell: isWin, env: { ...process.env, ZONA_DEV: '1' } }),
  spawn(npx, ['vite', '--config', 'packages/client/vite.config.ts'], { stdio: 'inherit', shell: isWin }),
];
const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && code !== 0 && stop());
