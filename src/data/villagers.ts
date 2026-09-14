export type VillagerSpecies = 'squirrel' | 'rabbit' | 'bear' | 'owl' | 'fox' | 'otter';

export interface VillagerLook {
  species: VillagerSpecies;
  /** Body fur / feather colour. */
  fur: string;
  /** Belly and muzzle. */
  cream: string;
  /** Clothing. */
  outfit: string;
  outfitTrim: string;
  /** Silhouette differentiators. */
  height: number;
  girth: number;
  earStyle: 'tuft' | 'long' | 'round' | 'feathered';
  tailStyle: 'bushy' | 'puff' | 'stub' | 'none';
  accessory?: 'scarf' | 'apron' | 'satchel' | 'spectacles' | 'sunhat';
}

export interface ScheduleEntry {
  /** Hour the villager starts heading here. */
  from: number;
  /** Named anchor in the world (see world/Landmarks). */
  at: string;
  /** Short label shown in the journal. */
  label: string;
  /** What they do once they arrive. */
  activity: 'idle' | 'walk' | 'fish' | 'sit' | 'browse' | 'tend' | 'sleep' | 'talk';
}

export interface VillagerDef {
  id: string;
  /** Names match the prototype so friendship values migrate cleanly. */
  name: string;
  title: string;
  look: VillagerLook;
  /** Base friendship on a fresh save, matching the prototype's starting values. */
  startingFriendship: number;
  homeAnchor: string;
  schedule: ScheduleEntry[];
  greetings: string[];
  lines: string[];
  rainLines: string[];
  nightLines: string[];
  /** Said when the player donates something new to the museum. */
  donationLines?: string[];
  favoriteCategories: string[];
}

