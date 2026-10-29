/**
 * «Стеження за гаманцями» (SOL-R4) — the pure half: a wallet's trades read
 * from the chain's own record of each transaction, what they made or lost,
 * and the labels a wallet earns on a token.
 *
 * A trade is what the transaction's balances say happened to the wallet — the
 * token it got or gave, against SOL (native and wrapped), USDC or USDT — on any
 * venue: Pump.fun, Meteora, Raydium, Jupiter's routes, all alike. Nothing here
 * trusts a venue's or an indexer's label of the swap. A transaction the chain
 * refused is no trade; a transfer with nothing paid for it is no trade either.
 *
 * What a wallet made is counted at the average cost of what it bought within
 * the transactions read, in SOL — the unit memes trade in. A USDC or USDT leg
 * is turned into SOL at SOL's price now, and the figure says so. Units sold
 * that were bought before the read window have no known cost: they are left
 * out and the figure says it is partial — never a profit invented from a zero
 * cost. The network fee and a token account's rent (paid on opening, given
 * back on closing) are no price: they are taken out of the SOL leg, so a
 * claimed airdrop is no «buy for 0.002 SOL» and a closed account no «sale»;
 * a priority tip paid in the same transaction stays in it.
 *
 * Labels, by the same rules as a Ryntra launch's market
 * (`lib/core/venues/meteora-dbc/market.ts`, `walletLabels`):
 * - **creator** — the token's creator as Jupiter names it (`dev`);
 * - **sniper** — bought within `SNIPER_SECONDS` of the token's creation;
 * - **bundle** — bought in the creation's own block, or got tokens the
 *   creator's wallet paid for.
 * Unknown creation time or block — no wallet is called a sniper or a bundle on
 * a guess.
 *
 * Pure and client-safe: no clock unless given, no network.
 */

import { SNIPER_SECONDS } from "../core/venues/meteora-dbc/market.ts";

export const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const STABLES: ReadonlySet<string> = new Set([USDC_MINT, USDT_MINT]);
const LAMPORTS = 1_000_000_000;

export const WALLET_LABELS = ["creator", "sniper", "bundle"] as const;
export type WalletLabel = (typeof WALLET_LABELS)[number];

/** What a trade was paid in. */
export type TradeQuote = "SOL" | "USDC" | "USDT";

/** One trade of one token by the watched wallet. Amounts raw as strings (exact); the quote leg in its own units. */
export type WalletTrade = Readonly<{
  signature: string;
  slot: number;
  /** Unix seconds; null when the node did not say. */
  at: number | null;
  side: "buy" | "sell";
  mint: string;
  tokensRaw: string;
  decimals: number;
  /** The quote it was paid in, and how much; null for a token-for-token swap or tokens someone else paid for. */
  quote: TradeQuote | null;
  /** In the quote's units (SOL, or dollars), already scaled. Null with `quote`. */
  quoteAmount: number | null;
  /** The transaction's payer when it was not the wallet: tokens bought for this wallet by another. */
  paidBy: string | null;
  /**
   * The network's fee the wallet paid for this trade, SOL — the transaction's fee shared between its trades; 0 when
   * another paid it. Absent on trades read before the honest standard (DSC-2): estimated there, and said.
   */
  feeSol?: number;
}>;

/* The parts of a `jsonParsed` transaction this reads — the node's own shape, narrowed. */
type TokenBalance = Readonly<{ accountIndex: number; mint: string; owner?: string; uiTokenAmount: Readonly<{ amount: string; decimals: number }> }>;
type AccountKey = string | Readonly<{ pubkey: unknown; signer?: boolean }>;
export type ParsedTransactionLike = Readonly<{
  slot: number;
  blockTime?: number | null;
  meta: Readonly<{
    err: unknown;
    fee: number;
    preBalances: readonly number[];
    postBalances: readonly number[];
    preTokenBalances?: readonly TokenBalance[] | null;
    postTokenBalances?: readonly TokenBalance[] | null;
  }> | null;
  transaction: Readonly<{ signatures: readonly string[]; message: Readonly<{ accountKeys: readonly AccountKey[] }> }>;
}>;

