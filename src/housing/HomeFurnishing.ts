import { Box3, Group, Mesh, MeshStandardMaterial, PlaneGeometry, PointLight, Vector3 } from 'three';
import type { EventBus } from '@/core/EventBus';
import { FURNITURE_BY_ID, type FurnitureDef } from '@/data/furniture';
import type { PlacedFurnitureData } from '@/save/schema';
import { clamp } from '@/util/math';
import { makeFurniture } from './FurnitureModels';

export interface PlacedPiece extends PlacedFurnitureData {
  group: Group;
  def: FurnitureDef;
  light: PointLight | null;
}

/** Placement grid size in metres. Furniture footprints are counted in cells. */
export const GRID = 0.5;

/**
 * Furniture in the player's cottage.
 *
 * Pieces snap to a half-metre grid, rotate in quarter turns, refuse to overlap,
 * and hug the wall when they are meant to. Decorating mode drives one piece at
 * a time with the same controls as the rest of the game.
 */
export class HomeFurnishing {
  readonly group = new Group();
  readonly pieces: PlacedPiece[] = [];

  /** The piece currently being moved, if decorating. */
  editing: PlacedPiece | null = null;
  private ghost: Mesh | null = null;
  private bounds = { minX: -3.5, maxX: 3.5, minZ: -3, maxZ: 3 };

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

