'use client';

import { useEffect, useRef } from 'react';
import { bandOf, levelsOf, type BotDraft } from '@/city/lib/bots/draft';
import type { Bar } from '@/city/lib/bots/path';
import type { Run } from '@/city/lib/bots/sim';
import { price as priceText, type Lang } from '@/city/lib/bots/format';
import { PALETTE } from '@/city/lib/palette';

/**
 * A draft on the week's price, drawn on one canvas: the range as a violet band, the bot's levels as fine lines, the
 * price as a line with a soft fill, and the paper fills on it — bought light violet, sold mint. Redrawn only when its
 * inputs or its size change.
 */

const BOUGHT = '#C9A2FF';

export function BotChart({ bars, draft, run, lang, height = 220, compact = false, label }: Readonly<{ bars: readonly Bar[]; draft: BotDraft; run: Run | null; lang: Lang; height?: number; compact?: boolean; label: string }>) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const wrap = box.current;
    if (!canvas || !wrap) return;
    const draw = () => {
      const width = wrap.clientWidth;
      if (!width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (bars.length < 2) return;

      const start = run?.startPrice ?? bars[0]!.o;
      const band = bandOf(draft, start);
      const levels = levelsOf(draft, start);
      const alert = draft.kind === 'priceAlert' ? start * (1 + draft.movePct / 100) : null;
      let lo = Infinity;
      let hi = -Infinity;
      for (const b of bars) {
        lo = Math.min(lo, b.l);
        hi = Math.max(hi, b.h);
      }
      for (const v of [band?.lower, band?.upper, alert, ...levels]) {
        if (v && Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
      const pad = (hi - lo) * 0.08 || hi * 0.02;
      lo -= pad;
      hi += pad;
      const right = compact ? 8 : 64;
      const top = 10;
      const bottom = height - 12;
      const t0 = bars[0]!.t;
      const t1 = bars[bars.length - 1]!.t;
      const x = (t: number) => 8 + ((t - t0) / Math.max(1, t1 - t0)) * (width - 8 - right);
      const y = (p: number) => top + (1 - (p - lo) / (hi - lo)) * (bottom - top);

      // The range.
      if (band) {
        const y1 = y(band.upper);
        const y2 = y(band.lower);
        const fill = ctx.createLinearGradient(0, y1, 0, y2);
        fill.addColorStop(0, 'rgba(153, 69, 255, 0.20)');
        fill.addColorStop(1, 'rgba(153, 69, 255, 0.07)');
        ctx.fillStyle = fill;
        ctx.fillRect(0, y1, width - right + 4, y2 - y1);
        ctx.strokeStyle = 'rgba(201, 162, 255, 0.7)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        for (const v of [y1, y2]) {
          ctx.beginPath();
          ctx.moveTo(0, Math.round(v) + 0.5);
          ctx.lineTo(width - right + 4, Math.round(v) + 0.5);
          ctx.stroke();
        }
      }
      // The levels.
      ctx.strokeStyle = 'rgba(238, 241, 255, 0.13)';
      ctx.setLineDash([3, 4]);
      for (const v of levels) {
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y(v)) + 0.5);
        ctx.lineTo(width - right + 4, Math.round(y(v)) + 0.5);
        ctx.stroke();
      }
      if (alert) {
        ctx.strokeStyle = 'rgba(255, 231, 194, 0.7)';
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y(alert)) + 0.5);
        ctx.lineTo(width - right + 4, Math.round(y(alert)) + 0.5);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // The price.
      const line = new Path2D();
      bars.forEach((b, i) => (i ? line.lineTo(x(b.t), y(b.c)) : line.moveTo(x(b.t), y(b.c))));
      const area = new Path2D(line);
      area.lineTo(x(t1), bottom);
      area.lineTo(x(t0), bottom);
      area.closePath();
      const shade = ctx.createLinearGradient(0, top, 0, bottom);
      shade.addColorStop(0, 'rgba(238, 241, 255, 0.10)');
      shade.addColorStop(1, 'rgba(238, 241, 255, 0)');
      ctx.fillStyle = shade;
      ctx.fill(area);
      ctx.strokeStyle = 'rgba(238, 241, 255, 0.92)';
      ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round';
      ctx.stroke(line);

      // The fills.
      for (const f of run?.fills ?? []) {
        if (f.note === 'setup') continue;
        const cx = x(Math.min(t1, Math.max(t0, f.t)));
        const cy = y(f.price);
        ctx.beginPath();
        ctx.arc(cx, cy, compact ? 3 : 4, 0, Math.PI * 2);
        ctx.fillStyle = f.side === 'buy' ? BOUGHT : PALETTE.mint;
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(11, 10, 20, 0.9)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      // The price now.
      const last = bars[bars.length - 1]!;
      ctx.beginPath();
      ctx.arc(x(last.t), y(last.c), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.ice;
      ctx.fill();

      if (!compact) {
        ctx.font = '600 11px var(--font-ui, system-ui), system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        const labels: { v: number; color: string }[] = [{ v: last.c, color: PALETTE.ice }];
        if (band) labels.push({ v: band.upper, color: BOUGHT }, { v: band.lower, color: BOUGHT });
        if (alert) labels.push({ v: alert, color: PALETTE.warmWhite });
        const used: number[] = [];
        for (const l of labels) {
          const ly = Math.max(top + 6, Math.min(bottom - 6, y(l.v)));
          if (used.some((u) => Math.abs(u - ly) < 14)) continue;
          used.push(ly);
          ctx.fillStyle = l.color;
          ctx.fillText(priceText(l.v, lang), width - right + 10, ly);
        }
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [bars, draft, run, lang, height, compact]);

  return (
    <div ref={box} style={{ position: 'relative', width: '100%', height }}>
      <canvas ref={ref} role="img" aria-label={label} />
    </div>
  );
}

/** A small line of a run's value against holding, for the hangar and the strategies. */
export function Spark({ run, width = 96, height = 32 }: Readonly<{ run: Run | null; width?: number; height?: number }>) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const points = run?.equity ?? [];
    if (points.length < 2) return;
    const values = points.map((p) => p.v);
    const lo = Math.min(...values, run!.startUsd);
    const hi = Math.max(...values, run!.startUsd);
    const span = hi - lo || 1;
    const x = (i: number) => 1 + (i / (points.length - 1)) * (width - 2);
    const y = (v: number) => 2 + (1 - (v - lo) / span) * (height - 4);
    ctx.strokeStyle = 'rgba(238, 241, 255, 0.18)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(0, y(run!.startUsd));
    ctx.lineTo(width, y(run!.startUsd));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = run!.pnlUsd >= 0 ? PALETTE.mint : PALETTE.flare;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.stroke();
  }, [run, width, height]);
  return <canvas ref={ref} style={{ width, height }} aria-hidden="true" />;
}