function keyOf(key: AccountKey): string {
  if (typeof key === "string") return key;
  const pubkey = key.pubkey as { toBase58?: () => string } | string;
  return typeof pubkey === "string" ? pubkey : (pubkey?.toBase58?.() ?? String(pubkey));
}

function signerOf(key: AccountKey, index: number): boolean {
  return typeof key === "string" ? index === 0 : key.signer === true;
}

/** The wallet's change of each mint in the transaction, raw, with each mint's decimals. */
function tokenDeltas(meta: NonNullable<ParsedTransactionLike["meta"]>, wallet: string): Map<string, { raw: bigint; decimals: number }> {
  const out = new Map<string, { raw: bigint; decimals: number }>();
  const add = (row: TokenBalance, sign: 1n | -1n) => {
    if (row.owner !== wallet) return;
    const found = out.get(row.mint) ?? { raw: 0n, decimals: row.uiTokenAmount.decimals };
    found.raw += sign * BigInt(row.uiTokenAmount.amount || "0");
    out.set(row.mint, found);
  };
  for (const row of meta.preTokenBalances ?? []) add(row, -1n);
  for (const row of meta.postTokenBalances ?? []) add(row, 1n);
  for (const [mint, delta] of out) if (delta.raw === 0n) out.delete(mint);
  return out;
}

/** The SOL a payer gave in the transaction, lamports (positive when it paid). */
function paidLamports(meta: NonNullable<ParsedTransactionLike["meta"]>, index: number): number {
  return (meta.preBalances[index] ?? 0) - (meta.postBalances[index] ?? 0);
}

/** Below this a SOL leg is dust — what is left of a fee or a rent, never a price. */
const DUST_LAMPORTS = 10_000;
/** What another wallet must have spent beyond fees and rent for tokens it sent here to be its purchase. */
const PAID_FOR_LAMPORTS = 1_000_000;

/**
 * Rent of token accounts opened and closed in the transaction, lamports: opened — the account's lamports after (less
 * the wrapped SOL it holds); closed — its lamports before. `owner` narrows to one wallet's accounts.
 */
function rentMoved(meta: NonNullable<ParsedTransactionLike["meta"]>, owner?: string): { opened: number; closed: number } {
  const pre = new Map((meta.preTokenBalances ?? []).map((row) => [row.accountIndex, row]));
  const post = new Map((meta.postTokenBalances ?? []).map((row) => [row.accountIndex, row]));
  const held = (row: TokenBalance) => (row.mint === WRAPPED_SOL ? Number(row.uiTokenAmount.amount || "0") : 0);
  let opened = 0;
  let closed = 0;
  for (const [index, row] of post) if (!pre.has(index) && (owner === undefined || row.owner === owner)) opened += Math.max(0, (meta.postBalances[index] ?? 0) - held(row));
  for (const [index, row] of pre) if (!post.has(index) && (owner === undefined || row.owner === owner)) closed += Math.max(0, (meta.preBalances[index] ?? 0) - held(row));
  return { opened, closed };
}

/**
 * The wallet's trades in one transaction: one per token it bought or sold for a quote, or got by another's payment.
 * Empty for a refused transaction, a transfer, a SOL-for-dollar swap (no token of interest) and anything unread.
 */
