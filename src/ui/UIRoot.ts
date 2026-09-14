import type { EventBus } from '@/core/EventBus';
import type { InputSystem } from '@/input/InputSystem';
import { clear, el, removeAfter } from './dom';
import { Icons } from './icons';

export interface PanelHandle {
  id: string;
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
  /** Re-runs the panel's builder in place. */
  refresh: () => void;
}

export interface PanelOptions {
  id: string;
  eyebrow: string;
  title: string;
  width?: number;
  maxHeight?: string;
  /** Rendered into the sheet body. Called again on refresh. */
  build: (body: HTMLElement, panel: PanelHandle) => void;
  /** Optional footer content builder. */
  footer?: (foot: HTMLElement, panel: PanelHandle) => void;
  onClose?: () => void;
  /** Panels that pause the world (most of them do). */
  pauses?: boolean;
}

/**
 * The interface shell.
 *
 * Owns the overlay DOM, the panel stack, toasts, the screen fade and the
 * gamepad-driven focus model. Gameplay code never touches the DOM directly; it
 * opens panels and emits events.
 */
export class UIRoot {
  readonly root: HTMLElement;
  readonly layers: Record<string, HTMLElement> = {};

  private panels: (PanelHandle & { options: PanelOptions })[] = [];
  private toastQueue: HTMLElement[] = [];
  private focusIndex = 0;
  private focusables: HTMLElement[] = [];

  constructor(
    container: HTMLElement,
    private bus: EventBus,
    private input: InputSystem,
  ) {
    this.root = el('div', { id: 'ui' });
    container.append(this.root);

    for (const name of ['world', 'hud', 'prompts', 'panels', 'dialogue', 'overlay', 'transition']) {
      const layer = el('div', { class: `ui-layer ui-${name}`, style: 'position:absolute;inset:0;' });
      this.layers[name] = layer;
      this.root.append(layer);
    }

    this.layers.toasts = el('div', { id: 'hud-toasts' });
    this.layers.hud.append(this.layers.toasts);

    this.fade = el('div', { id: 'screen-fade' });
    this.locationTitle = el('div', { id: 'location-title' });
    this.perf = el('div', { id: 'perf' });
    this.layers.transition.append(this.fade, this.locationTitle);
    this.layers.overlay.append(this.perf);

    this.bus.on('ui:toast', ({ text, icon, tone }) => this.toast(text, tone, icon));
  }

  private fade: HTMLElement;
  private locationTitle: HTMLElement;
  private perf: HTMLElement;

  // --- Panels --------------------------------------------------------------

  get isPanelOpen(): boolean {
    return this.panels.length > 0;
  }

  get topPanelId(): string | null {
    return this.panels[this.panels.length - 1]?.id ?? null;
  }

  get pausesWorld(): boolean {
    return this.panels.some((p) => p.options.pauses !== false);
  }

  /** Opens a panel, or closes it if it is already the top one (toggle). */
  toggle(options: PanelOptions): void {
    if (this.topPanelId === options.id) {
      this.closeTop();
      return;
    }
    this.open(options);
  }

  open(options: PanelOptions): PanelHandle {
    // Only one panel of a given id at a time.
    const existing = this.panels.find((p) => p.id === options.id);
    if (existing) {
      existing.refresh();
      return existing;
    }

    const scrim = el('div', { class: 'cc-scrim', onclick: () => this.close(options.id) });
    const body = el('div', { class: 'cc-sheet-body cc-stagger' });
    const foot = el('div', { class: 'cc-sheet-foot' });

    const closeButton = el('button', {
      class: 'cc-btn icon ghost',
      'aria-label': 'Close',
      html: Icons.close(18),
      onclick: () => this.close(options.id),
    });

    const sheet = el('div', {
      class: 'cc-sheet centered',
      style: `width:min(${options.width ?? 720}px, calc(100vw - 48px)); max-height:${options.maxHeight ?? 'min(82vh, 780px)'};`,
    }, [
      el('div', { class: 'cc-sheet-head' }, [
        el('div', {}, [
          el('div', { class: 'cc-eyebrow', text: options.eyebrow }),
          el('h2', { text: options.title }),
        ]),
        closeButton,
      ]),
      body,
    ]);

    const wrapper = el('div', { class: 'cc-panel', style: 'position:absolute;inset:0;pointer-events:auto;' }, [scrim, sheet]);
    this.layers.panels.append(wrapper);

    const handle: PanelHandle & { options: PanelOptions } = {
      id: options.id,
      root: wrapper,
      body,
      options,
      close: () => this.close(options.id),
      refresh: () => {
        clear(body);
        options.build(body, handle);
        if (options.footer) {
          clear(foot);
          options.footer(foot, handle);
          if (!foot.parentElement) sheet.append(foot);
        }
        this.collectFocusables();
      },
    };

    options.build(body, handle);
    if (options.footer) {
      options.footer(foot, handle);
      sheet.append(foot);
    }

    this.panels.push(handle);
    this.collectFocusables();
    // `update` only accepts uiConfirm when the active element is one of these,
    // so without an initial focus the pad's A button does nothing until the
    // player nudges a direction first.
    this.focusables[0]?.focus();
    this.bus.emit('ui:panel', { id: options.id });
    this.bus.emit('audio:sfx', { id: 'ui.open' });
    return handle;
  }

