import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Vector3,
} from 'three';
import { makeKitMesh, softTint } from '@/assets/registry';
import { createStylizedMaterial } from '@/rendering/materials';
import { PALETTE } from '@/rendering/palette';
import { makeItemModel } from '@/items/ItemModels';
import { makeSign, roundedBoxGeometry } from './BuildingKit';
import { buildRoom, type BuiltRoom } from './InteriorKit';
import type { Museum } from '@/museum/Museum';
import type { MuseumWing, SpeciesDef } from '@/items/types';
import type { AmbienceId } from '@/audio/sounds';

export type InteriorId = 'home' | 'museum' | 'shop' | 'townhall' | 'npcHome';

export interface InteriorScene {
  id: string;
  group: Group;
  room: BuiltRoom;
  /** Circles the player cannot walk through, in interior local space. */
  colliders: { x: number; z: number; radius: number }[];
  /** Named points the interaction system anchors prompts to. */
  anchors: Record<string, Vector3>;
  ambience: AmbienceId;
  music: string;
  title: string;
  update?: (dt: number, time: number) => void;
}

// --- Player home -------------------------------------------------------------

export interface HomeLayout {
  level: number;
  /** Half-extents of the placement grid, in metres. */
  gridHalfW: number;
  gridHalfD: number;
}

export function homeLayoutFor(level: number): HomeLayout {
  // Each upgrade grows the cottage, which is the reward the player can see.
  const sizes = [
    { w: 7.5, d: 6.5 },
    { w: 9.5, d: 8 },
    { w: 12, d: 9.5 },
    { w: 14, d: 11 },
  ];
  const size = sizes[Math.min(level - 1, sizes.length - 1)];
  return { level, gridHalfW: size.w / 2, gridHalfD: size.d / 2 };
}

