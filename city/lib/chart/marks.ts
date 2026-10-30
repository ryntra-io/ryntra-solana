import type { TokenMark } from '../../../lib/spot/token-page.ts';
import { digits, wordsNow } from '../i18n/dict.ts';
import type { ChartLayer, LayerMark } from './layers.ts';
import { CHART_MARKS } from './words.ts';

/**
 * The meme coin's own marks on its chart — the layer the core chart draws over the candles: the largest trades, the
 * creator's buys and sales with the share of the supply a sale moved, the day the coin left its launch curve for a
 * DEX, a deep fall in liquidity. The engine finds them (`/api/spot/token?part=overview`, the spot page's own read);
 * the city only names them in its words. A coin with nothing to mark has no marks; a read that failed has none either.
 */

const ONE_DP = (value: number) => (Math.abs(value) < 1 ? value.toFixed(2) : value.toFixed(1));

function share(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '';
  return digits(pct < 0.01 ? ' <0.01%' : ` ${ONE_DP(pct)}%`);
}

/** The engine's marks as the chart's «Market» layer, oldest first. */
export function marketMarks(marks: readonly TokenMark[]): LayerMark[] {
  const w = wordsNow(CHART_MARKS);
  const out: LayerMark[] = [];
  marks.forEach((mark, index) => {
    if (!Number.isFinite(mark.t) || mark.t <= 0) return;
    const id = `${index}:${mark.kind}:${mark.t}`;
    const at = mark.t * 1000;
    const trade = (side: 'buy' | 'sell', label: string): LayerMark => ({ id, kind: 'trade', t: at, side, label, own: false });
    const event = (label: string): LayerMark => ({ id, kind: 'event', t: at, side: null, label, own: false });
    if (mark.kind === 'big-buy') out.push(trade('buy', w.largeBuy));
    else if (mark.kind === 'big-sell') out.push(trade('sell', w.largeSale));
    else if (mark.kind === 'creator-buy') out.push(trade('buy', w.creatorBought));
    else if (mark.kind === 'creator-sell') out.push(trade('sell', w.creatorSold(share(mark.pct))));
    else if (mark.kind === 'dex') out.push(event(w.leftCurve));
    else if (mark.kind === 'liquidity-drop' && mark.pct !== null && Number.isFinite(mark.pct)) out.push(event(w.liquidityMove(`${mark.pct < 0 ? '−' : '+'}${Math.abs(Math.round(mark.pct))}%`)));
  });
  return out.sort((a, b) => a.t - b.t);
}

/** The chart's «Market» layer; none while the coin has no marks. */
export function marketLayer(mint: string, marks: readonly LayerMark[]): ChartLayer | null {
  return marks.length ? { id: 'market', label: wordsNow(CHART_MARKS).market, mint, marks } : null;
}

export type MarksRead = Readonly<{ kind: 'ready'; marks: readonly LayerMark[] } | { kind: 'failed' }>;

const KINDS = new Set<TokenMark['kind']>(['big-buy', 'big-sell', 'creator-buy', 'creator-sell', 'dex', 'liquidity-drop']);

/** One answer of the overview read. A coin the engine has nothing on (`none`) is a coin without marks, not a failure. */
export function readMarks(status: number, body: unknown): MarksRead {
  if (status < 200 || status >= 300 || !body || typeof body !== 'object') return { kind: 'failed' };
  const json = body as Record<string, unknown>;
  if (json.none) return { kind: 'ready', marks: [] };
  if (!Array.isArray(json.marks)) return { kind: 'failed' };
  const marks = json.marks.filter((mark): mark is TokenMark => {
    if (!mark || typeof mark !== 'object') return false;
    const { kind, t, pct } = mark as Record<string, unknown>;
    return KINDS.has(kind as TokenMark['kind']) && typeof t === 'number' && (pct === null || pct === undefined || typeof pct === 'number');
  });
  return { kind: 'ready', marks: marketMarks(marks.map((mark) => ({ ...mark, pct: mark.pct ?? null }))) };
}

/** Reads a coin's marks. Never throws. */
export async function fetchMarks(mint: string, fetch: (url: string) => Promise<Readonly<{ status: number; json: () => Promise<unknown> }>>): Promise<MarksRead> {
  try {
    const answer = await fetch(`/api/spot/token?${new URLSearchParams({ mint, part: 'overview' })}`);
    return readMarks(answer.status, await answer.json().catch(() => null));
  } catch {
    return { kind: 'failed' };
  }
}
