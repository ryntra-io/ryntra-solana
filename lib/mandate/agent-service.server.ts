/**
 * The agent as a service, on devnet and on mainnet: what the cron and the
 * window's routes call.
 *
 * - `agentMinute` — one pass of the agent over its book (`./tick.server.ts`), every few minutes (vercel.json).
 * - `joinBook` — a mandate the person just signed joins the agent's book with her strategy (`./book.server.ts`).
 * - `agentResult` — what the agent did for her: its trades, what it spent and bought, and what that is worth now.
 *
 * The switches are the mandate's own (`./service.server.ts`): `RYNTRA_AGENT_MANDATE=devnet` with its pool and its
 * agent's address. The agent works only with its key there too, and only with a store that survives a cold start;
 * anything else and it sits still. The key — one switch `RYNTRA_AGENT_MANDATE_SIGNER`, the same interface as
 * Launch's keys:
 * - unset or `env` — `RYNTRA_AGENT_MANDATE_KEY`, the devnet key whose public half is the gate's agent;
 * - `kms` — `RYNTRA_AGENT_MANDATE_KMS_KEY`, a Google Cloud KMS key version that must be the gate's agent, reached the way
 *   Launch's are (`RYNTRA_LAUNCH_KMS_*`); the environment's key is never read then;
 * - anything else — no key: a switch mistyped stops the agent; it never falls back.
 * On mainnet only `kms` signs, and only as the registry's agent (`solana-agent-signer`); the venue is Jupiter's `/build`.
 */

import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { PublicKey, type Connection } from "@solana/web3.js";

import { getGuardRuntime } from "../guard/runtime.ts";
import { storeSurvivesColdStart, type GuardStore } from "../guard/store.ts";
import { envKey } from "../launch/signer/env.server.ts";
import { KMS_KEY_VERSION, kmsEndpoint, kmsKeySigner, kmsPublicAddress, kmsTokenSource, type Fetch, type KmsAccess } from "../launch/signer/gcp-kms.server.ts";
import type { KeySigner } from "../launch/signer/signer.server.ts";
import { resolveJupiterSwapEndpoint } from "../solana/quotes.ts";
import { fundOf, heldDailyKnown, heldOfRecord, networkOf as networkRawOf, planOfEntry, readEntry, registerMandate, TRADES_KEPT, type BookEntry, type BookStatus, type OpenGate, type RegisterResult } from "./book.server.ts";
import { botMoneyOn, type EngineSwitches, type MoneyBot } from "../bots/money/gates.ts";
import { AGENT_EXIT_ENV, agentExitOn, agentSalesView } from "./exit.server.ts";
import { isFrozen } from "./freeze.server.ts";
import { missionOf, reconcile, tradeState, type Books, type Mission, type TradeState } from "./mission.ts";
import { earlyRefusal, launchFactsFrom, planText, STEADY, type ExchangeSession, type LaunchFacts, type StrategyPlan } from "./plans.ts";
import { dlmmBuy, dlmmWorth } from "./dlmm.server.ts";
import { agentFeeAccount, agentFeeRaw, feeAccountRefusal, feeTransferInstruction, pairFeeBps, uncataloguedFacts, type FeeSides } from "./fee.ts";
import { jupiterVenue, jupiterWorth } from "./jupiter.server.ts";
import { mandateConnection, mandateGate, onNetwork, poolOtherToken, type MandateRecord } from "./service.server.ts";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "./ssa.ts";
import { heldAccountOf, proceedsAccountOf } from "./terms.ts";
import { NO_MARKET, type ExitMarket, type ExitRules } from "./exit.ts";
import { earnedWithSales } from "./sale.ts";
import { boughtOf, readSales, runSalePass, saleVenueOf, salesView, walletHolding, type SalesView } from "./sale.server.ts";
import { dayOf, DAY_MS, type AgentDay } from "./report.ts";
import { netOf, type AgentNet } from "./net.ts";
import { resultOf, steadyRhythm, type AgentResult, type PauseReason, type StrategyId } from "./strategy.ts";
import { agentJournal, markUnread, receivedIn, runAgentPass, type PassLine, type Venue } from "./tick.server.ts";
import { TOKEN_2022_PROGRAM_ID, readCoin } from "./token-2022.ts";