export function createHomeInterior(level: number): InteriorScene {
  const layout = homeLayoutFor(level);
  const width = layout.gridHalfW * 2;
  const depth = layout.gridHalfD * 2;

  const room = buildRoom({
    name: 'Cottage',
    width,
    depth,
    height: 3.4,
    floor: 'plank',
    wallColor: '#f2e6cf',
    trimColor: '#fdf8ec',
    windows: level >= 2 ? 3 : 2,
    lights: level >= 3
      ? [{ x: -width * 0.22, z: -depth * 0.1, color: '#ffdcb0' }, { x: width * 0.22, z: -depth * 0.1, color: '#ffdcb0' }]
      : [{ x: 0, z: -depth * 0.12, color: '#ffdcb0', intensity: 20 }],
  });

  const group = new Group();
  group.add(room.group);

  // A hearth gives the cottage a focal point from the first minute.
  const hearth = new Group();
  const stone = createStylizedMaterial({ color: PALETTE.rock.light, roughness: 0.95, flatShading: true });
  const surround = new Mesh(roundedBoxGeometry(1.9, 1.5, 0.6, 0.14), stone);
  surround.position.set(0, 0.75, -depth / 2 + 0.4);
  surround.castShadow = true;
  hearth.add(surround);

  const opening = new Mesh(new BoxGeometry(1.05, 0.85, 0.4), createStylizedMaterial({ color: '#2b241f', roughness: 1 }));
  opening.position.set(0, 0.44, -depth / 2 + 0.55);
  hearth.add(opening);

  const fireMaterial = new MeshStandardMaterial({
    color: new Color('#ff9a3c'),
    emissive: new Color('#ff7a22'),
    emissiveIntensity: 2.4,
    roughness: 0.6,
  });
  const fire = new Mesh(new SphereGeometry(0.3, 10, 8), fireMaterial);
  fire.scale.set(1.4, 1, 0.6);
  fire.position.set(0, 0.28, -depth / 2 + 0.55);
  hearth.add(fire);

  const fireLight = new PointLight('#ff9a4a', 5, 9, 2);
  fireLight.position.set(0, 0.6, -depth / 2 + 0.9);
  hearth.add(fireLight);

  const mantel = new Mesh(roundedBoxGeometry(2.1, 0.12, 0.34, 0.05), createStylizedMaterial({ color: PALETTE.wood.plank, roughness: 0.88 }));
  mantel.position.set(0, 1.54, -depth / 2 + 0.5);
  mantel.castShadow = true;
  hearth.add(mantel);
  group.add(hearth);

  const anchors: Record<string, Vector3> = {
    exit: room.exit.clone(),
    wardrobe: new Vector3(-layout.gridHalfW + 0.9, 0, -layout.gridHalfD + 1.4),
    storage: new Vector3(layout.gridHalfW - 0.9, 0, -layout.gridHalfD + 1.4),
    kitchen: new Vector3(layout.gridHalfW - 1.1, 0, 0.6),
  };

  // Wardrobe: where the player changes their look.
  const wardrobe = new Group();
  const kitWardrobe = makeKitMesh('furniture.cabinet', { scale: 0.8, tint: '#e8d8bc', roughness: 0.86 });
  if (kitWardrobe) {
    wardrobe.add(kitWardrobe);
  } else {
    const body = new Mesh(roundedBoxGeometry(1.1, 2.0, 0.6, 0.08), createStylizedMaterial({ color: '#b98a58', roughness: 0.86 }));
    body.position.y = 1.0;
    body.castShadow = true;
    wardrobe.add(body);
    for (const dx of [-0.26, 0.26]) {
      const knob = new Mesh(new SphereGeometry(0.05, 8, 6), createStylizedMaterial({ color: PALETTE.accent.gold, roughness: 0.35, metalness: 0.6 }));
      knob.position.set(dx, 1.0, 0.31);
      wardrobe.add(knob);
    }
  }
  wardrobe.position.copy(anchors.wardrobe);
  group.add(wardrobe);

  // Storage chest.
  const chest = new Group();
  const kitChest = makeKitMesh('props.chest', { scale: 1.2, roughness: 0.88 });
  if (kitChest) {
    chest.add(kitChest);
  } else {
    const chestBody = new Mesh(roundedBoxGeometry(0.9, 0.6, 0.6, 0.08), createStylizedMaterial({ color: '#8a6238', roughness: 0.9 }));
    chestBody.position.y = 0.3;
    chestBody.castShadow = true;
    chest.add(chestBody);
    const lid = new Mesh(new CylinderGeometry(0.31, 0.31, 0.9, 12, 1, false, 0, Math.PI), createStylizedMaterial({ color: '#a8763f', roughness: 0.88 }));
    lid.rotation.z = Math.PI / 2;
    lid.position.y = 0.6;
    chest.add(lid);
  }
  chest.position.copy(anchors.storage);
  group.add(chest);

  // A rug by the hearth and a small plant by the door, so an unfurnished
  // cottage still reads as lived in rather than a display box.
  const hearthRug = makeKitMesh('furniture.rugRound', { scale: 1.1, tint: '#e4c4b0' });
  if (hearthRug) {
    hearthRug.position.set(0, 0.005, -depth / 2 + 2.4);
    group.add(hearthRug);
  }
  const doorPlant = makeKitMesh('furniture.plantSmall', { scale: 1.4 });
  if (doorPlant) {
    doorPlant.position.set(layout.gridHalfW - 0.9, 0, layout.gridHalfD - 1.0);
    group.add(doorPlant);
  }

  // Kitchen counter, for cooking.
  const kitchen = new Group();
  const counter = new Mesh(roundedBoxGeometry(0.7, 0.9, 1.8, 0.07), createStylizedMaterial({ color: '#e0d2b8', roughness: 0.9 }));
  counter.position.y = 0.45;
  counter.castShadow = true;
  kitchen.add(counter);
  const pot = new Mesh(new CylinderGeometry(0.2, 0.17, 0.24, 14), createStylizedMaterial({ color: '#5d6b74', roughness: 0.45, metalness: 0.35 }));
  pot.position.set(0, 1.02, 0.3);
  kitchen.add(pot);
  kitchen.position.copy(anchors.kitchen);
  group.add(kitchen);

  return {
    id: 'home',
    group,
    room,
    colliders: [
      { x: 0, z: -depth / 2 + 0.5, radius: 1.1 },
      { x: anchors.wardrobe.x, z: anchors.wardrobe.z, radius: 0.7 },
      { x: anchors.storage.x, z: anchors.storage.z, radius: 0.6 },
      { x: anchors.kitchen.x, z: anchors.kitchen.z, radius: 0.8 },
    ],
    anchors,
    ambience: 'interior',
    music: 'music.home',
    title: 'Your Cottage',
    update: (_dt, time) => {
      // Firelight flicker.
      const flicker = 1 + Math.sin(time * 9.1) * 0.12 + Math.sin(time * 3.7) * 0.07;
      fireLight.intensity = 5 * flicker;
      fireMaterial.emissiveIntensity = 2.4 * flicker;
      fire.scale.y = 1 + Math.sin(time * 7.3) * 0.12;
    },
  };
}

// --- Museum ------------------------------------------------------------------

interface ExhibitSlot {
  species: SpeciesDef;
  root: Group;
  occupant: Group | null;
  phase: number;
}

const WING_LAYOUT: Record<MuseumWing, { x: number; z: number; label: string; accent: string }> = {
  aquarium: { x: -12, z: -4, label: 'Aquarium', accent: '#5fb6d6' },
  conservatory: { x: 12, z: -4, label: 'Insect Conservatory', accent: '#7fbf6a' },
  fossilHall: { x: -12, z: -16, label: 'Fossil Hall', accent: '#c9a86a' },
  oceanGallery: { x: 12, z: -16, label: 'Ocean Gallery', accent: '#4a7fa8' },
};

