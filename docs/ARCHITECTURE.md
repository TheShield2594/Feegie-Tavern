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

## Gotchas worth knowing

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