export const AGENT_KEY_ENV = "RYNTRA_AGENT_MANDATE_KEY";
export const AGENT_SIGNER_SWITCH = "RYNTRA_AGENT_MANDATE_SIGNER";
export const AGENT_KMS_KEY_ENV = "RYNTRA_AGENT_MANDATE_KMS_KEY";
export const AGENT_SYMBOL_ENV = "RYNTRA_AGENT_MANDATE_SYMBOL";

type Env = Readonly<Record<string, string | undefined>>;

type KeyOptions = Readonly<{ fetch?: Fetch; oidcToken?: () => Promise<string | null> }>;

/** The KMS key version the switch names and how it is reached; null when the switch is not `kms` or names no key. The copy's cron asks it too. */
export function agentKmsAccess(env: Env, options: KeyOptions): KmsAccess | null {
  if (env[AGENT_SIGNER_SWITCH]?.trim().toLowerCase() !== "kms") return null;
  const keyVersion = env[AGENT_KMS_KEY_ENV]?.trim();
  const endpoint = kmsEndpoint(env.RYNTRA_LAUNCH_KMS_ENDPOINT);
  const token = kmsTokenSource(env, options);
  if (!keyVersion || !KMS_KEY_VERSION.test(keyVersion) || !endpoint || !token) return null;
  return { keyVersion, endpoint, token, ...(options.fetch ? { fetch: options.fetch } : {}) };
}

/** The agent's key for this gate, as the switch says; null when it is not configured here or is not the gate's agent. */
export function agentKeyFor(env: Env, gate: OpenGate, options: KeyOptions = {}): KeySigner | null {
  const mode = env[AGENT_SIGNER_SWITCH]?.trim().toLowerCase();
  /* On mainnet the key is Google's or none: the environment's key never signs there. */
  if (gate.network === "mainnet" && mode !== "kms") return null;
  if (!mode || mode === "env") {
    const key = envKey(env[AGENT_KEY_ENV]);
    return key && key.address === gate.agent.toBase58() ? key.signer : null;
  }
  const access = agentKmsAccess(env, options);
  return access ? kmsKeySigner({ ...access, address: gate.agent.toBase58() }) : null;
}

/**
 * The devnet venue: the gate's DLMM pool, the coins straight to the person. Ryntra's fee is the table's share of the
 * amount, sent to Ryntra's fee account just before the swap, which gets the rest; devnet's coin is one no catalogue
 * reads, so the table prices it as a token nobody verified.
 */
