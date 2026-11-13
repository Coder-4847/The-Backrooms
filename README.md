# NOCLIP

A single-player, procedurally generated, found-footage Backrooms survival horror game that runs in the browser
(TypeScript + Three.js, WebGL2). Everything (levels, textures, audio, entities) is generated in code from a seed.

**Status: complete (Phases 0-5).** 25 levels, six endings, New Game+, speedrun mode, ending gallery, bestiary and achievements. See `docs/CHECKLIST.md` for what is verified and what still needs real-device testing. Engine, tooling, saves, input, audio and render pipeline (Phase 0); core survival systems, Level 0 and the
a campaign that runs straight from New Game through every level, with any level you have reached replayable from the menu (Phase 1); Levels 1-5 and the Schoolhouse with new entities, puzzles, crafting and a companion (Phase 2); eight Act 2 levels with water and breath, darkness, light sections and eight more entities (Phase 3); ten Act 3 levels with the chase and the finale (Phase 4).
Later phases are in `docs/MASTER.md`.

## Play
The game is deployed to GitHub Pages from `main` by `.github/workflows/deploy.yml`:
`https://coder-4847.github.io/The-Backrooms/`

In the repo, set **Settings > Pages > Source = GitHub Actions** once.

## Run locally
```bash
npm ci
npm run dev          # http://localhost:5173  (add ?debug=1 to any build to enable the debug console)
npm run build && npm run preview
```

## Controls
| | Keyboard + mouse | Gamepad | Touch |
|---|---|---|---|
| Move / look | WASD / mouse | Left / right stick | Left half joystick / drag right half |
| Sprint / crouch | Shift / Ctrl or C | L3 / R3 | » / ▽ buttons |
| Interact | E | A (✕ on PlayStation) | E button (appears when relevant) |
| Flashlight / camcorder night vision | G / V | Y / D-pad up | ☼ |
| Throw (distraction) | T | RB | ↗ |
| Hotbar / next item | 1-4, [ ] or Z X / wheel | LT / RT | tap the slot |
| Use held item (drink, eat, recharge; toggles the flashlight or night vision when held) | F or left click | X (□) | tap the selected slot again, or USE |
| Lean / hold breath | Q R / B | D-pad / LB | |
| Dive (in deep water) | Crouch | R3 | ▽ |
| Backpack / journal | I or Tab / J | View / D-pad left | ▤ |
| Pause | Esc | Menu | ❙❙ |
| Debug console | ` (backtick) | | |

Everything is rebindable under Settings > Controls. The item you have selected is the one in your hand. Settings > Gameplay > Objective guidance sets the on-screen arrow (Arrow + hints, Hints only, Off). On older hardware set Settings > Graphics > Quality tier to Low or Potato. The active device is detected automatically and prompts update instantly.

## Seeds
A run seed (shown in New Game, copyable) derives every level seed, layout, loot and entity ecology. Enter the same seed to replay
the same world. Difficulty never changes layouts, only pressure.

## Tools (no real-time playtesting needed)
| Command | What it does |
|---|---|
| `npm test` | Vitest unit/state-machine tests |
| `npm run validate:levels` | Generates many seeds per level, runs all validators and the autopilot bot, prints a pass/fail table |
| `npm run bot -- --level=placeholder --seed=123 --waypoints` | Autopilot bot through the real simulation, headless |
| `npm run smoke` | Playwright end-to-end check (menus, settings persistence, new game, movement, debug console) |
| `npm run shots` | Fixed-seed screenshots per level per tier into `./shots` |
| `npm run perf` | Scripted flythrough per tier: frame time, draw calls, triangles, memory, chunk generation |
| `npm run mobile` | Emulated phone check (touch controls, layout) |
| `npm run balance` | Balance report across levels and difficulties |
| `npm run verify` | typecheck + lint + tests + level validators |

Debug console commands: type `help`. Includes `level`, `tier`, `noclip`, `god`, `timescale`, `overlay nav|rooms|path|chunks`,
`tp`, `tpw`, `tpexit`, `stats`, `bot`. Commands that need later-phase systems say so.

## Assets
Procedural by default. Optional CC0 PBR sets can be listed in `public/assets/cc0/manifest.json`; if absent the game uses its
procedural textures.

## Secrets and spoilers
Not hinted in menus: there is a way to make the hum forget you in Level 0, and five small objects (Anchors) hide in off-path rooms across the acts. Both pay off at the Finale.
