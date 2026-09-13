import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { createStylizedMaterial } from '@/rendering/materials';
import type { CharacterLook, HairStyleId, HatId, OutfitId, ShoeId } from '@/data/clothing';
import { OUTFITS } from '@/data/clothing';
import type { VillagerLook } from '@/data/villagers';
import { PALETTE } from '@/rendering/palette';
import { roundedBoxGeometry } from '@/world/BuildingKit';

/** Every joint the animator can drive. */
export type JointName =
  | 'root'
  | 'hips'
  | 'torso'
  | 'neck'
  | 'head'
  | 'shoulderL' | 'elbowL' | 'handL'
  | 'shoulderR' | 'elbowR' | 'handR'
  | 'hipL' | 'kneeL' | 'footL'
  | 'hipR' | 'kneeR' | 'footR'
  | 'tail'
  | 'earL' | 'earR';

export type Expression = 'neutral' | 'happy' | 'surprised' | 'sad' | 'determined' | 'sleepy' | 'excited';

export interface RigOptions {
  /** Overall height in metres. */
  height?: number;
  /** Villager rigs get a muzzle, ears and a tail. */
  villager?: VillagerLook;
}

const REST_ROTATIONS: Partial<Record<JointName, [number, number, number]>> = {
  shoulderL: [0, 0, 0.22],
  shoulderR: [0, 0, -0.22],
  elbowL: [0, 0, 0.12],
  elbowR: [0, 0, -0.12],
};

/**
 * A stylised character built entirely from primitives.
 *
 * The rig is a plain Object3D hierarchy rather than a skinned mesh: it costs
 * nothing to author, every joint is addressable by name, and customisation is
 * a matter of swapping child meshes and material colours. When production GLTF
 * characters arrive they can be parented to the same joint names and the
 * animator will not change.
 */
export class CharacterRig {
  readonly group = new Group();
  readonly joints = {} as Record<JointName, Object3D>;
  /** Attach point for held tools, in the right hand. */
  readonly toolAnchor = new Object3D();

  readonly height: number;
  private readonly isVillager: boolean;

  private skinMaterial: MeshStandardMaterial;
  private hairMaterial: MeshStandardMaterial;
  private shirtMaterial: MeshStandardMaterial;
  private lowerMaterial: MeshStandardMaterial;
  private shoeMaterial: MeshStandardMaterial;
  private hatMaterial: MeshStandardMaterial;

  private hairGroup = new Group();
  private hatGroup = new Group();
  private lowerGroup = new Group();
  private eyeL!: Mesh;
  private eyeR!: Mesh;
  private pupilL!: Mesh;
  private pupilR!: Mesh;
  private browL!: Mesh;
  private browR!: Mesh;
  private mouth!: Mesh;
  private blushL!: Mesh;
  private blushR!: Mesh;

  private blinkTimer = 2 + Math.random() * 3;
  private blinkProgress = 1;
  private expression: Expression = 'neutral';
  private expressionBlend = 0;
  private targetExpression: Expression = 'neutral';

  constructor(options: RigOptions = {}) {
    this.height = options.height ?? 1.62;
    this.isVillager = !!options.villager;
    const v = options.villager;

    this.skinMaterial = createStylizedMaterial({ color: v?.fur ?? '#f0c7a4', roughness: 0.82, wetResponse: 0.25 });
    this.hairMaterial = createStylizedMaterial({ color: '#593f36', roughness: 0.72, wetResponse: 0.5 });
    this.shirtMaterial = createStylizedMaterial({ color: v?.outfit ?? '#405b9d', roughness: 0.88, wetResponse: 0.5 });
    this.lowerMaterial = createStylizedMaterial({ color: v?.outfit ?? '#3d4a6b', roughness: 0.9, wetResponse: 0.5 });
    this.shoeMaterial = createStylizedMaterial({ color: '#6b4a2c', roughness: 0.7 });
    this.hatMaterial = createStylizedMaterial({ color: '#e3cfa4', roughness: 0.85 });

    this.buildSkeleton(v);
    this.applyRestPose();
  }

