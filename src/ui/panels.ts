import { ALL_SPECIES } from '@/data/species';
import { CRAFTING, RECIPES } from '@/data/recipes';
import { FURNITURE, HOUSE_STYLES } from '@/data/furniture';
import {
  CLOTH_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  HATS,
  OUTFITS,
  SHOES,
  SKIN_TONES,
  type CharacterLook,
} from '@/data/clothing';
import { PUBLIC_WORKS, STORY_BEATS } from '@/data/quests';
import { VILLAGERS } from '@/data/villagers';
import { iconFor } from '@/items/ItemIcons';
import type { ItemCategory } from '@/items/types';
import type { Stack } from '@/inventory/Inventory';
import { WINGS } from '@/museum/Museum';
import { clear, el, formatCoins } from './dom';
import { Icons, RARITY_COLORS } from './icons';
import { villagerPortrait } from './portraits';
import type { UIRoot } from './UIRoot';

/**
 * Everything the panels need from the game. Passing one context keeps panel
 * code declarative and means panels never reach into systems themselves.
 */
export interface PanelContext {
  ui: UIRoot;
  coins: number;
  day: number;
  season: string;
  materials: { wood: number; stone: number; fiber: number };
  seeds: number;
  toolLevels: Record<string, number>;
  bagLevel: number;
  homeLevel: number;
  houseStyleId: string;
  ownedFurniture: string[];
  placedFurniture: { defId: string }[];
  look: CharacterLook;
  townRating: number;
  townWorks: { bridge: boolean; stairs: boolean; lighthouse: boolean };
  storyStage: number;
  cooked: number;
  stats: { totalCaught: number; totalSold: number; harvested: number };

  inventoryStacks: (sort: string, filter: ItemCategory | 'all') => Stack[];
  inventoryCount: number;
  inventoryCapacity: number;

  museumHas: (defId: string) => boolean;
  museumProgress: () => { wing: string; name: string; owned: number; total: number; completion: number }[];

  friendship: (villagerId: string) => number;
  requestFor: (villagerId: string) => { itemDefId: string; reward: number; done: boolean } | null;
  scheduleLabel: (villagerId: string) => string;

  shopStock: () => { defId: string; price: number; kind: 'furniture' | 'seed' | 'clothing' }[];

  // Actions
  sell: (stackKey: string, quantity: number) => void;
  sellAllDuplicates: () => void;
  buy: (defId: string, price: number, kind: string) => void;
  donate: (defId: string) => void;
  toggleFavorite: (uid: string) => void;
  craft: (recipeId: string) => void;
  upgradeBag: () => void;
  cook: (recipeId: string) => void;
  buildWork: (id: 'bridge' | 'stairs' | 'lighthouse') => void;
  upgradeHome: () => void;
  setHouseStyle: (styleId: string) => void;
  setLook: (look: CharacterLook) => void;
  placeFurniture: (defId: string) => void;
  enterDecorateMode: () => void;
  drawMap: (canvas: HTMLCanvasElement) => { x: number; y: number; label: string; color: string; player?: boolean }[];
}

const CATEGORY_TABS: { id: ItemCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'fish', label: 'Fish' },
  { id: 'bug', label: 'Bugs' },
  { id: 'fossil', label: 'Fossils' },
  { id: 'sea', label: 'Sea' },
  { id: 'crop', label: 'Crops' },
  { id: 'material', label: 'Materials' },
  { id: 'meal', label: 'Dishes' },
];

// --- Inventory ---------------------------------------------------------------

