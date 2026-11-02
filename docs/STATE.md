# STATE (living). Spec: `docs/MASTER.md`. Layout/data flow: `docs/ARCHITECTURE.md`.

## Where we are
**Phase 2 (Act 1: Levels 1-5 + Schoolhouse): complete locally.** Phases 0-1 are in git history. Next: wait for "Begin Phase 3" (Act 2: Levels 6, 7, 8, Garage, 37, Sewers, Hospital, Server Farm).

## Commands
| Command | Purpose |
|---|---|
| `npm run dev` | dev server (add `?debug=1` to any build to enable the backtick debug console + `window.__game`) |
| `npm test` | Vitest (163 tests, incl. Phase 2: Act 1 levels, puzzles, new entities, crafting, tools, companion, rules): rng, difficulty, saves, settings/input, quality, endings skeleton, generation + validators, mesher/streamer, textures, reverb, collision, bot, sim, **inventory, stats/sanity/hallucinations, lights, noise, Director, Entity Lab AI scenarios, Level 0 in the real sim, hub** |
| `npm run validate:levels [-- --seeds=200 --level=id]` | all validators over N seeds + the autopilot bot on 40 seeds; pass/fail table |
| `npm run bot -- --level=placeholder --seed=123 [--waypoints --difficulty=hard]` | headless autopilot run |
| `npm run smoke` | Playwright e2e of the real flow: settings persistence, New Game -> hub, dialogue gives an item, inventory panel, door panel -> Level 0, hiding, hound tell-before-bite, death -> rewind -> respawn, note reader, level completion -> hub with next door unlocked |
| `npm run shots [-- --levels=testroom --tiers=ultra,potato]` | screenshots to `./shots` |
| `npm run perf [-- --levels=placeholder --tiers=... --seconds=8 --throttle=4]` | flythrough per tier; table + budget check; writes `reports/perf.json` |
| `npm run verify` | typecheck + lint + tests + level validators (what CI runs, plus build) |

## Built in Phase 2
- **Level factory** (`levels/factory.ts`): a level is a data spec (size, look, lock styles, props, ecology, notes, guaranteed items, extras) on top of the graph generator. Props are placed along walls and kept clear of doors, nav nodes/edges, items, waypoints and valves (validated); lockers/desks; notes; entity slots.
- **Six levels** (`levels/act1.ts`), all validated on 200 seeds and bot-completable (40/40):
  1. **Habitable Zone** (uneasy): concrete warehouse, racks/crates, survivors' camp with radio + can opener + **Pim** (recruitable companion), crowbar-pried door, hound packs.
  2. **Pipe Dreams** (tense): pipe tunnels, steam fog, **valve puzzle** (3 valves, tag note gives the settings), loud acoustics (less wall damping), **Howler** + hound cameo, lots of throwables.
  3. **Electrical Station** (chill, entity-free): **3 fuses** as staged gates, transformer props, stockroom with 12 extra loot behind the last gate.
  4. **Abandoned Offices** (tense): desk/cubicle props, 2 real coworkers + 1 **Skin-stealer**; badge-number verification (corkboard note vs answer), flashlight reveals it, its shadow lags.
  5. **Terror Hotel** (tense): halls, 4 posted rules (2 enforced), guest-register scraps let you deduce which; breaking a real rule summons the **Concierge** (bell tell, slower than a sprint, despawns).
  6. **Schoolhouse** (uneasy): **Hall Monitors** (whistle tell if no pass; real pass = inspection only; forged pass fails ~35%), a real pass in a dead end, paper + marker to forge.
- **Puzzle framework:** `PuzzleDef` on the plan; the solver/validator treats a puzzle as solvable when all parts + hint note are reachable before its lock; locks are themed (key / fuse / pry / valves) with per-style door look and hint text.
- **New entities** (`entities/behaviors.ts`): Howler (blind, sound-hunter, scream alerts others), Coworker, Skin-stealer, Concierge, Hall Monitor, Companion; procedural bodies (humanoid builder, Howler) and an eye-blink / shadow-lag tell; synthesized scream, bell, whistle, clatter, radio static.
- **Crafting** (`systems/crafting.ts`): 8 recipes, discovered when you first hold the ingredients, kitchen recipes at the hub kitchen, workbench in the hub, "Craft" button in the backpack. Atomic (rolls back if the pack is full).
- **Tools/items:** crowbar, fuses, rag/bottle/can/rope, paper/marker, purifying tablets, canned food + opener, radio (20 s lure, 60 s cooldown), tripline alarm (placeable), throwable distractions (T), hall passes.
- **Companions v1:** Pim follows, panics (noisy) near hunters, can be hurt and lost; state saved in the slot (`npcs.companion`) and persists across levels; camp copy is removed once recruited or lost.
- **Ecology v1:** each level's signature + secondary entity assigned to nests by distance; Concierge is rule-summoned; coworkers/companion as ambush slots.
- **Perf fix:** noise propagation is computed once per noise event (was per entity per tick): bot runs ~20x faster and the real game benefits.
- **Input fix:** rapid double taps are no longer merged into one press (found by the smoke test at low frame rates).
- Notes: 24 new Act 1 notes (static) + per-run generated ones (valve tags, badge number, posted rules, register clues; kept out of the journal because they are only valid for that run).