export function createMuseumInterior(museum: Museum): InteriorScene {
  const width = 36;
  const depth = 28;

  // A museum is the one room that should feel dim and precious: deep walls,
  // a warm floor, and light concentrated on the cases rather than the ceiling.
  const room = buildRoom({
    name: 'Museum',
    width,
    depth,
    height: 5.8,
    floor: 'plank',
    wallColor: '#5a6e78',
    trimColor: '#e9dcc3',
    windows: 4,
    doorwayWidth: 2.6,
    lights: [
      { x: 0, z: 8, intensity: 16, color: '#ffe2b8' },
      { x: -12, z: -4, intensity: 12, color: '#cfe8f5' },
      { x: 12, z: -4, intensity: 12, color: '#e2f5cf' },
      { x: -12, z: -16, intensity: 12, color: '#f5e6cf' },
      { x: 12, z: -16, intensity: 12, color: '#cfd9f5' },
    ],
  });

  const group = new Group();
  group.add(room.group);

  // Lobby dressing: a runner from the door to the desk, benches to sit on,
  // planters either side of the entrance.
  const runner = makeKitMesh('furniture.rug', { scale: 1.6, tint: '#b6584e' });
  if (runner) {
    runner.position.set(0, 0.006, 9.6);
    runner.rotation.y = Math.PI / 2;
    runner.scale.set(1.3, 1, 2.1);
    group.add(runner);
  }
  for (const side of [-1, 1]) {
    const bench = makeKitMesh('furniture.sofa', { scale: 1.05, tint: '#cdb79a' });
    if (bench) {
      bench.position.set(side * 5.2, 0, 9.8);
      bench.rotation.y = -side * Math.PI / 2;
      group.add(bench);
    }
    const planter = makeKitMesh('furniture.plant', { scale: 1.1 });
    if (planter) {
      planter.position.set(side * 2.4, 0, 12.6);
      group.add(planter);
    }
  }

  const colliders: { x: number; z: number; radius: number }[] = [
    { x: -5.2, z: 9.8, radius: 1.1 },
    { x: 5.2, z: 9.8, radius: 1.1 },
  ];
  const exhibits: ExhibitSlot[] = [];
  const wingLights: SpotLight[] = [];

  // Partition walls that make four wings out of one hall while keeping it
  // walkable — the player can see every wing from the lobby.
  const partitionMaterial = createStylizedMaterial({ color: '#6c7f88', roughness: 0.92 });
  for (const [dx, dz, w, d] of [
    [-6.5, -10, 0.5, 14],
    [6.5, -10, 0.5, 14],
    [-12, -10.5, 9, 0.5],
    [12, -10.5, 9, 0.5],
  ] as [number, number, number, number][]) {
    const wall = new Mesh(new BoxGeometry(w, 4.4, d), partitionMaterial);
    wall.position.set(dx, 2.2, dz);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
    colliders.push({ x: dx, z: dz, radius: Math.max(w, d) * 0.5 });
  }

  // Curator desk in the lobby.
  const desk = new Group();
  const kitDesk = makeKitMesh('furniture.desk', { scale: 1.45, tint: '#c8a882' });
  if (kitDesk) {
    kitDesk.rotation.y = Math.PI;
    desk.add(kitDesk);
  } else {
    const deskTop = new Mesh(roundedBoxGeometry(3.2, 1.1, 1.1, 0.1), createStylizedMaterial({ color: '#a8763f', roughness: 0.85 }));
    deskTop.position.y = 0.55;
    deskTop.castShadow = true;
    desk.add(deskTop);
  }
  const ledger = new Mesh(roundedBoxGeometry(0.5, 0.06, 0.36, 0.02), createStylizedMaterial({ color: '#f4ecd8', roughness: 0.9 }));
  ledger.position.set(0.6, 1.13, 0.1);
  desk.add(ledger);
  const deskLamp = makeKitMesh('furniture.lamp', { scale: 1.1 });
  if (deskLamp) {
    deskLamp.position.set(-0.7, 1.08, -0.1);
    desk.add(deskLamp);
  }
  desk.position.set(0, 0, 6.5);
  group.add(desk);
  colliders.push({ x: 0, z: 6.5, radius: 1.9 });

  // The donation pedestal: a lit brass plinth in front of the desk, where
  // the prompt to donate lives and where new pieces sparkle in.
  const pedestal = new Mesh(new CylinderGeometry(0.42, 0.5, 0.9, 16), createStylizedMaterial({ color: '#4e5b63', roughness: 0.6, metalness: 0.2 }));
  pedestal.position.set(0, 0.45, 4.2);
  pedestal.castShadow = true;
  group.add(pedestal);
  const pedestalCap = new Mesh(new CylinderGeometry(0.5, 0.42, 0.08, 16), createStylizedMaterial({ color: PALETTE.accent.gold, roughness: 0.35, metalness: 0.6 }));
  pedestalCap.position.set(0, 0.92, 4.2);
  group.add(pedestalCap);
  const pedestalLight = new PointLight('#ffe2a8', 4, 5, 2);
  pedestalLight.position.set(0, 2.2, 4.2);
  group.add(pedestalLight);
  colliders.push({ x: 0, z: 4.2, radius: 0.7 });

  const anchors: Record<string, Vector3> = {
    exit: room.exit.clone(),
    curator: new Vector3(0, 0, 4.6),
  };

  // --- Wings -------------------------------------------------------------
  for (const wingId of Object.keys(WING_LAYOUT) as MuseumWing[]) {
    const layout = WING_LAYOUT[wingId];
    const wingGroup = new Group();
    wingGroup.position.set(layout.x, 0, layout.z);
    group.add(wingGroup);
    anchors[`wing.${wingId}`] = new Vector3(layout.x, 0, layout.z + 3.5);

    const sign = makeSign({ text: layout.label, width: 3.4, height: 0.62, boardColor: '#f6f0e2', textColor: '#3a4a52' });
    sign.position.set(0, 4.0, 4.4);
    wingGroup.add(sign);

    // A hanging banner in the wing's colour, so each hall reads from the lobby.
    const banner = new Mesh(
      new BoxGeometry(1.4, 3.0, 0.06),
      createStylizedMaterial({ color: layout.accent, roughness: 0.9 }),
    );
    banner.position.set(-2.9, 3.6, 4.4);
    banner.castShadow = true;
    wingGroup.add(banner);
    const bannerTail = new Mesh(new BoxGeometry(1.4, 0.5, 0.06), createStylizedMaterial({ color: '#f6f0e2', roughness: 0.9 }));
    bannerTail.position.set(-2.9, 1.95, 4.4);
    wingGroup.add(bannerTail);

    const wingRug = makeKitMesh('furniture.rugRound', { scale: 2.2, tint: softTint(layout.accent, 0.35) });
    if (wingRug) {
      wingRug.position.set(0, 0.006, -0.2);
      wingGroup.add(wingRug);
    }

    // A soft key light per wing so each reads as its own space.
    const spot = new SpotLight(new Color(layout.accent), 0, 22, 0.72, 0.55, 1.2);
    spot.position.set(0, 5.6, 0);
    spot.target.position.set(0, 0, 0);
    wingGroup.add(spot, spot.target);
    wingLights.push(spot);

    const species = museum.speciesIn(wingId);
    species.forEach((def, index) => {
      const slot = buildExhibitSlot(wingId, def, index, species.length, layout.accent);
      slot.root.position.set(slot.root.position.x, 0, slot.root.position.z);
      wingGroup.add(slot.root);
      exhibits.push(slot);
      colliders.push({
        x: layout.x + slot.root.position.x,
        z: layout.z + slot.root.position.z,
        radius: wingId === 'aquarium' ? 1.2 : 0.85,
      });
    });

    if (wingId === 'fossilHall') {
      const skeleton = buildSkeleton();
      skeleton.position.set(0, 0, -1.2);
      wingGroup.add(skeleton);
      wingGroup.userData.skeleton = skeleton;
      colliders.push({ x: layout.x, z: layout.z - 1.2, radius: 2.4 });
    }
    if (wingId === 'conservatory') {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const planter = new Mesh(
          new CylinderGeometry(0.42, 0.34, 0.5, 12),
          createStylizedMaterial({ color: '#b8845c', roughness: 0.9 }),
        );
        planter.position.set(Math.cos(a) * 3.6, 0.25, Math.sin(a) * 2.6 - 1);
        planter.castShadow = true;
        wingGroup.add(planter);
        for (let f = 0; f < 4; f++) {
          const frond = new Mesh(
            new SphereGeometry(0.5, 8, 6),
            createStylizedMaterial({ color: '#5f9a55', roughness: 0.92, wind: 'foliage', windScale: 0.4 }),
          );
          frond.scale.set(0.3, 0.12, 1);
          frond.position.set(planter.position.x, 0.85 + f * 0.14, planter.position.z);
          frond.rotation.set(0.4, (f / 4) * Math.PI * 2, 0);
          wingGroup.add(frond);
        }
      }
    }
    if (wingId === 'oceanGallery') {
      // Reef rocks and a caustic-lit backdrop.
      for (let i = 0; i < 7; i++) {
        const rock = new Mesh(
          new SphereGeometry(0.5 + (i % 3) * 0.22, 8, 6),
          createStylizedMaterial({ color: i % 2 ? '#7f8f96' : '#8a6f7f', roughness: 0.95, flatShading: true }),
        );
        rock.position.set(-3.6 + i * 1.2, 0.3, -3.4 + (i % 3) * 0.7);
        rock.castShadow = true;
        wingGroup.add(rock);
      }
      const backdrop = new Mesh(
        new BoxGeometry(8.6, 4, 0.16),
        new MeshStandardMaterial({ color: new Color('#2f6b8f'), emissive: new Color('#1f4a66'), emissiveIntensity: 0.6, roughness: 0.4 }),
      );
      backdrop.position.set(0, 2.1, -4.6);
      wingGroup.add(backdrop);
      wingGroup.userData.backdrop = backdrop;
    }
  }

  const refresh = () => {
    for (const slot of exhibits) {
      const owned = museum.has(slot.species.id);
      if (owned && !slot.occupant) {
        const model = makeItemModel(slot.species.id, slot.species.wing === 'fossilHall' ? 2.4 : 2.0);
        model.position.y = slot.species.wing === 'aquarium' || slot.species.wing === 'oceanGallery' ? 1.5 : 1.15;
        slot.root.add(model);
        slot.occupant = model;
        // Light the case only once it holds something.
        const caseLight = slot.root.userData.caseLight as PointLight | undefined;
        if (caseLight) caseLight.intensity = 2.2;
        const placard = slot.root.userData.placard as Group | undefined;
        if (placard) placard.visible = true;
      } else if (!owned && slot.occupant) {
        slot.root.remove(slot.occupant);
        slot.occupant = null;
      }
    }

    // Wing lighting scales with completion, so an empty hall really is dim.
    const wings = Object.keys(WING_LAYOUT) as MuseumWing[];
    wings.forEach((wingId, index) => {
      const progress = museum.wingProgress(wingId);
      wingLights[index].intensity = 4 + progress.completion * 26;
    });

    // The fossil skeleton assembles bone by bone as the hall fills.
    const fossilWing = group.children.find((c) => c.userData.skeleton) as Group | undefined;
    const skeleton = fossilWing?.userData.skeleton as Group | undefined;
    if (skeleton) {
      const progress = museum.wingProgress('fossilHall').completion;
      const parts = skeleton.children;
      parts.forEach((part, index) => {
        part.visible = index / Math.max(1, parts.length) <= progress + 0.001;
      });
    }
  };

  refresh();

  return {
    id: 'museum',
    group,
    room,
    colliders,
    anchors,
    ambience: 'museum',
    music: 'music.museum',
    title: 'Cozy Cove Museum',
    update: (_dt, time) => {
      for (const slot of exhibits) {
        if (!slot.occupant) continue;
        const wing = slot.species.wing;
        if (wing === 'aquarium' || wing === 'oceanGallery') {
          // Fish swim a slow circuit inside their tank.
          const t = time * 0.55 + slot.phase;
          slot.occupant.position.x = Math.sin(t) * 0.42;
          slot.occupant.position.z = Math.cos(t * 0.8) * 0.28;
          slot.occupant.position.y = 1.5 + Math.sin(t * 1.7) * 0.12;
          slot.occupant.rotation.y = t + Math.PI / 2;
        } else if (wing === 'conservatory') {
          const t = time * 0.9 + slot.phase;
          slot.occupant.position.y = 1.15 + Math.sin(t * 1.6) * 0.1;
          slot.occupant.rotation.y = Math.sin(t * 0.6) * 0.6;
        } else {
          slot.occupant.rotation.y = time * 0.22 + slot.phase;
        }
      }
      refresh();
    },
  };
}

