/**
 * A grid's four actions, over the lane of DLMM Pro limit orders (`lib/pro-limits/`, routes `/api/v1/ladders/*`):
 *
 * - **place** — the buys under the price and the sells over it: two Reviews, signed in one approval of the wallet;
 * - **take** — what filled, of every order of the grid with a filled price: a Review each, one approval;
 * - **again** — what was taken, placed again on the grid's empty levels on the other side of the price;
 * - **stop** — every order of the grid closed: what rests, what filled and each order's rent back to the wallet.
 *
 * The lane builds, the wallet signs, the relay sends only the bytes its Review showed. Nothing here builds, signs or
 * sends a transaction: the engine and the signer are arguments — the routes and the wallet in a browser, the lane's own
 * functions and a test key in the rehearsal.
 *
 * Why «take» and «again» are two approvals and not one: a Review checks that the wallet holds what it places, and what
 * a filled order paid is in the order, not the wallet, until it is taken.
 */

import type { ProMarket, ProOrder, ProRelay, ProReview } from '../pro-limits/service.ts';

import type { GridIntent } from './plan.ts';

export type GridFailure = Readonly<{ code: string; message: string }>;
export type GridResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; failure: GridFailure }>;

export type GridAsk =
  | Readonly<{ action: 'place'; owner: string; mint: string; intent: GridIntent; agent: false }>
  | Readonly<{ action: 'collect' | 'close'; owner: string; pool: string; nftMint: string }>;

export type GridEngine = Readonly<{
  market: (mint: string) => Promise<GridResult<ProMarket | null>>;
  review: (ask: GridAsk) => Promise<GridResult<ProReview>>;
  submit: (ticket: string, signed: readonly string[]) => Promise<GridResult<ProRelay>>;
  orders: (owner: string, mint: string | null) => Promise<GridResult<readonly ProOrder[]>>;
}>;

/** The wallet's one approval: the signed bytes in the same order, or null where it declined. */
export type GridSign = (unsigned: readonly string[]) => Promise<readonly string[] | null>;

export type Landed = Readonly<{ ask: GridAsk; review: ProReview; relay: ProRelay }>;
/** `unsure` — sent, and the chain's word not in: the order may stand; the grid keeps it and the next read says. */
export type Approved = Readonly<{ landed: readonly Landed[]; unsure: readonly Landed[]; failure: GridFailure | null }>;

/** The step a grid's action is at, for the screen. */
export type GridPhase = 'reviewing' | 'wallet' | 'sending';

/**
 * Reviews of several actions, signed in one approval, sent in order. A Review that fails stops everything before the
 * wallet is asked; a relay that fails stops the ones after it — what landed before it is told as landed.
 */
export async function approveAll(engine: GridEngine, sign: GridSign, asks: readonly GridAsk[], onPhase: (phase: GridPhase) => void = () => {}, check: (reviews: readonly ProReview[], asks: readonly GridAsk[]) => string | null = () => null): Promise<Approved> {
  if (!asks.length) return { landed: [], unsure: [], failure: { code: 'NOTHING', message: '' } };
  onPhase('reviewing');
  const reviews: ProReview[] = [];
  for (const ask of asks) {
    const review = await engine.review(ask);
    if (!review.ok) return { landed: [], unsure: [], failure: review.failure };
    reviews.push(review.value);
  }
  /* What the Reviews built is held to what the screen drew before the wallet is asked. */
  const refused = check(reviews, asks);
  if (refused) return { landed: [], unsure: [], failure: { code: refused, message: '' } };
  onPhase('wallet');
  const unsigned = reviews.flatMap((review) => review.transactions);
  const signed = await sign(unsigned);
  if (!signed || signed.length !== unsigned.length) return { landed: [], unsure: [], failure: { code: 'WALLET_DECLINED', message: '' } };
  onPhase('sending');
  const landed: Landed[] = [];
  let at = 0;
  for (const [index, review] of reviews.entries()) {
    const mine = signed.slice(at, at + review.transactions.length);
    at += review.transactions.length;
    const relay = await engine.submit(review.ticket, mine);
    if (!relay.ok) return { landed, unsure: [], failure: relay.failure };
    /* The first transaction is the action itself; one after it only opens the person's own accounts. */
    const first = relay.value.results[0]?.state;
    if (first === 'UNKNOWN') return { landed, unsure: [{ ask: asks[index]!, review, relay: relay.value }], failure: { code: 'UNKNOWN', message: '' } };
    if (first !== 'LANDED') return { landed, unsure: [], failure: { code: 'PRO_LIMIT_SUBMIT_FAILED', message: '' } };
    landed.push({ ask: asks[index]!, review, relay: relay.value });
  }
  return { landed, unsure: [], failure: null };
}

/** The asks that place a grid's ladders: the buys first, then the sells. */
export function placeAsks(owner: string, mint: string, intents: Readonly<{ buy: GridIntent | null; sell: GridIntent | null }>): GridAsk[] {
  return [intents.buy, intents.sell].filter((intent): intent is GridIntent => intent !== null).map((intent) => ({ action: 'place', owner, mint, intent, agent: false }));
}

/** The asks that take what filled: one for each of the grid's orders with a filled price. */
export function takeAsks(owner: string, live: readonly ProOrder[]): GridAsk[] {
  return live.filter((order) => order.filledPrices > 0).map((order) => ({ action: 'collect', owner, pool: order.pool, nftMint: order.nftMint }));
}

/** The asks that stop a grid: every order of it the chain holds, closed. */
export function stopAsks(owner: string, live: readonly ProOrder[]): GridAsk[] {
  return live.map((order) => ({ action: 'close', owner, pool: order.pool, nftMint: order.nftMint }));
}

/** The orders a placing approval left resting: the order's address, its side, and what it rests. */
export function placedOf(approved: Approved): readonly Readonly<{ nftMint: string; action: 'buy' | 'sell'; restsRaw: string }>[] {
  return [...approved.landed, ...approved.unsure].flatMap(({ ask, review, relay }) => (ask.action === 'place' ? [{ nftMint: relay.nftMint, action: ask.intent.action, restsRaw: review.quote?.amountRaw ?? ask.intent.amountRaw }] : []));
}

/** What a placing approval tells before the signature, summed: the network's fee, the orders' rent that comes back. */
export function costOf(reviews: readonly ProReview[]): Readonly<{ feeLamports: bigint; rentLamports: bigint }> {
  return reviews.reduce((sum, review) => ({ feeLamports: sum.feeLamports + BigInt(review.networkFeeLamports), rentLamports: sum.rentLamports + BigInt(review.rentLamports) + BigInt(review.accountsLamports) }), { feeLamports: 0n, rentLamports: 0n });
}
