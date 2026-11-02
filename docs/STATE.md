# STATE (living). Spec: `docs/MASTER.md`. Layout/data flow: `docs/ARCHITECTURE.md`.

## Where we are
**Phase 0 (foundation): complete locally, tagged `phase-0`.** Next: wait for "Begin Phase 1" (core systems + Level 0 vertical slice).

## Commands
| Command | Purpose |
|---|---|
| `npm run dev` | dev server (add `?debug=1` to any build to enable the backtick debug console + `window.__game`) |
| `npm test` | Vitest: rng, difficulty table, save round-trip/backup/migration/export, settings, input logic, quality/adaptive, ending resolver, generation + validators, chunk mesher/streamer, textures, reverb, collision, bot, sim rules (77 tests) |
| `npm run validate:levels [-- --seeds=200 --level=id]` | all validators over N seeds + the autopilot bot on 40 seeds; pass/fail table |
| `npm run bot -- --level=placeholder --seed=123 [--waypoints --difficulty=hard]` | headless autopilot run |
| `npm run smoke` | Playwright e2e: menus, settings persistence across reload, new game, slot saved, keyboard movement, debug console, pause |
| `npm run shots [-- --levels=testroom --tiers=ultra,potato]` | screenshots to `./shots` |
| `npm run perf [-- --levels=placeholder --tiers=... --seconds=8 --throttle=4]` | flythrough per tier; table + budget check; writes `reports/perf.json` |
| `npm run verify` | typecheck + lint + tests + level validators (what CI runs, plus build) |

## Built in Phase 0
- Vite + TS + three.js, ESLint, Vitest, Playwright tooling, PWA (manifest, icons, service worker with versioned cache, update on next load).
- Deploy workflow (`.github/workflows/deploy.yml`): typecheck, lint, tests, validators, build on every push; deploy job only on `main` / manual run. `base` comes from the repo name.
- Core: seeded RNG (sfc32 + order-independent hashes), fixed 60 Hz loop with interpolation, typed events, schema-driven settings (graphics/audio/controls/gameplay/accessibility, persisted in the profile), 5-tier difficulty table + scare intensity, storage (IndexedDB -> localStorage -> memory), saves (3 slots, profile, atomic temp+verify+swap writes, rolling backup, migrations, export/import/wipe, permadeath helper).
- Input: one action map for keyboard+mouse (pointer lock), gamepad (dead zone, curve, glyph families, rumble), touch (dynamic joystick, look zone, contextual buttons, handedness/size/opacity, gyro option); auto device switching; rebinding UI.
- Generation: graph-first generator (BSP rooms -> adjacency -> spanning tree -> critical path -> lock/key dependency solver -> loops that cannot bypass locks -> waypoint candidates -> nests -> loot -> nav graph -> time estimate), validators, waypoint selection per difficulty, chunk mesher (pure, workers, inline fallback), chunk streamer, worker pool.
- Render: tiers (Ultra..Potato), Auto benchmark (vsync-independent) + hardware caps, dynamic resolution + automatic tier-down/offer-up, procedural PBR materials (wallpaper, carpet, concrete, tile, metal, ceiling, stain), light pool, flicker, GTAO, bloom, VHS pass (grain, scanlines, chromatic aberration, tracking glitch, vignette, grade, colour-blind modes), dust, fog, shadows, flashlight, PMREM environment.
- Audio: buses + limiter, HRTF panner, occlusion low-pass, procedural reverb IR per room size/material, synthesized hum, footsteps per surface, drips, creaks, heartbeat, beacon, warp, UI clicks, captions.
- UI: content warning, live-3D title menu, new game (slot, 5 difficulties with descriptions, seed), continue, manage/import/export saves, full settings with rebinding, HUD (REC/timestamp/stamina/prompt/toasts/captions), pause, loading screen, debug console.
- Dev levels: `testroom` (props gallery, coloured/flickering lights, glowing orb, pedestals per material) and `placeholder` (locks, keys, waypoints, exit), both validated and bot-completable.

## Perf (this environment has NO GPU: Chromium uses SwiftShader software rendering)
Frame-time numbers below are **not representative** and the budgets for them are not judged. Draw calls / triangles are real. `placeholder`, 1280x720 flythrough:
| tier | draws avg/max | tris | load (gen+textures) | scale |
|---|---|---|---|---|
| potato | 16/28 | ~1k | ~0.1 s | 0.50 |
| medium | 67/102 | ~3k | ~0.5 s | 0.85 |
| ultra | 116/166 | ~4k | ~1.3 s | 1.00 |
All far below the spec budgets (Ultra < 1500 draws; Potato < 150 draws, < 150k tris). Real-GPU frame times, JS heap and mobile numbers still need measuring on hardware (run `npm run perf` locally).
Auto picked **potato** here because the GPU string is SwiftShader (by design).

## Known gaps / honest notes
- **Branch/deploy:** this session is restricted to branch `claude/new-session-5lcqg5`; the spec says `main`. Work is pushed to the assigned branch. CI runs there; the deploy job only runs on `main` or manual dispatch (the `github-pages` environment normally only allows the default branch). To go live: merge to `main`, set **Settings > Pages > Source = GitHub Actions**. Live URL then: https://coder-4847.github.io/The-Backrooms/
- Not yet implemented from the graphics list (planned for the Level 0 look pass in Phase 1+): SSR, TAA, depth of field, motion blur, volumetric fog/light shafts, auto-exposure, lens dirt/droplets/frost, parallax/triplanar detail, wall decals (floor stain decals exist), baked-style GI/light probes, LOD for props/entities, texture arrays/atlases. Settings only list effects that exist.
- Ultra procedural textures are 1024 px (spec says 2k): kept for load time; 2k hero materials can be added when worth it.
- VSync cannot be controlled by web pages: only the FPS cap exists. WebGPU path not started (WebGL2 only, stays the default).
- Runtime tier change re-configures post/resolution/shadows immediately; textures/geometry detail/light count apply on the next level load.
- Touch: edit-layout mode not built (handedness, size, opacity, one-handed exist). Gamepad/touch were unit-tested at the logic level and Playwright-tested only for keyboard; real device testing is pending.
- Ending resolver is a tested skeleton (all 6 endings reachable by flags); content and final conditions come in Phase 5.
- Debug commands needing Phase 1+ systems (`give`, `spawn`, `kill`, `sanity`, `hunger`, `intensity`, `ending`) are registered and say which phase they need.
- Perception cones / noise events overlays arrive with the entity and noise systems.
- Continue resumes the placeholder level (no hub yet); the Central Hub is Phase 1.

## Key decisions
- Walls are 0.2 m thick, rooms are BSP tiles (no gaps/overlaps by construction), doors are real openings with reveals; colliders for the whole level are built up front (cheap), only visuals stream.
- One `LEVELS` table; generators are pure and deterministic; layouts never change with difficulty (tested).
- Debug tools are off in production builds unless `?debug=1`.
