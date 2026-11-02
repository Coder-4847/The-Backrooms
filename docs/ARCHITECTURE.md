# ARCHITECTURE (keep short)

## Module map
- `src/core`    loop (fixed 60 Hz step), events, settings (schema-driven), difficulty table, storage (IndexedDB/localStorage/memory) + save,
                input/ (actions, pure logic, keyboard+mouse+gamepad manager, touch), collision (spatial hash), player, game (orchestrator),
                debug + debugCommands, perf (in-browser flythrough), services (interface handed to scenes)
- `src/gen`     seeded RNG, `types.ts` (LevelPlan/LevelDef/LevelLook), `graph.ts` (BSP rooms -> graph -> critical path -> locks/keys -> waypoints
                -> nav), `validate.ts`, `waypoints.ts`, `mesher.ts` (pure chunk geometry+colliders+lights), `chunks.ts` (streaming),
                `pool.ts` + `gen.worker.ts` + `handlers.ts` (workers with inline fallback), `textures.ts` (procedural PBR: wallpaper, carpet, concrete, tile, metal, acoustic ceiling, decals, diffuser, macro variation)
- `src/levels`  `registry.ts` (the single `LEVELS` table) + `campaign.ts` (the 25-entry table the hub shows), `level0.ts`, `hub.ts` (procedural tunnel + wings),
                `sim.ts` (headless gameplay core: player, items, stats, light, noise, director, entities, hiding), `bot.ts` (autopilot),
                `scene.ts` (THREE wrapper) + `fx.ts` (events -> audio/hallucinations) + `entityVisuals.ts` + `hubObjects.ts`, `props.ts` (test room)
- `src/render`  `quality.ts` (tiers, Auto pick, adaptive resolution - pure), `gfx.ts` (renderer + post chain), `vhs.ts` (VHS/grade pass),
                `materials.ts` (per-tier materials, 512 first then 1K/2K streamed on a background worker), `lights.ts` (fixed-size light pool),
                `bake.ts` (static light bake: every lamp + first bounce + room-box geometry, pure), `surface.ts` (shader patch: baked
                irradiance, analytic corner AO, world-scale macro grime/stains/wet gloss), `exposure.ts` (GPU eye adaptation),
                `viewmodel.ts` (first-person hand + flashlight), `atmosphere.ts` (dust), `benchmark.ts`
- `src/audio`   `engine.ts` (buses, HRTF panner, occlusion LP, reverb send, limiter), `reverb.ts` (pure IR synthesis), `sounds.ts` (recipes)
- `src/ui`      `ui.ts` (screens, HUD, debug console), `settingsUi.ts`, `dom.ts`, `styles.css`
- `src/systems` items (data table), inventory (grid + hotbar + stash + death penalty), stats (health/sanity/hunger/thirst/fear + hallucinations), light (flashlight, camcorder), noise (room-graph propagation), director (build/peak/release/quiet)
- `src/entities` defs, `nav.ts` (A*), `ai.ts` (perception, states, stick + hound behaviors, tell-before-attack), `sculpt.ts` (sculpting + skinning toolkit: variable-radius sweeps, sculpted blobs, one SkinnedMesh per body, detail normals, tiered skin/cloth materials), `body.ts` (rigs + procedural animation for every entity), `lab.ts` (Entity Lab harness)
- `src/story`   `endings.ts` (resolver skeleton; Phase 5), `notes.ts`, `npcs.ts` (dialogue graphs)
- `tools/`      validate-levels, bot, smoke, shots, perf, icons (Playwright-based ones share `browser.ts`)

## Data flow
`main.ts` -> `Game.create` (storage, profile, settings, Gfx, workers, input, UI) -> `Game.start` (content warning, Auto benchmark, menu). `core/flow.ts` owns the campaign loop: New Game -> Hub -> door -> Level -> (checkpoint autosaves, death/rewind/respawn, level-complete autosave) -> Hub.
`LevelDef.generate(seed, params)` -> `LevelPlan` (pure, deterministic; layout never depends on difficulty).
`LevelScene.load`: plan -> `LevelSim` (colliders, doors, items, waypoints) + workers mesh chunks (`ChunkStreamer`) -> THREE meshes;
materials synthesized in workers per tier. Fixed-step `update` drives `LevelSim`; `render` interpolates and draws through `Gfx`.
Post chain (tier dependent): scene -> GTAO -> eye adaptation -> bloom -> AgX tone map (OutputPass) -> SMAA (when no MSAA) -> VHS pass.
Potato renders direct (AgX, fixed exposure) + DOM grain.
Lighting: the light bake gives every room light from all of its lamps plus bounce (all tiers, a few ms at load); the real-time
pool (nearest N lamps, shadows on High+) covers the area around the player and the bake fades in beyond it. A per-level
reflection probe (cube capture at the spawn -> PMREM) feeds specular on Medium+.

## Conventions
- Everything procedural takes `(seed, quality, params)`; chunk randomness is hash-based so streaming order never matters.
- Data tables over special cases (difficulty, tiers, settings schema, levels). Modules < ~400 lines with a header comment.
- No per-frame allocations in hot paths. Pure logic (rng, plans, validators, save, input logic, quality, reverb) has no DOM/THREE dependency.
- Debug console/cheats: dev builds, or any build opened with `?debug=1` (exposes `window.__game` for the Playwright tools).