export function openInventory(context: PanelContext): void {
  let filter: ItemCategory | 'all' = 'all';
  let sort = 'category';
  let selectedKey: string | null = null;

  context.ui.open({
    id: 'inventory',
    eyebrow: 'Pockets',
    title: 'Backpack',
    width: 760,
    build: (body, panel) => {
      const tabs = el('div', { class: 'cc-tabs' });
      for (const tab of CATEGORY_TABS) {
        tabs.append(el('button', {
          class: `cc-tab ${filter === tab.id ? 'active' : ''}`,
          text: tab.label,
          onclick: () => { filter = tab.id; panel.refresh(); },
        }));
      }

      const sortRow = el('div', { class: 'cc-option-row', style: 'margin-bottom:14px' });
      for (const mode of ['category', 'value', 'name', 'recent']) {
        sortRow.append(el('button', {
          class: `cc-option ${sort === mode ? 'active' : ''}`,
          text: mode[0].toUpperCase() + mode.slice(1),
          onclick: () => { sort = mode; panel.refresh(); },
        }));
      }

      const stacks = context.inventoryStacks(sort, filter);
      const grid = el('div', { class: 'cc-grid' });
      const detail = el('div', { class: 'cc-detail', style: 'margin-top:16px' });

      const renderDetail = (stack: Stack | null) => {
        clear(detail);
        if (!stack) {
          detail.append(el('p', { class: 'cc-muted', text: 'Select something to see what it is worth and where it belongs.' }));
          return;
        }
        const item = stack.items[0];
        const donatable = ALL_SPECIES.some((s) => s.id === stack.defId);
        const inMuseum = context.museumHas(stack.defId);
        const species = ALL_SPECIES.find((s) => s.id === stack.defId);

        detail.append(
          el('div', { class: 'art' }, [el('img', { src: iconFor(stack.defId, 160), alt: stack.name })]),
          el('div', { style: 'flex:1 1 auto;min-width:0' }, [
            el('h3', { text: stack.name }),
            el('div', {}, [
              el('span', {
                class: 'cc-tag',
                text: stack.rarity,
                style: `background:${RARITY_COLORS[stack.rarity] ?? 'var(--rarity-common)'}`,
              }),
              donatable
                ? el('span', {
                    class: 'cc-tag',
                    text: inMuseum ? 'In the museum' : 'Not yet donated',
                    style: `margin-left:6px;background:${inMuseum ? 'var(--leaf)' : 'var(--plum)'}`,
                  })
                : el('span'),
            ]),
            el('p', { class: 'cc-muted', style: 'margin-top:8px', text: species?.description ?? '' }),
            el('div', { class: 'cc-stat-row' }, [
              statBlock('Each', `${item.value}`),
              statBlock('Held', `${stack.items.length}`),
              statBlock('Total', `${stack.value}`),
              item.sizeCm ? statBlock('Length', `${item.sizeCm.toFixed(1)} cm`) : el('span'),
            ]),
            el('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' }, [
              el('button', {
                class: 'cc-btn',
                text: `Sell one · ${item.value}`,
                onclick: () => { context.sell(stack.key, 1); panel.refresh(); },
              }),
              stack.items.length > 1
                ? el('button', {
                    class: 'cc-btn',
                    text: `Sell all · ${stack.value}`,
                    onclick: () => { context.sell(stack.key, stack.items.length); panel.refresh(); },
                  })
                : el('span'),
              donatable && !inMuseum
                ? el('button', {
                    class: 'cc-btn primary',
                    text: 'Donate',
                    onclick: () => { context.donate(stack.defId); panel.refresh(); },
                  })
                : el('span'),
              el('button', {
                class: 'cc-btn ghost',
                text: item.favorite ? 'Unlock' : 'Lock',
                onclick: () => { context.toggleFavorite(item.uid); panel.refresh(); },
              }),
            ]),
          ]),
        );
      };

      if (stacks.length === 0) {
        grid.append(el('p', { class: 'cc-muted', text: 'Nothing here yet. The island is full of things worth picking up.' }));
      }

      for (const stack of stacks) {
        const donatable = ALL_SPECIES.some((s) => s.id === stack.defId);
        const needsDonating = donatable && !context.museumHas(stack.defId);
        const slot = el('button', {
          class: `cc-slot ${selectedKey === stack.key ? 'selected' : ''} ${needsDonating ? 'new' : ''}`,
          title: stack.name,
          onclick: () => { selectedKey = stack.key; panel.refresh(); },
        }, [
          el('span', {
            class: 'rarity-bar',
            style: `background:${RARITY_COLORS[stack.rarity] ?? 'var(--rarity-common)'}`,
          }),
          el('img', { src: iconFor(stack.defId, 128), alt: stack.name }),
        ]);
        if (stack.items.length > 1) slot.append(el('span', { class: 'qty', text: `${stack.items.length}` }));
        if (needsDonating) slot.append(el('span', { class: 'badge donate', text: '!' }));
        if (stack.items[0].favorite) slot.append(el('span', { class: 'badge fav', text: '★' }));
        grid.append(slot);
      }

      // Empty slots make the bag's capacity legible at a glance.
      const emptyCount = Math.max(0, context.inventoryCapacity - context.inventoryCount);
      for (let i = 0; i < Math.min(emptyCount, 12); i++) {
        grid.append(el('div', { class: 'cc-slot empty' }));
      }

      body.append(tabs, sortRow, grid, detail);
      renderDetail(stacks.find((s) => s.key === selectedKey) ?? null);
    },
    footer: (foot) => {
      clear(foot);
      foot.append(
        el('span', { text: `${context.inventoryCount} / ${context.inventoryCapacity} carried` }),
        el('span', { class: 'cc-muted', text: 'Duplicates sell well at the boardwalk.' }),
      );
    },
  });
}

function statBlock(label: string, value: string): HTMLElement {
  return el('div', { class: 'cc-stat' }, [
    el('span', { class: 'label', text: label }),
    el('span', { class: 'value', text: value }),
  ]);
}