export function dlmmVenue(connection: Connection, gate: Extract<OpenGate, { network: "devnet" }>, dependencies: Parameters<typeof dlmmBuy>[2] = {}): Venue {
  return {
    async buy(mandate, amount, receiver, coin) {
      /* A coin of Token-2022 only with every feature of its mint on the agent's list. Devnet has no shelf of
         companies, so no coin is a stock here: the strict rule alone. */
      const mint = await connection.getAccountInfo(coin, "confirmed");
      const epoch = mint?.owner.equals(TOKEN_2022_PROGRAM_ID) ? BigInt((await connection.getEpochInfo("confirmed")).epoch) : undefined;
      const bought = readCoin(coin, mint, epoch);
      if (!bought.ok) throw new Error(bought.reason);
      const budget = NATIVE_MINT.toBase58();
      const feeSides: FeeSides = { input: uncataloguedFacts(budget), output: uncataloguedFacts(coin.toBase58()), nowMs: Date.now() };
      const feeBps = pairFeeBps(budget, coin.toBase58(), feeSides);
      if (feeBps === null) throw new Error("the agent does not trade this pair: Ryntra's table names no router fee for it");
      const feeAccount = feeAccountRefusal(await connection.getAccountInfo(agentFeeAccount(NATIVE_MINT), "confirmed"), NATIVE_MINT);
      if (feeAccount) throw new Error(feeAccount);
      const fee = agentFeeRaw(amount, feeBps);
      const buy = await dlmmBuy(connection, { pool: gate.pool, budgetMint: NATIVE_MINT, vault: mandate.vault, budgetAccount: mandate.budgetAccount, receiver, amount: amount - fee, slippageBps: mandate.terms.slippageBps }, dependencies);
      /*
       * The SDK's own setup is for a wallet that signs: it wraps SOL and opens accounts from `user`, the vault, which signs
       * only inside the policy (the agent's signer rightly refuses it; seen on devnet). The budget is wrapped
       * already; all a first buy may need is the person's account, at the agent's cost.
       */
      const hers = (await connection.getAccountInfo(receiver, "confirmed")) !== null;
      /* A coin the agent keeps lands in the vault's own account of it. */
      const owner = mandate.terms.heldCoin ? mandate.vault : mandate.terms.human;
      return {
        instruction: buy.instruction,
        fee: feeTransferInstruction({ budgetMint: NATIVE_MINT, budgetAccount: mandate.budgetAccount, vault: mandate.vault, fee, decimals: 9 }),
        feeSides,
        setup: hers ? [] : [createAssociatedTokenAccountIdempotentInstruction(mandate.terms.agent, receiver, owner, coin, bought.coin.program)],
        promisedOut: buy.quoteOut,
        coin: bought.coin,
        ...(epoch === undefined ? {} : { epoch }),
      };
    },
    /*
     * The agent's own sale on devnet: the pool sells the coin from the vault's account of it into her wSOL;
     * Ryntra's fee is the transfer of the table's share of the coin just before, into Ryntra's account of that coin.
     */
    async sell(mandate, amount, coin) {
      const held = mandate.terms.heldCoin;
      if (!held || !held.mint.equals(coin) || !mandate.salePolicy) throw new Error("the mandate keeps no such coin to sell");
      const mint = await connection.getAccountInfo(coin, "confirmed");
      const sold = readCoin(coin, mint, undefined);
      if (!sold.ok || !sold.coin.program.equals(TOKEN_PROGRAM_ID) || !mint) throw new Error(sold.ok ? "on devnet's pool the agent sells only a coin of Token" : sold.reason);
      const decimals = mint.data[44]!;
      const feeSides: FeeSides = { input: uncataloguedFacts(coin.toBase58()), output: uncataloguedFacts(NATIVE_MINT.toBase58()), nowMs: Date.now() };
      const feeBps = pairFeeBps(coin.toBase58(), NATIVE_MINT.toBase58(), feeSides);
      if (feeBps === null) throw new Error("the agent does not trade this pair: Ryntra's table names no router fee for it");
      const feeAccount = feeAccountRefusal(await connection.getAccountInfo(agentFeeAccount(coin), "confirmed"), coin);
      if (feeAccount) throw new Error(feeAccount);
      const fee = agentFeeRaw(amount, feeBps);
      const coinAccount = heldAccountOf(mandate.vault, held);
      const receiver = proceedsAccountOf(mandate.terms);
      const swap = await dlmmBuy(connection, { pool: gate.pool, budgetMint: coin, vault: mandate.vault, budgetAccount: coinAccount, receiver, amount: amount - fee, slippageBps: mandate.terms.slippageBps }, dependencies);
      const hers = (await connection.getAccountInfo(receiver, "confirmed")) !== null;
      return {
        instruction: swap.instruction,
        fee: feeTransferInstruction({ budgetMint: coin, budgetAccount: coinAccount, vault: mandate.vault, fee, decimals }),
        feeSides,
        setup: hers ? [] : [createAssociatedTokenAccountIdempotentInstruction(mandate.terms.agent, receiver, mandate.terms.human, NATIVE_MINT, TOKEN_PROGRAM_ID)],
        promisedOut: swap.quoteOut,
        coin: sold.coin,
      };
    },
    received: (signature, receiver) => receivedIn(connection, signature, receiver),
    worth: (_mandate, amount) => dlmmWorth(connection, { pool: gate.pool, budgetMint: NATIVE_MINT, amount }, dependencies),
  };
}

