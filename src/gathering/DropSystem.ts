import { Group, Vector3 } from 'three';
import type { EventBus } from '@/core/EventBus';
import { makeItemModel } from '@/items/ItemModels';
import { clamp01 } from '@/util/math';

interface Drop {
  defId: string;
  model: Group;
  position: Vector3;
  velocity: Vector3;
  age: number;
  /** Seconds before the drop starts homing on the player. */
  delay: number;
  spin: number;
  collected: boolean;
  onCollect: () => void;
}

const GRAVITY = -16;
const HOME_SPEED = 13;
const MAX_LIFETIME = 12;

/**
 * Items you gather physically pop out of the tree, rock or soil, land, and then
 * fly to the player before entering the bag. It is a small thing that makes
 * every harvest feel like it happened in the world rather than in a menu.
 */
export class DropSystem {
  readonly group = new Group();
  private drops: Drop[] = [];
  private pool: Map<string, Group[]> = new Map();

  constructor(private bus: EventBus) {
    this.group.name = 'Drops';
  }

  /**
   * @param onCollect Runs when the drop reaches the player — this is where the
   * item actually enters the inventory, so a full bag can reject it there.
   */
  spawn(defId: string, at: Vector3, onCollect: () => void, options: { spread?: number; upward?: number } = {}): void {
    const model = this.acquire(defId);
    model.position.copy(at);
    model.visible = true;
    this.group.add(model);

    const spread = options.spread ?? 1.8;
    this.drops.push({
      defId,
      model,
      position: at.clone(),
      velocity: new Vector3(
        (Math.random() * 2 - 1) * spread,
        options.upward ?? 4.2 + Math.random() * 1.4,
        (Math.random() * 2 - 1) * spread,
      ),
      age: 0,
      delay: 0.42 + Math.random() * 0.2,
      spin: (Math.random() * 2 - 1) * 5,
      collected: false,
      onCollect,
    });
  }

  private acquire(defId: string): Group {
    const bucket = this.pool.get(defId);
    const reused = bucket?.pop();
    if (reused) return reused;
    return makeItemModel(defId, 1.1);
  }

  private release(drop: Drop): void {
    this.group.remove(drop.model);
    drop.model.visible = false;
    let bucket = this.pool.get(drop.defId);
    if (!bucket) {
      bucket = [];
      this.pool.set(drop.defId, bucket);
    }
    // Cap the pool so a long session does not hoard meshes for one-off items.
    if (bucket.length < 8) bucket.push(drop.model);
  }

  update(dt: number, playerPosition: Vector3, groundHeight: (x: number, z: number) => number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      drop.age += dt;

      if (drop.age < drop.delay) {
        // Ballistic phase: arc out of whatever produced it and settle.
        drop.velocity.y += GRAVITY * dt;
        drop.position.addScaledVector(drop.velocity, dt);
        const ground = groundHeight(drop.position.x, drop.position.z) + 0.2;
        if (drop.position.y < ground) {
          drop.position.y = ground;
          drop.velocity.y *= -0.32;
          drop.velocity.x *= 0.55;
          drop.velocity.z *= 0.55;
          if (Math.abs(drop.velocity.y) < 0.6) drop.velocity.y = 0;
        }
      } else {
        // Homing phase: accelerate toward the player's chest.
        const target = new Vector3(playerPosition.x, playerPosition.y + 0.95, playerPosition.z);
        const toTarget = target.clone().sub(drop.position);
        const distance = toTarget.length();
        if (distance < 0.45 && !drop.collected) {
          drop.collected = true;
          drop.onCollect();
          this.bus.emit('audio:sfx', { id: 'item.pickup', rate: 0.94 + Math.random() * 0.16 });
          this.release(drop);
          this.drops.splice(i, 1);
          continue;
        }
        const ease = clamp01((drop.age - drop.delay) / 0.35);
        drop.position.addScaledVector(toTarget.normalize(), HOME_SPEED * ease * dt);
      }

      drop.model.position.copy(drop.position);
      drop.model.rotation.y += drop.spin * dt;
      drop.model.rotation.x += drop.spin * 0.4 * dt;
      // A gentle pulse so drops read as collectable rather than as scenery.
      const pulse = 1 + Math.sin(drop.age * 9) * 0.06;
      drop.model.scale.setScalar(pulse);

      if (drop.age > MAX_LIFETIME) {
        if (!drop.collected) drop.onCollect();
        this.release(drop);
        this.drops.splice(i, 1);
      }
    }
  }

  get activeCount(): number {
    return this.drops.length;
  }

  clear(): void {
    for (const drop of this.drops) this.release(drop);
    this.drops.length = 0;
  }
}
