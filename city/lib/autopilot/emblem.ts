import { shrinkPicture, type Picture } from '../../../lib/launch/picture.client.ts';
import { emblemHue } from './plan.ts';

/**
 * The coin's picture the agent makes for a launch (CITY-175): a minted coin in the city's light — a glowing body in the
 * seed's colour, a bright rim, an engraved ring, the ticker struck in the middle and a glint across it — drawn here in
 * the browser, 512 px square, then shrunk the one way every launch picture is (`shrinkPicture`). It is the person's
 * coin's own face, not a picture of the product; one tap in the launch sheet swaps it for her own.
 */

const SIDE = 512;

export async function drawEmblem(symbol: string, seed: number): Promise<Picture | null> {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = SIDE;
  canvas.height = SIDE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const hue = emblemHue(seed);
  const c = SIDE / 2;

  // The night around it.
  const night = ctx.createRadialGradient(c, c * 0.9, 40, c, c, SIDE * 0.75);
  night.addColorStop(0, `hsl(${hue} 60% 22%)`);
  night.addColorStop(0.55, `hsl(${(hue + 30) % 360} 45% 9%)`);
  night.addColorStop(1, '#07060d');
  ctx.fillStyle = night;
  ctx.fillRect(0, 0, SIDE, SIDE);

  // A soft halo behind the coin.
  const halo = ctx.createRadialGradient(c, c, 120, c, c, 250);
  halo.addColorStop(0, `hsla(${hue} 95% 60% / 0.55)`);
  halo.addColorStop(1, `hsla(${hue} 95% 60% / 0)`);
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, SIDE, SIDE);

  // The rim: light from the top left, shade to the bottom right.
  const rim = ctx.createLinearGradient(c - 190, c - 190, c + 190, c + 190);
  rim.addColorStop(0, `hsl(${hue} 100% 86%)`);
  rim.addColorStop(0.45, `hsl(${hue} 85% 55%)`);
  rim.addColorStop(1, `hsl(${hue} 80% 22%)`);
  ctx.beginPath();
  ctx.arc(c, c, 196, 0, Math.PI * 2);
  ctx.fillStyle = rim;
  ctx.shadowColor = `hsla(${hue} 100% 50% / 0.6)`;
  ctx.shadowBlur = 48;
  ctx.fill();
  ctx.shadowBlur = 0;

  // The face.
  const face = ctx.createRadialGradient(c - 60, c - 70, 20, c, c, 180);
  face.addColorStop(0, `hsl(${hue} 95% 64%)`);
  face.addColorStop(0.6, `hsl(${hue} 80% 40%)`);
  face.addColorStop(1, `hsl(${hue} 75% 20%)`);
  ctx.beginPath();
  ctx.arc(c, c, 172, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();

  // The engraved ring, with its dots.
  ctx.lineWidth = 3;
  ctx.strokeStyle = `hsla(${hue} 100% 90% / 0.45)`;
  ctx.beginPath();
  ctx.arc(c, c, 148, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = `hsla(${hue} 100% 92% / 0.55)`;
  for (let i = 0; i < 36; i += 1) {
    const a = (i / 36) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * 160, c + Math.sin(a) * 160, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // The ticker, struck: a shadow cut below, the letters in light.
  // A short ticker struck whole; a longer one by its first letter, large — a coin's face, not a label.
  const clean = symbol.replace(/[^A-Za-z0-9]/gu, '').toUpperCase();
  const letters = (clean.length <= 4 ? clean : clean.slice(0, 1)) || '◎';
  await document.fonts?.ready;
  const css = getComputedStyle(document.documentElement);
  const font = css.getPropertyValue('--font-display').trim() || 'system-ui';
  const size = letters.length === 1 ? 210 : letters.length === 2 ? 150 : letters.length === 3 ? 120 : 96;
  ctx.font = `800 ${size}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `hsla(${hue} 80% 12% / 0.7)`;
  ctx.fillText(letters, c + 3, c + 9);
  const ink = ctx.createLinearGradient(c, c - size / 2, c, c + size / 2);
  ink.addColorStop(0, '#fffaf2');
  ink.addColorStop(1, `hsl(${hue} 100% 84%)`);
  ctx.fillStyle = ink;
  ctx.fillText(letters, c, c + 4);

  // The glint across the top of the face.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, 172, 0, Math.PI * 2);
  ctx.clip();
  const glint = ctx.createLinearGradient(c - 172, c - 172, c + 40, c + 40);
  glint.addColorStop(0, 'rgba(255,255,255,0.34)');
  glint.addColorStop(0.42, 'rgba(255,255,255,0.06)');
  glint.addColorStop(0.43, 'rgba(255,255,255,0)');
  ctx.fillStyle = glint;
  ctx.fillRect(0, 0, SIDE, SIDE);
  ctx.restore();

  // Three small stars in the night, placed by the seed.
  ctx.fillStyle = 'rgba(255, 240, 220, 0.85)';
  for (let i = 0; i < 3; i += 1) {
    const a = ((seed * 37 + i * 113) % 360) * (Math.PI / 180);
    const r = 220 + ((seed + i * 7) % 3) * 12;
    star(ctx, c + Math.cos(a) * r, c + Math.sin(a) * r, 5 + ((seed + i) % 3) * 2);
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  return shrinkPicture(new File([blob], `${letters.toLowerCase()}.png`, { type: 'image/png' }));
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}
