import { Group, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight } from 'three';
import type { EventBus } from '@/core/EventBus';
import { DECOR_BY_ID, type DecorDef } from '@/data/decor';
import type { PlacedDecorData } from '@/save/schema';
import { clamp01 } from '@/util/math';
import { disposeObject } from '@/util/three';
import { makeDecor } from './DecorModels';
import {
  SEA_LEVEL,
  addSurfacePatch,
  clearSurfacePatches,
  isWalkable,
  removeSurfacePatch,
  sampleSurface,
  terrainHeight,
} from './heightfield';

export interface PlacedDecor extends PlacedDecorData {
  group: Group;
  def: DecorDef;
  light: PointLight | null;
  glass: MeshStandardMaterial | null;
}

/** Placement grid, in metres. Coarser than the indoor half-metre: outdoors is bigger. */
export const OUTDOOR_GRID = 0.5;

/**
 * Everything the player has put down outdoors.
 *
 * The indoor equivalent, `HomeFurnishing`, places into a known rectangle with a
 * flat floor and a fixed set of walls. Outdoors there is no room: a piece has
 * to find its own ground height, refuse to stand in the sea or on a cliff, and
 * keep out of the way of the town that is already there. That, plus the fact
 * that paths have to change what the ground *is* rather than only what it looks
 * like, is why this is its own system rather than a second set of bounds on the
 * first one.
 */
export class Landscaping {
  readonly group = new Group();
  readonly pieces: PlacedDecor[] = [];

  /** The piece currently being carried, if in build mode. */
  editing: PlacedDecor | null = null;
  private ghost: Mesh;
  private nextUid = 1;

  /**
   * Extra circles a piece must keep out of — buildings, the pier, the town's
   * own props. Supplied by the game once the world is built, because this
   * system is constructed before any of it exists.
   */
  obstacles: { x: number; z: number; radius: number }[] = [];

