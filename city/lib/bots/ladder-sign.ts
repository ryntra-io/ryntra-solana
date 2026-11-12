import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { citySigner } from '../app-bridge/route.ts';
import { base58, DLMM_PROGRAM } from '../../../lib/solana/limits/model.ts';
import { costsRose, type LadderCosts } from '../../../lib/bots/ladder/costs.ts';
import { matchesRungs, type LadderCanDo } from '../../../lib/bots/ladder/decode.ts';
import { LADDER_CHAINS, type LadderNetwork } from '../../../lib/bots/ladder/network.ts';
import type { LadderLeg, LadderPool, LegPlan, Rung } from '../../../lib/bots/ladder/plan.ts';
import { housekeepingIssue, readLadderTransaction } from '../../../lib/bots/ladder/tx.ts';

/**
 * Placing and cancelling a ladder from the browser (B5, CITY-135; mainnet CITY-219) — loaded on the tap, never in the
 * city's first frame.
 *
 * Who signs what:
 * - **the person's wallet** signs every transaction, in one prompt, on the ladder's network (`solana:devnet` or
 *   `solana:mainnet`), through the city's one door to a signature (`app-bridge/route.ts`; the Ryntra app's wallet signs
 *   on mainnet only, so a devnet ladder in the app is refused and a mainnet one is signed there). Nothing here can sign
 *   for the person: the wallet's key never leaves the wallet, and a transaction whose first signature is not the
 *   wallet's own, real over the message, goes no further.
 * - **a placement's order account** — a fresh account that holds nothing and only has to agree to being opened —
 *   signs after the wallet, over the exact message the wallet signed. Its key is made here (`freshOrderKeys`), lives in
 *   this function's memory for the length of one tap and is dropped; only its public address is ever sent anywhere.
 *   It cannot move a token: it is not the fee payer, not the order's owner, and the order names the wallet as both.
 *
 * Before the wallet sees anything, the server's transactions are read here, from their own bytes, against the plan:
 * the wallet pays, exactly the wallet and the order account sign, one order per transaction in the listed pool, the
 * bins and amounts are the plan's (`checkUnsigned`). If the server's cost line is higher than the one on the screen,
 * the wallet is not asked: the new line is shown and one more tap goes on.
 *
 * Once everything is signed, the ladder is the window's before it is the relay's (CITY-231): `onSigned` hands over
 * every leg — its order account and its signature, read from the signed bytes — before the relay is asked. A relay
 * that answers with a timeout, a dropped connection or a closed tab cannot leave orders on the chain the window does
 * not know of: they are kept as `sent`, and the window's reading of the chain says which landed (`unsure`).
 */

export type SignMany = typeof citySigner.signTransactions;
export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type ReviewAnswer = Readonly<{
  network: LadderNetwork;
  pool: LadderPool;
  activePrice: number;
  plans: readonly LegPlan[];
  transactions: readonly Readonly<{ side: LegPlan['side']; wireBase64: string; limitOrder: string; rungs: readonly Rung[]; depositLamports: number | null }>[];
  costs: LadderCosts;
  canDo: readonly LadderCanDo[];
  /** Dollars the ladder places, and the network's cap (mainnet). */
  amountUsd?: number;
  maxUsd?: number | null;
}>;

export type RelayLegAnswer = Readonly<{ limitOrder: string; signature: string | null; state: 'confirmed' | 'sent' | 'failed'; reason: string | null }>;

/**
 * - `placed` — the relay sent the legs and said so;
 * - `unsure` — every leg was signed and handed to the relay, but its answer never came (a timeout, a dropped
 *   connection): the legs may be on the chain, so they stay `sent` and the chain's reading decides;
 * - `refused` / `unreachable` — stopped before anything was sent, the relay's answer included.
 */
export type PlaceResult =
  | Readonly<{ kind: 'placed'; review: ReviewAnswer; legs: readonly RelayLegAnswer[] }>
  | Readonly<{ kind: 'unsure'; review: ReviewAnswer; legs: readonly RelayLegAnswer[] }>
  | Readonly<{ kind: 'costsChanged'; costs: LadderCosts }>
  | Readonly<{ kind: 'walletNo'; reason: string }>
  | Readonly<{ kind: 'refused'; reason: string }>
  | Readonly<{ kind: 'unreachable' }>;