## Built in Phase 1 (summary)
- **Systems (headless, tested):** item table (flashlight, camcorder, battery, almond water, crackers, bandage, glowstick, flare, keys), grid backpack + 4-slot hotbar + weight + hub stash + death penalties, stats (health/sanity/hunger/thirst/fear scaled by the difficulty table), hallucination events, flashlight (battery, flicker, shake-to-recharge) + camcorder night vision with own battery, noise propagation along the room graph with wall damping, Director v1 (build/peak/release/quiet, guaranteed breathers, ambient events, intensity x Scare Intensity).
- **Entity framework:** perception (sight cone limited by light/crouch/cover/hiding, hearing via noise field), A* on the nav graph (doorway "mouth" nodes make paths cross doors perpendicular), states (lurk/patrol/investigate/hunt/tell/chase/search/flee), every attack preceded by a `tell` whose length comes from the difficulty table, observe-only mode for bots, Entity Lab harness.
- **Entities:** Stick (frozen while watched, advances unseen, backs off from bright light, touch after a tell), Hound pack (investigates noise, growl tell, flanking chase, loses interest if you hide/quiet, scatters from flares). Procedural bodies from lofted tubes + ellipsoids with procedural gait/twitch, detail by tier. FM/formant synthesized growl, ticking tell, whispers, thud.
- **Level 0:** 120x100 m, ~64 rooms (varied sizes/halls/dead ends/supply room/nests), 4 wallpaper/concrete variants, damp carpet, lockers and desks to hide in, 6 notes, 1 key + door, 2-3 waypoints, stick + hound-pack ecology, validated on 300 seeds + bot 40/40.
- **Central Hub:** procedural tunnel that extends with the frontier, 25 doors (alcoves both sides; sealed / continue / replay / not-built states, nameplates with best time + difficulty), Almond Outpost wing (outpost hall, stash/crafting room, notice-board/bestiary/gallery room), 3 survivors with dialogue (Marlow, Ines, Tobias; gifts once), stash lockers, wing gates sealed until their act.
- **Flow:** New Game -> Hub; door panel (Continue Campaign / Replay with difficulty + seed); checkpoint autosave (snapshot of pickups/doors/keys + inventory + stats); death -> tape rewind -> reload from checkpoint with the difficulty penalty (Hardcore permadeath deletes the slot, keeps the profile); replays cap loot carry-back (6) and never permadeath; level completion saves best times/frontier and returns to the hub at that door; manual save at waypoints per difficulty rule (API only, no button yet).
- **UI:** hotbar, vitals (fade when healthy), flashlight/camcorder battery, noise meter, prompt glyphs, inventory screen (drag and drop, hotbar assign, use/drop), journal (grouped by level, searchable), note reader, dialogue with voice blips, stash, door panel, tape-rewind death overlay, hiding overlay.
- **Player:** lean (Q/R), hold breath (B), weight-scaled stamina regen, hotbar keys 1-4 + wheel; **input fix:** key taps shorter than one frame are latched (found by the smoke test at low fps).
- Debug: `give`, `spawn`, `kill`, `sanity`, `hunger`, `intensity`, `die`, `win`, `hub`, `unlock`, `director` now work.

## Perf (this environment has NO GPU: Chromium uses SwiftShader software rendering)
Frame-time numbers are **not representative** and are not judged. Draw calls / triangles / generation times are real. Level 0 flythrough, 1280x720, entities active:
| tier | draws avg/max | tris (max) | load (gen + textures) | scale |
|---|---|---|---|---|
| potato | 40/42 | ~2k | 0.14 s | 0.50 |
| low | 65/70 | ~3k | 0.30 s | 0.70 |
| medium | 120/135 | ~4k | 0.45 s | 0.85 |
| high | 215/264 | ~7k | 1.6 s | 1.00 |
| ultra | 297/356 | ~12k | 1.4 s | 1.00 |
All far below the budgets (Ultra < 1500 draws; Potato < 150 draws and < 150k tris). Run `npm run perf` on real hardware for frame times, 1% lows and heap.

## Known gaps / honest notes
- **Deploy:** the `github-pages` environment only deploys from `main`; every phase is pushed to the assigned branch and then to `main`.
- Level-specific hooks not built yet: Level 2 steam hazard (it is fog + sound only), Level 3 arc-flash scare (it reuses the Director flicker burst), Level 4 "elevators that lie", Level 5 room-number plates and a "knock" rule that does anything (it is a deliberately false rule), Level 1 forklifts. These are dressing/polish for the Phase 5 pass.
- Rules (Level 5) check flashlight/run/noise inside halls only; "after midnight" is not time-gated.
- Companion v1: follows, panics, can be lost; it does not carry items, give light, or talk yet. Only Pim exists. Faceling mimics of companions are Phase 3.
- Hub kitchen/crafting are real now; camcorder customization, bestiary detail beyond a seen-count + one line per entity, and the ending gallery are placeholders. Hub wings 2 and 3 are sealed gates.
- Level 0 sublevels and the vault move are still not built (no low obstacles). Props are solid boxes with colours: no per-prop LOD or textures yet.
- Level `targetSeconds` windows are wide ([90, 2200]); real 20-25 min pacing needs human playtesting. The bot clears a level in 2-6 min of simulated time.
- scene.ts is ~420 lines (slightly over the 400-line guideline); split when Phase 3 adds water.
- Entities use sight/hearing only (no smell/vibration yet). Inventory screen has no gamepad cursor mode. Manual save has no button (flow API exists).
- Remaining graphics-list items from Phase 0 are unchanged (SSR, TAA, DoF, motion blur, volumetrics, auto-exposure, lens effects, GI probes).
- Frame times are software-rendered here (no GPU), so only draw calls / triangles / generation times are meaningful.

## Key decisions
- Walls are 0.2 m thick, rooms are BSP tiles (no gaps/overlaps by construction), doors are real openings with reveals; colliders for the whole level are built up front (cheap), only visuals stream.
- One `LEVELS` table; generators are pure and deterministic; layouts never change with difficulty (tested).
- Debug tools are off in production builds unless `?debug=1`.
