'use client';

import { useState } from 'react';
import { digits } from '@/city/lib/i18n/dict';
import type { Tower } from '@/city/lib/market/types';

/** The coin's logo through our own proxy; a logo the proxy cannot bring leaves the plain disc, never a broken image. */
export function TokenIcon({ t, className }: { t: Tower; className: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!t.icon || failed === t.id) return <span className={className} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={`/api/icon/${t.id}`} alt="" onError={() => setFailed(t.id)} />;
}

export const sym = (t: Pick<Tower, 'symbol'>) => `$${t.symbol.replace(/^\$/, '')}`;

/* The figures are written the English way and handed to `digits`, which writes them in the language on screen. */

export function money(v: number) {
  if (v >= 1e9) return digits(`$${(v / 1e9).toFixed(2)}B`);
  if (v >= 1e6) return digits(`$${(v / 1e6).toFixed(1)}M`);
  if (v >= 1e3) return digits(`$${(v / 1e3).toFixed(0)}K`);
  return digits(`$${v.toFixed(0)}`);
}

export function compact(v: number) {
  if (v >= 1e6) return digits(`${(v / 1e6).toFixed(1)}M`);
  if (v >= 1e3) return digits(`${(v / 1e3).toFixed(1)}K`);
  return `${Math.round(v)}`;
}

export function formatPrice(p: number) {
  if (p >= 1000) return digits(`$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  if (p >= 1) return digits(`$${p.toFixed(2)}`);
  if (p >= 0.01) return digits(`$${p.toFixed(4)}`);
  const places = Math.max(2, -Math.floor(Math.log10(p)) + 2);
  return digits(`$${p.toFixed(Math.min(places, 10))}`);
}

/** A signed percentage with its window, as the city writes every move: «+4.2% 1H». */
export function signed(v: number) {
  return digits(`${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`);
}
