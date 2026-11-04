/**
 * Earn's three actions: what the page reads, what a Review is built from, and what happens to the
 * bytes the wallet signed.
 *
 * The three jobs are kept apart because they have different authority. Reading markets and positions moves
 * nothing and is open to anyone looking. Building a Review builds bytes and therefore asks the gate. Relaying
 * signed bytes spends money and therefore asks the gate again, asks the provider again, and compares the
 * bytes against the seal before anything leaves this process.
 *
 * The dependencies are injectable for one reason: the five cases this row has to be right about — a market
 * with no liquidity, a rate that moved between the quote and the signature, a provider that refuses, a
 * partial withdrawal and a key that was never configured — are all proven on fixtures in
 * `actions.test.mjs`, with no network and no wallet anywhere near them.
 */

import { withRpcDiscipline, type SolanaRpcHandle } from "../solana/rpc.ts";

import type { HeldReader } from "./chain.ts";
import type { EarnAdapter, EarnFailure } from "./contract.ts";
import { admitEarn, withinCanary } from "./gate.ts";
import {
  EARN_FEE_BPS,
  usdOf,
  WALLET_ADDRESS,
  type EarnAction,
  type EarnMarket,
  type EarnPosition,
  type EarnProviderId,
  type EarnProviderState,
  type EarnUnavailable,
} from "./model.ts";
import type { Env } from "./providers.ts";
import { buildEarnReceipt, stateFromStatus, type EarnReceipt } from "./receipt.ts";
import { buildEarnReview, checkFreshAtSigning, type EarnReview } from "./review.ts";
import { checkEarnSigned, earnTicketKeyConfigured, issueEarnTicket, messageDigestOf, readEarnTicket } from "./ticket.ts";

/**
 * Everything these actions need from the outside, handed in rather than reached for.
 *
 * It is the reason the five cases this row has to be right about are provable without a network, a wallet or
 * a key: the providers, the chain, the clock and the one function that sends bytes are all arguments. The
 * production set is built in `service.server.ts`.
 */
export type EarnDeps = Readonly<{
  /** The environment the gate and the ticket's secret are read from. */
  env: Env;
  /** The providers, in the order they are drawn. */
  adapters: readonly EarnAdapter[];
  /** What the wallet holds on chain. */
  readHeld: HeldReader;
  /** The RPC handle the signed bytes leave through, and signatures are read on. */
  handle: () => SolanaRpcHandle;
  /** The one send. Injected so a test can prove that a refused Review never reaches it. */
  send: (args: { handle: SolanaRpcHandle; signedWireBase64: string }) => Promise<string>;
  /**
   * How long the bytes just built may still be signed for, measured on the chain.
   *
   * The provider hands back a transaction and not the block height its blockhash dies at, so the window is
   * one blockhash's life at the slot speed the chain is actually running, less the time the build itself
   * took. A fixed number here would be a promise about somebody else's blockhash.
   */
  signableWindowMs: (startedAtMs: number) => Promise<number>;
  /**
   * The wallet's native SOL, lamports, or null when it was not read (CITY-192). Jupiter Lend's SOL market supplies
   * wrapped SOL and its deposit wraps the native balance itself, so a SOL deposit is checked against both; without
   * this reader only SOL already wrapped counts.
   */
  readNative?: (owner: string) => Promise<bigint | null>;
  now?: () => number;
}>;

/** Wrapped SOL's mint: Jupiter Lend's SOL market supplies it. */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * What a SOL deposit leaves in the wallet for the network: the deposit's signature and priority fees and the
 * deposit for a new wrapped-SOL account, which comes back when it closes. 0.01 SOL covers all of it.
 */
export const NATIVE_RESERVE_LAMPORTS = 10_000_000n;

/** The SOL a deposit may take: wrapped SOL held, and native SOL beyond the reserve; null when neither was read. */
export function solSpendable(wrapped: bigint | null, native: bigint | null): bigint | null {
  if (wrapped === null && native === null) return null;
  const free = native === null ? 0n : native > NATIVE_RESERVE_LAMPORTS ? native - NATIVE_RESERVE_LAMPORTS : 0n;
  return (wrapped ?? 0n) + free;
}

export type Answer<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; status: number; code: string; reason: string }>;

const failure = (status: number, code: string, reason: string): Readonly<{ ok: false; status: number; code: string; reason: string }> => ({
  ok: false,
  status,
  code,
  reason,
});

