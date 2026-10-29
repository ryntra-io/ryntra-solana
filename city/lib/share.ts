import { shareThroughApp } from './app-bridge/page.ts';
import { BRAND } from './brand.ts';
import type { Tower } from './market/types.ts';
import { PALETTE } from './palette.ts';

/**
 * The tower card a community posts: the live frame of their tower, the real 24h move, its place in the skyline.
 * 1080×1350 (4:5) because it fills a phone feed on X and Instagram.
 */
export async function composeTowerCard(frame: HTMLCanvasElement, tower: Tower, rank: number, total: number): Promise<Blob | null> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // The frame, cropped to cover.
  const scale = Math.max(W / frame.width, H / frame.height);
  const fw = frame.width * scale;
  const fh = frame.height * scale;
  ctx.fillStyle = PALETTE.inkDeep;
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(frame, (W - fw) / 2, (H - fh) / 2, fw, fh);

  const shade = ctx.createLinearGradient(0, H * 0.45, 0, H);
  shade.addColorStop(0, 'rgba(6,5,12,0)');
  shade.addColorStop(0.55, 'rgba(6,5,12,0.82)');
  shade.addColorStop(1, 'rgba(6,5,12,0.96)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  const display = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || 'system-ui';
  const up = tower.change24h >= 0;

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PALETTE.ice;
  ctx.font = `900 150px ${display}`;
  fitText(ctx, `$${tower.symbol.replace(/^\$/, '').toUpperCase()}`, 72, H - 330, W - 144, 150, display);

  ctx.font = `800 64px ${display}`;
  ctx.fillStyle = up ? PALETTE.mint : PALETTE.flare;
  ctx.fillText(`${up ? '+' : '−'}${Math.abs(tower.change24h).toFixed(1)}% · 24H`, 72, H - 238);

  ctx.font = `700 34px ${display}`;
  ctx.fillStyle = 'rgba(238,241,255,0.75)';
  ctx.fillText(`TOWER #${rank} OF ${total} IN THE SKYLINE`, 72, H - 176);

  // Brand line: the name once it is approved, the hook either way.
  ctx.fillStyle = PALETTE.amber;
  ctx.fillRect(72, H - 120, 54, 6);
  let x = 72;
  if (BRAND.name) {
    ctx.font = `900 40px ${display}`;
    ctx.fillStyle = PALETTE.ice;
    ctx.fillText(BRAND.name, x, H - 64);
    x += ctx.measureText(BRAND.name).width + 24;
  }
  ctx.font = `700 30px ${display}`;
  ctx.fillStyle = BRAND.name ? 'rgba(238,241,255,0.6)' : PALETTE.ice;
  ctx.fillText(BRAND.hook.toUpperCase(), x, H - 66);

  ctx.font = `600 22px ${display}`;
  ctx.fillStyle = 'rgba(238,241,255,0.45)';
  ctx.textAlign = 'right';
  ctx.fillText('Market data: Jupiter · not financial advice', W - 72, 72);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, size: number, family: string) {
  let s = size;
  ctx.font = `900 ${s}px ${family}`;
  while (ctx.measureText(text).width > maxWidth && s > 40) {
    s -= 6;
    ctx.font = `900 ${s}px ${family}`;
  }
  ctx.fillText(text, x, y);
}

/** Phone: the share sheet with the image (X, Telegram, Instagram…) — the app's own in the Ryntra app. Desktop: download it. */
export async function shareImage(blob: Blob, filename: string, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const app = await shareThroughApp(blob, filename, text);
  if (app) return app;
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
