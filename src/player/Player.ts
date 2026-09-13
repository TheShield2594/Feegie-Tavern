import { Group, Vector3 } from 'three';
import type { EventBus } from '@/core/EventBus';
import type { CharacterLook } from '@/data/clothing';
import { clamp, dampAngle, lerp } from '@/util/math';
import { CharacterAnimator, type ClipName } from './CharacterAnimator';
import { CharacterRig } from './CharacterRig';
import { makeTool, TOOLS, type ToolId } from './Tools';
import { SEA_LEVEL, isWalkable, sampleSurface, terrainHeight, type Surface } from '@/world/heightfield';

export interface MovementConstraints {
  /** Circles the player cannot walk into. */
  circles: { x: number; z: number; radius: number }[];
  /** Rotated boxes the player cannot walk into. */
  boxes: { x: number; z: number; halfW: number; halfD: number; rotation: number }[];
  /** When set, movement is confined to this axis-aligned rectangle (interiors). */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Skip terrain sampling and pin to this height (interiors). */
  fixedHeight?: number;
}

export type PlayerState = 'free' | 'fishing' | 'busy' | 'talking' | 'swimming' | 'sitting' | 'sleeping';

const WALK_SPEED = 4.4;
const RUN_SPEED = 7.6;
const SWIM_SPEED = 3.1;
const ACCELERATION = 26;
const FRICTION = 18;
const TURN_HALF_LIFE = 0.055;
const RADIUS = 0.42;

/**
 * The player avatar: movement, grounding, collision, tool handling and the
 * animation state machine that ties them together. Rendering-agnostic beyond
 * owning its rig, so the same controller drives the exterior island and every
 * interior scene.
 */
export class Player {
  readonly group = new Group();
  readonly rig: CharacterRig;
  readonly animator: CharacterAnimator;

  readonly position = new Vector3(0, 0, 6);
  readonly velocity = new Vector3();
  facing = Math.PI;

  state: PlayerState = 'free';
  /** Set while a scripted action owns the character. */
  private busyTimer = 0;

  tool: ToolId = 'rod';
  toolLevels: Record<ToolId, number> = { none: 1, rod: 1, net: 1, shovel: 1, axe: 1, wateringCan: 1 };
  private toolModel: Group | null = null;
  private toolVisible = false;

  /** Surface the player is standing on, for footstep audio and particles. */
  surface: Surface = 'grass';
  /** True while wading or swimming. */
  inWater = false;
  swimDepth = 0;

  private footstepTimer = 0;
  private lastFootstepFoot: 'L' | 'R' = 'L';
  private idleTimer = 0;

  constructor(private bus: EventBus, look: CharacterLook) {
    this.rig = new CharacterRig({ height: 1.62 });
    this.rig.setLook(look);
    this.animator = new CharacterAnimator(this.rig);
    this.group.add(this.rig.group);
    this.group.name = 'Player';
    this.setTool('rod', false);
  }

  setLook(look: CharacterLook): void {
    this.rig.setLook(look);
  }

  // --- Tools ---------------------------------------------------------------

  setTool(id: ToolId, announce = true): void {
    this.tool = id;
    if (this.toolModel) {
      this.rig.toolAnchor.remove(this.toolModel);
      this.toolModel.traverse((child) => {
        const mesh = child as { geometry?: { dispose(): void } };
        mesh.geometry?.dispose();
      });
      this.toolModel = null;
    }
    if (id !== 'none') {
      this.toolModel = makeTool(id, this.toolLevels[id] ?? 1);
      this.toolModel.visible = this.toolVisible;
      this.rig.toolAnchor.add(this.toolModel);
    }
    if (announce) this.bus.emit('audio:sfx', { id: 'ui.select', volume: 0.6 });
  }

  cycleTool(direction: 1 | -1): void {
    const index = TOOLS.findIndex((t) => t.id === this.tool);
    const next = (index + direction + TOOLS.length) % TOOLS.length;
    this.setTool(TOOLS[next].id);
  }

  /** Shows or hides the held tool — it only appears while it is being used. */
  private setToolVisible(visible: boolean): void {
    this.toolVisible = visible;
    if (this.toolModel) this.toolModel.visible = visible;
  }

  // --- Actions -------------------------------------------------------------

  /** Plays a one-shot action clip and locks input for its duration. */
  performAction(clip: ClipName, duration: number, showTool = true): void {
    this.state = 'busy';
    this.busyTimer = duration;
    this.setToolVisible(showTool);
    this.animator.play(clip, { force: true });
    this.velocity.set(0, 0, 0);
  }

  celebrate(): void {
    this.performAction('celebrate', 1.5, false);
    this.rig.setExpression('excited');
  }