  close(id: string): void {
    const index = this.panels.findIndex((p) => p.id === id);
    if (index < 0) return;
    const [panel] = this.panels.splice(index, 1);
    const sheet = panel.root.querySelector('.cc-sheet');
    if (sheet) sheet.classList.add('closing');
    panel.root.style.pointerEvents = 'none';
    removeAfter(panel.root, 'closing', 220);
    panel.options.onClose?.();
    this.collectFocusables();
    this.bus.emit('ui:panel', { id: this.topPanelId });
    this.bus.emit('audio:sfx', { id: 'ui.close' });
  }

  closeTop(): boolean {
    const top = this.panels[this.panels.length - 1];
    if (!top) return false;
    this.close(top.id);
    return true;
  }

  closeAll(): void {
    for (const panel of [...this.panels]) this.close(panel.id);
  }

  /** Rebuilds the open panel with the given id, if it is open. */
  refresh(id: string): void {
    this.panels.find((p) => p.id === id)?.refresh();
  }

  // --- Focus (gamepad and keyboard navigation) -----------------------------

  private collectFocusables(): void {
    const top = this.panels[this.panels.length - 1];
    if (!top) {
      this.focusables = [];
      return;
    }
    this.focusables = [
      ...top.root.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'),
    ].filter((node) => node.offsetParent !== null);
    this.focusIndex = Math.min(this.focusIndex, Math.max(0, this.focusables.length - 1));
  }

  /** Directional focus movement — picks the nearest element in that direction. */
  private moveFocus(dx: number, dy: number): void {
    if (this.focusables.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const current = active && this.focusables.includes(active) ? active : this.focusables[0];
    const from = current.getBoundingClientRect();
    const cx = from.left + from.width / 2;
    const cy = from.top + from.height / 2;

    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const candidate of this.focusables) {
      if (candidate === current) continue;
      const rect = candidate.getBoundingClientRect();
      const px = rect.left + rect.width / 2 - cx;
      const py = rect.top + rect.height / 2 - cy;
      // Require meaningful travel along the requested axis.
      const along = px * dx + py * dy;
      if (along <= 4) continue;
      const across = Math.abs(px * dy - py * dx);
      // Weight sideways drift heavily so grids navigate row by row.
      const score = along + across * 2.4;
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    const target = best ?? this.focusables[0];
    target.focus();
    this.bus.emit('audio:sfx', { id: 'ui.hover' });
  }

  /** Called each frame; routes menu input while a panel is open. */
  update(): void {
    if (!this.isPanelOpen) return;
    if (this.input.repeated('uiLeft')) this.moveFocus(-1, 0);
    if (this.input.repeated('uiRight')) this.moveFocus(1, 0);
    if (this.input.repeated('uiUp')) this.moveFocus(0, -1);
    if (this.input.repeated('uiDown')) this.moveFocus(0, 1);
    if (this.input.justPressed('uiConfirm')) {
      const active = document.activeElement as HTMLElement | null;
      if (active && this.focusables.includes(active)) {
        active.click();
        this.bus.emit('audio:sfx', { id: 'ui.select' });
      }
    }
    if (this.input.justPressed('uiBack')) {
      this.closeTop();
      this.bus.emit('audio:sfx', { id: 'ui.back' });
    }
  }

  // --- Toasts, fade, titles ------------------------------------------------

  toast(text: string, tone: 'neutral' | 'good' | 'warn' | 'rare' = 'neutral', iconUrl?: string): void {
    const node = el('div', { class: `cc-toast ${tone}` }, [
      iconUrl ? el('img', { src: iconUrl, alt: '' }) : null,
      el('span', { text }),
    ]);
    this.layers.toasts.append(node);
    this.toastQueue.push(node);

    // Cap the stack so a burst of pickups does not fill the screen.
    while (this.toastQueue.length > 4) {
      const oldest = this.toastQueue.shift();
      if (oldest) removeAfter(oldest, 'leaving', 240);
    }

    window.setTimeout(() => {
      const index = this.toastQueue.indexOf(node);
      if (index >= 0) this.toastQueue.splice(index, 1);
      removeAfter(node, 'leaving', 240);
    }, 2800);
  }

  /** Fades to black, runs `midpoint`, then fades back. */
  async transition(midpoint: () => void | Promise<void>, outMs = 380, inMs = 420): Promise<void> {
    this.fade.style.transitionDuration = `${outMs}ms`;
    this.fade.classList.add('on');
    await wait(outMs);
    try {
      await midpoint();
    } finally {
      // The overlay is opaque and covers the viewport. If `midpoint` throws —
      // callers pass interior loading through here — leaving it up would end
      // the session on a black screen with the loop still running.
      this.fade.style.transitionDuration = `${inMs}ms`;
      this.fade.classList.remove('on');
      await wait(inMs);
    }
  }

  showLocation(name: string, subtitle = ''): void {
    clear(this.locationTitle);
    this.locationTitle.append(
      el('div', { class: 'name', text: name }),
      subtitle ? el('div', { class: 'sub', text: subtitle }) : el('div'),
    );
    this.locationTitle.classList.remove('show');
    // Force a reflow so re-triggering the animation actually restarts it.
    void this.locationTitle.offsetWidth;
    this.locationTitle.classList.add('show');
  }

  setPerf(lines: string[]): void {
    this.perf.textContent = lines.join('\n');
  }

  togglePerf(): void {
    this.perf.classList.toggle('on');
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
