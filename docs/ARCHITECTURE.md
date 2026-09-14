# Architecture notes

Written for whoever picks this up next. It explains the decisions that are not
obvious from reading a single file.

## The shape of a frame

`Game.update(dt)` runs in a fixed order and nothing reorders it casually:

1. `InputSystem.update` — devices resolve to logical actions.
2. Audio and UI timers (these run even while the world is paused).
3. If a panel is open, the world clock stops but rendering continues.
4. `TimeSystem` → `WeatherSystem` → `Farm.advance` (all driven by in-game minutes).
5. Player movement and the camera rig.
6. World update: lighting, sky, water, foliage, props, buildings, NPCs, drops.
7. Interactions poll (15 Hz, not every frame) and publish prompts.
8. Audio mix and HUD.
9. Autosave tick.
10. `InputSystem.endFrame` clears edge-triggered flags.

## Why an event bus

Rendering, gameplay and interface never call each other directly. Gameplay
emits (`item:gained`, `museum:donated`, `ui:catchCard`), the UI and audio
listen. That is what makes it possible to open a panel from a world
interaction, from a keyboard shortcut and from another panel without any of
them knowing about the others.

## Why the character rig is not skinned

`CharacterRig` builds a plain `Object3D` hierarchy from primitives with named
joints. It costs nothing to author, every joint is addressable by name, and
customisation is swapping child meshes and material colours rather than
re-exporting a mesh. `CharacterAnimator` writes rotations to those joints, so
when production GLTF characters arrive they can be parented to the same joint
names and the animator does not change.

Clips are functions of normalised time rather than baked keyframes. That keeps
each action a dozen readable lines and lets speed, tool weight and intensity
scale them continuously. Blending is done in quaternion space so opposing
rotations do not gimbal through a pose.

## Why interiors sit at x = 1000

Interiors are built in the same scene as the island, offset far along +X. The
exterior root is hidden while inside, so nothing overlaps and there is no second
scene to keep in sync. Player world coordinates are `INTERIOR_ORIGIN + local`,
which is why interaction anchors add the offset.

Rooms are presented as open-topped models: the ceiling is single-sided and
invisible from above, and `Game.updateInteriorWalls` hides whichever walls the
camera sits behind, chosen by comparing each wall's outward normal with the
camera direction. This is deterministic — an earlier raycast-based fade was not
reliable when the camera ended up inside geometry.

## Why the water reads depth from a baked texture

The ocean shader needs to know how deep the seabed is at every point to colour
the water and place shoreline foam. Reading the scene depth buffer would couple
the shader to the render pipeline; instead the terrain height is baked into a
512² texture once at load. It is stored as plain 8-bit RGBA rather than a float
texture because float textures are not linearly filterable everywhere — that
bug rendered the whole ocean flat and pale until it was tracked down.

## Why kit geometry goes through a registry

`Foliage` takes the `AssetManager` as a constructor argument, because it was the
first system to use kit art. Everything after it — props, interiors, furniture,
drops, tools — is built several layers down, so `src/assets/registry.ts` exposes
the same manager by import (`kitGeometry`, `makeKitMesh`, `kitMaterial`).
`Game` sets it once before building the world. Every caller keeps its
procedural fallback: a missing kit degrades the look, never the boot.

Kit meshes are drawn with `createStylizedMaterial({ vertexColors: true })` and
a *tint* rather than their own materials, so they take the wind, wetness and
season uniforms like everything else. `softTint` lifts a palette colour toward
white before multiplying, because a straight multiply by a mid-tone halves the
brightness of the baked colours.

## Why the textures are neutral

`rendering/textures.ts` bakes small canvases (roof tiles, plaster, planks,
stone, flagstones) as light greys with darker seams, and the material's
`color` supplies the hue. `Buildings.applyHouseStyle` repaints the cottage by
matching material colours; a coloured texture would silently break that. The
tiling density is applied per material in the vertex shader (`mapRepeat`), so
one shared texture serves a 6 m cottage and a 36 m museum hall.

## Why characters carry a blob shadow, a nameplate and a bubble

The shadow map grounds a character in sunlight and abandons them at dusk,
indoors and under a canopy; the soft disc under the feet is always there.
Nameplates and emote bubbles are sprites in the scene, not HTML: they sit
behind a lamp post like a real sign would and fade with distance. All three
hang off the rig's group, so a remote player rendered with the same rig would
get them for free.

## Gotchas worth knowing

- `PCFSoftShadowMap` ignores `shadow.radius`; the renderer uses `PCFShadowMap`
  so the sun's penumbra actually blurs.
- The camera keeps itself above the heightfield (`CameraRig.terrainClamp`);
  interiors switch it off because they sit far outside the island.
- Interior walls are rounded boxes, not `BoxGeometry`: extruded geometry has
  UVs in metres, which is what lets the plaster texture tile evenly.
- The interaction poll uses the clamped frame `dt`; on a very slow frame it
  polls every frame rather than letting a stale prompt linger.

- `roundedBoxGeometry` measures its outer size exactly and is centred on its
  origin, like `BoxGeometry`. It did not always: the extrude bevel used to be
  added on top of the requested size, which sank building walls into the ground
  and hid sign text inside the boards.
- Paths level themselves against the *zoned* elevation (terrain plus building
  pads and plazas), not raw terrain. Levelling against raw terrain undid every
  flat zone a path crossed.
- Grass chunks are culled by their nearest edge, not their centre, or bands of
  bare ground appear at the draw distance.
- `darkness` in the lighting rig tracks the sun only. Folding cloud cover into
  it lit the street lamps on overcast afternoons.
- Instanced meshes are skipped by camera occlusion fading; fading one instance
  would fade the whole batch.

## Testing the look

There is no automated visual test, but the game exposes a small debug surface
on `window.cozy` (the `Game` instance): `time.skipTo(hour)`,
`weather.set(kind, minutes, true)`, `warpTo(landmarkId)`, `landmarks`,
`inventory.addById(id)`, `museum.donate(id)` and `panelContext()`. Driving
those from Playwright is how the screenshots in review were produced.
