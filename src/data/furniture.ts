export type FurnitureKind = 'sofa' | 'table' | 'lamp' | 'rug' | 'music' | 'plant' | 'chair' | 'shelf' | 'bed';

/**
 * Where a piece is allowed to sit.
 *
 * `tabletop` is the small-item case: it takes a table or a shelf when one is
 * under the cursor and falls back to the floor when there is not, so a lamp is
 * never refused for want of somewhere to stand.
 */
export type PlacementSurface = 'floor' | 'wall' | 'tabletop';

export interface FurnitureDef {
  id: string;
  /** Names preserved from the prototype so owned furniture migrates. */
  name: string;
  kind: FurnitureKind;
  price: number;
  description: string;
  /** Footprint in grid cells (0.5 m each). */
  footprint: { w: number; d: number };
  surface: PlacementSurface;
  /** Whether small items can sit on top of it. */
  supportsTabletop?: boolean;
  /**
   * Height of the surface small items rest on, in metres above the piece's own
   * base. Only read when `supportsTabletop` is set.
   */
  surfaceHeight?: number;
  palette: { primary: string; secondary: string; accent: string };
  /** Contribution to the cottage's cosiness rating. */
  cosiness: number;
  /** Emits light when placed. */
  light?: { color: string; intensity: number; height: number };
}

export const FURNITURE: FurnitureDef[] = [
  {
    id: 'furn.cloudSofa',
    name: 'Cloud Sofa',
    kind: 'sofa',
    price: 260,
    description: 'Deeper than it has any right to be. Swallows visitors whole.',
    footprint: { w: 4, d: 2 },
    surface: 'floor',
    palette: { primary: '#dfe4ee', secondary: '#c3ccdd', accent: '#8f9bb3' },
    cosiness: 6,
  },
  {
    id: 'furn.oakTable',
    name: 'Oak Table',
    kind: 'table',
    price: 180,
    description: 'Solid, scratched, and improved by both.',
    footprint: { w: 3, d: 2 },
    surface: 'floor',
    supportsTabletop: true,
    surfaceHeight: 0.79,
    palette: { primary: '#b98a58', secondary: '#8a6238', accent: '#e0c396' },
    cosiness: 4,
  },
  {
    id: 'furn.readingLamp',
    name: 'Reading Lamp',
    kind: 'lamp',
    price: 120,
    description: 'Casts exactly enough light for one person and one book.',
    footprint: { w: 1, d: 1 },
    surface: 'tabletop',
    palette: { primary: '#f2dfa8', secondary: '#5d6b74', accent: '#fff3cf' },
    cosiness: 5,
    light: { color: '#ffd9a0', intensity: 2.2, height: 1.3 },
  },
  {
    id: 'furn.leafRug',
    name: 'Leaf Rug',
    kind: 'rug',
    price: 150,
    description: 'Hand-woven in the grove. Hides an alarming amount of sand.',
    footprint: { w: 5, d: 4 },
    surface: 'floor',
    palette: { primary: '#7fa86a', secondary: '#a8c98d', accent: '#4f6b45' },
    cosiness: 3,
  },
  {
    id: 'furn.recordPlayer',
    name: 'Record Player',
    kind: 'music',
    price: 340,
    description: 'Three records. All of them are the sea.',
    footprint: { w: 2, d: 2 },
    surface: 'tabletop',
    supportsTabletop: false,
    palette: { primary: '#8a6238', secondary: '#3a3a42', accent: '#e0c396' },
    cosiness: 7,
  },
  {
    id: 'furn.pottedPalm',
    name: 'Potted Palm',
    kind: 'plant',
    price: 110,
    description: 'Thriving despite everything you have done to it.',
    footprint: { w: 1, d: 1 },
    surface: 'tabletop',
    palette: { primary: '#5f9a55', secondary: '#c9784f', accent: '#8fc47a' },
    cosiness: 4,
  },
  {
    id: 'furn.driftwoodShelf',
    name: 'Driftwood Shelf',
    kind: 'shelf',
    price: 210,
    description: 'Built from what the tide left behind the lighthouse.',
    footprint: { w: 3, d: 1 },
    surface: 'wall',
    supportsTabletop: true,
    surfaceHeight: 1.34,
    palette: { primary: '#c4ab8b', secondary: '#8d7a5e', accent: '#e6d7bd' },
    cosiness: 4,
  },
  {
    id: 'furn.covebedBed',
    name: 'Cove Bed',
    kind: 'bed',
    price: 380,
    description: 'Where the day ends. Sleep here to move to tomorrow.',
    footprint: { w: 3, d: 5 },
    surface: 'floor',
    palette: { primary: '#e8d9bd', secondary: '#a8763f', accent: '#7fa8c4' },
    cosiness: 8,
  },
  {
    id: 'furn.harbourStool',
    name: 'Harbour Stool',
    kind: 'chair',
    price: 90,
    description: 'One leg is shorter. Everyone has learned to live with it.',
    footprint: { w: 1, d: 1 },
    surface: 'floor',
    palette: { primary: '#b98a58', secondary: '#7fa86a', accent: '#e0c396' },
    cosiness: 2,
  },
];

export const FURNITURE_BY_ID = new Map(FURNITURE.map((f) => [f.id, f]));
export const FURNITURE_BY_NAME = new Map(FURNITURE.map((f) => [f.name.toLowerCase(), f]));

/** Exterior looks for the player cottage. */
export interface HouseStyleDef {
  id: string;
  name: string;
  roof: string;
  body: string;
  trim: string;
  door: string;
  price: number;
}

export const HOUSE_STYLES: HouseStyleDef[] = [
  { id: 'style.harbourBlue', name: 'Harbour Blue', roof: '#537c96', body: '#f0d6b3', trim: '#e8f0f4', door: '#a8613f', price: 0 },
  { id: 'style.orchardRed', name: 'Orchard Red', roof: '#b0553f', body: '#f4e3c4', trim: '#fff6e4', door: '#6b4a2c', price: 900 },
  { id: 'style.grovePine', name: 'Grove Pine', roof: '#4f6b45', body: '#e8dcc0', trim: '#f6efdb', door: '#8a6238', price: 900 },
  { id: 'style.duskPlum', name: 'Dusk Plum', roof: '#6a5378', body: '#f2e0e6', trim: '#fdf4f7', door: '#4a3550', price: 1400 },
  { id: 'style.lighthouseWhite', name: 'Lighthouse White', roof: '#c9524a', body: '#f8f6ef', trim: '#ffffff', door: '#3d4a6b', price: 1800 },
];

export const HOUSE_STYLES_BY_ID = new Map(HOUSE_STYLES.map((s) => [s.id, s]));