  private makeJoint(name: JointName, parent: Object3D, x = 0, y = 0, z = 0): Object3D {
    const joint = new Object3D();
    joint.name = name;
    joint.position.set(x, y, z);
    parent.add(joint);
    this.joints[name] = joint;
    return joint;
  }

  private buildSkeleton(v?: VillagerLook): void {
    const h = this.height;
    const scale = v ? v.height : 1;
    const girth = v ? v.girth : 1;

    // Proportions are deliberately a little stylised: a slightly large head and
    // short limbs read better at the game's camera distance than realistic
    // ratios, without tipping into anyone else's house style.
    const hipY = h * 0.47 * scale;
    const torsoLength = h * 0.26 * scale;
    const headRadius = h * 0.165 * scale;
    const upperArm = h * 0.16 * scale;
    const foreArm = h * 0.15 * scale;
    const thigh = h * 0.22 * scale;
    const shin = h * 0.21 * scale;

    const root = this.makeJoint('root', this.group);
    const hips = this.makeJoint('hips', root, 0, hipY, 0);
    const torso = this.makeJoint('torso', hips, 0, 0, 0);
    const neck = this.makeJoint('neck', torso, 0, torsoLength, 0);
    const head = this.makeJoint('head', neck, 0, headRadius * 0.62, 0);

    // --- Torso -------------------------------------------------------------
    const torsoMesh = new Mesh(
      roundedBoxGeometry(h * 0.24 * girth * scale, torsoLength, h * 0.15 * girth * scale, h * 0.05),
      this.shirtMaterial,
    );
    torsoMesh.position.y = 0;
    this.dress(torsoMesh);
    torso.add(torsoMesh);

    // A collar band breaks up the torso silhouette.
    const collar = new Mesh(
      new CylinderGeometry(h * 0.075 * girth * scale, h * 0.085 * girth * scale, h * 0.028, 12),
      this.shirtMaterial,
    );
    collar.position.y = torsoLength - h * 0.01;
    this.dress(collar);
    torso.add(collar);

    // --- Head --------------------------------------------------------------
    const headMesh = new Mesh(new SphereGeometry(headRadius, 20, 16), this.skinMaterial);
    headMesh.scale.set(1, 1.06, 0.96);
    this.dress(headMesh);
    head.add(headMesh);

    const jaw = new Mesh(new SphereGeometry(headRadius * 0.82, 16, 12), this.skinMaterial);
    jaw.position.y = -headRadius * 0.3;
    jaw.scale.set(0.94, 0.72, 0.92);
    this.dress(jaw);
    head.add(jaw);

    if (v) this.buildAnimalFeatures(head, headRadius, v);
    this.buildFace(head, headRadius, !!v);

    head.add(this.hairGroup);
    head.add(this.hatGroup);

    // --- Arms --------------------------------------------------------------
    const shoulderX = h * 0.115 * girth * scale;
    const shoulderY = torsoLength * 0.86;
    for (const side of [-1, 1]) {
      const suffix = side < 0 ? 'L' : 'R';
      const shoulder = this.makeJoint(`shoulder${suffix}` as JointName, torso, side * shoulderX, shoulderY, 0);
      const upper = new Mesh(new CapsuleGeometry(h * 0.036 * girth, upperArm * 0.72, 4, 10), this.shirtMaterial);
      upper.position.y = -upperArm / 2;
      this.dress(upper);
      shoulder.add(upper);

      const cap = new Mesh(new SphereGeometry(h * 0.045 * girth, 12, 10), this.shirtMaterial);
      this.dress(cap);
      shoulder.add(cap);

      const elbow = this.makeJoint(`elbow${suffix}` as JointName, shoulder, 0, -upperArm, 0);
      const fore = new Mesh(new CapsuleGeometry(h * 0.031 * girth, foreArm * 0.7, 4, 10), this.skinMaterial);
      fore.position.y = -foreArm / 2;
      this.dress(fore);
      elbow.add(fore);

      const hand = this.makeJoint(`hand${suffix}` as JointName, elbow, 0, -foreArm, 0);
      const handMesh = new Mesh(new SphereGeometry(h * 0.042, 12, 10), this.skinMaterial);
      handMesh.scale.set(1, 1.1, 0.82);
      this.dress(handMesh);
      hand.add(handMesh);

      if (side > 0) {
        this.toolAnchor.position.set(0, -h * 0.02, h * 0.03);
        hand.add(this.toolAnchor);
      }
    }

    // --- Legs --------------------------------------------------------------
    hips.add(this.lowerGroup);
    const hipX = h * 0.055 * girth * scale;
    for (const side of [-1, 1]) {
      const suffix = side < 0 ? 'L' : 'R';
      const hip = this.makeJoint(`hip${suffix}` as JointName, hips, side * hipX, 0, 0);
      const thighMesh = new Mesh(new CapsuleGeometry(h * 0.042 * girth, thigh * 0.66, 4, 10), this.lowerMaterial);
      thighMesh.position.y = -thigh / 2;
      this.dress(thighMesh);
      hip.add(thighMesh);

      const knee = this.makeJoint(`knee${suffix}` as JointName, hip, 0, -thigh, 0);
      const shinMesh = new Mesh(new CapsuleGeometry(h * 0.036 * girth, shin * 0.68, 4, 10), this.lowerMaterial);
      shinMesh.position.y = -shin / 2;
      shinMesh.name = 'shin';
      this.dress(shinMesh);
      knee.add(shinMesh);

      const foot = this.makeJoint(`foot${suffix}` as JointName, knee, 0, -shin, 0);
      const footMesh = new Mesh(roundedBoxGeometry(h * 0.072, h * 0.05, h * 0.13, h * 0.02), this.shoeMaterial);
      footMesh.position.set(0, -h * 0.025, h * 0.022);
      this.dress(footMesh);
      foot.add(footMesh);
    }

    if (v?.tailStyle && v.tailStyle !== 'none') this.buildTail(hips, h, v);

    this.group.name = 'Character';
  }