export function tradesOfTransaction(tx: ParsedTransactionLike | null, wallet: string): WalletTrade[] {
  if (!tx || !tx.meta || tx.meta.err) return [];
  const meta = tx.meta;
  const keys = tx.transaction.message.accountKeys;
  const signature = tx.transaction.signatures[0];
  if (!signature) return [];
  const walletIndex = keys.findIndex((key) => keyOf(key) === wallet);
  const signed = walletIndex >= 0 && signerOf(keys[walletIndex]!, walletIndex);
  const deltas = tokenDeltas(meta, wallet);
  /* SOL is SOL, native or wrapped: a route that wraps and unwraps in one transaction leaves only the native change. */
  const wrapped = deltas.get(WRAPPED_SOL)?.raw ?? 0n;
  deltas.delete(WRAPPED_SOL);
  /* The SOL leg without the fee (when the wallet paid it) and the rent of its accounts opened or closed: a price only. */
  const rent = rentMoved(meta, wallet);
  const lamports =
    (walletIndex >= 0 ? (meta.postBalances[walletIndex] ?? 0) - (meta.preBalances[walletIndex] ?? 0) : 0) +
    Number(wrapped) +
    (walletIndex === 0 ? meta.fee : 0) +
    rent.opened -
    rent.closed;
  const stable = [...deltas.entries()].filter(([mint]) => STABLES.has(mint));
  for (const [mint] of stable) deltas.delete(mint);
  const tokens = [...deltas.entries()];
  if (tokens.length === 0) return [];
  /* The fee is the payer's: the wallet's own when it paid it (shared between the trades it made in one transaction). */
  const share = (count: number) => (walletIndex === 0 && count > 0 ? meta.fee / LAMPORTS / count : 0);
  const base = { signature, slot: tx.slot, at: tx.blockTime ?? null } as const;

  if (!signed) {
    /* Tokens another wallet bought and sent here in the purchase itself: the payer is named — the bundle's mark. A
       transfer or an airdrop, whose sender paid only fees and the accounts' rent, is neither a purchase nor news. */
    const payer = keys[0] ? keyOf(keys[0]) : null;
    if (!payer || payer === wallet) return [];
    const spent = paidLamports(meta, 0) - meta.fee - rentMoved(meta).opened;
    if (spent < PAID_FOR_LAMPORTS) return [];
    return tokens
      .filter(([, delta]) => delta.raw > 0n)
      .map(([mint, delta]) => ({ ...base, side: "buy" as const, mint, tokensRaw: delta.raw.toString(), decimals: delta.decimals, quote: null, quoteAmount: null, paidBy: payer, feeSol: 0 }));
  }

  if (tokens.length === 1) {
    const [mint, delta] = tokens[0]!;
    const side = delta.raw > 0n ? "buy" : "sell";
    const against = stable.find(([, leg]) => (leg.raw > 0n) !== (delta.raw > 0n));
    if (against) {
      const quote = against[0] === USDC_MINT ? "USDC" : "USDT";
      return [{ ...base, side, mint, tokensRaw: abs(delta.raw).toString(), decimals: delta.decimals, quote, quoteAmount: Number(abs(against[1].raw)) / 10 ** against[1].decimals, paidBy: null, feeSol: share(1) }];
    }
    /* Against SOL: what the wallet gave or got, its tip with it; dust left of a fee or rent is no price. */
    if (Math.abs(lamports) >= DUST_LAMPORTS && (lamports > 0) !== (delta.raw > 0n)) {
      return [{ ...base, side, mint, tokensRaw: abs(delta.raw).toString(), decimals: delta.decimals, quote: "SOL", quoteAmount: Math.abs(lamports) / LAMPORTS, paidBy: null, feeSol: share(1) }];
    }
    return [];
  }

  /* Token for token: both legs are trades, neither has a price the chain states. */
  const gave = tokens.filter(([, delta]) => delta.raw < 0n);
  const got = tokens.filter(([, delta]) => delta.raw > 0n);
  if (gave.length === 0 || got.length === 0) return [];
  return tokens.map(([mint, delta]) => ({ ...base, side: delta.raw > 0n ? ("buy" as const) : ("sell" as const), mint, tokensRaw: abs(delta.raw).toString(), decimals: delta.decimals, quote: null, quoteAmount: null, paidBy: null, feeSol: share(tokens.length) }));
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/* ------------------------------------------------------------------ PnL */

/** A token's price now, in dollars, and SOL's — the only figures not from the chain. */
export type PricesNow = Readonly<{ solUsd: number | null; usd: ReadonlyMap<string, number> }>;

export type TokenPnl = Readonly<{
  mint: string;
  decimals: number;
  buys: number;
  sells: number;
  /** Tokens bought and sold within the window, in whole tokens. */
  bought: number;
  sold: number;
  /** What the wallet paid and got, SOL; null when no leg had a price. */
  spentSol: number | null;
  receivedSol: number | null;
  /** Bought within the window and not yet sold, whole tokens — at the average cost `costSol`. */
  open: number;
  costSol: number | null;
  /** Made or lost on what was sold, SOL, at the average cost; null when nothing sold had a known cost. */
  realizedSol: number | null;
  /** On what is still held of what was bought here, at the token's price now; null without a price. */
  unrealizedSol: number | null;
  /** Some units sold had no known cost (bought before the read, or a token-for-token leg): left out. */
  partial: boolean;
  /** A dollar leg was turned into SOL at SOL's price now. */
  approx: boolean;
  firstAt: number | null;
  lastAt: number | null;
  labels: readonly WalletLabel[];
}>;

export type WalletPnl = Readonly<{
  tokens: readonly TokenPnl[];
  realizedSol: number | null;
  unrealizedSol: number | null;
  /** Of the tokens with a closed trade: how many closed above their cost. */
  wins: number;
  losses: number;
  partial: boolean;
  approx: boolean;
}>;

/** A trade's quote leg in SOL: SOL as it is, dollars at SOL's price now (null without it). */
function legSol(trade: WalletTrade, solUsd: number | null): { sol: number | null; approx: boolean } {
  if (trade.quote === null || trade.quoteAmount === null) return { sol: null, approx: false };
  if (trade.quote === "SOL") return { sol: trade.quoteAmount, approx: false };
  return solUsd && solUsd > 0 ? { sol: trade.quoteAmount / solUsd, approx: true } : { sol: null, approx: false };
}

/**
 * The wallet's result per token and in all, oldest trade first: average cost, a sale against it, what is left at the
 * price now. `labels` — the labels each mint earned (`labelsOf`); `held` — what the wallet held when its accounts were
 * last read: a mint absent from it held 0, a mint mapped to null not known (traded since that read).
 */
export function walletPnl(
  trades: readonly WalletTrade[],
  prices: PricesNow,
  labels: ReadonlyMap<string, readonly WalletLabel[]> = new Map(),
  held?: ReadonlyMap<string, number | null>,
): WalletPnl {
  const ordered = [...trades].sort((a, b) => a.slot - b.slot);
  const byMint = new Map<string, WalletTrade[]>();
  for (const trade of ordered) byMint.set(trade.mint, [...(byMint.get(trade.mint) ?? []), trade]);
  const tokens: TokenPnl[] = [];
  for (const [mint, list] of byMint) {
    const decimals = list[0]!.decimals;
    let open = 0;
    let cost = 0;
    let costKnown = true;
    let realized: number | null = null;
    let spent: number | null = null;
    let received: number | null = null;
    let bought = 0;
    let sold = 0;
    let partial = false;
    let approx = false;
    for (const trade of list) {
      const amount = Number(trade.tokensRaw) / 10 ** trade.decimals;
      const leg = legSol(trade, prices.solUsd);
      approx ||= leg.approx;
      if (trade.side === "buy") {
        bought += amount;
        if (leg.sol === null) {
          /* No price for these units: what they cost is not known, so neither is any sale of them. */
          costKnown = false;
          partial = true;
          open += amount;
          continue;
        }
        spent = (spent ?? 0) + leg.sol;
        open += amount;
        cost += leg.sol;
        continue;
      }
      sold += amount;
      if (leg.sol !== null) received = (received ?? 0) + leg.sol;
      const covered = Math.min(amount, open);
      if (covered < amount) partial = true;
      if (covered > 0 && costKnown && leg.sol !== null && open > 0) {
        const average = cost / open;
        realized = (realized ?? 0) + leg.sol * (covered / amount) - average * covered;
        cost -= average * covered;
      } else if (covered > 0) {
        partial = true;
        if (open > 0) cost -= (cost / open) * covered;
      }
      open -= covered;
    }
    const usd = prices.usd.get(mint);
    const priceSol = usd !== undefined && prices.solUsd && prices.solUsd > 0 ? usd / prices.solUsd : null;
    /* Sent away since without a sale: only what the wallet still holds is open — at its share of the cost. */
    const read = held?.get(mint);
    const heldNow = !held || read === null ? undefined : (read ?? 0);
    if (heldNow !== undefined && heldNow < open) {
      cost = open > 0 ? cost * (heldNow / open) : 0;
      open = heldNow;
    }
    const openNow = open > 1e-12 ? open : 0;
    const unrealized = openNow > 0 && costKnown && priceSol !== null ? openNow * priceSol - cost : null;
    tokens.push({
      mint,
      decimals,
      buys: list.filter((trade) => trade.side === "buy").length,
      sells: list.filter((trade) => trade.side === "sell").length,
      bought,
      sold,
      spentSol: spent,
      receivedSol: received,
      open: openNow,
      costSol: openNow > 0 && costKnown ? cost : null,
      realizedSol: realized,
      unrealizedSol: unrealized,
      partial,
      approx,
      firstAt: list.find((trade) => trade.at !== null)?.at ?? null,
      lastAt: [...list].reverse().find((trade) => trade.at !== null)?.at ?? null,
      labels: labels.get(mint) ?? [],
    });
  }
  tokens.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
  const sum = (pick: (row: TokenPnl) => number | null) => {
    const known = tokens.map(pick).filter((value): value is number => value !== null);
    return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
  };
  return {
    tokens,
    realizedSol: sum((row) => row.realizedSol),
    unrealizedSol: sum((row) => row.unrealizedSol),
    wins: tokens.filter((row) => row.realizedSol !== null && row.realizedSol > 0).length,
    losses: tokens.filter((row) => row.realizedSol !== null && row.realizedSol < 0).length,
    partial: tokens.some((row) => row.partial),
    approx: tokens.some((row) => row.approx),
  };
}

/* --------------------------------------------------------------- labels */

/** What is known of a token's birth: its creator, its creation time (unix seconds) and its creation's block. */
export type TokenBirth = Readonly<{ creator: string | null; createdAt: number | null; createdSlot: number | null }>;

/** The first buy of each mint the wallet made within the window, oldest first: a sniper's or a bundle's moment. */
export function firstBuys(trades: readonly WalletTrade[]): Map<string, WalletTrade> {
  const out = new Map<string, WalletTrade>();
  for (const trade of [...trades].sort((a, b) => a.slot - b.slot)) if (trade.side === "buy" && !out.has(trade.mint)) out.set(trade.mint, trade);
  return out;
}

/** Whether a first buy is early enough that the creation's block is worth reading — a sniper's window. */
export function boughtEarly(buy: WalletTrade, birth: TokenBirth): boolean {
  return buy.at !== null && birth.createdAt !== null && buy.at - birth.createdAt < SNIPER_SECONDS && buy.at >= birth.createdAt - 60;
}

/** The labels the wallet earned on each mint it traded. */
export function labelsOf(wallet: string, trades: readonly WalletTrade[], births: ReadonlyMap<string, TokenBirth>): Map<string, WalletLabel[]> {
  const out = new Map<string, WalletLabel[]>();
  const add = (mint: string, label: WalletLabel) => {
    const list = out.get(mint) ?? [];
    if (!list.includes(label)) list.push(label);
    out.set(mint, list);
  };
  const mints = new Set(trades.map((trade) => trade.mint));
  for (const mint of mints) {
    const birth = births.get(mint);
    if (birth?.creator === wallet) add(mint, "creator");
  }
  for (const trade of trades) {
    if (trade.side !== "buy") continue;
    const birth = births.get(trade.mint);
    if (!birth || birth.creator === wallet) continue;
    /* Tokens the creator paid for, delivered here: the creator's second wallet. */
    if (birth.creator !== null && trade.paidBy === birth.creator) add(trade.mint, "bundle");
  }
  for (const [mint, buy] of firstBuys(trades)) {
    const birth = births.get(mint);
    if (!birth || birth.creator === wallet) continue;
    if (birth.createdSlot !== null && buy.slot === birth.createdSlot) add(mint, "bundle");
    else if (boughtEarly(buy, birth)) add(mint, "sniper");
  }
  return out;
}

/** The wallet's labels across tokens, with how many tokens earned each — «Творець ×2 · Снайпер ×5». */
export function walletBadges(labels: ReadonlyMap<string, readonly WalletLabel[]>): Readonly<Record<WalletLabel, number>> {
  const out: Record<WalletLabel, number> = { creator: 0, sniper: 0, bundle: 0 };
  for (const list of labels.values()) for (const label of list) out[label] += 1;
  return out;
}
