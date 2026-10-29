/**
 * The card for X after a trade, made by Ryntra's own trade-card generator. A card is a receipt, drawn: the generator
 * finds the trade in the wallet's own history and recomputes every figure from it, so the city names a trade, never a
 * number. A buy says what was paid; a sale says what it made or lost, drawn the same size either way. The person's
 * trades are theirs to show, so the generator asks for the wallet's proof first.
 */

import { coinLink } from '../share/coin-link.ts';

/**
 * `url` is the link a post carries: the coin's own page in the city (`/c/<mint>`), so a reader lands on that coin.
 * `page` is the generator's page of the card itself (`/r/<code>/c/<card>`), its picture and the invitation on it.
 */
export type TradeCardFace = Readonly<{ url: string; page: string; image: string; text: string; alt: string }>;

export type CardOutcome =
  | Readonly<{ ok: true; card: TradeCardFace }>
  /** The wallet has not proved itself to Ryntra in this browser yet. */
  | Readonly<{ ok: false; code: 'PROOF_REQUIRED' }>
  /** The trade is not in the wallet's history yet, or the generator cannot measure it. */
  | Readonly<{ ok: false; code: 'NOT_FOUND' }>
  | Readonly<{ ok: false; code: 'UNAVAILABLE' }>;

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type CardFetch = (url: string, init?: Readonly<{ method?: string; headers?: Record<string, string>; body?: string }>) => Promise<Answer>;

export type CardDeps = Readonly<{
  fetch: CardFetch;
  sleep: (ms: number) => Promise<void>;
  /** The history row of a fresh trade can lag its receipt by a few seconds. */
  delaysMs?: readonly number[];
}>;

export type CardRequest = Readonly<{ address: string; mint: string; signature: string; kind: 'BUY' | 'SELL' }>;

const LIST_DELAYS_MS = [1_500, 4_000, 8_000];

async function body(answer: Answer): Promise<Record<string, unknown>> {
  try {
    const value = await answer.json();
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The generator's key for this trade: the receipt is the swap's signature, and one swap can be a sale and a buy. */
async function findKey(request: CardRequest, deps: CardDeps): Promise<CardOutcome | string> {
  const delays = deps.delaysMs ?? LIST_DELAYS_MS;
  const query = new URLSearchParams({ address: request.address, mint: request.mint });
  for (let attempt = 0; ; attempt += 1) {
    let answer: Answer;
    try {
      answer = await deps.fetch(`/api/growth/cards?${query}`, { headers: { accept: 'application/json' } });
    } catch {
      return { ok: false, code: 'UNAVAILABLE' };
    }
    if (answer.status === 401) return { ok: false, code: 'PROOF_REQUIRED' };
    if (!answer.ok) return { ok: false, code: 'UNAVAILABLE' };
    const trades = (await body(answer)).trades;
    const keys = Array.isArray(trades) ? trades.map((trade) => (trade as { key?: unknown }).key).filter((key): key is string => typeof key === 'string') : [];
    const key = keys.find((k) => k === `${request.kind}:${request.signature}`) ?? keys.find((k) => k.endsWith(`:${request.signature}`));
    if (key) return key;
    if (attempt >= delays.length) return { ok: false, code: 'NOT_FOUND' };
    await deps.sleep(delays[attempt]!);
  }
}

export async function makeTradeCard(request: CardRequest, deps: CardDeps): Promise<CardOutcome> {
  const key = await findKey(request, deps);
  if (typeof key !== 'string') return key;
  let answer: Answer;
  try {
    answer = await deps.fetch('/api/growth/cards', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      // Dollar amounts stay off the card unless the person turns them on elsewhere.
      body: JSON.stringify({ address: request.address, trade: key, locale: 'en', amounts: false }),
    });
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
  if (answer.status === 401) return { ok: false, code: 'PROOF_REQUIRED' };
  if (answer.status === 404) return { ok: false, code: 'NOT_FOUND' };
  const card = (await body(answer)).card as Partial<TradeCardFace> | undefined;
  if (!answer.ok || !card || typeof card.url !== 'string' || typeof card.image !== 'string' || typeof card.text !== 'string') {
    return { ok: false, code: 'UNAVAILABLE' };
  }
  return { ok: true, card: { url: coinLink(request.mint), page: card.url, image: card.image, text: card.text, alt: typeof card.alt === 'string' ? card.alt : card.text } };
}

/** The post on X: the card's own words and the coin's link, which X shows with the coin's own card. */
export function postToXUrl(card: Pick<TradeCardFace, 'text' | 'url'>): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(card.text)}&url=${encodeURIComponent(card.url)}`;
}