export type CancelResult =
  | Readonly<{ kind: 'cancelled'; legs: readonly RelayLegAnswer[] }>
  | Readonly<{ kind: 'unsure'; legs: readonly RelayLegAnswer[] }>
  | Readonly<{ kind: 'walletNo'; reason: string }>
  | Readonly<{ kind: 'refused'; reason: string }>
  | Readonly<{ kind: 'unreachable' }>;

/** A signed transaction's id: its first signature (the wallet's, the fee payer's), base58; null — not signed. */
export function signatureOfWire(wireBase64: string): string | null {
  try {
    const first = VersionedTransaction.deserialize(fromBase64(wireBase64)).signatures[0];
    return first && first.some((byte) => byte !== 0) ? base58(first) : null;
  } catch {
    return null;
  }
}

/** The signed legs as the window keeps them until the chain says otherwise: every one `sent`, with its signature. */
export function sentLegs(items: readonly Readonly<{ limitOrder: string; wireBase64: string }>[]): RelayLegAnswer[] {
  return items.map((item) => ({ limitOrder: item.limitOrder, signature: signatureOfWire(item.wireBase64), state: 'sent' as const, reason: null }));
}

/**
 * Whether a failed relay call certainly sent nothing: the route refused (4xx — the switch, the doors, the checks, the
 * judge), or it answered in its own words that the network could not be reached before the first send. A timeout, a
 * crash or no answer at all leaves it unknown.
 */
export const sentNothing = (failure: Readonly<{ status: number; ours: boolean; reason: string }>): boolean =>
  (failure.status >= 400 && failure.status < 500) || (failure.status === 503 && failure.ours && failure.reason === 'UNREACHABLE');

/** Order accounts the ladder may need: one per transaction, at most eight. */
export const ORDER_KEYS = 8;