  private buildAnimalFeatures(head: Object3D, headRadius: number, v: VillagerLook): void {
    const creamMaterial = createStylizedMaterial({ color: v.cream, roughness: 0.85 });

    // Muzzle — the single biggest cue that these are animal neighbours rather
    // than reskinned humans.
    const muzzle = new Mesh(new SphereGeometry(headRadius * 0.46, 14, 12), creamMaterial);
    muzzle.position.set(0, -headRadius * 0.22, headRadius * 0.78);
    muzzle.scale.set(1.15, 0.82, 0.9);
    this.dress(muzzle);
    head.add(muzzle);

    const nose = new Mesh(new SphereGeometry(headRadius * 0.13, 10, 8), createStylizedMaterial({ color: '#4a3830', roughness: 0.5 }));
    nose.position.set(0, -headRadius * 0.1, headRadius * 1.06);
    nose.scale.set(1.3, 0.9, 0.9);
    head.add(nose);

    // Ears, per species silhouette.
    for (const side of [-1, 1]) {
      const suffix = side < 0 ? 'L' : 'R';
      const ear = this.makeJoint(`ear${suffix}` as JointName, head, side * headRadius * 0.62, headRadius * 0.72, 0);
      let mesh: Mesh;
      switch (v.earStyle) {
        case 'long':
          mesh = new Mesh(new CapsuleGeometry(headRadius * 0.16, headRadius * 0.9, 4, 8), this.skinMaterial);
          mesh.position.y = headRadius * 0.62;
          ear.rotation.z = side * 0.18;
          break;
        case 'tuft':
          mesh = new Mesh(new ConeGeometry(headRadius * 0.26, headRadius * 0.62, 8), this.skinMaterial);
          mesh.position.y = headRadius * 0.3;
          ear.rotation.z = side * 0.32;
          break;
        case 'feathered':
          mesh = new Mesh(new ConeGeometry(headRadius * 0.3, headRadius * 0.5, 6), this.skinMaterial);
          mesh.position.y = headRadius * 0.24;
          ear.rotation.z = side * 0.5;
          break;
        case 'round':
        default:
          mesh = new Mesh(new SphereGeometry(headRadius * 0.32, 12, 10), this.skinMaterial);
          mesh.scale.set(1, 1, 0.62);
          break;
      }
      this.dress(mesh);
      ear.add(mesh);

      const inner = new Mesh(mesh.geometry, creamMaterial);
      inner.position.copy(mesh.position);
      inner.scale.copy(mesh.scale).multiplyScalar(0.66);
      inner.position.z += headRadius * 0.06;
      ear.add(inner);
    }

    if (v.accessory === 'spectacles') {
      const frame = createStylizedMaterial({ color: '#3a3a42', roughness: 0.4, metalness: 0.4 });
      for (const side of [-1, 1]) {
        const lens = new Mesh(new TorusGeometry(headRadius * 0.26, headRadius * 0.035, 6, 16), frame);
        lens.position.set(side * headRadius * 0.34, headRadius * 0.06, headRadius * 0.88);
        head.add(lens);
      }
      const bridge = new Mesh(new BoxGeometry(headRadius * 0.22, headRadius * 0.03, headRadius * 0.03), frame);
      bridge.position.set(0, headRadius * 0.06, headRadius * 0.9);
      head.add(bridge);
    }
  }

