# ZONA — Game Design & Technical Spec

> Working title: **ZONA**. Spec version 0.1 (2026-11-16).
> Language: English (for the AI developer), with a short Uzbek summary below.
> This document is the single source of truth. If code and this document disagree, fix one of them and record why in `DECISIONS.md`.

## Qisqacha (o'zbekcha)

ZONA — brauzerda ishlaydigan, bitta WiFi (LAN) orqali do'stlar bilan o'ynaladigan multiplayer **birinchi shaxs (FPS)** o'yini. Xaritada zonalar (A, B, C, D...) bor. Har bir jamoa o'z zonasidan boshlaydi, neytral va dushman zonalarini egallaydi. **Zona = spawn nuqtasi = ball manbai = mashina manbai.** Hech qanday zonasi qolmagan jamoa yutqazadi. 4 ta klass (askar, snayper, pulemyotchi, muhandis), mashinalar (jip, tank), botlar, low-poly uslub, kuchsiz kompyuterlarda ham ishlaydi. Kamera: hozir faqat birinchi shaxs; keyinroq 3-shaxs va tepadan ko'rinish qo'shiladi (arxitektura buni oldindan hisobga oladi).

---

## 0. Working agreement (read first)

1. **Build milestone by milestone** (section 16). Finish the current milestone completely (all acceptance criteria, tests green, committed and pushed) before starting the next. Do not start M2 while M1 is not accepted.
2. **Fun first, then features.** M1 must feel good to play before anything else is added.
3. **Do not invent features** outside the current milestone. Put ideas in `BACKLOG.md`.
4. **Ambiguity rule:** choose the simplest option consistent with the pillars (section 1), record it in `DECISIONS.md` (one short paragraph: decision, alternatives, why), and continue. Ask the user only when blocked.
5. **All tunable numbers live in `packages/shared/src/config/`** (weapons, classes, vehicles, zones, match, movement, network). No magic numbers in gameplay code.
6. **Verify, don't assume.** After each meaningful step run `npm run check` (typecheck + lint + unit tests). For anything visual or networked, run the E2E harness (section 15), look at the screenshots yourself, and fix what looks wrong.
7. **Performance is a feature.** Respect the budgets in section 13 from day one; do not "optimize later".
8. **Commit small and often**, push to the remote. Commit messages in English, imperative mood.
9. Code, comments, commit messages and docs are in English. Replies to the user are in **Uzbek** (Latin script), short and concrete.
10. At the end of every milestone, report in Uzbek: what works, how to run it on the user's own PC (Windows `start.bat`), known issues, and which numbers to tweak.

---

## 1. Vision and pillars

**Pitch:** a team-based zone-control shooter you can host on your own PC and play with friends over the same WiFi. Capture zones, hold them, spawn from them, drive vehicles from them.

**Pillars**
1. **Zones drive everything.** Spawning, score, resupply and vehicles all come from owned zones. Losing zones hurts in every way, so every zone fight matters.
2. **Easy to host, easy to join.** One command (or one double-click) on the host PC; friends open a URL. No installs, no accounts, no internet required.
3. **Runs on weak PCs.** Low-poly, flat-shaded, aggressively budgeted. 60 FPS on an old laptop with integrated graphics.
4. **Varied but simple matches.** Players choose number of teams, number of neutral zones, bots, map seed. Same rules, many different matches.
5. **Readable combat.** Clear silhouettes, team colors, simple weapons, short time-to-kill. Skill and teamwork beat stats.

**Non-goals (for now):** internet matchmaking, accounts, progression/unlocks, voice chat, destructible terrain, mobile/touch controls, anti-cheat, ranked play.

---

## 2. Hard constraints

- **Platform:** desktop browsers (latest Chrome/Edge/Firefox), keyboard + mouse only. WebGL2 required; show a clear error if missing.
- **Network:** LAN. One host PC runs the Node server (and may also play in a browser on the same PC). Friends connect via `http://<host-LAN-IP>:3000`.
- **Target hardware (Low preset):** 2-core CPU, 4 GB RAM, Intel UHD 620-class GPU, 1366x768 to 1920x1080.
- **Stack:** TypeScript (strict), Node.js 20+, Vite, Three.js, `ws`. No game engine, no physics engine (custom kinematic movement and collision, see section 3.4).
- **Assets:** the game must be fully playable with **zero external assets** (everything generated from primitives and procedural audio). Optional CC0/permissive models may replace placeholders later (section 11).

---

## 3. Architecture

### 3.1 Repository layout