/** Fresh keys for the order accounts, made in this browser; only `publicKey` ever leaves this module. */
export function freshOrderKeys(count = ORDER_KEYS): Keypair[] {
  return Array.from({ length: count }, () => Keypair.generate());
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

type Check = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

/**
 * The server's unsigned placement, read against what the person set: the pool, the side and the amount of each leg are
 * the window's; every transaction is one order of the wallet's in that pool, signed by exactly the wallet and one of
 * this tap's order accounts; its bins are a part of the server's plan, and the parts add up to the whole plan.
 */
export function checkUnsigned(review: ReviewAnswer, expect: Readonly<{ owner: string; pool: string; legs: readonly LadderLeg[]; network?: LadderNetwork }>, orderKeys: ReadonlySet<string>): Check {
  if (review.network !== (expect.network ?? 'devnet')) return { ok: false, reason: 'Another network.' };
  if (typeof review.maxUsd === 'number' && !(typeof review.amountUsd === 'number' && review.amountUsd <= review.maxUsd + 1e-9)) return { ok: false, reason: 'Over the limit.' };
  if (review.pool.pool !== expect.pool) return { ok: false, reason: 'Another pool.' };
  if (review.plans.length !== expect.legs.length) return { ok: false, reason: 'Another ladder.' };
  for (const leg of expect.legs) {
    const plan = review.plans.find((p) => p.side === leg.side);
    if (!plan || plan.totalRaw !== leg.amountRaw) return { ok: false, reason: 'Another amount.' };
  }
  if (review.transactions.length === 0 || review.transactions.length > orderKeys.size) return { ok: false, reason: 'Too many transactions.' };
  const placed = new Map<string, { count: number; total: bigint }>();
  for (const tx of review.transactions) {
    const plan = review.plans.find((p) => p.side === tx.side);
    if (!plan) return { ok: false, reason: 'A transaction outside the plan.' };
    if (!orderKeys.has(tx.limitOrder) || tx.limitOrder === expect.owner) return { ok: false, reason: 'An order account this tap did not make.' };
    const read = readLadderTransaction(tx.wireBase64);
    const order = read?.orders.length === 1 ? read.orders[0]! : null;
    if (!read || !order) return { ok: false, reason: 'Not one order.' };
    if (read.feePayer !== expect.owner) return { ok: false, reason: 'Someone else pays.' };
    if (read.signers.length !== 2 || read.signers[0] !== expect.owner || read.signers[1] !== tx.limitOrder) return { ok: false, reason: 'Unexpected signers.' };
    if (order.owner !== expect.owner || order.pool !== expect.pool || order.limitOrder !== tx.limitOrder) return { ok: false, reason: 'The order is not this wallet’s.' };
    if (read.programs.some((program) => program !== DLMM_PROGRAM)) return { ok: false, reason: 'A program outside the order.' };
    const around = housekeepingIssue(tx.wireBase64, expect.owner);
    if (around) return { ok: false, reason: around };
    if (!matchesRungs(order.data, plan.isAskSide, tx.rungs)) return { ok: false, reason: 'The bins are not the plan’s.' };
    const want = new Map(plan.rungs.map((rung) => [rung.binId, rung.amountRaw]));
    if (!tx.rungs.every((rung) => want.get(rung.binId) === rung.amountRaw)) return { ok: false, reason: 'The bins are not the plan’s.' };
    const have = placed.get(plan.side) ?? { count: 0, total: 0n };
    placed.set(plan.side, { count: have.count + tx.rungs.length, total: have.total + tx.rungs.reduce((sum, rung) => sum + BigInt(rung.amountRaw), 0n) });
  }
  for (const plan of review.plans) {
    const have = placed.get(plan.side);
    if (!have || have.count !== plan.rungs.length || have.total !== BigInt(plan.totalRaw)) return { ok: false, reason: 'Part of the plan is missing.' };
  }
  return { ok: true };
}

/**
 * The order account's own signature, added after the wallet's over the exact message the wallet signed. Refused unless
 * the wallet's signature is there and real, the wallet is the fee payer, and the key is the transaction's second and
 * last signer — never the wallet's place.
 */
export function addOrderSignature(signedWire: string, key: Keypair, owner: string): Readonly<{ ok: true; wireBase64: string }> | Readonly<{ ok: false; reason: string }> {
  let exact: VersionedTransaction;
  let legacy: Transaction;
  try {
    const bytes = fromBase64(signedWire);
    exact = VersionedTransaction.deserialize(bytes);
    legacy = Transaction.from(bytes);
  } catch {
    return { ok: false, reason: 'The wallet returned something unreadable.' };
  }
  if (exact.version !== 'legacy') return { ok: false, reason: 'Not the reviewed transaction.' };
  const signers = exact.message.staticAccountKeys.slice(0, exact.message.header.numRequiredSignatures).map((k) => k.toBase58());
  const mine = key.publicKey.toBase58();
  if (mine === owner || signers.length !== 2 || signers[0] !== owner || signers[1] !== mine) return { ok: false, reason: 'Unexpected signers.' };
  const walletSigned = exact.signatures[0]?.some((byte) => byte !== 0) ?? false;
  if (!walletSigned || !legacy.verifySignatures(false)) return { ok: false, reason: 'The wallet’s signature is missing.' };
  exact.sign([key]);
  return { ok: true, wireBase64: toBase64(exact.serialize()) };
}

type Posted<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; reason: string; status: number; ours: boolean }>;

async function post<T>(fetcher: Fetcher, url: string, body: unknown): Promise<Posted<T>> {
  try {
    const response = await fetcher(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const ours = Boolean(value && typeof value === 'object' && 'error' in value);
      const reason = ours ? String((value as { error?: { code?: string } }).error?.code ?? 'REFUSED') : 'REFUSED';
      return { ok: false, reason, status: response.status, ours };
    }
    return { ok: true, value: value as T };
  } catch {
    return { ok: false, reason: 'UNREACHABLE', status: 0, ours: false };
  }
}

