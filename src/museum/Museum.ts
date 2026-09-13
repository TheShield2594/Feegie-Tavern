import type { EventBus } from '@/core/EventBus';
import { ALL_SPECIES, SPECIES_BY_ID } from '@/data/species';
import type { MuseumWing, SpeciesDef } from '@/items/types';

export const WINGS: { id: MuseumWing; name: string; blurb: string }[] = [
  { id: 'aquarium', name: 'Aquarium', blurb: 'Tanks lit from above, fish turning slow circles.' },
  { id: 'conservatory', name: 'Insect Conservatory', blurb: 'A warm glasshouse of ferns, terrariums and wings.' },
  { id: 'fossilHall', name: 'Fossil Hall', blurb: 'Long shadows and older bones.' },
  { id: 'oceanGallery', name: 'Ocean Gallery', blurb: 'Reef light, moving on the walls.' },
];

export interface WingProgress {
  wing: MuseumWing;
  name: string;
  owned: number;
  total: number;
  /** 0–1, drives how furnished the wing looks. */
  completion: number;
}

/**
 * Tracks donations and reports per-wing progress. The interior scene reads
 * these numbers directly, which is how an empty museum fills out visibly as
 * the player donates rather than needing a separate unlock list.
 */
export class Museum {
  private donated = new Set<string>();

  constructor(private bus: EventBus) {}

  get donatedIds(): string[] {
    return [...this.donated];
  }

  get totalDonated(): number {
    return this.donated.size;
  }

  get totalSpecies(): number {
    return ALL_SPECIES.length;
  }

  has(defId: string): boolean {
    return this.donated.has(defId);
  }

  /** Returns false when the museum already holds that species. */
  donate(defId: string): boolean {
    if (!SPECIES_BY_ID.has(defId) || this.donated.has(defId)) return false;
    this.donated.add(defId);
    const species = SPECIES_BY_ID.get(defId)!;
    const progress = this.wingProgress(species.wing!);
    this.bus.emit('museum:wingProgress', {
      wing: species.wing!,
      owned: progress.owned,
      total: progress.total,
    });
    return true;
  }

  speciesIn(wing: MuseumWing): SpeciesDef[] {
    return ALL_SPECIES.filter((s) => s.wing === wing);
  }

  wingProgress(wing: MuseumWing): WingProgress {
    const species = this.speciesIn(wing);
    const owned = species.filter((s) => this.donated.has(s.id)).length;
    return {
      wing,
      name: WINGS.find((w) => w.id === wing)!.name,
      owned,
      total: species.length,
      completion: species.length === 0 ? 0 : owned / species.length,
    };
  }

  allProgress(): WingProgress[] {
    return WINGS.map((w) => this.wingProgress(w.id));
  }

  get completion(): number {
    return this.donated.size / Math.max(1, ALL_SPECIES.length);
  }

  load(ids: string[]): void {
    this.donated = new Set(ids.filter((id) => SPECIES_BY_ID.has(id)));
  }

  serialize(): string[] {
    return [...this.donated];
  }
}