export type MinuteAnswer =
  | Readonly<{ ran: false; why: "closed" | "no-key" | "key-unread" | "wrong-key" | "store" | "not-devnet" | "not-mainnet" }>
  | Readonly<{ ran: true; lines: readonly PassLine[]; sales: readonly Readonly<{ policy: string; did: string }>[] }>;

/**
 * The switches the agent's pass runs by, read from the deployment's environment: the agent's own exit
 * (`RYNTRA_AGENT_EXIT`) and each bot's money (`RYNTRA_BOTS_*_MONEY`); only «on» opens, anything else closes.
 */
export const engineSwitchesOf = (env: Env): EngineSwitches => ({
  agentExit: agentExitOn(env[AGENT_EXIT_ENV]),
  bots: { grid: botMoneyOn("grid", env), signals: botMoneyOn("signals", env) },
});

/** The gate's venue: the devnet pool, or Jupiter's route on mainnet. */
export const venueOf = (connection: Connection, gate: OpenGate): Venue => (gate.network === "mainnet" ? jupiterVenue(connection, resolveJupiterSwapEndpoint()) : dlmmVenue(connection, gate));

/** One pass of the agent, when everything it needs stands; what it did, mandate by mandate (policy addresses only). */
export async function agentMinute(env: Env, deps: Readonly<{ store?: GuardStore; connection?: Connection; now?: () => number; fetch?: Fetch }> = {}): Promise<MinuteAnswer> {
  const gate = mandateGate(env);
  if (!gate.open) return { ran: false, why: "closed" };
  const options = deps.fetch ? { fetch: deps.fetch } : {};
  const key = agentKeyFor(env, gate, options);
  if (!key) return { ran: false, why: "no-key" };
  /*
   * The pass reads every mandate against the gate's agent and ends those signed for another. In KMS the key's
   * address is known only by asking Google, so it is asked first: a key that is not the gate's agent, or one Google does
   * not answer for, runs no pass and touches no mandate.
   */
  const access = key.mode === "kms" ? agentKmsAccess(env, options) : null;
  if (access) {
    const address = await kmsPublicAddress(access).catch(() => null);
    if (address === null) return { ran: false, why: "key-unread" };
    if (address !== gate.agent.toBase58()) return { ran: false, why: "wrong-key" };
  }
  const store = deps.store ?? getGuardRuntime().store;
  if (!storeSurvivesColdStart(store)) return { ran: false, why: "store" };
  const connection = deps.connection ?? mandateConnection(gate.network);
  if (!(await onNetwork(connection, gate.network))) {
    /* No trade without knowing the network; the clock of what it cannot read runs all the same. */
    await markUnread(store, (deps.now ?? Date.now)(), gate.network);
    return { ran: false, why: gate.network === "mainnet" ? "not-mainnet" : "not-devnet" };
  }
  const journal = agentJournal(() => store);
  /* The fade reads the coin's trading — Jupiter's own six- and twenty-four-hour windows; devnet's coin has none. */
  const market = gate.network === "mainnet" ? { market: exitMarketOf } : {};
  /* The engine's switches, from the environment the cron's route handed in — the pass reads none itself. */
  const switches = engineSwitchesOf(env);
  const lines = await runAgentPass({ gate, store, connection, key, journal, venue: venueOf(connection, gate), session: stockSessionOf, switches, ...market, ...(deps.now ? { now: deps.now } : {}) });
  /* The sales a person signed that a request did not finish — the agent sells them, or reads what they brought:
     through the devnet pool, or Jupiter on mainnet. */
  const sales = await runSalePass({ gate, store, connection, key, journal, venue: saleVenueOf(connection, gate), ...(deps.now ? { now: deps.now } : {}) }).catch(() => []);
  return { ran: true, lines, sales };
}

