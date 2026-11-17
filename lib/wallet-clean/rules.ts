/**
 * «Clean the wallet» — the rules, without the network.
 *
 * A wallet on Solana gathers three kinds of litter: coins worth a few cents or dollars, accounts of coins long sold
 * that still hold their rent (≈ 0.002 SOL each), and coins nobody prices or routes — airdrops, dead launches. This
 * file sorts a wallet's token accounts into those kinds, says which coins are better not touched and why, and lays
 * out what one «Clean» does: the small coins are swapped into SOL by the swap engine as it is (its route and its fee),
 * the empty accounts are closed for their rent (no fee), the litter is burnt and its account closed.
 *
 * A coin with a risk mark never goes into a clean unless the person picks it. An account that cannot be closed by its
 * owner alone (frozen, another close authority, a confidential balance) is left as it is and not counted.
 *
 * Pure: the tests hold every rule as it is written.
 */

/**
 * A refusal of a send that still means the bytes are on the chain: the node already processed this very transaction.
 * web3.js puts the node's own words after its first line («Simulation failed.\nMessage: … already been processed»), so
 * the whole message is read — the first line alone reads a landed repeat as «not sent». The relay then asks the chain by
 * the transaction's own signature; nothing is sent again.
 */
export function alreadyProcessed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /already been processed|AlreadyProcessed/i.test(message);
}

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP7VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/** A coin worth this many dollars or less is «small»: swapped into SOL by a clean. */
export const DUST_MAX_USD = 5;
/** A coin whose pools hold less than this is thin: a sale moves its price. */
export const THIN_LIQUIDITY_USD = 10_000;
/** The most swaps one clean carries: each is a transaction of its own, and the wallet approves them all at once. */
export const MAX_SWAPS = 6;
/** The most accounts one closing transaction carries — well inside a legacy message's account limit. */
export const MAX_CLOSES_PER_TX = 10;
/** The most closing transactions a clean carries before the swaps. */
export const MAX_CLOSE_TXS = 3;
/** A wallet's swap is worth asking only above this: under it Jupiter routes nothing, and the rent alone is the gain. */
export const SWAP_MIN_USD = 0.01;

/** One token account of the wallet, as the chain reads it. */
export type ChainAccount = Readonly<{
  account: string;
  mint: string;
  program: string;
  amountRaw: string;
  decimals: number;
  /** Everything the account holds in lamports: its rent, and for wrapped SOL the SOL too. */
  lamports: number;
  frozen: boolean;
  native: boolean;
  /** Who else may close it; null — the owner. */
  closeAuthority: string | null;
  /** Token-2022: transfer fees held back in the account, raw; they go to the mint before it closes. */
  withheldRaw: string;
  /** Token-2022: a confidential balance stands in the account — the owner alone cannot empty it here. */
  confidential: boolean;
}>;

/** What the mint and the market say of a coin. Every field the source did not state is null. */
export type CoinFacts = Readonly<{
  mint: string;
  symbol: string | null;
  name: string | null;
  icon: string | null;
  price: number | null;
  verified: boolean;
  organicLow: boolean;
  mintOff: boolean | null;
  freezeOff: boolean | null;
  liquidityUsd: number | null;
  /** Token-2022: the transfer fee in force, basis points; 0 — none. */
  transferFeeBps: number;
  /** Token-2022: a transfer hook runs on every move. */
  hook: boolean;
  /** Token-2022: someone may move or burn anyone's balance of it. */
  permanentDelegate: boolean;
  /** Token-2022: it cannot be moved at all. */
  nonTransferable: boolean;
}>;

export const RISK_REASONS = ["unverified", "mint", "freeze", "delegate", "thin", "score", "fee", "hook"] as const;
export type RiskReason = (typeof RISK_REASONS)[number];

/** Mints whose facts are known and whose issuers' rights are their own business. */
const KNOWN = new Set([WSOL_MINT, USDC_MINT, USDT_MINT]);

/**
 * Why a coin is better not touched, in the order a person reads it: not verified by Jupiter, and then — for such a
 * coin — who may still mint or freeze it, who may take it, how thin its market is, how little real trading it has;
 * for any coin, a fee on every transfer or a program that runs on every transfer. A verified coin's issuer rights
 * (USDC freezes, PYUSD has a delegate) are not marks: they are the issuer's and stated by it.
 */
