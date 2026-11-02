# STATE (living). Spec: `docs/MASTER.md`. Layout/data flow: `docs/ARCHITECTURE.md`.

## Where we are
**Phase 1 (core systems + Level 0 vertical slice + Central Hub): complete locally.** Phase 0 is in git history. Next: wait for "Begin Phase 2" (Act 1: Levels 1-5 + Schoolhouse).

## Commands
| Command | Purpose |
|---|---|
| `npm run dev` | dev server (add `?debug=1` to any build to enable the backtick debug console + `window.__game`) |
| `npm test` | Vitest (124 tests): rng, difficulty, saves, settings/input, quality, endings skeleton, generation + validators, mesher/streamer, textures, reverb, collision, bot, sim, **inventory, stats/sanity/hallucinations, lights, noise, Director, Entity Lab AI scenarios, Level 0 in the real sim, hub** |
| `npm run validate:levels [-- --seeds=200 --level=id]` | all validators over N seeds + the autopilot bot on 40 seeds; pass/fail table |
| `npm run bot -- --level=placeholder --seed=123 [--waypoints --difficulty=hard]` | headless autopilot run |
| `npm run smoke` | Playwright e2e of the real flow: settings persistence, New Game -> hub, dialogue gives an item, inventory panel, door panel -> Level 0, hiding, hound tell-before-bite, death -> rewind -> respawn, note reader, level completion -> hub with next door unlocked |
| `npm run shots [-- --levels=testroom --tiers=ultra,potato]` | screenshots to `./shots` |
| `npm run perf [-- --levels=placeholder --tiers=... --seconds=8 --throttle=4]` | flythrough per tier; table + budget check; writes `reports/perf.json` |
| `npm run verify` | typecheck + lint + tests + level validators (what CI runs, plus build) |

## Built in Phase 1
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
- **Deploy:** see the last section of the report; the `github-pages` environment only deploys from `main`.
- Level 0 **sublevels** and the vault move are not built (no low obstacles exist yet). Hub kitchen, crafting table, camcorder customization, bestiary content beyond a seen-count, and the ending gallery are placeholders (crafting/kitchen arrive with Phase 2 recipes; endings Phase 5). Hub wings 2 and 3 are sealed gates (their content is Phase 3/4).
- Level 0 `targetSeconds` is [150, 1800]: the critical path takes ~4 min for a bot; the intended 20-25 min comes from exploring, hiding, note reading, and entity pacing. Tune after human playtesting.
- Entities use sight/hearing only (no smell/vibration yet). Procedural bodies use lofted tubes and ellipsoids; SDF/metaball meshing is not used. Entity LOD beyond detail-by-tier is not built.
- Inventory screen supports mouse/touch drag and focusable buttons; there is no gamepad cursor mode yet. Manual save has no button (the flow API exists).
- Camcorder night vision is a screen-space amplification + ambient boost, not a separate lighting model. Hallucination "UI glitches" are a glitch pulse + toast.
- Remaining items from the Phase 0 graphics gap list are unchanged (SSR, TAA, DoF, motion blur, volumetrics, auto-exposure, lens effects, GI probes).
- Frame times are still software-rendered here (no GPU), so only draw calls / triangles / generation times are meaningful.

## Key decisions
- Walls are 0.2 m thick, rooms are BSP tiles (no gaps/overlaps by construction), doors are real openings with reveals; colliders for the whole level are built up front (cheap), only visuals stream.
- One `LEVELS` table; generators are pure and deterministic; layouts never change with difficulty (tested).
- Debug tools are off in production builds unless `?debug=1`.
