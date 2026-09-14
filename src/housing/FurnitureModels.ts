import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  PointLight,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import { FURNITURE_BY_ID, type FurnitureDef } from '@/data/furniture';
import { roundedBoxGeometry } from '@/world/BuildingKit';

export interface BuiltFurniture {
  group: Group;
  light: PointLight | null;
  def: FurnitureDef;
}

/** Builds the 3D model for a furniture definition. */
export function makeFurniture(defId: string): BuiltFurniture | null {
  const def = FURNITURE_BY_ID.get(defId);
  if (!def) return null;

  const group = new Group();
  group.name = `Furniture_${def.id}`;
  const primary = createStylizedMaterial({ color: def.palette.primary, roughness: 0.85 });
  const secondary = createStylizedMaterial({ color: def.palette.secondary, roughness: 0.82 });
  const accent = createStylizedMaterial({ color: def.palette.accent, roughness: 0.7 });
  let light: PointLight | null = null;

  switch (def.kind) {
    case 'sofa': {
      const base = new Mesh(roundedBoxGeometry(1.9, 0.42, 0.9, 0.16), primary);
      base.position.y = 0.28;
      group.add(base);
      const back = new Mesh(roundedBoxGeometry(1.9, 0.62, 0.26, 0.13), primary);
      back.position.set(0, 0.72, -0.32);
      group.add(back);
      for (const dx of [-0.88, 0.88]) {
        const arm = new Mesh(roundedBoxGeometry(0.24, 0.46, 0.9, 0.11), secondary);
        arm.position.set(dx, 0.5, 0);
        group.add(arm);
      }
      for (const dx of [-0.48, 0.48]) {
        const cushion = new Mesh(roundedBoxGeometry(0.82, 0.16, 0.78, 0.08), secondary);
        cushion.position.set(dx, 0.56, 0.02);
        group.add(cushion);
      }
      for (const [dx, dz] of [[-0.8, 0.35], [0.8, 0.35], [-0.8, -0.35], [0.8, -0.35]] as [number, number][]) {
        const leg = new Mesh(new CylinderGeometry(0.05, 0.04, 0.16, 6), accent);
        leg.position.set(dx, 0.08, dz);
        group.add(leg);
      }
      break;
    }

    case 'table': {
      const top = new Mesh(roundedBoxGeometry(1.4, 0.1, 0.9, 0.05), primary);
      top.position.y = 0.74;
      group.add(top);
      for (const [dx, dz] of [[-0.6, 0.34], [0.6, 0.34], [-0.6, -0.34], [0.6, -0.34]] as [number, number][]) {
        const leg = new Mesh(new CylinderGeometry(0.055, 0.06, 0.72, 8), secondary);
        leg.position.set(dx, 0.36, dz);
        group.add(leg);
      }
      const runner = new Mesh(new BoxGeometry(1.15, 0.06, 0.06), secondary);
      runner.position.y = 0.3;
      group.add(runner);
      break;
    }

    case 'lamp': {
      const base = new Mesh(new CylinderGeometry(0.18, 0.22, 0.06, 14), secondary);
      base.position.y = 0.03;
      group.add(base);
      const stem = new Mesh(new CylinderGeometry(0.03, 0.035, 1.16, 8), secondary);
      stem.position.y = 0.62;
      group.add(stem);
      const shade = new Mesh(new CylinderGeometry(0.3, 0.19, 0.34, 16, 1, true), primary);
      shade.position.y = 1.32;
      group.add(shade);
      const bulb = new Mesh(new SphereGeometry(0.08, 10, 8), accent);
      bulb.position.y = 1.26;
      group.add(bulb);
      light = new PointLight(def.light?.color ?? '#ffd9a0', 0, 7, 2);
      light.position.y = def.light?.height ?? 1.28;
      group.add(light);
      break;
    }

    case 'rug': {
      const rug = new Mesh(roundedBoxGeometry(2.3, 0.03, 1.8, 0.2), primary);
      rug.position.y = 0.016;
      group.add(rug);
      const border = new Mesh(roundedBoxGeometry(2.0, 0.032, 1.5, 0.18), secondary);
      border.position.y = 0.02;
      group.add(border);
      const centre = new Mesh(roundedBoxGeometry(1.2, 0.034, 0.85, 0.14), accent);
      centre.position.y = 0.024;
      group.add(centre);
      break;
    }

    case 'music': {
      const box = new Mesh(roundedBoxGeometry(0.85, 0.28, 0.7, 0.06), primary);
      box.position.y = 0.6;
      group.add(box);
      const platter = new Mesh(new CylinderGeometry(0.26, 0.26, 0.02, 20), secondary);
      platter.position.set(-0.1, 0.75, 0);
      group.add(platter);
      const label = new Mesh(new CylinderGeometry(0.08, 0.08, 0.024, 14), accent);
      label.position.set(-0.1, 0.76, 0);
      group.add(label);
      const arm = new Mesh(new BoxGeometry(0.34, 0.02, 0.03), accent);
      arm.position.set(0.12, 0.78, -0.1);
      arm.rotation.y = -0.5;
      group.add(arm);
      for (const [dx, dz] of [[-0.34, 0.28], [0.34, 0.28], [-0.34, -0.28], [0.34, -0.28]] as [number, number][]) {
        const leg = new Mesh(new CylinderGeometry(0.035, 0.03, 0.46, 6), secondary);
        leg.position.set(dx, 0.23, dz);
        group.add(leg);
      }
      break;
    }

    case 'plant': {
      const pot = new Mesh(new CylinderGeometry(0.22, 0.17, 0.32, 14), secondary);
      pot.position.y = 0.16;
      group.add(pot);
      const rim = new Mesh(new TorusGeometry(0.22, 0.025, 6, 16), accent);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.32;
      group.add(rim);
      const soil = new Mesh(new CylinderGeometry(0.19, 0.19, 0.04, 14), createStylizedMaterial({ color: '#4f3620', roughness: 0.98 }));
      soil.position.y = 0.32;
      group.add(soil);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const frond = new Mesh(new SphereGeometry(0.3, 8, 5), primary);
        frond.scale.set(0.28, 0.1, 1);
        frond.position.set(Math.cos(a) * 0.2, 0.62 + (i % 2) * 0.12, Math.sin(a) * 0.2);
        frond.rotation.set(0.4, -a, 0);
        group.add(frond);
      }
      break;
    }

    case 'shelf': {
      const board = roundedBoxGeometry(1.3, 0.07, 0.32, 0.03);
      for (let i = 0; i < 2; i++) {
        const shelf = new Mesh(board, primary);
        shelf.position.set(0, 1.3 + i * 0.5, 0);
        group.add(shelf);
      }
      for (const dx of [-0.6, 0.6]) {
        const bracket = new Mesh(new BoxGeometry(0.06, 0.62, 0.28), secondary);
        bracket.position.set(dx, 1.56, 0);
        group.add(bracket);
      }
      for (let i = 0; i < 4; i++) {
        const book = new Mesh(new BoxGeometry(0.07, 0.24, 0.18), i % 2 ? accent : secondary);
        book.position.set(-0.4 + i * 0.09, 1.46, 0);
        group.add(book);
      }
      break;
    }

    case 'bed': {
      const frame = new Mesh(roundedBoxGeometry(1.4, 0.32, 2.3, 0.09), secondary);
      frame.position.y = 0.28;
      group.add(frame);
      const mattress = new Mesh(roundedBoxGeometry(1.3, 0.24, 2.1, 0.11), primary);
      mattress.position.y = 0.55;
      group.add(mattress);
      const duvet = new Mesh(roundedBoxGeometry(1.34, 0.16, 1.4, 0.1), accent);
      duvet.position.set(0, 0.7, -0.3);
      group.add(duvet);
      const pillow = new Mesh(roundedBoxGeometry(0.9, 0.16, 0.4, 0.1), primary);
      pillow.position.set(0, 0.74, 0.82);
      group.add(pillow);
      const head = new Mesh(roundedBoxGeometry(1.4, 0.8, 0.14, 0.08), secondary);
      head.position.set(0, 0.6, 1.16);
      group.add(head);
      break;
    }

    case 'chair':
    default: {
      const seat = new Mesh(roundedBoxGeometry(0.44, 0.09, 0.44, 0.05), primary);
      seat.position.y = 0.5;
      group.add(seat);
      for (const [dx, dz] of [[-0.17, 0.17], [0.17, 0.17], [-0.17, -0.17], [0.17, -0.17]] as [number, number][]) {
        const leg = new Mesh(new CylinderGeometry(0.03, 0.026, 0.5, 6), secondary);
        leg.position.set(dx, 0.25, dz);
        group.add(leg);
      }
      const ring = new Mesh(new TorusGeometry(0.19, 0.018, 5, 14), accent);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.2;
      group.add(ring);
      break;
    }
  }

  group.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });

  return { group, light, def };
}
