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

Everything else (terrain, containers, barriers, sandbags, ruins, towers, bunkers, gadgets, rocket launcher,
effects, sky) is generated procedurally at runtime from primitives. Sounds are synthesized with Web Audio
oscillators and noise; no audio files are used.

Libraries: three.js (MIT), ws (MIT), qrcode-terminal (Apache-2.0), Vite (MIT); build tools meshoptimizer (MIT) and
fflate (MIT).