```
zona/
  package.json              # npm workspaces
  tsconfig.base.json
  GAME.md  README.md  README.uz.md  DECISIONS.md  BACKLOG.md  PLAYTEST.md  CREDITS.md
  scripts/  start.bat  start.sh
  assets-src/               # optional external models/audio (+ licenses)
  packages/
    shared/                 # PURE TypeScript, no DOM, no Node APIs
      src/config/           # all tunables (weapons, classes, vehicles, zones, match, movement, net)
      src/math/  src/rng/   # vectors, mulberry32 PRNG, integer-hash value noise
      src/map/              # zone layout, terrain, props, nav grid, map generator + validator
      src/sim/              # movement step, collision, combat rules, capture logic, match rules
      src/protocol/         # message types, encode/decode, protocol version
    server/                 # Node: ws server, lobby, match loop, bots, static hosting, LAN URL + QR
    client/                 # Vite + Three.js: render, input, prediction, interpolation, UI, audio, i18n
  tests/e2e/                # Playwright (headless Chromium)
```

### 3.2 Principles

- **Server-authoritative.** The server owns truth for positions, health, hits, zones, scores, vehicles. Clients send inputs, never state.
- **Shared deterministic simulation code.** Movement, collision and vehicle stepping live in `shared` and run identically on server and client (client uses it for prediction). No `Date.now()`, `Math.random()` or DOM access in `shared`; pass time and RNG in.
- **Uniform actors.** Humans and bots both produce the same `InputCommand`; the sim does not care who produced it.
- **Map data is sent, not re-generated, by clients.** The server generates the map once per match and sends a compact blob (seed, params, heightfield as Int16 centimeters, props, zones, pads, spawn points). This avoids cross-browser float differences. The generator still must be deterministic for a given seed (tests).
- **Camera rig abstraction from day one.** Rendering of the local player goes through a `CameraRig` interface (`FirstPersonRig` now; `ThirdPersonRig` and `TopDownRig` in M5). Aim direction, hit origin and the local player's visible body are decoupled from the camera. Remote players always render with a full-body low-poly character model, so third-person needs no new netcode.
- **i18n from day one.** All UI strings via `t(key)`; dictionaries `uz` (default) and `en`.

### 3.3 Timing and networking

| Constant | Value | Notes |
|---|---|---|
| `MOVE_DT` | 1/60 s | fixed step for player and vehicle movement (client and server) |
| `SERVER_TICK_HZ` | 30 | world tick: processes up to 2 input steps per actor, projectiles, zones, scoring |
| `SNAPSHOT_HZ` | 30 | state snapshots to clients |
| `INPUT_SEND_HZ` | 30 | client batches 2 input steps per packet |
| `INTERP_DELAY_MS` | 100 | remote entities rendered this far in the past |
| `MAX_HUMANS` | 12 | default cap |
| `MAX_ACTORS` | 24 | humans + bots default cap |

