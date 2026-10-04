/**
 * One projection of every operation started through Ryntra — the product's
 * own truth, read from the operation ledger and shown twice with different
 * disclosure: masked on the public statistics, whole on the admin.
 *
 * Pure and client-safe: no clock it does not receive, no store, no
 * `process.env`. The ledger row (`solanaWalletActions`) is the source; this
 * module names each row as a person would — *Swap USDC → SOL*, *Buy NVDAx*,
 * *Base → Solana* — values it on one rule, states its fee and its
 * verification against the chain, and adds the explorer link that proves it.
 * Nothing here is a second bookkeeping: a figure that disagrees with the
 * ledger is a bug in this file, not a second truth.
 *
 * ## What counts
 *
 * Only a confirmed execution counts (`outcome: DONE`). A quote, a Review, a
 * row still in flight or a failed attempt is shown to the admin with its
 * status and is never volume. Send and Receive are transfers, not trading
 * operations, and are not projected here at all.
 *
 * ## Value
 *
 * Executed value is the stablecoin leg at par where one exists — the same
 * rule the admin dashboard and Points use — and otherwise the provider's
 * own dollar figure for that exact fill, recorded at settlement; never a
 * price read later. A row with neither stays unvalued and is counted anyway.
 *
 * ## Verification
 *
 * The chain read is the second witness, never the count: a confirmed Jupiter
 * operation is *verified* when the chain read attributes its signature,
 * *pending* until the read catches up, and *not attributable* when the row
 * itself says no fee reached the referral accounts — with the reason the
 * provider gave. Bridge operations are attributed from the provider's record
 * and carry no on-chain marker by construction.
 */

import type { ActionFeeState, SolanaActionOutcome, SolanaWalletAction } from "../solana/action-ledger.ts";
import type { SolanaActionLane } from "../solana/action-lanes.ts";
import { executedUsd, type ExecutedUsdBasis } from "../solana/action-value.ts";
import { EVM_EXPLORER_TX, type SwapNetwork } from "../swap/catalog.ts";

export type OperationProduct = "SWAP" | "SPOT" | "STOCK" | "BRIDGE";
export const OPERATION_PRODUCTS: readonly OperationProduct[] = ["SWAP", "SPOT", "STOCK", "BRIDGE"];
export type OperationProvider = "JUPITER" | "RELAY" | "MAYAN" | "CIRCLE";
export type OperationStatus = "CONFIRMED" | "IN_FLIGHT" | "NEEDS_YOU" | "FAILED";
export type OperationVerification = "VERIFIED" | "PENDING" | "NOT_ATTRIBUTABLE" | "NOT_APPLICABLE";

export type OperationLeg = Readonly<{
  mint: string | null;
  symbol: string | null;
  decimals: number | null;
  amountRaw: string;
  /** Decimal text in the asset's own units when its scale is known; null otherwise. */
  amount: string | null;
}>;

export type OperationFee = Readonly<{
  collected: boolean;
  state: ActionFeeState | null;
  /** The provider's stated reason when no fee was taken; null when it was. */
  note: string | null;
  asset: string | null;
  symbol: string | null;
  decimals: number | null;
  basisPoints: number | null;
  grossRaw: string | null;
  gross: string | null;
  ryntraRaw: string | null;
  ryntra: string | null;
  providerRaw: string | null;
  usd: number | null;
}>;

export type OperationLink = Readonly<{ label: "Solscan" | "Source" | "Destination"; url: string; ref: string }>;

export type OperationRecord = Readonly<{
  /** The canonical operation identity: the lane and the ledger's action id. */
  id: string;
  lane: SolanaActionLane;
  product: OperationProduct;
  provider: OperationProvider;
  side: "BUY" | "SELL" | null;
  /** What the person did, in words: `USDC → SOL`, `Buy NVDAx`, `Base → Solana`. */
  action: string;
  /** The traded asset for Spot and stock operations; null for a swap and a bridge. */
  asset: string | null;
  wallet: string;
  /** Marked in the admin as one of Ryntra's own wallets. Counted in, named as such. */
  internal: boolean;
  status: OperationStatus;
  out: OperationLeg | null;
  in: OperationLeg | null;
  usd: number | null;
  usdBasis: ExecutedUsdBasis | null;
  fee: OperationFee | null;
  startedAt: string;
  /** The row's last write when it is confirmed; null before that. */
  confirmedAt: string | null;
  signature: string | null;
  sourceTx: string | null;
  destinationTx: string | null;
  links: readonly OperationLink[];
  providerRef: string | null;
  receiptHash: string | null;
  plan: Readonly<{ planId: string; version: number; reviewId: string }> | null;
  verification: OperationVerification;
  verificationNote: string | null;
}>;

