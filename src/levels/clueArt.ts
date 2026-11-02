/**
 * Clue note art: a torn, slightly yellowed notebook scrap with a hurried handwritten line and a crude
 * black-pen doodle, all drawn on a canvas with seeded wobble (no two notes alike, same seed = same note).
 * Wall notes hang from a strip of tape; floor notes are crumpled.
 */
import { CanvasTexture, DoubleSide, Group, Mesh, MeshLambertMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Material } from 'three';
import { Rng } from '../gen/rng';
import type { Clue, Doodle } from '../gen/clues';

const W = 384, H = 480;
const HAND = '"NoclipHand", "Segoe Print", "Ink Free", "Bradley Hand", "Noteworthy", "Marker Felt", "Comic Sans MS", cursive';

let fontReady: Promise<void> | null = null;
/** Load the bundled handwriting font (Reenie Beanie, SIL OFL 1.1, see public/fonts/OFL.txt) once. Never throws. */
export function loadHandFont(): Promise<void> {
  if (fontReady) return fontReady;
  fontReady = (async () => {
    try {
      if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
      const f = new FontFace('NoclipHand', `url(${import.meta.env.BASE_URL}fonts/reenie-beanie.woff2)`);
      await f.load();
      document.fonts.add(f);
    } catch { /* offline first run etc.: fall back to system handwriting fonts */ }
  })();
  return fontReady;
}

type Ctx = CanvasRenderingContext2D;

/** A pen stroke through points (0..1 doodle space) with wobble and a second, slightly offset pass. */
function pen(g: Ctx, r: Rng, pts: [number, number][], box: { x: number; y: number; s: number }, width = 3.2, passes = 2): void {
  for (let pass = 0; pass < passes; pass++) {
    g.lineWidth = width * (pass ? 0.7 : 1) * (0.85 + r.next() * 0.3);
    g.beginPath();
    const j = () => (r.next() - 0.5) * 0.018;
    const P = pts.map(([x, y]) => [box.x + (x + j()) * box.s, box.y + (y + j()) * box.s] as [number, number]);
    g.moveTo(P[0][0], P[0][1]);
    for (let i = 1; i < P.length; i++) {
      const [x0, y0] = P[i - 1], [x1, y1] = P[i];
      const mx = (x0 + x1) / 2 + (r.next() - 0.5) * 3, my = (y0 + y1) / 2 + (r.next() - 0.5) * 3;
      g.quadraticCurveTo(mx, my, x1, y1);
    }
    g.stroke();
  }
}
const circle = (cx: number, cy: number, rx: number, ry = rx, n = 14, a0 = 0, a1 = Math.PI * 2.1): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });

