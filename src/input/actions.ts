/** Logical actions the game reacts to. Devices map onto these, never the reverse. */
export type GameAction =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'interact'
  | 'cancel'
  | 'run'
  | 'useTool'
  | 'build'
  | 'inventory'
  | 'map'
  | 'journal'
  | 'toolPrev'
  | 'toolNext'
  | 'cameraLeft'
  | 'cameraRight'
  | 'zoomIn'
  | 'zoomOut'
  | 'menu'
  | 'uiUp'
  | 'uiDown'
  | 'uiLeft'
  | 'uiRight'
  | 'uiConfirm'
  | 'uiBack'
  | 'emoteWave'
  | 'emoteCheer'
  | 'emoteSit'
  | 'emoteNod';

export const ALL_ACTIONS: GameAction[] = [
  'moveUp', 'moveDown', 'moveLeft', 'moveRight',
  'interact', 'cancel', 'run', 'useTool', 'build',
  'inventory', 'map', 'journal',
  'toolPrev', 'toolNext',
  'cameraLeft', 'cameraRight', 'zoomIn', 'zoomOut',
  'menu',
  'uiUp', 'uiDown', 'uiLeft', 'uiRight', 'uiConfirm', 'uiBack',
  'emoteWave', 'emoteCheer', 'emoteSit', 'emoteNod',
];

/** Keyboard bindings. Multiple keys may map to the same action. */
export const KEYBOARD_BINDINGS: Record<string, GameAction[]> = {
  KeyW: ['moveUp'], ArrowUp: ['moveUp', 'uiUp'],
  KeyS: ['moveDown'], ArrowDown: ['moveDown', 'uiDown'],
  KeyA: ['moveLeft'], ArrowLeft: ['moveLeft', 'uiLeft'],
  KeyD: ['moveRight'], ArrowRight: ['moveRight', 'uiRight'],
  KeyE: ['interact', 'uiConfirm'],
  Enter: ['interact', 'uiConfirm'],
  Space: ['useTool'],
  ShiftLeft: ['run'], ShiftRight: ['run'],
  Escape: ['cancel', 'uiBack'],
  Backspace: ['uiBack'],
  KeyI: ['inventory'],
  Tab: ['inventory'],
  KeyB: ['build'],
  KeyM: ['map'],
  KeyQ: ['journal'],
  KeyZ: ['toolPrev'],
  KeyC: ['toolNext'],
  KeyO: ['cameraLeft'],
  KeyP: ['cameraRight'],
  Equal: ['zoomIn'], NumpadAdd: ['zoomIn'],
  Minus: ['zoomOut'], NumpadSubtract: ['zoomOut'],
  KeyF: ['menu'],
  Digit1: ['emoteWave'],
  Digit2: ['emoteCheer'],
  Digit3: ['emoteNod'],
  Digit4: ['emoteSit'],
};

/**
 * Xbox-style gamepad layout, using the standard mapping button indices.
 * 0=A 1=B 2=X 3=Y 4=LB 5=RB 6=LT 7=RT 8=Back 9=Start 12–15=D-pad
 */
export const GAMEPAD_BUTTON_BINDINGS: Record<number, GameAction[]> = {
  0: ['interact', 'uiConfirm'],
  1: ['cancel', 'run', 'uiBack'],
  2: ['useTool'],
  3: ['inventory'],
  4: ['toolPrev'],
  5: ['toolNext'],
  6: ['zoomOut'],
  7: ['zoomIn'],
  8: ['map'],
  9: ['menu'],
  // Left stick click: the only standard button left, and building is the one
  // mode that wants a dedicated one rather than a menu.
  10: ['build'],
  // The D-pad doubles as the emote wheel outside menus; the UI actions only
  // matter while a panel is open, so the two never compete.
  12: ['uiUp', 'emoteWave'],
  13: ['uiDown', 'emoteSit'],
  14: ['uiLeft', 'emoteNod'],
  15: ['uiRight', 'emoteCheer'],
};

/** Human-readable glyphs used by the contextual prompt UI. */
export const ACTION_GLYPHS: Record<GameAction, { key: string; pad: string }> = {
  moveUp: { key: 'W', pad: 'L↑' },
  moveDown: { key: 'S', pad: 'L↓' },
  moveLeft: { key: 'A', pad: 'L←' },
  moveRight: { key: 'D', pad: 'L→' },
  interact: { key: 'E', pad: 'A' },
  cancel: { key: 'Esc', pad: 'B' },
  run: { key: 'Shift', pad: 'B' },
  useTool: { key: 'Space', pad: 'X' },
  build: { key: 'B', pad: 'L3' },
  inventory: { key: 'I', pad: 'Y' },
  map: { key: 'M', pad: 'View' },
  journal: { key: 'Q', pad: 'Y' },
  toolPrev: { key: 'Z', pad: 'LB' },
  toolNext: { key: 'C', pad: 'RB' },
  cameraLeft: { key: 'O', pad: 'R←' },
  cameraRight: { key: 'P', pad: 'R→' },
  zoomIn: { key: '+', pad: 'RT' },
  zoomOut: { key: '-', pad: 'LT' },
  menu: { key: 'F', pad: 'Menu' },
  uiUp: { key: '↑', pad: 'D↑' },
  uiDown: { key: '↓', pad: 'D↓' },
  uiLeft: { key: '←', pad: 'D←' },
  uiRight: { key: '→', pad: 'D→' },
  uiConfirm: { key: 'E', pad: 'A' },
  uiBack: { key: 'Esc', pad: 'B' },
  emoteWave: { key: '1', pad: 'D↑' },
  emoteCheer: { key: '2', pad: 'D→' },
  emoteNod: { key: '3', pad: 'D←' },
  emoteSit: { key: '4', pad: 'D↓' },
};
