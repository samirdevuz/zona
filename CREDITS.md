# Credits

## 3D models (all CC0 / public domain)

Downloaded from OpenGameArt by `npm run assets:fetch` (sources and checksums in `scripts/assets/sources.json`)
and converted by `npm run assets:build` (recolouring, simplification, fitting: `scripts/assets/recipes.mjs`).
No credit is required by CC0; we list the authors anyway, with thanks.

| Used for | Asset | Author | License | Page |
|---|---|---|---|---|
| Jeep | Lowpoly soviet jeep (GAZ-67) | artie31 | CC0 | https://opengameart.org/content/lowpoly-soviet-jeep |
| Tank | T-12 soviet light tank lowpoly | artie31 | CC0 | https://opengameart.org/content/t-12-soviet-light-tank-lowpoly |
| Trees, pines, rocks, boulders | Ultimate Nature Pack | Quaternius | CC0 | https://opengameart.org/content/low-poly-nature-pack-1 |
| AR-1, SMG-1, LMG-1, BOLT-1, pistol | Ultimate Gun Pack | Quaternius | CC0 | https://opengameart.org/content/low-poly-guns-pack |
| Soldiers (rig + animations) | Animated Human Low Poly | Quaternius | CC0 | https://opengameart.org/content/animated-human-low-poly |

| Barrier, concrete wall | Concrete barriers | Yughues (Nobiax) | CC0 | https://opengameart.org/content/concrete-barriers |
| Sandbag walls, bunker roof | Simple Sandbags | JamesWhite | CC0 | https://opengameart.org/content/simple-sandbags |
| Containers | 3D House Construction Site (LowPoly) | Majadroid | CC0 | https://opengameart.org/content/3d-house-construction-site-lowpoly-cc0 |
| Watchtower parts | Survival Kit | Kenney | CC0 | https://opengameart.org/content/survival-kit |

## Sounds (all CC0)

Built by `npm run assets:audio` (needs ffmpeg): first shot of each take cut, faded, mono, peak-normalised
(`scripts/assets/audio.mjs`). Settings → Audio → "Recorded sounds" switches back to the synthesized ones.

| Used for | Asset | Author | Page |
|---|---|---|---|
| AR-1 (AR-15), SMG-1 (Carl Gustav M45), LMG-1 and tank MG (AK-47), BOLT-1 (Mosin Nagant), pistol (1911); near and ~50 m takes | The Free Firearm Sound Library | bart | https://opengameart.org/content/the-free-firearm-sound-library |
| Explosions | Chunky Explosion | Joth | https://opengameart.org/content/chunky-explosion |
| Distant explosions | Muffled Distant Explosion | NenadSimic | https://opengameart.org/content/muffled-distant-explosion |
| Tank cannon | Explosions | EZduzziteh | https://opengameart.org/content/explosions-4 |
| Reloads | Gun Reload Sounds | SpringySpringo | https://opengameart.org/content/gun-reload-sounds |
| Menu clicks | Interface Sounds | Kenney | https://opengameart.org/content/interface-sounds |

Everything else (terrain, gadgets, rocket launcher, effects, sky; footsteps, engines, rockets, hit markers and
other small sounds) is generated procedurally at runtime.

Libraries: three.js (MIT), ws (MIT), qrcode-terminal (Apache-2.0), Vite (MIT); build tools meshoptimizer (MIT) and
fflate (MIT).
