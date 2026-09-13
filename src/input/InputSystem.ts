import { clamp } from '@/util/math';
import {
  ACTION_GLYPHS,
  ALL_ACTIONS,
  GAMEPAD_BUTTON_BINDINGS,
  KEYBOARD_BINDINGS,
  type GameAction,
} from './actions';

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

interface ActionState {
  down: boolean;
  pressedThisFrame: boolean;
  releasedThisFrame: boolean;
  /** Seconds the action has been held. */
  heldFor: number;
}

const STICK_DEADZONE = 0.22;
const TRIGGER_THRESHOLD = 0.5;
/** How long a D-pad/stick direction waits before it starts auto-repeating in menus. */
const REPEAT_DELAY = 0.42;
const REPEAT_RATE = 0.12;

/**
 * Single source of truth for player input. Keyboard, Xbox-layout gamepad and
 * on-screen touch controls all resolve to the same logical actions, and the UI
 * reads `lastDevice` so button prompts match whatever the player just used.
 */
export class InputSystem {
  private states = new Map<GameAction, ActionState>();
  private touchHeld = new Set<GameAction>();
  private repeatTimers = new Map<GameAction, number>();

  /** Analogue movement, already deadzoned and clamped to a unit disc. */
  readonly move = { x: 0, y: 0 };
  /** Analogue camera control from the right stick. */
  readonly look = { x: 0, y: 0 };
  lastDevice: InputDevice = 'keyboard';
  gamepadConnected = false;
  enabled = true;

  private listeners: (() => void)[] = [];

  constructor(private target: HTMLElement | Window = window) {
    for (const action of ALL_ACTIONS) {
      this.states.set(action, { down: false, pressedThisFrame: false, releasedThisFrame: false, heldFor: 0 });
    }
    this.attach();
  }

  private attach(): void {
    const onKeyDown = (event: Event) => {
      const e = event as KeyboardEvent;
      if (e.repeat) return;
      const actions = KEYBOARD_BINDINGS[e.code];
      if (!actions) return;
      // Tab and the arrows would otherwise scroll or move focus off the canvas.
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.lastDevice = 'keyboard';
      for (const action of actions) this.setDown(action, true);
    };

    const onKeyUp = (event: Event) => {
      const e = event as KeyboardEvent;
      const actions = KEYBOARD_BINDINGS[e.code];
      if (!actions) return;
      for (const action of actions) this.setDown(action, false);
    };

    // Losing focus mid-hold would otherwise leave the player walking forever.
    const onBlur = () => this.releaseAll();

    const onGamepadConnected = () => {
      this.gamepadConnected = true;
      this.lastDevice = 'gamepad';
    };
    const onGamepadDisconnected = () => {
      this.gamepadConnected = navigator.getGamepads?.().some(Boolean) ?? false;
    };

    this.target.addEventListener('keydown', onKeyDown);
    this.target.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('gamepadconnected', onGamepadConnected);
    window.addEventListener('gamepaddisconnected', onGamepadDisconnected);

    this.listeners.push(
      () => this.target.removeEventListener('keydown', onKeyDown),
      () => this.target.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => window.removeEventListener('gamepadconnected', onGamepadConnected),
      () => window.removeEventListener('gamepaddisconnected', onGamepadDisconnected),
    );
  }

  dispose(): void {
    for (const off of this.listeners) off();
    this.listeners = [];
  }

  private state(action: GameAction): ActionState {
    return this.states.get(action)!;
  }

  private setDown(action: GameAction, down: boolean): void {
    const s = this.state(action);
    if (s.down === down) return;
    s.down = down;
    if (down) {
      s.pressedThisFrame = true;
      s.heldFor = 0;
      this.repeatTimers.set(action, REPEAT_DELAY);
    } else {
      s.releasedThisFrame = true;
      this.repeatTimers.delete(action);
    }
  }

  /** Used by the on-screen touch buttons. */
  setTouch(action: GameAction, down: boolean): void {
    this.lastDevice = 'touch';
    if (down) this.touchHeld.add(action);
    else this.touchHeld.delete(action);
    this.setDown(action, down);
  }

  /** Virtual joystick output from the touch layer, in [-1, 1]. */
  setTouchStick(x: number, y: number): void {
    if (x !== 0 || y !== 0) this.lastDevice = 'touch';
    this.touchStick.x = x;
    this.touchStick.y = y;
  }

  private touchStick = { x: 0, y: 0 };

  isDown(action: GameAction): boolean {
    return this.enabled && this.state(action).down;
  }

  justPressed(action: GameAction): boolean {
    return this.enabled && this.state(action).pressedThisFrame;
  }

  justReleased(action: GameAction): boolean {
    return this.enabled && this.state(action).releasedThisFrame;
  }

  heldFor(action: GameAction): number {
    return this.state(action).heldFor;
  }

  /** True on press and then on a repeating cadence — for menu navigation. */
  repeated(action: GameAction): boolean {
    if (!this.enabled) return false;
    const s = this.state(action);
    if (s.pressedThisFrame) return true;
    if (!s.down) return false;
    const timer = this.repeatTimers.get(action) ?? REPEAT_DELAY;
    return timer <= 0;
  }