  setBounds(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }): void {
    this.bounds = bounds;
  }

  /** Adds a piece, finding a free spot if none is given. */
  place(defId: string, at?: { x: number; z: number; rotation?: number }): PlacedPiece | null {
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
      y: 0,
      z: spot.z,
      rotation: spot.rotation ?? 0,
      room: 'main',
      group: built.group,
      def: built.def,
      light: built.light,
    };

    built.group.position.set(piece.x, piece.y, piece.z);
    built.group.rotation.y = piece.rotation;
    this.group.add(built.group);
    this.pieces.push(piece);
    this.bus.emit('audio:sfx', { id: 'item.pickup' });
    return piece;
  }

  remove(uid: string): string | null {
    const index = this.pieces.findIndex((p) => p.uid === uid);
    if (index < 0) return null;
    const [piece] = this.pieces.splice(index, 1);
    this.group.remove(piece.group);
    piece.group.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    return piece.defId;
  }

  /** Nearest piece to a point, for the "move this" prompt. */
  nearest(x: number, z: number, radius = 1.6): PlacedPiece | null {
    let best: PlacedPiece | null = null;
    let bestDist = radius * radius;
    for (const piece of this.pieces) {
      const d = (piece.x - x) ** 2 + (piece.z - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = piece;
      }
    }
    return best;
  }

  // --- Decorating ----------------------------------------------------------

  beginEdit(piece: PlacedPiece): void {
    this.editing = piece;
    if (this.ghost) {
      const size = this.footprintMetres(piece.def);
      this.ghost.scale.set(size.w, size.d, 1);
      this.ghost.visible = true;
    }
    // Lift the piece slightly so it reads as "held".
    piece.group.position.y = 0.28;
    this.bus.emit('audio:sfx', { id: 'ui.select' });
  }

  /** Moves the held piece to follow a target point, snapping to the grid. */
  updateEdit(targetX: number, targetZ: number): void {
    const piece = this.editing;
    if (!piece) return;

    const size = this.footprintMetres(piece.def);
    const rotated = this.rotatedSize(size, piece.rotation);

    let x = Math.round(targetX / GRID) * GRID;
    let z = Math.round(targetZ / GRID) * GRID;
    x = clamp(x, this.bounds.minX + rotated.w / 2, this.bounds.maxX - rotated.w / 2);
    z = clamp(z, this.bounds.minZ + rotated.d / 2, this.bounds.maxZ - rotated.d / 2);

    // Wall-mounted pieces snap flat against the nearest wall.
    if (piece.def.surface === 'wall') {
      const toBack = Math.abs(z - this.bounds.minZ);
      const toLeft = Math.abs(x - this.bounds.minX);
      const toRight = Math.abs(x - this.bounds.maxX);
      const nearest = Math.min(toBack, toLeft, toRight);
      if (nearest === toBack) { z = this.bounds.minZ + 0.2; piece.rotation = 0; }
      else if (nearest === toLeft) { x = this.bounds.minX + 0.2; piece.rotation = Math.PI / 2; }
      else { x = this.bounds.maxX - 0.2; piece.rotation = -Math.PI / 2; }
    }

    piece.x = x;
    piece.z = z;
    piece.group.position.set(x, piece.def.surface === 'wall' ? 0 : 0.18, z);
    piece.group.rotation.y = piece.rotation;

    const valid = this.isFree(piece, x, z);
    if (this.ghost) {
      this.ghost.position.set(x, 0.02, z);
      this.ghost.rotation.z = -piece.rotation;
      this.ghost.scale.set(rotated.w, rotated.d, 1);
      (this.ghost.material as MeshStandardMaterial).color.set(valid ? 0x7fd6a8 : 0xd97a6a);
    }
  }

  rotateEdit(): void {
    if (!this.editing) return;
    this.editing.rotation = (this.editing.rotation + Math.PI / 2) % (Math.PI * 2);
    this.editing.group.rotation.y = this.editing.rotation;
    this.bus.emit('audio:sfx', { id: 'ui.hover' });
  }

  /** Drops the held piece. Returns false when the spot is blocked. */
  confirmEdit(): boolean {
    const piece = this.editing;
    if (!piece) return true;
    if (!this.isFree(piece, piece.x, piece.z)) {
      this.bus.emit('ui:toast', { text: "That won't fit there.", tone: 'warn' });
      this.bus.emit('audio:sfx', { id: 'ui.error' });
      return false;
    }
    piece.group.position.y = 0;
    this.editing = null;
    if (this.ghost) this.ghost.visible = false;
    this.bus.emit('audio:sfx', { id: 'ui.select' });
    return true;
  }

  cancelEdit(): void {
    if (!this.editing) return;
    this.editing.group.position.y = 0;
    this.editing = null;
    if (this.ghost) this.ghost.visible = false;
  }

  private footprintMetres(def: FurnitureDef): { w: number; d: number } {
    return { w: def.footprint.w * GRID, d: def.footprint.d * GRID };
  }

  private rotatedSize(size: { w: number; d: number }, rotation: number): { w: number; d: number } {
    const quarterTurns = Math.round(rotation / (Math.PI / 2)) % 2;
    return quarterTurns === 0 ? size : { w: size.d, d: size.w };
  }

  private isFree(piece: PlacedPiece, x: number, z: number): boolean {
    const a = this.rotatedSize(this.footprintMetres(piece.def), piece.rotation);
    for (const other of this.pieces) {
      if (other === piece) continue;
      // Rugs sit under everything, so they never block a placement.
      if (other.def.kind === 'rug' || piece.def.kind === 'rug') continue;
      const b = this.rotatedSize(this.footprintMetres(other.def), other.rotation);
      const overlapX = Math.abs(other.x - x) < (a.w + b.w) / 2 - 0.05;
      const overlapZ = Math.abs(other.z - z) < (a.d + b.d) / 2 - 0.05;
      if (overlapX && overlapZ) return false;
    }
    return true;
  }

  /** Circles the player collides with, so furniture is solid. */
  get colliders(): { x: number; z: number; radius: number }[] {
    return this.pieces
      .filter((p) => p.def.kind !== 'rug' && p !== this.editing)
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
    box.setFromCenterAndSize(
      new Vector3(0, 1, 0),
      new Vector3(this.bounds.maxX - this.bounds.minX, 3, this.bounds.maxZ - this.bounds.minZ),
    );
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
    for (const raw of data) {
      if (!FURNITURE_BY_ID.has(raw.defId)) continue;
      this.place(raw.defId, { x: raw.x, z: raw.z, rotation: raw.rotation });
    }
  }

  private findFreeSpot(def: FurnitureDef): { x: number; z: number; rotation?: number } | null {
    const size = this.footprintMetres(def);
    for (let z = this.bounds.minZ + size.d / 2; z <= this.bounds.maxZ - size.d / 2; z += GRID) {
      for (let x = this.bounds.minX + size.w / 2; x <= this.bounds.maxX - size.w / 2; x += GRID) {
        // Leave the doorway clear so the player never materialises inside a sofa.
        if (z > this.bounds.maxZ - 2.2 && Math.abs(x) < 1.6) continue;
        const probe = { def, rotation: 0, x, z } as PlacedPiece;
        if (this.isFree(probe, x, z)) return { x: Math.round(x / GRID) * GRID, z: Math.round(z / GRID) * GRID };
      }
    }
    return null;
  }
}
