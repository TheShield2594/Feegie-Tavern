import { Euler, Quaternion, Vector3 } from 'three';
import { clamp01, lerp } from '@/util/math';
import type { CharacterRig, JointName } from './CharacterRig';

export type ClipName =
  | 'idle'
  | 'idleTired'
  | 'walk'
  | 'run'
  | 'fishCast'
  | 'fishWait'
  | 'fishReel'
  | 'netSwing'
  | 'shovel'
  | 'axe'
  | 'water'
  | 'plant'
  | 'pick'
  | 'gatherFruit'
  | 'swim'
  | 'dive'
  | 'sit'
  | 'celebrate'
  | 'talk'
  | 'sleep'
  | 'carry';

/** A joint's local rotation for one animation frame. */
type JointPose = [number, number, number];
export type Pose = Partial<Record<JointName, JointPose>>;

interface ClipDef {
  /** Seconds for one cycle. Ignored for one-shots, which use `duration`. */
  period: number;
  loop: boolean;
  /** One-shot length in seconds. */
  duration?: number;
  /** Whether the clip's speed scales with the character's movement speed. */
  speedScaled?: boolean;
  /** Vertical bob applied to the root, in metres. */
  bob?: (t: number) => number;
  evaluate: (t: number, intensity: number) => Pose;
}

const TAU = Math.PI * 2;

/**
 * Procedural animation.
 *
 * Clips are functions rather than baked keyframes, which keeps every action
 * (a net swing, a cast, a celebration) a dozen readable lines and lets speed,
 * tool weight and mood scale them continuously. The animator crossfades
 * between the outgoing and incoming clip so transitions never pop.
 */
export class CharacterAnimator {
  private clips: Record<ClipName, ClipDef>;
  private current: ClipName = 'idle';
  private previous: ClipName | null = null;
  private blend = 1;
  private blendDuration = 0.18;
  private time = 0;
  private previousTime = 0;
  private oneShotElapsed = 0;
  private oneShotDone = true;
  private queued: ClipName | null = null;

  /** 0–1 movement intensity, scales stride length and arm swing. */
  intensity = 1;
  /** Playback multiplier, driven by actual speed for walk/run. */
  speed = 1;

  private scratchEuler = new Euler();
  private scratchQuat = new Quaternion();
  private targetQuat = new Quaternion();
  private restPose: Partial<Record<JointName, Vector3>> = {};

  constructor(private rig: CharacterRig) {
    this.clips = buildClips();
    // Capture the rig's authored rest rotations so poses are relative to them.
    for (const name of Object.keys(rig.joints) as JointName[]) {
      const joint = rig.joints[name];
      this.restPose[name] = new Vector3(joint.rotation.x, joint.rotation.y, joint.rotation.z);
    }
  }

  get currentClip(): ClipName {
    return this.current;
  }

  get isBusy(): boolean {
    return !this.clips[this.current].loop && !this.oneShotDone;
  }

  /**
   * Starts a clip. One-shots (a swing, a cast) block further plays until they
   * finish unless `force` is set, so an action always reads fully.
   */
  play(name: ClipName, options: { fade?: number; force?: boolean } = {}): boolean {
    if (name === this.current && (this.clips[name].loop || !this.oneShotDone)) return false;
    if (this.isBusy && !options.force) {
      this.queued = name;
      return false;
    }

    this.previous = this.current;
    this.previousTime = this.time;
    this.current = name;
    this.time = 0;
    this.blend = 0;
    this.blendDuration = options.fade ?? (this.clips[name].loop ? 0.2 : 0.1);
    this.oneShotElapsed = 0;
    this.oneShotDone = this.clips[name].loop;
    this.queued = null;
    return true;
  }

  /** Progress through a one-shot, 0–1. Useful for timing effects to a swing. */
  get oneShotProgress(): number {
    const clip = this.clips[this.current];
    if (clip.loop) return 0;
    return clamp01(this.oneShotElapsed / (clip.duration ?? clip.period));
  }

