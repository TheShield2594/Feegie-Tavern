import type { Season } from '@/time/TimeSystem';
import { SEASONS, SEASON_LENGTH } from '@/time/TimeSystem';
import type { ScheduleEntry } from './villagers';

/**
 * Where one villager stands during a festival, and what they say there.
 *
 * Offsets are metres from the town square's centre, which is where every
 * festival is held — it is the one space on the island built to hold everybody.
 */
export interface FestivalStation {
  villagerId: string;
  x: number;
  z: number;
  /** Shown in the journal in place of their usual schedule line. */
  label: string;
  activity: ScheduleEntry['activity'];
}

/** The one thing there is to do at a festival, and what it is worth. */
export interface FestivalActivity {
  /** Prompt on the interaction. */
  label: string;
  /** Offset from the square's centre. */
  x: number;
  z: number;
  /** Said once it is done. */
  done: string;
  reward: number;
}

export type FestivalDecor = 'bunting' | 'lanterns' | 'stalls';

export interface FestivalDef {
  id: string;
  name: string;
  season: Season;
  /** Day within the season, 1…SEASON_LENGTH. */
  dayOfSeason: number;
  blurb: string;
  /** Hours the square is given over to it — `from` inclusive, `to` exclusive. */
  from: number;
  to: number;
  accent: string;
  decor: FestivalDecor;
  stations: FestivalStation[];
  activity: FestivalActivity;
}

/**
 * The island's calendar.
 *
 * One festival a season, on a fixed day, so a player who misses one knows
 * exactly when it comes round again. They are all held in the square and all
 * run for part of a day: outside those hours the island keeps its ordinary
 * schedule, which is what stops a festival from feeling like a mode.
 */
export const FESTIVALS: FestivalDef[] = [
  {
    id: 'festival.blossom',
    name: 'Blossom Fair',
    season: 'Spring',
    dayOfSeason: 3,
    blurb: 'Bunting over the square and the first cuttings of the year laid out on trestles.',
    from: 10,
    to: 18,
    accent: '#f4b5c7',
    decor: 'bunting',
    stations: [
      { villagerId: 'mallow', x: -3.0, z: -4.6, label: 'Judging the cuttings', activity: 'tend' },
      { villagerId: 'bruno', x: 4.4, z: -3.4, label: 'Running a trestle', activity: 'browse' },
      { villagerId: 'pip', x: 4.8, z: 4.2, label: 'Eating more than he sells', activity: 'idle' },
      { villagerId: 'juniper', x: -4.6, z: 3.8, label: 'Pressing flowers for the archive', activity: 'talk' },
    ],
    activity: {
      label: 'Tie on a wish',
      x: 0,
      z: 5.4,
      done: 'You tie your ribbon to the bough. Mallow pretends not to read it.',
      reward: 240,
    },
  },
  {
    id: 'festival.harbourLights',
    name: 'Harbour Lights',
    season: 'Summer',
    dayOfSeason: 5,
    blurb: 'Paper lanterns strung across the square, lit one at a time as it gets dark.',
    from: 18,
    to: 23,
    accent: '#ffca7a',
    decor: 'lanterns',
    stations: [
      { villagerId: 'pip', x: -4.2, z: -4.2, label: 'Minding the lantern crate', activity: 'browse' },
      { villagerId: 'juniper', x: 3.6, z: -5.0, label: 'Naming the constellations', activity: 'talk' },
      { villagerId: 'bruno', x: 5.6, z: 2.8, label: 'Sitting down for once', activity: 'sit' },
      { villagerId: 'mallow', x: -5.4, z: 2.4, label: 'Watching the lights go up', activity: 'idle' },
    ],
    activity: {
      label: 'Light a lantern',
      x: 0,
      z: 5.4,
      done: 'Your lantern goes up with the rest. The square turns gold underneath it.',
      reward: 300,
    },
  },
  {
    id: 'festival.harvestSupper',
    name: 'Harvest Supper',
    season: 'Autumn',
    dayOfSeason: 4,
    blurb: 'One long table down the middle of the square and everything anyone grew on it.',
    from: 12,
    to: 20,
    accent: '#d98a4f',
    decor: 'stalls',
    stations: [
      { villagerId: 'bruno', x: -3.4, z: -4.8, label: 'Carving, badly', activity: 'browse' },
      { villagerId: 'mallow', x: 3.8, z: -4.4, label: 'Laying out the last of the beds', activity: 'tend' },
      { villagerId: 'pip', x: 5.0, z: 3.6, label: 'Third helping', activity: 'sit' },
      { villagerId: 'juniper', x: -5.0, z: 3.2, label: 'Writing down the recipes', activity: 'talk' },
    ],
    activity: {
      label: 'Take a place at the table',
      x: 0,
      z: 5.4,
      done: 'You eat until you cannot. Somebody puts more on your plate anyway.',
      reward: 360,
    },
  },
  {
    id: 'festival.midwinter',
    name: 'Midwinter Vigil',
    season: 'Winter',
    dayOfSeason: 6,
    blurb: 'The whole cove stands round the fountain in the dark and waits for the light to turn.',
    from: 17,
    to: 23,
    accent: '#a8c4e8',
    decor: 'lanterns',
    stations: [
      { villagerId: 'juniper', x: 0, z: -5.2, label: 'Reading the old words', activity: 'talk' },
      { villagerId: 'mallow', x: -4.6, z: -2.8, label: 'Keeping the candles lit', activity: 'idle' },
      { villagerId: 'bruno', x: 4.8, z: -2.4, label: 'Handing out something hot', activity: 'browse' },
      { villagerId: 'pip', x: -3.8, z: 4.6, label: 'Quiet, for once', activity: 'idle' },
    ],
    activity: {
      label: 'Set a candle on the rim',
      x: 0,
      z: 5.4,
      done: 'You set your candle on the fountain rim. Nobody says anything for a while.',
      reward: 420,
    },
  },
];

