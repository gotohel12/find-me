# Changelog — FIND ME / لقني (Mohsen ~ Danial)

## [Unreleased] — Phase 0: Foundation

### Added
- `shared/src/paint.ts`: paint engine core (brush, eraser, per-part bucket, pattern stamps, smudge, 30-step undo/redo, scene-matched lighting) shared by the editor and the server compositor.
- `shared/`: game rules shared by client and server. Riyadh-midnight day keys, countdown and scene rotation with overrides; seeker points, streak multiplier, emoji result row; the "hard but findable" hider score (peak at 15–50 % find rate, never-found hides score below found-by-a-few); levels 1–100; placement transform; server-side hit test with occlusion and tap tolerance; fairness checks (min size, ≥ 40 % visible, scale/rotation limits, forbidden zones, off-screen); challenge/friend codes.
- `blender/lib/fm.py`: headless Cycles setup with GPU auto-detect, data passes written as EXR and converted to .npy inside Blender, camera/light metadata in camera space, procedural pattern materials (stripes, checker, dots, noise, waves, wood grain, plaid, tiles, bricks).
- `blender/lib/kit.py`: prop kit (shelves, toy boxes, balls, block stacks, plush creatures, toy cars, jars, spinning tops, stacking rings, book rows, rugs, pendant lamps).
- `blender/character/hider.py`: the hider figure built from rigid parts on joints, a per-part paint-texture atlas, 12 poses × 5 angles, studio + data renders.
- `blender/scenes/s001_toy_shop.py`: first scene, landscape + portrait cameras.
- `blender/ui/app_icon.py`: app icon render.
- `blender/build_all.py`: one-command art build and `--verify` (no asset without a generator).
- `tools/scene_pack.py`: packer (size-budgeted WebP/AVIF, 16-bit depth + forbidden mask PNG, anti-aliased sprite maps that never blend body parts, anchors, icons, manifest).
- `api/`: Fastify app, config, migration runner, initial schema, guest auth, `/health`, `/v1/me`, `/v1/today`, daily publish job.
- `web/`: Vite + Preact shell, AR/EN with RTL, splash with credit, home with today's scene and countdown, offline banner, PWA manifest + service worker.
- `render.yaml`, GitHub workflows (web, api, art), dev/test/art/deploy scripts.
