# QA checklist — FIND ME / لقني

Ticked only when verified, with how. `[~]` = written, waits for a machine with the missing tool.

## Phase 0 — Foundation
- [x] Shared rules: 14 unit tests (Riyadh rollover at 21:00 UTC, leap/year edges, rotation + overrides, seek points, hard-but-findable hider curve, emoji row, levels, transform round-trip, hit test incl. occlusion + tolerance, all six fairness failures, clamping, codes) — `node --test`
- [x] Shared rules typecheck (`tsc --strict`)
- [x] AR/EN strings: same keys in both, RTL direction, Arabic digits, credit present — 5 tests
- [x] Asset packer: 6 tests on synthetic passes (600 KB budget incl. forced downscale, AVIF + WebP, 16-bit depth round-trip, forbidden zones from sky/lamps, sprite maps never blend body parts or UVs, anti-aliased edges, feet anchor, icons)
- [x] Database schema applies cleanly on PostgreSQL 16; guest-signup, `/me` and daily-publish SQL run correctly against it
- [x] API can import `@findme/shared` TypeScript through a workspace symlink on Node 22
- [x] All Blender scripts compile; `build_all.py --verify` runs
- [~] Blender renders (character, s001 toy shop, app icon) — needs Blender 4.2: run the **art** workflow
- [~] API typecheck + integration tests (`api/test/api.test.ts`) — need `npm install`: run by the **api** workflow
- [~] Web typecheck, production build, 200 KB initial-JS budget — need `npm install`: run by the **web** workflow
- [x] Paint engine core: 8 tests (brush clipped to body part, soft edge, per-part bucket incl. both arms, undo/redo capped at 30, eraser, tinted pattern stamps, scene-matched lighting + AO, colour helpers)
- [ ] Screens checked visually in AR + EN, phone + desktop (after first art render)
