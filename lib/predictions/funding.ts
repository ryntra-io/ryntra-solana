/**
 * Money in and out of the prediction account for a person with one Solana
 * wallet, in Ryntra's own terms.
 *
 * The account is managed: the aggregator gives every user a wallet it holds
 * the keys to (the key custody provider is Portal, as the app is set up),
 * with a Solana address that receives USDC. The person sends USDC there from
 * any Solana wallet; the aggregator moves it to the venue a trade routes to
 * and signs every trade, bridge and withdrawal. A withdrawal goes back to the
 * person's own Solana wallet — the proven one, never an address typed in.
 *
 * Everything here reads the aggregator's answers and decides nothing with
 * money: the server flows are in `funding-account.ts`. Amounts travel as raw
 * integer strings in token decimals, as the aggregator states them, and are
 * turned into dollars only for display.
 */

import { parseDecimalInput } from "../plans/decimal-input.ts";

/** Who holds the balance, as the app is set up in the aggregator's cabinet. Said on the Review and in the rules, never "your wallet". */
export const CUSTODY = Object.freeze({ holder: "AGG", walletProvider: "Portal" });

/** USDC on Solana: six decimals. Withdrawals are asked for in it. */
export const USDC_DECIMALS = 6;
const USDC_UNIT = 10n ** BigInt(USDC_DECIMALS);

/**
 * The aggregator's own figures for a withdrawal into Solana (funding docs,
 * read 2026-10-21): every withdrawal at least one token; a balance held on
 * another chain counts only from $2.50 into Solana; the bridge into Solana
 * costs about $0.23. The preview is the truth for one withdrawal — these are
 * what the person reads before asking for one.
 */
export const WITHDRAW_MIN_RAW = USDC_UNIT;
export const SOLANA_CROSS_CHAIN_MIN_USD = 2.5;
export const SOLANA_BRIDGE_FEE_USD = 0.23;

/** How far the amount delivered may fall between the Review and the send before the person reviews again. */
export const RECEIVE_DROP_TOLERANCE_BPS = 100;

/** How long one withdrawal send waits for the provider before its state is unknown and the same request is asked again. */
export const WITHDRAW_SEND_TIMEOUT_MS = 20_000;
/** How long one session refresh at the provider may take before it is given up. */
export const PROVIDER_REFRESH_TIMEOUT_MS = 10_000;
/**
 * How long one send holds its record. One send through the session layer can
 * be a refresh ahead of expiry, the send, a refresh after a 401 and the same
 * send again — the lease outlasts all of it, with room for the store's writes,
 * so a second check never sends while the first run may still be out.
 */
export const WITHDRAW_SEND_LEASE_MS = 2 * WITHDRAW_SEND_TIMEOUT_MS + 2 * PROVIDER_REFRESH_TIMEOUT_MS + 5_000;

/**
 * The account's money as the browser holds it, shown only for the wallet the
 * account is signed in with now: an answer read for another wallet (a switch,
 * a sign-out, a read that landed late) is never drawn — no deposit address,
 * no destination, no records of someone else.
 */
export function fundingViewFor<T extends Readonly<{ wallet: string }>>(funding: T | null, accountWallet: string | null | undefined): T | null {
  if (!funding || !accountWallet) return null;
  return funding.wallet === accountWallet ? funding : null;
}

/**
 * Whether live money may move on this deployment: off unless the operator
 * set `PREDICTIONS_LIVE_FUNDING=on`. Off, the account shows no deposit
 * address and sends no withdrawal; the paper account is unchanged.
 */
export function fundingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.PREDICTIONS_LIVE_FUNDING ?? "").trim().toLowerCase() === "on";
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DIGITS = /^\d+$/;

export function isSolanaAddress(value: unknown): value is string {
  return typeof value === "string" && BASE58.test(value);
}

