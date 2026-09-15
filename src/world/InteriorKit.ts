import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  CanvasTexture,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
} from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import { PALETTE } from '@/rendering/palette';
import { makeWindow, roundedBoxGeometry, surfaces } from './BuildingKit';

/** Which wall of a room an opening is cut into, named from inside it. */
export type RoomSide = 'front' | 'back' | 'left' | 'right';

/** A gap cut through one wall, either the front door or a way into another room. */
export interface RoomOpening {
  side: RoomSide;
  /** Centre of the gap along the wall, in metres from the wall's middle. */
  offset?: number;
  width?: number;
}

export interface RoomOptions {
  width: number;
  depth: number;
  height?: number;
  floor?: 'plank' | 'tile' | 'rug' | 'stone' | 'polished';
  wallColor?: string;
  trimColor?: string;
  /** Windows along the +Z (front) wall. */
  windows?: number;
  /** A doorway gap in the +Z wall, at local x = 0. */
  doorway?: boolean;
  doorwayWidth?: number;
  /**
   * Further gaps cut through any wall — the ways between the rooms of a
   * multi-room home. Unlike the front door these get no daylight threshold,
   * because there is no daylight on the other side of them.
   */
  openings?: RoomOpening[];
  /**
   * Windows are skipped on any wall carrying an interior opening, so a back
   * room's doorway is not competing with a window for the same stretch of wall.
   */
  /** Warm ceiling lights. */
  lights?: { x: number; z: number; color?: string; intensity?: number }[];
  /** The room's floor height, for a raised room such as a loft. */
  floorY?: number;
  /**
   * Draws the plinth and skirt that ground a room seen from outside. Off for a
   * room that is stacked on another, where they would hang in mid-air.
   */
  plinth?: boolean;
  name?: string;
}

export interface RoomWall {
  /** Every mesh belonging to this wall, including its trim. */
  parts: Mesh[];
  /** Outward normal, pointing away from the room's centre. */
  nx: number;
  nz: number;
}

/**
 * A rectangle of walkable floor inside an interior.
 *
 * One room is one region, and the ways between rooms are regions of their own
 * that overlap the rooms at either end, so a player crossing a threshold is
 * always inside at least one of them. A region that ramps carries the floor up
 * with it, which is what makes a staircase walkable.
 */
export interface FloorRegion {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Floor height throughout, or at the foot of a ramp. */
  floorY: number;
  ramp?: {
    axis: 'x' | 'z';
    /** Coordinate where the climb starts, at `floorY`. */
    from: number;
    /** Coordinate where it ends, at `toY`. */
    to: number;
    toY: number;
  };
}

/** Floor height at a point in a region, following its ramp if it has one. */
export function regionFloorY(region: FloorRegion, x: number, z: number): number {
  const ramp = region.ramp;
  if (!ramp) return region.floorY;
  const span = ramp.to - ramp.from;
  if (Math.abs(span) < 1e-6) return ramp.toY;
  const t = Math.min(1, Math.max(0, ((ramp.axis === 'x' ? x : z) - ramp.from) / span));
  return region.floorY + (ramp.toY - region.floorY) * t;
}

export interface BuiltRoom {
  group: Group;
  /** The four walls, so the camera can drop whichever one it is behind. */
  walls: RoomWall[];
  /** Interior walkable bounds, in local space. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Where the player appears when entering. */
  entry: Vector3;
  /** Where the exit prompt lives. */
  exit: Vector3;
  windowGlass: MeshStandardMaterial[];
  lights: PointLight[];
  floorY: number;
}

const WALL_THICKNESS = 0.3;
/** Height of every door opening, inside and out. */
const DOOR_HEIGHT = 2.5;
/** Width of a doorway between two rooms when the caller does not say. */
const DEFAULT_INNER_DOOR_WIDTH = 1.8;