  private buildTail(hips: Object3D, h: number, v: VillagerLook): void {
    const tail = this.makeJoint('tail', hips, 0, -h * 0.02, -h * 0.075);
    let mesh: Mesh;
    if (v.tailStyle === 'bushy') {
      mesh = new Mesh(new CapsuleGeometry(h * 0.062, h * 0.2, 5, 12), this.skinMaterial);
      mesh.position.set(0, h * 0.14, -h * 0.03);
      mesh.rotation.x = -0.5;
      tail.rotation.x = 0.35;
    } else if (v.tailStyle === 'puff') {
      mesh = new Mesh(new SphereGeometry(h * 0.055, 12, 10), createStylizedMaterial({ color: v.cream, roughness: 0.9 }));
      mesh.position.set(0, h * 0.02, -h * 0.02);
    } else {
      mesh = new Mesh(new SphereGeometry(h * 0.035, 10, 8), this.skinMaterial);
      mesh.position.set(0, 0, -h * 0.01);
    }
    this.dress(mesh);
    tail.add(mesh);
  }

  private buildFace(head: Object3D, r: number, villager: boolean): void {
    const faceZ = villager ? r * 0.86 : r * 0.9;
    const eyeX = r * 0.36;
    const eyeY = r * 0.1;

    const whiteMaterial = createStylizedMaterial({ color: '#ffffff', roughness: 0.35 });
    const pupilMaterial = createStylizedMaterial({ color: '#2b2a33', roughness: 0.3 });

    const makeEye = (side: number) => {
      const white = new Mesh(new SphereGeometry(r * 0.15, 12, 10), whiteMaterial);
      white.position.set(side * eyeX, eyeY, faceZ);
      white.scale.set(1, 1.12, 0.55);
      head.add(white);

      const pupil = new Mesh(new SphereGeometry(r * 0.088, 10, 8), pupilMaterial);
      pupil.position.set(side * eyeX, eyeY, faceZ + r * 0.06);
      pupil.scale.set(1, 1.15, 0.6);
      head.add(pupil);

      // A single specular dot does more for character than any shader.
      const glint = new Mesh(new SphereGeometry(r * 0.03, 6, 6), whiteMaterial);
      glint.position.set(side * eyeX + r * 0.035, eyeY + r * 0.045, faceZ + r * 0.1);
      head.add(glint);

      return { white, pupil };
    };

    const left = makeEye(-1);
    const right = makeEye(1);
    this.eyeL = left.white;
    this.eyeR = right.white;
    this.pupilL = left.pupil;
    this.pupilR = right.pupil;

    const browMaterial = createStylizedMaterial({ color: '#4a3830', roughness: 0.7 });
    this.browL = new Mesh(roundedBoxGeometry(r * 0.26, r * 0.05, r * 0.05, r * 0.02), browMaterial);
    this.browL.position.set(-eyeX, eyeY + r * 0.3, faceZ + r * 0.02);
    head.add(this.browL);
    this.browR = this.browL.clone();
    this.browR.position.x = eyeX;
    head.add(this.browR);

    this.mouth = new Mesh(new SphereGeometry(r * 0.09, 10, 8), createStylizedMaterial({ color: '#8a4a48', roughness: 0.55 }));
    this.mouth.position.set(0, -r * (villager ? 0.16 : 0.3), faceZ + (villager ? r * 0.32 : r * 0.04));
    this.mouth.scale.set(1.4, 0.5, 0.5);
    head.add(this.mouth);

    const blushMaterial = new MeshStandardMaterial({
      color: new Color('#f08a90'),
      roughness: 0.9,
      transparent: true,
      opacity: 0.32,
    });
    this.blushL = new Mesh(new SphereGeometry(r * 0.14, 10, 8), blushMaterial);
    this.blushL.position.set(-r * 0.56, -r * 0.1, faceZ * 0.82);
    this.blushL.scale.set(1, 0.62, 0.3);
    head.add(this.blushL);
    this.blushR = this.blushL.clone();
    this.blushR.position.x = r * 0.56;
    head.add(this.blushR);
  }

