import type { InventoryItem } from '@/items/types';
// Type-only, so this does not create an import cycle with the inventory.
import type { Stack } from '@/inventory/Inventory';
import type { WeatherKind } from '@/time/WeatherSystem';
import type { InteractionOption } from '@/interactions/types';

export interface ToastPayload {
  text: string;
  icon?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'rare';
}

export interface CatchCardPayload {
  item: InventoryItem;
  headline: string;
  /** Measured size in cm, when the species tracks size (fish, sea creatures). */
  sizeCm?: number;
  isNewSpecies: boolean;
  isRecord: boolean;
}

export interface DialoguePayload {
  speakerId: string;
  speakerName: string;
  accent: string;
  lines: string[];
  /** Optional follow-up choices rendered after the final line. */
  choices?: { id: string; label: string }[];
}

export interface GameEvents {
  'time:hour': { hour: number; day: number };
  'time:day': { day: number; season: string };
  'time:phase': { phase: string };
  'weather:change': { kind: WeatherKind; previous: WeatherKind };

  'player:moved': { x: number; z: number };
  'player:enteredRegion': { regionId: string; name: string };
  'player:enterInterior': { interiorId: string };
  'player:exitInterior': { interiorId: string };

  'inventory:changed': { stacks: Stack[]; capacity: number };
  'inventory:full': { attempted: InventoryItem };
  'item:gained': { item: InventoryItem; quantity: number };
  'item:removed': { itemId: string; quantity: number };

  'currency:changed': { coins: number; delta: number };

  'museum:donated': { item: InventoryItem; totalDonated: number };
  'museum:wingProgress': { wing: string; owned: number; total: number };

  'fishing:state': { state: string };
  'fishing:caught': CatchCardPayload;

  'quest:updated': { id: string; progress: number; goal: number };
  'quest:completed': { id: string; title: string; reward: number };

  'friendship:changed': { villagerId: string; value: number; delta: number };

  'ui:toast': ToastPayload;
  'ui:catchCard': CatchCardPayload;
  'ui:dialogue': DialoguePayload;
  'ui:dialogueClosed': { speakerId: string };
  'ui:panel': { id: string | null };
  'ui:prompts': { options: InteractionOption[] };

  'audio:sfx': { id: string; volume?: number; rate?: number };
  'audio:music': { id: string | null };

  'save:written': { slot: number };
  'save:loaded': { slot: number; migratedFrom: number | null };
}