/**
 * The coin's trading now, for the exit's fade (`./exit.ts` `faded`): the six- and twenty-four-hour volumes in
 * USD of Jupiter's own token windows, the very read the coin's page shows (`../spot/markets.server.ts`), loaded on use.
 * A window not read is null, and a fade on a figure not read is never applied.
 */
export async function exitMarketOf(mint: string): Promise<ExitMarket> {
  const { readSpotTokenFacts } = await import("../spot/markets.server.ts");
  const read = await readSpotTokenFacts(mint).catch(() => null);
  if (!read || !read.ok || !read.facts || read.stale) return NO_MARKET;
  const volume = (value: number | null | undefined) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
  return { volumeH6Usd: volume(read.facts.windows.h6.volumeUsd), volumeH24Usd: volume(read.facts.windows.h24.volumeUsd) };
}

/**
 * A stock's exchange now, as the stocks engine reads it (`lib/stocks/pool-facts.server.ts`: the issuer's own
 * trading period, or the feed catalogue's market hours); null when the coin is no stock or the facts were not read — a
 * plan bought only in the exchange's hours then waits.
 */
export async function stockSessionOf(mint: string, now: number): Promise<ExchangeSession | null> {
  const { readPoolFacts } = await import("../stocks/pool-facts.server.ts");
  const facts = await readPoolFacts(mint, now);
  return facts?.isStock ? facts.session : null;
}

/**
 * The facts of one new launch as the city's Pulse reads them now (`GET /api/spot/pulse?feed=new&mode=meme`); null when the
 * launch is not among the new ones or Pulse did not answer.
 */
export async function launchFactsOf(mint: string): Promise<LaunchFacts | null> {
  const { readPulse } = await import("../spot/pulse.server.ts");
  const read = await readPulse("new", "h1", { mode: "meme" });
  if (!read.ok) return null;
  const row = read.rows.find((candidate) => candidate.mint === mint);
  return row ? launchFactsFrom(row) : null;
}

/**
 * The mandate the person just signed, into the agent's book: on mainnet with the coin she named, on devnet the pool's.
 * With her strategy's plan. An early plan's launch is checked again here, by the city's filter on Pulse's facts
 * now — the city's pick is never taken on its word; on devnet, whose coin no Pulse reads, the launch is the mandate's start.
 */
export async function joinBook(
  input: Readonly<{ record: MandateRecord; strategy: StrategyId; said: string | null; coin?: string | null; plan?: StrategyPlan | null; exit?: ExitRules | null }>,
  gate: OpenGate,
  deps: Readonly<{
    store?: GuardStore;
    connection?: Connection;
    receiveMint?: (connection: Connection, pool: PublicKey) => Promise<PublicKey>;
    launchFacts?: (mint: string) => Promise<LaunchFacts | null>;
    now?: () => number;
    exitOn?: boolean;
    /** Whether the deployment opens a bot's money (`../bots/money/gates.ts` `botMoneyOn`); absent — closed. */
    botMoneyOn?: (bot: MoneyBot) => boolean;
    /**
     * Whether the coin's day limit the record names is the one the server read when it built her transactions
     * (`./book.server.ts` `heldDailyKnown`); absent — the book's own ticket is asked.
     */
    heldTicket?: (record: MandateRecord) => Promise<boolean>;
  }> = {},
): Promise<RegisterResult> {
  const store = deps.store ?? getGuardRuntime().store;
  if (!storeSurvivesColdStart(store)) return { ok: false, code: "UNAVAILABLE", reason: "The agent's book is not kept here." };
  /*
   * A budget with the agent's own
   * sale joins only with the coin's day limit Ryntra read for this very policy — the agent counts its sales by it.
   */
  if (input.record.heldDaily !== undefined) {
    const known = await (deps.heldTicket ?? ((record: MandateRecord) => heldDailyKnown(store, gate.network, record)))(input.record).catch(() => null);
    if (known === null) return { ok: false, code: "UNAVAILABLE", reason: "The agent's book is not readable." };
    if (!known) return { ok: false, code: "REFUSED", reason: "The coin's day limit is not the one Ryntra read for this budget." };
  }
  const connection = deps.connection ?? mandateConnection(gate.network);
  if (!(await onNetwork(connection, gate.network))) return { ok: false, code: gate.network === "mainnet" ? "NOT_MAINNET" : "NOT_DEVNET", reason: `The endpoint is not ${gate.network}.` };
  const receiveMint = async (): Promise<PublicKey> => {
    if (gate.network === "devnet") return (deps.receiveMint ?? poolOtherToken)(connection, gate.pool);
    const coin = new PublicKey(input.coin ?? "");
    if (coin.toBase58() !== input.coin || coin.equals(NATIVE_MINT)) throw new Error("not a coin");
    return coin;
  };
  const plan = input.plan ?? STEADY;
  const now = (deps.now ?? Date.now)();
  let bornAt: number | null = null;
  if (plan.id === "early") {
    if (gate.network === "devnet") bornAt = now;
    else {
      const facts = await (deps.launchFacts ?? launchFactsOf)(input.coin ?? "").catch(() => null);
      if (!facts) return { ok: false, code: "REFUSED", reason: "The coin is not a new launch the city reads." };
      const refusal = earlyRefusal(facts, now, plan.maxAgeH);
      if (refusal) return { ok: false, code: "REFUSED", reason: `The launch does not pass the city's check: ${refusal}.` };
      bornAt = Date.parse(facts.firstPoolAt!);
    }
  }
  return registerMandate({ ...input, plan, bornAt }, gate, { store, connection, receiveMint, now: () => now, exitOn: deps.exitOn === true, ...(deps.botMoneyOn ? { botMoneyOn: deps.botMoneyOn } : {}) });
}