function makeFloorTexture(kind: NonNullable<RoomOptions['floor']>): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  switch (kind) {
    case 'tile': {
      ctx.fillStyle = '#e8e2d4';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#d6cec0';
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          if ((x + y) % 2 === 0) ctx.fillRect(x * 64, y * 64, 64, 64);
        }
      }
      ctx.strokeStyle = 'rgba(120,110,95,0.35)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 256);
        ctx.moveTo(0, i * 64); ctx.lineTo(256, i * 64);
        ctx.stroke();
      }
      break;
    }
    case 'stone': {
      ctx.fillStyle = '#c9c2b4';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(95,90,80,0.4)';
      ctx.lineWidth = 3;
      for (let row = 0; row < 5; row++) {
        const y = row * 52;
        ctx.beginPath();
        ctx.moveTo(0, y); ctx.lineTo(256, y);
        ctx.stroke();
        const offset = row % 2 === 0 ? 0 : 42;
        for (let x = offset; x < 256; x += 84) {
          ctx.beginPath();
          ctx.moveTo(x, y); ctx.lineTo(x, y + 52);
          ctx.stroke();
        }
      }
      break;
    }
    case 'polished': {
      const g = ctx.createLinearGradient(0, 0, 256, 256);
      g.addColorStop(0, '#3f4a55');
      g.addColorStop(0.5, '#4d5a66');
      g.addColorStop(1, '#38424c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * 52); ctx.lineTo(256, i * 52);
        ctx.stroke();
      }
      break;
    }
    case 'rug':
    case 'plank':
    default: {
      ctx.fillStyle = '#c9a271';
      ctx.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 8; row++) {
        // Vary each board so the floor is not a repeating stripe.
        const shade = 190 + ((row * 37) % 40);
        ctx.fillStyle = `rgb(${shade}, ${shade - 40}, ${shade - 85})`;
        ctx.fillRect(0, row * 32, 256, 30);
        ctx.strokeStyle = 'rgba(90,60,35,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, row * 32 + 31);
        ctx.lineTo(256, row * 32 + 31);
        ctx.stroke();
        const seam = ((row * 91) % 200) + 20;
        ctx.beginPath();
        ctx.moveTo(seam, row * 32);
        ctx.lineTo(seam, row * 32 + 31);
        ctx.stroke();
      }
      break;
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/**
 * Builds a walkable room shell: floor, four walls with a doorway, skirting,
 * windows and ceiling lights. Every interior in the game starts here, which is
 * what keeps them consistent without hand-modelling each one.
 */
