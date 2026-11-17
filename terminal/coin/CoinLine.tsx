'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { timePath, type DayPoint } from '@/terminal/market/depth-view';
import { changeTone } from '@/terminal/ui';
import { COIN_DEPTH } from './depth-words';
import l from './line.module.css';

/** A period of the plain chart: the engine's candles of that size, and how far back the period reaches, seconds. */
export const PERIODS = {
  day: { tf: '15m', s: 86_400 },
  week: { tf: '1h', s: 7 * 86_400 },
  month: { tf: '4h', s: 30 * 86_400 },
  year: { tf: '1d', s: 365 * 86_400 },
} as const;
export type Period = keyof typeof PERIODS;

const W = 1000;
const H = 360;

type Read = Readonly<{ status: 'reading' | 'ready' | 'none'; closes: readonly DayPoint[] }>;

/** The closes of a period from the engine's candles (`/api/spot/candles`), the same read the candles chart draws. */
function usePeriod(mint: string, period: Period): Read {
  const [read, setRead] = useState<Read & { key: string }>({ key: '', status: 'reading', closes: [] });
  const key = `${mint}:${period}`;
  useEffect(() => {
    let live = true;
    const { tf, s } = PERIODS[period];
    fetch(`/api/spot/candles?mint=${encodeURIComponent(mint)}&tf=${tf}`, { headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? (res.json() as Promise<{ candles?: { time?: number; close?: number }[] }>) : null))
      .then((body) => {
        if (!live) return;
        // The period by time, not by count: a quiet coin's candles skip empty stretches.
        const from = Date.now() / 1000 - s;
        const closes = (body?.candles ?? [])
          .filter((c) => typeof c.time === 'number' && c.time >= from && typeof c.close === 'number' && Number.isFinite(c.close) && c.close > 0)
          .map((c) => ({ x: (c.time! - from) / s, price: c.close! }));
        setRead({ key, status: closes.length >= 2 ? 'ready' : 'none', closes });
      })
      .catch(() => live && setRead({ key, status: 'none', closes: [] }));
    return () => {
      live = false;
    };
  }, [mint, period, key]);
  return read.key === key ? read : { status: 'reading', closes: [] };
}

/** The price in a short form for the scale on the right. */
function scaleText(value: number, lang: 'en' | 'uk'): string {
  const places = value >= 100 ? 2 : value >= 1 ? 3 : Math.min(10, Math.max(4, -Math.floor(Math.log10(value)) + 3));
  return digits(value.toFixed(places), lang);
}

/**
 * The plain chart of direction A (macket `A-Coin`): one line of the engine's closes over a day, a week, a
 * month or a year, the area under it, four prices on the scale and the last one lit. The candles stay «Pro»'s
 * (`./CoinChart.tsx`). `aside` stands at the right of the periods (the «Pro» switch).
 */
export function CoinLine({ mint, aside }: { mint: string; aside?: ReactNode }) {
  const w = useWords(COIN_DEPTH);
  const lang = useLang();
  const [period, setPeriod] = useState<Period>('day');
  const read = usePeriod(mint, period);
  const fill = useId().replace(/:/g, '');
  const shape = useMemo(() => {
    if (read.status !== 'ready') return null;
    const prices = read.closes.map((p) => p.price);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const path = timePath(read.closes, W, H, 10);
    const lastPoint = read.closes[read.closes.length - 1]!;
    const last = lastPoint.price;
    const y = H - 10 - ((last - lo) / (hi - lo || 1)) * (H - 20);
    const ticks = [0, 1, 2, 3].map((i) => hi - ((hi - lo) * i) / 3);
    const first = read.closes[0]!;
    return { path, area: `${path} L${(10 + lastPoint.x * (W - 20)).toFixed(1)} ${H} L${(10 + first.x * (W - 20)).toFixed(1)} ${H} Z`, y, ticks, tone: changeTone(last - read.closes[0]!.price), x: 10 + lastPoint.x * (W - 20) };
  }, [read]);
  return (
    <div className={l.box}>
      <div className={l.head}>
        <div className={l.periods} role="radiogroup" aria-label={w.period}>
          {(Object.keys(PERIODS) as Period[]).map((id) => (
            <button key={id} type="button" role="radio" aria-checked={period === id} className={l.period} onClick={() => setPeriod(id)}>
              {w[id]}
            </button>
          ))}
        </div>
        <span className={l.grow} />
        {aside}
      </div>
      <div className={l.plot} aria-busy={read.status === 'reading'}>
        {shape ? (
          <>
            <svg className={l.svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" data-tone={shape.tone} role="img" aria-label={w.chart}>
              <defs>
                <linearGradient id={fill} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
                  <stop offset="1" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
              {shape.ticks.map((_, i) => (
                <line key={i} className={l.grid} x1="0" x2={W} y1={10 + (i * (H - 20)) / 3} y2={10 + (i * (H - 20)) / 3} />
              ))}
              <path d={shape.area} fill={`url(#${fill})`} />
              <path className={l.path} d={shape.path} vectorEffect="non-scaling-stroke" />
            </svg>
            <span className={l.dot} data-tone={shape.tone} style={{ top: `${(shape.y / H) * 100}%`, left: `calc((100% - 64px) * ${(shape.x / W).toFixed(4)})`, right: 'auto' }} />
            <span className={l.scale}>
              {shape.ticks.map((tick, i) => (
                <span key={i}>{scaleText(tick, lang)}</span>
              ))}
            </span>
          </>
        ) : read.status === 'none' ? (
          <p className={l.none}>{w.noChart}</p>
        ) : null}
      </div>
    </div>
  );
}