export function riskOf(facts: CoinFacts | null): readonly RiskReason[] {
  if (facts && KNOWN.has(facts.mint)) return [];
  const reasons: RiskReason[] = [];
  const verified = facts?.verified === true;
  if (!verified) {
    reasons.push("unverified");
    if (facts?.mintOff === false) reasons.push("mint");
    if (facts?.freezeOff === false) reasons.push("freeze");
    if (facts?.permanentDelegate) reasons.push("delegate");
    if (facts?.liquidityUsd !== null && facts?.liquidityUsd !== undefined && facts.liquidityUsd < THIN_LIQUIDITY_USD) reasons.push("thin");
    if (facts?.organicLow) reasons.push("score");
  }
  if (facts && facts.transferFeeBps > 0) reasons.push("fee");
  if (facts?.hook) reasons.push("hook");
  return reasons;
}

export type CleanKind = "small" | "empty" | "litter" | "wrapped";

/** One account a clean may take, with what it gives back. */
export type CleanItem = Readonly<{
  account: string;
  mint: string;
  program: string;
  kind: CleanKind;
  symbol: string;
  name: string | null;
  icon: string | null;
  amountRaw: string;
  decimals: number;
  /** What the coin is worth now, dollars; null — no price. */
  valueUsd: number | null;
  /** The account's own lamports, which closing it returns. */
  lamports: number;
  withheldRaw: string;
  risk: readonly RiskReason[];
  /** In a clean unless the person takes it out: no risk mark, or nothing of a coin in it. */
  picked: boolean;
}>;

const DIGITS = /^\d+$/;
const rawOf = (value: string): bigint => (DIGITS.test(value) ? BigInt(value) : 0n);

/** A raw amount in whole coins, for a price only. */
export function unitsOf(amountRaw: string, decimals: number): number {
  const raw = rawOf(amountRaw);
  if (raw === 0n) return 0;
  const scale = 10 ** Math.max(0, Math.min(18, decimals));
  return Number(raw) / scale;
}

const short = (mint: string): string => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

/** Why an account is not the clean's to take; null — it may be. */
export function stuckOf(account: ChainAccount, owner: string): "frozen" | "authority" | "confidential" | null {
  if (account.frozen) return "frozen";
  if (account.closeAuthority && account.closeAuthority !== owner) return "authority";
  if (account.confidential) return "confidential";
  return null;
}

/** Wrapped SOL's own balance: closing the account returns it, but it is the person's SOL, never «got back». */
function rentOnly(account: ChainAccount): number {
  const raw = Number(rawOf(account.amountRaw));
  return Math.max(0, account.lamports - (account.native || account.mint === WSOL_MINT ? raw : 0));
}

/**
 * The wallet's accounts as a clean sees them. An empty account — any coin — gives its rent back and is always picked:
 * closing it touches no coin. Wrapped SOL is unwrapped by closing; only its rent counts as got back. A coin worth up to
 * `DUST_MAX_USD` with a price is small. A coin with no price — litter — is listed and never picked by default: «no
 * price» may only mean the market was not asked. Never litter, whatever the market says: a known coin (SOL, USDC, USDT)
 * and anything shaped like an NFT (no decimals) — a pool position, a collectible. Anything worth more stays out. A
 * marked coin is listed but not picked.
 */
export function cleanItems(owner: string, accounts: readonly ChainAccount[], facts: ReadonlyMap<string, CoinFacts>): CleanItem[] {
  const items: CleanItem[] = [];
  for (const account of accounts) {
    if (stuckOf(account, owner)) continue;
    const coin = facts.get(account.mint) ?? null;
    const raw = rawOf(account.amountRaw);
    const risk = riskOf(coin);
    const base = {
      account: account.account,
      mint: account.mint,
      program: account.program,
      symbol: (coin?.symbol ?? "").replace(/^\$+/, "") || short(account.mint),
      name: coin?.name ?? null,
      icon: coin?.icon ?? null,
      amountRaw: account.amountRaw,
      decimals: account.decimals,
      lamports: account.lamports,
      withheldRaw: account.withheldRaw,
    };
    if (account.native || account.mint === WSOL_MINT) {
      items.push({ ...base, kind: "wrapped", symbol: "SOL", valueUsd: null, lamports: rentOnly(account), risk: [], picked: true });
      continue;
    }
    if (raw === 0n) {
      items.push({ ...base, kind: "empty", valueUsd: 0, risk, picked: true });
      continue;
    }
    if (account.decimals === 0 || KNOWN.has(account.mint)) {
      const price = coin?.price ?? null;
      if (account.decimals === 0 || price === null || !(price > 0)) continue;
    }
    const valueUsd = coin?.price !== null && coin?.price !== undefined && coin.price > 0 ? unitsOf(account.amountRaw, account.decimals) * coin.price : null;
    if (valueUsd !== null && valueUsd > DUST_MAX_USD) continue;
    const kind: CleanKind = valueUsd === null || coin?.nonTransferable ? "litter" : "small";
    items.push({ ...base, kind, valueUsd, risk, picked: kind === "small" && risk.length === 0 });
  }
  const order: Record<CleanKind, number> = { wrapped: 0, small: 1, litter: 2, empty: 3 };
  return items.sort((a, b) => order[a.kind] - order[b.kind] || (b.valueUsd ?? 0) - (a.valueUsd ?? 0) || a.symbol.localeCompare(b.symbol));
}

