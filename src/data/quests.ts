export type QuestGoalKind = 'donate' | 'catch' | 'sell' | 'talk' | 'harvest' | 'gather' | 'cook';

export interface QuestDef {
  id: string;
  title: string;
  text: string;
  kind: QuestGoalKind;
  goal: number;
  reward: number;
  /** Only offered once the island reaches this star rating. */
  minRating?: number;
}

export const DAILY_QUESTS: QuestDef[] = [
  {
    id: 'museum',
    title: 'A Place for Everything',
    text: 'Donate one creature to the museum.',
    kind: 'donate',
    goal: 1,
    reward: 120,
  },
  {
    id: 'catchThree',
    title: 'Three Before Noon',
    text: 'Catch three creatures of any kind.',
    kind: 'catch',
    goal: 3,
    reward: 160,
  },
  {
    id: 'sellFive',
    title: 'Clearing the Bag',
    text: "Sell five things at Bruno's.",
    kind: 'sell',
    goal: 5,
    reward: 140,
  },
  {
    id: 'talkAll',
    title: 'Rounds',
    text: 'Say hello to three neighbours today.',
    kind: 'talk',
    goal: 3,
    reward: 130,
  },
  {
    id: 'harvestTwo',
    title: 'Pulling Turnips',
    text: 'Harvest two mature crops.',
    kind: 'harvest',
    goal: 2,
    reward: 150,
  },
  {
    id: 'gatherSix',
    title: 'Stocking Up',
    text: 'Gather six units of building material.',
    kind: 'gather',
    goal: 6,
    reward: 145,
  },
];

export interface StoryBeat {
  stage: number;
  text: string;
}

/** Chapter I, carried over from the prototype and lightly expanded. */
export const STORY_BEATS: StoryBeat[] = [
  {
    stage: 0,
    text: 'Juniper found an old brass key in the museum archive. Raise the island to 2 stars and befriend Pip to learn what it opens.',
  },
  {
    stage: 1,
    text: 'The key fits the padlock on the old hedge gate east of Bruno\u2019s. Pip also remembers a sealed path above High Meadow — build the public stairs and reach 3 stars.',
  },
  {
    stage: 2,
    text: "Beyond the ridge sits Cozy Cove's abandoned lighthouse. Gather 8 wood and 6 stone, then restore it from Town Hall.",
  },
  {
    stage: 3,
    text: 'The lighthouse shines again. Reach a 5-star island to finish Cozy Cove’s first chapter.',
  },
  {
    stage: 4,
    text: 'Chapter I complete: The Light Returns. The villagers remember you as the neighbour who brought the Cove back together.',
  },
];

export interface PublicWorkDef {
  id: 'bridge' | 'stairs' | 'lighthouse';
  name: string;
  description: string;
  cost: { coins: number; wood: number; stone: number };
  ratingBonus: number;
}

export const PUBLIC_WORKS: PublicWorkDef[] = [
  {
    id: 'bridge',
    name: 'Creek Bridge',
    description: 'Span the creek so the south shore stops being a detour.',
    cost: { coins: 900, wood: 8, stone: 4 },
    ratingBonus: 1,
  },
  {
    id: 'stairs',
    name: 'Meadow Stairs',
    description: 'Cut steps into the ridge and open the High Meadow properly.',
    cost: { coins: 1200, wood: 6, stone: 8 },
    ratingBonus: 1,
  },
  {
    id: 'lighthouse',
    name: 'Lighthouse Restoration',
    description: 'Re-glaze the lamp room and light the point again.',
    cost: { coins: 1600, wood: 8, stone: 6 },
    ratingBonus: 2,
  },
];