/**
 * What the window and «Mine» show: the agent's state, its rhythm, the result, and its last few trades; what
 * it holds for her of its coin and her last sale through it — the result then counts what her sales brought.
 */
export type AgentView = Readonly<{
  status: BookStatus;
  /** Why it paused itself, when `status` is `paused`. */
  pausedBy: PauseReason | null;
  strategy: StrategyId;
  /** The strategy with its numbers (`./plans.ts` `planText`). */
  plan: string;
  receiveMint: string;
  /** The coin's ticker, as the deployment names its devnet pool's coin (`RYNTRA_AGENT_MANDATE_SYMBOL`); null — not named. */
  symbol: string | null;
  everyMs: number;
  result: AgentResult;
  /** The whole mandate after every fee, and plain holding beside it (`./net.ts`). */
  net?: AgentNet;
  /** `state` — done, failed, refused, held for the day's budget, or unknown: sent and being confirmed, never «failed». */
  last: readonly Readonly<{ at: number; ok: boolean; state: TradeState; signature: string | null; spentRaw: string; receivedRaw: string | null }>[];
  /** What it is doing now; whether her «Freeze» is on; the money — budget = spent + left, from the chain and the book. */
  mission?: Mission;
  frozen?: boolean;
  books?: Books;
  /** When the agent last did anything, ms. */
  updatedAt: number;
  /** Its last day, from its own trades, priced now. */
  day?: AgentDay;
  /** Since the person last looked (`?since=`), the same way; absent when not asked. */
  away?: AgentDay;
}> &
  Partial<SalesView>;

export type ViewSpans = Readonly<{ now: number; since?: number | null }>;

/** Ryntra's fee on selling the coin back, the table's rate; null — not read (the highest rate is counted). */
export type ViewCosts = Readonly<{ exitBps: number | null }>;

/** The SOL she put in for the agent's network fees with this mandate's budget (`./book.server.ts`). */
export const networkOf = (entry: Pick<BookEntry, "preset" | "networkRaw">): string => networkRawOf(entry).toString();

/** What the chain and her switch say now — the vault's budget left, the policy, her «Freeze»; null fields — not read. */
export type ViewNow = Readonly<{ frozen: boolean | null; leftRaw: bigint | null; live: boolean | null }>;