/** What a clean of these items gives back: the rent of every account it closes, and wrapped SOL itself. */
export function rentBackLamports(items: readonly CleanItem[]): number {
  return items.reduce((sum, item) => sum + item.lamports, 0);
}

/** The dollars of the small coins a clean swaps, before the swap engine's fee and price. */
export function smallUsd(items: readonly CleanItem[]): number {
  return items.reduce((sum, item) => sum + (item.kind === "small" && item.valueUsd !== null ? item.valueUsd : 0), 0);
}

/**
 * The items a clean takes: those picked by default, plus the accounts the person picked by hand, less those they took
 * out. A marked coin enters only by hand.
 */
export function takenItems(items: readonly CleanItem[], choice: Readonly<{ add?: readonly string[]; drop?: readonly string[] }> = {}): CleanItem[] {
  const add = new Set(choice.add ?? []);
  const drop = new Set(choice.drop ?? []);
  return items.filter((item) => !drop.has(item.account) && (item.picked || add.has(item.account)));
}

export type CleanPlan = Readonly<{
  /** Small coins swapped into SOL, each its own transaction; those over `MAX_SWAPS` wait for the next clean. */
  swaps: readonly CleanItem[];
  /**
   * Accounts closed before the swaps — empty ones, wrapped SOL, burnt litter, and a coin under `SWAP_MIN_USD` (too
   * small for any route: burnt, the rent is the gain) — in transactions of up to `MAX_CLOSES_PER_TX`.
   */
  closes: readonly (readonly CleanItem[])[];
  /** The swapped coins' accounts, closed once the swaps have landed: empty by then. */
  after: readonly CleanItem[];
  /** What this clean leaves for the next one: more swaps or more closes than one approval carries. */
  left: number;
}>;

/**
 * One clean, laid out: closes first (they need nothing else to land), then the swaps, then one transaction that closes
 * the accounts the swaps emptied. A coin too small for a route is not swapped: Jupiter would refuse it.
 */
export function planOf(taken: readonly CleanItem[]): CleanPlan {
  const swappable = taken.filter((item) => item.kind === "small" && (item.valueUsd ?? 0) >= SWAP_MIN_USD);
  const swaps = swappable.slice(0, MAX_SWAPS);
  const swapped = new Set(swaps.map((item) => item.account));
  // Swaps into SOL may use the wallet's wrapped SOL account themselves: it waits for a clean without swaps.
  const waiting = swaps.length ? taken.filter((item) => item.kind === "wrapped").length : 0;
  const closing = taken.filter((item) => !swapped.has(item.account) && !(swaps.length && item.kind === "wrapped") && (item.kind !== "small" || (item.valueUsd ?? 0) < SWAP_MIN_USD));
  const capacity = MAX_CLOSES_PER_TX * MAX_CLOSE_TXS;
  const closesNow = closing.slice(0, capacity);
  const closes: CleanItem[][] = [];
  for (let at = 0; at < closesNow.length; at += MAX_CLOSES_PER_TX) closes.push(closesNow.slice(at, at + MAX_CLOSES_PER_TX));
  const left = Math.max(0, swappable.length - swaps.length) + Math.max(0, closing.length - closesNow.length) + waiting;
  return { swaps, closes, after: swaps, left };
}

/** What a closing transaction does to one account: burn what is in it (litter, a coin too small to swap), then close. */
export function closeSteps(item: CleanItem): Readonly<{ harvest: boolean; burnRaw: string | null; close: true }> {
  const raw = rawOf(item.amountRaw);
  const burn = item.kind !== "wrapped" && item.kind !== "empty" && raw > 0n;
  return { harvest: item.program === TOKEN_2022_PROGRAM && rawOf(item.withheldRaw) > 0n, burnRaw: burn ? raw.toString() : null, close: true };
}

