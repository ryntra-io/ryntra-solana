/**
 * The agent's budget behind the city's window, on devnet and on mainnet.
 *
 * The window asks for three things and each is a transaction the person's wallet signs and this server only relays:
 * turn the agent on with a budget (`review`), stop it and take the rest back (`stop`), and what stands now (`status`).
 * This server holds no key and signs nothing; the agent's own key and its trading are the engine's (`./run.server.ts`).
 *
 * The switch goes by the release protocol, as the ladder's does (decision 92): devnet → a release with a point to roll
 * back to → the operator tries it himself. Mainnet is this change of code, merged after the
 * audit of Squads' policy layer; before it, no value of the switch opened mainnet.
 * - `RYNTRA_AGENT_MANDATE` — `devnet` or `mainnet` opens the routes; anything else closes them (they answer 404).
 * - `RYNTRA_AGENT_MANDATE_POOL` — the devnet DLMM pool the agent buys in (Jupiter is not deployed on devnet).
 * - `RYNTRA_AGENT_MANDATE_AGENT` — the agent's public address: the policy's one signer. On mainnet the address is the
 *   registry's (`solana-agent-signer`, its key in Google Cloud KMS) and nothing else; this, when set, must name it.
 * The chain is asked first, every time: an endpoint that is not the gate's network builds, relays and trades nothing.
 */

import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { resolveEndpoint } from "../solana/rpc.ts";
import { ed25519Valid } from "../solana/limits/trigger-tx.ts";
import { onDevnet } from "../bots/ladder/connection.server.ts";
import { fits, planEnable, planStopAndWithdraw, planWithdrawHeld, tokenAccountOf, unsignedTransaction, type HeldBalance, type Mandate } from "./human.ts";
import type { SideFacts } from "../core/fee-policy.ts";
import { pairFeeBps } from "./fee-rates.ts";
import { NATIVE_MINT, TOKEN_PROGRAM_ID, readPolicyHead, readProgramConfig, readSettings, ssaAddress, SSA_PROGRAM_ID } from "./ssa.ts";
import { readShelfCoin, stocksOf, type StockShelf } from "./stocks.server.ts";
import { EXTENSION, TOKEN_2022_PROGRAM_ID, USDC_MINTS, isTokenProgram, mintExtensions, pausedNow, readCoin, type Coin } from "./token-2022.ts";
import { agentNetworkOf, budgetFund, budgetRefusal, type AgentBudget } from "./budget.ts";
import { heldIn } from "./result.ts";
import { heldAccountOf, heldDailyMax, proceedsAccountOf } from "./terms.ts";
import { NO_TIDY, tidyIsEmpty, withTidy, type Tidy } from "./tidy.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import type { GuardStore } from "../guard/store.ts";
import { storeScreen, type CoinOrigin } from "./ryntra-coins.server.ts";
import { rememberHeldDaily } from "./book.server.ts";

export const MANDATE_ENV = "RYNTRA_AGENT_MANDATE";
export const MANDATE_POOL_ENV = "RYNTRA_AGENT_MANDATE_POOL";
export const MANDATE_AGENT_ENV = "RYNTRA_AGENT_MANDATE_AGENT";

type Env = Readonly<Record<string, string | undefined>>;

const addressOf = (value: string | undefined): PublicKey | null => {
  const text = value?.trim();
  if (!text) return null;
  try {
    const key = new PublicKey(text);
    return key.toBase58() === text ? key : null;
  } catch {
    return null;
  }
};

export type MandateNetwork = "devnet" | "mainnet";

export type MandateGate =
  | Readonly<{ open: true; network: "devnet"; pool: PublicKey; agent: PublicKey }>
  | Readonly<{ open: true; network: "mainnet"; pool: null; agent: PublicKey }>
  | Readonly<{ open: false }>;

/** The agent's one address on mainnet: the registry's open `AGENT_SIGNER` row, whose key lives in Google Cloud KMS. */
export function registryAgent(rows = ATTRIBUTION_REGISTRY): PublicKey | null {
  const open = rows.filter((row) => row.role === "AGENT_SIGNER" && row.network === "solana" && row.end === null);
  return open.length === 1 ? addressOf(open[0]!.address ?? undefined) : null;
}

/** The server's switch: devnet with its pool and its agent, mainnet with the registry's agent, or closed. */
export function mandateGate(env: Env): MandateGate {
  const network = env[MANDATE_ENV]?.trim();
  if (network === "mainnet") {
    const agent = registryAgent();
    const named = env[MANDATE_AGENT_ENV]?.trim();
    return agent && (!named || named === agent.toBase58()) ? { open: true, network: "mainnet", pool: null, agent } : { open: false };
  }
  if (network !== "devnet") return { open: false };
  const pool = addressOf(env[MANDATE_POOL_ENV]);
  const agent = addressOf(env[MANDATE_AGENT_ENV]);
  return pool && agent ? { open: true, network: "devnet", pool, agent } : { open: false };
}