/** A cross-chain order as the order book records it, keyed by intent digest. */
export type CrossSwapOrderRef = Readonly<{
  provider: "RELAY" | "MAYAN";
  sourceChain: SwapNetwork;
  destinationChain: SwapNetwork;
  sourceTxHash: string | null;
  destinationTxHash: string | null;
}>;

/** A Circle burn claim as the lane records it, keyed by intent digest: the direction and the two transactions. */
export type CctpBurnRef = Readonly<{
  direction: "SOLANA_TO_BASE" | "BASE_TO_SOLANA" | "SOLANA_TO_ETHEREUM" | "ETHEREUM_TO_SOLANA";
  burnTx: string | null;
  mintTx: string | null;
}>;

/** One attributed operation from the chain read, by signature. */
export type ChainAttribution = Readonly<{
  readAt: string;
  complete: boolean;
  signatures: ReadonlySet<string>;
}>;

export type MintNames = Readonly<Record<string, Readonly<{ symbol: string; decimals: number | null }>>>;

export type OperationSource = Readonly<{
  actions: readonly SolanaWalletAction[];
  orders: ReadonlyMap<string, CrossSwapOrderRef>;
  /** Circle burn claims by intent digest; a row written before the lane recorded its legs still names its direction and proofs from here. */
  burns?: ReadonlyMap<string, CctpBurnRef>;
  /** Mints of Ryntra's verified stock universe; null when it could not be read. */
  stockMints: ReadonlySet<string> | null;
  internalWallets: ReadonlySet<string>;
  names: MintNames;
  chain: ChainAttribution | null;
}>;

/* --------------------------------------------------------------- helpers */

const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const SOLSCAN_TX = "https://solscan.io/tx/";

export const KNOWN_MINTS: MintNames = {
  So11111111111111111111111111111111111111112: { symbol: "SOL", decimals: 9 },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", decimals: 6 },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", decimals: 6 },
};

const STABLE_SYMBOLS: ReadonlySet<string> = new Set(["USDC", "USDT", "USDG"]);