/** The mission, her switch and the money, as the view tells them (`./mission.ts`). */
export function missionView(entry: BookEntry, chain: ViewNow, now: number): Readonly<{ mission: Mission; frozen: boolean; books: Books }> {
  const closed = entry.status === "stopped" || chain.live === false;
  return {
    mission: missionOf({ status: entry.status, pausedBy: entry.pausedBy ?? null, frozen: chain.frozen === true, live: chain.live, trades: entry.trades, perTrade: BigInt(entry.record.perTrade), perDay: BigInt(entry.record.perDay), expiresAt: BigInt(entry.record.expiresAt), pace: planOfEntry(entry).pace ?? null, budgetLeft: chain.leftRaw, now }),
    /* A switch not read is shown as it last was — off; the agent itself never buys on a switch it could not read. */
    frozen: chain.frozen === true,
    books: reconcile({ budgetRaw: fundOf(entry), leftRaw: chain.leftRaw, trades: entry.trades, full: entry.trades.length >= TRADES_KEPT, closed }),
  };
}

export function viewOf(entry: BookEntry, worthRaw: bigint | null, symbol: string | null = null, sales: SalesView | null = null, spans: ViewSpans | null = null, costs: ViewCosts | null = null, chain: ViewNow | null = null): AgentView {
  const result = resultOf(entry.trades, worthRaw);
  /* The span's coins are priced as a share of what the worth was read for: what it holds for her, or all it bought. */
  const holding = { heldRaw: sales?.heldRaw ?? result.boughtRaw, worthRaw: worthRaw === null ? null : worthRaw.toString() };
  /* Every figure after every fee, plain holding beside it. */
  const priced = { trades: entry.trades, heldRaw: holding.heldRaw, worthRaw: holding.worthRaw, exitBps: costs?.exitBps ?? null, networkRaw: networkOf(entry) };
  const honest = (day: AgentDay): AgentDay => {
    const net = netOf({ ...priced, span: { since: day.since, until: day.until } });
    return { ...day, netRaw: net.netRaw, holdRaw: net.holdRaw };
  };
  const awayDay = spans && typeof spans.since === "number" && Number.isFinite(spans.since) && spans.since < spans.now ? dayOf(entry.trades, { since: Math.max(spans.since, spans.now - 30 * DAY_MS), until: spans.now }, holding) : null;
  const away = awayDay ? honest(awayDay) : null;
  const net = netOf({ ...priced, gotRaw: sales?.gotRaw ?? null });
  const earned = sales && result.worthRaw !== null ? earnedWithSales(BigInt(result.spentRaw), BigInt(result.worthRaw), BigInt(sales.gotRaw)) : null;
  const spent = BigInt(result.spentRaw);
  return {
    status: entry.status,
    pausedBy: entry.pausedBy ?? null,
    strategy: entry.strategy,
    plan: planText(planOfEntry(entry)),
    receiveMint: entry.receiveMint,
    symbol: symbol && /^[A-Za-z0-9]{1,10}$/u.test(symbol) ? symbol : null,
    everyMs: steadyRhythm(BigInt(entry.record.perTrade), BigInt(entry.record.perDay), planOfEntry(entry).pace ?? null).everyMs,
    result: earned === null ? result : { ...result, earnedRaw: earned.toString(), multiple: spent === 0n ? null : Number(((earned + spent) * 1_000_000n) / spent) / 1_000_000 },
    net,
    last: entry.trades.slice(-5).reverse().map((trade) => ({ at: trade.at, ok: trade.status === "ok", state: tradeState(trade), signature: trade.signature, spentRaw: trade.spentRaw, receivedRaw: trade.receivedRaw })),
    ...(chain ? missionView(entry, chain, spans?.now ?? Date.now()) : {}),
    updatedAt: entry.updatedAt,
    ...(spans ? { day: honest(dayOf(entry.trades, { since: spans.now - DAY_MS, until: spans.now }, holding)) } : {}),
    ...(away ? { away } : {}),
    ...(sales ?? {}),
  };
}