/* ── the short reader ─────────────────────────────────────────────────── */

export type BackRead = Readonly<{ lamports: number; accounts: number }>;

/**
 * «You can get ≈ … SOL back» without a market read: the rent of every empty account the owner alone may close, and
 * of wrapped SOL's account (its balance is the person's own, not got back). A coin still held is not counted.
 */
export function backOf(owner: string, accounts: readonly ChainAccount[]): BackRead {
  let lamports = 0;
  let count = 0;
  for (const account of accounts) {
    if (stuckOf(account, owner)) continue;
    if (account.native || account.mint === WSOL_MINT || rawOf(account.amountRaw) === 0n) {
      lamports += rentOnly(account);
      count += 1;
    }
  }
  return { lamports, accounts: count };
}

/* ── reading the chain's parsed accounts ──────────────────────────────── */

type Parsed = Readonly<Record<string, unknown>>;
const objectOf = (value: unknown): Parsed | null => (value && typeof value === "object" ? (value as Parsed) : null);

/**
 * One `getTokenAccountsByOwner` row (jsonParsed) as a `ChainAccount`; null for a row that is not a token account of
 * this program. A Token-2022 account carries its extensions: the transfer fees held back, a confidential balance.
 */
export function chainAccountOf(pubkey: string, raw: Readonly<{ lamports?: unknown; data?: unknown }>, program: string): ChainAccount | null {
  const parsed = objectOf(objectOf(raw.data)?.parsed);
  if (parsed?.type !== "account") return null;
  const info = objectOf(parsed.info);
  const amount = objectOf(info?.tokenAmount);
  if (!info || !amount || typeof info.mint !== "string" || typeof amount.amount !== "string" || typeof amount.decimals !== "number") return null;
  const extensions = Array.isArray(info.extensions) ? info.extensions.map(objectOf).filter((entry): entry is Parsed => entry !== null) : [];
  const fee = extensions.find((entry) => entry.extension === "transferFeeAmount");
  const withheld = objectOf(fee?.state)?.withheldAmount;
  return {
    account: pubkey,
    mint: info.mint,
    program,
    amountRaw: amount.amount,
    decimals: amount.decimals,
    lamports: typeof raw.lamports === "number" ? raw.lamports : 0,
    frozen: info.state === "frozen",
    native: info.isNative === true,
    closeAuthority: typeof info.closeAuthority === "string" ? info.closeAuthority : null,
    withheldRaw: typeof withheld === "number" ? String(withheld) : typeof withheld === "string" && DIGITS.test(withheld) ? withheld : "0",
    confidential: extensions.some((entry) => entry.extension === "confidentialTransferAccount"),
  };
}

/** A Token-2022 mint's extensions that matter to a holder (jsonParsed). */
export type MintExtras = Readonly<{ transferFeeBps: number; hook: boolean; permanentDelegate: boolean; nonTransferable: boolean }>;

export const NO_EXTRAS: MintExtras = { transferFeeBps: 0, hook: false, permanentDelegate: false, nonTransferable: false };

export function mintExtrasOf(raw: Readonly<{ data?: unknown }> | null, epoch: number | null = null): MintExtras {
  const info = objectOf(objectOf(objectOf(raw?.data)?.parsed)?.info);
  const extensions = Array.isArray(info?.extensions) ? info.extensions.map(objectOf).filter((entry): entry is Parsed => entry !== null) : [];
  let transferFeeBps = 0;
  let hook = false;
  let permanentDelegate = false;
  let nonTransferable = false;
  for (const entry of extensions) {
    const state = objectOf(entry.state);
    if (entry.extension === "transferFeeConfig") {
      const newer = objectOf(state?.newerTransferFee);
      const older = objectOf(state?.olderTransferFee);
      const newerEpoch = typeof newer?.epoch === "number" ? newer.epoch : 0;
      const inForce = epoch !== null && epoch < newerEpoch ? older : newer;
      const bps = inForce?.transferFeeBasisPoints;
      transferFeeBps = typeof bps === "number" && Number.isFinite(bps) ? bps : 0;
    } else if (entry.extension === "transferHook") {
      hook = typeof state?.programId === "string" && state.programId.length > 0;
    } else if (entry.extension === "permanentDelegate") {
      permanentDelegate = typeof state?.delegate === "string" && state.delegate.length > 0;
    } else if (entry.extension === "nonTransferable") {
      nonTransferable = true;
    }
  }
  return { transferFeeBps, hook, permanentDelegate, nonTransferable };
}
