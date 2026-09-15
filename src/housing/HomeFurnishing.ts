import { Box3, Group, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight, Vector3 } from 'three';
import type { EventBus } from '@/core/EventBus';
import { FURNITURE_BY_ID, type FurnitureDef } from '@/data/furniture';
import type { PlacedFurnitureData } from '@/save/schema';
import { clamp } from '@/util/math';
import { disposeObject } from '@/util/three';
import { makeFurniture } from './FurnitureModels';

export interface PlacedPiece extends PlacedFurnitureData {
  group: Group;
  def: FurnitureDef;
  light: PointLight | null;
  /** The piece this one is resting on, when it sits on a tabletop. */
  supportedBy: string | null;
}

/** Placement grid size in metres. Furniture footprints are counted in cells. */
export const GRID = 0.5;

/**
 * Two pieces only fight for space when they are on the same level, and heights
 * come out of floating-point arithmetic rather than a fixed ladder, so "the
 * same level" is a tolerance rather than an equality.
 */
const LEVEL_EPSILON = 0.12;

/** How far inside a supporting piece's footprint a small item's centre has to sit. */
const SUPPORT_INSET = 0.12;

/** How high a held piece floats above where it would land. */
const HELD_LIFT = 0.28;

/** Fallback surface height for a supporting piece that does not declare one. */
const DEFAULT_SURFACE_HEIGHT = 0.75;

/** One room of the home, as far as furniture placement is concerned. */
export interface FurnishingRoom {
  id: string;
  /** Where furniture may go, in the home's own local metres. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Height of this room's floor, so a loft's furniture stands on the loft. */
  floorY: number;
  /** Stretches of floor to leave alone — doorways, mainly. */
  keepClear: { minX: number; maxX: number; minZ: number; maxZ: number }[];
}

const DEFAULT_ROOM: FurnishingRoom = {
  id: 'main',
  bounds: { minX: -3.5, maxX: 3.5, minZ: -3, maxZ: 3 },
  floorY: 0,
  keepClear: [],
};

/**
 * Furniture in the player's cottage.
 *
 * Pieces snap to a half-metre grid, rotate in quarter turns, refuse to overlap,
 * and hug the wall when they are meant to. A home with more than one room keeps
 * one set of pieces per room: every piece names the room it is in, and a piece
 * carried through a doorway changes hands as it crosses.
 *
 * Small pieces stack: a lamp put down
 * over a table takes the table's surface instead of the floor, and from then on
 * it is the table's passenger — it travels with it and is stored with it.
 * Decorating mode drives one piece at a time with the same controls as the rest
 * of the game.
 */
export class HomeFurnishing {
  readonly group = new Group();
  readonly pieces: PlacedPiece[] = [];

  /** The piece currently being moved, if decorating. */
  editing: PlacedPiece | null = null;
  private ghost: Mesh | null = null;
  private rooms: FurnishingRoom[] = [DEFAULT_ROOM];

