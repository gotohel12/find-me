# FIND ME / لقني — Checkpoint 1 audit (round 2)

© 2026 MD Studio. All rights reserved. Developed by Mohsen ~ Danial.

What the rejection asked for, what changed, and how it was checked. ✅ done · 🟡 partly / needs a real device · ❌ not done.

## 1. No low-poly
| Item | Status | Notes |
|---|---|---|
| Photoscanned PBR props | ✅ | All hero props and clutter are Poly Haven CC0 photoscans (credits.json lists each one). |
| Hero props 8k–40k triangles | ✅ | Photoscans as shipped by Poly Haven; the map's total triangle count is written to map.json (`triangles`). |
| Character 20k–40k triangles | ✅ | Subdivision 4 + even decimate ≈ 30k (the Blender log prints the exact count). Earlier build: 15.6k. |
| Soft character material | ✅ | Sheen and a little subsurface (vinyl toy). |
| LODs | 🟡 | gltf-transform `optimize` simplifies and meshopt-compresses at pack time. No separate distance LODs yet; the room is small (8 × 6.5 m), so everything is close. |
| Real Japanese apartment | ✅ | Hand-authored layout (not random): 16 tatami mats, cedar trim, nageshi beam and posts, two real windows (glass, frames, sill, curtains), genkan door with a tiled step, kitchen (counter, sink, hob, hood, wall cabinets), fridge, futon with duvet and pillow, oshiire closet with fusuma, chabudai + 4 zabuton, rug, 4 original posters, 3 plushies, full shelves, plants, pendant paper lamp + ceiling light, balcony and city outside. Ceiling height 2.4 m. |
| Light | ✅ | Sun through the windows, sky fill in each window, HDRI for reflections, lamp lights also sent to the game (`map.json → lights`). |
| Textures in game = textures in Blender | ✅ | PBR materials now use UVs (world-scale cube projection), so the glTF carries them exactly; before, box projection was lost on export and walls looked stretched. |

## 2. No clipping
| Item | Status | Notes |
|---|---|---|
| Seat snapping | ✅ | Sit looks for a seat 0.18–0.85 m high in front, turns around and rests the torso on its top. |
| Surface alignment | ✅ | Every other pose rests its lowest point on whatever is under the body. |
| Depenetration | ✅ | After every pose, the whole skinned body is tested against the map and pushed out in up to 6 small steps. |
| "No room" hint | ✅ | If the body still overlaps more than 1 cm, the pose is refused and a toast says "Not enough room for that pose here". |
| Automated clipping test | ✅ | `clipReport()`: 17 poses × 9 spots = **153 tests, worst 0.3 cm, 0 over 1 cm, 5 refused with the hint**. Self-test: a body pushed into a wall reports 5 cm (half the wall thickness), so the detector really sees walls. |
| Camera collision | ✅ | 14 cm sphere cast instead of a thin ray. Paint mode turns the camera toward the most open side. |

How the inside test works: six rays per vertex; Rapier marks a back-face hit on a triangle mesh with `featureId ≥ triangleCount`. Inside = the nearest hit is a back face and another ray agrees. (The ray normal can't be used: Rapier always flips it toward the ray. That was found and fixed during this audit.)

## 3. Controls and feel
| Item | Status | Notes |
|---|---|---|
| Mouse 0.05–5, raw input, X/Y, invert | ✅ | Pointer lock asks for `unadjustedMovement` (raw). |
| Touch sensitivity X/Y, joystick size, dead zone | ✅ | |
| Gamepad sensitivity, curve, dead zone | ✅ | Linear or exponential. |
| Paint orbit and zoom sensitivity | ✅ | |
| FOV 70 PC / 75 phone, camera distance, smoothing | ✅ | All live in Settings, saved per device. |
| Acceleration, coyote time, jump buffer | ✅ | Accelerate 12, brake 16, coyote 0.12 s, buffer 0.14 s. |
| Fixed timestep + interpolation | ✅ | 60 Hz physics, rendered position interpolated. |
| No foot sliding | 🟡 | Walk/run blend by speed; needs a check on a real device at 60 FPS. |

## 4. New UI
| Item | Status | Notes |
|---|---|---|
| ui/DESIGN_SYSTEM.md | ✅ | Tokens, type, components, motion, RTL rules. |
| Cairo + Baloo Bhaijaan 2 | ✅ | Self-hosted with their OFL licences. |
| One custom SVG icon set | ✅ | `web/src/ui/icons.tsx`, no emoji in the UI. |
| Glass panels | ✅ | |
| Every screen redone | ✅ | Splash, menu, settings (5 tabs), credits, loading, HUD, paint dock, pose wheel, toast. |
| Radial pose wheel, 3D thumbnails, world visible | ✅ | Two rings, Blender-rendered thumbnails, edge-only dim. |
| Collapsible paint panel that doesn't cover the body | ✅ | View offset frames the body in the free side (correct for RTL and LTR). |
| Key chips, hidden on phones, RTL correct | ✅ | |
| Screenshots AR/EN × phone/PC | ✅ | `ui/screenshots/` |

## 5. Performance
| Item | Status | Notes |
|---|---|---|
| Phone 30+ FPS, PC 60+ FPS | 🟡 | Can't be measured here: the test machine has no GPU (software rendering gives about 20 FPS at 1280×720 for any WebGL game). Done for speed: static meshes merged by material, meshopt + WebP 1024, quality tiers (pixel ratio, shadows, paint texture size), no shadows on point lights. Turn on Settings → Graphics → Show FPS to read it on a real device. |

## 6. Not built yet (Phase 2+, as planned)
Online rooms, seekers, bots and the other maps. Database is Render free Postgres (the Neon sign-up captcha kept looping); it expires 30 days after creation unless moved to Neon.
