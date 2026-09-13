import type { CatchCardPayload } from '@/core/events';
import { iconFor } from '@/items/ItemIcons';
import { getItemDef } from '@/data/items';
import { el, removeAfter } from './dom';
import { RARITY_COLORS } from './icons';
import type { UIRoot } from './UIRoot';

const RARITY_LABEL: Record<string, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  legendary: 'Legendary',
  crafted: 'Crafted',
};

/**
 * The reveal that plays after a catch, a dig, or a rare find.
 *
 * It is the game's one loud moment, so it earns a full card: the item's
 * artwork springs in, the rarity and size are called out, and a ribbon marks
 * anything new or record-breaking.
 */
export class CatchCard {
  private node: HTMLElement | null = null;
  private timer = 0;

  constructor(private ui: UIRoot) {}

  get isOpen(): boolean {
    return this.node !== null;
  }

  show(payload: CatchCardPayload): void {
    this.dismiss(true);
    const def = getItemDef(payload.item.defId);
    const rarity = payload.item.rarity;

    const meta: HTMLElement[] = [
      el('span', {
        class: 'cc-tag',
        text: RARITY_LABEL[rarity] ?? rarity,
        style: `background:${RARITY_COLORS[rarity] ?? 'var(--rarity-common)'}`,
      }),
    ];
    if (payload.sizeCm) {
      meta.push(el('span', { class: 'cc-tag', text: `${payload.sizeCm.toFixed(1)} cm`, style: 'background:var(--sea)' }));
    }
    meta.push(el('span', { class: 'cc-tag', text: `${payload.item.value} shells`, style: 'background:var(--sun);color:#4a3410' }));

    const card = el('div', { class: `cc-catch ${rarity === 'rare' || rarity === 'legendary' ? 'rare' : ''}` }, [
      el('div', { class: 'headline', text: payload.headline }),
      el('div', { class: 'art' }, [el('img', { src: iconFor(payload.item.defId, 256), alt: payload.item.name })]),
      el('h2', { text: payload.item.name }),
      el('div', { class: 'meta' }, meta),
      def?.description ? el('p', { class: 'flavour', text: def.description }) : null,
      payload.isNewSpecies
        ? el('div', { class: 'ribbon', text: 'New to the collection' })
        : payload.isRecord
          ? el('div', { class: 'ribbon record', text: 'Personal best' })
          : null,
    ]);

    this.node = el('div', { id: 'catch-card' }, [card]);
    this.ui.layers.overlay.append(this.node);
    // Rare finds hold on screen a beat longer.
    this.timer = rarity === 'rare' || rarity === 'legendary' ? 4.4 : 3.1;
  }

  dismiss(immediate = false): void {
    const node = this.node;
    this.node = null;
    this.timer = 0;
    if (!node) return;
    if (immediate) node.remove();
    else {
      const card = node.querySelector('.cc-catch');
      card?.classList.add('leaving');
      removeAfter(node, 'leaving', 280);
    }
  }

  update(dt: number): void {
    if (!this.node) return;
    this.timer -= dt;
    if (this.timer <= 0) this.dismiss();
  }
}
