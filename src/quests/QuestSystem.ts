import type { EventBus } from '@/core/EventBus';
import { DAILY_QUESTS, PUBLIC_WORKS, STORY_BEATS, type QuestDef, type QuestGoalKind } from '@/data/quests';

export interface TownInputs {
  donated: number;
  totalSpecies: number;
  friendshipTotal: number;
  flowersPlanted: number;
  cropsHarvested: number;
  worksBuilt: number;
  homeLevel: number;
  furniturePlaced: number;
}

/**
 * Daily goals, the island's star rating and the chapter-one story beats.
 * Kept together because they all read from the same progress signals.
 */
export class QuestSystem {
  activeId = 'museum';
  progress = 0;
  issuedDay = 1;
  completedIds: string[] = [];
  storyStage = 0;

  constructor(private bus: EventBus) {}

  get active(): QuestDef {
    return DAILY_QUESTS.find((q) => q.id === this.activeId) ?? DAILY_QUESTS[0];
  }

  get isComplete(): boolean {
    return this.progress >= this.active.goal;
  }

  /** Picks tomorrow's goal, avoiding an immediate repeat. */
  rollDaily(day: number, rating: number): void {
    const eligible = DAILY_QUESTS.filter((q) => (q.minRating ?? 0) <= rating && q.id !== this.activeId);
    const pool = eligible.length > 0 ? eligible : DAILY_QUESTS;
    this.activeId = pool[Math.floor(Math.random() * pool.length)].id;
    this.progress = 0;
    this.issuedDay = day;
  }

  /** Records progress toward the current goal. Returns the reward when it completes. */
  record(kind: QuestGoalKind, amount = 1): number {
    const quest = this.active;
    if (quest.kind !== kind || this.progress >= quest.goal) return 0;
    this.progress = Math.min(quest.goal, this.progress + amount);
    this.bus.emit('quest:updated', { id: quest.id, progress: this.progress, goal: quest.goal });

    if (this.progress >= quest.goal) {
      this.completedIds.push(quest.id);
      this.bus.emit('quest:completed', { id: quest.id, title: quest.title, reward: quest.reward });
      this.bus.emit('audio:sfx', { id: 'quest.complete' });
      return quest.reward;
    }
    return 0;
  }

  /**
   * The island's star rating, 1–5.
   *
   * Weighted so that no single activity carries it: a player who only fishes
   * still needs neighbours and public works to reach five stars.
   */
  rating(inputs: TownInputs): number {
    const museum = inputs.totalSpecies > 0 ? inputs.donated / inputs.totalSpecies : 0;
    const friends = Math.min(1, inputs.friendshipTotal / 320);
    const green = Math.min(1, (inputs.flowersPlanted + inputs.cropsHarvested) / 40);
    const works = inputs.worksBuilt / PUBLIC_WORKS.length;
    const home = Math.min(1, (inputs.homeLevel - 1) / 3 * 0.6 + Math.min(1, inputs.furniturePlaced / 8) * 0.4);

    const score = museum * 0.32 + friends * 0.24 + green * 0.14 + works * 0.2 + home * 0.1;
    return Math.max(1, Math.min(5, 1 + Math.floor(score * 5)));
  }

  /** Advances the chapter when its conditions are met. Returns a bonus payout. */
  checkStory(rating: number, pipFriendship: number, works: { stairs: boolean; lighthouse: boolean }): { advanced: boolean; bonus: number; text: string } {
    const before = this.storyStage;

    if (this.storyStage === 0 && rating >= 2 && pipFriendship >= 20) this.storyStage = 1;
    else if (this.storyStage === 1 && works.stairs && rating >= 3) this.storyStage = 2;
    else if (this.storyStage === 2 && works.lighthouse) this.storyStage = 3;
    else if (this.storyStage === 3 && rating >= 5) this.storyStage = 4;

    if (this.storyStage === before) return { advanced: false, bonus: 0, text: '' };
    const bonus = this.storyStage === 4 ? 1000 : 0;
    return { advanced: true, bonus, text: STORY_BEATS[this.storyStage].text };
  }

  serialize() {
    return {
      activeId: this.activeId,
      progress: this.progress,
      issuedDay: this.issuedDay,
      completedIds: this.completedIds.slice(-40),
    };
  }

  load(data: { activeId: string; progress: number; issuedDay: number; completedIds: string[] }, storyStage: number): void {
    // Progress belongs to the quest it was earned against. Carrying it onto
    // the fallback would leave a one-step goal already satisfied, so the
    // player could never complete it or claim the reward.
    const known = DAILY_QUESTS.some((q) => q.id === data.activeId);
    this.activeId = known ? data.activeId : 'museum';
    this.progress = known ? data.progress : 0;
    this.issuedDay = data.issuedDay;
    this.completedIds = data.completedIds ?? [];
    this.storyStage = storyStage;
  }
}
