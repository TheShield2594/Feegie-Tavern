import './ui/styles.css';
import { AssetManager } from './assets/AssetManager';
import { Game } from './core/Game';

/**
 * Entry point. Boots the game into #app and exposes it on `window` for
 * debugging (`cozy.time.skipTo(20)` and friends) without shipping a dev UI.
 */

const container = document.getElementById('app');
if (!container) {
  throw new Error('Cozy Cove could not find its #app container.');
}

function reportFailure(message: string, detail?: unknown): void {
  console.error('[cozy]', message, detail);
  const notice = document.createElement('div');
  notice.style.cssText = `
    position:fixed;inset:0;display:grid;place-items:center;padding:32px;
    background:#141d2c;color:#f4ecdc;font:16px/1.6 system-ui,sans-serif;text-align:center;z-index:99;
  `;

  const panel = document.createElement('div');
  panel.style.maxWidth = '520px';

  const heading = document.createElement('h1');
  heading.style.cssText = 'font-size:26px;margin:0 0 10px';
  heading.textContent = 'Cozy Cove could not start';

  // textContent, not innerHTML: `message` can carry an exception string we do
  // not control, and this path runs before anything else has rendered.
  const reason = document.createElement('p');
  reason.style.cssText = 'opacity:.8;margin:0 0 14px';
  reason.textContent = message;

  const hint = document.createElement('p');
  hint.style.cssText = 'opacity:.6;font-size:13px';
  hint.textContent = 'This build needs WebGL 2. Try a recent desktop browser with hardware acceleration enabled.';

  panel.append(heading, reason, hint);
  notice.append(panel);
  document.body.append(notice);
}

/**
 * A caption over the title vista while the kits stream in. Deliberately plain:
 * it is on screen for a fraction of a second on a warm cache, and the kits are
 * optional, so it must never look like an error when they fail.
 */
function showLoading(): { progress: (done: number, total: number) => void; done: () => void } {
  const bar = document.createElement('i');
  const fill = document.createElement('div');
  fill.className = 'cc-boot-bar';
  fill.append(bar);

  const label = document.createElement('p');
  label.className = 'cc-boot-label';
  label.textContent = 'Setting out the island…';

  const tips = [
    'Shake a tree you have already picked — sometimes a bug falls out.',
    'Fish come up under the rain. Pip swears by it.',
    'Press 1 to wave. Neighbours wave back.',
    'Star-shaped cracks in the soil hide fossils.',
    'Bruno pays fair for duplicates, and nothing for your first of anything.',
    'Lamps come on at dusk. The square is best just after.',
  ];
  const tip = document.createElement('p');
  tip.className = 'cc-boot-tip';
  tip.textContent = tips[Math.floor(Math.random() * tips.length)];

  const card = document.createElement('div');
  card.className = 'cc-boot-card';
  const mark = document.createElement('div');
  mark.className = 'cc-boot-mark';
  mark.innerHTML = '<svg viewBox="0 0 76 76" width="56" height="56" aria-hidden="true"><path d="M40 6C22 10 8 24 8 42c0 12 8 22 20 24 2-20 12-36 30-48-8 18-14 34-16 48 16-4 26-18 26-36C68 16 56 8 40 6Z" fill="#6f9a55"/><path d="M38 66c2-14 8-30 16-48-18 12-28 28-30 48" fill="#8fbf6a"/></svg>';
  const title = document.createElement('h1');
  title.textContent = 'Cozy Cove';
  card.append(mark, title, fill, label, tip);

  const el = document.createElement('div');
  el.id = 'boot';
  el.append(card);
  document.body.append(el);

  return {
    progress: (done, total) => {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      bar.style.width = `${Math.max(6, pct)}%`;
      label.textContent = total > 0 && done < total ? `Unpacking the kits… ${done}/${total}` : 'Nearly there…';
    },
    done: () => {
      bar.style.width = '100%';
      el.classList.add('leaving');
      window.setTimeout(() => el.remove(), 480);
    },
  };
}

/**
 * How long the boot waits for optional asset kits before starting without them.
 * Generous enough for a cold cache on a slow connection, short enough that a
 * stalled request does not read as a hung game.
 */
const ASSET_DEADLINE_MS = 15_000;

// Fail with an explanation rather than a blank canvas when WebGL is missing.
const probe = document.createElement('canvas');
if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
  reportFailure('Your browser did not provide a WebGL context.');
} else {
  void boot(container);
}

/**
 * Starts the game: loads the optional asset kits, then constructs `Game`.
 *
 * Asset loading is bounded and never fatal — a kit that fails or stalls leaves
 * its category on the generated art rather than holding the loading overlay.
 */
async function boot(root: HTMLElement): Promise<void> {
  try {
    // Kits are an enhancement, never a prerequisite: a kit that fails to load
    // leaves that category on its generated art, so a failure here is warned
    // about and then ignored rather than being allowed to stop the boot.
    const assets = new AssetManager();
    const loading = showLoading();
    try {
      // Bounded, because `loadAll` already swallows a *failed* kit but nothing
      // bounds a *stalled* one: a request that never settles would hold the
      // loading overlay forever, which is the opposite of the rule above. Past
      // the deadline the boot continues on generated art.
      //
      // A kit that arrives late afterwards is inert rather than dangerous —
      // world systems take their geometry from the manager when they are
      // constructed, so nothing re-reads it once `Game` exists.
      const timedOut = Symbol('assets-timed-out');
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        assets.loadAll((done, total) => loading.progress(done, total)).then(() => undefined),
        new Promise<typeof timedOut>((resolve) => {
          deadline = setTimeout(() => resolve(timedOut), ASSET_DEADLINE_MS);
        }),
      ]);
      clearTimeout(deadline);

      if (result === timedOut) {
        console.warn(`[cozy] asset kits still loading after ${ASSET_DEADLINE_MS}ms; starting on generated art`);
      } else {
        for (const report of assets.getReports()) {
          if (!report.ok) console.warn(`[cozy] kit "${report.kit}" unavailable (${report.error}); using generated art`);
        }
      }
    } catch (error) {
      console.warn('[cozy] asset kits unavailable; using generated art', error);
    } finally {
      loading.done();
    }

    const game = new Game(root, assets);
    game.start();
    (window as unknown as { cozy: Game }).cozy = game;
    // Panel openers, exposed for automated visual checks.
    void import('./ui/panels').then((panels) => {
      Object.assign(window as unknown as Record<string, unknown>, {
        __openShop: panels.openShop,
        __openMuseum: panels.openMuseum,
        __openJournal: panels.openJournal,
        __openWardrobe: panels.openWardrobe,
      });
    });

    // Save on the way out so a closed tab does not lose the last few minutes.
    // `saveIfPlaying` is a no-op at the title screen: the game is still holding
    // a default state aimed at slot 1 there, and writing it would erase that
    // slot for anyone who opened the page and changed their mind.
    const persist = () => {
      try {
        game.saveIfPlaying();
      } catch {
        // Never block unload on a storage failure.
      }
    };

    window.addEventListener('beforeunload', persist);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') persist();
    });

    // F3 toggles the performance readout.
    window.addEventListener('keydown', (event) => {
      if (event.code === 'F3') {
        event.preventDefault();
        game.uiRoot.togglePerf();
      }
    });
  } catch (error) {
    reportFailure(error instanceof Error ? error.message : 'Unknown error during startup.', error);
  }
}