// --- Museum ------------------------------------------------------------------

export function openMuseum(context: PanelContext): void {
  let wingFilter = 'all';

  context.ui.open({
    id: 'museum',
    eyebrow: 'Archive Hall',
    title: 'Collection',
    width: 820,
    build: (body, panel) => {
      const progress = context.museumProgress();
      const owned = progress.reduce((sum, w) => sum + w.owned, 0);
      const total = progress.reduce((sum, w) => sum + w.total, 0);

      const overview = el('div', { class: 'cc-grid wide', style: 'margin-bottom:18px' });
      for (const wing of progress) {
        overview.append(el('div', { class: 'cc-card clickable', onclick: () => { wingFilter = wing.wing; panel.refresh(); } }, [
          el('div', { class: 'row' }, [
            el('h3', { text: wing.name }),
            el('span', { class: 'cc-price', text: `${wing.owned}/${wing.total}` }),
          ]),
          el('div', { class: 'cc-progress' }, [el('i', { style: `width:${wing.completion * 100}%` })]),
          el('p', { text: WINGS.find((w) => w.id === wing.wing)?.blurb ?? '' }),
        ]));
      }

      const tabs = el('div', { class: 'cc-tabs' });
      tabs.append(el('button', {
        class: `cc-tab ${wingFilter === 'all' ? 'active' : ''}`,
        text: 'Everything',
        onclick: () => { wingFilter = 'all'; panel.refresh(); },
      }));
      for (const wing of WINGS) {
        tabs.append(el('button', {
          class: `cc-tab ${wingFilter === wing.id ? 'active' : ''}`,
          text: wing.name,
          onclick: () => { wingFilter = wing.id; panel.refresh(); },
        }));
      }

      const grid = el('div', { class: 'cc-grid' });
      for (const species of ALL_SPECIES) {
        if (wingFilter !== 'all' && species.wing !== wingFilter) continue;
        const has = context.museumHas(species.id);
        const slot = el('button', {
          class: 'cc-slot',
          title: has ? species.name : 'Not yet found',
          style: has ? '' : 'filter:grayscale(1) brightness(1.35);opacity:.42',
        }, [
          el('span', { class: 'rarity-bar', style: `background:${RARITY_COLORS[species.rarity]}` }),
          el('img', { src: iconFor(species.id, 128), alt: species.name }),
        ]);
        grid.append(slot);
      }

      body.append(
        el('div', { class: 'cc-detail', style: 'margin-bottom:18px' }, [
          el('div', { class: 'art', html: Icons.museum(56) }),
          el('div', {}, [
            el('h3', { text: `${owned} of ${total} catalogued` }),
            el('p', { class: 'cc-muted', text: 'Juniper mounts every new specimen the morning after it arrives. Wings light up as they fill.' }),
            el('div', { class: 'cc-progress gold', style: 'margin-top:10px' }, [
              el('i', { style: `width:${total ? (owned / total) * 100 : 0}%` }),
            ]),
          ]),
        ]),
        overview,
        tabs,
        grid,
      );
    },
  });
}

// --- Map ---------------------------------------------------------------------

export function openMap(context: PanelContext): void {
  context.ui.open({
    id: 'map',
    eyebrow: 'Cozy Cove',
    title: 'Island Map',
    width: 780,
    build: (body) => {
      const canvas = el('canvas', { width: 720, height: 560 });
      const wrap = el('div', { class: 'cc-map-wrap' }, [canvas]);
      const pins = context.drawMap(canvas);

      for (const pin of pins) {
        wrap.append(el('div', {
          class: `cc-map-pin ${pin.player ? 'player' : ''}`,
          style: `left:${(pin.x / canvas.width) * 100}%; top:${(pin.y / canvas.height) * 100}%`,
        }, [
          el('span', { class: 'dot', style: `background:${pin.color}` }),
          el('span', { text: pin.label }),
        ]));
      }

      body.append(
        wrap,
        el('p', { class: 'cc-muted', style: 'margin-top:14px' , text: 'Paths, bridges and stairs open up as the island grows. Public works are commissioned at the town hall.' }),
      );
    },
  });
}

// --- Shop --------------------------------------------------------------------

