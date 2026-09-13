import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import { PALETTE } from '@/rendering/palette';

export type ToolId = 'none' | 'rod' | 'net' | 'shovel' | 'axe' | 'wateringCan';

export interface ToolDisplay {
  id: ToolId;
  name: string;
  /** Verb shown on the HUD tool wheel. */
  verb: string;
}

export const TOOLS: ToolDisplay[] = [
  { id: 'rod', name: 'Fishing Rod', verb: 'Cast' },
  { id: 'net', name: 'Bug Net', verb: 'Swing' },
  { id: 'shovel', name: 'Shovel', verb: 'Dig' },
  { id: 'axe', name: 'Axe', verb: 'Chop' },
  { id: 'wateringCan', name: 'Watering Can', verb: 'Water' },
];

/**
 * Held tool models. Each returns a group oriented so it sits naturally in the
 * hand anchor, with the working end pointing away from the character.
 */
export function makeTool(id: ToolId, level = 1): Group {
  const group = new Group();
  group.name = `Tool_${id}`;
  if (id === 'none') return group;

  const wood = createStylizedMaterial({ color: PALETTE.wood.beam, roughness: 0.9 });
  // Upgraded tools get brighter metal, so the investment is visible in-world.
  const metalColor = level >= 3 ? '#e8d9a8' : level >= 2 ? '#c8ccd0' : '#9aa4a8';
  const metal = createStylizedMaterial({ color: metalColor, roughness: 0.38, metalness: 0.55 });

  switch (id) {
    case 'rod': {
      const grip = new Mesh(new CylinderGeometry(0.028, 0.034, 0.28, 8), createStylizedMaterial({ color: '#5f4630', roughness: 0.85 }));
      grip.position.y = 0.06;
      group.add(grip);

      const shaft = new Mesh(new CylinderGeometry(0.008, 0.022, 1.55, 8), wood);
      shaft.position.y = 0.92;
      group.add(shaft);

      const reel = new Mesh(new CylinderGeometry(0.06, 0.06, 0.05, 12), metal);
      reel.position.set(0.055, 0.24, 0);
      reel.rotation.z = Math.PI / 2;
      group.add(reel);

      const handle = new Mesh(new SphereGeometry(0.022, 8, 6), metal);
      handle.position.set(0.1, 0.24, 0.05);
      group.add(handle);

      for (let i = 0; i < 3; i++) {
        const ring = new Mesh(new TorusGeometry(0.022, 0.005, 5, 10), metal);
        ring.position.y = 0.6 + i * 0.42;
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
      }
      break;
    }

    case 'net': {
      const handle = new Mesh(new CylinderGeometry(0.022, 0.028, 0.95, 8), wood);
      handle.position.y = 0.42;
      group.add(handle);

      const hoopRadius = 0.2 + level * 0.03;
      const hoop = new Mesh(new TorusGeometry(hoopRadius, 0.016, 6, 20), metal);
      hoop.position.y = 1.0;
      hoop.rotation.x = Math.PI / 2.6;
      group.add(hoop);

      const mesh = new Mesh(
        new ConeGeometry(hoopRadius * 0.96, 0.34, 14, 1, true),
        createStylizedMaterial({ color: '#eef4f0', roughness: 0.95, transparent: true, opacity: 0.55, side: undefined }),
      );
      mesh.position.set(0, 0.86, -0.06);
      mesh.rotation.x = Math.PI - Math.PI / 2.6;
      group.add(mesh);
      break;
    }

    case 'shovel': {
      const handle = new Mesh(new CylinderGeometry(0.024, 0.03, 1.0, 8), wood);
      handle.position.y = 0.46;
      group.add(handle);

      const grip = new Mesh(new TorusGeometry(0.055, 0.018, 6, 12), wood);
      grip.position.y = 0.98;
      grip.rotation.x = Math.PI / 2;
      group.add(grip);

      const blade = new Mesh(new BoxGeometry(0.22 + level * 0.02, 0.26, 0.03), metal);
      blade.position.y = -0.1;
      blade.rotation.x = 0.14;
      group.add(blade);

      const tip = new Mesh(new ConeGeometry(0.11 + level * 0.01, 0.12, 4), metal);
      tip.position.y = -0.28;
      tip.rotation.set(0.14, Math.PI / 4, Math.PI);
      group.add(tip);
      break;
    }

    case 'axe': {
      const handle = new Mesh(new CylinderGeometry(0.026, 0.032, 0.82, 8), wood);
      handle.position.y = 0.34;
      group.add(handle);

      const head = new Mesh(new BoxGeometry(0.1, 0.2, 0.06), metal);
      head.position.y = 0.72;
      group.add(head);

      const edge = new Mesh(new ConeGeometry(0.14 + level * 0.015, 0.16, 3), metal);
      edge.position.set(0.11, 0.72, 0);
      edge.rotation.z = -Math.PI / 2;
      group.add(edge);
      break;
    }

    case 'wateringCan': {
      const body = new Mesh(new CylinderGeometry(0.15, 0.17, 0.26, 14), metal);
      body.position.y = 0.16;
      group.add(body);

      const handle = new Mesh(new TorusGeometry(0.1, 0.016, 6, 14, Math.PI), metal);
      handle.position.set(0, 0.33, 0);
      handle.rotation.z = Math.PI;
      group.add(handle);

      const spout = new Mesh(new CapsuleGeometry(0.028, 0.28, 4, 8), metal);
      spout.position.set(0.2, 0.24, 0);
      spout.rotation.z = -0.9;
      group.add(spout);

      const rose = new Mesh(new CylinderGeometry(0.07, 0.05, 0.05, 10), metal);
      rose.position.set(0.36, 0.36, 0);
      rose.rotation.z = -0.9;
      group.add(rose);
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

  // Sit the tool in the hand rather than sprouting from the wrist.
  group.rotation.set(-0.35, 0, -0.2);
  group.position.set(0, -0.06, 0.04);
  return group;
}