export function buildRoom(options: RoomOptions): BuiltRoom {
  const {
    width,
    depth,
    height = 3.6,
    floor = 'plank',
    wallColor = PALETTE.plaster.cream,
    trimColor = PALETTE.plaster.white,
    windows = 2,
    doorway = true,
    doorwayWidth = 2.0,
    openings = [],
    lights = [],
    floorY = 0,
    plinth = true,
    name = 'Room',
  } = options;

  const group = new Group();
  group.name = `Interior_${name}`;

  const halfW = width / 2;
  const halfD = depth / 2;

  // --- Floor ---------------------------------------------------------------
  const floorTexture = makeFloorTexture(floor);
  floorTexture.repeat.set(width / 3, depth / 3);
  const floorMaterial = new MeshStandardMaterial({
    map: floorTexture,
    roughness: floor === 'polished' ? 0.28 : 0.86,
    metalness: floor === 'polished' ? 0.12 : 0,
  });
  const floorMesh = new Mesh(new PlaneGeometry(width, depth), floorMaterial);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  floorMesh.userData.noFade = true;
  group.add(floorMesh);

  // --- Walls ---------------------------------------------------------------
  const trimMaterial = createStylizedMaterial({ color: trimColor, roughness: 0.85 });
  const windowGlass: MeshStandardMaterial[] = [];

  const walls: RoomWall[] = [];

  /** One run of wall between two gaps, or a whole wall when there are none. */
  const addSegment = (parts: Mesh[], length: number, x: number, z: number, rotation: number) => {
    if (length <= 0.001) return;
    // Each wall gets its own material so one can be dimmed or hidden alone.
    // A rounded-box rather than a BoxGeometry: its UVs are in metres, so the
    // plaster grain tiles at one density on a 7 m cottage wall and a 36 m hall.
    const wall = new Mesh(roundedBoxGeometry(length, height, WALL_THICKNESS, 0.02), surfaces.plaster(wallColor));
    wall.position.set(x, height / 2, z);
    wall.rotation.y = rotation;
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.userData.noFade = true;
    group.add(wall);
    parts.push(wall);

    const skirting = new Mesh(new BoxGeometry(length, 0.22, WALL_THICKNESS + 0.06), trimMaterial.clone());
    skirting.position.set(x, 0.11, z);
    skirting.rotation.y = rotation;
    skirting.userData.noFade = true;
    group.add(skirting);
    parts.push(skirting);

    const picture = new Mesh(new BoxGeometry(length, 0.1, WALL_THICKNESS + 0.05), trimMaterial.clone());
    picture.position.set(x, height - 0.32, z);
    picture.rotation.y = rotation;
    picture.userData.noFade = true;
    group.add(picture);
    parts.push(picture);
  };

  /**
   * Builds one side of the room as a run of wall broken by its gaps, and
   * groups the result so the renderer can hide the whole side at once and
   * present the room as an open-fronted model.
   */
  const addWallRun = (side: RoomSide, gaps: { offset: number; width: number; exterior: boolean }[]) => {
    const alongDepth = side === 'left' || side === 'right';
    const span = alongDepth ? depth : width;
    const rotation = alongDepth ? Math.PI / 2 : 0;
    const fixed = side === 'front' ? halfD : side === 'back' ? -halfD : side === 'left' ? -halfW : halfW;
    const nx = side === 'left' ? -1 : side === 'right' ? 1 : 0;
    const nz = side === 'front' ? 1 : side === 'back' ? -1 : 0;
    // A point on the wall, given how far along it sits from the middle.
    const at = (along: number) => (alongDepth ? { x: fixed, z: along } : { x: along, z: fixed });

    const parts: Mesh[] = [];
    const sorted = [...gaps].sort((a, b) => a.offset - b.offset);
    let cursor = -span / 2;
    for (const gap of sorted) {
      const gapStart = gap.offset - gap.width / 2;
      const gapEnd = gap.offset + gap.width / 2;
      const segment = at((cursor + gapStart) / 2);
      addSegment(parts, gapStart - cursor, segment.x, segment.z, rotation);
      cursor = gapEnd;

      // Lintel above the opening.
      const spot = at(gap.offset);
      const lintel = new Mesh(
        roundedBoxGeometry(gap.width + 0.4, height - DOOR_HEIGHT, WALL_THICKNESS, 0.02),
        surfaces.plaster(wallColor),
      );
      lintel.position.set(spot.x, height - (height - DOOR_HEIGHT) / 2, spot.z);
      lintel.rotation.y = rotation;
      lintel.userData.noFade = true;
      group.add(lintel);
      parts.push(lintel);

      if (gap.exterior) {
        const frame = new Mesh(roundedBoxGeometry(gap.width + 0.36, 2.6, 0.16, 0.06), trimMaterial);
        frame.rotation.x = Math.PI / 2;
        frame.rotation.z = rotation;
        frame.position.set(spot.x - nx * 0.16, 1.3, spot.z - nz * 0.16);
        group.add(frame);

        // A warm strip of daylight on the floor at the threshold.
        const threshold = new Mesh(
          new PlaneGeometry(gap.width, 1.1),
          new MeshStandardMaterial({ color: 0xfff0cc, emissive: 0xfff0cc, emissiveIntensity: 0.28, transparent: true, opacity: 0.32 }),
        );
        threshold.rotation.x = -Math.PI / 2;
        threshold.rotation.z = rotation;
        threshold.position.set(spot.x - nx * 0.6, 0.012, spot.z - nz * 0.6);
        group.add(threshold);
      } else {
        // An inside doorway: an upright cased frame, since there is a room
        // rather than daylight on the far side of it.
        for (const dir of [-1, 1]) {
          const jamb = new Mesh(roundedBoxGeometry(0.14, DOOR_HEIGHT, WALL_THICKNESS + 0.08, 0.04), trimMaterial.clone());
          const post = at(gap.offset + (dir * gap.width) / 2);
          jamb.position.set(post.x, DOOR_HEIGHT / 2, post.z);
          jamb.rotation.y = rotation;
          jamb.userData.noFade = true;
          group.add(jamb);
          parts.push(jamb);
        }
        const head = new Mesh(roundedBoxGeometry(gap.width + 0.28, 0.14, WALL_THICKNESS + 0.08, 0.04), trimMaterial.clone());
        head.position.set(spot.x, DOOR_HEIGHT, spot.z);
        head.rotation.y = rotation;
        head.userData.noFade = true;
        group.add(head);
        parts.push(head);
      }
    }
    const tail = at((cursor + span / 2) / 2);
    addSegment(parts, span / 2 - cursor, tail.x, tail.z, rotation);

    walls.push({ parts, nx, nz });
  };

  const gapsFor = (side: RoomSide) => {
    const gaps = openings
      .filter((opening) => opening.side === side)
      .map((opening) => ({ offset: opening.offset ?? 0, width: opening.width ?? DEFAULT_INNER_DOOR_WIDTH, exterior: false }));
    if (doorway && side === 'front') gaps.push({ offset: 0, width: doorwayWidth, exterior: true });
    return gaps;
  };

  for (const side of ['back', 'left', 'right', 'front'] as RoomSide[]) addWallRun(side, gapsFor(side));

  // --- Windows -------------------------------------------------------------
  // Split between the back wall and the sides: the camera hides whichever wall
  // it is behind, so windows only on the front would rarely be seen.
  const addInteriorWindow = (x: number, z: number, rotation: number) => {
    const built = makeWindow({ frameColor: trimColor, width: 1.3, height: 1.5, panes: true });
    built.group.position.set(x, height * 0.56, z);
    built.group.rotation.y = rotation;
    // Seen from inside, so the glass needs to read from both faces.
    built.glass.side = DoubleSide;
    built.glass.emissiveIntensity = 0.55;
    group.add(built.group);
    windowGlass.push(built.glass);
  };

  // A wall with a doorway through it has no room for glass as well, so the
  // windows go to whichever sides are still solid.
  const cutInto = new Set(openings.map((opening) => opening.side));
  const backCount = cutInto.has('back') ? 0 : Math.max(1, Math.ceil(windows / 2));
  for (let i = 0; i < backCount; i++) {
    const spacing = width / (backCount + 1);
    addInteriorWindow(-halfW + spacing * (i + 1), -halfD + WALL_THICKNESS / 2 + 0.02, 0);
  }
  for (let i = 0; i < windows - backCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    if (cutInto.has(side < 0 ? 'left' : 'right')) continue;
    const z = -halfD * 0.3 + Math.floor(i / 2) * (depth * 0.35);
    addInteriorWindow(side * (halfW - WALL_THICKNESS / 2 - 0.02), z, side * Math.PI / 2);
  }

  // A plinth under the floor grounds the room when it is seen from outside.
  // A room stacked on another has floor below it already, so it goes without.
  if (plinth) {
    const base = new Mesh(
      new BoxGeometry(width + 1.4, 0.7, depth + 1.4),
      createStylizedMaterial({ color: '#b8ad99', roughness: 0.95 }),
    );
    base.position.y = -0.36;
    base.receiveShadow = true;
    base.userData.noFade = true;
    group.add(base);

    const skirt = new Mesh(
      new BoxGeometry(width + 1.9, 0.24, depth + 1.9),
      createStylizedMaterial({ color: '#a49a86', roughness: 0.96 }),
    );
    skirt.position.y = -0.74;
    skirt.userData.noFade = true;
    group.add(skirt);
  }

  // --- Ceiling and lights --------------------------------------------------
  const ceiling = new Mesh(new PlaneGeometry(width, depth), createStylizedMaterial({ color: trimColor, roughness: 0.95 }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  ceiling.userData.noFade = true;
  group.add(ceiling);

  const pointLights: PointLight[] = [];
  for (const spot of lights) {
    const fixture = new Group();
    fixture.position.set(spot.x, height, spot.z);

    const cord = new Mesh(new CylinderGeometry(0.015, 0.015, 0.5, 5), createStylizedMaterial({ color: '#4a4a52', roughness: 0.7 }));
    cord.position.y = -0.25;
    fixture.add(cord);

    const shade = new Mesh(
      new CylinderGeometry(0.34, 0.16, 0.3, 14, 1, true),
      createStylizedMaterial({ color: '#f2e2c4', roughness: 0.8, side: undefined }),
    );
    shade.position.y = -0.62;
    fixture.add(shade);

    const bulb = new Mesh(
      new SphereGeometry(0.11, 10, 8),
      new MeshStandardMaterial({
        color: 0xfff0cc,
        emissive: new Color(0xffdca0),
        emissiveIntensity: 1.8,
        roughness: 0.2,
      }),
    );
    bulb.position.y = -0.68;
    fixture.add(bulb);

    const light = new PointLight(spot.color ?? PALETTE.accent.lamp, spot.intensity ?? 18, 16, 2);
    light.position.y = -0.72;
    light.castShadow = false;
    fixture.add(light);
    pointLights.push(light);

    group.add(fixture);
  }

  // The room carries its own floor height, so a loft is built flat and then
  // lifted rather than every mesh in it having to know how high it sits.
  group.position.y = floorY;

  return {
    group,
    walls,
    bounds: {
      minX: -halfW + WALL_THICKNESS,
      maxX: halfW - WALL_THICKNESS,
      minZ: -halfD + WALL_THICKNESS,
      maxZ: halfD - WALL_THICKNESS,
    },
    entry: new Vector3(0, floorY, halfD - 1.6),
    exit: new Vector3(0, floorY, halfD - 0.5),
    windowGlass,
    lights: pointLights,
    floorY,
  };
}