export function openShop(context: PanelContext): void {
  context.ui.open({
    id: 'shop',
    eyebrow: "Bruno's Boardwalk",
    title: 'General Store',
    width: 820,
    build: (body, panel) => {
      const stock = context.shopStock();
      const buyGrid = el('div', { class: 'cc-grid wide' });

      for (const entry of stock) {
        const affordable = context.coins >= entry.price;
        const owned = entry.kind === 'furniture' && context.ownedFurniture.includes(entry.defId);
        const name = FURNITURE.find((f) => f.id === entry.defId)?.name
          ?? HOUSE_STYLES.find((h) => h.id === entry.defId)?.name
          ?? entry.defId;
        const description = FURNITURE.find((f) => f.id === entry.defId)?.description ?? '';

        buyGrid.append(el('div', { class: 'cc-card' }, [
          el('div', { class: 'row' }, [
            el('div', { class: 'thumb' }, [el('img', { src: iconFor(entry.defId, 96), alt: name })]),
            el('div', { style: 'flex:1 1 auto;min-width:0' }, [
              el('h3', { text: name }),
              el('p', { text: description }),
            ]),
          ]),
          el('div', { class: 'row' }, [
            el('span', { class: 'cc-price spend', text: `${formatCoins(entry.price)} shells` }),
            el('button', {
              class: `cc-btn ${affordable && !owned ? 'primary' : ''}`,
              text: owned ? 'Owned' : affordable ? 'Buy' : 'Too pricey',
              disabled: owned || !affordable,
              onclick: () => { context.buy(entry.defId, entry.price, entry.kind); panel.refresh(); },
            }),
          ]),
        ]));
      }

      const sellStacks = context.inventoryStacks('value', 'all');
      const sellGrid = el('div', { class: 'cc-grid' });
      for (const stack of sellStacks) {
        if (stack.items[0].favorite) continue;
        const slot = el('button', {
          class: 'cc-slot',
          title: `${stack.name} · ${stack.items[0].value} each`,
          onclick: () => { context.sell(stack.key, 1); panel.refresh(); },
        }, [
          el('span', { class: 'rarity-bar', style: `background:${RARITY_COLORS[stack.rarity]}` }),
          el('img', { src: iconFor(stack.defId, 128), alt: stack.name }),
        ]);
        if (stack.items.length > 1) slot.append(el('span', { class: 'qty', text: `${stack.items.length}` }));
        sellGrid.append(slot);
      }
      if (sellStacks.length === 0) {
        sellGrid.append(el('p', { class: 'cc-muted', text: 'Your bag is empty. Bruno looks disappointed but supportive.' }));
      }

      body.append(
        el('div', { class: 'cc-section' }, [
          el('h4', { text: "Today's stock" }),
          el('p', { class: 'cc-muted', style: 'margin-bottom:12px', text: 'Bruno rotates the shelves at dawn.' }),
          buyGrid,
        ]),
        el('div', { class: 'cc-section' }, [
          el('h4', { text: 'Sell from your bag' }),
          el('p', { class: 'cc-muted', style: 'margin-bottom:12px', text: 'Click an item to sell one. Locked items are never sold.' }),
          sellGrid,
        ]),
      );
    },
    footer: (foot, panel) => {
      clear(foot);
      foot.append(
        el('span', { text: `Purse: ${formatCoins(context.coins)} shells` }),
        el('button', {
          class: 'cc-btn warm',
          text: 'Sell all duplicates',
          onclick: () => { context.sellAllDuplicates(); panel.refresh(); },
        }),
      );
    },
  });
}

// --- Journal (neighbours, quests, stats) --------------------------------------

export function openJournal(context: PanelContext): void {
  context.ui.open({
    id: 'journal',
    eyebrow: 'Island Life',
    title: 'Journal',
    width: 780,
    build: (body) => {
      const stats = el('div', { class: 'cc-stat-row', style: 'margin-bottom:20px' }, [
        statBlock('Day', `${context.day}`),
        statBlock('Season', context.season),
        statBlock('Caught', `${context.stats.totalCaught}`),
        statBlock('Sold', `${context.stats.totalSold}`),
        statBlock('Harvested', `${context.stats.harvested}`),
        statBlock('Island', `${'★'.repeat(context.townRating)}${'☆'.repeat(5 - context.townRating)}`),
      ]);

      const neighbours = el('div', { class: 'cc-grid wide' });
      for (const villager of VILLAGERS) {
        const level = Math.min(5, Math.floor(context.friendship(villager.id) / 20));
        const request = context.requestFor(villager.id);
        const hearts = el('span', { class: 'cc-hearts' });
        for (let i = 0; i < 5; i++) hearts.append(el('span', { class: `cc-heart ${i < level ? 'filled' : ''}`, html: Icons.heart(13, i < level) }));

        neighbours.append(el('div', { class: 'cc-card' }, [
          el('div', { class: 'row' }, [
            el('div', { class: 'thumb' }, [el('img', { src: villagerPortrait(villager.look, 'happy', 96), alt: villager.name })]),
            el('div', { style: 'flex:1 1 auto;min-width:0' }, [
              el('h3', { text: villager.name }),
              el('p', { text: villager.title }),
              hearts,
            ]),
          ]),
          el('p', { class: 'cc-muted', text: `Right now: ${context.scheduleLabel(villager.id) || 'around town'}` }),
          request && !request.done
            ? el('p', { style: 'color:var(--sun);font-weight:800;font-size:12.5px', text: `Wants: ${request.itemDefId.split('.').pop()} · ${request.reward} shells` })
            : el('span'),
        ]));
      }

      body.append(
        stats,
        el('div', { class: 'cc-section' }, [el('h4', { text: 'Neighbours' }), neighbours]),
      );
    },
  });
}

