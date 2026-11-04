import QRCode from 'qrcode';
import { requestFrame } from '../capture.ts';
import { PALETTE } from '../palette.ts';

/** What the card says, in the language on screen: the friend's discount as a figure, its line, and the city's tag. */
export type CardWords = Readonly<{ big: string; line: string; tag: string }>;

/**
 * The partner's share card (CITY-127): a frame of the live city as it stands on the partner's screen — our own scene,
 * never a generated one — with the friend's offer (decision 93: a discount on Ryntra's fee), the link and its QR.
 * 1080 × 1350 (4:5): it fills a phone feed. Browser only: the scene hands over its next frame (`requestFrame`).
 */
export async function composePartnerCard(link: string, words: CardWords): Promise<Blob | null> {
  const frame = await Promise.race([requestFrame(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_500))]);
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = PALETTE.inkDeep;
  ctx.fillRect(0, 0, W, H);
  if (frame) {
    const scale = Math.max(W / frame.width, H / frame.height);
    ctx.drawImage(frame, (W - frame.width * scale) / 2, (H - frame.height * scale) / 2, frame.width * scale, frame.height * scale);
  }
  const shade = ctx.createLinearGradient(0, H * 0.35, 0, H);
  shade.addColorStop(0, 'rgba(6,5,12,0)');
  shade.addColorStop(0.5, 'rgba(6,5,12,0.84)');
  shade.addColorStop(1, 'rgba(6,5,12,0.97)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  const display = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'system-ui';
  ctx.textBaseline = 'alphabetic';

  ctx.font = `800 30px ${display}`;
  ctx.fillStyle = PALETTE.warmWhite;
  ctx.fillText('RYNTRA PARTNERS', 72, H - 500);

  ctx.font = `900 220px ${display}`;
  ctx.fillStyle = PALETTE.amber;
  ctx.fillText(words.big, 64, H - 300);

  ctx.font = `700 40px ${display}`;
  ctx.fillStyle = PALETTE.ice;
  wrap(ctx, words.line, 72, H - 236, W - 420, 48);

  ctx.font = `600 30px ${display}`;
  ctx.fillStyle = 'rgba(238,241,255,0.7)';
  ctx.fillText(words.tag, 72, H - 76);

  // The QR in a dark rounded plate, the link under it.
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, link, { margin: 1, width: 236, color: { dark: '#0b0a14', light: '#eef1ff' } });
  ctx.fillStyle = PALETTE.ice;
  ctx.fillRect(W - 72 - 252, H - 500, 252, 252);
  ctx.drawImage(qr, W - 72 - 244, H - 492, 236, 236);
  ctx.font = `700 24px ${display}`;
  ctx.fillStyle = 'rgba(238,241,255,0.8)';
  ctx.textAlign = 'right';
  ctx.fillText(link.replace(/^https?:\/\//, ''), W - 72, H - 212);
  ctx.textAlign = 'left';

  ctx.fillStyle = PALETTE.amber;
  ctx.fillRect(72, H - 132, 54, 6);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, max: number, lineHeight: number) {
  const words = text.split(' ');
  let line = '';
  let row = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      ctx.fillText(line, x, y + row * lineHeight);
      line = word;
      row += 1;
    } else line = next;
  }
  if (line) ctx.fillText(line, x, y + row * lineHeight);
}