/** Raw base units to decimal text, exact, trailing zeros dropped. */
export function decimalText(raw: string | bigint, decimals: number): string {
  const value = BigInt(raw);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export function maskWallet(wallet: string): string {
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

function nameOf(mint: string | null, symbol: string | null, decimals: number | null, names: MintNames): Readonly<{ symbol: string | null; decimals: number | null }> {
  const known = mint ? (names[mint] ?? KNOWN_MINTS[mint] ?? null) : null;
  return { symbol: symbol ?? known?.symbol ?? null, decimals: decimals ?? known?.decimals ?? null };
}

function leg(movement: SolanaWalletAction["out"], names: MintNames): OperationLeg | null {
  if (movement === null) return null;
  const named = nameOf(movement.mint, movement.symbol, movement.decimals, names);
  return {
    mint: movement.mint,
    symbol: named.symbol,
    decimals: named.decimals,
    amountRaw: movement.amountRaw,
    amount: named.decimals === null ? null : decimalText(movement.amountRaw, named.decimals),
  };
}

function legLabel(value: OperationLeg | null): string {
  if (value === null) return "—";
  return value.symbol ?? (value.mint ? shortMint(value.mint) : "—");
}

function isStable(value: OperationLeg | null): boolean {
  return value !== null && value.symbol !== null && STABLE_SYMBOLS.has(value.symbol.toUpperCase());
}

function statusOf(outcome: SolanaActionOutcome): OperationStatus {
  return outcome === "DONE" ? "CONFIRMED" : outcome;
}

function feeOf(action: SolanaWalletAction, names: MintNames): OperationFee | null {
  const fee = action.fee;
  if (!fee) return null;
  const named = nameOf(fee.asset, fee.symbol, fee.decimals, names);
  const scale = named.decimals;
  return {
    collected: fee.collected,
    state: fee.state ?? (fee.collected ? "COLLECTED" : "NOT_COLLECTED"),
    note: fee.note ?? null,
    /* The key a total is summed under: the mint where the row names one, else
       the symbol — a cross-chain fee names its asset by symbol alone. */
    asset: fee.asset ?? fee.symbol,
    symbol: named.symbol,
    decimals: scale,
    basisPoints: fee.basisPoints,
    grossRaw: fee.amountRaw,
    gross: fee.amountRaw !== null && scale !== null ? decimalText(fee.amountRaw, scale) : null,
    ryntraRaw: fee.ryntraRaw,
    ryntra: fee.ryntraRaw !== null && scale !== null ? decimalText(fee.ryntraRaw, scale) : null,
    providerRaw: fee.providerRaw,
    usd: fee.usd,
  };
}

const CHAIN_NAMES: Readonly<Record<SwapNetwork, string>> = {
  solana: "Solana",
  base: "Base",
  ethereum: "Ethereum",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  polygon: "Polygon",
  bnb: "BNB Chain",
  robinhood: "Robinhood Chain",
};

function txLink(label: OperationLink["label"], chain: SwapNetwork | null, ref: string | null): OperationLink | null {
  if (!ref) return null;
  if (SOLANA_SIGNATURE.test(ref) && (chain === null || chain === "solana")) return { label: label === "Solscan" ? "Solscan" : label, url: `${SOLSCAN_TX}${ref}`, ref };
  if (chain && chain !== "solana" && /^0x[0-9a-fA-F]{64}$/.test(ref)) return { label, url: `${EVM_EXPLORER_TX[chain]}${ref}`, ref };
  return null;
}

function verificationOf(
  action: SolanaWalletAction,
  product: OperationProduct,
  status: OperationStatus,
  chain: ChainAttribution | null,
): Readonly<{ verification: OperationVerification; note: string | null }> {
  if (status !== "CONFIRMED") return { verification: "NOT_APPLICABLE", note: null };
  if (product === "BRIDGE") return { verification: "NOT_APPLICABLE", note: "Attributed from the provider's own record; no on-chain marker on Solana." };
  if (!action.signature) return { verification: "PENDING", note: "The row carries no signature yet." };
  if (chain && chain.signatures.has(action.signature)) return { verification: "VERIFIED", note: null };
  if (!chain) return { verification: "PENDING", note: "The chain could not be read just now." };
  if (Date.parse(action.updatedAt) > Date.parse(chain.readAt)) return { verification: "PENDING", note: "Newer than the last chain read; verified on the next one." };
  const fee = action.fee;
  if (!fee) return { verification: "NOT_ATTRIBUTABLE", note: "No service fee on this operation — before the referral account existed, or none was requested." };
  if (!fee.collected) return { verification: "NOT_ATTRIBUTABLE", note: fee.note ?? "The provider took no service fee on this operation." };
  return { verification: "PENDING", note: chain.complete ? "A collected fee not yet seen in the chain read; checked again on the next read." : "The last chain read was partial; checked again on the next read." };
}

/* ------------------------------------------------------------- projection */

function projectOne(action: SolanaWalletAction, source: OperationSource): OperationRecord | null {
  if (action.lane === "SEND" || action.lane === "RECEIVE") return null;
  const status = statusOf(action.outcome);
  const out = leg(action.out, source.names);
  const inn = leg(action.in, source.names);
  const links: OperationLink[] = [];
  let product: OperationProduct;
  let provider: OperationProvider;
  let side: "BUY" | "SELL" | null = null;
  let actionText: string;
  let asset: string | null = null;

  if (action.lane === "SWAP") {
    provider = "JUPITER";
    const spot = action.origin !== null && action.origin.surface === "SPOT";
    const stocks = source.stockMints;
    const outStock = stocks !== null && out?.mint !== null && out?.mint !== undefined && stocks.has(out.mint);
    const inStock = stocks !== null && inn?.mint !== null && inn?.mint !== undefined && stocks.has(inn.mint);
    if (outStock || inStock) {
      product = "STOCK";
      side = spot ? action.origin!.side : inStock ? "BUY" : "SELL";
      asset = legLabel(inStock ? inn : out);
    } else if (spot) {
      product = "SPOT";
      side = action.origin!.side;
      /* The traded asset is the non-stablecoin leg; a buy receives it, a sell gives it. */
      asset = side === "BUY" ? legLabel(isStable(inn) && !isStable(out) ? out : inn) : legLabel(isStable(out) && !isStable(inn) ? inn : out);
    } else {
      product = "SWAP";
    }
    actionText = product === "SWAP" ? `${legLabel(out)} → ${legLabel(inn)}` : `${side === "BUY" ? "Buy" : "Sell"} ${asset}`;
    const link = txLink("Solscan", "solana", action.signature);
    if (link) links.push(link);
  } else if (action.lane === "CROSS_SWAP") {
    product = "BRIDGE";
    const order = source.orders.get(action.actionId) ?? null;
    provider = order?.provider === "MAYAN" ? "MAYAN" : "RELAY";
    const sourceChain = order?.sourceChain ?? null;
    const destinationChain = order?.destinationChain ?? destinationOf(action.destination);
    actionText = `${sourceChain ? CHAIN_NAMES[sourceChain] : "—"} → ${destinationChain ? CHAIN_NAMES[destinationChain] : "—"}`;
    const sourceRef = action.sourceTx ?? order?.sourceTxHash ?? null;
    const destinationRef = action.destinationTx ?? order?.destinationTxHash ?? null;
    const sourceLink = txLink("Source", sourceChain, sourceRef);
    const destinationLink = txLink("Destination", destinationChain, destinationRef);
    if (sourceLink) links.push(sourceLink);
    if (destinationLink) links.push(destinationLink);
  } else {
    /* The direct Circle lane: USDC burned on one chain and minted on the other.
       The claim record names the direction and both transactions for a row
       written before the lane recorded them on the row itself. */
    product = "BRIDGE";
    provider = "CIRCLE";
    const burn = source.burns?.get(action.actionId) ?? null;
    const chains = burn ? cctpChains(burn.direction) : null;
    const destination = destinationOf(action.destination) ?? chains?.destination ?? null;
    const sourceChain: SwapNetwork | null = chains?.source ?? (destination === "solana" ? "base" : destination ? "solana" : null);
    actionText = `${sourceChain ? CHAIN_NAMES[sourceChain] : "—"} → ${destination ? CHAIN_NAMES[destination] : "—"}`;
    const sourceLink = txLink("Source", sourceChain, action.sourceTx ?? (sourceChain === "solana" ? action.signature : null) ?? burn?.burnTx ?? null);
    const destinationLink = txLink("Destination", destination, action.destinationTx ?? burn?.mintTx ?? null);
    if (sourceLink) links.push(sourceLink);
    if (destinationLink) links.push(destinationLink);
  }

  const value = executedUsd(action);
  const verification = verificationOf(action, product, status, source.chain);
  const plan = action.origin?.plan ?? null;
  return {
    id: `${action.lane}:${action.actionId}`,
    lane: action.lane,
    product,
    provider,
    side,
    action: actionText,
    asset,
    wallet: action.wallet,
    internal: source.internalWallets.has(action.wallet),
    status,
    out,
    in: inn,
    usd: value?.value ?? null,
    usdBasis: value?.basis ?? null,
    fee: feeOf(action, source.names),
    startedAt: action.startedAt,
    confirmedAt: status === "CONFIRMED" ? action.updatedAt : null,
    signature: action.signature,
    sourceTx: action.sourceTx,
    destinationTx: action.destinationTx,
    links,
    providerRef: action.providerRef ?? null,
    receiptHash: action.receiptHash,
    plan: plan ? { planId: plan.planId, version: plan.version, reviewId: plan.reviewId } : null,
    verification: verification.verification,
    verificationNote: verification.note,
  };
}

function cctpChains(direction: CctpBurnRef["direction"]): Readonly<{ source: SwapNetwork; destination: SwapNetwork }> {
  switch (direction) {
    case "BASE_TO_SOLANA":
      return { source: "base", destination: "solana" };
    case "ETHEREUM_TO_SOLANA":
      return { source: "ethereum", destination: "solana" };
    case "SOLANA_TO_ETHEREUM":
      return { source: "solana", destination: "ethereum" };
    default:
      return { source: "solana", destination: "base" };
  }
}

function destinationOf(value: SolanaWalletAction["destination"]): SwapNetwork | null {
  switch (value) {
    case "SOLANA":
      return "solana";
    case "BASE":
      return "base";
    case "ETHEREUM":
      return "ethereum";
    case "ROBINHOOD":
      return "robinhood";
    default:
      return null;
  }
}

/** Every operation in the ledger, once, newest first. */
export function projectOperations(source: OperationSource): readonly OperationRecord[] {
  const seen = new Set<string>();
  const records: OperationRecord[] = [];
  for (const action of source.actions) {
    const record = projectOne(action, source);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
  }
  records.sort((a, b) => (b.confirmedAt ?? b.startedAt).localeCompare(a.confirmedAt ?? a.startedAt));
  return records;
}

/* ---------------------------------------------------------------- summary */

export type OperationRange = "24h" | "7d" | "30d" | "all";
export const OPERATION_RANGES: readonly OperationRange[] = ["24h", "7d", "30d", "all"];

export type SummaryFee = Readonly<{
  asset: string;
  symbol: string;
  decimals: number | null;
  grossRaw: string;
  gross: string | null;
  ryntraRaw: string | null;
  ryntra: string | null;
  operations: number;
}>;

export type OperationSummary = Readonly<{
  operations: number;
  volumeUsd: number;
  unvalued: number;
  wallets: number;
  fees: readonly SummaryFee[];
  /** Fees with a provider-stated dollar value, summed; null when none carried one. */
  feeUsd: number | null;
  own: Readonly<{ operations: number; wallets: number }>;
  byProduct: Readonly<Record<OperationProduct, Readonly<{ operations: number; volumeUsd: number; unvalued: number }>>>;
  verification: Readonly<Record<OperationVerification, number>>;
  /** The subset an outsider can reproduce from the chain: verified operations and their value. */
  attributable: Readonly<{ operations: number; volumeUsd: number }>;
  since: string | null;
  last: string | null;
}>;

export function rangeStart(range: OperationRange, now: Date): string | null {
  const days = range === "24h" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : null;
  return days === null ? null : new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** What the filters and the totals need of a row — the public shape carries it too. */
export type OperationLike = Pick<OperationRecord, "product" | "status" | "confirmedAt" | "startedAt" | "wallet" | "internal" | "usd" | "verification" | "fee">;

export function filterOperations<T extends OperationLike>(
  records: readonly T[],
  args: Readonly<{ product?: OperationProduct | "ALL"; range?: OperationRange; now: Date; confirmedOnly?: boolean }>,
): readonly T[] {
  const since = rangeStart(args.range ?? "all", args.now);
  return records.filter((record) => {
    if (args.confirmedOnly !== false && record.status !== "CONFIRMED") return false;
    if (args.product && args.product !== "ALL" && record.product !== args.product) return false;
    if (since !== null && (record.confirmedAt ?? record.startedAt) < since) return false;
    return true;
  });
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Totals over the confirmed operations given — every figure from the same rows. */
export function summarizeOperations(records: readonly OperationLike[], args: Readonly<{ product?: OperationProduct | "ALL"; range?: OperationRange; now: Date }>): OperationSummary {
  const rows = filterOperations(records, { ...args, confirmedOnly: true });
  const wallets = new Set<string>();
  const ownWallets = new Set<string>();
  let ownOperations = 0;
  let volume = 0;
  let unvalued = 0;
  let feeUsd = 0;
  let feeUsdSeen = false;
  const fees = new Map<string, { asset: string; symbol: string; decimals: number | null; gross: bigint; ryntra: bigint; ryntraKnown: boolean; operations: number }>();
  const byProduct: Record<OperationProduct, { operations: number; volumeUsd: number; unvalued: number }> = {
    SWAP: { operations: 0, volumeUsd: 0, unvalued: 0 },
    SPOT: { operations: 0, volumeUsd: 0, unvalued: 0 },
    STOCK: { operations: 0, volumeUsd: 0, unvalued: 0 },
    BRIDGE: { operations: 0, volumeUsd: 0, unvalued: 0 },
  };
  const verification: Record<OperationVerification, number> = { VERIFIED: 0, PENDING: 0, NOT_ATTRIBUTABLE: 0, NOT_APPLICABLE: 0 };
  let attributableOperations = 0;
  let attributableVolume = 0;
  let since: string | null = null;
  let last: string | null = null;
  for (const record of rows) {
    wallets.add(record.wallet);
    if (record.internal) {
      ownOperations += 1;
      ownWallets.add(record.wallet);
    }
    const bucket = byProduct[record.product];
    bucket.operations += 1;
    if (record.usd === null) {
      unvalued += 1;
      bucket.unvalued += 1;
    } else {
      volume += record.usd;
      bucket.volumeUsd += record.usd;
    }
    verification[record.verification] += 1;
    if (record.verification === "VERIFIED") {
      attributableOperations += 1;
      if (record.usd !== null) attributableVolume += record.usd;
    }
    const fee = record.fee;
    if (fee && fee.collected && fee.grossRaw !== null && fee.asset !== null) {
      /* Summed under the symbol where one is known: USDC paid on Base and USDC
         paid on Solana are one line of gross fees, at par either way. */
      const key = fee.symbol ? fee.symbol.toUpperCase() : fee.asset;
      const entry = fees.get(key) ?? { asset: fee.asset, symbol: fee.symbol ?? shortMint(fee.asset), decimals: fee.decimals, gross: 0n, ryntra: 0n, ryntraKnown: true, operations: 0 };
      entry.gross += BigInt(fee.grossRaw);
      entry.operations += 1;
      /* Ryntra's share of an asset is stated only when every fee in it carries
         its split; one unknown split makes the whole line unknown rather than
         a smaller number that reads as the answer. */
      if (fee.ryntraRaw !== null) entry.ryntra += BigInt(fee.ryntraRaw);
      else entry.ryntraKnown = false;
      fees.set(key, entry);
      if (typeof fee.usd === "number") {
        feeUsd += fee.usd;
        feeUsdSeen = true;
      }
    }
    const at = record.confirmedAt ?? record.startedAt;
    if (since === null || at < since) since = at;
    if (last === null || at > last) last = at;
  }
  return {
    operations: rows.length,
    volumeUsd: round6(volume),
    unvalued,
    wallets: wallets.size,
    fees: [...fees.values()]
      .sort((a, b) => b.operations - a.operations || a.symbol.localeCompare(b.symbol))
      .map((entry) => ({
        asset: entry.asset,
        symbol: entry.symbol,
        decimals: entry.decimals,
        grossRaw: entry.gross.toString(),
        gross: entry.decimals === null ? null : decimalText(entry.gross, entry.decimals),
        ryntraRaw: entry.ryntraKnown ? entry.ryntra.toString() : null,
        ryntra: entry.ryntraKnown && entry.decimals !== null ? decimalText(entry.ryntra, entry.decimals) : null,
        operations: entry.operations,
      })),
    feeUsd: feeUsdSeen ? round6(feeUsd) : null,
    own: { operations: ownOperations, wallets: ownWallets.size },
    byProduct: {
      SWAP: { ...byProduct.SWAP, volumeUsd: round6(byProduct.SWAP.volumeUsd) },
      SPOT: { ...byProduct.SPOT, volumeUsd: round6(byProduct.SPOT.volumeUsd) },
      STOCK: { ...byProduct.STOCK, volumeUsd: round6(byProduct.STOCK.volumeUsd) },
      BRIDGE: { ...byProduct.BRIDGE, volumeUsd: round6(byProduct.BRIDGE.volumeUsd) },
    },
    verification,
    attributable: { operations: attributableOperations, volumeUsd: round6(attributableVolume) },
    since,
    last,
  };
}

/* ---------------------------------------------------------------- public */

/** The row as the public page may show it: the wallet masked, the plan reduced to a fact. */
export type PublicOperation = Omit<OperationRecord, "wallet" | "plan" | "receiptHash"> & Readonly<{ wallet: string; underPlan: boolean }>;

export function toPublicOperation(record: OperationRecord): PublicOperation {
  const { wallet, plan, receiptHash: _receipt, ...rest } = record;
  void _receipt;
  return { ...rest, wallet: maskWallet(wallet), underPlan: plan !== null };
}