  update(dt: number): void {
    const clip = this.clips[this.current];
    const rate = clip.speedScaled ? this.speed : 1;
    this.time += dt * rate;
    this.previousTime += dt;

    if (!clip.loop) {
      this.oneShotElapsed += dt;
      const duration = clip.duration ?? clip.period;
      if (this.oneShotElapsed >= duration && !this.oneShotDone) {
        this.oneShotDone = true;
        // Fall through to whatever was requested mid-swing, else back to idle.
        this.play(this.queued ?? 'idle', { force: true });
        return;
      }
    }

    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / Math.max(0.001, this.blendDuration));

    const pose = this.evaluate(this.current, this.time);
    if (this.previous && this.blend < 1) {
      const previousPose = this.evaluate(this.previous, this.previousTime);
      this.applyBlended(previousPose, pose, this.blend);
    } else {
      this.applyBlended(null, pose, 1);
      this.previous = null;
    }

    // Root bob, so walking has weight without touching the world transform.
    const bob = clip.bob ? clip.bob(this.time) * this.intensity : 0;
    this.rig.joints.root.position.y = bob;

    this.rig.updateFace(dt);
  }

  private evaluate(name: ClipName, time: number): Pose {
    const clip = this.clips[name];
    const t = clip.loop ? (time % clip.period) / clip.period : clamp01(time / (clip.duration ?? clip.period));
    return clip.evaluate(t, this.intensity);
  }

  private applyBlended(from: Pose | null, to: Pose, weight: number): void {
    const names = new Set<JointName>([
      ...(from ? (Object.keys(from) as JointName[]) : []),
      ...(Object.keys(to) as JointName[]),
    ]);

    for (const name of names) {
      const joint = this.rig.joints[name];
      if (!joint) continue;
      const rest = this.restPose[name] ?? new Vector3();
      const a = from?.[name] ?? [0, 0, 0];
      const b = to[name] ?? [0, 0, 0];

      // Blend in quaternion space so large opposing rotations do not gimbal.
      this.scratchEuler.set(rest.x + a[0], rest.y + a[1], rest.z + a[2]);
      this.scratchQuat.setFromEuler(this.scratchEuler);
      this.scratchEuler.set(rest.x + b[0], rest.y + b[1], rest.z + b[2]);
      this.targetQuat.setFromEuler(this.scratchEuler);
      this.scratchQuat.slerp(this.targetQuat, weight);
      joint.quaternion.copy(this.scratchQuat);
    }
  }
}