/** Mainnet's genesis hash: the chain itself says which network an endpoint serves. */
export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const onMainnetKnown = new WeakMap<object, true>();

/** Whether a connection really serves the network: asked of the chain, a yes kept per connection. */
export async function onNetwork(connection: Pick<Connection, "getGenesisHash">, network: MandateNetwork): Promise<boolean> {
  if (network === "devnet") return onDevnet(connection);
  if (onMainnetKnown.has(connection)) return true;
  const ok = await connection.getGenesisHash().then((hash) => hash === MAINNET_GENESIS, () => false);
  if (ok) onMainnetKnown.set(connection, true);
  return ok;
}

const notNetwork = (network: MandateNetwork) => ({ ok: false as const, code: network === "devnet" ? "NOT_DEVNET" : "NOT_MAINNET", reason: `The endpoint is not ${network}.` });

const cached = new Map<MandateNetwork, { url: string; connection: Connection }>();
export function mandateConnection(network: MandateNetwork = "devnet"): Connection {
  const url = resolveEndpoint(network);
  const kept = cached.get(network);
  if (kept && kept.url === url) return kept.connection;
  const connection = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
  cached.set(network, { url, connection });
  return connection;
}

const toBase64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");

/** The mandate as the window keeps it: public addresses and the terms' numbers. */
export type MandateRecord = Readonly<{
  owner: string;
  settings: string;
  vault: string;
  policy: string;
  budget: string;
  perTrade: string;
  perDay: string;
  expiresAt: string;
  /**
   * The sale's own policy, the coin the agent keeps in the vault (its token program when not Token's), and the
   * most of it the sale's policy lets out in a day, base units (`./terms.ts` `heldDailyMax`).
   */
  salePolicy?: string;
  held?: string;
  heldProgram?: string;
  heldDaily?: string;
}>;

export const recordOf = (mandate: Mandate): MandateRecord => ({
  owner: mandate.terms.human.toBase58(),
  settings: mandate.settings.toBase58(),
  vault: mandate.vault.toBase58(),
  policy: mandate.policy.toBase58(),
  budget: mandate.budgetAccount.toBase58(),
  perTrade: mandate.terms.perTrade.toString(),
  perDay: mandate.terms.perDay.toString(),
  expiresAt: mandate.terms.expiresAt.toString(),
  ...(mandate.salePolicy && mandate.terms.heldCoin
    ? {
        salePolicy: mandate.salePolicy.toBase58(),
        held: mandate.terms.heldCoin.mint.toBase58(),
        ...(mandate.terms.heldCoin.program.equals(TOKEN_PROGRAM_ID) ? {} : { heldProgram: mandate.terms.heldCoin.program.toBase58() }),
        heldDaily: mandate.terms.heldCoin.dailyMax.toString(),
      }
    : {}),
});

/** `fundLamports` — what the signature moves into her vault; `networkLamports` — what it gives the agent for its fees. */
export type ReviewResult = Readonly<{ ok: true; record: MandateRecord; transactions: readonly string[]; fundLamports: string; networkLamports?: string }> | Readonly<{ ok: false; code: string; reason: string }>;

/**
 * The chain's clock, in seconds, at its newest confirmed slot — or null when the node cannot say. A node often has no
 * block for the very newest slot yet («Block not available for slot», -32004) and throws rather than answering null;
 * that is the same «cannot say» as a null, and the caller's wall-clock fallback stands for both (a budget's
 * review was refused on this throw).
 */
export async function chainSeconds(connection: Pick<Connection, "getSlot" | "getBlockTime">): Promise<number | null> {
  try {
    return await connection.getBlockTime(await connection.getSlot("confirmed"));
  } catch {
    return null;
  }
}

/** The token the pool sells for SOL — what the agent buys for her; the DLMM SDK reads the pool (loaded on use). */
export async function poolOtherToken(connection: Connection, pool: PublicKey): Promise<PublicKey> {
  const DLMM = (await import("@meteora-ag/dlmm")).default;
  const read = await DLMM.create(connection, pool, { cluster: "devnet" });
  return read.tokenX.publicKey.equals(NATIVE_MINT) ? read.tokenY.publicKey : read.tokenX.publicKey;
}

/** One side's facts as a person's swap reads them (`../core/solana-swap/fee-route.server.ts`), loaded on first use. */
const swapSide = async (mint: string): Promise<SideFacts | null> => (await import("../core/solana-swap/fee-route.server.ts")).readSideFacts(mint);

