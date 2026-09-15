import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { makeKitMesh } from '@/assets/registry';
import { createStylizedMaterial } from '@/rendering/materials';
import { getItemDef } from '@/data/items';
import type { ItemVisual } from './types';

/**
 * Item ids with a matching food- or survival-kit model. Only true matches are
 * listed: a pear drawn as an apple would contradict its own icon, so the pear
 * stays procedural until a pear exists.
 */
const KIT_ITEMS: Record<string, { id: string; scale: number }> = {
  'mat.wood': { id: 'resource.wood', scale: 0.7 },
  'mat.stone': { id: 'resource.stone', scale: 0.7 },
  'crop.pumpkin': { id: 'item.pumpkin', scale: 0.5 },
  'crop.strawberry': { id: 'item.strawberry', scale: 0.9 },
  'meal.pearTart': { id: 'item.pie', scale: 0.55 },
  'meal.gardenStew': { id: 'item.soup', scale: 0.55 },
  'meal.seasidePlate': { id: 'item.dinner', scale: 0.55 },
};

/**
 * Small 3D representations of items, used for drops the player picks up and
 * for museum exhibits. Built from the same `visual` parameters as the 2D icons
 * so an item never looks like two different things.
 */
export function makeItemModel(defId: string, scale = 1): Group {
  const def = getItemDef(defId);
  const group = new Group();
  group.name = `Item_${defId}`;
  if (!def) return group;

  const kit = KIT_ITEMS[defId];
  const kitMesh = kit ? makeKitMesh(kit.id, { scale: kit.scale, roughness: 0.7 }) : null;
  if (kitMesh) {
    // Kit models stand on their base; item models are centred, which is what
    // drops, exhibits and the held-item pose all expect.
    kitMesh.geometry.computeBoundingBox();
    const box = kitMesh.geometry.boundingBox;
    if (box) kitMesh.position.y = -((box.max.y - box.min.y) * kit.scale) / 2;
    group.add(kitMesh);
  } else {
    buildVisual(group, def.visual);
  }
  group.scale.setScalar(scale * (def.visual.scale ?? 1));
  group.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return group;
}

