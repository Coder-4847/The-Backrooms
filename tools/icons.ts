/** Renders public/icon.svg to the PNG sizes the PWA manifest needs. Run once: `npx tsx tools/icons.ts`. */
import { readFileSync } from 'node:fs';
import { launch } from './browser';

const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await launch();
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0;background:#0b0a06">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  await page.screenshot({ path: `public/icon-${size}.png` });
}
await browser.close();
