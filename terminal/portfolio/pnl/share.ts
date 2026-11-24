import type { Lang } from '../../../city/lib/i18n/langs.ts';
import { bestSale, cardTrades } from './pnl-view.ts';

/**
 * «Share» on the Portfolio's result: a card of the person's best sale of the period, made by Ryntra's own
 * trade-card generator on the existing `/api/growth/cards` — the same card a trade makes. The generator finds the sale
 * in the wallet's own Ryntra record and recomputes every figure from it: the screen names a trade, never a number. The
 * record is the person's to show, so the wallet proves itself first — one signed message, no transaction. Only on the
 * person's own wallet; a wallet that is only looked at has nothing to share.
 */

export type ShareCard = Readonly<{
  /** The card's own page — its picture and the person's invitation. */
  page: string;
  image: string;
  text: string;
  alt: string;
  symbol: string;
}>;

export type ShareOutcome =
  | Readonly<{ ok: true; card: ShareCard }>
  /** The person closed the wallet or said no: nothing to say. */
  | Readonly<{ ok: false; code: 'DECLINED' }>
  /** No sale with a measured result in the period. */
  | Readonly<{ ok: false; code: 'NO_SALE' }>
  | Readonly<{ ok: false; code: 'UNAVAILABLE' }>;

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export type ShareDeps = Readonly<{
  /** The wallet's proof: one signed message, or nothing when it is already proved in this browser. */
  prove: () => Promise<Readonly<{ ok: true } | { ok: false; state: 'declined' | 'failed' }>>;
  fetch: (url: string, init?: Readonly<{ method?: string; headers?: Record<string, string>; body?: string }>) => Promise<Answer>;
}>;

async function body(answer: Answer): Promise<unknown> {
  try {
    return await answer.json();
  } catch {
    return null;
  }
}

/** The card of the best sale since `fromMs`, in the screen's language; dollar amounts stay off the card. */
export async function shareResult(args: Readonly<{ owner: string; fromMs: number; lang: Lang }>, deps: ShareDeps): Promise<ShareOutcome> {
  const proof = await deps.prove();
  if (!proof.ok) return proof.state === 'declined' ? { ok: false, code: 'DECLINED' } : { ok: false, code: 'UNAVAILABLE' };
  let list: Answer;
  try {
    list = await deps.fetch(`/api/growth/cards?${new URLSearchParams({ address: args.owner })}`, { headers: { accept: 'application/json' } });
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
  if (!list.ok) return { ok: false, code: 'UNAVAILABLE' };
  const sale = bestSale(cardTrades(await body(list)), args.fromMs);
  if (!sale) return { ok: false, code: 'NO_SALE' };
  let made: Answer;
  try {
    made = await deps.fetch('/api/growth/cards', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ address: args.owner, trade: sale.key, locale: args.lang, amounts: false }),
    });
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
  const answer = await body(made);
  const card = typeof answer === 'object' && answer !== null ? (answer as { card?: Record<string, unknown> }).card : undefined;
  if (!made.ok || !card || typeof card.url !== 'string' || typeof card.image !== 'string' || typeof card.text !== 'string') return { ok: false, code: 'UNAVAILABLE' };
  if (!/^https?:\/\//.test(card.url) || !/^https?:\/\//.test(card.image)) return { ok: false, code: 'UNAVAILABLE' };
  return { ok: true, card: { page: card.url, image: card.image, text: card.text, alt: typeof card.alt === 'string' ? card.alt : card.text, symbol: sale.symbol } };
}

/** The post on X: the card's own words and its page, which X shows with the card's picture. */
export function postUrl(card: Pick<ShareCard, 'text' | 'page'>): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(card.text)}&url=${encodeURIComponent(card.page)}`;
}