/* ------------------------------------------------------------------- reading */

export type EarnSurface = Readonly<{
  providers: readonly EarnProviderState[];
  /** Every position this wallet holds across the providers that answered; empty for a guest. */
  positions: readonly EarnPosition[];
  /** What may be done now: the gate's own state, and the ceiling under a canary. */
  actions: Readonly<{ open: boolean; mode: "CLOSED" | "CANARY" | "OPEN"; maxUsd: number | null }>;
  /** Ryntra's cut, carried to the surface so the page states it from the same place the Review does. */
  feeBps: number;
  readAt: string;
}>;

/**
 * The page's whole read: both providers, their markets or the reason there are none, and — with a wallet —
 * the positions.
 *
 * A provider that fails does not fail the page: the other one is still drawn, and the one that failed says
 * what happened in its own row. That is the difference between «Earn is down» and «Jupiter Lend needs a key».
 */
export async function readEarnSurface(owner: string | null, deps: EarnDeps): Promise<EarnSurface> {
  const now = deps.now ?? Date.now;
  const admission = admitEarn(owner, deps.env);
  const sealed = earnTicketKeyConfigured(deps.env);
  const states: EarnProviderState[] = [];
  const positions: EarnPosition[] = [];

  for (const adapter of deps.adapters) {
    if (adapter.blocked) {
      states.push({ provider: adapter.provider, ok: false, ...adapter.blocked });
      continue;
    }
    const read = await adapter.markets();
    if (!read.ok) {
      states.push({ provider: adapter.provider, ok: false, code: unavailableOf(read), reason: read.reason });
      continue;
    }
    states.push({ provider: adapter.provider, ok: true, markets: read.markets });
    if (owner && WALLET_ADDRESS.test(owner)) {
      const held = await adapter.positions(owner, read.markets);
      /* A position of none is not a position; a position nobody could read is, and it says «not read» on
         every figure rather than disappearing. */
      if (held.ok) positions.push(...held.positions.filter((position) => position.sharesRaw !== "0"));
    }
  }

  return {
    providers: states,
    positions,
    actions: {
      /* Three things, all of them: the gate, a wallet to act for, and a secret to seal the Review with.
         Sealing belongs here because a Review that cannot be sealed is an action offered and then refused at
         the last step, which is worse than one that was never offered. */
      open: admission.ok && sealed && owner !== null,
      mode: admission.ok ? admission.mode : "CLOSED",
      maxUsd: admission.ok ? admission.maxUsd : null,
    },
    feeBps: EARN_FEE_BPS,
    readAt: new Date(now()).toISOString(),
  };
}

/** A failure's code narrowed to the four a surface draws differently; anything else reads as an outage. */
function unavailableOf(read: EarnFailure): EarnUnavailable {
  const code = read.code;
  return code === "NO_KEY" || code === "DISABLED" || code === "UNREADABLE" || code === "PROVIDER_DOWN" ? code : "PROVIDER_DOWN";
}

/* -------------------------------------------------------------------- Review */

export type EarnRequest = Readonly<{ provider: EarnProviderId; action: EarnAction; owner: string; marketId: string; amount: string }>;

/** The browser's body, field by field; anything else is refused before a provider or the chain is asked. */
export function parseEarnRequest(body: unknown): EarnRequest | null {
  if (!body || typeof body !== "object") return null;
  const { provider, action, owner, market, amount } = body as Record<string, unknown>;
  if (provider !== "jupiter" && provider !== "kamino") return null;
  if (action !== "deposit" && action !== "withdraw") return null;
  if (typeof owner !== "string" || !WALLET_ADDRESS.test(owner)) return null;
  if (typeof market !== "string" || !WALLET_ADDRESS.test(market)) return null;
  if (typeof amount !== "string" || !/^\d{1,32}$/.test(amount) || BigInt(amount) <= 0n) return null;
  return { provider, action, owner, marketId: market, amount };
}

