import './ui/styles.css';
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
  notice.innerHTML = `
    <div style="max-width:520px">
      <h1 style="font-size:26px;margin:0 0 10px">Cozy Cove could not start</h1>
      <p style="opacity:.8;margin:0 0 14px">${message}</p>
      <p style="opacity:.6;font-size:13px">This build needs WebGL 2. Try a recent desktop browser with hardware acceleration enabled.</p>
    </div>`;
  document.body.append(notice);
}

// Fail with an explanation rather than a blank canvas when WebGL is missing.
const probe = document.createElement('canvas');
if (!probe.getContext('webgl2') && !probe.getContext('webgl')) {
  reportFailure('Your browser did not provide a WebGL context.');
} else {
  try {
    const game = new Game(container);
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
    window.addEventListener('beforeunload', () => {
      try {
        game.save.write(game.snapshot());
      } catch {
        // Never block unload on a storage failure.
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        try {
          game.save.write(game.snapshot());
        } catch {
          /* ignore */
        }
      }
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
