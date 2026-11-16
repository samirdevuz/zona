# Decisions

Short records of choices made where GAME.md was ambiguous or silent (working agreement rule 4).
Format: decision — alternatives — why.

## D1. Toolchain versions (2026-11-16)
TypeScript 5.9, Vite 7, Vitest 4, ESLint 9 + typescript-eslint 8, three 0.187, ws 8.
Alternatives: TypeScript 7 (native) and Vite 8 are newer. typescript-eslint does not support TS >= 6.1 yet,
and npm's peer resolver crashed with Vitest 4 + Vite 8 optional peers, so `overrides.vite` pins Vite 7.

## D2. Zone ownership semantics (GAME.md 4.3)
A team **gains** ownership when its control reaches 100 and **keeps** it until its control is drained to 0
("Orange lost A" fires then). The owner's partially drained control does not regenerate on its own; the owner
must stand in the zone to refill it. Non-owner partial control decays 2 %/s when nobody is present.
Alternative: ownership lost as soon as control < 100. Rejected: a single enemy touching the zone for one tick would
block all spawns there, and in a 2-zone duel that is a near-instant soft-lock.

## D3. Up to 8 zones
GAME.md says "max 7" zones but also allows T=4, N=4 (= 8 zones). The allowed-combination table wins:
`ZONES.maxZones = 8`, letters A–H. R for Z=8 is 400 m.

## D4. Deterministic trigonometry in `shared`
`Math.sin/cos/atan2` are not guaranteed bit-identical across JS engines (V8 vs SpiderMonkey). The shared movement
step uses polynomial `dsin/dcos/datan2` built only from + - * /, so client prediction replays exactly what the
server computed in every browser. `Math.sqrt` is IEEE correctly rounded and is allowed; `Math.hypot`/`Math.pow`
are avoided in the deterministic step.

## D5. Colliders are derived from props, not sent
The map blob carries props (type, position, quarter-turn rotation, scale). Both server and client build colliders
with the same `buildColliders()` (pure arithmetic on numbers rounded to millimetres), which keeps the blob small.
The heightfield is sent as Int16 centimetres (base64), as GAME.md 3.2 requires.

## D6. Symmetry details
- Prop collision shapes are symmetric under local x → -x so mirrored copies are exact (mirror rotation = 2 - rot).
- For T=3 a 120° rotation is not a quarter turn: box props snap to the nearest quarter turn (positions exact,
  orientation approximate). Only relevant from M2.
- Zone interiors (cover, pads) use rotation symmetry only; open-field props use rotation + mirror.
- The centre zone gets ceil(k/T) cover props per sector so its total cover stays in the 6–10 range.

## D7. Elimination and total control are active in M1
GAME.md schedules them for M2, but without elimination a 2-zone duel soft-locks (a team that lost its only zone
while dead can never respawn and must wait for the score/time limit). Both are pure rule functions with tests;
no extra UI beyond the results screen.

## D8. No player-player collision
Actors do not collide with each other in M1. It keeps prediction exact (no dependence on other actors' positions)
and avoids spawn blocking. Revisit with vehicles (M3).

## D9. M1 weapon set
Only the AR-1 is implemented; the pistol arrives with the other classes in M2 (GAME.md M1 scope lists AR-1 only).

## D10. Lobby-lite settings
M1 admins can set map seed, score limit and time limit (teams fixed at 2, neutrals 0). Needed to play and test a
full match in reasonable time; the full settings UI is M2.

## D11. Test-only debug commands
`debug/teleport` and `debug/damage` messages are accepted only when the server runs with `ZONA_DEBUG=1`
(used by the E2E harness to set up kills and captures quickly). They are ignored otherwise.

## D12. Firing cancels sprint
GAME.md says sprinting cannot fire. Holding fire while sprinting drops out of sprint on the next step, so the
shot comes ~1 step later instead of never — feels responsive and keeps the rule.