  beginFishing(): void {
    this.state = 'fishing';
    this.setToolVisible(true);
    this.animator.play('fishCast', { force: true });
    this.rig.setExpression('determined');
  }

  setFishingPose(pose: 'wait' | 'reel'): void {
    if (this.state !== 'fishing') return;
    this.animator.play(pose === 'wait' ? 'fishWait' : 'fishReel');
  }

  endFishing(): void {
    if (this.state === 'fishing') this.state = 'free';
    this.setToolVisible(false);
    this.rig.setExpression('neutral');
  }

  beginTalking(lookAtX: number, lookAtZ: number): void {
    this.state = 'talking';
    this.velocity.set(0, 0, 0);
    this.facing = Math.atan2(lookAtX - this.position.x, lookAtZ - this.position.z);
    this.animator.play('talk');
    this.setToolVisible(false);
    this.rig.setExpression('happy');
  }

  endTalking(): void {
    if (this.state === 'talking') this.state = 'free';
    this.rig.setExpression('neutral');
  }

  sit(): void {
    this.state = 'sitting';
    this.velocity.set(0, 0, 0);
    this.animator.play('sit');
    this.setToolVisible(false);
  }

  stand(): void {
    if (this.state === 'sitting' || this.state === 'sleeping') this.state = 'free';
  }

  sleep(): void {
    this.state = 'sleeping';
    this.velocity.set(0, 0, 0);
    this.animator.play('sleep');
    this.rig.setExpression('sleepy');
  }

  teleport(x: number, z: number, facing = this.facing, height?: number): void {
    this.position.set(x, height ?? terrainHeight(x, z), z);
    this.velocity.set(0, 0, 0);
    this.facing = facing;
    this.group.position.copy(this.position);
    this.group.rotation.y = facing;
  }

  // --- Frame ---------------------------------------------------------------

  /**
   * @param moveX Input on the world X axis, already camera-relative.
   * @param moveZ Input on the world Z axis.
   */
  update(dt: number, moveX: number, moveZ: number, running: boolean, constraints: MovementConstraints): void {
    if (this.busyTimer > 0) {
      this.busyTimer -= dt;
      if (this.busyTimer <= 0 && this.state === 'busy') {
        this.state = 'free';
        this.setToolVisible(false);
        this.rig.setExpression('neutral');
      }
    }

    const canMove = this.state === 'free' || this.state === 'swimming';
    const inputLength = Math.hypot(moveX, moveZ);

    if (canMove && inputLength > 0.02) {
      const maxSpeed = this.inWater ? SWIM_SPEED : running ? RUN_SPEED : WALK_SPEED;
      const targetX = (moveX / Math.max(inputLength, 1)) * maxSpeed * Math.min(1, inputLength);
      const targetZ = (moveZ / Math.max(inputLength, 1)) * maxSpeed * Math.min(1, inputLength);
      this.velocity.x = lerp(this.velocity.x, targetX, 1 - Math.exp(-ACCELERATION * dt));
      this.velocity.z = lerp(this.velocity.z, targetZ, 1 - Math.exp(-ACCELERATION * dt));
      this.facing = dampAngle(this.facing, Math.atan2(this.velocity.x, this.velocity.z), TURN_HALF_LIFE, dt);
    } else {
      const decay = Math.exp(-FRICTION * dt);
      this.velocity.x *= decay;
      this.velocity.z *= decay;
      if (Math.abs(this.velocity.x) < 0.02) this.velocity.x = 0;
      if (Math.abs(this.velocity.z) < 0.02) this.velocity.z = 0;
    }

    if (this.velocity.lengthSq() > 0) {
      this.move(this.velocity.x * dt, this.velocity.z * dt, constraints);
    }

    // --- Grounding ---------------------------------------------------------
    if (constraints.fixedHeight !== undefined) {
      this.position.y = constraints.fixedHeight;
      this.surface = 'wood';
      this.inWater = false;
      this.swimDepth = 0;
    } else {
      const sample = sampleSurface(this.position.x, this.position.z);
      // Ease onto the new height so slopes and steps do not jolt the camera.
      this.position.y = lerp(this.position.y, sample.height, 1 - Math.exp(-18 * dt));
      this.surface = sample.surface;
      this.swimDepth = Math.max(0, SEA_LEVEL - sample.height);
      const wasInWater = this.inWater;
      this.inWater = this.swimDepth > 0.55;
      if (this.inWater !== wasInWater) {
        this.bus.emit('audio:sfx', { id: 'tool.splash', volume: 0.5 });
        this.state = this.inWater ? 'swimming' : 'free';
      }
    }

    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;

    this.updateAnimation(dt);
    this.updateFootsteps(dt);
  }

