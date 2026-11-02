# NOCLIP

A single-player, procedurally generated, found-footage Backrooms survival horror game that runs in the browser
(TypeScript + Three.js, WebGL2). Everything (levels, textures, audio, entities) is generated in code from a seed.

**Status: Phase 0 (foundation).** The engine, tooling, settings, saves, input, audio, render pipeline, debug tools and a
test room exist. Gameplay content arrives in later phases (see `docs/MASTER.md`).

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
| Flashlight | G | Y | ☼ |
| Pause | Esc | Menu | ❙❙ |
| Debug console | ` (backtick) | | |

Everything is rebindable under Settings > Controls. The active device is detected automatically and prompts update instantly.

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
| `npm run verify` | typecheck + lint + tests + level validators |

Debug console commands: type `help`. Includes `level`, `tier`, `noclip`, `god`, `timescale`, `overlay nav|rooms|path|chunks`,
`tp`, `tpw`, `tpexit`, `stats`, `bot`. Commands that need later-phase systems say so.

## Assets
Procedural by default. Optional CC0 PBR sets can be listed in `public/assets/cc0/manifest.json`; if absent the game uses its
procedural textures.