// --- Wardrobe / character creator --------------------------------------------

export function openWardrobe(context: PanelContext, onPreview?: (look: CharacterLook) => void): void {
  const working: CharacterLook = { ...context.look };

  context.ui.open({
    id: 'wardrobe',
    eyebrow: 'Character',
    title: 'Look & Clothing',
    width: 720,
    build: (body, panel) => {
      const apply = () => {
        context.setLook({ ...working });
        onPreview?.({ ...working });
        panel.refresh();
      };

      const section = (title: string, content: HTMLElement) =>
        el('div', { class: 'cc-section' }, [el('h4', { text: title }), content]);

      const swatchRow = (colors: { id: string; name: string; color: string }[], current: string, set: (c: string) => void) => {
        const row = el('div', { class: 'cc-swatches' });
        for (const swatch of colors) {
          row.append(el('button', {
            class: `cc-swatch ${current.toLowerCase() === swatch.color.toLowerCase() ? 'active' : ''}`,
            style: `background:${swatch.color}`,
            title: swatch.name,
            onclick: () => { set(swatch.color); apply(); },
          }));
        }
        return row;
      };

      const optionRow = <T extends string>(items: { id: T; name: string }[], current: T, set: (id: T) => void) => {
        const row = el('div', { class: 'cc-option-row' });
        for (const item of items) {
          row.append(el('button', {
            class: `cc-option ${current === item.id ? 'active' : ''}`,
            text: item.name,
            onclick: () => { set(item.id); apply(); },
          }));
        }
        return row;
      };

      body.append(
        el('p', { class: 'cc-muted', style: 'margin-bottom:16px', text: 'Changes show on your character straight away.' }),
        section('Skin', swatchRow(SKIN_TONES, working.skin, (c) => { working.skin = c; })),
        section('Hair style', optionRow(HAIR_STYLES, working.hairStyle, (id) => { working.hairStyle = id; })),
        section('Hair colour', swatchRow(HAIR_COLORS, working.hairColor, (c) => { working.hairColor = c; })),
        section('Outfit', optionRow(OUTFITS, working.outfit, (id) => { working.outfit = id; })),
        section('Top colour', swatchRow(CLOTH_COLORS, working.shirtColor, (c) => { working.shirtColor = c; })),
        section('Bottoms colour', swatchRow(CLOTH_COLORS, working.lowerColor, (c) => { working.lowerColor = c; })),
        section('Shoes', optionRow(SHOES, working.shoes, (id) => { working.shoes = id; })),
        section('Shoe colour', swatchRow(CLOTH_COLORS, working.shoeColor, (c) => { working.shoeColor = c; })),
        section('Hat', optionRow(HATS, working.hat, (id) => { working.hat = id; })),
        section('Hat colour', swatchRow(CLOTH_COLORS, working.hatColor, (c) => { working.hatColor = c; })),
      );
    },
  });
}

// --- Crafting ----------------------------------------------------------------