function doodle(g: Ctx, r: Rng, d: Doodle, box: { x: number; y: number; s: number }): void {
  const P = (pts: [number, number][], w?: number) => pen(g, r, pts, box, w);
  const stick = (x: number, top: number, h: number, armLen = 0.18) => {
    P(circle(x, top + h * 0.08, h * 0.08, h * 0.09, 10));
    P([[x, top + h * 0.17], [x, top + h * 0.62]]);
    P([[x - armLen, top + h * 0.55], [x, top + h * 0.25], [x + armLen, top + h * 0.55]]);
    P([[x - h * 0.1, top + h], [x, top + h * 0.62], [x + h * 0.1, top + h]]);
  };
  switch (d) {
    case 'key': P(circle(0.3, 0.5, 0.13, 0.13, 16)); P([[0.43, 0.5], [0.85, 0.5]]); P([[0.72, 0.5], [0.72, 0.62]]); P([[0.8, 0.5], [0.8, 0.6]]); break;
    case 'tall': stick(0.38, 0.04, 0.92, 0.12); stick(0.72, 0.62, 0.34, 0.08); P([[0.55, 0.9], [0.6, 0.86], [0.55, 0.82]], 2); break; // a tiny person for scale
    case 'dog': P([[0.15, 0.55], [0.3, 0.45], [0.65, 0.45], [0.78, 0.38], [0.88, 0.42], [0.85, 0.52], [0.72, 0.55]]); P([[0.3, 0.45], [0.25, 0.75]]); P([[0.38, 0.5], [0.4, 0.78]]); P([[0.62, 0.52], [0.6, 0.78]]); P([[0.7, 0.54], [0.74, 0.78]]); g.fillStyle = g.strokeStyle; g.beginPath(); g.arc(box.x + 0.83 * box.s, box.y + 0.43 * box.s, 3.2, 0, 7); g.fill(); break;
    case 'ear': P([[0.55, 0.2], [0.42, 0.22], [0.35, 0.38], [0.38, 0.58], [0.48, 0.72], [0.45, 0.82], [0.52, 0.85]]); P([[0.55, 0.2], [0.65, 0.3], [0.64, 0.48], [0.55, 0.6]]); P([[0.2, 0.3], [0.2, 0.7]], 3); P([[0.1, 0.2], [0.1, 0.8]], 3); P([[0.05, 0.25], [0.3, 0.75]], 4); break; // crossed-out sound
    case 'smile': P(circle(0.35, 0.3, 0.06, 0.04, 8)); P(circle(0.65, 0.3, 0.06, 0.04, 8)); P(circle(0.5, 0.45, 0.38, 0.28, 18, 0.15, Math.PI - 0.15)); for (let i = 0; i < 7; i++) { const x = 0.22 + i * 0.093; P([[x, 0.53 + Math.sin((i / 6) * Math.PI) * 0.12], [x, 0.62 + Math.sin((i / 6) * Math.PI) * 0.1]], 2); } break;
    case 'shadow': stick(0.35, 0.1, 0.7); P([[0.35, 0.8], [0.6, 0.86], [0.85, 0.9]], 5); P([[0.6, 0.95], [0.7, 0.7]], 2); P([[0.7, 0.7], [0.66, 0.78]], 2); break;
    case 'door': P([[0.3, 0.9], [0.3, 0.15], [0.62, 0.15], [0.62, 0.9]]); P(circle(0.56, 0.55, 0.02, 0.02, 6)); for (let k = 0; k < 3; k++) P(circle(0.62, 0.5, 0.12 + k * 0.08, 0.15 + k * 0.1, 8, -0.8, 0.8), 2); break;
    case 'locker': P([[0.3, 0.92], [0.3, 0.1], [0.6, 0.1], [0.6, 0.92], [0.3, 0.92]]); for (let k = 0; k < 4; k++) P([[0.36, 0.2 + k * 0.04], [0.54, 0.2 + k * 0.04]], 2); P([[0.9, 0.5], [0.66, 0.5]]); P([[0.74, 0.42], [0.66, 0.5], [0.74, 0.58]]); break;
    case 'camcorder': P([[0.15, 0.4], [0.62, 0.4], [0.62, 0.7], [0.15, 0.7], [0.15, 0.4]]); P([[0.62, 0.48], [0.85, 0.38], [0.85, 0.72], [0.62, 0.62]]); P(circle(0.25, 0.32, 0.05, 0.05, 8)); P([[0.35, 0.7], [0.3, 0.95]]); P([[0.4, 0.7], [0.45, 0.95]]); break;
    case 'waves': for (let k = 0; k < 4; k++) P(Array.from({ length: 9 }, (_, i) => [0.1 + i * 0.1, 0.3 + k * 0.15 + (i % 2 ? 0.04 : -0.04)] as [number, number])); stick(0.5, 0.05, 0.3, 0.1); break;
    case 'fuse': P([[0.3, 0.4], [0.7, 0.4], [0.7, 0.6], [0.3, 0.6], [0.3, 0.4]]); P([[0.3, 0.5], [0.15, 0.5]]); P([[0.7, 0.5], [0.85, 0.5]]); P([[0.4, 0.4], [0.4, 0.6]], 2); P([[0.6, 0.4], [0.6, 0.6]], 2); break;
    case 'crowbar': P([[0.2, 0.85], [0.75, 0.2], [0.82, 0.18], [0.85, 0.26]]); P([[0.2, 0.85], [0.12, 0.84]]); break;
    case 'valve': P(circle(0.5, 0.45, 0.25, 0.25, 18)); P([[0.25, 0.45], [0.75, 0.45]]); P([[0.5, 0.2], [0.5, 0.7]]); P([[0.5, 0.7], [0.5, 0.95]], 4); P(circle(0.85, 0.3, 0.1, 0.1, 10, -1, 2.4), 2); P([[0.78, 0.38], [0.74, 0.3]], 2); break;
    case 'lever': P([[0.25, 0.2], [0.75, 0.2], [0.75, 0.85], [0.25, 0.85], [0.25, 0.2]]); P([[0.5, 0.6], [0.62, 0.32]], 4); P(circle(0.63, 0.3, 0.035, 0.035, 6)); P([[0.85, 0.65], [0.85, 0.3]]); P([[0.8, 0.38], [0.85, 0.3], [0.9, 0.38]]); break;
    case 'hook': P([[0.5, 0.1], [0.5, 0.55]]); P(circle(0.4, 0.55, 0.1, 0.12, 10, 0, Math.PI * 0.95)); P(Array.from({ length: 7 }, (_, i) => [0.5 + Math.sin(i) * 0.04, 0.1 - i * 0.0] as [number, number]), 2); P([[0.1, 0.9], [0.4, 0.9]]); P([[0.6, 0.9], [0.9, 0.9]]); break;
    case 'numbers': g.font = `bold ${box.s * 0.2}px ${HAND}`; ['1', '2', '3'].forEach((n, i) => { g.save(); g.translate(box.x + (0.14 + i * 0.32) * box.s, box.y + 0.6 * box.s); g.rotate((r.next() - 0.5) * 0.3); g.fillText(n, 0, 0); g.restore(); if (i < 2) P([[0.27 + i * 0.32, 0.52], [0.4 + i * 0.32, 0.52]], 2); }); break;
    case 'eye': P(circle(0.5, 0.5, 0.36, 0.18, 18)); P(circle(0.5, 0.5, 0.12, 0.12, 12)); g.beginPath(); g.arc(box.x + 0.5 * box.s, box.y + 0.5 * box.s, box.s * 0.05, 0, 7); g.fillStyle = g.strokeStyle; g.fill(); P([[0.1, 0.9], [0.9, 0.1]], 4); break;
    case 'monster': P(circle(0.5, 0.5, 0.32, 0.36, 20)); P(circle(0.4, 0.42, 0.04, 0.04, 6)); P(circle(0.6, 0.42, 0.04, 0.04, 6)); P([[0.35, 0.62], [0.45, 0.58], [0.55, 0.64], [0.65, 0.58]]); for (let k = 0; k < 6; k++) P([[0.5 + Math.cos(k) * 0.33, 0.5 + Math.sin(k) * 0.36], [0.5 + Math.cos(k) * 0.45, 0.5 + Math.sin(k) * 0.48]], 2); break;
    case 'face': P(circle(0.5, 0.48, 0.24, 0.32, 18)); P([[0.3, 0.9], [0.5, 0.82], [0.7, 0.9]]); g.font = `bold ${box.s * 0.22}px ${HAND}`; g.fillText('?', box.x + 0.45 * box.s, box.y + 0.56 * box.s); break;
    case 'balloon': P(circle(0.5, 0.32, 0.17, 0.21, 14)); P([[0.5, 0.53], [0.46, 0.7], [0.54, 0.82], [0.5, 0.95]], 2); P([[0.15, 0.15], [0.85, 0.85]], 4); break;
    case 'bottle': P([[0.42, 0.15], [0.58, 0.15], [0.58, 0.3], [0.66, 0.4], [0.66, 0.88], [0.34, 0.88], [0.34, 0.4], [0.42, 0.3], [0.42, 0.15]]); P([[0.38, 0.55], [0.62, 0.55]], 2); P([[0.38, 0.7], [0.62, 0.7]], 2); break;
  }
}

