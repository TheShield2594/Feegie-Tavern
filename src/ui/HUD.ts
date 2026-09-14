import { Vector3, type PerspectiveCamera } from 'three';
import type { EventBus } from '@/core/EventBus';
import type { InputSystem } from '@/input/InputSystem';
import type { InteractionOption } from '@/interactions/types';
import { TOOLS, type ToolId } from '@/player/Tools';
import { clear, countUp, el, formatCoins, removeAfter } from './dom';
import { Icons, TOOL_ICONS, WEATHER_ICONS } from './icons';
import type { UIRoot } from './UIRoot';

export interface HUDState {
  day: number;
  season: string;
  timeLabel: string;
  weather: string;
  weatherLabel: string;
  coins: number;
  questTitle: string;
  questText: string;
  questProgress: number;
  questGoal: number;
  tool: ToolId;
  toolLevels: Record<string, number>;
  /** Hides the quest card and dims the HUD during cutscenes and dialogue. */
  quiet: boolean;
}

/**
 * The heads-up display.
 *
 * Deliberately sparse: a clock, the purse, the day's goal, the tool you are
 * holding, and prompts that live next to the thing they refer to. Everything
 * else is a panel the player opens.
 */
export class HUD {
  private topBar: HTMLElement;
  private clockTime: HTMLElement;
  private clockDate: HTMLElement;
  private weatherPill: HTMLElement;
  private coinsPill: HTMLElement;
  private coinsAmount: HTMLElement;
  private questCard: HTMLElement;
  private questTitle: HTMLElement;
  private questText: HTMLElement;
  private questBar: HTMLElement;
  private toolBar: HTMLElement;
  private promptLayer: HTMLElement;
  private fishingMeter: HTMLElement | null = null;
  private airMeter: HTMLElement | null = null;
  private buildBar: HTMLElement | null = null;

  private lastCoins = -1;
  /** Cancels an in-flight coin roll so a second sale does not fight the first. */
  private cancelCoinRoll: (() => void) | null = null;
  private promptNodes = new Map<string, HTMLElement>();
  private lastToolSignature = '';

  constructor(
    private ui: UIRoot,
    private bus: EventBus,
    private input: InputSystem,
  ) {
    this.clockTime = el('div', { class: 'time', text: '8:00 AM' });
    this.clockDate = el('div', { class: 'date', text: 'Spring · Day 1' });

    this.weatherPill = el('span', { class: 'cc-pill subtle' }, [
      el('span', { class: 'wicon', html: Icons.sun(18) }),
      el('span', { class: 'wlabel', text: 'Clear' }),
    ]);

    this.coinsAmount = el('span', { class: 'amount', text: '250' });
    this.coinsPill = el('span', { class: 'cc-pill cc-coins' }, [
      el('span', { html: Icons.shell(18) }),
      this.coinsAmount,
    ]);

    this.topBar = el('div', { id: 'hud-top' }, [
      el('div', { class: 'cluster' }, [
        el('div', { class: 'cc-pill cc-clock' }, [this.clockTime, this.clockDate]),
        this.weatherPill,
      ]),
      el('div', { class: 'cluster' }, [this.coinsPill]),
    ]);

    this.questTitle = el('h3', { text: 'A Place for Everything' });
    this.questText = el('p', { text: 'Donate one creature to the museum.' });
    this.questBar = el('i', { style: 'width:0%' });
    this.questCard = el('div', { id: 'hud-quest' }, [
      el('div', { class: 'cc-eyebrow', text: "Today's Goal" }),
      this.questTitle,
      this.questText,
      el('div', { class: 'cc-progress' }, [this.questBar]),
    ]);

    this.toolBar = el('div', { id: 'hud-tools' });
    this.promptLayer = el('div', { id: 'hud-prompts' });

    ui.layers.hud.append(this.topBar, this.questCard, this.toolBar);
    ui.layers.prompts.append(this.promptLayer);

    this.bus.on('ui:prompts', ({ options }) => this.setPrompts(options));
  }

  setVisible(visible: boolean): void {
    const display = visible ? '' : 'none';
    this.topBar.style.display = display;
    this.questCard.style.display = display;
    this.toolBar.style.display = display;
    this.promptLayer.style.display = display;
  }

