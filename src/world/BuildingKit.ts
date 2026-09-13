import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  SRGBColorSpace,
  Shape,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import { PALETTE } from '@/rendering/palette';

/**
 * Reusable architectural parts.
 *
 * Buildings are assembled from these rather than modelled one-off, so a new
 * shop or villager home is a few lines of configuration. Every part is plain
 * geometry, ready to be swapped for a GLTF later without touching placement.
 */

/** A box with rounded vertical edges — the base shape of every wall mass. */
export function roundedBoxGeometry(width: number, height: number, depth: number, radius = 0.22): BufferGeometry {
  const r = Math.min(radius, width / 2 - 0.01, depth / 2 - 0.01);
  const shape = new Shape();
  const w = width / 2;
  const d = depth / 2;
  shape.moveTo(-w + r, -d);
  shape.lineTo(w - r, -d);
  shape.quadraticCurveTo(w, -d, w, -d + r);
  shape.lineTo(w, d - r);
  shape.quadraticCurveTo(w, d, w - r, d);
  shape.lineTo(-w + r, d);
  shape.quadraticCurveTo(-w, d, -w, d - r);
  shape.lineTo(-w, -d + r);
  shape.quadraticCurveTo(-w, -d, -w + r, -d);

  const geometry = new ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: 0.06,
    bevelSize: 0.06,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, height, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** A gabled roof: a triangular prism with eaves overhanging the walls. */
export function gableRoofGeometry(width: number, depth: number, rise: number, overhang = 0.5): BufferGeometry {
  const w = width / 2 + overhang;
  const shape = new Shape();
  shape.moveTo(-w, 0);
  shape.lineTo(w, 0);
  shape.lineTo(0, rise);
  shape.closePath();

  const geometry = new ExtrudeGeometry(shape, {
    depth: depth + overhang * 2,
    bevelEnabled: true,
    bevelThickness: 0.07,
    bevelSize: 0.07,
    bevelSegments: 1,
  });
  geometry.translate(0, 0, -(depth / 2 + overhang));
  geometry.computeVertexNormals();
  return geometry;
}

/** A four-sided hipped roof, used for the museum and town hall. */
export function hipRoofGeometry(width: number, depth: number, rise: number, overhang = 0.6): BufferGeometry {
  const w = width / 2 + overhang;
  const d = depth / 2 + overhang;
  const ridge = Math.max(0.001, (width - depth) / 2);

  const positions: number[] = [];
  const push = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
  ) => { positions.push(ax, ay, az, bx, by, bz, cx, cy, cz); };

  const r0 = [-ridge, rise, 0];
  const r1 = [ridge, rise, 0];
  const c0 = [-w, 0, -d];
  const c1 = [w, 0, -d];
  const c2 = [w, 0, d];
  const c3 = [-w, 0, d];

  // Two trapezoid slopes...
  push(c0[0], c0[1], c0[2], c1[0], c1[1], c1[2], r1[0], r1[1], r1[2]);
  push(c0[0], c0[1], c0[2], r1[0], r1[1], r1[2], r0[0], r0[1], r0[2]);
  push(c2[0], c2[1], c2[2], c3[0], c3[1], c3[2], r0[0], r0[1], r0[2]);
  push(c2[0], c2[1], c2[2], r0[0], r0[1], r0[2], r1[0], r1[1], r1[2]);
  // ...and two triangular hip ends.
  push(c1[0], c1[1], c1[2], c2[0], c2[1], c2[2], r1[0], r1[1], r1[2]);
  push(c3[0], c3[1], c3[2], c0[0], c0[1], c0[2], r0[0], r0[1], r0[2]);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export interface WindowOptions {
  width?: number;
  height?: number;
  frameColor?: string;
  glassColor?: string;
  /** Adds a cross-bar mullion. */
  panes?: boolean;
  /** Adds a windowsill planter. */
  planter?: boolean;
}

export interface BuiltWindow {
  group: Group;
  /** Set `emissiveIntensity` on this to light the window at night. */
  glass: MeshStandardMaterial;
}

/** A framed window that can glow after dark. */
export function makeWindow(options: WindowOptions = {}): BuiltWindow {
  const {
    width = 1.1,
    height = 1.25,
    frameColor = PALETTE.plaster.white,
    glassColor = PALETTE.accent.window,
    panes = true,
    planter = false,
  } = options;

  const group = new Group();
  group.name = 'Window';

  const frameMaterial = createStylizedMaterial({ color: frameColor, roughness: 0.75 });
  const frame = new Mesh(roundedBoxGeometry(width + 0.22, 0.14, height + 0.22, 0.09), frameMaterial);
  frame.rotation.x = Math.PI / 2;
  frame.position.z = 0.02;
  frame.castShadow = true;
  group.add(frame);

  const glassMaterial = new MeshStandardMaterial({
    color: new Color(glassColor),
    roughness: 0.18,
    metalness: 0.05,
    emissive: new Color(PALETTE.accent.windowLit),
    emissiveIntensity: 0,
  });
  const glass = new Mesh(new PlaneGeometry(width, height), glassMaterial);
  glass.position.z = 0.1;
  group.add(glass);

  if (panes) {
    const mullionMaterial = createStylizedMaterial({ color: frameColor, roughness: 0.8 });
    const vertical = new Mesh(new BoxGeometry(0.06, height, 0.07), mullionMaterial);
    vertical.position.z = 0.12;
    const horizontal = new Mesh(new BoxGeometry(width, 0.06, 0.07), mullionMaterial);
    horizontal.position.z = 0.12;
    group.add(vertical, horizontal);
  }

  if (planter) {
    const box = new Mesh(
      roundedBoxGeometry(width + 0.3, 0.24, 0.3, 0.07),
      createStylizedMaterial({ color: PALETTE.wood.plankDark, roughness: 0.9 }),
    );
    box.position.set(0, -height / 2 - 0.2, 0.18);
    box.castShadow = true;
    group.add(box);

    const bloomMaterial = createStylizedMaterial({ color: PALETTE.flowers[0], roughness: 0.85, wind: 'foliage', windScale: 1.4 });
    for (let i = 0; i < 4; i++) {
      const bloom = new Mesh(new SphereGeometry(0.11, 6, 5), bloomMaterial);
      bloom.position.set(-width / 2 + 0.15 + i * (width / 3.2), -height / 2 - 0.05, 0.2);
      group.add(bloom);
    }
  }

  return { group, glass: glassMaterial };
}

export interface DoorOptions {
  width?: number;
  height?: number;
  color?: string;
  frameColor?: string;
  /** Adds a small awning above the door. */
  awning?: boolean;
  awningColor?: string;
}

export interface BuiltDoor {
  group: Group;
  /** The swinging leaf — rotate this to open the door. */
  leaf: Group;
}

export function makeDoor(options: DoorOptions = {}): BuiltDoor {
  const {
    width = 1.15,
    height = 2.15,
    color = '#a8613f',
    frameColor = PALETTE.plaster.white,
    awning = false,
    awningColor = PALETTE.roof.terracotta,
  } = options;

  const group = new Group();
  group.name = 'Door';

  const frame = new Mesh(
    roundedBoxGeometry(width + 0.26, 0.16, height + 0.2, 0.1),
    createStylizedMaterial({ color: frameColor, roughness: 0.78 }),
  );
  frame.rotation.x = Math.PI / 2;
  frame.position.set(0, height / 2, 0.02);
  frame.castShadow = true;
  group.add(frame);

  // A pivot group at the hinge edge so opening rotates about the jamb.
  const leaf = new Group();
  leaf.position.set(-width / 2, 0, 0.08);
  group.add(leaf);

  const panel = new Mesh(
    roundedBoxGeometry(width, 0.1, height, 0.12),
    createStylizedMaterial({ color, roughness: 0.72 }),
  );
  panel.rotation.x = Math.PI / 2;
  panel.position.set(width / 2, height / 2, 0);
  panel.castShadow = true;
  leaf.add(panel);

  const knob = new Mesh(
    new SphereGeometry(0.075, 10, 8),
    createStylizedMaterial({ color: PALETTE.accent.gold, roughness: 0.32, metalness: 0.55 }),
  );
  knob.position.set(width - 0.2, height * 0.48, 0.09);
  leaf.add(knob);

  if (awning) {
    const canopy = new Mesh(
      gableRoofGeometry(width + 1.0, 0.9, 0.42, 0.16),
      createStylizedMaterial({ color: awningColor, roughness: 0.85 }),
    );
    canopy.position.set(0, height + 0.18, 0.42);
    canopy.castShadow = true;
    group.add(canopy);
  }

  return { group, leaf };
}

export interface SignOptions {
  text: string;
  width?: number;
  height?: number;
  boardColor?: string;
  textColor?: string;
  /** Hangs the board from a post rather than mounting it flat. */
  hanging?: boolean;
}

/** A painted sign board. Text is drawn to a canvas texture at build time. */
export function makeSign(options: SignOptions): Group {
  const {
    text,
    width = 2.4,
    height = 0.72,
    boardColor = '#f2e2c4',
    textColor = PALETTE.accent.sign,
    hanging = false,
  } = options;

  const group = new Group();
  group.name = `Sign_${text}`;

  const board = new Mesh(
    roundedBoxGeometry(width, 0.12, height, 0.14),
    createStylizedMaterial({ color: boardColor, roughness: 0.82 }),
  );
  board.rotation.x = Math.PI / 2;
  board.castShadow = true;
  group.add(board);

  const label = new Mesh(new PlaneGeometry(width * 0.9, height * 0.72), makeTextMaterial(text, textColor, boardColor));
  label.position.z = 0.075;
  group.add(label);

  const back = label.clone();
  back.position.z = -0.075;
  back.rotation.y = Math.PI;
  group.add(back);

  if (hanging) {
    const armMaterial = createStylizedMaterial({ color: PALETTE.wood.beam, roughness: 0.9 });
    const post = new Mesh(new CylinderGeometry(0.07, 0.08, 3.0, 8), armMaterial);
    post.position.set(-width / 2 - 0.5, -0.6, 0);
    post.castShadow = true;
    group.add(post);

    const arm = new Mesh(new BoxGeometry(width * 0.7, 0.1, 0.1), armMaterial);
    arm.position.set(-width / 2 - 0.5 + (width * 0.7) / 2, 0.85, 0);
    group.add(arm);

    const ringMaterial = createStylizedMaterial({ color: PALETTE.accent.gold, roughness: 0.4, metalness: 0.5 });
    for (const dx of [-width * 0.28, width * 0.28]) {
      const ring = new Mesh(new TorusGeometry(0.11, 0.025, 6, 12), ringMaterial);
      ring.position.set(dx, height / 2 + 0.16, 0);
      ring.rotation.y = Math.PI / 2;
      group.add(ring);
    }
  }

  return group;
}

/** Renders label text to a canvas and returns a material for it. */
export function makeTextMaterial(text: string, color: string, background: string): MeshStandardMaterial {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.font = '700 84px "Trebuchet MS", "Gill Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Squeeze long names rather than letting them overflow the board.
  const maxWidth = canvas.width - 48;
  ctx.fillText(text.toUpperCase(), canvas.width / 2, canvas.height / 2 + 4, maxWidth);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;

  return new MeshStandardMaterial({ map: texture, roughness: 0.85, metalness: 0 });
}

export interface LampOptions {
  height?: number;
  color?: string;
  glassColor?: string;
  intensity?: number;
}

export interface BuiltLamp {
  group: Group;
  light: PointLight;
  glass: MeshStandardMaterial;
}

/** A street lamp. The caller drives `light.intensity` from the time of day. */
export function makeStreetLamp(options: LampOptions = {}): BuiltLamp {
  const { height = 3.6, color = '#3f4a52', glassColor = PALETTE.accent.lamp, intensity = 0 } = options;
  const group = new Group();
  group.name = 'StreetLamp';

  const metal = createStylizedMaterial({ color, roughness: 0.5, metalness: 0.35 });

  const base = new Mesh(new CylinderGeometry(0.3, 0.38, 0.34, 10), metal);
  base.position.y = 0.17;
  base.castShadow = true;
  group.add(base);

  const post = new Mesh(new CylinderGeometry(0.09, 0.12, height, 8), metal);
  post.position.y = height / 2 + 0.2;
  post.castShadow = true;
  group.add(post);

  const glassMaterial = new MeshStandardMaterial({
    color: new Color(glassColor),
    emissive: new Color(glassColor),
    emissiveIntensity: intensity,
    roughness: 0.25,
    transparent: true,
    opacity: 0.92,
  });
  const lantern = new Mesh(new SphereGeometry(0.34, 12, 10), glassMaterial);
  lantern.position.y = height + 0.34;
  group.add(lantern);

  const cap = new Mesh(new CylinderGeometry(0.34, 0.16, 0.3, 8), metal);
  cap.position.y = height + 0.66;
  group.add(cap);

  const light = new PointLight(new Color(glassColor), intensity, 14, 2);
  light.position.y = height + 0.3;
  light.castShadow = false;
  group.add(light);

  return { group, light, glass: glassMaterial };
}

/** Low planting around a building's base: shrubs and a couple of blooms. */
export function makeLandscaping(width: number, depth: number, seed = 0): Group {
  const group = new Group();
  group.name = 'Landscaping';

  const shrub = createStylizedMaterial({
    color: PALETTE.foliage.canopyDark,
    roughness: 0.95,
    flatShading: true,
    wind: 'foliage',
    windScale: 0.9,
  });
  const bloomMaterials = PALETTE.flowers.slice(0, 3).map((c) =>
    createStylizedMaterial({ color: c, roughness: 0.85, wind: 'foliage', windScale: 1.5 }),
  );

  const spots = [
    { x: -width / 2 - 0.3, z: depth / 2 + 0.4, s: 0.72 },
    { x: width / 2 + 0.35, z: depth / 2 + 0.5, s: 0.62 },
    { x: -width / 2 - 0.5, z: -depth / 4, s: 0.55 },
    { x: width / 2 + 0.45, z: -depth / 3, s: 0.68 },
  ];

  spots.forEach((spot, i) => {
    const bush = new Mesh(new SphereGeometry(spot.s, 8, 6), shrub);
    bush.position.set(spot.x, spot.s * 0.7, spot.z);
    bush.scale.set(1.15, 0.8, 1.15);
    bush.castShadow = true;
    bush.receiveShadow = true;
    group.add(bush);

    if ((i + seed) % 2 === 0) {
      const bloom = new Mesh(new SphereGeometry(0.13, 6, 5), bloomMaterials[(i + seed) % bloomMaterials.length]);
      bloom.position.set(spot.x + 0.3, spot.s * 1.1, spot.z + 0.2);
      group.add(bloom);
    }
  });

  return group;
}