/** The agent's view of one mandate: null when it is not in the book; the worth unread when the pool did not answer. */
export async function agentResult(
  input: Readonly<{ policy: string; owner: string; since?: number | null }>,
  gate: OpenGate,
  deps: Readonly<{ store?: GuardStore; connection?: Connection; worth?: (bought: bigint) => Promise<bigint>; symbol?: string | null; now?: () => number; exitBps?: (coin: PublicKey) => Promise<number | null> }> = {},
): Promise<AgentView | null> {
  const store = deps.store ?? getGuardRuntime().store;
  const entry = await readEntry(store, input.policy, gate.network);
  if (!entry || entry.record.owner !== input.owner) return null;
  const connection = deps.connection ?? mandateConnection(gate.network);
  /* What it holds for her is never more than her wallet holds: a sale that did not go keeps its coin in her vault. */
  const coin = new PublicKey(entry.receiveMint);
  /* An agent that keeps its coin holds it in her vault, and its own sales are its book's. */
  const held = heldOfRecord(entry.record);
  const sales = held
    ? agentSalesView(entry, await connection.getTokenAccountBalance(heldAccountOf(new PublicKey(entry.record.vault), held), "confirmed").then((balance) => BigInt(balance.value.amount), () => null))
    : salesView(boughtOf(entry.trades), await readSales(store, input.policy, gate.network), await walletHolding(connection, new PublicKey(input.owner), coin));
  /* What it still holds for her is worth the venue's price; what her sales brought is SOL already in her wallet. */
  const read = gate.network === "mainnet" ? (amount: bigint) => jupiterWorth({ coin, budgetMint: NATIVE_MINT, amount }, resolveJupiterSwapEndpoint()) : (amount: bigint) => dlmmWorth(connection, { pool: gate.pool, budgetMint: NATIVE_MINT, amount });
  /* The vault's budget left and the policy, read from the chain; her switch from the book — none of them guessed. */
  const [worth, exitBps, leftRaw, policyInfo, frozen] = await Promise.all([
    (deps.worth ?? read)(BigInt(sales.heldRaw)).catch(() => null),
    (deps.exitBps ?? ((mint: PublicKey) => exitFeeBps(mint, gate.network)))(coin).catch(() => null),
    Promise.resolve().then(() => connection.getTokenAccountBalance(new PublicKey(entry.record.budget), "confirmed")).then(
      (balance) => BigInt(balance.value.amount),
      /* An account the chain does not have holds nothing; any other error is not a read. */
      (error: unknown) => (/could not find account|Invalid param: could not find/iu.test(String((error as Error)?.message ?? error)) ? 0n : null),
    ),
    Promise.resolve().then(() => connection.getAccountInfo(new PublicKey(entry.record.policy), "confirmed")).then(
      (info) => info !== null,
      () => null,
    ),
    isFrozen(store, gate.network, input.policy).catch(() => null),
  ]);
  return viewOf(entry, worth, deps.symbol ?? null, sales, { now: (deps.now ?? Date.now)(), since: input.since ?? null }, { exitBps }, { frozen, leftRaw, live: policyInfo });
}

/**
 * Ryntra's fee on selling the coin back into SOL, the table's rate for the pair as a sale reads it; devnet's
 * coins by their mint alone. Null when the catalogue does not answer: the result then counts the highest rate.
 */
export async function exitFeeBps(coin: PublicKey, network: "devnet" | "mainnet"): Promise<number | null> {
  const nowMs = Date.now();
  if (network === "devnet") return pairFeeBps(coin.toBase58(), NATIVE_MINT.toBase58(), { input: uncataloguedFacts(coin.toBase58()), output: uncataloguedFacts(NATIVE_MINT.toBase58()), nowMs });
  const { readSideFacts } = await import("../core/solana-swap/fee-route.server.ts");
  const [input, output] = await Promise.all([readSideFacts(coin.toBase58()), readSideFacts(NATIVE_MINT.toBase58())]);
  return pairFeeBps(coin.toBase58(), NATIVE_MINT.toBase58(), { input, output, nowMs });
}