export function openCrafting(context: PanelContext): void {
  context.ui.open({
    id: 'craft',
    eyebrow: 'Workbench',
    title: 'Craft & Upgrade',
    width: 720,
    build: (body, panel) => {
      const resources = el('div', { class: 'cc-stat-row', style: 'margin-bottom:18px' }, [
        statBlock('Wood', `${context.materials.wood}`),
        statBlock('Stone', `${context.materials.stone}`),
        statBlock('Fiber', `${context.materials.fiber}`),
        statBlock('Shells', formatCoins(context.coins)),
      ]);

      const grid = el('div', { class: 'cc-grid wide' });
      for (const recipe of CRAFTING) {
        const level = context.toolLevels[recipe.tool ?? ''] ?? 1;
        const maxed = level >= (recipe.maxLevel ?? 3);
        const cost = recipe.cost(level);
        const affordable =
          context.materials.wood >= cost.wood &&
          context.materials.stone >= cost.stone &&
          context.materials.fiber >= cost.fiber &&
          context.coins >= cost.coins;

        grid.append(el('div', { class: 'cc-card' }, [
          el('div', { class: 'row' }, [
            el('h3', { text: recipe.name }),
            el('span', { class: 'cc-tag', text: `Lv. ${level}`, style: 'background:var(--sea)' }),
          ]),
          el('p', { text: recipe.description }),
          maxed
            ? el('p', { style: 'color:var(--leaf);font-weight:800;font-size:12.5px', text: 'Masterwork — nothing left to improve.' })
            : el('p', { class: 'cc-muted', text: costLabel(cost) }),
          el('button', {
            class: `cc-btn ${affordable && !maxed ? 'primary' : ''}`,
            text: maxed ? 'Complete' : affordable ? 'Upgrade' : 'Need more',
            disabled: maxed || !affordable,
            onclick: () => { context.craft(recipe.id); panel.refresh(); },
          }),
        ]));
      }

      const bagLevel = context.bagLevel;
      const bagCost = 300 + bagLevel * 350;
      const bagFiber = 4 + bagLevel * 3;
      const bagMaxed = bagLevel >= 2;
      grid.append(el('div', { class: 'cc-card' }, [
        el('div', { class: 'row' }, [
          el('h3', { text: 'Backpack' }),
          el('span', { class: 'cc-tag', text: `${24 + bagLevel * 8} slots`, style: 'background:var(--leaf)' }),
        ]),
        el('p', { text: 'Woven from meadow fiber. Carry more before a trip back to town.' }),
        bagMaxed
          ? el('p', { style: 'color:var(--leaf);font-weight:800;font-size:12.5px', text: 'Fully expanded.' })
          : el('p', { class: 'cc-muted', text: `${bagFiber} fiber · ${formatCoins(bagCost)} shells` }),
        el('button', {
          class: 'cc-btn',
          text: bagMaxed ? 'Complete' : 'Expand',
          disabled: bagMaxed || context.materials.fiber < bagFiber || context.coins < bagCost,
          onclick: () => { context.upgradeBag(); panel.refresh(); },
        }),
      ]));

      body.append(resources, grid);
    },
  });
}

function costLabel(cost: { wood: number; stone: number; fiber: number; coins: number }): string {
  const parts: string[] = [];
  if (cost.wood) parts.push(`${cost.wood} wood`);
  if (cost.stone) parts.push(`${cost.stone} stone`);
  if (cost.fiber) parts.push(`${cost.fiber} fiber`);
  if (cost.coins) parts.push(`${formatCoins(cost.coins)} shells`);
  return parts.join(' · ');
}

// --- Cooking -----------------------------------------------------------------

export function openCooking(context: PanelContext): void {
  context.ui.open({
    id: 'cook',
    eyebrow: 'Kitchen',
    title: 'Cookbook',
    width: 680,
    build: (body, panel) => {
      const grid = el('div', { class: 'cc-grid wide' });
      for (const recipe of RECIPES) {
        const locked = context.cooked < recipe.unlockAfterCooked;
        grid.append(el('div', { class: 'cc-card' }, [
          el('div', { class: 'row' }, [
            el('div', { class: 'thumb' }, [el('img', { src: iconFor(recipe.resultItemId, 96), alt: recipe.name })]),
            el('div', { style: 'flex:1 1 auto;min-width:0' }, [
              el('h3', { text: locked ? '???' : recipe.name }),
              el('p', { text: locked ? `Cook ${recipe.unlockAfterCooked} dishes to learn this.` : recipe.description }),
            ]),
          ]),
          el('p', { class: 'cc-muted', text: locked ? '' : `Needs: ${recipe.needs.join(' + ')}` }),
          el('button', {
            class: 'cc-btn',
            text: locked ? 'Locked' : 'Cook',
            disabled: locked,
            onclick: () => { context.cook(recipe.id); panel.refresh(); },
          }),
        ]));
      }
      body.append(
        el('p', { class: 'cc-muted', style: 'margin-bottom:14px', text: 'Turn the day’s finds into something worth far more than its parts.' }),
        grid,
      );
    },
  });
}

// --- Town hall ---------------------------------------------------------------