/** A raw integer string in `decimals` as a number of tokens; null for anything that is not one. */
export function rawToAmount(raw: unknown, decimals: number): number | null {
  if (typeof raw !== "string" || !DIGITS.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null;
  const unit = 10n ** BigInt(decimals);
  const value = BigInt(raw);
  const whole = value / unit;
  const fraction = (value % unit).toString().padStart(decimals, "0");
  return Number(decimals === 0 ? whole.toString() : `${whole}.${fraction}`);
}

export type AmountReading = Readonly<{ ok: true; raw: string }> | Readonly<{ ok: false; reason: "empty" | "unreadable" | "too_precise" | "not_positive" }>;

/** A dollar amount the person typed (`2,5`, `2.50`, `$10`), as raw USDC — refused rather than rounded when it has more than six decimals. */
export function parseUsdcAmount(text: string): AmountReading {
  if (text.trim() === "") return { ok: false, reason: "empty" };
  const value = parseDecimalInput(text);
  if (value === null) return { ok: false, reason: "unreadable" };
  const scaled = value * 10 ** USDC_DECIMALS;
  const raw = Math.round(scaled);
  if (Math.abs(scaled - raw) > 1e-6) return { ok: false, reason: "too_precise" };
  if (raw <= 0) return { ok: false, reason: "not_positive" };
  if (!Number.isSafeInteger(raw)) return { ok: false, reason: "unreadable" };
  return { ok: true, raw: String(raw) };
}

/* ------------------------------------------------------------------ deposit */

export type DepositTarget =
  /** The managed wallet's Solana address and the token it takes there. */
  | Readonly<{ state: "ready"; address: string; chainId: number; chainName: string; token: Readonly<{ symbol: string; mint: string; decimals: number }> }>
  /** The aggregator is still creating the addresses: ask again shortly. */
  | Readonly<{ state: "preparing" }>
  /** The app's supported chains list no USDC on Solana: no address is shown rather than one that may not be credited. */
  | Readonly<{ state: "unsupported" }>;

type SupportedChain = Readonly<{ chainId?: unknown; name?: unknown; tokens?: unknown }>;

/**
 * The Solana deposit target from `GET /execution/deposit-addresses`. The
 * supported chains are the truth (the docs say so, and they change): the
 * address is shown only when they list USDC on Solana.
 */
export function solanaDepositTarget(answer: unknown): DepositTarget {
  const body = (answer ?? {}) as Readonly<{ ready?: unknown; svmAddress?: unknown; supportedChains?: unknown }>;
  if (body.ready !== true) return { state: "preparing" };
  if (!isSolanaAddress(body.svmAddress) || !Array.isArray(body.supportedChains)) return { state: "unsupported" };
  const chain = (body.supportedChains as SupportedChain[]).find((c) => typeof c?.name === "string" && /^solana$/i.test(c.name.trim()) && Number.isSafeInteger(c.chainId));
  if (!chain || !Array.isArray(chain.tokens)) return { state: "unsupported" };
  const usdc = (chain.tokens as Readonly<{ symbol?: unknown; address?: unknown; decimals?: unknown }>[]).find((t) => t?.symbol === "USDC" && isSolanaAddress(t.address) && t.decimals === USDC_DECIMALS);
  if (!usdc) return { state: "unsupported" };
  return { state: "ready", address: body.svmAddress, chainId: chain.chainId as number, chainName: String(chain.name), token: { symbol: "USDC", mint: usdc.address as string, decimals: USDC_DECIMALS } };
}

/* ------------------------------------------------------------------ balance */

export type LiveBalance = Readonly<{
  /** Every stablecoin the account holds, in dollars. */
  cashUsd: number;
  /** Spendable now; the rest is held for open orders and trades in progress. */
  availableUsd: number;
  reservedUsd: number;
  /** By token and chain, so the person sees where the dollars sit. */
  tokens: readonly Readonly<{ symbol: string; usd: number; chains: readonly Readonly<{ chainId: number; usd: number }>[] }>[];
  /** What the open positions are worth, as the aggregator marks them. */
  positionsUsd: number;
}>;

const STABLE = new Set(["USDC", "USDC.e", "USDT", "pUSD", "USD1", "USDH"]);

type CashRow = Readonly<{ tokenSymbol?: unknown; totalRaw?: unknown; availableRaw?: unknown; reservedRaw?: unknown; decimals?: unknown; chains?: unknown }>;

/** The live balance from `GET /execution/balances?mode=live`; a token row the reader cannot read is left out, never guessed. */
export function mapLiveBalance(answer: unknown): LiveBalance {
  const body = (answer ?? {}) as Readonly<{ cash?: unknown; positions?: unknown }>;
  const cash = Array.isArray(body.cash) ? (body.cash as CashRow[]) : [];
  let cashUsd = 0;
  let availableUsd = 0;
  let reservedUsd = 0;
  const tokens: { symbol: string; usd: number; chains: { chainId: number; usd: number }[] }[] = [];
  for (const row of cash) {
    if (typeof row?.tokenSymbol !== "string" || !STABLE.has(row.tokenSymbol) || typeof row.decimals !== "number") continue;
    const total = rawToAmount(row.totalRaw, row.decimals);
    if (total === null) continue;
    const available = row.availableRaw === undefined ? total : rawToAmount(row.availableRaw, row.decimals);
    const reserved = row.reservedRaw === undefined ? 0 : rawToAmount(row.reservedRaw, row.decimals);
    /* Cash a venue holds for itself, or an old proxy that spends on one venue only, is in the total but cannot go anywhere: it is not called available. */
    const tied = (Array.isArray(row.chains) ? (row.chains as Readonly<{ custodyKind?: unknown; legacyKind?: unknown; balanceRaw?: unknown; decimals?: unknown }>[]) : [])
      .filter((c) => c?.custodyKind === "VENUE_ACCOUNT" || c?.legacyKind === "proxy")
      .reduce((sum, c) => sum + (typeof c.decimals === "number" ? (rawToAmount((c as { availableRaw?: unknown }).availableRaw ?? c.balanceRaw, c.decimals) ?? 0) : 0), 0);
    cashUsd += total;
    availableUsd += Math.max(0, (available ?? 0) - tied);
    reservedUsd += reserved ?? 0;
    const chains = (Array.isArray(row.chains) ? (row.chains as Readonly<{ chainId?: unknown; balanceRaw?: unknown; decimals?: unknown }>[]) : [])
      .map((c) => ({ chainId: Number(c?.chainId), usd: typeof c?.decimals === "number" ? rawToAmount(c.balanceRaw, c.decimals) : null }))
      .filter((c): c is { chainId: number; usd: number } => Number.isSafeInteger(c.chainId) && c.usd !== null && c.usd > 0);
    if (total > 0) tokens.push({ symbol: row.tokenSymbol, usd: total, chains });
  }
  const positions = Array.isArray(body.positions) ? (body.positions as Readonly<{ balance?: unknown }>[]) : [];
  const positionsUsd = positions.reduce((sum, p) => sum + (typeof p?.balance === "number" && Number.isFinite(p.balance) ? p.balance : 0), 0);
  return { cashUsd: round6(cashUsd), availableUsd: round6(availableUsd), reservedUsd: round6(reservedUsd), tokens, positionsUsd: round6(positionsUsd) };
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/* ------------------------------------------------------------------ deposits */

export type DepositPhase = "credited" | "pending" | "unknown";

const BNB_CHAIN_ID = 56;

export type DepositRow = Readonly<{ id: string; amount: number | null; symbol: string; chainId: number | null; txHash: string | null; at: string; phase: DepositPhase; providerStatus: string }>;

/**
 * The aggregator states no deposit status list; a status the reader knows
 * the meaning of is said in words, any other is shown as unknown with the
 * aggregator's own word beside it — never as credited.
 */
export function depositPhase(status: unknown): DepositPhase {
  const s = typeof status === "string" ? status.trim().toLowerCase() : "";
  if (/^(confirmed|completed|complete|credited|success|succeeded|finalized)$/.test(s)) return "credited";
  if (/^(pending|detected|confirming|submitted|processing|in_progress)$/.test(s)) return "pending";
  return "unknown";
}

/** The deposits in `GET /users/activity?type=deposit`, newest first. */
export function mapDeposits(answer: unknown): readonly DepositRow[] {
  const items = Array.isArray((answer as { data?: unknown })?.data) ? ((answer as { data: unknown[] }).data as Readonly<Record<string, unknown>>[]) : [];
  return items
    .filter((d) => d?.type === "deposit" && typeof d.id === "string")
    .map((d) => {
      const symbol = typeof d.tokenSymbol === "string" ? d.tokenSymbol : "";
      const chainId = Number(d.chainId);
      return {
        id: d.id as string,
        /* Stablecoins on BNB Chain carry 18 decimals; everywhere else the aggregator takes them with six. */
        amount: rawToAmount(d.amountRaw, chainId === BNB_CHAIN_ID || symbol === "USD1" ? 18 : USDC_DECIMALS),
        symbol,
        chainId: Number.isSafeInteger(chainId) ? chainId : null,
        txHash: typeof d.txHash === "string" ? d.txHash : null,
        at: typeof d.createdAt === "string" ? d.createdAt : "",
        phase: depositPhase(d.status),
        providerStatus: typeof d.status === "string" ? d.status.slice(0, 40) : "",
      };
    })
    .sort((a, b) => Date.parse(b.at || "0") - Date.parse(a.at || "0"));
}

/* ------------------------------------------------------------------ withdrawals */

export type WithdrawPreview = Readonly<{
  status: "quoted" | "unviable";
  amountRaw: string;
  /** What reaches the wallet, an estimate re-priced at the send. */
  receiveRaw: string | null;
  feeRaw: string | null;
  expiresAt: string | null;
  /** The most that can be delivered now, when the aggregator states it. */
  maxDeliverableRaw: string | null;
  /** Why it cannot be sent, in Ryntra's terms; the aggregator's text is kept beside it for Details. */
  reason: "below_minimum" | "insufficient" | "above_max" | "fee_exceeds" | "route_unavailable" | "other" | null;
  providerReason: string | null;
}>;

function rawOrNull(value: unknown): string | null {
  return typeof value === "string" && DIGITS.test(value) ? value : null;
}

/** The aggregator's reason text changes; branch on the status and the maximum first, read the words only to name the case. */
export function unviableReason(text: string | null, maxDeliverableRaw: string | null): WithdrawPreview["reason"] {
  if (maxDeliverableRaw !== null) return "above_max";
  const t = (text ?? "").toLowerCase();
  if (/insufficient/.test(t)) return "insufficient";
  if (/under 1|below|minimum|at least|less than 1/.test(t)) return "below_minimum";
  if (/fee exceeds|exceeds the amount|network fee/.test(t)) return "fee_exceeds";
  if (/liquidity|route|try again/.test(t)) return "route_unavailable";
  return "other";
}

export function mapPreview(answer: unknown, amountRaw: string): WithdrawPreview {
  const body = (answer ?? {}) as Readonly<Record<string, unknown>>;
  const quoted = body.pricingStatus === "quoted";
  const receiveRaw = rawOrNull(body.receiveAmountRaw);
  const maxDeliverableRaw = rawOrNull(body.maxDeliverableRaw);
  const providerReason = typeof body.unviableReason === "string" ? body.unviableReason.slice(0, 300) : null;
  /* A quote with nothing to deliver is not a quote. */
  if (!quoted || receiveRaw === null || BigInt(receiveRaw) <= 0n) {
    return { status: "unviable", amountRaw, receiveRaw: null, feeRaw: null, expiresAt: null, maxDeliverableRaw, reason: unviableReason(providerReason, maxDeliverableRaw), providerReason };
  }
  return { status: "quoted", amountRaw, receiveRaw, feeRaw: rawOrNull(body.feeRaw), expiresAt: typeof body.quoteExpiresAt === "string" ? body.quoteExpiresAt : null, maxDeliverableRaw, reason: null, providerReason: null };
}

/**
 * Whether the amount delivered fell enough since the Review that the person
 * must see it again before it is sent.
 */
export function receiveDropped(reviewedRaw: string, nowRaw: string | null, toleranceBps = RECEIVE_DROP_TOLERANCE_BPS): boolean {
  if (nowRaw === null) return true;
  const reviewed = BigInt(reviewedRaw);
  const now = BigInt(nowRaw);
  return now * 10_000n < reviewed * BigInt(10_000 - toleranceBps);
}

/**
 * The least the send may deliver and still go as reviewed — the bound
 * `receiveDropped` holds the send to, rounded down to whole cents so the
 * figure the Review names is never above it. Null when there is no quote.
 */
export function receiveFloorRaw(reviewedRaw: string | null, toleranceBps = RECEIVE_DROP_TOLERANCE_BPS): string | null {
  if (reviewedRaw === null || !DIGITS.test(reviewedRaw)) return null;
  const scaled = BigInt(reviewedRaw) * BigInt(10_000 - toleranceBps);
  const floor = (scaled + 9_999n) / 10_000n;
  const cent = 10n ** BigInt(USDC_DECIMALS - 2);
  return ((floor / cent) * cent).toString();
}

/**
 * Where a withdrawal stands, in the product's words.
 *
 * - `sending`   — Ryntra recorded it and is asking the aggregator now;
 * - `in_flight` — accepted, moving (`pending`, `bridging`, `transferring`);
 * - `completed` / `partial` / `failed` — the aggregator's terminal states
 *   (failed: nothing delivered, in its own words);
 * - `unknown`   — the aggregator did not answer the send, or answered a state
 *   the reader does not know. Never shown as done, never as "nothing sent":
 *   the same request is asked again until it answers.
 */
export type WithdrawalPhase = "sending" | "in_flight" | "completed" | "partial" | "failed" | "unknown";

export function withdrawalPhase(status: unknown): WithdrawalPhase {
  switch (status) {
    case "pending":
    case "bridging":
    case "transferring":
      return "in_flight";
    case "completed":
      return "completed";
    case "partial":
      return "partial";
    case "failed":
      return "failed";
    default:
      return "unknown";
  }
}

export function isTerminal(phase: WithdrawalPhase): boolean {
  return phase === "completed" || phase === "partial" || phase === "failed";
}

export type ProviderWithdrawal = Readonly<{
  withdrawalId: string;
  phase: WithdrawalPhase;
  providerStatus: string;
  completedRaw: string | null;
  destination: Readonly<{ chainId: number | null; address: string | null }>;
  txHashes: readonly string[];
  errorMessage: string | null;
}>;

/** A withdrawal as `POST /execution/withdraw` and `GET /execution/withdrawals/{id}` answer it; null when the answer carries no id. */
export function mapWithdrawal(answer: unknown): ProviderWithdrawal | null {
  const body = (answer ?? {}) as Readonly<Record<string, unknown>>;
  if (typeof body.withdrawalId !== "string" || body.withdrawalId.length === 0) return null;
  const destination = (body.destination ?? {}) as Readonly<{ chainId?: unknown; address?: unknown }>;
  const hashes = new Set<string>();
  for (const list of [body.sources, body.legs]) {
    if (!Array.isArray(list)) continue;
    for (const item of list as Readonly<{ txHash?: unknown }>[]) if (typeof item?.txHash === "string" && item.txHash) hashes.add(item.txHash);
  }
  return {
    withdrawalId: body.withdrawalId,
    phase: withdrawalPhase(body.status),
    providerStatus: typeof body.status === "string" ? body.status.slice(0, 40) : "",
    completedRaw: rawOrNull(body.completedAmountRaw),
    destination: { chainId: Number.isSafeInteger(Number(destination.chainId)) ? Number(destination.chainId) : null, address: typeof destination.address === "string" ? destination.address : null },
    txHashes: [...hashes].slice(0, 8),
    errorMessage: typeof body.errorMessage === "string" ? body.errorMessage.slice(0, 300) : null,
  };
}

/**
 * Whether the provider's withdrawal goes where Ryntra asked: the proven
 * wallet, on Solana. An answer that names another address or chain — or
 * names none — is not trusted as delivering to the person.
 */
/** Ryntra's note on a record whose provider withdrawal names another destination than the proven wallet on Solana. */
export const DESTINATION_MISMATCH = "DESTINATION_MISMATCH";

export function destinationMatches(withdrawal: ProviderWithdrawal, wallet: string, chainId: number): boolean {
  return withdrawal.destination.address === wallet && withdrawal.destination.chainId === chainId;
}
