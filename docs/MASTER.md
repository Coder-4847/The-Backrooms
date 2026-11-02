# MASTER PROMPT: "NOCLIP" (working title)
### A single-player, procedurally generated, Escape-the-Backrooms-style horror game for the browser

You are the lead engineer and technical artist on this project. Read this whole document once, save it as `docs/MASTER.md` in the repo, and then work **one phase at a time**. At the end of each phase, stop, report briefly, and wait for me to say "Begin Phase N".

**Start with Phase 0 only.**

---

## 0. How to work (read this first)

### 0.1 Quality bar
This is my most ambitious project. Target: a game that looks and feels like a polished indie release. Graphics must be genuinely impressive on High/Ultra, smooth everywhere, with good animation, a beautiful restrained UI, and real horror craft (pacing, sound, restraint). Do not trade quality for speed, but also do not waste tokens.

### 0.2 Token efficiency rules
- Keep a living `docs/STATE.md` (what is done, what is next, known issues, key decisions, commands). At the start of every session read **only** `docs/STATE.md` and the files you are about to touch. Do not re-read the repo.
- Keep `docs/ARCHITECTURE.md` short (module map, data flow, conventions). Update it when structure changes.
- Be **data-driven**: levels, entities, items, recipes, notes, NPC dialogue, and endings are defined as typed data tables plus small behavior modules. Adding content must be cheap.
- Build shared systems once, reuse everywhere. Prefer composition over per-level special cases.
- Modules stay under ~400 lines, with a short header comment explaining purpose. Code must be clear and readable (I like simple, understandable code), with comments where logic is non-obvious.
- Batch tool calls and verification commands. Commit at every milestone with a clear message.
- Ask me questions only when truly blocked. Otherwise pick the sensible default and note it in `STATE.md`.

### 0.3 CRITICAL: how to test without "playing 10 hours"
The finished game takes a player 9-10 hours. **You must never test by playing in real time.** Build testing into the game from Phase 0 and use it:

1. **Seeded determinism.** Every generator takes `(seed, quality, params)` and is fully deterministic. A bug is reproducible from a seed.
2. **Debug console and cheats** (dev builds only, toggled with `` ` ``): jump to any level, set seed, give items, god mode, free-fly noclip camera, time scale (0.1x to 20x), force intensity tier, spawn/kill any entity, set sanity/hunger, trigger any ending, show overlays (nav graph, room graph, perception cones, noise events, chunk bounds, perf stats).
3. **Headless validators** (Vitest/Node, no rendering): for every level, generate N seeds (default 100-200) and assert: deterministic, fully connected, critical path exists and is solvable (every key/fuse/tool reachable before its lock, exit reachable), no overlapping geometry or unreachable items, spawn points valid, nav graph valid, **2-3 waypoint checkpoints placed (count per difficulty), reachable, spread along the critical path, and not inside entity nests**, estimated traversal time within the level's target range. Output a pass/fail table.
4. **Autopilot bot.** A simple bot that follows the generator's critical path through the real game simulation at accelerated simulated time, headless where possible. It exists to prove a level is completable and to measure completion time, not to play well. Entities can be set to "observe only" or "active" mode for bot runs.
5. **Entity Lab.** A sandbox scene with a flat room where each entity's AI can be tested against scripted scenarios (player noise, light on/off, hiding, bait items) and asserted via simple pass/fail scripts.
6. **State-machine tests** for saves (round-trip), inventory, crafting, stats, and the ending resolver (every one of the 6 endings must be reachable by a test that sets the flags).
7. **Performance harness.** A scripted camera flythrough per level and per graphics tier that records average and 1%-low frame time, draw calls, triangles, memory, and chunk generation time, and compares to budgets in section 6.
8. **Visual checks.** A Playwright script renders fixed-seed screenshots per level per tier. Look at a small number of them (not all) to judge the look, and fix what is wrong.
9. **Budget:** each phase's full verification should finish in roughly 10 minutes of wall-clock time or less. If a check is slow, make it faster or sample fewer seeds.

Document the commands in `STATE.md` (`npm run test`, `npm run validate:levels`, `npm run bot -- --level=4 --seed=123`, `npm run perf`, `npm run shots`).

### 0.4 Honesty
If something cannot be done to spec (for example a feature unsupported on some browsers), say so in `STATE.md`, implement the best fallback, and move on. Never fake results.

---

### 0.5 Git, push, and deploy (mandatory after every phase)
The repository already exists on GitHub and is configured for GitHub Actions. Use the existing `origin` remote (check with `git remote -v`; only if none is set, ask me once for the repo URL). Work on `main`.

**Phase 0 sets up deployment; every phase then ends with a live deploy:**
1. Create `.github/workflows/deploy.yml` (Node LTS, `npm ci`, run tests and level validators, `npm run build`, upload the `dist` artifact with `actions/upload-pages-artifact`, deploy with `actions/deploy-pages`, with the required `pages: write` and `id-token: write` permissions). Trigger on pushes to `main` and on manual dispatch. The Vite `base` must match the repo name (e.g. `/<repo-name>/`) so assets load on `https://<user>.github.io/<repo-name>/`; read the repo name from the remote rather than guessing.
2. Tell me clearly if GitHub Pages must be switched on: in the repo go to Settings, then Pages, and set **Source** to **GitHub Actions**. I will do that if needed.
3. At the end of every phase: run all tests and validators locally, commit, tag `phase-N`, `git push origin main --tags`, then **verify the deployment** (use `gh run watch` / `gh run list` if the GitHub CLI is available; otherwise ask me to confirm the Actions run is green). If the run fails, fix it and push again until it is live. Do not report a phase as complete until the deployed site works.
4. Include the **live URL** in the phase report. Never commit secrets, `node_modules`, or large generated files. Keep the build size reasonable (code-split levels so only the active level's code loads) and keep `/public/assets/cc0` optional.

---

## 1. Vision

**Premise (minimal found-footage lore).** You are an unnamed person who noclipped out of reality while filming with a camcorder. Everything you see through it carries VHS texture. Across the levels you find tapes, notes, and recordings left by earlier wanderers (a group called "Group 7"). Piece them together to learn how the Backrooms work, who built the exit, and what the "Architect" wants. No long cutscenes. Story comes from the environment, documents, NPCs, and choices.

**Pillars**
1. **Atmosphere first.** Mundane spaces made wrong. Dread from light, sound, and emptiness.
2. **Survival in the Escape the Backrooms mold.** Inventory, flashlight and batteries, almond water, food, sanity, stealth, noise, hiding, found keys and tools, safe rooms.
3. **Every run is different.** Fully procedural levels, seeded entity ecology, shareable seeds.
4. **Graphics that scale from a potato to a supercomputer.** One asset pipeline, quality tiers.
5. **Three first-class control schemes.** Keyboard and mouse, gamepad, touch.
6. **Paced like a real game.** Calm, uneasy, tense, and full-horror levels in a deliberate rhythm.

**Length.** 25 levels, about 20-25 minutes each, about 9-10 hours for a first playthrough (less on repeat runs).

**Single-player only.** Companions are AI.

---

## 2. Tech stack and project setup

- **TypeScript + Vite**, **Three.js**. Rendering baseline is **WebGL2**. Add an **optional, experimental WebGPU path** only if it does not compromise stability (feature-detected; WebGL2 must always work and be the default).
- UI is **DOM/CSS overlay** (clean, fast, accessible, touch friendly). No UI framework required; small helper modules are fine.
- Audio is **Web Audio API**, 100% synthesized. No audio files.
- Procedural generation runs in **Web Workers** where it helps (chunk meshing, texture synthesis). Use transferable buffers.
- Collision and movement: custom **capsule-vs-world collision** using spatial hashing and the generated room/wall data. Avoid a heavy physics engine. A tiny rigid-body helper for throwable items is acceptable.
- Tests: **Vitest** (logic and validators), **Playwright** (screenshots, smoke, perf).
- Deploy target: **GitHub Pages** via the existing GitHub repo and GitHub Actions (see 0.5). Static build, correct `base` path. Must work as an installable **PWA** (offline after first load, with a cache-versioning strategy so players get updates).
- Repo layout (adjust sensibly):
```
/src/core        engine loop, renderer, scene mgmt, input, settings, save, events, debug
/src/render      materials, post-processing, lighting, quality tiers, LOD, VHS pipeline
/src/gen         seeded RNG, graph generators, chunk builders, texture synthesis
/src/levels      one data+builder module per level
/src/entities    entity definitions, AI modules, procedural models, animation
/src/systems     inventory, items, crafting, stats, sanity, director, hiding, noise
/src/audio       synth engine, ambience, footsteps, entity voices, mixer
/src/ui          menus, HUD, inventory, settings, notes, map, subtitles
/src/story       notes, tapes, NPCs, dialogue, endings resolver
/tests, /tools (validators, bot, perf, shots), /docs, /public/assets (optional CC0)
```

---

## 3. Asset policy

- **Default:** everything is generated in code: architecture, props, entities, textures, audio.
- **Optional CC0 assets:** the game must also support an optional folder `/public/assets/cc0/` for free CC0 PBR texture sets (ambientCG, Poly Haven) and NPC bodies. A manifest file lists what is present. **If the files are missing, the game falls back to procedural versions automatically and still looks good.** Never require downloads to run.
- Do not copy copyrighted text, art, or audio. Backrooms concepts and entity ideas come from community lore; all designs, names of items, and text here are original implementations.

---

## 4. Core architecture requirements

### 4.1 Seeds
- A **run seed** (shown on screen, copyable, enterable on the new-game screen) derives per-level seeds and the **entity ecology** (see 8.3).
- Seeded PRNG (sfc32 or mulberry32). Hash-based per-chunk randomness so chunks can stream deterministically in any order.

- **Everything is procedural.** All 25 levels, the Central Hub (5.11), props, textures, entity bodies, entity ecology, loot, and audio come from seeded generators. No hand-authored maps or asset files are required. Story-critical structure (what must be found, the order of levels, key notes) is fixed by design, while layouts, rooms, routes, placements, and dressing vary by seed.

### 4.2 Level generation framework
Every level implements a common interface:
```
generate(seed, tier, params) -> LevelPlan   // room/zone graph, critical path, locks/keys, spawn points, nav graph, item tables, entity slots, exit
build(plan, quality)       -> chunk meshes + colliders + lights + props
```
- A **graph-first** approach (rooms/zones/connections with rules per level), not just mazes.
- A **solvability guarantee**: the critical path is generated first; keys and locks are placed along it by a dependency solver; then loops, side areas, and decoration are added.
- A **validator** (section 0.3) must pass for every level.
- **Chunk streaming:** only nearby chunks are built and drawn; far chunks are unloaded. Room-graph or portal culling plus frustum culling. Instancing for repeated props (ceiling tiles, lights, pillars, pipes).
- Generation must not hitch gameplay: spread work across frames or workers; show a tasteful loading screen between levels only.

### 4.3 Quality-scaled generation
Builders take a `quality` parameter that controls polygon density, texture resolution, prop density, and detail passes. This is how "realistic VHS" gracefully becomes "low-poly" on weak hardware: the same level, lower detail.

### 4.4 Game loop
Fixed-timestep simulation (for deterministic AI and bots) with interpolated rendering. No per-frame allocations in hot paths (reuse vectors, pool objects). Pause-safe, tab-visibility-safe.

### 4.5 Save system
- **Everything is stored locally in the player's browser** (no server, no account). IndexedDB is primary with a localStorage fallback. Request persistent storage (`navigator.storage.persist()`) and warn in the settings screen if the browser may clear data.
- **3 save slots**, each with its own difficulty, seed, and playtime, shown as cards with a thumbnail screenshot, level name, difficulty, and last played time. Versioned schema with migrations so updates never break old saves.
- **Autosave** at every level completion (always), at every waypoint checkpoint reached, and when entering or leaving the Central Hub. Manual save only at waypoints and in the hub (rules vary by difficulty, see 5.7 and 5.8). No saving mid-chase or mid-encounter. Corruption-safe writes (write to a temp key, verify, then swap) and one rolling backup per slot.
- **Slot data:** run seed, campaign frontier (furthest level reached), unlocked hub doors, per-level completion and best times, per-level seeds, last checkpoint snapshot, inventory and stash, stats, NPC and companion states, story flags, notes found, entity encounters, settings link, playtime.
- **Global profile (separate from slots):** settings and keybinds per device type, ending gallery, entity bestiary (discovered entities and what you learned about them), journal unlocks, cosmetics, best times, per-difficulty completion, achievements, New Game+ unlocks. Survives deleting a slot and Hardcore deaths.
- **Export/import** a slot or the whole profile as a file, plus a "delete data" option with confirmation.

---

## 5. Gameplay systems (Escape the Backrooms inspired)

### 5.1 Player stats
Health, stamina, sanity, hunger, thirst. Fear is a short-term modifier (raises heart rate, shakes camera slightly, narrows vision) driven by proximity and events.
- **Stamina:** sprint, vault, hold-breath (reduces noise and helps vs. some entities).
- **Sanity:** drains in darkness, near entities, and with some items; restores with almond water, good food, resting in safe rooms, and certain NPC interactions. Low sanity causes hallucinations (fake entities that vanish when approached or lit), whispers, UI glitches, false footsteps, and warped geometry in the periphery. Never cheap: hallucinations must be readable as such after the fact.
- **Hunger/thirst:** slow, mainly supply pressure. Off in Story difficulty.

### 5.2 Inventory
- 4-slot hotbar plus a grid backpack (items have size and weight; weight slightly affects stamina). One item held in hand at a time; inspect (rotate and zoom), throw, drop.
- Hub lockers provide a persistent stash.
- Smooth, responsive inventory UI for all three input types (drag and drop on mouse/touch, cursor or radial/grid navigation on gamepad).

### 5.3 Light
- **Flashlight:** battery drain, flicker when low, shake-to-recharge (mouse wiggle, gamepad hold, touch swipe/gyro), brightness modes.
- Other: glowsticks (timed), flares (bright, attract some entities, repel others), fuel lantern, headlamp, **camcorder night vision** (separate battery, distinct green-white look).
- Light is a gameplay variable for the AI (section 7): some entities flee it, some are drawn to it, some only act in darkness.

### 5.4 Food and drink
Almond Water (signature: restores sanity and a bit of health), canned food (needs opener or crowbar), crackers, energy bars, vending machine snacks, cooked meals at hub kitchens (best value), bottled and contaminated water (purify with tablets). Spoilage for some foods.

### 5.5 Tools, keys, and crafting
- Tools: crowbar (pry doors and vents), bolt cutters, lockpicks, rope and grapple, radio (hints, lures, and static near entities), map and compass (unreliable in some levels), noisemakers, screwdriver, wrench, multimeter.
- Keys and puzzle parts: keycards (color-coded), fuses, valves, gears, codes, which can persist across levels when flagged.
- Medical: bandages, medkit, painkillers, sedatives (cost sanity or cause side effects).
- Crafting (simple, discoverable, a few dozen recipes): battery + flashlight, rag + bottle = distraction, cans + rope = tripline alarm, glowstick + rope = marker, fuse repair, water purification.

### 5.6 Movement and stealth
Walk, sprint, crouch, vault, crawl through vents and tight gaps, hold breath, peek around corners, lean.
- **Hiding:** lockers, under desks, behind curtains, in vents. Hiding has rules per entity (some can smell, some check lockers).
- **Noise:** every action has a noise value; show a subtle noise meter. Noise travels along the room graph (walls dampen) and is what entities hear.
- **No direct combat.** Evasion, distraction, light, and environment only. Items can **stun or repel specific entities briefly** (for example flares vs. some, loud noise vs. others), but never kill them.

### 5.7 Death and difficulty
- **Death:** respawn at the last checkpoint (waypoint or level-complete) with the inventory you had at that moment, plus the extra penalty from the difficulty table. Entities reset and their positions re-roll partially so you cannot just memorize them. A tasteful "tape rewind" transition.
- **Difficulty: 5 tiers**, chosen per save slot at New Game (and changeable downward later, never upward mid-run on Hardcore). All values live in one data table so they are easy to tune:

| | **Easy** | **Normal** | **Hard** | **Nightmare** | **Hardcore** |
|---|---|---|---|---|---|
| Intent | Explore and enjoy the atmosphere | The intended experience | Tense, mistakes hurt | Brutal, supplies and nerves tested | One life, no mercy |
| Hunger/thirst | Off (optional) | Slow | Normal speed | Fast | Fast |
| Supply scarcity | Plentiful | Balanced | Scarce | Very scarce | Very scarce |
| Entity speed/perception | Low | Standard | High | Very high | Very high |
| Entity tells (warning time) | Long | Standard | Short | Minimal | Minimal |
| Sanity drain | Slow | Standard | Fast | Very fast | Very fast |
| Battery drain | Slow | Standard | Fast | Very fast | Very fast |
| Damage taken | Low | Standard | High | Very high | Very high |
| Death penalty | Keep all supplies | Lose unsecured supplies | Lose most supplies | Lose all carried supplies | **Permadeath**: save deleted, run ends (ending gallery and unlocks are kept) |
| Mid-level waypoints / saves | 3 per level, manual save unlimited | 2-3 per level, manual save unlimited | 2 per level, manual save unlimited | 1-2 per level, manual saves limited per level | None (level-complete autosave only), no reloading |
| Director | Frequent breathers | Standard | Fewer breathers | Rare breathers, extra ambushes | Rare breathers, extra ambushes |

  Difficulty never changes level layouts or puzzle solutions, only pressure. Beating the game on Nightmare or Hardcore unlocks cosmetics and a title (see 8.6). Separate **Scare Intensity** setting (Relaxed / Standard / Brutal) scales each level's intensity dial (section 8.1) independently of difficulty. Separate accessibility toggles (section 9.7).

### 5.8 Checkpoints and safe rooms
- **Level-complete checkpoint (automatic, every level, every difficulty):** the moment you finish a level the game saves, records your stats and time, unlocks the next door in the Central Hub, and returns you there (5.11). This is the main autosave and the only one on Hardcore.
- **Waypoints (rare mid-level checkpoints):** each level has **2-3 waypoints** (count set by the difficulty table; short or chill levels may have 2). They are deliberately **rare and a little hidden**: placed roughly a third and two thirds of the way along the critical path (plus an optional third in big levels) with seeded jitter, slightly off the main route so players must notice them. A waypoint is a small, calm, recognizable alcove with a tripod-mounted camcorder blinking red, a faint tonal hum audible from a distance, and soft light. Entities cannot enter it. Activating it autosaves, sets your respawn point, and lets you rest, craft, and manually save (per difficulty). Waypoints are never placed inside entity nests or on the very first or last stretch of a level.
- **Prep rooms:** horror levels also have a small supply room near the entry (loot, crafting, a calmer ambience) so you can prepare. It is not a save point.
- **Pause menu:** Exit to Menu always stores the latest checkpoint state; Continue resumes from it.

### 5.9 Transitions ("noclip")
Levels connect by exit mechanisms that vary: stairwell, elevator, cracked wall, door that should not exist, falling through the floor, drowning, a train, and so on. Each transition has a short signature effect (VHS tear, audio warp, screen-space distortion) and a brief level title card. Completing a level (automatic checkpoint) delivers you to the Central Hub at that level's door, and stepping through the next door starts the next level (see 5.11).

### 5.11 The Central Hub (level select)
A persistent, **procedurally generated** hub shown between levels and from the main menu's Continue.
- **The tunnel:** a long, walkable tunnel with a **door/portal for each of the 25 levels** in campaign order, grouped into three wings by act. Each door has a distinct frame, nameplate, tier icon, completion mark, best time, and the difficulty you cleared it on. Doors give a taste of what is inside (light leaking through, muffled level ambience, a temperature or smell cue in the audio and tint).
- **Unlock rule:** you can enter and replay **any level you have reached in the scripted campaign**. Levels beyond your frontier are sealed (welded or dark, with a distinct look and a hint of what is missing). Reaching a new level opens its door with a short reveal animation, and the tunnel visibly extends as you progress.
- **Wings:** the three act hubs (Almond Outpost, The Waystation, The Gantry) are themed areas branching from the tunnel: recurring survivors and side quests, kitchen, crafting table, stash lockers, notes board, bestiary wall, ending gallery door, and a camcorder customization station.
- **Generation:** layout function is fixed for clarity (tunnel, wings, door order) while dressing, lighting, wear, props, and ambient details are seeded so the hub never feels identical but stays instantly recognizable. The hub is a calm, safe space with no hostile entities and calmer music.
- **Campaign vs. replay:** the door at your frontier is **Continue Campaign**. Any earlier door is **Replay** (choose difficulty, new seed by default or enter a seed). In a replay: you may bring items from your stash; loot found can be carried back up to a capped amount (so replays are rewarding but cannot trivialize the campaign); story flags, companion fates, ending-affecting choices, and key items are only changed in the campaign; best times and achievements update; level-complete and waypoint checkpoints still work; dying never triggers Hardcore permadeath (you return to the hub and lose the loot).
- **Pacing role:** the walk from a finished level to the next door is a short breather for resupply, crafting, talking, and reading notes.
- **Implementation rule:** every new level must register itself in one `levels` data table (id, name, act, tier, door look, unlock condition, generator), so the hub, the validators, the bot, the debug console, and saves all pick it up automatically.

### 5.10 Director system
An **AI Director** tracks tension and recent threat exposure. It paces entity spawns and events inside each level's intensity budget so encounters have rhythm: build, release, quiet, strike. It guarantees breathers, avoids unfair back-to-back spawns, and respects the Scare Intensity setting.

---

## 6. Graphics (a first-class pillar)

### 6.1 Look
Realistic, grainy, camcorder-captured. Each level has its own lighting model and color grading (Level 0 sickly yellow and humming; the Poolrooms luminous aqua; the Garage sodium-orange and black; the Arctic whiteout blue), but a unified VHS layer ties them together.

### 6.2 Pipeline (High/Ultra)
- **Materials:** PBR (albedo, normal, roughness, AO), generated procedurally (layered noise, stains, wear, tile and carpet patterns, wallpaper, concrete, rust, wet surfaces), parallax or detail normal mapping, triplanar detail, **decals** for stains, mold, cracks, water damage, graffiti-like marks, tape marks. Damp carpet shader that darkens and glints under light.
- **Lighting:** real-time shadows for the nearest key lights, rect-area-style ceiling panels, procedural light probes or baked-style fake GI per room (ambient color bleeding between rooms), **flickering lights that cast moving shadows**, emissive bloom.
- **Screen-space:** SSAO/GTAO, SSR on wet floors and pool surfaces, TAA with anti-ghosting, depth of field (subtle, focus follows what you look at), per-object or camera motion blur (subtle), auto-exposure, lens dirt/flare.
- **Atmosphere:** volumetric fog and light shafts (can be raymarched at low res or faked with froxels or sprites), floating dust, level-specific particles (ash, snow, pollen, static).
- **VHS/camcorder layer:** film grain, scanlines (subtle), chromatic aberration, tracking glitches, horizontal tearing on scares, timestamp and REC overlay (diegetic HUD), lens breathing, auto-focus hunting, battery warning glitches, a slight vignette. All must be **toggleable and intensity-adjustable**.
- **Polish:** head bob and breathing sway, camera shake from fear and sprinting, hands/arm model for held items, flashlight hand sway with inertia, footstep dust, droplets on the lens in the Poolrooms, frost in the Arctic.

### 6.3 Quality tiers
| Tier | Target | Notes |
|---|---|---|
| **Ultra** | 60 fps on a strong GPU at 1080p-1440p | Everything above, high-density meshes, 2k procedural textures, volumetrics, SSR, TAA, full shadows |
| **High** | 60 fps on a mid GPU | Slightly reduced shadow count, half-res SSAO, lighter volumetrics |
| **Medium** | 60 fps on integrated/mid laptops | Baked-style GI, fewer real-time shadows, simplified post |
| **Low** | 45-60 fps on weak laptops/phones | Flat/vertex lighting, no shadows (blob shadows), light post (grain + vignette), short draw distance |
| **Potato** | stable 30 fps on very old hardware | **Low-poly geometry**, 50% resolution scale, fake fog, no post-processing except a cheap grain overlay, minimal particles, simple audio |
| **Auto** | default | Runs a short benchmark during first load, picks a tier, then uses **dynamic resolution scaling** and automatic tier-down if frame time spikes (and offers to tier-up). |

Also: resolution scale slider, FPS cap (30/60/120/uncapped), VSync, FOV, draw distance, shadow quality, texture quality, AA mode, individual toggles for every post effect, a "Battery Saver" mode for mobile (30 fps, lower res), and a thermal-aware fallback that lowers quality if sustained frame times worsen.

### 6.4 Performance rules
- Aggressive instancing, merged static geometry per chunk, texture atlases or arrays, frustum plus room-graph culling, LOD for props and entities, object pooling, no per-frame allocations.
- Shader compile warm-up during loading to avoid hitches.
- Budgets (guideline; measure and report): Ultra at 1080p under 12 ms per frame on a strong desktop GPU, draw calls under ~1500; Potato under 150 draw calls and under ~150k visible triangles; memory under ~1.5 GB desktop and ~600 MB on mobile at Low/Potato.
- Test on throttled CPU/GPU profiles in the perf harness to approximate weak hardware.

---

## 7. Entity AI framework

### 7.1 Shared perception
- **Sight:** view cone and range, affected by light level at the player, crouching, cover, hiding, and flashlight state.
- **Hearing:** noise events propagate along the room graph with wall damping. Each entity has hearing sensitivity.
- **Special senses:** smell, vibration, screens/light-triggered, "only moves when unseen," and so on, per entity.

### 7.2 Behavior
Utility-based or finite-state behavior with states: idle/lurk, patrol, investigate, hunt, chase, search, flee, stunned, enraged, ritual (level-specific). Navigation on a **nav graph generated with the level**, with local avoidance and door/vent rules per entity.
- **Fear and flee triggers:** each entity has authored triggers (light, flare, specific sounds, items, looking at it, other entities), so the player can bait and manipulate them.
- **Tells and fairness:** every entity telegraphs (audio cue, visual cue, behavior change) before it kills. No unavoidable deaths.
- **Intensity dial:** a per-level 0-1 value scales entity count, speed, perception, aggression, spawn frequency, darkness, and event frequency. Scare Intensity multiplies it.
- **Variants:** elite/mutated versions appear later (faster, blind, light-averse, mimic-capable).
- **Procedural bodies:** entities are generated at runtime using SDF/metaball meshing, lofted tubes, procedural skeleton rigs, and procedural animation (IK, secondary motion, twitchy wrongness). Detail scales by tier (hundreds of triangles on Potato, tens of thousands on Ultra). Each entity needs distinct silhouettes readable in the dark.

---

## 8. Content

### 8.1 Intensity tiers and pacing
- **Chill (2):** Level 3, Level 37. Basically safe, explorable, optional danger.
- **Uneasy (6):** Level 0, Level 1, Schoolhouse, Metro, Wheat Field, Endless City. Entities exist but are slow, avoidable, forgiving.
- **Tense (11):** Level 2, Level 4, Level 5, Level 7, Level 8, Sewers, Server Farm, Carnival, Suburbs, Level 94, Finale. Real danger with tools and room to think.
- **Full horror (6):** Level 6, Garage, Hospital, Arctic Station, The Gallery, Run for Your Life.
- **Rules:** never two full-horror levels in a row except the climax (Gallery then Run for Your Life). A chill or uneasy level always follows horror. Horror levels have a safe room near the start. Chill levels hide an optional scarier area.

### 8.2 Level list (25) with signature entity, hook, and exit
Each level needs: a distinct generator ruleset, a distinct look and sound palette, at least one signature mechanic or puzzle, a handful of loot tables, lore documents, and an exit. Approx. 20-25 min each.

**ACT 1: THE START** (hub: "Almond Outpost")
1. **Level 0, The Lobby** (Uneasy). Endless damp-carpet yellow rooms, buzzing fluorescents, wallpaper variants. Entity: **Stick** (tall thin stalker that only advances when you are not looking at the corridor; backs off in strong light). Late: **Hounds** cameo. Mechanic: learn the basics, find the humming wrong wall to noclip.
2. **Level 1, Habitable Zone** (Uneasy). Concrete warehouse with racks, forklifts, and a small survivors' camp. Entity: **Hounds** (pack hunters; flank, lose interest if you stay quiet, scatter at flares). Mechanic: supply runs, first radio.
3. **Level 2, Pipe Dreams** (Tense). Maintenance tunnels, steam, valves, heat. Entity: **Howler** (blind sound-hunter, screams to alert others; pipes carry sound). Mechanic: valve routing puzzle to open the way; throw clanging items to misdirect.
4. **Level 3, Electrical Station** (Chill). Entity-free. Power routing puzzles, fuse boxes, humming transformers, a hazard-only arc-flash scare. Mechanic: restore power in stages, rewards a big loot room.
5. **Level 4, Abandoned Offices** (Tense). Cubicles, copy rooms, elevators that lie. Entity: **Skin-stealer** (impersonates a coworker NPC; behaves slightly wrong; tell: it never blinks or its shadow lags). Mechanic: verify who is real.
6. **Level 5, Terror Hotel** (Tense). Corridors, room numbers, rule-based dread (posted rules, some are false). Entity: **The Concierge** (enforces rules; breaking one summons it). Mechanic: rules logic puzzle.
7. **Schoolhouse** (Uneasy). Empty classrooms, gym, library, chalkboard clues. Entity: **Hall Monitor** (patrol route, checks passes; you can forge one). Mechanic: hall-pass stealth.

**ACT 2: THE DEEP** (hub: "The Waystation")
8. **Level 6, Lights Out** (Horror). Pitch black. Flashlight and sound only. Entity: **The Lurker** (blind, hunts by sound; vibrates the floor). Mechanic: silent navigation by sound beacons.
9. **Level 7, Thalassophobia** (Tense). Flooded ship and open water. Entity: **Leviathan** (huge, seen in glimpses, reacts to splashing). Mechanic: swim, hold breath, ride out waves.
10. **Level 8, Cave System** (Tense). Caverns, bioluminescence, crawl spaces. Entity: **Cave Crawlers** (fast, swarm, hate light). Mechanic: rope and grapple traversal.
11. **The Garage** (Horror). Multi-level parking structure, sodium lights, broken lights, black pockets. Entity: **Smilers** (glowing grins in the dark; they close in if you stare or if you shine light at them wrongly; look-away rules). Mechanic: restore lights section by section.
12. **Level 37, Poolrooms** (Chill). Luminous tiled water, caustics, serene audio. Entity: **The Drowned** (rare, optional, water-bound). Mechanic: explore, find hidden dry areas and the optional scary sublevel.
13. **Sewers** (Tense). Flooded tunnels, grates, sludge. Entity: **Sludge Leech** plus a **Hound** cameo. Mechanic: flow control and chases.
14. **Hospital** (Horror). Flickering wards, gurneys, emergency lights. Entity: **Faceling** (mimics NPCs and your companion; wears borrowed faces). Mechanic: patient-record puzzle, trust decisions.
15. **Server Farm** (Tense). Racks, cooling aisles, cable mazes. Entity: **Static** (glitch entity: corrupts your screen, short teleports; drawn to screens/light). Mechanic: reboot servers in order.

**ACT 3: THE STRANGE** (hub: "The Gantry")
16. **Metro** (Uneasy). Platforms, tunnels, trains arriving on schedules. Entity: **Platform Wraith** (appears only when a train passes). Mechanic: timetable stealth and train-hopping.
17. **Carnival** (Tense). Faded rides, hall of mirrors, prize booths. Entity: **Partygoers** (friendly mob until you break a rule; "party rules"). Mechanic: win games to earn the exit key.
18. **Suburbs** (Tense). Identical houses, perfect lawns, wrong silence. Entity: **Watchers** (move only when unseen; statues in windows). Mechanic: house-to-house search with sightline management.
19. **Wheat Field** (Uneasy). Entity-free. Open space, wind, a lone building, disorientation, subtle environmental dread. Mechanic: navigate with sparse landmarks; uses compass and the sun.
20. **Arctic Station** (Horror). Blizzard, research base, frostbite and warmth management. Entity: **Whiteout Stalker** (hunts in storms, hides in white-out). Mechanic: heat sources, supply caches, flare navigation.
21. **Endless City** (Uneasy). Rooftops and streets, vertigo, signage. Entity: **Window-Men** (watch from windows; get closer each time you look back). Mechanic: route finding across rooftops.
22. **Level 94, Motion** (Tense). Reflective, mirrored space where your movement is echoed. Entity: **Motion Echoes** (shadow copies repeat your path with a delay; collision with your own echo is deadly). Mechanic: choreograph movement to solve it.
23. **Level 188, The Gallery** (Horror). Portraits that follow you, endless art halls. Entity: **The Curator** (judges you; reacts to what you look at). Mechanic: art-based puzzles; do not meet the gaze of the wrong portrait.
24. **Run for Your Life** (Horror). Long collapsing corridor-and-room chase with a vast pursuer. Entity: **The Pursuer** (huge, relentless). Mechanic: scripted-feeling but procedural route, obstacles, and a few decisive choices.
25. **The Finale** (Tense). Branching based on your choices. Entity: **The Architect**, plus echoes of earlier entities. Mechanic: final decision, multiple endings.

### 8.3 Entity ecology (variety between runs)
- Each level has its **signature entity** plus 1-2 **secondary entities** picked from a shared pool by the run seed and the level's rules: Hounds, Deathmoths, Dullers, Clumps, Wretches, Crawlers, Skin-stealers, Smilers, Facelings, Partygoers, and earlier signature entities.
- Rules adapt behavior to context (a Smiler in a Server Farm is triggered by screens; Hounds in a Hospital hunt differently from Hounds in Level 1).
- **Rare out-of-place events** (a Stick in the Carnival) keep veterans on edge.
- Aim for ~30 distinct entities and variants overall.

### 8.4 NPCs
- **Hub survivors:** 3-5 recurring characters per hub with short arcs, trades, hints, and small side quests.
- **In-level wanderers:** rare survivors you can help, ignore, or lose.
- **Companions:** up to 1-2 AI companions at a time (follow, carry, assist, panic). They can be saved or lost.
- **Faceling mimics:** a "survivor" asking for help may be an entity, with readable tells.
- **Presentation:** human figures can be partially obscured by darkness, masks, and the VHS look; if CC0 NPC models are present, use them. Otherwise use a restrained, stylized procedural mannequin-like body that fits the horror look. Dialogue is short text with synthesized voice-blips (no voice files).
- Choices and outcomes (who you saved, abandoned, trusted) feed the endings.

### 8.5 Lore and found documents
Notes, tape recordings (played back as audio-style text overlays with synthesized static), camcorder logs from Group 7, posters, and graffiti. A **journal/notes viewer** collects everything, searchable by level. Keep text original, tight, and eerie. Write the lore bible to `docs/lore.md` before authoring notes so the story stays consistent.

### 8.6 Endings (6)
Decided by flags and state in a single **ending resolver** (testable):
1. **Escape:** reach the exit with enough sanity and the Exit Key. You reach "the Frontrooms," but something is subtly off.
2. **Join the Backrooms:** accept the Architect's offer (or reach zero sanity at the finale). You become an entity; the game shows your new silhouette in the entity roster.
3. **Sacrifice:** a companion is alive at the end and you choose to stay behind so they can leave.
4. **Loop:** refuse the exit or fail a specific condition. You wake up in Level 0 with a new seed and remember fragments (New Game+ carries select unlocks).
5. **True ending:** requires a hidden item chain (e.g., 5 "Anchor" objects found across Acts 1-3 via optional puzzles) plus a specific decision. Reveals the full story.
6. **Secret ending:** an obscure trigger not hinted in any menu (for example a precise sequence of actions in Level 0 early on that pays off at the finale).
Finishing on Nightmare or Hardcore unlocks extra camcorder cosmetics and a profile title. Add an **ending gallery** and a **New Game+** loop with unlockable cosmetics for the camcorder, harder modifiers, and a speedrun mode with timer and fixed seed.

---

## 9. Controls, UI, audio, accessibility

### 9.1 Input
Unified action-mapping layer (`Move, Look, Sprint, Crouch, Interact, UseItem, Flashlight, Camcorder, Inventory, Journal, Hold Breath, Peek, Throw, Pause...`) feeding the same simulation.
- **Keyboard + mouse:** fully rebindable, raw mouse input, sensitivity, invert, Pointer Lock handling.
- **Gamepad:** Gamepad API, Xbox/PlayStation/Switch layout detection and matching glyphs, rebinding, dead zones, response curves, aim assist off by default, vibration cues for heartbeat, damage, and proximity.
- **Touch:** dynamic virtual joystick on the left, look zone on the right, contextual buttons that appear only when relevant, tap-to-interact, swipe gestures for flashlight shake and inventory, optional gyro, left/right-handed layouts, adjustable size and opacity, safe-area support, haptics. Edit-layout mode.
- **Automatic detection and seamless switching** between schemes, with prompts and glyphs updating instantly.

### 9.2 UI direction
**Clean, restrained, and diegetic where possible.** No clutter, no loud colors. A camcorder-styled HUD (REC dot, battery, timestamp) and a minimal stat display that fades when not needed. Elegant monospace/sans typography (system fonts or a bundled free font), consistent spacing, smooth micro-animations, and tasteful sound feedback.
- **Main menu:** live 3D background (a procedurally generated corridor with a flickering light), New Game (choose save slot, **difficulty with a short description of each of the 5 tiers**, optional seed entry), Continue, Load/Manage Saves, Settings, Bestiary, Ending Gallery, Credits.
- **In-game:** minimal HUD, context prompts (adapt to input device), inventory/backpack screen with drag and drop and controller navigation, journal/notes, map when available, pause menu, level title cards, subtle damage/fear overlays, subtitles.
- **Settings:** Graphics (tier, Auto, resolution scale, FPS cap, per-effect toggles, VHS intensity, FOV, draw distance), Audio (master, music, SFX, ambience, voice blips), Controls (per-device), Gameplay (difficulty, Scare Intensity, hunger on/off, auto-save), Accessibility. Live preview for graphics changes where possible. Everything persists.
- All UI must scale for 16:9, ultrawide, tablets, and phones in portrait and landscape.

### 9.3 Audio (fully synthesized)
- **Engine:** Web Audio graph with buses (master, music, sfx, ambience, ui), HRTF spatialization, distance and occlusion filtering (walls muffle), procedurally generated reverb impulse responses per room size and material, dynamic range control, limiter.
- **Sounds:** fluorescent hum with beat frequencies, footsteps by surface (carpet, concrete, tile, water, snow, metal, grass) and by movement type, door and pipe creaks, ventilation drones, dripping water, electrical crackle, breathing and heartbeat tied to stats, item and UI sounds, and entity voices built with FM synthesis, formant filters, and noise (each entity has a distinct signature).
- **Music:** sparse generative ambient layers per level that react to tension (drones, tonal clusters, stingers). Silence is a tool; the Director controls it.
- **Captions:** closed captions describing sounds for accessibility.

### 9.4 Animation
First-person arms/hands with held-item animations (draw, raise, shake flashlight, drink, eat, pry, throw), smooth stance transitions (crouch, vault, crawl), procedural camera motion, entity procedural animation, door/drawer/locker interactions with easing, UI transitions. Everything should feel weighted and smooth.

### 9.5 Level transitions and loading
Brief, atmospheric loading with generation progress and a tip or lore line. Shader/material warm-up hidden here. No pop-in after load.

### 9.6 Performance on all hardware
Section 6.3-6.4 applies. Also: support low memory devices with texture downscaling, reduced entity counts, and smaller chunk radius. Test the Potato tier through the perf harness with throttling.

### 9.7 Accessibility
Subtitles/captions, reduced flicker and strobe option (photosensitivity safe), reduced jump scares, reduce camera shake/head bob, colorblind modes, text size, high-contrast UI option, remappable everything, hold vs. toggle options, one-handed touch layout, a "content warning" screen at first launch.

---

## 10. Phases

After each phase: all tests and validators pass, `STATE.md` is updated, then **commit, tag (`phase-N`), push to GitHub, and confirm the GitHub Pages deployment is live (section 0.5)**. Then give a short report: what was built, the live URL, how to run locally, the key commands, perf numbers per tier, known issues, and your recommendation for the next phase. **Then stop.**

### Phase 0: Foundation
Project setup (Vite + TS, lint, Vitest, Playwright, CI/Pages deploy, PWA). Engine loop, renderer, scene manager, fixed timestep. Seeded RNG and generation framework (interfaces from 4.2, worker plumbing, chunk streaming skeleton, validator harness). Input layer for all three schemes (with a test room). Settings system and UI shell (menus, settings with all categories wired, persistence). Quality tier system with Auto benchmark and dynamic resolution scaling. Render pipeline foundation (PBR procedural materials, post-processing chain, VHS layer, quality-scaled). Audio engine with mixer, spatial audio, reverb, and a few core sounds. Save system. Debug console and tools (0.3). Perf harness. **GitHub Actions deploy workflow and first live deploy** (section 0.5). Save slots and profile storage with tests, and the difficulty data table with tests. A **test room** generated from a seed that exercises lighting, materials, fog, and input.
**Accept:** runs smoothly at every tier in the perf harness; all three input types functional in the test room; settings persist; saves round-trip; debug tools work; validators run on a placeholder level.

### Phase 1: Core Systems + Level 0 vertical slice
Player controller polish (stamina, crouch, vault, lean, head bob, fear camera). Full stats and sanity (with hallucinations). Inventory/backpack/hotbar UI. Items, flashlight and battery behavior, camcorder, almond water and food, interaction system, hiding spots, noise system. Director v1. Entity AI framework and procedural entity pipeline. Level 0 full generation (varied room types, wallpaper/carpet variants, ceiling lights, dead ends, sublevels), **Stick** and **Hounds**, safe room, the **Central Hub** (procedural tunnel with level doors, locked/unlocked states, replay entry, and the Almond Outpost wing with 2-3 NPCs), level-complete autosave and 2-3 **waypoint checkpoints** in Level 0, level-select unlock tracking in the save, notes and the journal, exit/noclip transition, death/respawn. Main menu with live background and title flow.
**Accept:** Level 0 validated on 200 seeds, completable by the bot, intensity tuned to Uneasy, graphics reviewed at all tiers, 60 fps on High on a mid GPU, stable 30 on Potato. This phase sets the feel bar for everything after.

### Phase 2: Act 1 (Levels 1-5 and Schoolhouse) + Hub 1
Build levels 1, 2, 3, 4, 5, Schoolhouse in batches of two, commit after each. Entities: Hounds (expanded), Howler, Skin-stealer, Concierge, Hall Monitor. Crafting, tools, keys and locks, puzzle framework (valves, fuses, rules). Companions v1. Entity ecology v1 (secondary entities and variants). More notes and Group 7 lore.
**Accept:** all six levels pass validators and bot runs; each has distinct look, sound, mechanic, and entity; pacing rules respected.

### Phase 3: Act 2 (Levels 6, 7, 8, Garage, 37, Sewers, Hospital, Server Farm) + Hub 2
Water/swimming and breath system, darkness-only gameplay, rope/grapple, advanced lighting scenarios (lights-out, broken lights restore). Entities: Lurker, Leviathan, Cave Crawlers, Smilers, Drowned, Sludge Leech, Faceling (with NPC mimic system), Static (screen-corruption effects). Chill-level optional scare area.
**Accept:** same as Phase 2, plus water rendering reviewed (caustics, SSR, lens droplets), and Level 6 is playable and readable with sound only.

### Phase 4: Act 3 (Levels 16-25) + Hub 3 + climax
Metro schedules, Carnival rules, Suburbs sightline logic, Wheat Field open-world streaming, Arctic cold system and blizzard rendering, City rooftops, Motion echo system, Gallery gaze logic, chase level, finale branching. Entities: Platform Wraith, Partygoers, Watchers, Whiteout Stalker, Window-Men, Motion Echoes, Curator, Pursuer, Architect.
**Accept:** same as before; the chase is fair and thrilling and bot-completable; finale branches all reachable.

### Phase 5: Endings, lore, secrets, polish
Ending resolver finalized and tested (all 6), ending sequences and the ending gallery, True and Secret ending content, New Game+, speedrun mode, full lore pass and notes, achievements/log, secrets and easter eggs, tutorial hints (subtle), balance pass across difficulty and Scare Intensity, accessibility audit, audio mix pass, VHS and color grading pass, UI polish pass, hardware compatibility pass (Chrome/Edge/Firefox/Safari, iOS and Android), memory and loading optimization, bug sweep, final perf report per tier. README, credits, and a short in-game "how to play."
**Accept:** final checklist (below) passes.

---

## 11. Definition of done (overall)
- 25 levels, each with distinct look, sound, mechanic, entity (or intentionally none), loot, and lore.
- 6 reachable endings verified by tests, plus New Game+.
- All three input schemes feel good; gamepad and touch are not afterthoughts.
- Graphics tiers from Potato to Ultra all verified with perf numbers; Auto works.
- Every level validated across many seeds and completable by the bot.
- Clean, restrained, polished UI; settings complete and persistent; accessibility options present.
- No hitching during generation; loading is short and atmospheric.
- Local saves (3 slots, autosave, export/import) and a global profile that survive updates.
- A procedural Central Hub tunnel where every level reached in the campaign can be entered and replayed; unreached levels are sealed.
- Automatic checkpoint at every level completion, plus 2-3 rare waypoint checkpoints per level (count scaled by difficulty), covered by validators.
- 5 difficulty tiers (Easy to Hardcore) implemented from one data table and verified by tests.
- Every phase pushed to GitHub and **live on GitHub Pages**, PWA offline-capable, README with controls and seed sharing.

**Begin Phase 0 now.** First check the `origin` remote (section 0.5), then write `docs/ARCHITECTURE.md` and `docs/STATE.md`, show me a brief plan of the Phase 0 task list, then build it. Do not start Phase 1 until I say so.