function buildVisual(group: Group, visual: ItemVisual): void {
  const primary = createStylizedMaterial({ color: visual.primary, roughness: 0.72 });
  const secondary = createStylizedMaterial({ color: visual.secondary, roughness: 0.66 });
  const accent = createStylizedMaterial({ color: visual.accent ?? '#3a3a42', roughness: 0.5 });

  switch (visual.shape) {
    case 'fish':
    case 'flatfish': {
      const body = new Mesh(new SphereGeometry(0.17, 12, 9), primary);
      body.scale.set(0.5, visual.shape === 'flatfish' ? 0.34 : 0.72, 1.5);
      group.add(body);

      const tail = new Mesh(new ConeGeometry(0.12, 0.18, 5), secondary);
      tail.position.z = -0.3;
      tail.rotation.x = -Math.PI / 2;
      group.add(tail);

      const fin = new Mesh(new ConeGeometry(0.07, 0.14, 4), secondary);
      fin.position.set(0, 0.11, 0.02);
      group.add(fin);

      for (const side of [-1, 1]) {
        const eye = new Mesh(new SphereGeometry(0.026, 8, 6), accent);
        eye.position.set(side * 0.055, 0.05, 0.19);
        group.add(eye);
      }
      break;
    }

    case 'ray': {
      const body = new Mesh(new SphereGeometry(0.2, 14, 8), primary);
      body.scale.set(1.5, 0.2, 1.1);
      group.add(body);
      const tail = new Mesh(new CylinderGeometry(0.012, 0.03, 0.4, 6), primary);
      tail.position.z = -0.28;
      tail.rotation.x = Math.PI / 2;
      group.add(tail);
      break;
    }

    case 'butterfly': {
      const body = new Mesh(new CylinderGeometry(0.018, 0.014, 0.2, 6), accent);
      body.rotation.x = Math.PI / 2;
      group.add(body);
      for (const side of [-1, 1]) {
        const upper = new Mesh(new SphereGeometry(0.12, 8, 6), primary);
        upper.scale.set(1, 0.08, 0.7);
        upper.position.set(side * 0.1, 0.02, 0.03);
        upper.rotation.z = side * 0.25;
        group.add(upper);
        const lower = new Mesh(new SphereGeometry(0.08, 8, 6), secondary);
        lower.scale.set(1, 0.08, 0.7);
        lower.position.set(side * 0.08, 0, -0.08);
        group.add(lower);
      }
      break;
    }

    case 'beetle': {
      const shell = new Mesh(new SphereGeometry(0.14, 12, 9), primary);
      shell.scale.set(0.8, 0.6, 1.1);
      group.add(shell);
      const head = new Mesh(new SphereGeometry(0.07, 10, 8), accent);
      head.position.z = 0.14;
      group.add(head);
      for (const side of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const leg = new Mesh(new CylinderGeometry(0.008, 0.008, 0.1, 4), accent);
          leg.position.set(side * 0.12, -0.05, -0.06 + i * 0.07);
          leg.rotation.z = side * 0.7;
          group.add(leg);
        }
      }
      break;
    }

    case 'dragonfly': {
      const body = new Mesh(new CylinderGeometry(0.02, 0.012, 0.34, 6), primary);
      body.rotation.x = Math.PI / 2;
      group.add(body);
      const head = new Mesh(new SphereGeometry(0.045, 10, 8), accent);
      head.position.z = 0.18;
      group.add(head);
      for (const side of [-1, 1]) {
        for (const dz of [0.06, -0.04]) {
          const wing = new Mesh(new SphereGeometry(0.13, 8, 5), secondary);
          wing.scale.set(1, 0.04, 0.28);
          wing.position.set(side * 0.13, 0.02, dz);
          group.add(wing);
        }
      }
      break;
    }

    case 'shell': {
      const shell = new Mesh(new SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), primary);
      shell.scale.set(1, 0.7, 1);
      group.add(shell);
      const rim = new Mesh(new TorusGeometry(0.16, 0.016, 6, 18), secondary);
      rim.rotation.x = Math.PI / 2;
      group.add(rim);
      break;
    }

    case 'ammonite': {
      // A stack of shrinking, offset rings approximates the spiral cheaply.
      for (let i = 0; i < 7; i++) {
        const t = i / 7;
        const radius = 0.2 * (1 - t * 0.8);
        const ring = new Mesh(new TorusGeometry(radius, 0.035 * (1 - t * 0.6), 6, 14), i % 2 ? primary : secondary);
        const angle = t * Math.PI * 2.2;
        ring.position.set(Math.cos(angle) * 0.05 * t, 0, Math.sin(angle) * 0.05 * t);
        group.add(ring);
      }
      break;
    }

    case 'star': {
      const core = new Mesh(new SphereGeometry(0.07, 10, 8), primary);
      core.scale.y = 0.4;
      group.add(core);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const arm = new Mesh(new ConeGeometry(0.055, 0.2, 6), primary);
        arm.position.set(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12);
        arm.rotation.set(Math.PI / 2, 0, -a);
        arm.scale.y = 1;
        group.add(arm);
      }
      break;
    }

    case 'jelly': {
      const bell = new Mesh(new SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), primary);
      bell.scale.y = 0.8;
      group.add(bell);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const tentacle = new Mesh(new CylinderGeometry(0.008, 0.004, 0.22, 4), secondary);
        tentacle.position.set(Math.cos(a) * 0.1, -0.11, Math.sin(a) * 0.1);
        group.add(tentacle);
      }
      break;
    }

    case 'bone': {
      const shaft = new Mesh(new CylinderGeometry(0.035, 0.035, 0.34, 8), primary);
      shaft.rotation.z = Math.PI / 3;
      group.add(shaft);
      for (const dir of [-1, 1]) {
        for (const offset of [-0.04, 0.04]) {
          const knob = new Mesh(new SphereGeometry(0.05, 8, 6), secondary);
          knob.position.set(dir * 0.15 + offset * 0.5, dir * 0.085, offset);
          group.add(knob);
        }
      }
      break;
    }

    case 'leaf': {
      const leaf = new Mesh(new SphereGeometry(0.18, 10, 7), primary);
      leaf.scale.set(0.55, 0.06, 1);
      group.add(leaf);
      const stem = new Mesh(new CylinderGeometry(0.008, 0.008, 0.3, 4), secondary);
      stem.rotation.x = Math.PI / 2;
      group.add(stem);
      break;
    }

    case 'root': {
      const bulb = new Mesh(new SphereGeometry(0.15, 12, 10), primary);
      bulb.scale.y = 1.2;
      group.add(bulb);
      const top = new Mesh(new SphereGeometry(0.13, 12, 8), secondary);
      top.position.y = 0.1;
      top.scale.y = 0.5;
      group.add(top);
      for (let i = -1; i <= 1; i++) {
        const leaf = new Mesh(new ConeGeometry(0.045, 0.18, 5), accent);
        leaf.position.set(i * 0.05, 0.2, 0);
        leaf.rotation.z = i * 0.4;
        group.add(leaf);
      }
      break;
    }

    case 'berry': {
      const berry = new Mesh(new SphereGeometry(0.13, 12, 10), primary);
      berry.scale.y = 1.15;
      group.add(berry);
      const calyx = new Mesh(new ConeGeometry(0.09, 0.06, 6), accent);
      calyx.position.y = 0.13;
      calyx.rotation.x = Math.PI;
      group.add(calyx);
      break;
    }

    case 'gourd': {
      const body = new Mesh(new SphereGeometry(0.2, 14, 12), primary);
      body.scale.set(1.2, 0.9, 1.2);
      group.add(body);
      for (let i = 0; i < 4; i++) {
        const rib = new Mesh(new TorusGeometry(0.2, 0.018, 5, 14, Math.PI), secondary);
        rib.rotation.set(Math.PI / 2, 0, (i / 4) * Math.PI);
        rib.scale.set(1.2, 1.2, 0.9);
        group.add(rib);
      }
      const stem = new Mesh(new CylinderGeometry(0.022, 0.03, 0.1, 6), accent);
      stem.position.y = 0.2;
      group.add(stem);
      break;
    }

    case 'log': {
      const log = new Mesh(new CylinderGeometry(0.09, 0.09, 0.36, 9), primary);
      log.rotation.z = Math.PI / 2;
      group.add(log);
      for (const dx of [-0.18, 0.18]) {
        const end = new Mesh(new CylinderGeometry(0.091, 0.091, 0.01, 9), secondary);
        end.position.x = dx;
        end.rotation.z = Math.PI / 2;
        group.add(end);
      }
      break;
    }

    case 'stone': {
      const rock = new Mesh(new IcosahedronGeometry(0.16, 0), primary);
      rock.scale.set(1.15, 0.85, 1);
      group.add(rock);
      break;
    }

    case 'mushroom': {
      const stalk = new Mesh(new CylinderGeometry(0.045, 0.065, 0.2, 8), secondary);
      stalk.position.y = -0.04;
      group.add(stalk);
      const cap = new Mesh(new SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), primary);
      cap.scale.y = 0.72;
      cap.position.y = 0.06;
      group.add(cap);
      const gills = new Mesh(new CylinderGeometry(0.125, 0.125, 0.02, 12), accent);
      gills.position.y = 0.05;
      group.add(gills);
      break;
    }

    case 'fiber': {
      for (let i = -1; i <= 1; i++) {
        const strand = new Mesh(new CylinderGeometry(0.014, 0.008, 0.3, 5), primary);
        strand.position.x = i * 0.04;
        strand.rotation.z = i * 0.22;
        group.add(strand);
      }
      const tie = new Mesh(new TorusGeometry(0.06, 0.014, 5, 12), secondary);
      tie.rotation.x = Math.PI / 2;
      group.add(tie);
      break;
    }

    case 'dish': {
      const plate = new Mesh(new CylinderGeometry(0.2, 0.17, 0.035, 18), createStylizedMaterial({ color: '#f4f0e6', roughness: 0.4 }));
      group.add(plate);
      const food = new Mesh(new SphereGeometry(0.11, 12, 9), primary);
      food.position.y = 0.05;
      food.scale.y = 0.55;
      group.add(food);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const garnish = new Mesh(new SphereGeometry(0.035, 8, 6), secondary);
        garnish.position.set(Math.cos(a) * 0.08, 0.08, Math.sin(a) * 0.08);
        group.add(garnish);
      }
      break;
    }

    case 'seed': {
      const packet = new Mesh(new BoxGeometry(0.16, 0.2, 0.03), primary);
      group.add(packet);
      const flap = new Mesh(new BoxGeometry(0.16, 0.06, 0.032), secondary);
      flap.position.y = 0.08;
      group.add(flap);
      break;
    }

    default: {
      const box = new Mesh(new IcosahedronGeometry(0.15, 0), primary);
      group.add(box);
      break;
    }
  }
}
