# ZONA

Team-based zone-control FPS for the browser, hosted on your own PC and played over LAN.
See [GAME.md](GAME.md) for the full design. Uzbek instructions: [README.uz.md](README.uz.md).

Status: **M1 (vertical slice)** in progress.

## Quick start

Requirements: Node.js 20.19+ (22 LTS recommended).

```bash
npm install
npm run build
npm start
```

The server prints LAN URLs and a QR code. Open the URL in Chrome/Edge/Firefox on any PC in the same network.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | server with auto-restart + Vite dev server (http://localhost:5173) |
| `npm run build` | build client (Vite) and server (esbuild) |
| `npm start` | serve the built game on port 3000 (`PORT` to override) |
| `npm run check` | typecheck + lint + unit tests |
| `npm test` | unit tests (Vitest) |
| `npm run e2e` | build + Playwright end-to-end test (two browser pages) |
| `npm run sim` | headless server simulation with scripted actors (tick-time budget check) |

## Layout

```
packages/shared   pure TS: config, math, rng, map generator, simulation, protocol
packages/server   Node: http + ws, lobby, match loop
packages/client   Vite + three.js: rendering, input, prediction, UI, audio
tests/e2e         Playwright
```