export async function reviewEarn(body: unknown, deps: EarnDeps): Promise<Answer<EarnReview>> {
  const now = (deps.now ?? Date.now)();
  const request = parseEarnRequest(body);
  if (!request) return failure(400, "BAD_REQUEST", "A Review takes a provider, an action, a wallet, a market and an amount.");

  const admission = admitEarn(request.owner, deps.env);
  if (!admission.ok) return failure(403, "ACTIONS_CLOSED", "Earn actions are not open for this wallet now.");
  if (!earnTicketKeyConfigured(deps.env)) return failure(503, "ACTIONS_CLOSED", "Earn actions are not open here: the Review cannot be sealed.");

  const adapter = deps.adapters.find((entry) => entry.provider === request.provider);
  if (!adapter) return failure(404, "NO_PROVIDER", "No such Earn provider.");
  if (adapter.blocked) return failure(503, adapter.blocked.code, adapter.blocked.reason);

  /* The market first, because the position and the wallet are read in its own units. */
  const markets = await adapter.markets();
  if (!markets.ok) return failure(markets.status ?? 502, markets.code, markets.reason);
  const market = markets.markets.find((entry) => entry.id === request.marketId);
  if (!market) return failure(404, "NO_MARKET", "This provider does not list that market.");

  const asked = BigInt(request.amount);
  const { walletRaw, positionRaw } = await holdings(request, market, adapter, deps);

  const built = await adapter.build({
    action: request.action,
    owner: request.owner,
    marketId: request.marketId,
    askedRaw: asked,
    walletRaw,
    positionRaw,
  });
  if (!built.ok) return failure(built.status ?? 502, built.code, built.reason);

  /* The canary's ceiling is checked on what will actually move, priced by the market the bytes were built
     against — not on what was asked for, which on a partial withdrawal is a different number. */
  const usd = usdOf(built.amountRaw, built.market.asset.decimals, built.market.priceUsd);
  if (!withinCanary(admission, usd)) return failure(403, "CANARY_LIMIT", "The check takes a smaller amount.");

  /* Measured after the bytes exist, with the build's own time subtracted: that is the window a person has. */
  const signableMs = await deps.signableWindowMs(now);

  const messageSha256 = messageDigestOf(built.wireBase64);
  if (!messageSha256) return failure(502, "UNREADABLE", "The provider's transaction could not be read.");

  const ticket = issueEarnTicket(
    {
      provider: adapter.provider,
      owner: request.owner,
      action: request.action,
      market: built.market.asset.mint,
      amount: built.amountRaw.toString(),
      decimals: built.market.asset.decimals,
      rate: built.market.rateAnnualPercent,
      message: messageSha256,
    },
    deps.env,
    now,
  );
  if (!ticket) return failure(503, "ACTIONS_CLOSED", "Earn actions are not open here: the Review cannot be sealed.");

  return {
    ok: true,
    value: buildEarnReview({
      action: request.action,
      market: built.market,
      planned: { amountRaw: built.amountRaw, askedRaw: asked, partial: built.partial, leftRaw: built.leftRaw },
      positionRaw,
      transaction: { wireBase64: built.wireBase64, messageSha256 },
      ticket,
      now,
      signableMs,
    }),
  };
}

/** What the wallet holds of the asset, and what its position in this market is worth. */
async function holdings(
  request: EarnRequest,
  market: EarnMarket,
  adapter: EarnAdapter,
  deps: EarnDeps,
): Promise<Readonly<{ walletRaw: bigint | null; positionRaw: bigint | null }>> {
  const held = deps.readHeld;
  if (request.action === "deposit") {
    const chain = await held(request.owner, [market.asset.mint]);
    const wrapped = chain.held.get(market.asset.mint) ?? null;
    if (market.asset.mint === WSOL_MINT && deps.readNative) {
      return { walletRaw: solSpendable(wrapped, await deps.readNative(request.owner).catch(() => null)), positionRaw: null };
    }
    return { walletRaw: wrapped, positionRaw: null };
  }
  const positions = await adapter.positions(request.owner, [market]);
  const position = positions.ok ? positions.positions.find((entry) => entry.marketId === market.id) : undefined;
  return { walletRaw: null, positionRaw: position?.underlyingRaw ? BigInt(position.underlyingRaw) : null };
}

/* -------------------------------------------------------------------- relay */

/**
 * The signed bytes, after the three questions that can still stop them.
 *
 * Is the gate still open for this wallet and this amount — a gate that closed while the wallet was open sends
 * nothing. Is the market still what the Review said — the rate within tolerance, the liquidity still able to
 * pay a withdrawal. Are these the bytes the Review sealed, really signed by the Review's wallet.
 *
 * Only then does anything leave, once, through the product's own primary endpoint. After that the answer is
 * never «nothing happened»: a signature exists, and an unread chain is `UNKNOWN` for the receipt to follow.
 */
