import type { InputSystem } from '@/input/InputSystem';
import { el } from './dom';
import type { UIRoot } from './UIRoot';

/**
 * On-screen controls for touch devices: a virtual stick and four action
 * buttons. They only appear when a touch is actually detected, so a laptop with
 * a touchscreen still gets the clean desktop HUD until it is used that way.
 */
export class TouchControls {
  private root: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private pointerId: number | null = null;
  private origin = { x: 0, y: 0 };
  private enabled = false;

  constructor(ui: UIRoot, private input: InputSystem) {
    this.knob = el('div', { class: 'knob' });
    this.stick = el('div', { class: 'cc-stick' }, [this.knob]);

    const buttons = el('div', { class: 'cc-touch-buttons' }, [
      this.makeButton('Y', 'inventory'),
      this.makeButton('X', 'useTool'),
      this.makeButton('B', 'run'),
      this.makeButton('A', 'interact'),
    ]);

    this.root = el('div', { id: 'touch-controls' }, [this.stick, buttons]);
    ui.layers.hud.append(this.root);

    this.attachStick();

    // Reveal on the first genuine touch.
    window.addEventListener('touchstart', () => this.setEnabled(true), { once: true, passive: true });
  }

  private makeButton(label: string, action: Parameters<InputSystem['setTouch']>[0]): HTMLElement {
    const button = el('button', { class: 'cc-touch-btn', text: label });
    const down = (event: Event) => {
      event.preventDefault();
      this.input.setTouch(action, true);
    };
    const up = (event: Event) => {
      event.preventDefault();
      this.input.setTouch(action, false);
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('pointerleave', up);
    return button;
  }

  private attachStick(): void {
    const radius = 44;

    this.stick.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.pointerId = event.pointerId;
      const rect = this.stick.getBoundingClientRect();
      this.origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this.stick.setPointerCapture(event.pointerId);
      this.move(event.clientX, event.clientY, radius);
    });

    this.stick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.pointerId) return;
      event.preventDefault();
      this.move(event.clientX, event.clientY, radius);
    });

    const release = (event: PointerEvent) => {
      if (event.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.knob.style.transform = '';
      this.input.setTouchStick(0, 0);
    };
    this.stick.addEventListener('pointerup', release);
    this.stick.addEventListener('pointercancel', release);
  }

  private move(clientX: number, clientY: number, radius: number): void {
    let dx = clientX - this.origin.x;
    let dy = clientY - this.origin.y;
    const distance = Math.hypot(dx, dy);
    if (distance > radius) {
      dx = (dx / distance) * radius;
      dy = (dy / distance) * radius;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.input.setTouchStick(dx / radius, dy / radius);
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.root.classList.toggle('enabled', enabled);
  }
}