/** A relay answer that is not a list of legs — a proxy's page, a cut body — is no answer: as unknown as none. */
const legsOf = (value: unknown): RelayLegAnswer[] | null =>
  value && typeof value === 'object' && Array.isArray((value as { legs?: unknown }).legs) ? ((value as { legs: RelayLegAnswer[] }).legs) : null;

/**
 * One tap: build, check, the wallet's one prompt, the order accounts' signatures, `onSigned` (the window keeps the
 * ladder), the relay. `shown` is the cost line the person saw; a higher one from the server stops before the wallet.
 */
export async function placeLadder(
  args: Readonly<{ wallet: string; owner: string; pool: string; legs: readonly LadderLeg[]; shown: LadderCosts | null; network?: LadderNetwork }>,
  deps: Readonly<{ fetch?: Fetcher; sign?: SignMany; keys?: () => Keypair[]; onSigned?: (review: ReviewAnswer, legs: readonly RelayLegAnswer[]) => void }> = {},
): Promise<PlaceResult> {
  const network = args.network ?? 'devnet';
  const fetcher = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const sign = deps.sign ?? citySigner.signTransactions;
  let keys: Keypair[] | null = (deps.keys ?? freshOrderKeys)();
  try {
    const byAddress = new Map(keys.map((key) => [key.publicKey.toBase58(), key]));
    const built = await post<ReviewAnswer>(fetcher, '/api/bots/ladder/review', { network, owner: args.owner, pool: args.pool, legs: args.legs, orderKeys: [...byAddress.keys()] });
    if (!built.ok) return built.status === 0 || built.status >= 500 ? { kind: 'unreachable' } : { kind: 'refused', reason: built.reason };
    const review = built.value;
    const checked = checkUnsigned(review, { owner: args.owner, pool: args.pool, legs: args.legs, network }, new Set(byAddress.keys()));
    if (!checked.ok) return { kind: 'refused', reason: checked.reason };
    if (!args.shown || costsRose(args.shown, review.costs)) return { kind: 'costsChanged', costs: review.costs };
    const signed = await sign({ wallet: args.wallet, address: args.owner, unsignedWireBase64: review.transactions.map((tx) => tx.wireBase64), chain: LADDER_CHAINS[network] });
    if (!signed.ok) return { kind: 'walletNo', reason: signed.reason };
    const items: { wireBase64: string; limitOrder: string }[] = [];
    for (const [index, tx] of review.transactions.entries()) {
      const wire = signed.signedWireBase64[index]!;
      /* What the wallet hands back must still be the reviewed order: same pool, owner, bins and amounts. */
      const again = readLadderTransaction(wire);
      const plan = review.plans.find((p) => p.side === tx.side)!;
      const order = again?.orders.length === 1 ? again.orders[0]! : null;
      if (!order || order.limitOrder !== tx.limitOrder || order.owner !== args.owner || !matchesRungs(order.data, plan.isAskSide, tx.rungs)) return { kind: 'refused', reason: 'The wallet changed the order.' };
      /* A wallet may add its own assertions and a budget under the ceiling; nothing that moves anything elsewhere. */
      if (again!.programs.some((program) => program !== DLMM_PROGRAM) || housekeepingIssue(wire, args.owner)) return { kind: 'refused', reason: 'The wallet changed the transaction.' };
      const key = byAddress.get(tx.limitOrder)!;
      const finished = addOrderSignature(wire, key, args.owner);
      if (!finished.ok) return { kind: 'refused', reason: finished.reason };
      items.push({ wireBase64: finished.wireBase64, limitOrder: tx.limitOrder });
    }
    keys = null;
    /* Kept before it is sent: whatever happens to the relay's answer, the window knows these orders. */
    const signedLegs = sentLegs(items);
    deps.onSigned?.(review, signedLegs);
    const sent = await post<{ legs: RelayLegAnswer[] }>(fetcher, '/api/bots/ladder/submit', { network, owner: args.owner, kind: 'place', items });
    if (!sent.ok) {
      if (sentNothing(sent)) return sent.status === 503 ? { kind: 'unreachable' } : { kind: 'refused', reason: sent.reason };
      return { kind: 'unsure', review, legs: signedLegs };
    }
    const legs = legsOf(sent.value);
    return legs ? { kind: 'placed', review, legs: withSignatures(legs, signedLegs) } : { kind: 'unsure', review, legs: signedLegs };
  } finally {
    /* The order accounts' keys end with the tap. */
    keys = null;
  }
}