function buildExhibitSlot(wing: MuseumWing, species: SpeciesDef, index: number, total: number, accent: string): ExhibitSlot {
  const root = new Group();
  root.name = `Exhibit_${species.id}`;

  // Arrange each wing's cases in a shallow arc facing the visitor.
  const spread = Math.min(total, 6);
  const t = total <= 1 ? 0.5 : (index % spread) / Math.max(1, spread - 1);
  const row = Math.floor(index / spread);
  root.position.set(-4.2 + t * 8.4, 0, 1.6 - row * 3.2);

  const plinth = new Mesh(
    roundedBoxGeometry(1.2, 1.0, 1.0, 0.08),
    createStylizedMaterial({ color: '#6b4d3a', roughness: 0.82 }),
  );
  plinth.position.y = 0.5;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  root.add(plinth);
  const trim = new Mesh(
    roundedBoxGeometry(1.26, 0.06, 1.06, 0.04),
    createStylizedMaterial({ color: PALETTE.accent.gold, roughness: 0.4, metalness: 0.5 }),
  );
  trim.position.y = 1.0;
  root.add(trim);

  if (wing === 'aquarium' || wing === 'oceanGallery') {
    // A glass tank with visible water rather than an open case.
    const glass = new Mesh(
      new BoxGeometry(1.15, 1.15, 0.95),
      new MeshStandardMaterial({
        color: new Color('#bfe4f2'),
        transparent: true,
        opacity: 0.24,
        roughness: 0.05,
        metalness: 0.1,
      }),
    );
    glass.position.y = 1.6;
    root.add(glass);

    const water = new Mesh(
      new BoxGeometry(1.05, 0.98, 0.85),
      new MeshStandardMaterial({
        color: new Color(wing === 'aquarium' ? '#4fb0cf' : '#2f6b8f'),
        transparent: true,
        opacity: 0.34,
        roughness: 0.1,
        emissive: new Color(wing === 'aquarium' ? '#2f7f9a' : '#1f4a66'),
        emissiveIntensity: 0.4,
      }),
    );
    water.position.y = 1.58;
    root.add(water);

    const sand = new Mesh(new BoxGeometry(1.02, 0.1, 0.82), createStylizedMaterial({ color: PALETTE.sand.base, roughness: 0.95 }));
    sand.position.y = 1.1;
    root.add(sand);
  } else if (wing === 'conservatory') {
    const dome = new Mesh(
      new SphereGeometry(0.62, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      new MeshStandardMaterial({ color: new Color('#dff2e6'), transparent: true, opacity: 0.22, roughness: 0.06 }),
    );
    dome.position.y = 1.02;
    root.add(dome);
    const ring = new Mesh(new TorusGeometry(0.62, 0.03, 6, 20), createStylizedMaterial({ color: '#6f7f6a', roughness: 0.5, metalness: 0.3 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.02;
    root.add(ring);
  } else {
    const glass = new Mesh(
      new BoxGeometry(1.05, 1.0, 0.85),
      new MeshStandardMaterial({ color: new Color('#eef4f6'), transparent: true, opacity: 0.16, roughness: 0.05 }),
    );
    glass.position.y = 1.52;
    root.add(glass);
  }

  const placard = makeSign({ text: species.name, width: 1.0, height: 0.26, boardColor: '#f6f0e2', textColor: accent });
  placard.position.set(0, 0.72, 0.54);
  placard.rotation.x = -0.5;
  placard.visible = false;
  root.add(placard);
  root.userData.placard = placard;

  const caseLight = new PointLight(new Color(accent), 0, 4.2, 2);
  caseLight.position.set(0, 2.3, 0);
  root.add(caseLight);
  root.userData.caseLight = caseLight;

  return { species, root, occupant: null, phase: index * 1.7 };
}

/** The fossil hall's centrepiece, assembled progressively. */
function buildSkeleton(): Group {
  const skeleton = new Group();
  skeleton.name = 'Skeleton';
  const bone = createStylizedMaterial({ color: '#e6dcc4', roughness: 0.82 });

  // Ordered so the mount builds head-first as donations arrive.
  const spine = new Group();
  for (let i = 0; i < 9; i++) {
    const vertebra = new Mesh(new SphereGeometry(0.17, 8, 6), bone);
    vertebra.position.set(-2.2 + i * 0.55, 2.4 + Math.sin(i * 0.35) * 0.22, 0);
    vertebra.castShadow = true;
    spine.add(vertebra);
  }
  skeleton.add(spine);

  const skull = new Group();
  const cranium = new Mesh(new SphereGeometry(0.42, 12, 9), bone);
  cranium.scale.set(1.4, 0.9, 0.9);
  cranium.position.set(-3.0, 2.6, 0);
  cranium.castShadow = true;
  skull.add(cranium);
  const jaw = new Mesh(new BoxGeometry(0.9, 0.16, 0.5), bone);
  jaw.position.set(-3.1, 2.28, 0);
  skull.add(jaw);
  skeleton.add(skull);

  const ribs = new Group();
  for (let i = 0; i < 6; i++) {
    for (const side of [-1, 1]) {
      const rib = new Mesh(new TorusGeometry(0.7, 0.06, 5, 12, Math.PI * 0.85), bone);
      rib.position.set(-1.4 + i * 0.5, 2.2, side * 0.1);
      rib.rotation.set(Math.PI / 2, side * 0.3, Math.PI * 0.1);
      rib.castShadow = true;
      ribs.add(rib);
    }
  }
  skeleton.add(ribs);

  const legs = new Group();
  for (const [x, side] of [[-1.2, -1], [-1.2, 1], [1.4, -1], [1.4, 1]] as [number, number][]) {
    const upper = new Mesh(new CylinderGeometry(0.11, 0.09, 1.3, 7), bone);
    upper.position.set(x, 1.55, side * 0.55);
    upper.rotation.z = side * 0.12;
    upper.castShadow = true;
    legs.add(upper);
    const lower = new Mesh(new CylinderGeometry(0.09, 0.07, 1.0, 7), bone);
    lower.position.set(x + side * 0.1, 0.55, side * 0.62);
    lower.castShadow = true;
    legs.add(lower);
  }
  skeleton.add(legs);

  const tail = new Group();
  for (let i = 0; i < 7; i++) {
    const segment = new Mesh(new SphereGeometry(0.15 - i * 0.014, 7, 6), bone);
    segment.position.set(2.6 + i * 0.42, 2.3 - i * 0.14, 0);
    segment.castShadow = true;
    tail.add(segment);
  }
  skeleton.add(tail);

  const base = new Mesh(roundedBoxGeometry(7.5, 0.2, 3.0, 0.08), createStylizedMaterial({ color: '#3f4a52', roughness: 0.7 }));
  base.position.y = 0.1;
  base.receiveShadow = true;
  skeleton.add(base);

  return skeleton;
}

// --- Shop, town hall, villager homes -----------------------------------------

export function createShopInterior(): InteriorScene {
  const room = buildRoom({
    name: 'Store',
    width: 12,
    depth: 10,
    height: 3.8,
    floor: 'plank',
    wallColor: '#f6e6c4',
    trimColor: '#fff8e8',
    windows: 3,
    lights: [{ x: -3, z: -1 }, { x: 3, z: -1 }],
  });

  const group = new Group();
  group.add(room.group);
  const colliders: { x: number; z: number; radius: number }[] = [];

  const counter = new Mesh(roundedBoxGeometry(6.4, 1.05, 1.1, 0.1), createStylizedMaterial({ color: '#a8763f', roughness: 0.86 }));
  counter.position.set(0, 0.52, -2.6);
  counter.castShadow = true;
  counter.receiveShadow = true;
  group.add(counter);
  colliders.push({ x: 0, z: -2.6, radius: 3.2 });

  const till = new Mesh(roundedBoxGeometry(0.6, 0.4, 0.44, 0.06), createStylizedMaterial({ color: '#5d6b74', roughness: 0.45, metalness: 0.35 }));
  till.position.set(2.2, 1.25, -2.6);
  group.add(till);

  // Shelving with generic stock, so the shop looks stocked before any UI opens.
  const shelfWood = createStylizedMaterial({ color: '#b98a58', roughness: 0.88 });
  for (const side of [-1, 1]) {
    for (let level = 0; level < 3; level++) {
      const shelf = new Mesh(roundedBoxGeometry(0.6, 0.08, 6.0, 0.03), shelfWood);
      shelf.position.set(side * 5.5, 0.7 + level * 0.75, 0.4);
      shelf.castShadow = true;
      group.add(shelf);
      for (let i = 0; i < 6; i++) {
        const tints = ['#c9784f', '#7fa86a', '#7fa8c4', '#e0b45f'];
        const kitBox = (i + level) % 3 === 0
          ? makeKitMesh('props.bucket', { scale: 0.7 })
          : makeKitMesh('props.crate', { scale: 0.55, tint: softTint(tints[i % 4], 0.5) });
        if (kitBox) {
          kitBox.position.set(side * 5.5, 0.74 + level * 0.75, -2.2 + i * 0.95);
          kitBox.rotation.y = (i * 1.3) % 1.2;
          group.add(kitBox);
          continue;
        }
        const crate = new Mesh(
          roundedBoxGeometry(0.4, 0.32, 0.4, 0.04),
          createStylizedMaterial({ color: tints[i % 4], roughness: 0.9 }),
        );
        crate.position.set(side * 5.5, 0.9 + level * 0.75, -2.2 + i * 0.95);
        crate.castShadow = true;
        group.add(crate);
      }
    }
    colliders.push({ x: side * 5.5, z: 0.4, radius: 0.8 });
  }

  // Floor stock: barrels by the counter and a sack-stand of produce.
  for (const [x, z, r] of [[-3.4, -3.6, 0.3], [-2.6, -3.9, 1.1], [3.6, -3.7, 0.6]] as [number, number, number][]) {
    const barrel = makeKitMesh('props.barrel', { scale: 1.05 });
    if (!barrel) break;
    barrel.position.set(x, 0, z);
    barrel.rotation.y = r;
    group.add(barrel);
    colliders.push({ x, z, radius: 0.5 });
  }
  const shopRug = makeKitMesh('furniture.rug', { scale: 1.2, tint: '#d8b9a0' });
  if (shopRug) {
    shopRug.position.set(0, 0.005, 1.4);
    group.add(shopRug);
  }

  const sign = makeSign({ text: 'Bruno’s', width: 2.6, height: 0.6, boardColor: '#f2e2c4' });
  sign.position.set(0, 2.7, -4.7);
  group.add(sign);

  return {
    id: 'shop',
    group,
    room,
    colliders,
    anchors: { exit: room.exit.clone(), counter: new Vector3(0, 0, -1.3) },
    ambience: 'interior',
    music: 'music.shop',
    title: 'General Store',
  };
}

export function createTownHallInterior(): InteriorScene {
  const room = buildRoom({
    name: 'TownHall',
    width: 14,
    depth: 11,
    height: 4.6,
    floor: 'stone',
    wallColor: '#f2e6cf',
    trimColor: '#fdf8ea',
    windows: 4,
    lights: [{ x: -3.5, z: -1 }, { x: 3.5, z: -1 }],
  });

  const group = new Group();
  group.add(room.group);
  const colliders: { x: number; z: number; radius: number }[] = [];

  const kitDesk = makeKitMesh('furniture.desk', { scale: 1.3, tint: '#d8ddc8' });
  if (kitDesk) {
    kitDesk.position.set(0, 0, -3.4);
    kitDesk.rotation.y = Math.PI;
    group.add(kitDesk);
    const chair = makeKitMesh('furniture.chairSoft', { scale: 1.0, tint: '#c9d8bc' });
    if (chair) {
      chair.position.set(0, 0, -4.4);
      group.add(chair);
    }
    for (const side of [-1, 1]) {
      const bench = makeKitMesh('furniture.sofa', { scale: 1.0, tint: '#d2c7ae' });
      if (!bench) break;
      bench.position.set(side * 4.6, 0, 0.4);
      bench.rotation.y = -side * Math.PI / 2;
      group.add(bench);
      colliders.push({ x: side * 4.6, z: 0.4, radius: 1.1 });
    }
  } else {
    const desk = new Mesh(roundedBoxGeometry(4.4, 1.1, 1.3, 0.1), createStylizedMaterial({ color: '#7fa86a', roughness: 0.86 }));
    desk.position.set(0, 0.55, -3.4);
    desk.castShadow = true;
    group.add(desk);
  }
  colliders.push({ x: 0, z: -3.4, radius: 2.4 });

  // A model of the island on a plinth — the town-progress fantasy made literal.
  const plinth = new Mesh(new CylinderGeometry(1.5, 1.7, 0.9, 18), createStylizedMaterial({ color: '#d8d1c2', roughness: 0.92 }));
  plinth.position.set(0, 0.45, 1.6);
  plinth.castShadow = true;
  group.add(plinth);
  const island = new Mesh(new SphereGeometry(1.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), createStylizedMaterial({ color: PALETTE.grass.base, roughness: 0.9, flatShading: true }));
  island.scale.set(1, 0.32, 1);
  island.position.set(0, 0.9, 1.6);
  group.add(island);
  colliders.push({ x: 0, z: 1.6, radius: 1.8 });

  const board = makeSign({ text: 'Public Works', width: 3.0, height: 0.7, boardColor: '#f6f0e2' });
  board.position.set(0, 2.7, -5.2);
  group.add(board);

  return {
    id: 'townhall',
    group,
    room,
    colliders,
    anchors: { exit: room.exit.clone(), desk: new Vector3(0, 0, -2.0), model: new Vector3(0, 0, 3.4) },
    ambience: 'interior',
    music: 'music.townEvening',
    title: 'Town Hall',
  };
}

export function createVillagerHomeInterior(villagerId: string, accent: string): InteriorScene {
  const room = buildRoom({
    name: `Home_${villagerId}`,
    width: 8.5,
    depth: 7,
    height: 3.3,
    floor: 'plank',
    wallColor: '#f4e8d4',
    trimColor: '#fdf8ec',
    windows: 2,
    lights: [{ x: 0, z: -0.5 }],
  });

  const group = new Group();
  group.add(room.group);
  const colliders: { x: number; z: number; radius: number }[] = [];

  // A small, characterful set: bed, table, rug, and one accent piece.
  const kitBed = makeKitMesh('furniture.bed', { scale: 1.05, tint: softTint(accent, 0.5) });
  if (kitBed) {
    kitBed.position.set(-2.6, 0, -1.8);
    kitBed.rotation.y = Math.PI;
    group.add(kitBed);
    colliders.push({ x: -2.6, z: -1.8, radius: 1.2 });
    const kitTable = makeKitMesh('furniture.tableLow', { scale: 1.0 });
    if (kitTable) {
      kitTable.position.set(2.2, 0, -0.6);
      group.add(kitTable);
      colliders.push({ x: 2.2, z: -0.6, radius: 0.85 });
    }
    const kitChair = makeKitMesh('furniture.chair', { scale: 1.0 });
    if (kitChair) {
      kitChair.position.set(2.2, 0, -1.6);
      group.add(kitChair);
    }
    const rugKit = makeKitMesh('furniture.rugRound', { scale: 1.2, tint: softTint(accent, 0.6) });
    if (rugKit) {
      rugKit.position.set(0, 0.005, 1.2);
      group.add(rugKit);
    }
    const shelfKit = makeKitMesh('furniture.shelf', { scale: 0.95 });
    if (shelfKit) {
      shelfKit.position.set(0.4, 0, -3.1);
      group.add(shelfKit);
      colliders.push({ x: 0.4, z: -3.1, radius: 0.6 });
    }
    const lampKit = makeKitMesh('furniture.lampTable', { scale: 1 }) ?? makeKitMesh('furniture.lamp', { scale: 1.1 });
    if (lampKit) {
      lampKit.position.set(2.5, 0.46, -0.75);
      group.add(lampKit);
    }
    const plantKit = makeKitMesh('furniture.plant', { scale: 0.9 });
    if (plantKit) {
      plantKit.position.set(-3.4, 0, 2.2);
      group.add(plantKit);
    }
    return {
      id: `npcHome.${villagerId}`,
      group,
      room,
      colliders,
      anchors: { exit: room.exit.clone() },
      ambience: 'interior',
      music: 'music.home',
      title: 'A Neighbour’s Home',
    };
  }

  const bed = new Group();
  const frame = new Mesh(roundedBoxGeometry(1.3, 0.36, 2.1, 0.08), createStylizedMaterial({ color: '#a8763f', roughness: 0.88 }));
  frame.position.y = 0.3;
  bed.add(frame);
  const duvet = new Mesh(roundedBoxGeometry(1.24, 0.2, 1.5, 0.09), createStylizedMaterial({ color: accent, roughness: 0.9 }));
  duvet.position.set(0, 0.56, -0.24);
  bed.add(duvet);
  bed.position.set(-2.6, 0, -1.8);
  bed.traverse((c) => { (c as Mesh).castShadow = true; });
  group.add(bed);
  colliders.push({ x: -2.6, z: -1.8, radius: 1.2 });

  const table = new Mesh(roundedBoxGeometry(1.2, 0.1, 0.9, 0.05), createStylizedMaterial({ color: '#b98a58', roughness: 0.88 }));
  table.position.set(2.2, 0.74, -0.6);
  table.castShadow = true;
  group.add(table);
  for (const [dx, dz] of [[-0.5, 0.34], [0.5, 0.34], [-0.5, -0.34], [0.5, -0.34]] as [number, number][]) {
    const leg = new Mesh(new CylinderGeometry(0.05, 0.05, 0.72, 6), createStylizedMaterial({ color: '#8a6238', roughness: 0.9 }));
    leg.position.set(2.2 + dx, 0.36, -0.6 + dz);
    group.add(leg);
  }
  colliders.push({ x: 2.2, z: -0.6, radius: 0.85 });

  const rug = new Mesh(roundedBoxGeometry(2.6, 0.03, 2.0, 0.2), createStylizedMaterial({ color: accent, roughness: 0.95 }));
  rug.position.set(0, 0.016, 1.2);
  group.add(rug);

  return {
    id: `npcHome.${villagerId}`,
    group,
    room,
    colliders,
    anchors: { exit: room.exit.clone() },
    ambience: 'interior',
    music: 'music.home',
    title: 'A Neighbour’s Home',
  };
}
