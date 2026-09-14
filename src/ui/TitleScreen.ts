import type { SlotSummary } from '@/save/SaveSystem';
import { el, formatCoins } from './dom';
import { Icons } from './icons';

export interface TitleActions {
  onContinue: (slot: number) => void;
  onNew: (slot: number) => void;
  onErase: (slot: number) => void;
  summaries: () => SlotSummary[];
}

/**
 * The first thing a player sees. It sits over a live view of the island, so the
 * game is already selling itself before anything is pressed.
 */
export class TitleScreen {
  private root: HTMLElement;
  private slot = 1;
  private card: HTMLElement;

  constructor(
    private host: HTMLElement,
    private actions: TitleActions,
  ) {
    this.card = el('div', { class: 'cc-title-card' });
    this.root = el('div', { id: 'title' }, [this.card]);
    host.append(this.root);
    // Pick the most recently played slot by default.
    const summaries = actions.summaries();
    const latest = summaries.filter((s) => s.exists).sort((a, b) => b.savedAt - a.savedAt)[0];
    if (latest) this.slot = latest.slot;
    this.render();
  }

  private render(): void {
    const summaries = this.actions.summaries();
    const current = summaries.find((s) => s.slot === this.slot);

    const slots = el('div', { class: 'cc-slots' });
    for (const summary of summaries) {
      slots.append(el('button', {
        class: `cc-slot-btn ${summary.slot === this.slot ? 'active' : ''}`,
        onclick: () => { this.slot = summary.slot; this.render(); },
      }, [
        el('span', { class: 'n', text: `Island ${summary.slot}` }),
        el('span', {
          class: 's',
          text: summary.exists ? `Day ${summary.day} · ${formatCoins(summary.coins)}` : 'Empty',
        }),
      ]));
    }

    const actions = el('div', { class: 'cc-title-actions' }, [
      el('button', {
        class: 'cc-btn primary',
        text: current?.exists ? 'Continue' : 'Begin',
        onclick: () => {
          if (current?.exists) this.actions.onContinue(this.slot);
          else this.actions.onNew(this.slot);
        },
      }),
      current?.exists
        ? el('button', {
            class: 'cc-btn',
            text: 'New island',
            onclick: () => {
              if (window.confirm(`Start a fresh island in slot ${this.slot}? The current save is erased.`)) {
                this.actions.onErase(this.slot);
                this.actions.onNew(this.slot);
              }
            },
          })
        : el('span'),
    ]);

    const children: (HTMLElement | null)[] = [
      el('div', { class: 'cc-title-mark', html: Icons.leaf(76) }),
      el('h1', { text: 'Cozy Cove' }),
      el('p', {
        class: 'tagline',
        text: 'A small island, a slow year, and a museum that only fills up if you go outside.',
      }),
      slots,
      actions,
    ];

    if (current?.legacyVersion !== null && current?.legacyVersion !== undefined) {
      children.push(el('div', {
        class: 'cc-migrate',
        text: `An older save was found in this slot and has been brought forward — your progress, collection and neighbours came with it.`,
      }));
    }

    children.push(el('div', {
      class: 'cc-title-foot',
      html: 'Move <b>WASD</b> · Interact <b>E</b> · Tool <b>Space</b> · Bag <b>I</b> · Wave <b>1</b><br>Xbox-style controllers are supported.',
    }));

    this.card.replaceChildren(...children.filter((c): c is HTMLElement => c !== null));
    (this.card.querySelector('.cc-btn.primary') as HTMLElement | null)?.focus();
  }

  refresh(): void {
    this.render();
  }

  hide(): void {
    this.root.classList.add('leaving');
    window.setTimeout(() => { this.root.style.display = 'none'; }, 720);
  }

  show(): void {
    this.root.style.display = '';
    this.root.classList.remove('leaving');
    this.render();
  }

  get isVisible(): boolean {
    return this.root.style.display !== 'none';
  }

  dispose(): void {
    this.root.remove();
    void this.host;
  }
}