  constructor(private bus: EventBus) {
    this.group.name = 'HomeFurniture';

    const ghostMaterial = new MeshStandardMaterial({
      color: 0x7fd6a8,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    this.ghost = new Mesh(new PlaneGeometry(1, 1), ghostMaterial);
    this.ghost.rotation.x = -Math.PI / 2;
    this.ghost.position.y = 0.02;
    this.ghost.visible = false;
    this.group.add(this.ghost);
  }

  /**
   * Tells the furnishing which rooms the cottage has. Called whenever the plan
   * changes — on load, and when an upgrade adds a room.
   */
  setRooms(rooms: FurnishingRoom[]): void {
    this.rooms = rooms.length > 0 ? rooms : [DEFAULT_ROOM];
    // A room may have grown, or gone; settle everything back inside one.
    for (const piece of this.pieces) this.reseat(piece);
  }

  /** The room a piece belongs to, falling back to the first. */
  private roomOf(id: string): FurnishingRoom {
    return this.rooms.find((room) => room.id === id) ?? this.rooms[0];
  }

  /** The room a point is in, or the nearest one when it is between them. */
  private roomAt(x: number, z: number): FurnishingRoom {
    let nearest = this.rooms[0];
    let bestDistance = Infinity;
    for (const room of this.rooms) {
      const b = room.bounds;
      const dx = Math.max(b.minX - x, 0, x - b.maxX);
      const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      const distance = dx * dx + dz * dz;
      if (distance === 0) return room;
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = room;
      }
    }
    return nearest;
  }

  /** Height of a piece above the home's floor, its room's own floor included. */
  private worldY(piece: PlacedPiece): number {
    return this.roomOf(piece.room).floorY + piece.y;
  }

  /** Puts a piece back inside its room, for when the plan has changed under it. */
  private reseat(piece: PlacedPiece): void {
    if (!this.rooms.some((room) => room.id === piece.room)) {
      const spot = this.findFreeSpot(piece.def);
      if (spot) {
        piece.room = spot.room;
        piece.x = spot.x;
        piece.z = spot.z;
        piece.y = 0;
        piece.supportedBy = null;
      } else {
        piece.room = this.rooms[0].id;
      }
    }
    const b = this.roomOf(piece.room).bounds;
    const size = this.rotatedSize(this.footprintMetres(piece.def), piece.rotation);
    piece.x = clamp(piece.x, b.minX + size.w / 2, Math.max(b.minX + size.w / 2, b.maxX - size.w / 2));
    piece.z = clamp(piece.z, b.minZ + size.d / 2, Math.max(b.minZ + size.d / 2, b.maxZ - size.d / 2));
    piece.group.position.set(piece.x, this.worldY(piece), piece.z);
  }

  /** Adds a piece, finding a free spot if none is given. */
  place(defId: string, at?: { x: number; z: number; y?: number; rotation?: number; room?: string }): PlacedPiece | null {
    const built = makeFurniture(defId);
    if (!built) return null;

    const spot = at ?? this.findFreeSpot(built.def);
    if (!spot) {
      this.bus.emit('ui:toast', { text: 'No room for that in here yet.', tone: 'warn' });
      return null;
    }

    const piece: PlacedPiece = {
      uid: `f_${Date.now().toString(36)}_${this.pieces.length}`,
      defId,
      x: spot.x,
      y: spot.y ?? 0,
      z: spot.z,
      rotation: spot.rotation ?? 0,
      room: spot.room ?? this.roomAt(spot.x, spot.z).id,
      group: built.group,
      def: built.def,
      light: built.light,
      supportedBy: null,
    };

    built.group.position.set(piece.x, this.worldY(piece), piece.z);
    built.group.rotation.y = piece.rotation;
    this.group.add(built.group);
    this.pieces.push(piece);
    this.bus.emit('audio:sfx', { id: 'item.pickup' });
    return piece;
  }

  /**
   * Takes a piece away, along with anything resting on it — clearing a table
   * cannot leave a lamp hanging in the air. Returns every definition removed,
   * so the caller can hand them all back.
   */
  remove(uid: string): string[] {
    const index = this.pieces.findIndex((p) => p.uid === uid);
    if (index < 0) return [];

    const removed: string[] = [];
    for (const passenger of this.passengersOf(uid)) removed.push(...this.remove(passenger.uid));

    // The recursion above only touched passengers, so this piece is still
    // there — but its index has moved.
    const at = this.pieces.findIndex((p) => p.uid === uid);
    const [piece] = this.pieces.splice(at, 1);
    if (this.editing === piece) {
      this.editing = null;
      this.editOrigin = null;
      this.carried = [];
      if (this.ghost) this.ghost.visible = false;
    }
    this.group.remove(piece.group);
    disposeObject(piece.group);
    removed.push(piece.defId);
    return removed;
  }

  /** The pieces resting on a given piece. */
  passengersOf(uid: string): PlacedPiece[] {
    return this.pieces.filter((p) => p.supportedBy === uid);
  }

  /**
   * Nearest piece to a point, for the "move this" prompt. A piece standing on
   * another is preferred where both are equally close, so the lamp in the
   * middle of a table can be picked up rather than being shadowed by it.
   */
  nearest(x: number, z: number, radius = 1.6): PlacedPiece | null {
    let best: PlacedPiece | null = null;
    let bestDist = radius * radius;
    for (const piece of this.pieces) {
      const d = (piece.x - x) ** 2 + (piece.z - z) ** 2;
      if (d > bestDist) continue;
      if (best && d > bestDist - 1e-6 && piece.y <= best.y) continue;
      bestDist = d;
      best = piece;
    }
    return best;
  }

  // --- Levels and support --------------------------------------------------

  /** Height of the surface a piece offers, or null when nothing may sit on it. */
  private surfaceTopOf(piece: PlacedPiece): number | null {
    if (!piece.def.supportsTabletop) return null;
    return piece.y + (piece.def.surfaceHeight ?? DEFAULT_SURFACE_HEIGHT);
  }

  /**
   * The piece a small item put down at this point would come to rest on: the
   * highest surface whose footprint the point sits comfortably inside.
   */
  private supportAt(x: number, z: number, ignore: PlacedPiece): PlacedPiece | null {
    let best: PlacedPiece | null = null;
    let bestTop = -Infinity;
    for (const other of this.pieces) {
      if (other === ignore || other.supportedBy === ignore.uid) continue;
      if (other.room !== ignore.room) continue;
      const top = this.surfaceTopOf(other);
      if (top === null || top <= bestTop) continue;
      const size = this.rotatedSize(this.footprintMetres(other.def), other.rotation);
      if (Math.abs(other.x - x) > size.w / 2 - SUPPORT_INSET) continue;
      if (Math.abs(other.z - z) > size.d / 2 - SUPPORT_INSET) continue;
      best = other;
      bestTop = top;
    }
    return best;
  }

  // --- Decorating ----------------------------------------------------------

  beginEdit(piece: PlacedPiece): void {
    this.editing = piece;
    // Remembered so a cancelled edit puts the piece back where it started
    // rather than leaving the half-finished move committed.
    this.editOrigin = { x: piece.x, y: piece.y, z: piece.z, rotation: piece.rotation, room: piece.room, supportedBy: piece.supportedBy };
    // Whatever is standing on it travels with it, held in the piece's own frame
    // so a quarter turn carries its passengers round with it.
    this.carried = this.passengersOf(piece.uid).map((passenger) => {
      const local = rotateOffset(passenger.x - piece.x, passenger.z - piece.z, -piece.rotation);
      return { piece: passenger, localX: local.x, localZ: local.z, localRotation: passenger.rotation - piece.rotation };
    });
    if (this.ghost) {
      const size = this.footprintMetres(piece.def);
      this.ghost.scale.set(size.w, size.d, 1);
      this.ghost.visible = true;
    }
    // Lift the piece slightly so it reads as "held".
    piece.group.position.y = this.worldY(piece) + HELD_LIFT;
    for (const rider of this.carried) rider.piece.group.position.y = this.worldY(rider.piece) + HELD_LIFT;
    this.bus.emit('audio:sfx', { id: 'ui.select' });
  }

  /** Moves the held piece to follow a target point, snapping to the grid. */
  updateEdit(targetX: number, targetZ: number): void {
    const piece = this.editing;
    if (!piece) return;

    const size = this.footprintMetres(piece.def);
    const rotated = this.rotatedSize(size, piece.rotation);

    // The piece belongs to whichever room the player has carried it into.
    const room = this.roomAt(targetX, targetZ);
    piece.room = room.id;
    const bounds = room.bounds;

    let x = Math.round(targetX / GRID) * GRID;
    let z = Math.round(targetZ / GRID) * GRID;
    x = clamp(x, bounds.minX + rotated.w / 2, bounds.maxX - rotated.w / 2);
    z = clamp(z, bounds.minZ + rotated.d / 2, bounds.maxZ - rotated.d / 2);

    // Wall-mounted pieces snap flat against the nearest wall.
    if (piece.def.surface === 'wall') {
      const toBack = Math.abs(z - bounds.minZ);
      const toLeft = Math.abs(x - bounds.minX);
      const toRight = Math.abs(x - bounds.maxX);
      const nearest = Math.min(toBack, toLeft, toRight);
      if (nearest === toBack) { z = bounds.minZ + 0.2; piece.rotation = 0; }
      else if (nearest === toLeft) { x = bounds.minX + 0.2; piece.rotation = Math.PI / 2; }
      else { x = bounds.maxX - 0.2; piece.rotation = -Math.PI / 2; }
    }

    // A small piece takes whatever surface is under the cursor, and the floor
    // when there is none.
    const support = piece.def.surface === 'tabletop' ? this.supportAt(x, z, piece) : null;
    piece.supportedBy = support?.uid ?? null;
    piece.y = support ? this.surfaceTopOf(support)! : 0;

    piece.x = x;
    piece.z = z;
    const resting = this.worldY(piece);
    // Floor pieces float while carried; wall fittings stay put against their wall.
    piece.group.position.set(x, piece.def.surface === 'wall' ? resting : resting + HELD_LIFT, z);
    piece.group.rotation.y = piece.rotation;
    this.followCarried();

    const valid = this.isFree(piece, x, z, piece.y);
    if (this.ghost) {
      this.ghost.position.set(x, resting + 0.02, z);
      this.ghost.rotation.z = -piece.rotation;
      this.ghost.scale.set(rotated.w, rotated.d, 1);
      (this.ghost.material as MeshStandardMaterial).color.set(valid ? 0x7fd6a8 : 0xd97a6a);
    }
  }

  rotateEdit(): void {
    if (!this.editing) return;
    this.editing.rotation = (this.editing.rotation + Math.PI / 2) % (Math.PI * 2);
    this.editing.group.rotation.y = this.editing.rotation;
    this.followCarried();
    this.bus.emit('audio:sfx', { id: 'ui.hover' });
  }

  /** Drops the held piece. Returns false when the spot is blocked. */
  confirmEdit(): boolean {
    const piece = this.editing;
    if (!piece) return true;
    if (!this.isFree(piece, piece.x, piece.z, piece.y)) {
      this.bus.emit('ui:toast', { text: "That won't fit there.", tone: 'warn' });
      this.bus.emit('audio:sfx', { id: 'ui.error' });
      return false;
    }
    piece.group.position.y = this.worldY(piece);
    for (const rider of this.carried) rider.piece.group.position.y = this.worldY(rider.piece);
    this.editing = null;
    this.editOrigin = null;
    this.carried = [];
    if (this.ghost) this.ghost.visible = false;
    this.bus.emit('audio:sfx', { id: 'ui.select' });
    return true;
  }

  cancelEdit(): void {
    const piece = this.editing;
    if (!piece) return;
    if (this.editOrigin) {
      piece.x = this.editOrigin.x;
      piece.y = this.editOrigin.y;
      piece.z = this.editOrigin.z;
      piece.rotation = this.editOrigin.rotation;
      piece.room = this.editOrigin.room;
      piece.supportedBy = this.editOrigin.supportedBy;
    }
    piece.group.position.set(piece.x, this.worldY(piece), piece.z);
    piece.group.rotation.y = piece.rotation;
    this.followCarried();
    for (const rider of this.carried) rider.piece.group.position.y = this.worldY(rider.piece);
    this.editing = null;
    this.editOrigin = null;
    this.carried = [];
    if (this.ghost) this.ghost.visible = false;
    this.bus.emit('audio:sfx', { id: 'ui.back' });
  }

  private editOrigin: { x: number; y: number; z: number; rotation: number; room: string; supportedBy: string | null } | null = null;
  /** Pieces riding on the one being moved, in its local frame. */
  private carried: { piece: PlacedPiece; localX: number; localZ: number; localRotation: number }[] = [];

  /** Keeps the held piece's passengers on top of it as it moves and turns. */
  private followCarried(): void {
    const support = this.editing;
    if (!support || this.carried.length === 0) return;
    const top = this.surfaceTopOf(support);
    const held = support.def.surface === 'wall' ? 0 : HELD_LIFT;
    for (const rider of this.carried) {
      const offset = rotateOffset(rider.localX, rider.localZ, support.rotation);
      rider.piece.x = support.x + offset.x;
      rider.piece.z = support.z + offset.z;
      rider.piece.y = top ?? support.y;
      rider.piece.room = support.room;
      rider.piece.rotation = rider.localRotation + support.rotation;
      rider.piece.group.rotation.y = rider.piece.rotation;
      rider.piece.group.position.set(rider.piece.x, this.worldY(rider.piece) + held, rider.piece.z);
    }
  }

  private footprintMetres(def: FurnitureDef): { w: number; d: number } {
    return { w: def.footprint.w * GRID, d: def.footprint.d * GRID };
  }

  private rotatedSize(size: { w: number; d: number }, rotation: number): { w: number; d: number } {
    const quarterTurns = Math.round(rotation / (Math.PI / 2)) % 2;
    return quarterTurns === 0 ? size : { w: size.d, d: size.w };
  }

  /**
   * Whether a piece fits at a spot. Overlap is tested per level, so a lamp
   * standing on a table is not fighting the table for the same square metre.
   */
  private isFree(piece: PlacedPiece, x: number, z: number, y = piece.y): boolean {
    const a = this.rotatedSize(this.footprintMetres(piece.def), piece.rotation);

    // A doorway is not somewhere to put a sofa, however much space is free.
    if (piece.def.kind !== 'rug') {
      for (const keep of this.roomOf(piece.room).keepClear) {
        if (Math.abs(x - (keep.minX + keep.maxX) / 2) >= (a.w + keep.maxX - keep.minX) / 2) continue;
        if (Math.abs(z - (keep.minZ + keep.maxZ) / 2) >= (a.d + keep.maxZ - keep.minZ) / 2) continue;
        return false;
      }
    }

    for (const other of this.pieces) {
      if (other === piece) continue;
      // Rooms are separate sets; nothing in one can be in another's way.
      if (other.room !== piece.room) continue;
      // The piece it is standing on, and anything travelling with it, are not
      // in its way.
      if (other.uid === piece.supportedBy || other.supportedBy === piece.uid) continue;
      if (Math.abs(other.y - y) > LEVEL_EPSILON) continue;
      // Rugs sit under everything, so they never block a placement.
      if (other.def.kind === 'rug' || piece.def.kind === 'rug') continue;
      const b = this.rotatedSize(this.footprintMetres(other.def), other.rotation);
      const overlapX = Math.abs(other.x - x) < (a.w + b.w) / 2 - 0.05;
      const overlapZ = Math.abs(other.z - z) < (a.d + b.d) / 2 - 0.05;
      if (overlapX && overlapZ) return false;
    }
    return true;
  }

  /**
   * Circles the player collides with, so furniture is solid. A piece up on a
   * table is already behind the table's own collider and adds nothing but a
   * snag at head height.
   */
  get colliders(): { x: number; z: number; radius: number }[] {
    return this.pieces
      .filter((p) => p.def.kind !== 'rug' && p !== this.editing && p.supportedBy === null)
      .map((p) => {
        const size = this.rotatedSize(this.footprintMetres(p.def), p.rotation);
        return { x: p.x, z: p.z, radius: Math.max(size.w, size.d) * 0.42 };
      });
  }

  /** Lamps come on with the room's evening lighting. */
  setLightLevel(level: number): void {
    for (const piece of this.pieces) {
      if (piece.light) piece.light.intensity = (piece.def.light?.intensity ?? 2) * level;
    }
  }

  get cosiness(): number {
    return this.pieces.reduce((sum, p) => sum + p.def.cosiness, 0);
  }

  bounds3(): Box3 {
    const box = new Box3();
    for (const room of this.rooms) {
      box.expandByPoint(new Vector3(room.bounds.minX, room.floorY, room.bounds.minZ));
      box.expandByPoint(new Vector3(room.bounds.maxX, room.floorY + 3, room.bounds.maxZ));
    }
    return box;
  }

  serialize(): PlacedFurnitureData[] {
    return this.pieces.map((p) => ({
      uid: p.uid,
      defId: p.defId,
      x: p.x,
      y: p.y,
      z: p.z,
      rotation: p.rotation,
      room: p.room,
    }));
  }

  load(data: PlacedFurnitureData[]): void {
    for (const piece of [...this.pieces]) this.remove(piece.uid);
    // Floors first: a piece cannot find the table it stands on until the table
    // is in the room.
    const ordered = [...data].sort((a, b) => a.y - b.y);
    for (const raw of ordered) {
      if (!FURNITURE_BY_ID.has(raw.defId)) continue;
      const placed = this.place(raw.defId, { x: raw.x, y: raw.y, z: raw.z, rotation: raw.rotation, room: raw.room });
      // A piece saved in a room this cottage does not have yet — or no longer
      // has — is found a spot rather than dropped.
      if (placed) this.reseat(placed);
    }
    this.resolveSupports();
  }

  /**
   * Re-links stacked pieces to what they are standing on. Support is a fact
   * about the layout rather than a field of its own, so it is recovered from
   * the geometry on load instead of being written to the save.
   */
  private resolveSupports(): void {
    for (const piece of this.pieces) {
      piece.supportedBy = null;
      if (piece.def.surface !== 'tabletop' || piece.y <= LEVEL_EPSILON) continue;
      const support = this.supportAt(piece.x, piece.z, piece);
      if (!support) {
        // Whatever held it up is gone; put it back on the floor rather than
        // leaving it hanging.
        piece.y = 0;
        piece.group.position.y = this.worldY(piece);
        continue;
      }
      piece.supportedBy = support.uid;
      piece.y = this.surfaceTopOf(support)!;
      piece.group.position.y = this.worldY(piece);
    }
  }

  /** The first free square metre, searching the rooms in plan order. */
  private findFreeSpot(def: FurnitureDef): { x: number; z: number; y?: number; rotation?: number; room: string } | null {
    const size = this.footprintMetres(def);
    for (const room of this.rooms) {
      const b = room.bounds;
      for (let z = b.minZ + size.d / 2; z <= b.maxZ - size.d / 2; z += GRID) {
        for (let x = b.minX + size.w / 2; x <= b.maxX - size.w / 2; x += GRID) {
          const probe = { def, rotation: 0, x, z, y: 0, room: room.id, supportedBy: null } as PlacedPiece;
          if (this.isFree(probe, x, z, 0)) {
            return { x: Math.round(x / GRID) * GRID, z: Math.round(z / GRID) * GRID, room: room.id };
          }
        }
      }
    }
    return null;
  }
}

/** Rotates a horizontal offset by a yaw angle, matching Object3D.rotation.y. */
function rotateOffset(x: number, z: number, angle: number): { x: number; z: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: x * cos + z * sin, z: -x * sin + z * cos };
}
