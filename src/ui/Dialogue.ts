import type { EventBus } from '@/core/EventBus';
import type { InputSystem } from '@/input/InputSystem';
import { clear, el, removeAfter } from './dom';
import { Icons } from './icons';
import type { UIRoot } from './UIRoot';

export interface DialogueRequest {
  speakerId: string;
  speakerName: string;
  title?: string;
  portrait: string;
  lines: string[];
  /** Friendship level 0–5, drawn as hearts. */
  hearts?: number;
  /** Set to animate a heart filling in during this conversation. */
  heartGained?: boolean;
  choices?: { id: string; label: string }[];
  onChoice?: (id: string) => void;
  onComplete?: () => void;
}

const TYPE_SPEED = 42; // characters per second... scaled below

/**
 * The conversation panel.
 *
 * Types each line out at a readable pace, lets the player skip to the end of a
 * line, and only shows choices once the last line has finished — so the reply
 * buttons never appear before the question does.
 */
export class Dialogue {
  private node: HTMLElement | null = null;
  private textNode: HTMLElement | null = null;
  private hintNode: HTMLElement | null = null;
  private choiceNode: HTMLElement | null = null;

  private request: DialogueRequest | null = null;
  private lineIndex = 0;
  private revealed = 0;
  private typing = false;
  private voiceTimer = 0;

  constructor(
    private ui: UIRoot,
    private bus: EventBus,
    private input: InputSystem,
  ) {}

  get isOpen(): boolean {
    return this.request !== null;
  }

  open(request: DialogueRequest): void {
    this.close(true);
    this.request = request;
    this.lineIndex = 0;
    this.revealed = 0;
    this.typing = true;

    const portrait = el('div', { class: 'cc-portrait' }, [
      el('img', { src: request.portrait, alt: request.speakerName, style: 'width:100%;height:100%;display:block;' }),
    ]);

    this.textNode = el('p', { class: 'cc-dialogue-text' });
    this.hintNode = el('div', { class: 'cc-dialogue-hint' }, [
      el('span', { text: 'Continue' }),
      el('span', { class: 'cc-pill', style: 'padding:2px 8px;font-size:11px;', text: this.input.glyph('interact') }),
    ]);
    this.hintNode.style.opacity = '0';
    this.choiceNode = el('div', { class: 'cc-choices' });

    const hearts = el('span', { class: 'cc-hearts' });
    if (request.hearts !== undefined) {
      for (let i = 0; i < 5; i++) {
        const filled = i < request.hearts;
        const heart = el('span', {
          class: `cc-heart ${filled ? 'filled' : ''} ${request.heartGained && i === request.hearts - 1 ? 'pop' : ''}`,
          html: Icons.heart(13, filled),
        });
        hearts.append(heart);
      }
    }

    const card = el('div', { class: 'cc-dialogue-card' }, [
      portrait,
      el('div', { class: 'cc-dialogue-body' }, [
        el('div', { class: 'cc-dialogue-name' }, [
          el('b', { text: request.speakerName }),
          request.title ? el('span', { text: request.title }) : el('span'),
          hearts,
        ]),
        this.textNode,
        this.choiceNode,
      ]),
      this.hintNode,
    ]);

    this.node = el('div', { id: 'dialogue' }, [card]);
    this.ui.layers.dialogue.append(this.node);
  }

  /** Advances: finishes the current line, or moves to the next. */
  advance(): void {
    if (!this.request) return;
    const line = this.request.lines[this.lineIndex] ?? '';

    if (this.typing && this.revealed < line.length) {
      // First press completes the line rather than skipping it.
      this.revealed = line.length;
      if (this.textNode) this.textNode.textContent = line;
      this.typing = false;
      this.showHint();
      return;
    }

    if (this.lineIndex < this.request.lines.length - 1) {
      this.lineIndex += 1;
      this.revealed = 0;
      this.typing = true;
      this.hideHint();
      return;
    }

    if (this.request.choices && this.request.choices.length > 0) {
      // Wait for a choice rather than closing.
      return;
    }

    const done = this.request.onComplete;
    this.close();
    done?.();
  }

  close(immediate = false): void {
    const node = this.node;
    const request = this.request;
    this.node = null;
    this.request = null;
    this.textNode = null;
    this.hintNode = null;
    this.choiceNode = null;
    if (!node) return;
    if (immediate) node.remove();
    else removeAfter(node, 'leaving', 200);
    if (request) this.bus.emit('ui:dialogueClosed', { speakerId: request.speakerId });
  }

  update(dt: number): void {
    if (!this.request || !this.textNode) return;
    const line = this.request.lines[this.lineIndex] ?? '';

    if (this.typing && this.revealed < line.length) {
      // Speed scales with line length so long lines do not drag.
      const speed = TYPE_SPEED * (1 + Math.min(1, line.length / 120));
      this.revealed = Math.min(line.length, this.revealed + dt * speed);
      this.textNode.textContent = line.slice(0, Math.floor(this.revealed));

      // A soft blip per few characters reads as speech without being noise.
      this.voiceTimer -= dt;
      if (this.voiceTimer <= 0) {
        this.voiceTimer = 0.062;
        this.bus.emit('audio:sfx', { id: 'ui.talk', rate: 0.9 + Math.random() * 0.3 });
      }

      if (this.revealed >= line.length) {
        this.typing = false;
        this.showHint();
      }
    }
  }

  private showHint(): void {
    if (!this.request) return;
    const isLast = this.lineIndex >= this.request.lines.length - 1;
    if (isLast && this.request.choices?.length) {
      this.renderChoices();
      if (this.hintNode) this.hintNode.style.opacity = '0';
      return;
    }
    if (this.hintNode) this.hintNode.style.opacity = '1';
  }

  private hideHint(): void {
    if (this.hintNode) this.hintNode.style.opacity = '0';
  }

  private renderChoices(): void {
    if (!this.choiceNode || !this.request?.choices) return;
    clear(this.choiceNode);
    for (const choice of this.request.choices) {
      const button = el('button', {
        class: 'cc-btn',
        text: choice.label,
        onclick: () => {
          const handler = this.request?.onChoice;
          const complete = this.request?.onComplete;
          this.close();
          handler?.(choice.id);
          complete?.();
        },
      });
      this.choiceNode.append(button);
    }
    (this.choiceNode.firstElementChild as HTMLElement | null)?.focus();
  }
}