function buildClips(): Record<ClipName, ClipDef> {
  /** Shared arm-swing helper for locomotion. */
  const stride = (t: number, amount: number, armAmount: number): Pose => {
    const phase = t * TAU;
    const swing = Math.sin(phase);
    const counter = Math.sin(phase + Math.PI);
    // Knees only bend on the backswing, which is what sells a walk.
    const kneeL = Math.max(0, -Math.sin(phase - 0.6)) * amount * 1.5;
    const kneeR = Math.max(0, -Math.sin(phase + Math.PI - 0.6)) * amount * 1.5;
    return {
      hipL: [swing * amount, 0, 0],
      hipR: [counter * amount, 0, 0],
      kneeL: [-kneeL, 0, 0],
      kneeR: [-kneeR, 0, 0],
      footL: [Math.max(0, swing) * amount * 0.4, 0, 0],
      footR: [Math.max(0, counter) * amount * 0.4, 0, 0],
      shoulderL: [counter * armAmount, 0, 0],
      shoulderR: [swing * armAmount, 0, 0],
      elbowL: [-Math.abs(counter) * armAmount * 0.5, 0, 0],
      elbowR: [-Math.abs(swing) * armAmount * 0.5, 0, 0],
      torso: [0, swing * 0.06, 0],
      head: [0, -swing * 0.04, 0],
    };
  };

  return {
    idle: {
      period: 4.2,
      loop: true,
      bob: (t) => Math.sin((t / 4.2) * TAU) * 0.012,
      evaluate: (t) => {
        const breathe = Math.sin(t * TAU);
        const sway = Math.sin(t * TAU * 0.5);
        return {
          torso: [breathe * 0.022, sway * 0.05, 0],
          neck: [-breathe * 0.02, sway * 0.04, 0],
          head: [breathe * 0.015, sway * 0.07, sway * 0.02],
          shoulderL: [breathe * 0.05, 0, 0.03],
          shoulderR: [breathe * 0.05, 0, -0.03],
          elbowL: [-0.12 - breathe * 0.04, 0, 0],
          elbowR: [-0.12 - breathe * 0.04, 0, 0],
          tail: [Math.sin(t * TAU * 1.3) * 0.16, Math.sin(t * TAU) * 0.2, 0],
        };
      },
    },

    idleTired: {
      period: 5.6,
      loop: true,
      bob: (t) => Math.sin((t / 5.6) * TAU) * 0.02,
      evaluate: (t) => {
        const breathe = Math.sin(t * TAU);
        return {
          torso: [0.08 + breathe * 0.03, 0, 0],
          neck: [0.1, 0, 0],
          head: [0.14 + breathe * 0.03, Math.sin(t * TAU * 0.4) * 0.1, 0],
          shoulderL: [0.1, 0, 0.06],
          shoulderR: [0.1, 0, -0.06],
          elbowL: [-0.2, 0, 0],
          elbowR: [-0.2, 0, 0],
        };
      },
    },

    walk: {
      period: 0.92,
      loop: true,
      speedScaled: true,
      bob: (t) => Math.abs(Math.sin((t / 0.92) * TAU)) * 0.035 - 0.017,
      evaluate: (t, intensity) => stride(t, 0.55 * intensity, 0.42 * intensity),
    },

    run: {
      period: 0.62,
      loop: true,
      speedScaled: true,
      bob: (t) => Math.abs(Math.sin((t / 0.62) * TAU)) * 0.07 - 0.03,
      evaluate: (t, intensity) => {
        const pose = stride(t, 0.85 * intensity, 0.78 * intensity);
        // Lean into the run and drop the elbows for a driving arm action.
        pose.torso = [0.2, (pose.torso?.[1] ?? 0) * 1.4, 0];
        pose.neck = [-0.12, 0, 0];
        pose.elbowL = [-1.05, 0, 0];
        pose.elbowR = [-1.05, 0, 0];
        return pose;
      },
    },

    // --- Fishing -----------------------------------------------------------
    fishCast: {
      period: 0.85,
      duration: 0.85,
      loop: false,
      evaluate: (t) => {
        // Wind up behind the shoulder, then whip forward and follow through.
        const windUp = clamp01(t / 0.42);
        const release = clamp01((t - 0.42) / 0.32);
        const settle = clamp01((t - 0.7) / 0.3);
        const arm = lerp(-2.4, 0.9, easeOutBack(release)) * (1 - settle * 0.35);
        return {
          shoulderR: [lerp(-0.4, arm, windUp), 0, -0.25],
          elbowR: [lerp(-0.3, -1.5, windUp) + release * 1.2, 0, 0],
          shoulderL: [0.2, 0, 0.35],
          elbowL: [-0.7, 0, 0],
          torso: [lerp(0, -0.14, windUp) + release * 0.28, lerp(0, -0.3, windUp) + release * 0.38, 0],
          head: [0, lerp(0, -0.18, windUp) + release * 0.2, 0],
          hipL: [0.06, 0, 0],
          hipR: [-0.1, 0, 0],
        };
      },
    },

    fishWait: {
      period: 3.4,
      loop: true,
      evaluate: (t) => {
        const breathe = Math.sin(t * TAU);
        return {
          shoulderR: [0.62 + breathe * 0.03, 0, -0.3],
          elbowR: [-0.85, 0, 0],
          shoulderL: [0.5, 0, 0.3],
          elbowL: [-1.0, 0, 0],
          torso: [0.06 + breathe * 0.02, -0.1, 0],
          head: [0.08, -0.06, 0],
        };
      },
    },

    fishReel: {
      period: 0.42,
      loop: true,
      evaluate: (t) => {
        // The left hand cranks while the rod arm strains against the fish.
        const crank = t * TAU;
        return {
          shoulderR: [0.42 + Math.sin(crank) * 0.06, 0, -0.34],
          elbowR: [-1.05, 0, 0],
          shoulderL: [0.62, Math.sin(crank) * 0.3, 0.28],
          elbowL: [-1.3 + Math.cos(crank) * 0.35, 0, 0],
          torso: [-0.16 + Math.sin(crank * 0.5) * 0.04, -0.06, 0],
          head: [-0.08, 0, 0],
          hipL: [-0.14, 0, 0],
          hipR: [0.1, 0, 0],
        };
      },
    },

    // --- Tools -------------------------------------------------------------
    netSwing: {
      period: 0.62,
      duration: 0.62,
      loop: false,
      evaluate: (t) => {
        const wind = clamp01(t / 0.3);
        const swing = clamp01((t - 0.3) / 0.32);
        return {
          shoulderR: [lerp(-0.2, -2.0, wind) + easeOutCubic(swing) * 2.9, 0, -0.3],
          elbowR: [-0.4 - wind * 0.6 + swing * 0.5, 0, 0],
          torso: [0, lerp(0, 0.5, wind) - easeOutCubic(swing) * 0.9, 0],
          head: [0, lerp(0, 0.2, wind) - swing * 0.4, 0],
          shoulderL: [0.1, 0, 0.4],
        };
      },
    },

    shovel: {
      period: 0.9,
      duration: 0.9,
      loop: false,
      evaluate: (t) => {
        const raise = clamp01(t / 0.36);
        const drive = clamp01((t - 0.36) / 0.24);
        const lift = clamp01((t - 0.62) / 0.38);
        return {
          shoulderR: [lerp(-0.3, -1.5, raise) + drive * 2.1 - lift * 0.5, 0, -0.2],
          shoulderL: [lerp(-0.2, -1.3, raise) + drive * 1.9 - lift * 0.5, 0, 0.2],
          elbowR: [-0.5 - raise * 0.5 + drive * 0.4, 0, 0],
          elbowL: [-0.5 - raise * 0.5 + drive * 0.4, 0, 0],
          torso: [lerp(0, -0.18, raise) + drive * 0.62 - lift * 0.3, 0, 0],
          head: [lerp(0, -0.1, raise) + drive * 0.34, 0, 0],
          hipL: [0.16, 0, 0],
          hipR: [-0.12, 0, 0],
          kneeL: [-0.22 - drive * 0.3, 0, 0],
        };
      },
    },

    axe: {
      period: 0.78,
      duration: 0.78,
      loop: false,
      evaluate: (t) => {
        const raise = clamp01(t / 0.34);
        const chop = clamp01((t - 0.34) / 0.2);
        const recover = clamp01((t - 0.58) / 0.4);
        return {
          shoulderR: [lerp(-0.3, -2.5, easeOutCubic(raise)) + easeInCubic(chop) * 3.0 - recover * 0.4, 0, -0.15],
          shoulderL: [lerp(-0.2, -2.2, easeOutCubic(raise)) + easeInCubic(chop) * 2.8 - recover * 0.4, 0, 0.15],
          elbowR: [-0.3 - raise * 0.9 + chop * 0.8, 0, 0],
          elbowL: [-0.3 - raise * 0.9 + chop * 0.8, 0, 0],
          torso: [lerp(0, -0.3, raise) + easeInCubic(chop) * 0.72 - recover * 0.3, 0.12, 0],
          head: [lerp(0, -0.16, raise) + chop * 0.4, 0, 0],
          hipL: [0.2, 0, 0],
          hipR: [-0.16, 0, 0],
        };
      },
    },

    water: {
      period: 1.6,
      duration: 1.6,
      loop: false,
      evaluate: (t) => {
        const tilt = clamp01(t / 0.4) - clamp01((t - 1.1) / 0.5);
        const wobble = Math.sin(t * TAU * 3) * 0.04 * tilt;
        return {
          shoulderR: [0.9 + tilt * 0.35 + wobble, 0, -0.5],
          elbowR: [-0.5 - tilt * 0.4, 0, 0],
          shoulderL: [0.25, 0, 0.3],
          torso: [0.1 + tilt * 0.1, -0.16, 0],
          head: [0.22, -0.08, 0],
        };
      },
    },

    plant: {
      period: 1.15,
      duration: 1.15,
      loop: false,
      evaluate: (t) => {
        const crouch = Math.sin(clamp01(t) * Math.PI);
        const press = Math.sin(clamp01((t - 0.35) / 0.35) * Math.PI);
        return {
          hips: [crouch * 0.28, 0, 0],
          hipL: [-crouch * 0.85, 0, 0],
          hipR: [-crouch * 0.85, 0, 0],
          kneeL: [crouch * 1.4, 0, 0],
          kneeR: [crouch * 1.4, 0, 0],
          torso: [crouch * 0.5, 0, 0],
          shoulderR: [0.6 + press * 0.7, 0, -0.4],
          elbowR: [-0.9 + press * 0.3, 0, 0],
          shoulderL: [0.4, 0, 0.4],
          elbowL: [-0.7, 0, 0],
          head: [crouch * 0.35, 0, 0],
        };
      },
    },

    pick: {
      period: 1.0,
      duration: 1.0,
      loop: false,
      evaluate: (t) => {
        const crouch = Math.sin(clamp01(t) * Math.PI);
        const grab = Math.sin(clamp01((t - 0.3) / 0.4) * Math.PI);
        return {
          hips: [crouch * 0.3, 0, 0],
          hipL: [-crouch * 0.9, 0, 0],
          hipR: [-crouch * 0.9, 0, 0],
          kneeL: [crouch * 1.5, 0, 0],
          kneeR: [crouch * 1.5, 0, 0],
          torso: [crouch * 0.55, 0, 0],
          shoulderR: [0.5 + grab * 0.9, 0, -0.3],
          elbowR: [-0.6 - grab * 0.4, 0, 0],
          shoulderL: [0.3 + grab * 0.4, 0, 0.3],
          head: [crouch * 0.4, 0, 0],
        };
      },
    },

    gatherFruit: {
      period: 1.1,
      duration: 1.1,
      loop: false,
      evaluate: (t) => {
        // Reach up, take hold, and give the branch a shake.
        const reach = clamp01(t / 0.38);
        const shake = clamp01((t - 0.38) / 0.4);
        const shakeWave = Math.sin(shake * TAU * 3) * shake * (1 - shake) * 4;
        return {
          shoulderR: [-2.3 * reach + shakeWave * 0.16, 0, -0.3],
          shoulderL: [-2.1 * reach + shakeWave * 0.14, 0, 0.3],
          elbowR: [-0.5 - reach * 0.3, 0, 0],
          elbowL: [-0.5 - reach * 0.3, 0, 0],
          torso: [-0.16 * reach, shakeWave * 0.06, 0],
          head: [-0.3 * reach, 0, 0],
          hips: [0, shakeWave * 0.04, 0],
        };
      },
    },

    // --- Water -------------------------------------------------------------
    swim: {
      period: 1.6,
      loop: true,
      bob: (t) => Math.sin((t / 1.6) * TAU) * 0.05 - 0.42,
      evaluate: (t) => {
        const stroke = t * TAU;
        return {
          torso: [1.15, 0, 0],
          neck: [-0.7, 0, 0],
          head: [-0.35, Math.sin(stroke * 0.5) * 0.25, 0],
          shoulderL: [-1.4 + Math.sin(stroke) * 1.5, 0, 0.5],
          shoulderR: [-1.4 + Math.sin(stroke + Math.PI) * 1.5, 0, -0.5],
          elbowL: [-0.5, 0, 0],
          elbowR: [-0.5, 0, 0],
          hipL: [-1.0 + Math.sin(stroke * 2) * 0.35, 0, 0],
          hipR: [-1.0 + Math.sin(stroke * 2 + Math.PI) * 0.35, 0, 0],
          kneeL: [0.3, 0, 0],
          kneeR: [0.3, 0, 0],
        };
      },
    },

    dive: {
      period: 1.1,
      duration: 1.1,
      loop: false,
      bob: (t) => -0.42 - clamp01(t / 1.1) * 0.5,
      evaluate: (t) => {
        const tuck = Math.sin(clamp01(t) * Math.PI);
        return {
          torso: [1.15 + tuck * 0.9, 0, 0],
          hipL: [-1.0 - tuck * 1.2, 0, 0],
          hipR: [-1.0 - tuck * 1.2, 0, 0],
          kneeL: [tuck * 1.8, 0, 0],
          kneeR: [tuck * 1.8, 0, 0],
          shoulderL: [-2.4, 0, 0.2],
          shoulderR: [-2.4, 0, -0.2],
          head: [-0.5, 0, 0],
        };
      },
    },

    // --- Social ------------------------------------------------------------
    sit: {
      period: 4.6,
      loop: true,
      bob: () => -0.42,
      evaluate: (t) => {
        const breathe = Math.sin(t * TAU);
        return {
          hips: [0.06, 0, 0],
          hipL: [-1.52, 0.08, 0],
          hipR: [-1.52, -0.08, 0],
          kneeL: [1.5, 0, 0],
          kneeR: [1.5, 0, 0],
          footL: [0.2, 0, 0],
          footR: [0.2, 0, 0],
          torso: [0.05 + breathe * 0.02, 0, 0],
          shoulderL: [0.35, 0, 0.15],
          shoulderR: [0.35, 0, -0.15],
          elbowL: [-0.5, 0, 0],
          elbowR: [-0.5, 0, 0],
          head: [breathe * 0.02, Math.sin(t * TAU * 0.35) * 0.14, 0],
        };
      },
    },

    celebrate: {
      period: 1.5,
      duration: 1.5,
      loop: false,
      bob: (t) => Math.max(0, Math.sin(clamp01(t / 1.5) * Math.PI * 3)) * 0.16,
      evaluate: (t) => {
        const raise = clamp01(t / 0.28);
        const wave = Math.sin(t * TAU * 2.4);
        return {
          shoulderL: [-2.7 * raise, 0, 0.4 + wave * 0.2],
          shoulderR: [-2.7 * raise, 0, -0.4 - wave * 0.2],
          elbowL: [-0.3, 0, wave * 0.3],
          elbowR: [-0.3, 0, -wave * 0.3],
          torso: [-0.14 * raise, wave * 0.08, 0],
          head: [-0.24 * raise, wave * 0.1, 0],
          hipL: [wave * 0.14, 0, 0],
          hipR: [-wave * 0.14, 0, 0],
        };
      },
    },

    talk: {
      period: 2.4,
      loop: true,
      evaluate: (t) => {
        // Small, irregular gestures — enough to read as speech, never busy.
        const beat = Math.sin(t * TAU * 2.2);
        const beat2 = Math.sin(t * TAU * 1.3 + 1.1);
        return {
          torso: [beat2 * 0.03, beat * 0.05, 0],
          head: [beat * 0.05, beat2 * 0.1, beat * 0.03],
          shoulderR: [-0.35 + beat * 0.22, 0, -0.35],
          elbowR: [-0.9 + beat2 * 0.28, 0, 0],
          shoulderL: [0.15 + beat2 * 0.08, 0, 0.18],
          elbowL: [-0.35, 0, 0],
        };
      },
    },

    sleep: {
      period: 5.5,
      loop: true,
      bob: () => -0.62,
      evaluate: (t) => {
        const breathe = Math.sin(t * TAU);
        return {
          hips: [0.2, 0, 0],
          torso: [0.35 + breathe * 0.03, 0, 0.1],
          neck: [0.25, 0, 0.14],
          head: [0.3, 0.2, 0.16],
          hipL: [-1.3, 0.2, 0],
          hipR: [-1.35, -0.1, 0],
          kneeL: [1.4, 0, 0],
          kneeR: [1.2, 0, 0],
          shoulderL: [0.4, 0, 0.5],
          shoulderR: [0.35, 0, -0.4],
          elbowL: [-1.1, 0, 0],
          elbowR: [-1.0, 0, 0],
        };
      },
    },

    carry: {
      period: 1.0,
      loop: true,
      speedScaled: true,
      bob: (t) => Math.abs(Math.sin(t * TAU)) * 0.03 - 0.015,
      evaluate: (t, intensity) => {
        const pose = stride(t, 0.42 * intensity, 0);
        // Both arms hold the item out in front, clear of the walk cycle.
        pose.shoulderL = [-1.15, 0, 0.3];
        pose.shoulderR = [-1.15, 0, -0.3];
        pose.elbowL = [-0.9, 0, 0];
        pose.elbowR = [-0.9, 0, 0];
        pose.torso = [-0.06, 0, 0];
        return pose;
      },
    },
  };
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function easeInCubic(t: number): number {
  return t * t * t;
}
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
