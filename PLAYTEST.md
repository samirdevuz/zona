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

## M2: classes, gadgets, settings

| Check | OK? | Notes |
|---|---|---|
| Lobby: 2/3/4 teams, Auto/custom neutral zones, layout preview matches the map | | |
| Spawn screen: class cards readable, picking a zone on the map works, Deploy re-locks the mouse | | |
| Each class feels distinct (Gunner slower/tankier, Sniper one-shot headshots, SMG close range) | | |
| Med pack heals teammates, ammo box refills, zone station heals and refills | | |
| Grenades bounce and explode after 3 s; rockets hit hard; explosions are readable | | |
| Minimap: zones, teammates, enemies who fired | | |
| Announcements (attack, captured/lost, total control, 1 minute) are clear | | |

## M3: vehicles

| Check | OK? | Notes |
|---|---|---|
| Hold E to enter/exit feels right; the prompt is clear | | |
| Jeep handling: acceleration, steering at speed, braking, slopes | | |
| Passenger can shoot forward; driver view over the hood is clear | | |
| Tank: turret follows the mouse, cannon arc and reload, MG overheats | | |
| Rockets/shells/grenades damage vehicles sensibly; wreck and respawn on the pad | | |
| Ramming and walking into vehicles behave sensibly | | |
| Engine sounds help locate vehicles | | |

## M4: bots

| Check | OK? | Notes |
|---|---|---|
| Bots spread over zones, capture and defend | | |
| Easy / Medium / Hard feel different (reaction, accuracy) | | |
| Bots do not get stuck on props for long | | |
| A friend joining mid-match replaces a bot | | |
| Server stays smooth with 24 actors (F3 server tick) | | |

Recorded: `npm run sim` with 24 hard bots — average tick 0.10 ms, p99 0.42 ms (budget 8 ms).

## M5: cameras and polish

| Check | OK? | Notes |
|---|---|---|
| V cycles first → third → top-down; the choice survives a restart (Settings → General) | | |
| Third person: shots land where the crosshair is; Z swaps the shoulder; camera does not clip into walls | | |
| Third person in jeep/tank: chase camera, tank turret follows the crosshair | | |
| Top-down: W moves up the screen, mouse cursor aims, enemies under the cursor are hit | | |
| Sniper: scope in first/third person, wider view (no scope) in top-down | | |
| Rebinding a key works in game; a conflicting key swaps; "Default keys" resets | | |
| Hold M shows the big map | | |
| Turning Wi-Fi off for ~5 s, or F5, rejoins the same team and score | | |
| Distant gunfire sounds muffled; heartbeat at low HP | | |
| FPS in third person / top-down is close to first person (F3) | | |

Recorded by the E2E harness (software GL, Low, 1280×720): third person 40 draw calls / 49k triangles, top-down
38 / 48k (budget 150 / 150k). Full E2E suite (5 specs, two browser pages each) passes in ~4 min.

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
| Low, 4 teams + 4 neutral zones (8 zones, R = 400 m) | 55 | ~120k | 150 / 150k |
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
