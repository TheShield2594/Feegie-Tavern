import { Color } from 'three';

/**
 * One palette for the whole island. Every material pulls from here so the world
 * reads as a single hand-painted set rather than a pile of unrelated meshes.
 */
export const PALETTE = {
  grass: {
    base: '#7aad60',
    shadow: '#55804a',
    highlight: '#a6cb7c',
    dry: '#b4b86c',
    /** Cooler, bluer green for shaded hollows. */
    moss: '#5f9866',
  },
  sand: {
    base: '#e9d6ac',
    wet: '#c8ad82',
    shadow: '#c9b083',
  },
  dirt: {
    base: '#b9835a',
    path: '#c9a878',
    tilled: '#7a5537',
  },
  rock: {
    base: '#8b9490',
    light: '#b4bcb7',
    dark: '#5d6764',
  },
  water: {
    shallow: '#59c2cf',
    mid: '#1d7fa8',
    deep: '#0f3f66',
    foam: '#f2fbff',
  },
  foliage: {
    canopyLight: '#93c47b',
    canopyMid: '#6a9a5f',
    canopyDark: '#456e46',
    pine: '#3d7a54',
    autumn: '#d98a3c',
    bark: '#8a6242',
    barkDark: '#5f432c',
  },
  flowers: ['#f4b5c7', '#f5d66c', '#c9b3f6', '#fdfdfb', '#f2946b', '#8fd0e8'],
  wood: {
    plank: '#c49a6c',
    plankDark: '#8a6238',
    beam: '#6b4a2c',
  },
  roof: {
    slate: '#537c96',
    terracotta: '#c06a4e',
    moss: '#5f7f56',
    plum: '#6a5378',
  },
  plaster: {
    cream: '#f2e2c4',
    warm: '#e8d0aa',
    white: '#f8f5ec',
  },
  accent: {
    gold: '#f0c05a',
    lamp: '#ffd9a0',
    window: '#bfe7ed',
    windowLit: '#ffdfa0',
    sign: '#3d4a6b',
  },
  sky: {
    dawnTop: '#4f6fa8',
    dawnBottom: '#f6b98a',
    dayTop: '#4a9fd8',
    dayBottom: '#c8e8f5',
    sunsetTop: '#3f4f8f',
    sunsetBottom: '#f28f5f',
    nightTop: '#0d1430',
    nightBottom: '#2a3a63',
    overcastTop: '#7d8794',
    overcastBottom: '#c0c7ce',
  },
  light: {
    sunDawn: '#ffb98a',
    sunDay: '#fff4dc',
    sunSunset: '#ff9d63',
    moon: '#9fb6e8',
    ambientDay: '#c4dbe6',
    ambientNight: '#4a5c8c',
    groundBounce: '#9a9a7c',
  },
} as const;

export const COLORS = {
  grassBase: new Color(PALETTE.grass.base),
  grassShadow: new Color(PALETTE.grass.shadow),
  grassHighlight: new Color(PALETTE.grass.highlight),
  sand: new Color(PALETTE.sand.base),
  sandWet: new Color(PALETTE.sand.wet),
  dirt: new Color(PALETTE.dirt.base),
  path: new Color(PALETTE.dirt.path),
  rock: new Color(PALETTE.rock.base),
  rockDark: new Color(PALETTE.rock.dark),
};

/** Season tint applied over foliage and grass. */
export const SEASON_TINT: Record<string, { grass: string; canopy: string; saturation: number }> = {
  Spring: { grass: '#83b76a', canopy: '#7bb268', saturation: 0.97 },
  Summer: { grass: '#74a95c', canopy: '#5a9457', saturation: 0.96 },
  Autumn: { grass: '#a8b060', canopy: '#d08b3f', saturation: 0.95 },
  Winter: { grass: '#9db08c', canopy: '#7f9a86', saturation: 0.78 },
};
