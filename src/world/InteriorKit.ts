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
  /** Warm ceiling lights. */
  lights?: { x: number; z: number; color?: string; intensity?: number }[];
  name?: string;
}

export interface RoomWall {
  /** Every mesh belonging to this wall, including its trim. */
  parts: Mesh[];
  /** Outward normal, pointing away from the room's centre. */
  nx: number;
  nz: number;
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
    lights = [],
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
  const wallMaterial = surfaces.plaster(wallColor);
  const trimMaterial = createStylizedMaterial({ color: trimColor, roughness: 0.85 });
  const windowGlass: MeshStandardMaterial[] = [];

  const walls: RoomWall[] = [];

  const addWall = (w: number, x: number, z: number, rotation: number, nx = 0, nz = 0) => {
    const parts: Mesh[] = [];
    // Each wall gets its own material so one can be dimmed or hidden alone.
    // A rounded-box rather than a BoxGeometry: its UVs are in metres, so the
    // plaster grain tiles at one density on a 7 m cottage wall and a 36 m hall.
    const wall = new Mesh(roundedBoxGeometry(w, height, WALL_THICKNESS, 0.02), surfaces.plaster(wallColor));
    wall.position.set(x, height / 2, z);
    wall.rotation.y = rotation;
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.userData.noFade = true;
    group.add(wall);
    parts.push(wall);

    const skirting = new Mesh(new BoxGeometry(w, 0.22, WALL_THICKNESS + 0.06), trimMaterial.clone());
    skirting.position.set(x, 0.11, z);
    skirting.rotation.y = rotation;
    skirting.userData.noFade = true;
    group.add(skirting);
    parts.push(skirting);

    const picture = new Mesh(new BoxGeometry(w, 0.1, WALL_THICKNESS + 0.05), trimMaterial.clone());
    picture.position.set(x, height - 0.32, z);
    picture.rotation.y = rotation;
    picture.userData.noFade = true;
    group.add(picture);
    parts.push(picture);

    // Group the wall so the renderer can hide the one nearest the camera and
    // present the room as an open-fronted model.
    if (nx !== 0 || nz !== 0) walls.push({ parts, nx, nz });
  };

  // Back and sides are solid; the front wall carries the doorway.
  addWall(width, 0, -halfD, 0, 0, -1);
  addWall(depth, -halfW, 0, Math.PI / 2, -1, 0);
  addWall(depth, halfW, 0, Math.PI / 2, 1, 0);

  if (doorway) {
    const sideWidth = (width - doorwayWidth) / 2;
    addWall(sideWidth, -(doorwayWidth / 2 + sideWidth / 2), halfD, 0, 0, 1);
    addWall(sideWidth, doorwayWidth / 2 + sideWidth / 2, halfD, 0, 0, 1);

    // Lintel above the opening.
    const lintel = new Mesh(roundedBoxGeometry(doorwayWidth + 0.4, height - 2.5, WALL_THICKNESS, 0.02), wallMaterial);
    lintel.position.set(0, height - (height - 2.5) / 2, halfD);
    lintel.userData.noFade = true;
    group.add(lintel);
    walls[walls.length - 1]?.parts.push(lintel);

    const frame = new Mesh(roundedBoxGeometry(doorwayWidth + 0.36, 2.6, 0.16, 0.06), trimMaterial);
    frame.rotation.x = Math.PI / 2;
    frame.position.set(0, 1.3, halfD - 0.16);
    group.add(frame);

    // A warm strip of daylight on the floor at the threshold.
    const threshold = new Mesh(
      new PlaneGeometry(doorwayWidth, 1.1),
      new MeshStandardMaterial({ color: 0xfff0cc, emissive: 0xfff0cc, emissiveIntensity: 0.28, transparent: true, opacity: 0.32 }),
    );
    threshold.rotation.x = -Math.PI / 2;
    threshold.position.set(0, 0.012, halfD - 0.6);
    group.add(threshold);
  } else {
    addWall(width, 0, halfD, 0, 0, 1);
  }

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

  const backCount = Math.max(1, Math.ceil(windows / 2));
  for (let i = 0; i < backCount; i++) {
    const spacing = width / (backCount + 1);
    addInteriorWindow(-halfW + spacing * (i + 1), -halfD + WALL_THICKNESS / 2 + 0.02, 0);
  }
  for (let i = 0; i < windows - backCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = -halfD * 0.3 + Math.floor(i / 2) * (depth * 0.35);
    addInteriorWindow(side * (halfW - WALL_THICKNESS / 2 - 0.02), z, side * Math.PI / 2);
  }

  // A plinth under the floor grounds the room when it is seen from outside.
  const plinth = new Mesh(
    new BoxGeometry(width + 1.4, 0.7, depth + 1.4),
    createStylizedMaterial({ color: '#b8ad99', roughness: 0.95 }),
  );
  plinth.position.y = -0.36;
  plinth.receiveShadow = true;
  plinth.userData.noFade = true;
  group.add(plinth);

  const skirt = new Mesh(
    new BoxGeometry(width + 1.9, 0.24, depth + 1.9),
    createStylizedMaterial({ color: '#a49a86', roughness: 0.96 }),
  );
  skirt.position.y = -0.74;
  skirt.userData.noFade = true;
  group.add(skirt);

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

  return {
    group,
    walls,
    bounds: {
      minX: -halfW + WALL_THICKNESS,
      maxX: halfW - WALL_THICKNESS,
      minZ: -halfD + WALL_THICKNESS,
      maxZ: halfD - WALL_THICKNESS,
    },
    entry: new Vector3(0, 0, halfD - 1.6),
    exit: new Vector3(0, 0, halfD - 0.5),
    windowGlass,
    lights: pointLights,
    floorY: 0,
  };
}