export const FESTIVALS_BY_ID = new Map(FESTIVALS.map((f) => [f.id, f]));

/** The day of the season a given day falls on, 1…SEASON_LENGTH. */
export function dayOfSeason(day: number): number {
  return ((Math.max(1, Math.floor(day)) - 1) % SEASON_LENGTH) + 1;
}

/** The season a given day falls in, without needing a running clock. */
export function seasonOf(day: number): Season {
  return SEASONS[Math.floor((Math.max(1, Math.floor(day)) - 1) / SEASON_LENGTH) % SEASONS.length];
}

/** The festival held on a day, if there is one. */
export function festivalOn(day: number): FestivalDef | null {
  const season = seasonOf(day);
  const within = dayOfSeason(day);
  return FESTIVALS.find((f) => f.season === season && f.dayOfSeason === within) ?? null;
}

/** Whether a festival is under way at an hour of its own day. */
export function festivalIsOpen(festival: FestivalDef, hour: number): boolean {
  return hour >= festival.from && hour < festival.to;
}

/**
 * The next festival on or after a day, and how many days off it is.
 *
 * Searched a year ahead rather than computed, because the calendar is a list
 * that anyone may add a date to and the arithmetic should not have to be
 * rewritten when they do.
 */
export function nextFestival(day: number): { festival: FestivalDef; inDays: number } | null {
  const horizon = SEASON_LENGTH * SEASONS.length;
  for (let ahead = 0; ahead <= horizon; ahead++) {
    const festival = festivalOn(day + ahead);
    if (festival) return { festival, inDays: ahead };
  }
  return null;
}

/** Every festival of the coming year from a day, in the order they arrive. */
export function upcomingFestivals(day: number): { festival: FestivalDef; inDays: number }[] {
  const horizon = SEASON_LENGTH * SEASONS.length;
  const out: { festival: FestivalDef; inDays: number }[] = [];
  for (let ahead = 0; ahead < horizon; ahead++) {
    const festival = festivalOn(day + ahead);
    if (festival) out.push({ festival, inDays: ahead });
  }
  return out;
}