  update(state: HUDState): void {
    this.clockTime.textContent = state.timeLabel;
    this.clockDate.textContent = `${state.season} · Day ${state.day}`;

    const icon = WEATHER_ICONS[state.weather] ?? Icons.sun;
    const iconHost = this.weatherPill.querySelector('.wicon');
    if (iconHost && iconHost.getAttribute('data-w') !== state.weather) {
      iconHost.innerHTML = icon(18);
      iconHost.setAttribute('data-w', state.weather);
    }
    const label = this.weatherPill.querySelector('.wlabel');
    if (label) label.textContent = state.weatherLabel;

    if (state.coins !== this.lastCoins) {
      if (this.lastCoins >= 0) {
        this.cancelCoinRoll?.();
        this.cancelCoinRoll = countUp(this.coinsAmount, this.lastCoins, state.coins, 520, formatCoins);
        this.coinsPill.classList.remove('bump');
        void this.coinsPill.offsetWidth;
        this.coinsPill.classList.add('bump');
      } else {
        this.coinsAmount.textContent = formatCoins(state.coins);
      }
      this.lastCoins = state.coins;
    }

    this.questTitle.textContent = state.questTitle;
    this.questText.textContent = state.questText;
    const pct = state.questGoal > 0 ? Math.min(100, (state.questProgress / state.questGoal) * 100) : 0;
    this.questBar.style.width = `${pct}%`;
    this.questCard.classList.toggle('dim', state.quiet);

    this.renderTools(state.tool, state.toolLevels);
  }

  private renderTools(active: ToolId, levels: Record<string, number>): void {
    const signature = `${active}|${TOOLS.map((t) => levels[t.id] ?? 1).join(',')}|${this.input.lastDevice}`;
    if (signature === this.lastToolSignature) return;
    this.lastToolSignature = signature;

    clear(this.toolBar);
    for (const tool of TOOLS) {
      const level = levels[tool.id] ?? 1;
      const node = el('div', {
        class: `cc-tool ${tool.id === active ? 'active' : ''}`,
        title: `${tool.name}${level > 1 ? ` · Lv.${level}` : ''}`,
      }, [
        el('span', { html: (TOOL_ICONS[tool.id] ?? Icons.rod)(28) }),
      ]);
      if (level > 1) {
        node.append(el('span', { class: 'level', text: `${level}` }));
      }
      this.toolBar.append(node);
    }

    const hint = el('div', { class: 'cc-pill', style: 'align-self:center;font-size:11.5px;padding:6px 12px;opacity:.82' }, [
      el('span', { class: 'glyph', text: this.input.glyph('toolPrev') }),
      el('span', { text: '/' }),
      el('span', { class: 'glyph', text: this.input.glyph('toolNext') }),
    ]);
    this.toolBar.prepend(hint);
  }

  // --- Prompts -------------------------------------------------------------

  private currentOptions: InteractionOption[] = [];

  private setPrompts(options: InteractionOption[]): void {
    this.currentOptions = options;
    const seen = new Set(options.map((o) => o.id));

    for (const [id, node] of this.promptNodes) {
      if (!seen.has(id)) {
        removeAfter(node, 'leaving', 160);
        this.promptNodes.delete(id);
      }
    }

    options.forEach((option, index) => {
      let node = this.promptNodes.get(option.id);
      if (!node) {
        node = el('div', { class: 'cc-prompt' });
        this.promptLayer.append(node);
        this.promptNodes.set(option.id, node);
      }
      node.classList.toggle('secondary', index > 0);
      node.classList.toggle('disabled', !!option.disabledReason);
      clear(node);
      node.append(
        el('span', { class: 'key', text: this.input.glyph(option.action) }),
        el('span', { text: option.disabledReason ?? option.label }),
      );
      if (option.detail && !option.disabledReason) {
        node.append(el('span', { class: 'detail', text: option.detail }));
      }
    });
  }

  /** Projects each prompt onto its world anchor. Runs every frame. */
  positionPrompts(camera: PerspectiveCamera, width: number, height: number): void {
    if (this.promptNodes.size === 0) return;
    const projected = new Vector3();
    for (const option of this.currentOptions) {
      const node = this.promptNodes.get(option.id);
      if (!node) continue;
      projected.set(option.worldX, option.worldY, option.worldZ).project(camera);
      // Hide anything that has gone behind the camera.
      if (projected.z > 1) {
        node.style.opacity = '0';
        continue;
      }
      node.style.opacity = '';
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      // Keep prompts on screen even when their anchor is near an edge.
      node.style.left = `${Math.max(70, Math.min(width - 70, x))}px`;
      node.style.top = `${Math.max(60, Math.min(height - 90, y))}px`;
    }
  }

  // --- Fishing meter -------------------------------------------------------

  showFishingMeter(): void {
    if (this.fishingMeter) return;
    const needle = el('div', { class: 'needle', style: 'left:40%' });
    const progress = el('i', { style: 'width:0%' });
    this.fishingMeter = el('div', { id: 'fishing-meter' }, [
      el('div', { class: 'cc-tension' }, [needle]),
      el('div', { class: 'cc-progress gold cc-catch-progress' }, [progress]),
      el('div', { class: 'caption', text: `Hold ${this.input.glyph('interact')} to reel · keep the needle in the green` }),
    ]);
    this.ui.layers.hud.append(this.fishingMeter);
  }