export function openTownHall(context: PanelContext): void {
  context.ui.open({
    id: 'town',
    eyebrow: 'Island Progress',
    title: 'Town Hall',
    width: 760,
    build: (body, panel) => {
      const stars = el('div', { style: 'display:flex;gap:4px;margin:6px 0 12px' });
      for (let i = 0; i < 5; i++) stars.append(el('span', { html: Icons.star(26, i < context.townRating) }));

      const works = el('div', { class: 'cc-grid wide' });
      for (const work of PUBLIC_WORKS) {
        const built = context.townWorks[work.id];
        const affordable =
          context.coins >= work.cost.coins &&
          context.materials.wood >= work.cost.wood &&
          context.materials.stone >= work.cost.stone;
        works.append(el('div', { class: 'cc-card' }, [
          el('div', { class: 'row' }, [
            el('h3', { text: work.name }),
            built ? el('span', { class: 'cc-tag', text: 'Built', style: 'background:var(--leaf)' }) : el('span'),
          ]),
          el('p', { text: work.description }),
          built
            ? el('p', { style: 'color:var(--leaf);font-weight:800;font-size:12.5px', text: 'Finished. The island is better for it.' })
            : el('p', { class: 'cc-muted', text: `${formatCoins(work.cost.coins)} shells · ${work.cost.wood} wood · ${work.cost.stone} stone` }),
          built
            ? el('span')
            : el('button', {
                class: `cc-btn ${affordable ? 'primary' : ''}`,
                text: affordable ? 'Commission' : 'Not yet affordable',
                disabled: !affordable,
                onclick: () => { context.buildWork(work.id); panel.refresh(); },
              }),
        ]));
      }

      body.append(
        el('div', { class: 'cc-detail', style: 'margin-bottom:18px' }, [
          el('div', { class: 'art', html: Icons.townhall(56) }),
          el('div', {}, [
            el('h3', { text: `${context.townRating}-star island` }),
            stars,
            el('p', { class: 'cc-muted', text: 'Rating rises with donations, friendships, planting and public works.' }),
          ]),
        ]),
        el('div', { class: 'cc-section' }, [
          el('h4', { text: 'The story so far' }),
          el('div', { class: 'cc-card' }, [
            el('p', { style: 'font-size:14px;line-height:1.6', text: STORY_BEATS[Math.min(context.storyStage, STORY_BEATS.length - 1)].text }),
          ]),
        ]),
        el('div', { class: 'cc-section' }, [el('h4', { text: 'Public works' }), works]),
      );
    },
  });
}

// --- Home decoration ---------------------------------------------------------

export function openHome(context: PanelContext): void {
  context.ui.open({
    id: 'home',
    eyebrow: 'Your Cottage',
    title: 'Home & Exterior',
    width: 760,
    build: (body, panel) => {
      const upgradeCost = context.homeLevel * 2400;
      const canUpgrade = context.homeLevel < 4 && context.coins >= upgradeCost;

      const exteriors = el('div', { class: 'cc-grid wide' });
      for (const style of HOUSE_STYLES) {
        const active = context.houseStyleId === style.id;
        const affordable = context.coins >= style.price;
        exteriors.append(el('div', { class: 'cc-card' }, [
          el('div', { class: 'row' }, [
            el('div', { class: 'thumb', style: `background:${style.body}` }, [
              el('span', { style: `display:block;width:32px;height:16px;border-radius:4px 4px 0 0;background:${style.roof}` }),
            ]),
            el('div', { style: 'flex:1 1 auto' }, [
              el('h3', { text: style.name }),
              el('p', { text: style.price === 0 ? 'Included' : `${formatCoins(style.price)} shells` }),
            ]),
          ]),
          el('button', {
            class: `cc-btn ${active ? '' : affordable ? 'primary' : ''}`,
            text: active ? 'Current' : affordable ? 'Apply' : 'Too pricey',
            disabled: active || !affordable,
            onclick: () => { context.setHouseStyle(style.id); panel.refresh(); },
          }),
        ]));
      }

      const owned = el('div', { class: 'cc-grid' });
      const placed = new Set(context.placedFurniture.map((f) => f.defId));
      if (context.ownedFurniture.length === 0) {
        owned.append(el('p', { class: 'cc-muted', text: 'No furniture yet. Bruno keeps a rotating selection at the boardwalk.' }));
      }
      for (const defId of context.ownedFurniture) {
        const def = FURNITURE.find((f) => f.id === defId);
        if (!def) continue;
        owned.append(el('button', {
          class: `cc-slot ${placed.has(defId) ? 'selected' : ''}`,
          title: `${def.name}${placed.has(defId) ? ' · placed' : ''}`,
          onclick: () => { context.placeFurniture(defId); panel.refresh(); },
        }, [el('img', { src: iconFor(defId, 128), alt: def.name })]));
      }

      body.append(
        el('div', { class: 'cc-detail', style: 'margin-bottom:18px' }, [
          el('div', { class: 'art', html: Icons.home(56) }),
          el('div', { style: 'flex:1 1 auto' }, [
            el('h3', { text: `Cottage level ${context.homeLevel}` }),
            el('p', { class: 'cc-muted', text: context.homeLevel >= 4 ? 'Fully extended — there is room for everything now.' : `Extend the cottage for more floor space. ${formatCoins(upgradeCost)} shells.` }),
            context.homeLevel < 4
              ? el('button', {
                  class: `cc-btn ${canUpgrade ? 'primary' : ''}`,
                  style: 'margin-top:10px',
                  text: canUpgrade ? 'Extend the cottage' : 'Save up first',
                  disabled: !canUpgrade,
                  onclick: () => { context.upgradeHome(); panel.refresh(); },
                })
              : el('span'),
          ]),
        ]),
        el('div', { class: 'cc-section' }, [
          el('h4', { text: 'Decorate' }),
          el('p', { class: 'cc-muted', style: 'margin-bottom:10px', text: 'Step into decorating mode to move, rotate and store furniture in the room itself.' }),
          el('button', {
            class: 'cc-btn primary',
            text: 'Enter decorating mode',
            onclick: () => { context.ui.close('home'); context.enterDecorateMode(); },
          }),
        ]),
        el('div', { class: 'cc-section' }, [el('h4', { text: 'Owned furniture' }), owned]),
        el('div', { class: 'cc-section' }, [el('h4', { text: 'Exterior' }), exteriors]),
      );
    },
  });
}

