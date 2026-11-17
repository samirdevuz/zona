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

## D13. Terrain chunk size 32×32 cells
GAME.md suggests e.g. 16×16. With 3 m cells a 2-zone map has ~174² cells; 16-cell chunks would be ~121 meshes and
eat most of the Low draw-call budget (150). 32-cell chunks (96 m) give ~36 meshes, ~15–20 visible.

## D14. Ctrl+W guard
Ctrl is a crouch key and Ctrl+W closes the tab in browsers (it cannot be intercepted). During a match the page asks
"leave site?" on unload, and README.uz.md recommends C for crouch.

## D15. Respawn zone choice with number keys
The spawn screen with a top-down map is M2. In M1 a dead player sees a panel with the spawnable zones and can switch
with keys 1..N; the server auto-deploys at the chosen (or the first valid) zone when the 5 s timer ends.

## D16. Input flow edges
Clients only send inputs while LIVE and alive. The server acknowledges (drains) queued inputs of dead actors and
outside LIVE. When an alive actor has no queued input in a tick it is not simulated (no "repeat last input"), so
prediction replays stay exact; a (re)connecting client restarts at sequence 0 (`resetInputSeq`).

## D17. Local tracers and spread
The shooter sees an immediate tracer with a locally sampled spread; the server samples its own spread and decides
hits. Impact puffs for the shooter's own shots come from the server result. Recoil is applied to the aim angles
that are sent, so bullets go where the (kicked) crosshair points.

## D18. Results auto-return
RESULTS returns to the lobby after 30 s (`MATCH.resultsS`) if the admin does not press "Back to lobby", so an AFK
admin cannot strand everyone.

## D19. Lobby layout preview in M1
The lobby draws the zone layout from `layoutZones(T, N)` (an SVG of a few circles). It is cheap and makes the
seed/limits panel easier to read; the full settings UI remains M2.

## D20. Rocket damage (M2)
"Vs infantry: 60 direct + splash 4 m (max 100)" is read as: splash falls from 40 at the centre to 0 at 4 m, and a
direct hit deals 60 + the full 40 = 100 (kills a full-health Assault). Splash-only victims take at most 40.

## D21. No self-damage
Friendly fire is always off; explosions also do not hurt the thrower/shooter. Simplest consistent rule.

## D22. Item controls
1–4 (or the wheel) select primary / pistol / gadget A / gadget B; LMB uses the selected item. Q deploys gadget A
(med pack / ammo box) from any slot; G throws a quick grenade (Assault). Switching takes 0.45 s. The rocket launcher
reloads right after each shot (mag 1 + 3 spare = the "4 rockets").

## D23. Deploy flow
Actors deploy when LIVE starts with the class/zone picked during the countdown. After a death the spawn screen asks
for a Deploy press (the click also re-locks the mouse); players who never press are deployed 10 s after the timer
(`MATCH.autoDeployS`) so AFK players do not stall elimination.

## D24. Resupply details
Zone resupply works within 12 m of the zone's resupply station (6 m from the flag) when the zone is owned and not
contested. Rockets count as ammunition; grenades refill in proportion (ammo box: full refill in 4 s).

## D25. LMG bloom cap
"(max 6)" is the cap of the total LMG cone (6°), not the number of shots.

## D26. Projectile rendering
Projectiles are drawn at their latest snapshot position extrapolated up to 100 ms (not 100 ms in the past like
players), so a rocket reaches the wall at the same moment its explosion event arrives.

## D27. Latched quick presses
A key/mouse press that starts and ends between two frames (low FPS, fast taps) is latched and delivered to the next
simulation step, so pistol taps, G and Q are never lost.

## D28. Announcements
"Zone under attack" fires when an owned zone is being drained by enemies alone, throttled to once per 12 s per zone.
The client also announces "1 minute left", total control (countdown to 60 s) and "your team has no zones".

## D29. Team count changes
Raising the team count does not reshuffle players; only players on removed teams move. The admin has a Shuffle
button; every player has "Auto team".

## D30. Sniper sway
Scope sway is applied on the client to the aim angles that are sent (like recoil), so the server shoots exactly
where the scope points. Crouching halves it.

