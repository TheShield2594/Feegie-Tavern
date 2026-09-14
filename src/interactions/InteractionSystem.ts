import type { EventBus } from '@/core/EventBus';
import type { GameAction } from '@/input/actions';
import type { InteractionContext, InteractionOption } from './types';

export type InteractionProvider = (context: InteractionContext) => InteractionOption | InteractionOption[] | null;

/**
 * Contextual prompts.
 *
 * Providers are registered by each gameplay system and asked once per frame
 * what, if anything, is available where the player is standing. The best few
 * are published on the bus for the HUD to render, so prompts appear and
 * disappear with the world instead of living permanently in the interface.
 */
export class InteractionSystem {
  private providers = new Map<string, InteractionProvider>();
  private current: InteractionOption[] = [];
  private lastSignature = '';
  /** Re-evaluated at this interval rather than every frame. */
  private pollTimer = 0;
  private readonly pollInterval = 1 / 15;

  constructor(private bus: EventBus) {}

  register(id: string, provider: InteractionProvider): () => void {
    this.providers.set(id, provider);
    return () => this.providers.delete(id);
  }

  clear(): void {
    this.providers.clear();
    this.current = [];
    this.lastSignature = '';
    this.bus.emit('ui:prompts', { options: [] });
  }

  /** The prompt the action button would trigger, or null. */
  get primary(): InteractionOption | null {
    return this.current[0] ?? null;
  }

  get options(): readonly InteractionOption[] {
    return this.current;
  }

  /**
   * Runs the highest-priority enabled interaction bound to `action`.
   *
   * The prompt tells the player which button does what, so the button they
   * press has to pick the matching prompt — running whatever happens to be
   * first would let A fire an option the HUD has labelled X.
   */
  trigger(action: GameAction): boolean {
    const option = this.current.find((o) => o.action === action && !o.disabledReason);
    if (!option) return false;
    option.perform();
    return true;
  }

  /** Suppresses prompts, e.g. while a panel is open or a cutscene is running. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.current = [];
      this.lastSignature = '';
      this.bus.emit('ui:prompts', { options: [] });
    }
  }

  private enabled = true;

  update(dt: number, context: Omit<InteractionContext, 'distanceSq'>): void {
    if (!this.enabled) return;
    this.pollTimer -= dt;
    if (this.pollTimer > 0) return;
    this.pollTimer = this.pollInterval;

    const found: InteractionOption[] = [];
    for (const provider of this.providers.values()) {
      const result = provider({ ...context, distanceSq: 0 });
      if (!result) continue;
      if (Array.isArray(result)) found.push(...result);
      else found.push(result);
    }

    found.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      const da = (a.worldX - context.playerX) ** 2 + (a.worldZ - context.playerZ) ** 2;
      const db = (b.worldX - context.playerX) ** 2 + (b.worldZ - context.playerZ) ** 2;
      return da - db;
    });

    // Two prompts at once is the most a player can read at a glance.
    this.current = found.slice(0, 2);

    // Only publish when something actually changed, so the HUD's entrance
    // animations do not restart every poll.
    const signature = this.current
      .map((o) => `${o.id}:${o.label}:${o.detail ?? ''}:${o.disabledReason ?? ''}`)
      .join('|');
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.bus.emit('ui:prompts', { options: this.current });
    }
  }
}
