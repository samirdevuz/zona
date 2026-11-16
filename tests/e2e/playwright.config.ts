import { defineConfig } from '@playwright/test';

const PORT = 3123;

export default defineConfig({
  testDir: '.',
  timeout: 300_000,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/e2e-output',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    trace: 'off',
    launchOptions: {
      // Software GL (SwiftShader) so WebGL2 works headless (GAME.md 15).
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'node packages/server/dist/main.js',
    cwd: '../..',
    url: `http://localhost:${PORT}`,
    env: { PORT: String(PORT), ZONA_DEBUG: '1', ZONA_QUIET: '1' },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
