# FIND ME — لقني

**A daily paint-to-hide web game. Developed by Mohsen ~ Danial.**

© 2026 MD Studio. All rights reserved.

Every day one new scene drops at 00:00 Riyadh time. **Hide**: place the little white figure, paint it until it disappears, submit. **Seek**: find other players' hides as fast as you can. **Share**: send a "Can you find me? 👀" link that opens straight into your hide, with no download and no signup.

---

## Status

| Phase | State |
|---|---|
| 0 — Foundation | **In progress.** Repo, rules, art pipeline, packer, web + API skeletons, CI, Render Blueprint |
| 1 — Core feel | Next: 12 poses, 3 scenes, hide editor + paint tools, seek mode, reveals, sound |
| 2–7 | Planned (see `CHANGELOG.md` and the spec) |

`QA_CHECKLIST.md` lists exactly what has been verified and how.

## Repo layout

```
shared/     game rules used by BOTH web and api: schedule, scoring, fairness, hit test, codes
web/        Vite + TypeScript + Preact UI, PixiJS game canvas, PWA
api/        Node 22 + Fastify + Postgres + Redis
blender/    every image in the game is generated here by bpy scripts (Blender 4.2 LTS, Cycles)
  lib/        render/pass/camera/material helpers (fm.py) + prop kit (kit.py)
  character/  the hider figure, 12 poses × 5 angles
  scenes/     one script per daily scene (s001_toy_shop.py, …)
  ui/         app icon, logo, menu art
  build_all.py  ONE command builds the whole art library
tools/      scene_pack.py: render passes → web assets (WebP/AVIF, depth/mask data, sprites, icons)
content/    scene schedule, scene catalogue, AR/EN strings
scripts/    dev.sh, test_all.sh, build_art.sh, deploy.sh
```

## How the art works (no hand-made art, ever)

1. `python3 blender/build_all.py` runs each generator in headless Blender:
   `blender -b --factory-startup --python <script> -- --out build/art`
2. Scenes write a beauty render plus **depth**, **normal** and **object-role** passes for a 16:9 and a 9:16 camera, and light metadata (key-light direction in camera space). The hider writes, per pose and angle, a studio render plus **UV**, **body-part**, **normal**, **AO** and **coverage** passes.
3. `tools/scene_pack.py` turns those into web assets: beauty images under 600 KB, a lossless `data.png` (16-bit depth + forbidden zones) that both the client and the server read, and sprite maps where each pixel says *which spot of the shared 256×256 paint texture it shows*. That's what lets paint stick to the body in every pose.
4. `python3 blender/build_all.py --verify` fails if any shipped asset has no generator script.

Without Blender installed, run the **art** workflow in GitHub Actions (Actions → art → Run workflow). It renders everything and opens a PR with the packed assets.

## Run locally

Needs Node 22+, Docker, Python 3 with Pillow + numpy, and optionally Blender 4.2 LTS.

```bash
npm install
npm run art:preview     # quick low-res art (needs Blender); or download the art workflow artifact
npm run dev             # Postgres + Redis in Docker, API on :8787, web on :5173
npm test                # everything that runs without Blender
```

## Deploy

Live on the existing free Render service **emberwing** (`https://emberwing.onrender.com`). One web service serves the game and the API:

- Build: `npm install --include=dev && npm run build` · Start: `npm start` · Health: `/health`
- `DATABASE_URL` (Render → emberwing → Environment): a free **Neon** Postgres connection string. Without it the game still loads; accounts and hides need it.
- No cron job and no Redis (both optional): today's scene comes from `content/schedule.json`.

**Honest note:** free Render instances sleep after ~15 minutes idle, so the first visit after a quiet spell can take ~30–60 s.

Packed web assets are kept in plain git (each file < 600 KB) so Render gets them on clone; only large sources (`*.blend`, `*.exr`, masters, audio sources) use Git LFS.

## Credits

**Developed by Mohsen ~ Danial.** See `CREDITS.md` for third-party licences.

© 2026 MD Studio. All rights reserved.