  updateFishingMeter(tension: number, progress: number): void {
    if (!this.fishingMeter) return;
    const needle = this.fishingMeter.querySelector<HTMLElement>('.needle');
    const bar = this.fishingMeter.querySelector<HTMLElement>('.cc-catch-progress > i');
    if (needle) needle.style.left = `${Math.max(0, Math.min(100, tension * 100))}%`;
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, progress * 100))}%`;
  }

  hideFishingMeter(): void {
    if (!this.fishingMeter) return;
    removeAfter(this.fishingMeter, 'leaving', 200);
    this.fishingMeter = null;
  }

  setFishingCaption(text: string): void {
    const caption = this.fishingMeter?.querySelector('.caption');
    if (caption) caption.textContent = text;
  }

  // --- Air meter -----------------------------------------------------------

  /**
   * The diver's breath. Deliberately the only thing on screen while under the
   * surface: the point of the dive is that you are counting one number down.
   */
  showAirMeter(): void {
    if (this.airMeter) return;
    const bar = el('i', { style: 'width:100%' });
    this.airMeter = el('div', { id: 'air-meter' }, [
      el('div', { class: 'cc-air-bar' }, [bar]),
      el('div', { class: 'caption', text: 'Air' }),
    ]);
    this.ui.layers.hud.append(this.airMeter);
  }

  /** @param fraction Breath left, 1 to 0. */
  updateAirMeter(fraction: number): void {
    if (!this.airMeter) return;
    const bar = this.airMeter.querySelector<HTMLElement>('.cc-air-bar > i');
    const clamped = Math.max(0, Math.min(1, fraction));
    if (bar) {
      bar.style.width = `${clamped * 100}%`;
      // The last quarter goes amber then red, so the decision to surface
      // arrives before the meter empties rather than with it.
      bar.style.background = clamped > 0.45
        ? 'linear-gradient(180deg, #8fe0f2, #4aa8c4)'
        : clamped > 0.2
          ? 'linear-gradient(180deg, #f2d08f, #c49a4a)'
          : 'linear-gradient(180deg, #f29a8f, #c4544a)';
    }
    this.airMeter.classList.toggle('urgent', clamped <= 0.2);
  }

  /** Takes the breath gauge away, on surfacing or on leaving the water. */
  hideAirMeter(): void {
    if (!this.airMeter) return;
    removeAfter(this.airMeter, 'leaving', 200);
    this.airMeter = null;
  }

  // --- Outdoor build bar ---------------------------------------------------

  /** The landscaping cursor's readout: what is selected, and what it costs. */
  showBuildBar(): void {
    if (this.buildBar) return;
    this.buildBar = el('div', { id: 'build-bar' }, [
      el('div', { class: 'cc-build-name' }),
      el('div', { class: 'cc-build-note' }),
      el('div', { class: 'cc-build-cost' }),
      el('div', { class: 'cc-build-keys' }),
    ]);
    this.ui.layers.hud.append(this.buildBar);
  }

  updateBuildBar(state: {
    name: string;
    description: string;
    price: number;
    cost?: { wood?: number; stone?: number; fiber?: number };
    affordable: boolean;
    /** True while this piece is in the player's hands rather than on the shelf. */
    holding: boolean;
    /** Whether the shoulder buttons would change its colour. */
    hasTints: boolean;
  }): void {
    if (!this.buildBar) return;
    const name = this.buildBar.querySelector<HTMLElement>('.cc-build-name');
    const note = this.buildBar.querySelector<HTMLElement>('.cc-build-note');
    const cost = this.buildBar.querySelector<HTMLElement>('.cc-build-cost');
    const keys = this.buildBar.querySelector<HTMLElement>('.cc-build-keys');
    if (name) name.textContent = state.name;
    if (note) note.textContent = state.description;
    if (cost) {
      if (state.holding) {
        cost.textContent = 'In hand';
      } else {
        const parts = [`${state.price} shells`];
        for (const [key, label] of [['wood', 'wood'], ['stone', 'stone'], ['fiber', 'fibre']] as const) {
          const amount = state.cost?.[key] ?? 0;
          if (amount > 0) parts.push(`${amount} ${label}`);
        }
        cost.textContent = parts.join(' · ');
      }
    }
    // The controls change meaning between carrying and choosing, so the line
    // that teaches them has to change with it.
    if (keys) {
      keys.textContent = state.holding
        ? `${state.hasTints ? `${this.input.glyph('toolPrev')} ${this.input.glyph('toolNext')} colour · ` : ''}`
          + `${this.input.glyph('interact')} put down · ${this.input.glyph('useTool')} turn · `
          + `${this.input.glyph('cancel')} put back`
        : `${this.input.glyph('toolPrev')} ${this.input.glyph('toolNext')} choose · `
          + `${this.input.glyph('interact')} place · ${this.input.glyph('useTool')} take back up · `
          + `${this.input.glyph('cancel')} finish`;
    }
    this.buildBar.classList.toggle('unaffordable', !state.affordable);
    this.buildBar.classList.toggle('holding', state.holding);
  }

  /** Takes the landscaping readout away when build mode ends. */
  hideBuildBar(): void {
    if (!this.buildBar) return;
    removeAfter(this.buildBar, 'leaving', 200);
    this.buildBar = null;
  }
}
