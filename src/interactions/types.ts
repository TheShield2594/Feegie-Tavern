import type { GameAction } from '@/input/actions';

/** What kind of thing the player is standing next to. */
export type InteractionKind =
  | 'talk'
  | 'enter'
  | 'exit'
  | 'fish'
  | 'shake'
  | 'chop'
  | 'mine'
  | 'dig'
  | 'catch'
  | 'gather'
  | 'harvest'
  | 'plant'
  | 'water'
  | 'till'
  | 'sit'
  | 'donate'
  | 'shop'
  | 'sleep'
  | 'read'
  | 'dive'
  | 'decorate'
  | 'custom';

/** One prompt offered to the player, e.g. "A — Shake". */
export interface InteractionOption {
  id: string;
  kind: InteractionKind;
  /** Verb shown next to the button glyph. */
  label: string;
  /** Optional second line, e.g. the villager's name or the fish on the line. */
  detail?: string;
  action: GameAction;
  /** Higher wins when several targets are in range. */
  priority: number;
  /** World position the prompt anchors to. */
  worldX: number;
  worldY: number;
  worldZ: number;
  /** Set when the interaction is visible but currently unavailable. */
  disabledReason?: string;
  perform: () => void;
}

/** Implemented by anything the player can walk up to and use. */
export interface Interactable {
  readonly interactableId: string;
  /** Distance in metres at which the prompt appears. */
  readonly interactRadius: number;
  getWorldPosition(): { x: number; y: number; z: number };
  /** Return null when the target currently offers nothing. */
  getInteraction(context: InteractionContext): InteractionOption | null;
}

export interface InteractionContext {
  playerX: number;
  playerY: number;
  playerZ: number;
  /** Squared distance from the player, precomputed by the system. */
  distanceSq: number;
  hour: number;
  day: number;
}
