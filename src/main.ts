/** Entry point: boot the game, register the service worker, show a friendly error if WebGL2 is missing. */
import './ui/styles.css';
import { Game } from './core/game';

async function boot(): Promise<void> {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  try {
    const game = await Game.create(canvas);
    if (!game.gfx.hasWebGL2) throw new Error('WebGL2 is required');
    await game.start();
  } catch (e) {
    console.error(e);
    document.getElementById('ui')!.innerHTML = `<div class="screen center active"><h2>Cannot start</h2><p>${(e as Error).message}. Try a current version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.</p></div>`;
    document.getElementById('ui')!.classList.add('active');
  }
}

void boot();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
      // when a new version is installed, activate it on next load
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) console.info('Update ready: reload to apply'); });
      });
    }).catch(() => { /* offline support is optional */ });
  });
}