/** Word-wrap and write a line of hurried handwriting, letter by letter with jitter. */
function handwrite(g: Ctx, r: Rng, text: string, x0: number, y0: number, maxW: number, size: number): number {
  g.font = `${size}px ${HAND}`;
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line);
  let y = y0;
  for (const l of lines) {
    let x = x0 + (r.next() - 0.5) * 10;
    const slope = (r.next() - 0.5) * 0.06;
    for (const ch of l) {
      const sc = 0.92 + r.next() * 0.16, w = g.measureText(ch).width; // size wobble via transform: no font re-parse per letter
      g.setTransform(sc, 0, 0, sc, x, y + (x - x0) * slope + (r.next() - 0.5) * 3);
      g.rotate((r.next() - 0.5) * 0.14);
      g.fillText(ch, 0, 0);
      if (r.next() < 0.25) g.fillText(ch, 0.8, 0.4); // pen pressed twice
      x += w * sc * (0.95 + r.next() * 0.1) + 0.5;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    y += size * 1.12;
  }
  return y;
}

export function drawClue(c: Clue): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const r = new Rng(c.seed);
  // torn paper silhouette
  g.beginPath();
  g.moveTo(8, 18);
  for (let x = 8; x <= W - 8; x += 12) g.lineTo(x, 10 + r.next() * 14); // ragged torn top
  g.lineTo(W - 6, H - 10); g.lineTo(10, H - 6);
  g.closePath();
  const tone = 222 + r.int(-10, 8);
  g.fillStyle = `rgb(${tone},${tone - 6},${tone - 26})`;
  g.fill();
  g.save(); g.clip();
  // grime, a coffee ring, ruled lines and a margin
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(120,96,50,${0.015 + r.next() * 0.03})`; g.beginPath(); g.arc(r.next() * W, r.next() * H, 10 + r.next() * 60, 0, 7); g.fill(); }
  if (r.next() < 0.45) { g.strokeStyle = 'rgba(110,70,30,0.22)'; g.lineWidth = 5; g.beginPath(); g.arc(W * (0.3 + r.next() * 0.4), H * (0.55 + r.next() * 0.3), 44, 0, 7); g.stroke(); }
  g.strokeStyle = 'rgba(90,130,190,0.35)'; g.lineWidth = 1.5;
  for (let y = 64; y < H; y += 30) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + (r.next() - 0.5) * 2); g.stroke(); }
  g.strokeStyle = 'rgba(200,80,80,0.35)'; g.beginPath(); g.moveTo(52, 0); g.lineTo(54, H); g.stroke();
  // a fold crease
  g.strokeStyle = 'rgba(80,60,30,0.18)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, H * (0.45 + r.next() * 0.1)); g.lineTo(W, H * (0.45 + r.next() * 0.1)); g.stroke();
  // ink: mostly black ballpoint, sometimes blue
  const ink = r.next() < 0.75 ? 'rgba(18,16,20,0.92)' : 'rgba(20,30,90,0.9)';
  g.fillStyle = ink; g.strokeStyle = ink; g.lineCap = 'round'; g.lineJoin = 'round';
  const end = handwrite(g, r, c.text, 66, 74, W - 90, 46);
  // underline the important bit sometimes
  if (r.next() < 0.5) pen(g, r, [[0, 0], [1, 0.02]], { x: 66, y: end - 24, s: W - 120 }, 3, 1);
  const s = Math.min(W - 100, H - end - 30);
  doodle(g, r, c.doodle, { x: (W - s) / 2 + 10, y: Math.max(end, H - s - 24), s });
  g.restore();
  // tape for wall notes
  if (c.wall) { g.fillStyle = 'rgba(235,228,190,0.55)'; g.save(); g.translate(W / 2, 14); g.rotate((r.next() - 0.5) * 0.2); g.fillRect(-56, -14, 112, 30); g.restore(); }
  return cv;
}

export interface ClueVisuals { group: Group; /** PNG data URL of a note, encoded on first read. */ image(id: string): string | undefined; materials: Material[]; dispose(): void }

/** Meshes for all clues of a level (one texture each, ~0.15 x 0.19 m paper). */
export function buildClues(clues: Clue[], lambert: boolean, patch?: (m: Material) => void): ClueVisuals {
  const group = new Group();
  const canvases = new Map<string, HTMLCanvasElement>(), images = new Map<string, string>();
  const materials: Material[] = [];
  const geos: PlaneGeometry[] = [];
  const texs: CanvasTexture[] = [];
  for (const c of clues) {
    const cv = drawClue(c);
    canvases.set(c.id, cv);
    const t = new CanvasTexture(cv); t.colorSpace = SRGBColorSpace; t.anisotropy = 4; texs.push(t);
    const m = lambert ? new MeshLambertMaterial({ map: t, alphaTest: 0.5, side: DoubleSide }) : new MeshStandardMaterial({ map: t, alphaTest: 0.5, side: DoubleSide, roughness: 0.92 });
    patch?.(m);
    materials.push(m);
    const geo = new PlaneGeometry(0.152, 0.19, 6, 6);
    const r = new Rng(c.seed ^ 77);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      // wall notes curl a little off the wall at the bottom; floor notes are crumpled
      const z = c.wall ? Math.max(0, -y) * 0.06 + Math.sin(x * 30) * 0.001 : (Math.sin(x * 37 + r.next()) * Math.cos(y * 29) * 0.006 + r.next() * 0.002);
      pos.setZ(i, z);
    }
    geo.computeVertexNormals();
    geos.push(geo);
    const mesh = new Mesh(geo, m);
    mesh.position.set(c.x, c.y, c.z);
    if (c.wall) { mesh.rotation.y = c.yaw; mesh.rotation.z = (r.next() - 0.5) * 0.18; }
    else { mesh.rotation.set(-Math.PI / 2, 0, c.yaw); }
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const image = (id: string) => { if (!images.has(id)) { const cv = canvases.get(id); if (cv) images.set(id, cv.toDataURL('image/png')); } return images.get(id); };
  return { group, image, materials, dispose() { geos.forEach((g) => g.dispose()); texs.forEach((t) => t.dispose()); materials.forEach((m) => m.dispose()); group.removeFromParent(); } };
}