const sentence = (reason: string): string => `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;

type BuyDependencies = Readonly<{ sides?: (mint: string) => Promise<SideFacts | null>; stocks?: StockShelf }>;

/** How much of the coin `lamports` of SOL buy at the venue now, base units — the venue's own quote; throws when not read. */
export type DayCoins = (coin: PublicKey, lamports: bigint) => Promise<bigint>;

/**
 * The gate's venue asked for that quote, loaded on use: Jupiter's on mainnet (SOL in, the coin out), the devnet pool's —
 * whose side sold is the other token, SOL, when the coin is named as the one bought.
 */
const venueDayCoins =
  (gate: Extract<MandateGate, { open: true }>, connection: Connection): DayCoins =>
  async (coin, lamports) => {
    if (gate.network === "mainnet") {
      const [{ jupiterWorth }, { resolveJupiterSwapEndpoint }] = await Promise.all([import("./jupiter.server.ts"), import("../solana/quotes.ts")]);
      return jupiterWorth({ coin: NATIVE_MINT, budgetMint: coin, amount: lamports }, resolveJupiterSwapEndpoint());
    }
    const { dlmmWorth } = await import("./dlmm.server.ts");
    return dlmmWorth(connection, { pool: gate.pool, budgetMint: coin, amount: lamports });
  };

/**
 * The coin as the agent will buy it for a budget, or why it will not — asked before she signs anything, by the very
 * reading every buy goes by (`./jupiter.server.ts` `jupiterVenue`, `./agent-service.server.ts` `dlmmVenue`): the mint read
 * from the chain, a coin of the token programs with every feature on the agent's list (`./token-2022.ts`) — a stock
 * only one the engine itself finds on the shelf, with its switches open (`./stocks.server.ts`) — and, on mainnet, a pair
 * Ryntra's table names a router fee for. A budget signed for a coin the agent then refuses at every buy gives it her
 * SOL for the network's fees and buys nothing.
 */
export async function coinForBudget(
  coin: PublicKey,
  network: MandateNetwork,
  connection: Pick<Connection, "getAccountInfo" | "getEpochInfo">,
  dependencies: BuyDependencies = {},
): Promise<Readonly<{ ok: true; coin: Coin }> | Readonly<{ ok: false; code: "UNAVAILABLE" | "REFUSED"; reason: string }>> {
  const info = await connection.getAccountInfo(coin).catch(() => null);
  if (!info) return { ok: false, code: "UNAVAILABLE", reason: "The coin the agent buys is not readable." };
  /* A transfer fee's rate is the epoch's; a coin of Token has none. */
  let epoch: bigint | undefined;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) {
    const read = await Promise.resolve()
      .then(() => connection.getEpochInfo("confirmed"))
      .then((answer) => BigInt(answer.epoch), () => null);
    if (read === null) return { ok: false, code: "UNAVAILABLE", reason: "The chain's epoch is not readable." };
    epoch = read;
  }
  const reading = network === "mainnet" ? await readShelfCoin(coin, info, epoch, dependencies.stocks ?? stocksOf(network)) : readCoin(coin, info, epoch);
  if (!reading.ok) return { ok: false, code: "REFUSED", reason: sentence(reading.reason) };
  /* Devnet's coin is one no catalogue reads: the table prices it by its mint alone, and always names a rate. */
  if (network === "mainnet") {
    const read = dependencies.sides ?? swapSide;
    const budget = NATIVE_MINT.toBase58();
    const [input, output] = await Promise.all([read(budget), read(coin.toBase58())]).catch(() => [null, null]);
    if (!output) return { ok: false, code: "UNAVAILABLE", reason: "The coin's facts are not readable." };
    if (pairFeeBps(budget, coin.toBase58(), { input, output, nowMs: Date.now() }) === null) return { ok: false, code: "REFUSED", reason: "The agent does not trade this pair: Ryntra's table names no router fee for it." };
  }
  return { ok: true, coin: reading.coin };
}

/**
 * Turn the agent on: the person's unsigned transactions (one approval), for her own budget — the day's cap, the trade's
 * and the term she wrote (no ceiling of Ryntra's, `./budget.ts`) — on her smart account, the one she already
 * has or a new one. On devnet the agent buys the pool's coin; on mainnet the coin she names, by Jupiter's route. A coin
 * the agent would refuse at its buys is refused here, before a signature (`coinForBudget`).
 */
export async function reviewEnable(
  input: Readonly<{ owner: string; budget: AgentBudget; smartAccount?: string | null; coin?: string | null; exit?: boolean }>,
  gate: Extract<MandateGate, { open: true }>,
  connection: Connection = mandateConnection(gate.network),
  dependencies: Readonly<{
    receiveMint?: (connection: Connection, pool: PublicKey) => Promise<PublicKey>;
    origin?: (mint: string) => Promise<CoinOrigin>;
    dayCoins?: DayCoins;
    /** Where the coin's day limit read here is kept for the book to check at joining (`./book.server.ts` `heldDailyKnown`). */
    remember?: (ticket: Readonly<{ policy: string; heldDaily: string }>) => Promise<void>;
  }> &
    BuyDependencies = {},
): Promise<ReviewResult> {
  const budgetWrong = budgetRefusal(input.budget);
  if (budgetWrong) return { ok: false, code: "VALIDATION_ERROR", reason: `Not a budget: ${budgetWrong}.` };
  if (!(await onNetwork(connection, gate.network))) return notNetwork(gate.network);
  const owner = addressOf(input.owner);
  if (!owner) return { ok: false, code: "VALIDATION_ERROR", reason: "Not a wallet address." };
  if (owner.equals(gate.agent)) return { ok: false, code: "VALIDATION_ERROR", reason: "The agent is not the person." };
  const named = gate.network === "mainnet" ? addressOf(input.coin ?? undefined) : null;
  if (gate.network === "mainnet" && (!named || named.equals(NATIVE_MINT))) return { ok: false, code: "VALIDATION_ERROR", reason: "Name the coin the agent buys." };
  /* Before she signs anything — a coin of Ryntra's launchpad, or her own, is never the agent's to buy. */
  if (named) {
    const origin = await (dependencies.origin ?? storeScreen(getGuardRuntime().store, gate.network).origin)(named.toBase58()).catch(() => null);
    if (!origin) return { ok: false, code: "UNAVAILABLE", reason: "Ryntra's launch registry is not readable." };
    if (origin.launchedHere) return { ok: false, code: "REFUSED", reason: origin.creator === owner.toBase58() ? "The agent does not buy your own coin." : "The agent does not buy coins launched on Ryntra." };
  }
  const budget = input.budget;
  const fund = budgetFund(budget);
  const network = agentNetworkOf(budget);
  const now = BigInt((await chainSeconds(connection)) ?? Math.floor(Date.now() / 1000));
  let account: Parameters<typeof planEnable>[0]["account"];
  const known = addressOf(input.smartAccount ?? undefined);
  const settingsInfo = known ? await connection.getAccountInfo(known) : null;
  if (known && settingsInfo && settingsInfo.owner.equals(SSA_PROGRAM_ID)) {
    account = { kind: "present", settings: known, state: readSettings(settingsInfo.data) };
  } else {
    const config = await connection.getAccountInfo(ssaAddress.programConfig());
    if (!config) return { ok: false, code: "UNAVAILABLE", reason: "The smart account program is not readable." };
    account = { kind: "absent", config: readProgramConfig(config.data) };
  }
  /* What the agent buys for her — the pool's other token on devnet, the coin she names on mainnet; she opens its account now. */
  let receive: PublicKey;
  if (named) {
    receive = named;
  } else {
    if (gate.network === "mainnet") return { ok: false, code: "VALIDATION_ERROR", reason: "Name the coin the agent buys." };
    try {
      receive = await (dependencies.receiveMint ?? poolOtherToken)(connection, gate.pool);
    } catch {
      return { ok: false, code: "UNAVAILABLE", reason: "The devnet pool is not readable." };
    }
  }
  /*
   * Before she signs: the coin is one the agent buys. Her account of it, and the vault's, then open under the coin's own
   * program — a coin of Token-2022 (a launchpad's coin, a stock) has no account under Token, and a budget whose signature
   * tried to open one there never landed (the mainnet fork).
   */
  const bought = await coinForBudget(receive, gate.network, connection, dependencies);
  if (!bought.ok) return bought;
  const receiveProgram = bought.coin.program;
  /*
   * The sale's day — what her day's cap buys of the coin now, at the venue's own quote, twice (`heldDailyMax`):
   * the most of it the sale's policy lets leave her vault in a day. A price not read is no sale she can sign.
   */
  let dailyMax: bigint | null = null;
  if (input.exit) {
    const coins = await (dependencies.dayCoins ?? venueDayCoins(gate, connection))(receive, budget.perDay).catch(() => null);
    if (coins === null || coins <= 0n) return { ok: false, code: "UNAVAILABLE", reason: "The coin's price is not readable." };
    dailyMax = heldDailyMax(coins);
  }
  let plan;
  try {
    plan = planEnable({
      cluster: gate.network,
      terms: {
        human: owner,
        agent: gate.agent,
        budgetMint: NATIVE_MINT,
        perTrade: budget.perTrade,
        perDay: budget.perDay,
        slippageBps: 100,
        expiresAt: now + BigInt(budget.days) * 86_400n,
        venue: gate.network === "mainnet" ? { kind: "jupiter" } : { kind: "dlmm", pool: gate.pool },
        /* The agent keeps the coin in her vault and may sell it on its own — a second policy, the same approval. */
        ...(dailyMax !== null ? { heldCoin: { mint: receive, program: receiveProgram, dailyMax } } : {}),
      },
      account,
      fund,
      nowSeconds: now,
      receiveMints: [{ mint: receive, program: receiveProgram }],
      agentFeeLamports: network,
    });
  } catch (error) {
    return { ok: false, code: "REFUSED", reason: error instanceof Error ? error.message : "The mandate is not written." };
  }
  const record = recordOf(plan.mandate);
  /* The coin's day limit read here is the one the mandate joins the book with — kept before she is shown it. */
  if (record.heldDaily !== undefined) {
    const remember = dependencies.remember ?? ((ticket: Readonly<{ policy: string; heldDaily: string }>) => rememberHeldDaily(getGuardRuntime().store, gate.network, ticket));
    const kept = await remember({ policy: record.policy, heldDaily: record.heldDaily }).then(
      () => true,
      () => false,
    );
    if (!kept) return { ok: false, code: "UNAVAILABLE", reason: "The agent's book is not readable." };
  }
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  return {
    ok: true,
    record,
    transactions: plan.transactions.map((instructions) => toBase64(unsignedTransaction(owner, instructions, blockhash))),
    fundLamports: fund.toString(),
    networkLamports: network.toString(),
  };
}

/**
 * What the stop's transaction also tidies (`./tidy.ts`): read by the caller from the agent's book and the chain —
 * her sold sales' mandates, the vault's empty account of the coin, her wSOL.
 */
export type StopTidy = (mandate: Readonly<{ owner: PublicKey; settings: PublicKey; vault: PublicKey; policy: PublicKey }>) => Promise<Tidy>;

/**
 * What the agent's book says of this buying mandate's sale — the sale's policy and the coin the agent keeps;
 * null — the book knows none, or was not read. Only a word: the stop finds the sale on chain itself and checks this
 * against what stands there (`keptSaleOf`).
 */
export type StopSale = (mandate: Readonly<{ owner: PublicKey; settings: PublicKey; policy: PublicKey }>) => Promise<Readonly<{ salePolicy: PublicKey; held: Readonly<{ mint: PublicKey; program: PublicKey }> }> | null>;

const carries = (data: Uint8Array, key: PublicKey) => Buffer.from(data).indexOf(key.toBuffer()) >= 0;

type Kept = Readonly<{ mint: PublicKey; program: PublicKey }>;

/**
 * The agent's sale beside this buying mandate, as the chain has it, or null. The sale's policy is written in
 * the same approval as the buy's, at the next seed of her account (`./human.ts` `planEnable`):
 * - the buy's policy still stands — the sale is the policy at its seed + 1, whatever the book says;
 * - the buy's policy is gone — the sale the book names, when its own seed − 1 is the buy's.
 * Either way it is a policy of her account whose one signer is the agent (the buy's own, or the gate's), naming her own
 * account of the budget's token and the vault's account of the coin the agent keeps — an account the buy's policy names
 * too, while it stands. The coin is the book's, or — the book silent — the one both policies' own bytes name,
 * or, last, the vault's own account that both policies name.
 *
 * `"unread"`: the sale's place could not be read at all — the stop is not built without
 * it, rather than built leaving the agent's sale standing.
 */
async function keptSaleOf(
  connection: Pick<Connection, "getAccountInfo" | "getTokenAccountsByOwner">,
  input: Readonly<{ owner: PublicKey; settings: PublicKey; vault: PublicKey; budgetAccount: PublicKey; policy: PublicKey; buy: Readonly<{ data: Uint8Array }> | null; agent: PublicKey | null; word: Awaited<ReturnType<StopSale>> }>,
): Promise<Readonly<{ policy: PublicKey; held: Kept | null }> | null | "unread"> {
  const { settings, vault, buy, word } = input;
  let place: PublicKey | null = null;
  let agent = input.agent;
  if (buy) {
    let head;
    try {
      head = readPolicyHead(buy.data);
    } catch {
      return null;
    }
    if (!head.settings.equals(settings) || !ssaAddress.policy(settings, head.seed).equals(input.policy) || head.signers.length !== 1) return null;
    agent = head.signers[0]!.key;
    place = ssaAddress.policy(settings, head.seed + 1n);
  } else if (word) {
    place = word.salePolicy;
  }
  if (!place || !agent) return null;
  const info = await Promise.resolve()
    .then(() => connection.getAccountInfo(place, "confirmed"))
    .then(
      (read) => read,
      () => "unread" as const,
    );
  if (info === "unread") return "unread";
  if (!info || !info.owner.equals(SSA_PROGRAM_ID)) return null;
  let head;
  try {
    head = readPolicyHead(info.data);
  } catch {
    return null;
  }
  if (!head.settings.equals(settings) || !ssaAddress.policy(settings, head.seed).equals(place) || head.seed < 2n || !ssaAddress.policy(settings, head.seed - 1n).equals(input.policy)) return null;
  if (head.signers.length !== 1 || !head.signers[0]!.key.equals(agent)) return null;
  if (!carries(info.data, proceedsAccountOf({ human: input.owner, budgetMint: NATIVE_MINT }))) return null;
  const names = (coin: PublicKey) => carries(info.data, coin) && (!buy || carries(buy.data, coin));
  if (word && names(heldAccountOf(vault, word.held))) return { policy: place, held: word.held };
  /* The book silent: only with the buy's policy standing — the vault's account of a coin both policies name. */
  if (!buy) return null;
  const named = coinNamedBy(info.data, vault, names, input.budgetAccount);
  if (named) return { policy: place, held: named };
  for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const accounts = await Promise.resolve()
      .then(() => connection.getTokenAccountsByOwner(vault, { programId: program }, "confirmed"))
      .then((read) => read.value, () => []);
    for (const { pubkey, account } of accounts) {
      if (pubkey.equals(input.budgetAccount) || account.data.length < 32) continue;
      const held = { mint: new PublicKey(account.data.subarray(0, 32)), program };
      if (heldAccountOf(vault, held).equals(pubkey) && names(pubkey)) return { policy: place, held };
    }
  }
  return null;
}

/**
 * The coin the agent keeps, from the sale policy's own bytes: its day limit names the coin's mint, and the
 * vault's account of that mint under its token program is named by both policies (`names`). Every 32 bytes of the policy
 * are tried as a mint; nothing is read from the chain, so a vault whose account of the coin is closed, or an RPC that
 * does not answer `getTokenAccountsByOwner`, still finds it. Null — no such coin.
 *
 * Never the budget's money (the lead's review of #1972, BLOCKER): Jupiter's sale names the vault's own account of wSOL —
 * the budget's, which the buy names too — and SOL's mint before the coin's day limit, so a budget mint (SOL, USDC) and
 * the budget's account are skipped, as the vault's scan below skips it; taking wSOL for the coin would withdraw the
 * budget's account twice in her stop and fail it every time.
 */
function coinNamedBy(data: Uint8Array, vault: PublicKey, names: (account: PublicKey) => boolean, budgetAccount: PublicKey): Kept | null {
  const bytes = Buffer.from(data);
  const seen = new Set<string>();
  for (let at = 0; at + 32 <= bytes.length; at += 1) {
    const window = bytes.subarray(at, at + 32);
    const hex = window.toString("hex");
    if (seen.has(hex)) continue;
    seen.add(hex);
    const mint = new PublicKey(window);
    if (mint.equals(NATIVE_MINT) || USDC_MINTS.some((usdc) => usdc.equals(mint))) continue;
    for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
      let account: PublicKey;
      try {
        account = heldAccountOf(vault, { mint, program });
      } catch {
        continue;
      }
      if (!account.equals(budgetAccount) && names(account)) return { mint, program };
    }
  }
  return null;
}

/** Whether a mint withholds a fee on transfers; null — not read whole. */
function withholds(mint: Readonly<{ owner: PublicKey; data: Uint8Array }>): boolean | null {
  if (!mint.owner.equals(TOKEN_2022_PROGRAM_ID)) return false;
  try {
    return mintExtensions(mint.data).some((extension) => extension.type === EXTENSION.TransferFeeConfig);
  } catch {
    return null;
  }
}

/**
 * The coin the agent kept in her vault, as her stop takes it home (`./human.ts` `planWithdrawHeld`): its
 * balance, decimals and transfer fee read from the chain; null — no account to take it from, a mint not read whole, or a
 * stock whose issuer paused it with coin in the account (it stays, and comes home once the issuer lets it move: the
 * stop itself must land).
 */
async function keptBalance(connection: Pick<Connection, "getMultipleAccountsInfo">, vault: PublicKey, held: Kept): Promise<HeldBalance | null> {
  const account = heldAccountOf(vault, held);
  const [info, mint] = await connection.getMultipleAccountsInfo([account, held.mint], "confirmed").catch(() => [null, null]);
  if (!info || !mint || !info.owner.equals(held.program) || !mint.owner.equals(held.program) || !isTokenProgram(held.program) || mint.data.length <= 44) return null;
  const balance = heldIn(info.data);
  const paused = pausedNow(mint);
  const transferFee = withholds(mint);
  if (paused === null || transferFee === null || (paused && balance > 0n)) return null;
  return { ...held, decimals: mint.data[44]!, balance, transferFee };
}

/**
 * Stop and take the rest back: one unsigned transaction, the person's alone — with as much tidying as fits in it.
 * The agent's sale goes with the buy in the same signature, found on chain (`keptSaleOf`) — a book not read
 * leaves no sale standing — and the coin the agent kept for her comes home in it (`keptBalance`). For such an agent the
 * answer is «nothing» only when nothing at all is left — no policy, no budget, no coin, nothing to tidy. A mandate with
 * no sale of the agent's own on chain or in the book gets the very transaction it got before.
 */
export async function reviewStop(
  input: Readonly<{ owner: string; settings: string; policy: string }>,
  network: MandateNetwork = "devnet",
  connection: Connection = mandateConnection(network),
  deps: Readonly<{
    tidy?: StopTidy;
    sale?: StopSale;
    agent?: PublicKey;
    /** Told once her stop's transaction is built for an agent with its own sale (`./exit.server.ts` `askedStop`): the agent holds its sales but her stop's. */
    asked?: (policy: PublicKey) => Promise<void>;
  }> = {},
): Promise<ReviewResult> {
  if (!(await onNetwork(connection, network))) return notNetwork(network);
  const owner = addressOf(input.owner);
  const settings = addressOf(input.settings);
  const policy = addressOf(input.policy);
  if (!owner || !settings || !policy) return { ok: false, code: "VALIDATION_ERROR", reason: "Not addresses." };
  const settingsInfo = await connection.getAccountInfo(settings);
  if (!settingsInfo || !settingsInfo.owner.equals(SSA_PROGRAM_ID) || !readSettings(settingsInfo.data).signers.some((signer) => signer.key.equals(owner))) {
    return { ok: false, code: "REFUSED", reason: "Not the person's smart account." };
  }
  const vault = ssaAddress.vault(settings, 0);
  const budgetAccount = tokenAccountOf(vault, NATIVE_MINT);
  const balance = await connection.getTokenAccountBalance(budgetAccount).then((r) => BigInt(r.value.amount), () => null);
  const policyInfo = await connection.getAccountInfo(policy);
  const policyLive = Boolean(policyInfo);
  /*
   * The sale's policy goes with the buy's in the same signature — from then on nothing is bought or sold; the
   * coin the agent kept comes home in it.
   */
  const word = deps.sale ? await deps.sale({ owner, settings, policy }).catch(() => null) : null;
  const found = await keptSaleOf(connection, { owner, settings, vault, budgetAccount, policy, buy: policyInfo && policyInfo.owner.equals(SSA_PROGRAM_ID) ? policyInfo : null, agent: deps.agent ?? null, word });
  /* The sale's place not read — no stop that would leave the agent's sale standing; she taps again. */
  if (found === "unread") return { ok: false, code: "UNAVAILABLE", reason: "The agent's sale is not readable." };
  const sale = found;
  const live = [...(policyLive ? [policy] : []), ...(sale ? [sale.policy] : [])];
  /* Only the parts that still stand: a removed policy is not removed twice, an empty vault is not closed. */
  const mandate: Mandate = {
    cluster: network,
    terms: { human: owner, agent: owner, budgetMint: NATIVE_MINT, perTrade: 0n, perDay: 0n, slippageBps: 100, expiresAt: 0n, venue: { kind: "jupiter" } },
    settings,
    vault,
    policy: live[0] ?? policy,
    policySeed: 0n,
    budgetAccount,
    ...(live[1] ? { salePolicy: live[1] } : {}),
  };
  const all = planStopAndWithdraw(mandate, balance ?? 0n);
  const base = [...(live.length ? all.slice(0, 1) : []), ...(balance !== null ? all.slice(1) : [])];
  /* The coin the agent kept: the sale's own, or — its policy gone already — the coin the book names. */
  const kept = sale?.held ?? word?.held ?? null;
  const home = kept ? await keptBalance(connection, vault, kept) : null;
  const withHome = home ? [...base, ...planWithdrawHeld(mandate, home)] : base;
  const core = home && fits(owner, withHome) ? withHome : base;
  const read = deps.tidy ? await deps.tidy({ owner, settings, vault, policy }).catch(() => NO_TIDY) : NO_TIDY;
  /* The coin's account is the withdraw's to empty and close: the tidying leaves it alone. */
  const keptAccount = core !== base && home ? heldAccountOf(vault, home) : null;
  const tidy: Tidy = keptAccount ? { ...read, empty: read.empty.filter((empty) => !empty.account.equals(keptAccount)) } : read;
  /*
   * Nothing left of the mandate itself: for an agent that kept a coin, the tidying alone is still hers to sign (its coin's
   * account, her wSOL); a mandate without the agent's own sale answers as it always did.
   */
  const ownSale = Boolean(sale || word);
  if (!core.length && (!ownSale || tidyIsEmpty(tidy))) return { ok: false, code: "NOTHING", reason: "Nothing left to stop." };
  const [instructions] = withTidy({ human: owner, settings, vault }, [core], tidy).transactions;
  if (!instructions?.length) return { ok: false, code: "NOTHING", reason: "Nothing left to stop." };
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  /* The agent starts no sale of its own that could land before this stop and leave her vault short of the exact balance it takes home. */
  if (ownSale && deps.asked) await deps.asked(policy).catch(() => undefined);
  return {
    ok: true,
    record: { owner: owner.toBase58(), settings: settings.toBase58(), vault: vault.toBase58(), policy: policy.toBase58(), budget: budgetAccount.toBase58(), perTrade: "0", perDay: "0", expiresAt: "0" },
    transactions: [toBase64(unsignedTransaction(owner, instructions, blockhash))],
    fundLamports: (balance ?? 0n).toString(),
  };
}

export type MandateStatus = Readonly<{ active: boolean; budgetLamports: string | null }>;

/** What the status route answers: the mandate's state, or — `not-addresses` (400), `not-found` (404, not this agent's mandate). */
export type MandateStatusRead = Readonly<{ ok: true; status: MandateStatus }> | Readonly<{ ok: false; code: "not-addresses" | "not-found" }>;

/**
 * What stands now — only of a real mandate of this agent: a policy on chain must be a Squads Smart Account
 * policy whose one signer is the agent, at the address its settings and seed derive, and the vault must be that account's.
 * A policy no longer on chain (a stop removed it) is known only from the agent's book, with the same vault. Anything else
 * — any other address, the System Program — is not found.
 */
export async function mandateStatus(
  input: Readonly<{ policy: string; vault: string }>,
  gate: Readonly<{ network: MandateNetwork; agent: PublicKey }>,
  connection: Pick<Connection, "getAccountInfo" | "getTokenAccountBalance"> = mandateConnection(gate.network),
  deps: Readonly<{ store?: GuardStore }> = {},
): Promise<MandateStatusRead> {
  const policy = addressOf(input.policy);
  const vault = addressOf(input.vault);
  if (!policy || !vault) return { ok: false, code: "not-addresses" };
  const [policyInfo, balance] = await Promise.all([
    connection.getAccountInfo(policy),
    connection.getTokenAccountBalance(tokenAccountOf(vault, NATIVE_MINT)).then((r) => r.value.amount, () => null),
  ]);
  if (policyInfo) {
    if (!policyInfo.owner.equals(SSA_PROGRAM_ID)) return { ok: false, code: "not-found" };
    let head;
    try {
      head = readPolicyHead(policyInfo.data);
    } catch {
      return { ok: false, code: "not-found" };
    }
    if (!ssaAddress.policy(head.settings, head.seed).equals(policy)) return { ok: false, code: "not-found" };
    if (head.signers.length !== 1 || !head.signers[0]!.key.equals(gate.agent)) return { ok: false, code: "not-found" };
    if (!ssaAddress.vault(head.settings, 0).equals(vault)) return { ok: false, code: "not-found" };
    return { ok: true, status: { active: true, budgetLamports: balance } };
  }
  const store = deps.store ?? getGuardRuntime().store;
  const book = store.collection<Readonly<{ record?: Readonly<{ vault?: string }> }>>("agentMandates");
  const rows = await Promise.all([book.get(`m:${gate.network}:${policy.toBase58()}`), book.get(`s:${gate.network}:${policy.toBase58()}`)]).catch(() => [undefined, undefined]);
  if (!rows.some((row) => row?.record?.vault === vault.toBase58())) return { ok: false, code: "not-found" };
  return { ok: true, status: { active: false, budgetLamports: balance } };
}

export type RelayResult = Readonly<{ ok: true; signatures: readonly string[] }> | Readonly<{ ok: false; code: string; reason: string; signatures: readonly string[] }>;

/**
 * Send the person's signed transactions in order, each confirmed before the next. Each is read first: the person pays
 * and is the only signer, her signature is real, and it calls nothing but the smart account, token and system programs —
 * Token-2022's among them, where a coin she sells is one of it.
 */
export async function relayMandate(input: Readonly<{ owner: string; items: readonly string[] }>, network: MandateNetwork = "devnet", connection: Connection = mandateConnection(network)): Promise<RelayResult> {
  if (!(await onNetwork(connection, network))) return { ...notNetwork(network), signatures: [] };
  const owner = addressOf(input.owner);
  if (!owner) return { ok: false, code: "VALIDATION_ERROR", reason: "Not a wallet address.", signatures: [] };
  const allowed = new Set([SSA_PROGRAM_ID.toBase58(), "11111111111111111111111111111111", "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"]);
  const txs: VersionedTransaction[] = [];
  for (const wire of input.items) {
    let tx: VersionedTransaction;
    try {
      tx = VersionedTransaction.deserialize(Buffer.from(wire, "base64"));
    } catch {
      return { ok: false, code: "MALFORMED", reason: "A transaction is unreadable.", signatures: [] };
    }
    const keys = tx.message.staticAccountKeys;
    if (!keys[0]?.equals(owner) || tx.message.header.numRequiredSignatures !== 1) {
      return { ok: false, code: "REFUSED", reason: "The person must pay and be the only signer.", signatures: [] };
    }
    if (!tx.signatures[0] || !ed25519Valid(tx.message.serialize(), tx.signatures[0], owner)) return { ok: false, code: "REFUSED", reason: "Not signed by the person.", signatures: [] };
    const programs = tx.message.compiledInstructions.map((ix) => keys[ix.programIdIndex]?.toBase58() ?? "");
    if (programs.some((program) => !allowed.has(program))) return { ok: false, code: "REFUSED", reason: "A program outside the mandate.", signatures: [] };
    txs.push(tx);
  }
  const signatures: string[] = [];
  for (const tx of txs) {
    try {
      const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
      signatures.push(signature);
      const confirmed = await connection.confirmTransaction(signature, "confirmed");
      if (confirmed.value.err) return { ok: false, code: "FAILED", reason: `A transaction failed on ${network}.`, signatures };
    } catch (error) {
      return { ok: false, code: "FAILED", reason: error instanceof Error ? error.message.split("\n")[0]!.slice(0, 160) : "Not sent.", signatures };
    }
  }
  return { ok: true, signatures };
}