  private move(dx: number, dz: number, constraints: MovementConstraints): void {
    // Resolve each axis separately so sliding along a wall feels natural
    // rather than sticking the moment one axis is blocked.
    const tryAxis = (nx: number, nz: number): boolean => {
      if (!this.isFree(nx, nz, constraints)) return false;
      this.position.x = nx;
      this.position.z = nz;
      return true;
    };

    if (!tryAxis(this.position.x + dx, this.position.z + dz)) {
      const slidX = tryAxis(this.position.x + dx, this.position.z);
      const slidZ = !slidX ? tryAxis(this.position.x, this.position.z + dz) : false;
      if (!slidX && !slidZ) {
        this.velocity.x *= 0.2;
        this.velocity.z *= 0.2;
      }
    }
  }

  private isFree(x: number, z: number, constraints: MovementConstraints): boolean {
    const b = constraints.bounds;
    if (b) {
      if (x < b.minX + RADIUS || x > b.maxX - RADIUS || z < b.minZ + RADIUS || z > b.maxZ - RADIUS) return false;
    } else if (!isWalkable(x, z)) {
      return false;
    }

    for (const circle of constraints.circles) {
      const dx = x - circle.x;
      const dz = z - circle.z;
      const r = circle.radius + RADIUS;
      if (dx * dx + dz * dz < r * r) return false;
    }

    for (const box of constraints.boxes) {
      // Transform into the box's local frame and test the expanded rectangle.
      const cos = Math.cos(-box.rotation);
      const sin = Math.sin(-box.rotation);
      const dx = x - box.x;
      const dz = z - box.z;
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (Math.abs(lx) < box.halfW + RADIUS && Math.abs(lz) < box.halfD + RADIUS) return false;
    }

    return true;
  }

  private updateAnimation(dt: number): void {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);

    if (this.state === 'free' || this.state === 'swimming') {
      if (this.inWater) {
        this.animator.play('swim');
        this.animator.intensity = clamp(speed / SWIM_SPEED, 0.4, 1);
        this.animator.speed = clamp(speed / SWIM_SPEED, 0.5, 1.4);
      } else if (speed > RUN_SPEED * 0.72) {
        this.animator.play('run');
        this.animator.intensity = clamp(speed / RUN_SPEED, 0.6, 1);
        this.animator.speed = clamp(speed / RUN_SPEED, 0.7, 1.35);
      } else if (speed > 0.35) {
        this.animator.play('walk');
        this.animator.intensity = clamp(speed / WALK_SPEED, 0.45, 1);
        this.animator.speed = clamp(speed / WALK_SPEED, 0.55, 1.3);
      } else {
        // A long stand-still shifts to a heavier idle, which reads as waiting.
        this.idleTimer += dt;
        this.animator.play(this.idleTimer > 22 ? 'idleTired' : 'idle');
        this.animator.intensity = 1;
        this.animator.speed = 1;
      }
      if (speed > 0.35) this.idleTimer = 0;
    }

    this.animator.update(dt);
  }

  private updateFootsteps(dt: number): void {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed < 0.4 || this.state === 'busy' || this.state === 'talking') {
      this.footstepTimer = 0;
      return;
    }
    // Step cadence follows the stride, so audio lands with the animation.
    const interval = this.inWater ? 0.48 : speed > RUN_SPEED * 0.72 ? 0.31 : 0.46;
    this.footstepTimer += dt;
    if (this.footstepTimer < interval) return;
    this.footstepTimer = 0;
    this.lastFootstepFoot = this.lastFootstepFoot === 'L' ? 'R' : 'L';

    const sound = this.inWater
      ? 'step.water'
      : this.surface === 'sand'
        ? 'step.sand'
        : this.surface === 'wood'
          ? 'step.wood'
          : this.surface === 'path' || this.surface === 'plaza' || this.surface === 'rock'
            ? 'step.stone'
            : 'step.grass';
    this.bus.emit('audio:sfx', { id: sound, volume: speed > RUN_SPEED * 0.7 ? 1 : 0.72 });
  }

  /** World point in front of the player, used for casting and tool targeting. */
  forwardPoint(distance: number, out = new Vector3()): Vector3 {
    return out.set(
      this.position.x + Math.sin(this.facing) * distance,
      this.position.y,
      this.position.z + Math.cos(this.facing) * distance,
    );
  }

  get forwardX(): number {
    return Math.sin(this.facing);
  }

  get forwardZ(): number {
    return Math.cos(this.facing);
  }

  /** Roughly eye height, for dialogue anchors and camera focus. */
  get headPosition(): Vector3 {
    return new Vector3(this.position.x, this.position.y + 1.45, this.position.z);
  }

  dispose(): void {
    this.rig.dispose();
  }
}