- Transport: WebSocket (`ws`). Messages are typed objects defined in `shared/protocol`; JSON in M1, designed so a binary encoding can replace it without touching game code. Include `PROTOCOL_VERSION`; reject mismatches with a friendly message.
- **Client prediction + reconciliation** for the local player (and the local player's vehicle): client applies inputs immediately; server acks the last processed input `seq` in each snapshot; client rewinds to the server state and replays unacked inputs.
- **Remote entities:** buffered snapshots, linear interpolation (slerp for yaw), small extrapolation (max 100 ms) on starvation.
- **Hits:** hitscan weapons are resolved by the server with raycasts against current actor hitboxes (head sphere + body capsule) and static colliders. No lag compensation in M1 (LAN latency is tiny); leave a `LAG_COMP_MS` config flag (0 = off) for later. Client shows muzzle flash and tracer instantly; hit markers and damage numbers come from server events.
- **Projectiles** (rockets, tank shells, grenades) are server entities with swept raycasts every step to prevent tunneling.
- **Reliable events** (kill, capture, explosion, announcement) travel in the same ordered WebSocket stream, tagged with the server tick.
- **Clock sync:** ping/pong, show ping in the scoreboard.
- **Server hosting:** `npm start` serves the built client over HTTP and the WebSocket on the same port (default 3000, `PORT` env override), listening on `0.0.0.0`. On startup print all LAN URLs (non-internal IPv4) and render a QR code for the first one in the console.
- **Session model:** one lobby/match per server process. The first connected player is **admin** (settings, start, kick). If the admin leaves, the oldest player becomes admin. Mid-match disconnect: actor stays 60 s for reconnect (by stored token in `sessionStorage`), then is removed.
- **Late join:** allowed during a match; the player lands on the spawn screen and is assigned to the team with the fewest humans (can change team only in lobby).

### 3.4 Movement and collision (custom, deterministic)

- Player is a vertical **capsule** (height 1.8 m, crouch 1.2 m, radius 0.4 m, eye height 1.65 m, crouch 1.1 m).
- Static colliders are only **axis-aligned boxes** and **vertical cylinders**; terrain is a **heightfield**. Stored in a uniform grid (cell 8 m) for fast queries.
- Collide-and-slide against colliders, step-up up to 0.45 m, walkable slope up to 45 degrees, ground snapping.
- Vehicles are kinematic **arcade** models (no rigid-body physics): box collider for world collisions, terrain-following with simple pitch/roll from 4 sampled ground points, speed-based steering.

### 3.5 Server performance budget

Simulation tick must stay under **8 ms** (of 33 ms) with 24 actors, 4 vehicles and 20 projectiles on a laptop CPU. Keep a rolling tick-time stat; log a warning above 15 ms. Bots' heavy logic (pathfinding) is time-sliced (at most N path requests per tick).

---

## 4. Game rules

### 4.1 Match settings (lobby, admin controls)

| Setting | Options | Default |
|---|---|---|
| Teams (`T`) | 2, 3, 4 | 2 |
| Neutral zones (`N`) | allowed combos only (see 4.2) | Auto |
| Map seed | text/number, "Random" button | random |
| Score limit | 200 / 500 / 1000 / off | 500 |
| Time limit | 10 / 15 / 20 min / off | 15 min |
| Bots | on/off; "fill each team up to X players" (0-8); difficulty Easy/Medium/Hard | off / 4 / Medium |
| Vehicles | on/off | on |
| Friendly fire | always off | — |

**Auto zones** (default): `P` = total participants (humans + bots). `P <= 3` -> `T=2, N=0`; `4..6` -> `T=2, N=1`; `>= 7` -> `T=2, N=2`. If the admin raises `T` to 3 or 4, Auto picks `N=1`. Players may switch to "Custom" and pick `N` themselves.

The lobby shows a **live layout preview** (zone positions drawn by the shared `layoutZones(T, N)` function).

**Team assignment:** players pick a team in the lobby (or "auto-balance"). Admin can shuffle. Teams do not need equal size; with bots on, the bot fill rule evens them out: each team is filled with bots up to X, and when a human joins a team a bot of that team is removed.

### 4.2 Zones

`Z = T + N` zones. Letters **A, B, C...** (max 7). Home zones come first (A = team 1, B = team 2, ...), neutral zones after.

Allowed `(T, N)` combinations (fairness requires symmetry):

| T | Allowed N | Layout idea |
|---|---|---|
| 2 | 0, 1, 2, 3 | N=0: A and B on opposite sides. N=1: one in the center. N=2: two flank zones at +-90 degrees. N=3: center + two flanks. |
| 3 | 0, 1, 3 | N=1: center. N=3: one between each pair of homes. |
| 4 | 0, 1, 4 | N=1: center. N=4: one between each pair of neighbouring homes. |

Examples: 4 players as 2v2 on a 2-zone map (A vs B); 2v2 on a 4-zone map (two home zones + two open zones to grab); 4 players each alone on a 4-zone map (`T=4, N=0`: everyone has a home zone, no open zones); 3 teams with one open center zone (`T=3, N=1`).

**Zone anatomy** (generated by the map generator, section 7): flag pole with team-colored flag, capture ring on the ground (radius 14 m), 6-10 cover props, a **resupply station**, a **jeep pad** (neutral zones also get a **tank pad** when vehicles are on), a ring of 8 **spawn points** (radius 8-11 m).

### 4.3 Capturing

- Each zone keeps `control[team]` in `[0, 100]`. A team **owns** the zone when its control is 100.
- "Present" teams = teams with at least one **alive** actor inside the capture cylinder (radius 14 m, height +-8 m). Occupants of vehicles count.
- If **exactly one team is present**: it first **drains** other teams' control (largest first) and only when all others are 0 does its own control rise to 100. Rate: `5 * n^0.75` percent per second where `n` = number of that team's actors present (1 player = 20 s, 2 = ~12 s, 4 = ~7 s).
- If **two or more teams are present**: zone is **contested**, nothing changes, UI flashes, spawning there is blocked.
- If **nobody is present**: owned zones stay owned; partial non-owner control decays 2 percent per second.
- Ownership change fires an announcement event ("Blue captured B", "Orange lost A").

### 4.4 Scoring and winning

- Each owned zone gives its team **0.5 points per second**. Kills do not give points (they are shown on the scoreboard only).
- **Win conditions** (first that triggers):
  1. Score limit reached (highest score if two cross simultaneously).
  2. **Total control:** one team owns every zone continuously for 60 s.
  3. **Elimination:** a team that owns **no zones** cannot respawn; when none of its actors is alive, it is eliminated. Last team standing wins.
  4. Time limit reached: highest score wins; tie -> team with more owned zones; still tie -> draw.
- A team with zero zones but living actors can still fight; if they capture a zone, respawning resumes.

### 4.5 Spawning

- A dead player sees the **spawn screen**: choose class and an **owned, non-contested** zone (shown on a top-down map). Respawn timer 5 s. Spawn protection 2 s (ends on first shot or after 2 s).
- Spawn point inside the chosen zone: pick the spawn point with the greatest distance to enemies and not in enemy line of sight; fall back to random if all are bad.
- Players can also redeploy to another zone only when dead (no suicide-respawn button in M1).

### 4.6 Resupply

An owned, non-contested zone restores **+8 HP/s** and refills ammo (20 percent of reserve per second) for friendly infantry within 12 m. Vehicles within range repair slowly (+10 HP/s).

### 4.7 Match flow

`LOBBY -> COUNTDOWN (5 s) -> LIVE -> ENDING (5 s, winner banner) -> RESULTS -> LOBBY` (settings preserved, "Rematch" and "New seed" buttons for admin). Players choose class and spawn zone during COUNTDOWN as well.

### 4.8 Out-of-bounds

The map edge is a ring of hills plus a soft boundary: beyond the playable radius a warning appears and the player takes damage after 8 s ("return to the battlefield").

---

## 5. Classes and weapons

Four classes. Class is chosen at each spawn. Every class has a pistol. Slots: `1` primary, `2` pistol, `3` gadget A, `4` gadget B, `G` quick grenade (Assault only).

| Class | HP | Move speed | Primary | Gadget A | Gadget B | Role |
|---|---|---|---|---|---|---|
| **Assault** (askar) | 100 | x1.00 | AR-1 rifle | Med pack | Frag grenade x2 | all-rounder, heals team |
| **Engineer** (muhandis) | 100 | x1.00 | SMG-1 | Repair torch | Rocket launcher (4 rockets) | anti-vehicle, repairs |
| **Gunner** (pulemyotchi) | 120 | x0.88 | LMG-1 | Ammo box | — | holds zones, suppresses |
| **Sniper** (snayper) | 85 | x1.00 | BOLT-1 | — | — | long range, picks targets |

### 5.1 Weapon data (initial; all in `config/weapons.ts`, expect tuning)

| Weapon | Body / Head dmg | RPM | Mag / Reserve | Reload | Spread hip / ADS (deg) | Falloff | Notes |
|---|---|---|---|---|---|---|---|
| AR-1 | 20 / 40 | 600 | 30 / 120 | 2.2 s | 1.5 / 0.4 | full to 40 m, 60% at 100 m | auto, vertical recoil pattern |
| SMG-1 | 14 / 28 | 900 | 35 / 140 | 1.9 s | 2.5 / 1.2 | full to 20 m, 50% at 60 m | fast, short range |
| LMG-1 | 16 / 32 | 750 | 100 / 200 | 5.0 s | 3.0 / 1.5 | full to 35 m, 60% at 90 m | spread blooms +0.15 deg per shot (max 6); x0.5 spread when crouched and still |
| BOLT-1 | 70 / 150 | 42 (bolt 1.4 s) | 5 / 20 | 3.0 s | 4.0 / 0.05 | none | 4x scope, small sway; head = kill |
| Pistol | 25 / 50 | 400 (semi) | 12 / 36 | 1.5 s | 1.8 / 0.8 | full to 25 m, 50% at 70 m | all classes |

- Hitboxes: head sphere (r 0.18 m) and body capsule. Head multiplier is in the table. No limb hitboxes in M1.
- Movement modifies spread: moving +50%, sprinting cannot fire, airborne +300%.
- Health regen: starts 8 s after last damage, 8 HP/s. Med packs and zone resupply are faster.
- Bullets are hitscan (no drop) in M1.

### 5.2 Gadgets

| Gadget | Behaviour |
|---|---|
| Med pack (Assault) | Placed on the ground; heals friendly infantry within 3 m at 10 HP/s for 15 s. Cooldown 25 s. |
| Frag grenade (Assault) | Fuse 3.0 s, bounces, radius 5 m, 100 dmg at center falling to 0. 2 carried, refilled by ammo box / zone. |
| Repair torch (Engineer) | Hold on a friendly vehicle: +60 HP/s. Repairs vehicles only (infantry healing is the Assault's med pack). |
| Rocket launcher (Engineer) | Speed 45 m/s, reload 3.5 s, 4 rockets total. Vs infantry: 60 direct + splash 4 m (max 100). Vs vehicles: 160. |
| Ammo box (Gunner) | Placed; refills ammo and grenades for friendly infantry within 3 m (25 percent of reserve per second) for 15 s. Cooldown 30 s. |

### 5.3 Damage to vehicles

Per-weapon `vehicleDamageMult`: AR-1 0.15, SMG-1 0.10, LMG-1 0.20, BOLT-1 0.50, Pistol 0.05, grenade 0.6, rocket and tank shell use their own vehicle damage values. Infantry weapons alone should be a poor way to kill a tank; Engineers are the counter.

---

## 6. Vehicles (M3)

Vehicles appear on **pads** inside zones. A vehicle appears only if the pad's zone is currently owned by someone; a pad in a zone with no owner stays empty. Vehicles are **team-neutral until entered**: any player may enter an empty vehicle (`E`), and while occupied it belongs to the driver's team (team-colored markings update). Abandoned for 60 s -> returns to its pad. Destroyed -> explosion (splash 6 m, 80 dmg), occupants die, wreck removed after 5 s, respawn timer on the pad.

| Vehicle | HP | Seats | Speed | Weapons | Pad respawn |
|---|---|---|---|---|---|
| **Jeep** | 250 | 2 (driver, passenger) | max 24 m/s, accel 14 m/s2, turn 1.8 rad/s (reduced at speed) | passenger fires own primary weapon within a forward arc; ramming damages infantry based on speed | 30 s |
| **Tank** | 700 | 1 (driver-gunner) in M3 (gunner seat later) | max 10 m/s, hull turn 0.9 rad/s | turret aims with mouse (rate-limited 90 deg/s). Cannon: shell 80 m/s with gravity, 110 vs infantry (splash 5 m), 150 vs vehicles, reload 3.0 s. Coax MG: 12 dmg, 600 RPM, overheats after 5 s of fire | 75 s |

- Enter/exit: `E` (hold 0.3 s). Exiting at speed > 8 m/s deals fall damage.
- Camera inside vehicles: first-person from the vehicle's seat (jeep driver: hood-level; tank: gunner sight/turret camera). Third-person vehicle cam arrives in M5.
- Vehicle capture: occupants count toward zone capture.
- Vehicles are simulated with the same shared stepping approach as players (prediction for the driver).

---

## 7. Map generation

All maps are procedural, symmetric and fair. Implemented in `shared/map` with a validator.

**Inputs:** `seed`, `T`, `N`. **Output:** `MapData` blob (section 3.2).

1. **Size:** playable radius `R = 120 + 35 * Z` meters (Z=2 -> 190 m, Z=4 -> 260 m, Z=7 -> 365 m). Beyond `R` is a hill ring; soft boundary rules from 4.8.
2. **Zone layout** (`layoutZones(T, N)`): homes at angles `2*pi*i/T` on radius `0.72 R`. Neutral zones per table in 4.2: N=1 center; ring neutrals at radius `0.38 R` with angular offset `pi/T`; for `T=2, N=2` at +-90 degrees; `T=2, N=3` center + two flanks.
3. **Terrain:** heightfield, cell 3 m. Fractal value noise from an integer-hash function (use only `+ - * /`, `floor`, bit ops; avoid `Math.sin/cos/random` inside the generator for determinism). **Symmetry by polar folding:** sample noise at folded coordinates `theta' = theta mod (2*pi/T)`, mirrored if `theta' > pi/T`. Amplitude 6-10 m. Flatten within 22 m of zone centers and along roads. Raise a ridge near `R`.
4. **Roads:** flattened strips linking every home to its neighbouring zones and to the center (if any). Vehicles prefer them (bots too).
5. **Props:** trees (cone/trunk), rocks, boulders, shipping containers, concrete barriers, sandbag walls, ruined wall segments, watch towers (sniper nests with a ladder-free ramp), small bunkers. Generate props for one sector and replicate with the same symmetry transform. Keep **cover density** higher near zones and lower in open fields (sniper lanes) so each zone offers short, medium and long sight lines.
6. **Colliders:** axis-aligned boxes and vertical cylinders only (rotations in 90 degree steps for boxes; cylinders may look rotated). Visual meshes may be freer than colliders but must not mislead (no walk-through walls).
7. **Zone interiors:** place flag, capture ring decal, resupply station, jeep pad, optional tank pad, 8 spawn points, cover.
8. **Nav grid** (server only): 2 m cells with walkable flags from slope and colliders; used by bots.
9. **Validator** (runs in tests and at runtime; regenerate with `seed + 1` on failure): every zone reachable from every other via the nav grid; spawn points and pads not inside colliders; symmetry check (zone distances and prop counts equal per team sector); all pads on flat enough ground.

Rendering: terrain as chunks (e.g. 16x16 cells) with vertex colors (grass, dirt, rock by slope/height), flat shading. Props as `InstancedMesh` per type.

---

## 8. Controls and camera

### 8.1 Controls (rebindable later; defaults)

| Action | Key |
|---|---|
| Move | W A S D |
| Look | mouse (pointer lock) |
| Fire / Aim down sights | LMB / RMB |
| Sprint / Crouch / Jump | Shift / C or Ctrl / Space |
| Reload / Use gadget / Quick grenade | R / Q / G |
| Weapon slots | 1 2 3 4, mouse wheel |
| Enter/exit vehicle | E |
| Scoreboard / Map | Tab / M |
| Menu | Esc (shows "click to resume" overlay) |
| Debug stats | F3 |

Settings: mouse sensitivity (+ separate ADS multiplier), invert Y, FOV 70-110 (default 90), master/sfx volume, graphics preset, render scale, language.

### 8.2 Camera modes

- **M1-M4:** first-person only (`FirstPersonRig`) with a simple low-poly viewmodel (weapon + hands) and recoil/sway.
- **M5:** add `ThirdPersonRig` (over-the-shoulder, shoulder swap, collision-aware) and `TopDownRig` (angled top-down, mouse aims on ground plane). Player can switch in settings (and optionally a hotkey). Server is unaffected; only aim origin/direction computation on the client changes (aim ray is sent as yaw/pitch as before; in top-down yaw/pitch are derived from the ground target). Balance note: top-down players have no scope zoom; sniper zoom is replaced by a larger view radius.

---

## 9. Bots (M4)

Bots are server-side actors producing the same `InputCommand` as humans.

- **Strategy:** each bot picks an objective every 2-4 s: nearest zone that is not owned (or owned but contested / under threat), with class-based weights (Sniper prefers zones with long sight lines and holds back 25-40 m; Gunner prefers holding owned contested zones; Assault/Engineer push). Avoid all bots choosing the same zone (spread by team-level assignment).
- **Navigation:** A* on the nav grid, path smoothing, stuck detection (replan, jump, strafe). Time-sliced path requests.
- **Perception:** view cone 120 degrees, range 80 m, line-of-sight raycasts at 5-10 Hz, hearing of nearby gunfire.
- **Combat:** reaction delay, aim error that shrinks while target is visible, strafing, burst firing, reload when safe, retreat to resupply when low HP.
- **Difficulty** (reaction / aim error / accuracy scale): Easy 0.8 s / 6 deg / 0.6; Medium 0.5 s / 3.5 deg / 0.8; Hard 0.3 s / 2 deg / 1.0.
- **Vehicles:** bots do not drive in M4 (optional later: jeep passenger/driver with road following).
- **Names:** drawn from a pool of Uzbek given names; label bots with a small robot icon in the scoreboard.
- Class composition per team is balanced (no team of 8 snipers).

---

## 10. UI/UX

Screens: **Main menu** (name, "Host info"/"Join", settings) -> **Lobby** (player list by team, team picker, settings for admin, zone layout preview, bot options, ready/start) -> **Spawn screen** (class cards with stats, top-down map with zone ownership and contested markers, respawn timer) -> **HUD** -> **Scoreboard** (Tab: per team score, per player kills/deaths/captures/ping, bot icon) -> **Results** (winner, team stats, back to lobby / rematch).

**HUD:** crosshair that reflects spread, health bar, ammo and gadget status, hit markers, damage direction indicator, kill feed (top-right), team scores and zone status strip (top-center; zone letters in team-colored circles, contested flashing, capture progress), local zone capture bar when inside a zone, minimap (zones, teammates, recently spotted enemies), announcements, interaction prompts ("E: enter jeep"), vehicle HP/ammo.

**Style:** flat, high-contrast, readable. Team colors (colorblind-safe pairs plus icons/letters): Blue `#3B82F6`, Orange `#F59E0B`, Green `#22C55E`, Purple `#A855F7`. System font stack; tabular numerals for counters. Default UI language: Uzbek (Latin), English available.

---

## 11. Art direction and assets

- **Look:** flat-shaded low-poly, limited palette per map, hemisphere light + one directional sun, linear distance fog, simple procedural sky gradient. No textures needed (vertex colors and flat materials).
- **Characters:** articulated low-poly humanoids made from primitives (torso, head, limbs, helmet, vest in team color) with simple procedural animation (walk/run swing, crouch, aim pitch on the upper body, death ragdoll-lite fall). Class silhouettes: Assault (standard), Engineer (backpack), Gunner (bulky), Sniper (long rifle, hooded). Must read clearly at 100 m.
- **Procedural first:** every model (weapons, vehicles, props, zone flags, pads) has a primitive-built fallback so the game never depends on downloads.
- **Optional external assets:** if a model looks too poor, replace it via an **asset manifest** (`assetId -> glTF path + scale + offset + license`) loaded with `GLTFLoader`; on load failure fall back to the procedural model. Allowed sources: CC0 or similarly permissive packs (e.g. Kenney, Quaternius, KayKit; check each license). Record every asset in `CREDITS.md`. Keep each model under about 2k triangles (vehicles 3-4k). If the sandbox cannot download them, the user will place packs into `assets-src/`.
- **Effects:** muzzle flash (sprite + point light only on High), tracers, impact puffs, explosion (instanced sprites), blob shadows on Low.

## 12. Audio

Web Audio API. M1-M4: **procedurally synthesized** placeholder SFX (filtered noise bursts for shots, thumps for hits, simple engine loop via oscillators). Positional audio (PannerNode) with distance rolloff for gunfire, explosions and vehicles. Categories (master, sfx, ui) with sliders. CC0 audio packs may replace placeholders in M5. No music in v1.

---

## 13. Performance budgets and quality presets

Targets (Low preset, 720p-1080p, integrated GPU): **60 FPS average, no frame over 33 ms in normal fights.**

| Budget | Low | Medium | High |
|---|---|---|---|
| Draw calls | <= 150 | <= 250 | <= 400 |
| Visible triangles | <= 150k | <= 300k | <= 600k |
| View distance (fog far) | 220 m | 320 m | 450 m |
| Shadows | blob shadows only | 1 directional map 1024, 60 m | 2048, 100 m |
| Pixel ratio cap | 1.0 | 1.25 | 2.0 |
| Antialiasing | off | off | MSAA |
| Dynamic lights | 0 | 1 | 3 |

Rules: instancing for repeated props; merge static geometry per terrain chunk; frustum culling; reuse vectors/arrays (no allocations in per-frame hot paths); object pools for projectiles/effects; no `new` inside the render loop; cap particles; materials shared; no post-processing on Low. **Render scale slider** 50-100 percent. Auto-suggest a lower preset if average FPS stays under 40 for 5 s. `F3` shows FPS, frame time, draw calls, triangles, ping, server tick time.

Initial bundle target: under 2 MB gzipped without audio/assets; lazy-load optional assets.

---

## 14. Network protocol sketch (v1)

Client -> server: `join {name, token?, protocol}`, `lobby/setTeam`, `lobby/settings` (admin), `lobby/start` (admin), `input {seq, steps:[{dt, buttons, yaw, pitch, slot}]}`, `spawn/request {class, zoneId}`, `chat` (optional), `ping`.

Server -> client: `welcome {playerId, serverTime, config}`, `lobby/state`, `match/start {map blob, settings}`, `snapshot {tick, ackSeq, actors[], vehicles[], projectiles[], zones[], scores[]}`, `event {tick, type, data}` (kill, hit, capture, explosion, announce), `match/end`, `pong`, `error`.

Buttons are a bitmask (forward, back, left, right, jump, crouch, sprint, fire, ads, reload, use, gadgetA, gadgetB, grenade).

---

## 15. Testing and verification

- **Unit tests (Vitest, `shared` + `server`):** capture logic (single team, contested, drain-then-fill, decay), scoring and all win conditions (including elimination and total control), spawn rules (no spawn in contested zones), class/weapon config sanity, movement determinism (same inputs -> same state) and collision, map generator: for every allowed `(T,N)` and 20 seeds -> validator passes, same seed -> identical output, symmetry check.
- **Simulation test:** headless server with bots only, fast-forwarded (e.g. 10 minutes of sim time) for several `(T,N)` combos: no exceptions, match ends, tick time under budget.
- **E2E (Playwright, headless Chromium with software GL, e.g. SwiftShader):** start server, open 2 pages, join lobby, start match, both see each other, one moves and the other sees it, shoot and kill, capture a zone. Capture **screenshots** and review them yourself. Fail on console errors. (FPS cannot be measured under software GL; use `renderer.info` draw calls/triangles as the proxy.)
- **`npm run check`** = typecheck + lint + unit tests. **Scripts:** `npm run dev`, `build`, `start`, `check`, `test`, `e2e`, `sim`.
- **`PLAYTEST.md`:** a manual checklist the user runs with friends (feel of movement, hit feedback, zone capture clarity, performance on the weakest PC, anything confusing) with a place to write findings.
- Also provide `scripts/start.bat` (Windows: install dependencies if missing, build if needed, start server, print URLs) and `scripts/start.sh`. `README.uz.md` explains in Uzbek how to host and how friends join, including the Windows Firewall prompt (allow on **private** networks) and the note that some WiFi networks isolate clients (then use a phone hotspot).

---

## 16. Milestones and acceptance criteria

### M1 — Vertical slice (first session)

Goal: two friends can duel for two zones on a good-looking generated map, with correct netcode and feel.

Scope:
- Monorepo, tooling, scripts, `start.bat`, LAN URL + QR on startup, README.
- Server + client with lobby-lite (name, join, admin start), protocol v1, prediction/reconciliation/interpolation.
- Map generator for `T=2, N=0` (generator structured for all combos), terrain, roads, props, zones A/B with flags, rings, spawn points.
- First-person controller: walk, sprint, crouch, jump, mouse look, collisions.
- One class (**Assault**): AR-1 with recoil and spread, reload, health, death, respawn at an owned zone, spawn protection.
- Zone capture per section 4.3, scoring per 4.4 (score limit + time limit), results screen back to lobby.
- HUD: crosshair, health, ammo, zone strip, capture bar, kill feed, scoreboard (Tab), F3 stats.
- Low-poly character models for remote players, simple viewmodel, basic synthesized SFX.
- i18n scaffolding (uz/en), graphics presets Low/Medium/High.

Acceptance:
- [ ] `npm run check` and `npm run e2e` pass; screenshots reviewed.
- [ ] Two browser tabs can play a full match on one machine; LAN join works via printed URL.
- [ ] Movement feels responsive with no visible rubber-banding on LAN (reconciliation errors invisible).
- [ ] Capturing, losing and re-capturing zones works; scoring and win/lose screens correct.
- [ ] Map validator passes for 50 seeds; same seed gives the same map.
- [ ] Low preset stays within draw-call/triangle budgets (`F3` numbers recorded in `PLAYTEST.md`).
- [ ] No per-frame allocation hot spots in the render loop (checked by profiling note or code review).

### M2 — Match setup and classes
Full lobby settings (teams 2-4, allowed `N` combos, Auto zones, seed, limits), team picker with layout preview, all 4 classes with gadgets (med pack, ammo box, grenades, repair torch placeholder, rocket launcher without vehicles yet), spawn screen with minimap and class cards, zone resupply, announcements, per-team scoreboard, elimination and total-control win conditions, symmetric terrain/props for all combos, synthesized SFX pass. Tests for all rules.

### M3 — Vehicles
Jeep and tank on pads, seats, enter/exit, driver prediction, damage model, rockets vs vehicles, repair, destruction/respawn, passenger shooting, vehicle HUD, vehicle SFX. Tests and E2E for entering, driving, destroying.

### M4 — Bots
Lobby bot options (fill to X, difficulty), server-side bots with strategy, navigation, perception and combat, class composition, late-join/bot replacement rules, bot-only simulation tests, tick-time budget verified with 24 actors.

### M5 — Cameras and polish
`ThirdPersonRig`, `TopDownRig`, settings switch; replace placeholder art with permissive glTF models where it clearly helps (asset manifest + fallbacks); audio pass; settings menu (rebinds), reconnect flow, performance pass on the weakest available hardware, UI polish.

### M6+ (backlog candidates)
Buildings with interiors, more map themes, tank gunner seat, bot drivers, helicopters, weapon variants/unlocks, binary protocol, lag compensation, spectator mode, optional internet hosting.

---

## 17. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Netcode complexity (prediction, vehicles) | Shared deterministic step functions; fixed `MOVE_DT`; build and test on players first (M1), vehicles later (M3) |
| Weak PCs | Budgets enforced from M1, presets, render scale, instancing, `F3` stats, test with Low preset |
| Bots look dumb or get stuck | Nav grid + stuck recovery + difficulty tuning; bots arrive in M4 after core feel is proven |
| Art quality with primitives | Strong lighting/fog/palette first; asset manifest for CC0 swaps in M5 |
| Scope creep | Milestones, `BACKLOG.md`, acceptance checklists |
| Cross-browser float drift | Server generates the map and sends it; shared sim uses only deterministic arithmetic |
| Sandbox cannot download assets | Procedural fallback for everything; user can drop packs into `assets-src/` |

---

## 18. Glossary

**Zone** — capturable area (A, B, C...). **Home zone** — a team's starting zone. **Neutral zone** — unowned at start. **Control** — a team's capture percentage in a zone. **Contested** — two or more teams present. **Actor** — human or bot. **Pad** — vehicle spawn spot. **Blob** — the map data sent from server to clients. **Rig** — camera mode implementation.
