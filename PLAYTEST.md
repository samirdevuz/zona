# Playtest checklist (M1)

Run this with friends on the real LAN. Write findings in the "Notes" column; anything confusing counts.

## Setup

- [ ] Host PC: `scripts\start.bat` starts, prints LAN URL + QR. Firewall prompt allowed on *Private*.
- [ ] Friend PC opens the printed `http://192.168.x.x:3000` and reaches the menu.
- [ ] Lobby: both players listed, team switch works, admin sees settings and Start.

## Feel

| Check | OK? | Notes |
|---|---|---|
| Mouse look is smooth; sensitivity setting feels right | | |
| Walking/sprinting/crouching/jumping respond instantly | | |
| No rubber-banding while moving (F3: "corrections" stays near 0 except after respawn) | | |
| Stepping onto low cover / tower stairs works; cannot walk through walls | | |
| Shooting: muzzle flash, tracer, sound; hit markers appear on hits | | |
| Recoil and spread feel fair (hip vs ADS) | | |
| Time-to-kill feels right (AR-1: 5 body / 3 head shots up close) | | |
| Death screen, respawn timer, choosing zone with number keys | | |

## Zones and match

| Check | OK? | Notes |
|---|---|---|
| Capture bar and zone strip clearly show who owns/captures what | | |
| Contested zone is obvious (red flashing) | | |
| Capturing, losing and re-capturing a zone works | | |
| Scores tick up 0.5/s per owned zone | | |
| Winner banner, results screen, back to lobby, rematch | | |

## Performance (fill in on the weakest PC)

| PC | Preset | FPS (F3) | Draw calls | Triangles | Notes |
|---|---|---|---|---|---|
| | Low | | | | |
| | Medium | | | | |

### Recorded by the E2E harness (headless Chromium, SwiftShader software GL, 1280×720)

FPS cannot be measured under software GL; `renderer.info` is the proxy (GAME.md 15).

| Preset | Draw calls | Triangles | Budget (calls / tris) |
|---|---|---|---|
| Low | 32–33 | 35k–46k | 150 / 150k |
| Medium (1024 shadow map) | 42 | ~50k | 250 / 300k |
| High (2048 shadow map, MSAA) | 42 | ~53k | 400 / 600k |

Server: average tick 0.1 ms with 24 scripted actors (`npm run sim`), budget 8 ms.

### Per-frame allocation review (M1)

The frame loop (`GameClient.frame`) reuses all vectors, pose/HUD/viewmodel objects, the input-step array and the
interpolation buffers (fixed ring buffer of Float64Arrays). Effects use fixed pools (tracers, impact puffs,
flashes). DOM writes go through `setText`/`setStyle`, which only touch the DOM when a value changed. Remaining
per-frame garbage is a few short strings for HUD style values; no `new` of three.js objects in the loop.

## Findings

- (date, who, what happened, what to tweak)