/** The relay's word on each leg, with the signature from the signed bytes wherever the relay gave none. */
function withSignatures(answer: readonly RelayLegAnswer[], signed: readonly RelayLegAnswer[]): RelayLegAnswer[] {
  return signed.map((leg) => {
    const said = answer.find((item) => item.limitOrder === leg.limitOrder);
    return said ? { ...said, signature: said.signature ?? leg.signature } : leg;
  });
}

/** The cancellations, read before the wallet: only the wallet signs, it pays, and nothing but the pool program is called. */
export function checkCancel(items: readonly Readonly<{ limitOrder: string; wireBase64: string }>[], owner: string, orders: readonly string[]): Check {
  if (items.length !== orders.length) return { ok: false, reason: 'Another set of orders.' };
  for (const item of items) {
    if (!orders.includes(item.limitOrder)) return { ok: false, reason: 'An order not asked for.' };
    const read = readLadderTransaction(item.wireBase64);
    if (!read || read.feePayer !== owner || read.signers.length !== 1 || read.signers[0] !== owner) return { ok: false, reason: 'Unexpected signers.' };
    if (read.orders.length !== 0 || read.programs.some((program) => program !== DLMM_PROGRAM)) return { ok: false, reason: 'Not a cancellation.' };
    const around = housekeepingIssue(item.wireBase64, owner);
    if (around) return { ok: false, reason: around };
  }
  return { ok: true };
}

/** «Cancel orders»: every open bin cancelled and every account closed, the money and the rent back, in one prompt. */
export async function cancelLadderOrders(
  args: Readonly<{ wallet: string; owner: string; orders: readonly string[]; network?: LadderNetwork }>,
  deps: Readonly<{ fetch?: Fetcher; sign?: SignMany }> = {},
): Promise<CancelResult> {
  const network = args.network ?? 'devnet';
  const fetcher = deps.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const sign = deps.sign ?? citySigner.signTransactions;
  const built = await post<{ transactions: { limitOrder: string; wireBase64: string }[] }>(fetcher, '/api/bots/ladder/cancel', { network, owner: args.owner, orders: args.orders });
  if (!built.ok) return built.status === 0 || built.status >= 500 ? { kind: 'unreachable' } : { kind: 'refused', reason: built.reason };
  const items = built.value.transactions;
  const checked = checkCancel(items, args.owner, args.orders);
  if (!checked.ok) return { kind: 'refused', reason: checked.reason };
  const signed = await sign({ wallet: args.wallet, address: args.owner, unsignedWireBase64: items.map((item) => item.wireBase64), chain: LADDER_CHAINS[network] });
  if (!signed.ok) return { kind: 'walletNo', reason: signed.reason };
  const out = items.map((item, index) => ({ limitOrder: item.limitOrder, wireBase64: signed.signedWireBase64[index]! }));
  if (!out.every((item) => Transaction.from(fromBase64(item.wireBase64)).verifySignatures(true))) return { kind: 'refused', reason: 'The wallet’s signature is missing.' };
  const signedLegs = sentLegs(out);
  const sent = await post<{ legs: RelayLegAnswer[] }>(fetcher, '/api/bots/ladder/submit', { network, owner: args.owner, kind: 'cancel', items: out });
  if (!sent.ok) {
    if (sentNothing(sent)) return sent.status === 503 ? { kind: 'unreachable' } : { kind: 'refused', reason: sent.reason };
    return { kind: 'unsure', legs: signedLegs };
  }
  const legs = legsOf(sent.value);
  return legs ? { kind: 'cancelled', legs: withSignatures(legs, signedLegs) } : { kind: 'unsure', legs: signedLegs };
}