  glyph(action: GameAction): string {
    const g = ACTION_GLYPHS[action];
    return this.lastDevice === 'gamepad' ? g.pad : g.key;
  }

  /** Call once per frame, before systems read input. */
  update(dt: number): void {
    this.pollGamepad();

    // Keyboard/touch digital movement, then the analogue sticks override it.
    let mx = 0;
    let my = 0;
    if (this.isDown('moveLeft')) mx -= 1;
    if (this.isDown('moveRight')) mx += 1;
    if (this.isDown('moveUp')) my -= 1;
    if (this.isDown('moveDown')) my += 1;

    if (this.padMove.x !== 0 || this.padMove.y !== 0) {
      mx = this.padMove.x;
      my = this.padMove.y;
    } else if (this.touchStick.x !== 0 || this.touchStick.y !== 0) {
      mx = this.touchStick.x;
      my = this.touchStick.y;
    }

    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.move.x = this.enabled ? mx : 0;
    this.move.y = this.enabled ? my : 0;

    this.look.x = this.enabled ? this.padLook.x : 0;
    this.look.y = this.enabled ? this.padLook.y : 0;

    for (const [action, timer] of this.repeatTimers) {
      const next = timer - dt;
      this.repeatTimers.set(action, next <= 0 ? REPEAT_RATE : next);
    }
    for (const s of this.states.values()) {
      if (s.down) s.heldFor += dt;
    }
  }

  /** Call at the very end of the frame to clear edge-triggered flags. */
  endFrame(): void {
    for (const s of this.states.values()) {
      s.pressedThisFrame = false;
      s.releasedThisFrame = false;
    }
  }

  private padMove = { x: 0, y: 0 };
  private padLook = { x: 0, y: 0 };
  private padButtonState = new Map<number, boolean>();

  private pollGamepad(): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads.find((p): p is Gamepad => !!p && p.connected);
    if (!pad) {
      this.padMove.x = 0;
      this.padMove.y = 0;
      this.padLook.x = 0;
      this.padLook.y = 0;
      // Release anything the pad was holding so a disconnect does not stick.
      if (this.padButtonState.size > 0) {
        for (const [index, wasDown] of this.padButtonState) {
          if (!wasDown) continue;
          for (const action of GAMEPAD_BUTTON_BINDINGS[index] ?? []) {
            if (!this.touchHeld.has(action)) this.setDown(action, false);
          }
        }
        this.padButtonState.clear();
      }
      return;
    }

    this.gamepadConnected = true;

    const lx = applyDeadzone(pad.axes[0] ?? 0);
    const ly = applyDeadzone(pad.axes[1] ?? 0);
    const rx = applyDeadzone(pad.axes[2] ?? 0);
    const ry = applyDeadzone(pad.axes[3] ?? 0);

    this.padMove.x = lx;
    this.padMove.y = ly;
    this.padLook.x = rx;
    this.padLook.y = ry;

    if (Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0.05) this.lastDevice = 'gamepad';

    for (const [indexStr, actions] of Object.entries(GAMEPAD_BUTTON_BINDINGS)) {
      const index = Number(indexStr);
      const button = pad.buttons[index];
      if (!button) continue;
      // Triggers report as analogue values, so threshold rather than trust `pressed`.
      const down = button.pressed || button.value > TRIGGER_THRESHOLD;
      const was = this.padButtonState.get(index) ?? false;
      if (down !== was) {
        this.padButtonState.set(index, down);
        if (down) this.lastDevice = 'gamepad';
        for (const action of actions) {
          // Do not cancel a touch hold on the same action.
          if (!down && this.touchHeld.has(action)) continue;
          this.setDown(action, down);
        }
      }
    }

    // Left stick pushed hard also acts as menu direction input.
    this.applyStickAsUiDirection(lx, ly);
  }

  private applyStickAsUiDirection(x: number, y: number): void {
    const threshold = 0.6;
    this.setStickUi('uiLeft', x < -threshold);
    this.setStickUi('uiRight', x > threshold);
    this.setStickUi('uiUp', y < -threshold);
    this.setStickUi('uiDown', y > threshold);
  }

  private stickUiState = new Map<GameAction, boolean>();

  private setStickUi(action: GameAction, down: boolean): void {
    if ((this.stickUiState.get(action) ?? false) === down) return;
    this.stickUiState.set(action, down);
    // Only drive the action from the stick when no key is already holding it.
    if (!down && this.touchHeld.has(action)) return;
    this.setDown(action, down);
  }

  private releaseAll(): void {
    for (const action of ALL_ACTIONS) this.setDown(action, false);
    this.touchHeld.clear();
    this.touchStick.x = 0;
    this.touchStick.y = 0;
  }
}

function applyDeadzone(v: number): number {
  const a = Math.abs(v);
  if (a < STICK_DEADZONE) return 0;
  // Rescale so the value ramps from 0 at the deadzone edge rather than jumping.
  return Math.sign(v) * clamp((a - STICK_DEADZONE) / (1 - STICK_DEADZONE), 0, 1);
}