  constructor(private bus: EventBus) {
    this.group.name = 'Landscaping';

    const ghostMaterial = new MeshStandardMaterial({
      color: 0x7fd6a8,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.ghost = new Mesh(new PlaneGeometry(1, 1), ghostMaterial);
    this.ghost.rotation.x = -Math.PI / 2;
    this.ghost.visible = false;
    this.ghost.userData.noFade = true;
    this.group.add(this.ghost);
  }

  // --- Placing -------------------------------------------------------------

  /**
   * Puts a piece down. Returns null when the model could not be built.
   *
   * Validity is *not* checked here: `place` is also how a save is restored, and
   * refusing a piece because a rule tightened since it was placed would quietly
   * delete somebody's garden.
   */
  place(defId: string, at: { x: number; z: number; rotation?: number; tint?: string; uid?: string }): PlacedDecor | null {
    const built = makeDecor(defId, at.tint);
    if (!built) return null;

    const piece: PlacedDecor = {
      uid: at.uid ?? `d_${Date.now().toString(36)}_${this.nextUid++}`,
      defId,
      x: at.x,
      z: at.z,
      rotation: at.rotation ?? 0,
      tint: at.tint,
      group: built.group,
      def: built.def,
      light: built.light,
      glass: built.glass,
    };

    built.group.position.set(piece.x, terrainHeight(piece.x, piece.z), piece.z);
    built.group.rotation.y = piece.rotation;
    this.group.add(built.group);
    this.pieces.push(piece);
    this.applyPatch(piece);
    return piece;
  }

  /** Takes a piece back up. Returns its definition id so the caller can refund it. */
  remove(uid: string): string | null {
    const index = this.pieces.findIndex((p) => p.uid === uid);
    if (index < 0) return null;
    const [piece] = this.pieces.splice(index, 1);
    if (this.editing === piece) {
      this.editing = null;
      this.ghost.visible = false;
    }
    removeSurfacePatch(piece.uid);
    this.group.remove(piece.group);
    disposeObject(piece.group);
    return piece.defId;
  }

  /** Nearest piece to a point, for the pick-up and take-away prompts. */
  nearest(x: number, z: number, radius = 2.2): PlacedDecor | null {
    let best: PlacedDecor | null = null;
    let bestDistance = radius * radius;
    for (const piece of this.pieces) {
      if (piece === this.editing) continue;
      const d = (piece.x - x) ** 2 + (piece.z - z) ** 2;
      if (d < bestDistance) {
        bestDistance = d;
        best = piece;
      }
    }
    return best;
  }

  // --- Build mode ----------------------------------------------------------

  /**
   * Conjures a new piece into the player's hands, unplaced.
   *
   * Every edit is a new piece. Moving one is taking it up — which refunds it in
   * full — and putting a fresh one where you wanted it, so there is no separate
   * "carry this existing thing" state to keep straight, and no pick-up radius
   * competing with the place button for the same press.
   */
  beginPlacing(defId: string, x: number, z: number, tint?: string): PlacedDecor | null {
    if (this.editing) return null;
    const piece = this.place(defId, { x, z, tint });
    if (!piece) return null;
    this.editing = piece;
    // A piece in hand paints nothing: a path tile being carried over the grass
    // should not make the grass sound like stone.
    removeSurfacePatch(piece.uid);
    const size = piece.def.radius * 2;
    this.ghost.scale.set(size, size, 1);
    this.ghost.visible = true;
    this.bus.emit('audio:sfx', { id: 'ui.select' });
    return piece;
  }

  /** Moves the carried piece to follow a point, snapping it to the grid. */
  updateEdit(targetX: number, targetZ: number): void {
    const piece = this.editing;
    if (!piece) return;

    const x = Math.round(targetX / OUTDOOR_GRID) * OUTDOOR_GRID;
    const z = Math.round(targetZ / OUTDOOR_GRID) * OUTDOOR_GRID;
    piece.x = x;
    piece.z = z;

    const ground = terrainHeight(x, z);
    // Held pieces float, exactly as they do indoors, so it is obvious which
    // one is in hand.
    piece.group.position.set(x, ground + 0.25, z);
    piece.group.rotation.y = piece.rotation;

    const valid = this.isValid(piece, x, z);
    this.ghost.position.set(x, ground + 0.04, z);
    this.ghost.rotation.z = -piece.rotation;
    (this.ghost.material as MeshStandardMaterial).color.set(valid ? 0x7fd6a8 : 0xd97a6a);
  }

  rotateEdit(): void {
    if (!this.editing) return;
    this.editing.rotation = (this.editing.rotation + Math.PI / 4) % (Math.PI * 2);
    this.editing.group.rotation.y = this.editing.rotation;
    this.bus.emit('audio:sfx', { id: 'ui.hover' });
  }

  /** Cycles the colourway of the carried piece, for the ones that have any. */
  cycleTint(): boolean {
    const piece = this.editing;
    if (!piece?.def.tints || piece.def.tints.length < 2) return false;
    const index = piece.def.tints.indexOf(piece.tint ?? piece.def.tints[0]);
    const tint = piece.def.tints[(index + 1) % piece.def.tints.length];
    const rebuilt = makeDecor(piece.defId, tint);
    if (!rebuilt) return false;
    this.group.remove(piece.group);
    disposeObject(piece.group);
    piece.group = rebuilt.group;
    piece.light = rebuilt.light;
    piece.glass = rebuilt.glass;
    piece.tint = tint;
    piece.group.position.set(piece.x, terrainHeight(piece.x, piece.z) + 0.25, piece.z);
    piece.group.rotation.y = piece.rotation;
    this.group.add(piece.group);
    this.bus.emit('audio:sfx', { id: 'ui.hover' });
    return true;
  }

  /** Sets the carried piece down. Returns false when the spot will not take it. */
  confirmEdit(): boolean {
    const piece = this.editing;
    if (!piece) return true;
    if (!this.isValid(piece, piece.x, piece.z)) {
      this.bus.emit('ui:toast', { text: "That won't go there.", tone: 'warn' });
      this.bus.emit('audio:sfx', { id: 'ui.error' });
      return false;
    }
    piece.group.position.y = terrainHeight(piece.x, piece.z);
    this.applyPatch(piece);
    this.editing = null;
    this.ghost.visible = false;
    this.bus.emit('audio:sfx', { id: 'item.pickup' });
    return true;
  }

  /**
   * Puts the carried piece back on the shelf. Returns its definition id so the
   * caller can hand back what it cost.
   */
  cancelEdit(): string | null {
    const piece = this.editing;
    if (!piece) return null;
    const defId = piece.defId;
    this.remove(piece.uid);
    this.bus.emit('audio:sfx', { id: 'ui.back' });
    return defId;
  }

  /**
   * Whether a piece may stand at a point.
   *
   * Four rules, in the order a player would discover them: on dry, level,
   * walkable ground; clear of the town; clear of the player's own other
   * pieces; and, for anything that is not a path, off the built surfaces the
   * island depends on being clear.
   */
  isValid(piece: PlacedDecor, x: number, z: number): boolean {
    const sample = sampleSurface(x, z);
    if (sample.height < SEA_LEVEL + 0.25) return false;
    if (sample.slope > 0.45) return false;
    if (!isWalkable(x, z)) return false;
    // Paths are laid *on* routes; everything else would block one.
    if (piece.def.kind !== 'path' && (sample.surface === 'plaza' || sample.surface === 'wood')) return false;

    for (const obstacle of this.obstacles) {
      const reach = obstacle.radius + piece.def.radius * 0.8;
      if ((obstacle.x - x) ** 2 + (obstacle.z - z) ** 2 < reach * reach) return false;
    }

    for (const other of this.pieces) {
      if (other === piece) continue;
      // Flat pieces stack under upright ones, so a bench can stand on a path.
      if (other.def.kind === 'path' || piece.def.kind === 'path') continue;
      const reach = other.def.radius + piece.def.radius;
      if ((other.x - x) ** 2 + (other.z - z) ** 2 < reach * reach * 0.64) return false;
    }

    return true;
  }

  /** Registers, or re-registers, the ground a path piece repaints. */
  private applyPatch(piece: PlacedDecor): void {
    if (!piece.def.surface) return;
    removeSurfacePatch(piece.uid);
    addSurfacePatch({
      id: piece.uid,
      x: piece.x,
      z: piece.z,
      radius: piece.def.radius,
      surface: piece.def.surface,
    });
  }

  // --- World interface -----------------------------------------------------

  /** Circles the player collides with, so a fence is a fence. */
  get colliders(): { x: number; z: number; radius: number }[] {
    return this.pieces
      .filter((p) => p.def.solid && p !== this.editing)
      .map((p) => ({ x: p.x, z: p.z, radius: p.def.radius * 0.75 }));
  }

  /** How much greenery the player has put in, for the island's rating. */
  get greeneryCount(): number {
    return this.pieces.filter((p) => p.def.greenery).length;
  }

  /** Garden lamps come on with the street lamps. */
  setLightLevel(darkness: number): void {
    const level = clamp01(darkness);
    for (const piece of this.pieces) {
      if (!piece.light) continue;
      piece.light.intensity = (piece.def.light?.intensity ?? 2) * level;
      if (piece.glass) piece.glass.emissiveIntensity = level;
    }
  }

  // --- Persistence ---------------------------------------------------------

  serialize(): PlacedDecorData[] {
    return this.pieces.map((p) => ({
      uid: p.uid,
      defId: p.defId,
      x: p.x,
      z: p.z,
      rotation: p.rotation,
      tint: p.tint,
    }));
  }

  load(data: PlacedDecorData[]): void {
    for (const piece of [...this.pieces]) this.remove(piece.uid);
    // The surface overlay is module state on the heightfield and this is its
    // only writer, so loading a different island starts it from empty rather
    // than trusting that every patch was unregistered on the way out.
    clearSurfacePatches();
    for (const raw of data) {
      if (!DECOR_BY_ID.has(raw.defId)) continue;
      this.place(raw.defId, { x: raw.x, z: raw.z, rotation: raw.rotation, tint: raw.tint, uid: raw.uid });
    }
  }

  dispose(): void {
    for (const piece of [...this.pieces]) this.remove(piece.uid);
    this.ghost.geometry.dispose();
    (this.ghost.material as MeshStandardMaterial).dispose();
  }
}