export const VILLAGERS: VillagerDef[] = [
  {
    id: 'pip',
    name: 'Pip',
    title: 'Cove Angler',
    startingFriendship: 12,
    homeAnchor: 'home.pip',
    look: {
      species: 'squirrel',
      fur: '#c47f44',
      cream: '#f6e2c4',
      outfit: '#4a7fa8',
      outfitTrim: '#f0d79b',
      height: 0.92,
      girth: 0.95,
      earStyle: 'tuft',
      tailStyle: 'bushy',
      accessory: 'satchel',
    },
    schedule: [
      { from: 0, at: 'home.pip', label: 'Asleep', activity: 'sleep' },
      { from: 6, at: 'beach.pier', label: 'Morning cast', activity: 'fish' },
      { from: 11, at: 'square.center', label: 'Town square', activity: 'idle' },
      { from: 14, at: 'creek.stones', label: 'Trying the creek', activity: 'fish' },
      { from: 16, at: 'beach.log', label: 'Sitting by the water', activity: 'sit' },
      { from: 19, at: 'home.pip', label: 'Home for the evening', activity: 'idle' },
      { from: 22, at: 'home.pip', label: 'Asleep', activity: 'sleep' },
    ],
    greetings: ['Oh — morning!', 'There you are.', 'Perfect timing, actually.'],
    lines: [
      'Tide is sitting just right off the pier. I would not waste it.',
      'I keep meaning to learn how to skip stones properly.',
      'Your cottage is starting to feel like part of the neighbourhood.',
      'If a line goes slack, do not yank it. Wait. The waiting is the whole trick.',
    ],
    rainLines: [
      'Rain flattens the water. Fish come right up under it — best hour of the week.',
      'I have been soaked since six and I regret nothing.',
    ],
    nightLines: [
      'Moonfin are out. I can hear them working the shallows.',
      'Late one for you too, then.',
    ],
    donationLines: ['You gave that to the museum? Good. That belongs to everyone now.'],
    favoriteCategories: ['fish', 'sea'],
  },
  {
    id: 'mallow',
    name: 'Mallow',
    title: 'Grove Keeper',
    startingFriendship: 10,
    homeAnchor: 'home.mallow',
    look: {
      species: 'rabbit',
      fur: '#e4b7cd',
      cream: '#fdf2f6',
      outfit: '#7fa86a',
      outfitTrim: '#f4e3a8',
      height: 1.0,
      girth: 0.85,
      earStyle: 'long',
      tailStyle: 'puff',
      accessory: 'sunhat',
    },
    schedule: [
      { from: 0, at: 'home.mallow', label: 'Asleep', activity: 'sleep' },
      { from: 7, at: 'square.flowerbed', label: 'Tending the beds', activity: 'tend' },
      { from: 11, at: 'square.center', label: 'Town square', activity: 'talk' },
      { from: 13, at: 'garden.shed', label: 'Up at the terrace', activity: 'tend' },
      { from: 16, at: 'square.bench', label: 'Reading on the bench', activity: 'sit' },
      { from: 19, at: 'home.mallow', label: 'Home', activity: 'idle' },
      { from: 22, at: 'home.mallow', label: 'Asleep', activity: 'sleep' },
    ],
    greetings: ['Hello you.', 'Look at this light!', 'I was hoping you would come by.'],
    lines: [
      'The flowers change the whole island when the light hits them right.',
      'I heard rare butterflies come through the west grove after rain.',
      'A cozy home needs at least one wildly unnecessary lamp. Non-negotiable.',
      'I planted the blue ones by the fountain. Tell me honestly if it is too much.',
    ],
    rainLines: [
      'Everything I planted is drinking. Let it come down.',
      'Do you like the smell of rain on warm stone? I could stand here all day.',
    ],
    nightLines: [
      'The fireflies find the flowerbeds every single night. Every one.',
      'Shh — listen. That is the whole island breathing out.',
    ],
    donationLines: ['Juniper will fuss over that for a week. Well done.'],
    favoriteCategories: ['bug', 'crop', 'fruit'],
  },
  {
    id: 'bruno',
    name: 'Bruno',
    title: 'Boardwalk Shopkeeper',
    startingFriendship: 8,
    homeAnchor: 'home.bruno',
    look: {
      species: 'bear',
      fur: '#9b7a5e',
      cream: '#e8d5bb',
      outfit: '#b8543f',
      outfitTrim: '#f2dfae',
      height: 1.16,
      girth: 1.3,
      earStyle: 'round',
      tailStyle: 'stub',
      accessory: 'apron',
    },
    schedule: [
      { from: 0, at: 'home.bruno', label: 'Asleep', activity: 'sleep' },
      { from: 7, at: 'beach.pier', label: 'Checking the boats', activity: 'walk' },
      { from: 9, at: 'shop.counter', label: 'Behind the counter', activity: 'idle' },
      { from: 18, at: 'square.center', label: 'Closing up', activity: 'walk' },
      { from: 20, at: 'home.bruno', label: 'Home', activity: 'idle' },
      { from: 22, at: 'home.bruno', label: 'Asleep', activity: 'sleep' },
    ],
    greetings: ['Welcome in!', 'Ah, my best customer.', 'Come in, come in.'],
    lines: [
      'Bring me duplicates and I will pay fair. That is the whole business model.',
      'Fossils push little star-shaped cracks up through the soil. Watch your feet.',
      'Furniture always looks better after you have dragged it around six times.',
      'Stock rotates at dawn. Whatever is out is what there is.',
    ],
    rainLines: [
      'Wet days are good days. Nobody buys a lamp when the sun is out.',
      'Mind the boards by the door, they go slick.',
    ],
    nightLines: [
      'Shop is shut, but I am not going to pretend I mind the company.',
      'I do my accounts at night. It is the only quiet I get.',
    ],
    donationLines: ['Could have sold that. Glad you did not.'],
    favoriteCategories: ['fossil', 'material', 'meal'],
  },
  {
    id: 'juniper',
    name: 'Juniper',
    title: 'Museum Curator',
    startingFriendship: 6,
    homeAnchor: 'museum.desk',
    look: {
      species: 'owl',
      fur: '#8d78a9',
      cream: '#efe6f5',
      outfit: '#3d4a6b',
      outfitTrim: '#c9b58a',
      height: 1.02,
      girth: 1.1,
      earStyle: 'feathered',
      tailStyle: 'none',
      accessory: 'spectacles',
    },
    schedule: [
      { from: 0, at: 'museum.desk', label: 'Dozing at the desk', activity: 'sleep' },
      { from: 8, at: 'museum.desk', label: 'Curator desk', activity: 'idle' },
      { from: 13, at: 'meadow.high', label: 'Up at the stones', activity: 'walk' },
      { from: 15, at: 'museum.desk', label: 'Curator desk', activity: 'idle' },
      { from: 21, at: 'museum.desk', label: 'Cataloguing late', activity: 'idle' },
    ],
    greetings: ['Ah. You.', 'Come in, mind the case.', 'Something for me?'],
    lines: [
      'Every donation becomes part of the Cove’s story. Even the common ones.',
      'Fish, insects, fossils, sea life — I catalogue all four. Badly, but I catalogue them.',
      'A complete museum is less about perfection and more about curiosity.',
      'The east wing is still dark. Give me something to put in it.',
    ],
    rainLines: [
      'The roof holds. Mostly. The fossil hall has a bucket.',
      'Rain is good for us. People remember the museum exists.',
    ],
    nightLines: [
      'Night is when the tanks look their best. Nobody is ever here to see it.',
      'I do not really sleep. Occupational.',
    ],
    donationLines: [
      'A new one. Genuinely a new one. Give me a moment.',
      'I will have it mounted by morning.',
    ],
    favoriteCategories: ['fossil', 'fish', 'bug', 'sea'],
  },
];

export const VILLAGERS_BY_ID = new Map(VILLAGERS.map((v) => [v.id, v]));
export const VILLAGERS_BY_NAME = new Map(VILLAGERS.map((v) => [v.name, v]));