## D31. Repair torch placeholder
Until vehicles exist (M3) the torch shows sparks and a sound but repairs nothing; the HUD says so.

## D32. HUD minimap
GAME.md 10 lists a minimap (zones, teammates, recently spotted enemies). It shares the spawn-screen map renderer;
"spotted" = enemies that fired within the last 3 s.

## D33. Vehicle physics (M3)
Arcade kinematic model shared by server and driver prediction: throttle/brake/drag, speed-dependent jeep
steering (no turning on the spot), tank pivot turns, collision circles along the body against static colliders
(obstacles lower than 0.6 m are driven over), head-on impacts keep 35 % of the speed, four-corner terrain sampling
for height and tilt, a climb limit. Vehicle–vehicle separation and pushing infantry out of vehicles happen on the
server only, so a player walking into a vehicle sees a small correction rather than a hard wall in prediction.

## D34. Pads face away from the flag
Vehicles spawn facing out of the zone so they can drive straight off the pad instead of into the flag pole.

## D35. Vehicle ownership
Empty vehicles are team-neutral (-1): anyone may enter. While occupied a vehicle belongs to its occupants' team
(enemies cannot board it) and its markings show that colour. The 60 s abandon timer only runs while the vehicle is
empty and away from its pad; then it returns to the pad.

## D36. Tank controls and camera
LMB fires the cannon, RMB the coax MG (overheats after 5 s, 3 s lock). The mouse sets the desired aim; the turret
follows at 90°/s. The camera is the gunner sight following the real turret (×1.6 zoom) and a ring shows where the
turret is being steered to. Third-person vehicle cameras are M5.

## D37. Jeep passenger and exposure
The passenger fires their own selected weapon within ±110° of the jeep's heading (no grenades or gadgets from a
seat). Jeep occupants keep a crouched hitbox at their seat and can be shot; tank occupants are protected and only
die with the tank. The view turns with the jeep for the driver and passenger.

## D38. Damage to vehicles
Hitscan: body damage × the weapon's vehicleDamageMult (with range falloff). Explosions: rocket 160, tank shell 150,
grenade 100 × 0.6, all with linear falloff by the distance to the vehicle body (direct hits take the full value).
A destroyed vehicle explodes (6 m, 80) against the attacker's enemies and kills its occupants (credited to the
attacker). Ramming: 9 damage per m/s above 5 m/s, at most every 0.5 s per victim.

## D39. Explosion line of sight
Splash line of sight is checked from 0.3 m in front of the impact point (back along the flight path); checking from
the surface itself let the wall that was hit shield everyone standing next to it.

## D40. Bot aim model (M4)
"reaction / aim error / accuracy scale" per difficulty: a bot waits `reactionS` before the first shot at a newly
seen target; its aim is offset by `aimErrDeg` in a slowly wandering direction, halving every 0.8 s while the target
stays visible down to a floor of `aimErrDeg × (0.3 × (1 − accuracy) + 0.03)` (easy ≈ 0.9°, medium ≈ 0.3°,
hard ≈ 0.06°). Weapon spread applies on top, like for humans. Bots also have a turn-rate limit.

## D41. Bot strategy details
Every 3 s each team assigns its bots to zones by priority (threatened own zone 1.5, neutral 1.3, enemy 1.0, safe
own 0.15) divided by distance, minus a crowding penalty per already-assigned teammate. Snipers hold 25–40 m back on
their side of the objective; Gunners prefer defending threatened zones; Assault/Engineer prefer attacking. Bots
retreat to an owned zone's resupply station below 35 % HP when not fighting. Bots use their primary weapon, Assault
bots drop a med pack when hurt and Gunners drop an ammo box in fights; bots do not throw grenades or drive (M4).

## D42. Bot fill rule
With bots on, every team is filled up to "fill to X" (cap 24 actors). A human joining a running match replaces a bot
of their team; a human leaving (after the 60 s reconnect grace) is replaced by a bot. Auto zones count P = humans +
planned bots. The lobby shows "+N bot" per team; bots appear with a robot icon in the scoreboard and kill feed.

## D43. Lobby start button at the top
The lobby grew with M2–M4 settings; the Start button / waiting text moved into the header so it stays visible at
720p without scrolling.
