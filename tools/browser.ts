/** Shared Playwright helpers for perf + screenshot tools: launch Chromium (software GL ok) and start a dev server. */
import { chromium, type Browser, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'node:child_process';

export async function launch(): Promise<Browser> {
  return chromium.launch({
    args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
}

/** Start `vite` dev server on a port; resolves when it answers. Caller must kill the returned process. */
export async function startServer(port = 5199): Promise<{ url: string; proc: ChildProcess }> {
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { env: { ...process.env, BASE_PATH: '/' }, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(url); if (r.ok) return { url, proc }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill();
  throw new Error('dev server did not start');
}

/** Open the game, accept the content warning, and wait for the title screen. */
export async function openGame(browser: Browser, url: string, width = 1280, height = 720): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.addInitScript('window.__name = (f) => f;'); // tsx/esbuild helper used inside evaluate callbacks
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console.error]', m.text()); });
  await page.goto(`${url}?debug=1`);
  await page.waitForSelector('text=I understand', { timeout: 30000 });
  await page.click('text=I understand');
  await page.waitForSelector('.title', { timeout: 120000 });
  return page;
}