  private dress(mesh: Mesh): void {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  applyRestPose(): void {
    for (const [name, rotation] of Object.entries(REST_ROTATIONS)) {
      const joint = this.joints[name as JointName];
      if (joint) joint.rotation.set(rotation[0], rotation[1], rotation[2]);
    }
  }

  // --- Customisation -------------------------------------------------------

  setLook(look: CharacterLook): void {
    this.skinMaterial.color.set(look.skin);
    this.hairMaterial.color.set(look.hairColor);
    this.shirtMaterial.color.set(look.shirtColor);
    this.lowerMaterial.color.set(look.lowerColor);
    this.shoeMaterial.color.set(look.shoeColor);
    this.hatMaterial.color.set(look.hatColor);

    this.setHair(look.hairStyle);
    this.setHat(look.hat);
    this.setOutfit(look.outfit);
    this.setShoes(look.shoes);
  }

  private clearGroup(group: Group): void {
    while (group.children.length > 0) {
      const child = group.children[0] as Mesh;
      group.remove(child);
      if (child.isMesh) child.geometry.dispose();
    }
  }

  setHair(style: HairStyleId): void {
    this.clearGroup(this.hairGroup);
    if (this.isVillager) return;
    const r = this.height * 0.165;
    const add = (mesh: Mesh, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      this.dress(mesh);
      this.hairGroup.add(mesh);
    };

    // A skull cap under every style keeps the hairline consistent.
    const cap = new Mesh(new SphereGeometry(r * 1.06, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), this.hairMaterial);
    add(cap, 0, r * 0.06, -r * 0.02, 1, 1.02, 1);

    switch (style) {
      case 'crop':
        break;
      case 'bob':
        add(new Mesh(new SphereGeometry(r * 1.02, 16, 12), this.hairMaterial), 0, -r * 0.12, -r * 0.04, 1.04, 0.86, 1.02);
        break;
      case 'wave':
        add(new Mesh(new SphereGeometry(r * 0.5, 12, 10), this.hairMaterial), -r * 0.62, r * 0.42, r * 0.5, 1.1, 0.8, 0.8);
        add(new Mesh(new SphereGeometry(r * 0.42, 12, 10), this.hairMaterial), r * 0.66, r * 0.5, r * 0.42, 1, 0.8, 0.8);
        add(new Mesh(new SphereGeometry(r * 0.86, 14, 12), this.hairMaterial), 0, -r * 0.28, -r * 0.36, 1.0, 0.9, 0.8);
        break;
      case 'bun':
        add(new Mesh(new SphereGeometry(r * 0.44, 14, 12), this.hairMaterial), 0, r * 1.0, -r * 0.22);
        break;
      case 'braids':
        for (const side of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            add(
              new Mesh(new SphereGeometry(r * 0.2, 10, 8), this.hairMaterial),
              side * r * 0.92, -r * (0.1 + i * 0.34), -r * 0.05, 1, 1.1, 1,
            );
          }
        }
        break;
      case 'curls':
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          add(
            new Mesh(new SphereGeometry(r * 0.34, 10, 8), this.hairMaterial),
            Math.cos(a) * r * 0.78, r * 0.42 + Math.sin(i * 1.7) * r * 0.18, Math.sin(a) * r * 0.7,
          );
        }
        break;
      case 'ponytail':
        add(new Mesh(new CapsuleGeometry(r * 0.24, r * 0.8, 4, 10), this.hairMaterial), 0, -r * 0.34, -r * 0.92, 1, 1, 1);
        add(new Mesh(new SphereGeometry(r * 0.28, 10, 8), this.hairMaterial), 0, r * 0.5, -r * 0.6);
        break;
    }
  }

  setHat(hat: HatId): void {
    this.clearGroup(this.hatGroup);
    if (hat === 'none') return;
    const r = this.height * 0.165;

    switch (hat) {
      case 'strawHat': {
        const brim = new Mesh(new CylinderGeometry(r * 1.95, r * 2.05, r * 0.08, 20), this.hatMaterial);
        brim.position.y = r * 0.82;
        const crown = new Mesh(new SphereGeometry(r * 1.02, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.hatMaterial);
        crown.position.y = r * 0.84;
        crown.scale.y = 0.7;
        const band = new Mesh(new TorusGeometry(r * 1.0, r * 0.09, 6, 18), createStylizedMaterial({ color: '#b8543f', roughness: 0.8 }));
        band.rotation.x = Math.PI / 2;
        band.position.y = r * 0.92;
        [brim, crown, band].forEach((m) => { this.dress(m); this.hatGroup.add(m); });
        break;
      }
      case 'beanie': {
        const cap = new Mesh(new SphereGeometry(r * 1.14, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), this.hatMaterial);
        cap.position.y = r * 0.16;
        const cuff = new Mesh(new CylinderGeometry(r * 1.16, r * 1.16, r * 0.28, 18), this.hatMaterial);
        cuff.position.y = r * 0.5;
        const pom = new Mesh(new SphereGeometry(r * 0.28, 10, 8), this.hatMaterial);
        pom.position.y = r * 1.3;
        [cap, cuff, pom].forEach((m) => { this.dress(m); this.hatGroup.add(m); });
        break;
      }
      case 'capBackwards': {
        const cap = new Mesh(new SphereGeometry(r * 1.1, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), this.hatMaterial);
        cap.position.y = r * 0.22;
        const peak = new Mesh(new CylinderGeometry(r * 0.95, r * 0.95, r * 0.07, 16, 1, false, 0, Math.PI), this.hatMaterial);
        peak.position.set(0, r * 0.6, -r * 0.8);
        peak.rotation.y = Math.PI / 2;
        [cap, peak].forEach((m) => { this.dress(m); this.hatGroup.add(m); });
        break;
      }
      case 'sunVisor': {
        const band = new Mesh(new TorusGeometry(r * 1.06, r * 0.1, 6, 18), this.hatMaterial);
        band.rotation.x = Math.PI / 2;
        band.position.y = r * 0.5;
        const peak = new Mesh(new CylinderGeometry(r * 1.5, r * 1.5, r * 0.06, 16, 1, false, 0, Math.PI), this.hatMaterial);
        peak.position.set(0, r * 0.52, r * 0.5);
        peak.rotation.y = -Math.PI / 2;
        [band, peak].forEach((m) => { this.dress(m); this.hatGroup.add(m); });
        break;
      }
      case 'flowerCrown': {
        const ring = new Mesh(new TorusGeometry(r * 1.02, r * 0.06, 6, 20), createStylizedMaterial({ color: '#6f9a55', roughness: 0.9 }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = r * 0.62;
        this.dress(ring);
        this.hatGroup.add(ring);
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const bloom = new Mesh(
            new SphereGeometry(r * 0.16, 8, 6),
            createStylizedMaterial({ color: PALETTE.flowers[i % PALETTE.flowers.length], roughness: 0.85 }),
          );
          bloom.position.set(Math.cos(a) * r * 1.02, r * 0.66, Math.sin(a) * r * 1.02);
          bloom.scale.y = 0.7;
          this.dress(bloom);
          this.hatGroup.add(bloom);
        }
        break;
      }
    }
  }

  setOutfit(outfit: OutfitId): void {
    const def = OUTFITS.find((o) => o.id === outfit);
    this.clearGroup(this.lowerGroup);
    if (!def) return;
    const h = this.height;

    // A skirt hides the legs, so the leg meshes shorten to match.
    const showSkirt = def.lower === 'skirt';
    for (const suffix of ['L', 'R'] as const) {
      const knee = this.joints[`knee${suffix}` as JointName];
      const shin = knee?.children.find((c) => c.name === 'shin') as Mesh | undefined;
      if (shin) shin.visible = true;
      const hip = this.joints[`hip${suffix}` as JointName];
      const thigh = hip?.children[0] as Mesh | undefined;
      if (thigh) thigh.visible = !showSkirt;
    }

    if (showSkirt) {
      const skirt = new Mesh(new CylinderGeometry(h * 0.085, h * 0.16, h * 0.19, 16, 1, true), this.shirtMaterial);
      skirt.position.y = -h * 0.085;
      skirt.material = this.lowerMaterial;
      this.dress(skirt);
      this.lowerGroup.add(skirt);
    } else if (def.lower === 'shorts') {
      const shorts = new Mesh(roundedBoxGeometry(h * 0.17, h * 0.11, h * 0.13, h * 0.03), this.lowerMaterial);
      shorts.position.y = -h * 0.045;
      this.dress(shorts);
      this.lowerGroup.add(shorts);
    }

    if (outfit === 'overalls' || outfit === 'apron') {
      // Straps read instantly at gameplay distance and cost two boxes.
      for (const side of [-1, 1]) {
        const strap = new Mesh(roundedBoxGeometry(h * 0.035, h * 0.24, h * 0.02, h * 0.008), this.lowerMaterial);
        strap.position.set(side * h * 0.055, h * 0.14, h * 0.075);
        this.dress(strap);
        this.joints.torso.add(strap);
      }
    }
    if (outfit === 'raincoat') {
      const hood = new Mesh(new SphereGeometry(h * 0.1, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), this.shirtMaterial);
      hood.position.set(0, h * 0.24, -h * 0.045);
      hood.scale.set(1.1, 1, 1.15);
      this.dress(hood);
      this.joints.torso.add(hood);
    }
  }

  setShoes(shoes: ShoeId): void {
    // Silhouette differences per shoe, driven by scaling the foot mesh.
    const profiles: Record<ShoeId, [number, number, number]> = {
      boots: [1.05, 1.25, 1.05],
      sneakers: [1.0, 1.0, 1.05],
      sandals: [1.0, 0.6, 1.0],
      wellies: [1.1, 1.9, 1.05],
    };
    const profile = profiles[shoes] ?? profiles.boots;
    for (const suffix of ['L', 'R'] as const) {
      const foot = this.joints[`foot${suffix}` as JointName];
      const mesh = foot?.children[0] as Mesh | undefined;
      if (mesh) mesh.scale.set(profile[0], profile[1], profile[2]);
    }
  }

  // --- Expression ----------------------------------------------------------

  setExpression(expression: Expression): void {
    if (this.targetExpression === expression) return;
    this.targetExpression = expression;
    this.expressionBlend = 0;
  }

  /** Makes the character look toward a world position (eyes and head yaw hint). */
  lookAt(x: number, z: number, selfX: number, selfZ: number, facing: number): void {
    const angle = Math.atan2(x - selfX, z - selfZ);
    let delta = angle - facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const clamped = Math.max(-0.5, Math.min(0.5, delta));
    this.pupilL.position.x = -this.height * 0.165 * 0.36 + clamped * 0.012;
    this.pupilR.position.x = this.height * 0.165 * 0.36 + clamped * 0.012;
  }

  updateFace(dt: number): void {
    // --- Blink -------------------------------------------------------------
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkProgress = 0;
      this.blinkTimer = 2.4 + Math.random() * 4;
    }
    if (this.blinkProgress < 1) {
      this.blinkProgress = Math.min(1, this.blinkProgress + dt * 9);
      // Fast close, slightly slower open.
      const closed = Math.sin(this.blinkProgress * Math.PI);
      const openY = 1.12 * (1 - closed * 0.94);
      this.eyeL.scale.y = openY;
      this.eyeR.scale.y = openY;
      this.pupilL.scale.y = 1.15 * (1 - closed * 0.94);
      this.pupilR.scale.y = 1.15 * (1 - closed * 0.94);
    }

    // --- Expression --------------------------------------------------------
    if (this.expressionBlend < 1) {
      this.expressionBlend = Math.min(1, this.expressionBlend + dt * 6);
      this.expression = this.targetExpression;
      this.applyExpression(this.expression, this.expressionBlend);
    }
  }

  private applyExpression(expression: Expression, blend: number): void {
    const r = this.height * 0.165;
    const set = (
      browTilt: number, browRaise: number,
      mouthScale: [number, number, number], mouthDrop: number,
      eyeScale: number, blush: number,
    ) => {
      const t = blend;
      this.browL.rotation.z = -browTilt * t;
      this.browR.rotation.z = browTilt * t;
      this.browL.position.y = r * (0.3 + browRaise * t);
      this.browR.position.y = r * (0.3 + browRaise * t);
      this.mouth.scale.set(
        1.4 + (mouthScale[0] - 1.4) * t,
        0.5 + (mouthScale[1] - 0.5) * t,
        0.5 + (mouthScale[2] - 0.5) * t,
      );
      this.mouth.position.y = -r * (this.isVillager ? 0.16 : 0.3) - r * mouthDrop * t;
      const s = 1 + (eyeScale - 1) * t;
      this.eyeL.scale.x = s;
      this.eyeR.scale.x = s;
      const blushMaterial = this.blushL.material as MeshStandardMaterial;
      blushMaterial.opacity = 0.32 + blush * t;
    };

    switch (expression) {
      case 'happy':      set(0.16, 0.08, [1.7, 0.85, 0.6], 0.03, 1.02, 0.16); break;
      case 'surprised':  set(-0.1, 0.22, [0.9, 1.4, 0.7], 0.06, 1.18, 0.0); break;
      case 'sad':        set(-0.24, -0.04, [1.2, 0.42, 0.45], 0.02, 0.94, 0.0); break;
      case 'determined': set(0.3, -0.08, [1.3, 0.34, 0.45], 0.0, 0.96, 0.0); break;
      case 'sleepy':     set(0.08, -0.06, [1.1, 0.6, 0.5], 0.02, 0.85, 0.06); break;
      case 'excited':    set(0.2, 0.16, [1.55, 1.15, 0.7], 0.04, 1.1, 0.24); break;
      case 'neutral':
      default:           set(0, 0, [1.4, 0.5, 0.5], 0, 1, 0); break;
    }
  }

  /** Toggles rain-slick materials when the player is out in the weather. */
  setWet(_wet: number): void {
    // Wetness is a global shader uniform; the hook exists so per-character
    // overrides (an umbrella, standing indoors) can be added without churn.
  }

  dispose(): void {
    this.group.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }
}