export async function submitEarn(body: unknown, deps: EarnDeps): Promise<Answer<EarnReceipt>> {
  const now = (deps.now ?? Date.now)();
  if (!body || typeof body !== "object") return failure(400, "BAD_REQUEST", "A relay takes a ticket and the signed transaction.");
  const { ticket: sealed, signed } = body as Record<string, unknown>;

  const read = readEarnTicket(sealed, deps.env, now);
  if (!read.ok) {
    return read.code === "TICKET_EXPIRED"
      ? failure(410, "TICKET_EXPIRED", "The Review is older than its transaction; review again.")
      : failure(400, "TICKET_INVALID", "The Review's ticket is not one this server sealed.");
  }
  const { ticket } = read;

  const admission = admitEarn(ticket.owner, deps.env);
  if (!admission.ok) return failure(403, "ACTIONS_CLOSED", "Earn actions are not open for this wallet now.");

  const adapter = deps.adapters.find((entry) => entry.provider === ticket.provider);
  if (!adapter) return failure(404, "NO_PROVIDER", "No such Earn provider.");
  if (adapter.blocked) return failure(503, adapter.blocked.code, adapter.blocked.reason);

  const markets = await adapter.markets();
  if (!markets.ok) return failure(markets.status ?? 502, markets.code, markets.reason);
  const fresh = markets.markets.find((entry) => entry.asset.mint === ticket.market) ?? null;
  const amountRaw = BigInt(ticket.amount);
  const checked = checkFreshAtSigning({ action: ticket.action, quotedRatePercent: ticket.rate, amountRaw, fresh });
  if (!checked.ok) return failure(409, checked.code, checked.reason);
  if (!withinCanary(admission, usdOf(amountRaw, ticket.decimals, fresh?.priceUsd ?? null))) {
    return failure(403, "CANARY_LIMIT", "The check takes a smaller amount.");
  }

  const bytes = checkEarnSigned(ticket, signed);
  if (!bytes.ok) {
    return bytes.code === "NOT_SIGNED"
      ? failure(422, "NOT_SIGNED", "A signature is missing or does not match.")
      : failure(422, "SIGNED_MISMATCH", "The signed bytes are not the ones Review showed.");
  }

  const handle = deps.handle();
  const send = deps.send;
  const asset = fresh?.asset ?? { mint: ticket.market, symbol: "", decimals: ticket.decimals };
  const receipt = (state: "LANDED" | "FAILED" | "UNKNOWN", reason: string | null): EarnReceipt =>
    buildEarnReceipt({
      provider: ticket.provider,
      action: ticket.action,
      signature: bytes.signature,
      state,
      reason,
      amountRaw,
      asset,
      rateAnnualPercent: ticket.rate,
      rateDriftBps: checked.driftBps,
      sentAt: now,
    });

  try {
    await send({ handle, signedWireBase64: bytes.wire });
  } catch (sendFailure) {
    const message = sendFailure instanceof Error ? sendFailure.message : String(sendFailure);
    /* A preflight refusal means the cluster never took the bytes — unless it has seen them already, which is
       the chain's business to answer and not a reason to tell anybody nothing was sent. */
    if (/simulation failed|preflight|blockhash not found/i.test(message) && !/already been processed|AlreadyProcessed/i.test(message)) {
      return failure(422, /blockhash not found/i.test(message) ? "TICKET_EXPIRED" : "RELAY_REFUSED", "The network refused the transaction before it was sent. Nothing moved.");
    }
  }

  const state = await readSignature(bytes.signature, handle);
  return { ok: true, value: receipt(state.state, state.reason) };
}

/** One signature as the chain has it now; `UNKNOWN` when nothing answered, never a guess. */
export async function readSignature(
  signature: string,
  handle: SolanaRpcHandle,
): Promise<Readonly<{ state: "LANDED" | "FAILED" | "UNKNOWN"; reason: string | null }>> {
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.getSignatureStatuses([signature as never], { searchTransactionHistory: true }).send({ abortSignal }),
    );
    const value = (response as { value?: readonly unknown[] }).value ?? [];
    return stateFromStatus(value[0] ?? null);
  } catch {
    return { state: "UNKNOWN", reason: null };
  }
}

/** The chain's word on signatures whose relay answer was lost on the way back to the browser. */
export async function readEarnSignatures(signatures: readonly string[], deps: EarnDeps) {
  const handle = deps.handle();
  return Promise.all(signatures.slice(0, 5).map(async (signature) => ({ signature, ...(await readSignature(signature, handle)) })));
}