// --- Settings ----------------------------------------------------------------

export interface SettingsBridge {
  volumes: { master: number; music: number; sfx: number; ambience: number };
  quality: string;
  autoQuality: boolean;
  cameraShake: boolean;
  setVolume: (channel: 'master' | 'music' | 'sfx' | 'ambience', value: number) => void;
  setQuality: (value: string) => void;
  setAutoQuality: (value: boolean) => void;
  setCameraShake: (value: boolean) => void;
  saveNow: () => void;
  quitToTitle: () => void;
}

export function openSettings(ui: UIRoot, bridge: SettingsBridge): void {
  ui.open({
    id: 'settings',
    eyebrow: 'Options',
    title: 'Settings',
    width: 560,
    build: (body, panel) => {
      const slider = (label: string, channel: 'master' | 'music' | 'sfx' | 'ambience') => {
        const input = el('input', {
          type: 'range',
          min: '0',
          max: '100',
          value: String(Math.round(bridge.volumes[channel] * 100)),
          style: 'width:100%;accent-color:var(--sea)',
          oninput: (event: Event) => {
            const value = Number((event.target as HTMLInputElement).value) / 100;
            bridge.setVolume(channel, value);
          },
        });
        // Range inputs need pointer events explicitly on the overlay.
        input.classList.add('interactive');
        return el('div', { class: 'cc-section' }, [el('h4', { text: label }), input]);
      };

      const qualityRow = el('div', { class: 'cc-option-row' });
      for (const level of ['low', 'medium', 'high']) {
        qualityRow.append(el('button', {
          class: `cc-option ${bridge.quality === level && !bridge.autoQuality ? 'active' : ''}`,
          text: level[0].toUpperCase() + level.slice(1),
          onclick: () => { bridge.setAutoQuality(false); bridge.setQuality(level); panel.refresh(); },
        }));
      }
      qualityRow.append(el('button', {
        class: `cc-option ${bridge.autoQuality ? 'active' : ''}`,
        text: 'Automatic',
        onclick: () => { bridge.setAutoQuality(true); panel.refresh(); },
      }));

      body.append(
        slider('Master volume', 'master'),
        slider('Music', 'music'),
        slider('Sound effects', 'sfx'),
        slider('Ambience', 'ambience'),
        el('div', { class: 'cc-section' }, [el('h4', { text: 'Graphics quality' }), qualityRow]),
        el('div', { class: 'cc-section' }, [
          el('h4', { text: 'Camera' }),
          el('button', {
            class: `cc-option ${bridge.cameraShake ? 'active' : ''}`,
            text: bridge.cameraShake ? 'Screen shake on' : 'Screen shake off',
            onclick: () => { bridge.setCameraShake(!bridge.cameraShake); panel.refresh(); },
          }),
        ]),
        el('div', { class: 'cc-section' }, [
          el('h4', { text: 'Controls' }),
          el('p', { class: 'cc-muted', html: [
            'Move — <b>WASD</b> / left stick',
            'Interact — <b>E</b> / <b>A</b>',
            'Use tool — <b>Space</b> / <b>X</b>',
            'Run — <b>Shift</b> / <b>B</b>',
            'Bag — <b>I</b> / <b>Y</b> · Map — <b>M</b> · Journal — <b>Q</b>',
            'Cycle tools — <b>Z</b> / <b>C</b> or <b>LB</b> / <b>RB</b>',
            'Camera — <b>O</b> / <b>P</b> or right stick · Zoom — <b>+</b> / <b>−</b>',
          ].join('<br>') }),
        ]),
        el('div', { style: 'display:flex;gap:9px;margin-top:8px' }, [
          el('button', { class: 'cc-btn', text: 'Save now', onclick: () => bridge.saveNow() }),
          el('button', { class: 'cc-btn ghost', text: 'Return to title', onclick: () => bridge.quitToTitle() }),
        ]),
      );
    },
  });
}
