# Definition-of-done checklist (spec section 11): honest status

Legend: **done** = built and verified by tests/tools; **partial** = built, with gaps listed; **open** = not verified here.

| Item | Status | Notes |
|---|---|---|
| 25 levels, each with distinct look, sound palette, mechanic, entity (or none), loot, lore | **done / partial** | All 25 generate, validate (100-200 seeds) and complete with the bot. Looks, entities, loot tables and notes are distinct. Per-level *sound palettes* are shared (hum, footsteps by surface, entity voices): level-specific music/ambience beds are not authored. |
| 6 reachable endings verified by tests, plus New Game+ | **done** | `resolveEnding` tests, Architect choices, Anchors + secret flags, ending gallery, titles/lenses, NG+ (entities 12% sharper). True ending needs 5 Anchors; Secret needs the Level 0 sequence. |
| Three input schemes feel good | **partial** | Keyboard/mouse fully exercised in a real browser. Gamepad: logic + glyphs unit-tested, not tested with hardware. Touch: emulated phone (portrait + landscape) passes layout and control checks (`npm run mobile`); no real-device test. |
| Graphics tiers Potato..Ultra verified with perf numbers; Auto works | **partial** | Draw calls/triangles/generation times measured per tier (see STATE). **Frame times are not representative**: this environment has no GPU (software rendering). Auto picks Potato on software GPUs by design and is unit-tested. |
| Every level validated across many seeds and bot-completable | **done** | `npm run validate:levels` (200 seeds + bot 40) in CI; fairness test for the chase. |
| Clean, restrained, polished UI; settings complete and persistent; accessibility | **done / partial** | Settings schema, rebinding, persistence tested. Accessibility: captions, reduce flicker/shake/jump scares, colour-blind modes, text size, high contrast, hold/toggle. No screen-reader pass; no one-handed edit-layout mode (one-handed layout exists). |
| No hitching during generation; loading short and atmospheric | **partial** | Chunk meshing and textures run in workers; the loading screen shows progress and tips. Not measured on real hardware. |
| Local saves (3 slots, autosave, export/import) + global profile | **done** | Atomic writes, backup, migrations, export/import tested. |
| Procedural Central Hub; replay any reached level; unreached sealed | **done** | 25 doors, three wings, 5 survivors, replay rules (capped loot). |
| Automatic checkpoint at every level completion + 2-3 waypoints per level | **done** | Covered by validators; hardcore has none. |
| 5 difficulty tiers from one table, verified by tests | **done** | |
| Every phase pushed and live on GitHub Pages; PWA offline-capable; README | **done** | Service worker with versioned cache verified on a production build. |
| Cross-browser (Chrome/Edge/Firefox/Safari, iOS/Android) | **open** | Only Chromium (desktop + emulated mobile) was available here. Firefox/Safari/iOS/Android real devices still need a manual pass. |
| WebGPU path | **open** | Not built (WebGL2 is the default and only path). |
| Graphics features listed in 6.2 not implemented | **open** | SSR, TAA, depth of field, motion blur, volumetric light shafts, auto-exposure, lens dirt/droplets, GI probes. Implemented: PBR procedural materials, decals (floor stains), GTAO, bloom, shadows, fog, dust, VHS layer, colour grading, colour-blind modes, flashlight and lens cosmetics. |
