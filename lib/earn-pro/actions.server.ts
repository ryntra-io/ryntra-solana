/**
 * What a person's wallet signs on a DLMM Pro pier: the Review that builds it, and the relay that sends it.
 *
 * | Action | What the wallet signs | Transactions |
 * |---|---|---|
 * | `open` | a position from a goal or from a shape of one's own (behind `RYNTRA_EARN_PRO_SHAPE`), paid in SOL alone: the pool swaps the part the shape needs, then «open and deposit» | 2 (3 for a shape wider than one message) |
 * | `compound` | «take and put back»: the fees collected and deposited again | 1 |
 * | `collect` | the fees, and the pool's reward where it has one | 1–3 |
 * | `leave` | all the liquidity out, with the fees and the reward | 1–4 |
 * | `close` | the empty position closed: its rent back | 1 |
 * | `care_on` | the one approval of an agent's care | 1 |
 * | `care_off` | the care taken back | 1 |
 *
 * A Review reads the pier now — never a kept list — builds through the venue, and seals what it built
 * (`./ticket.ts`). Every transaction is the venue's own unsigned bytes for the person's wallet; this file adds no
 * instruction. The relay sends only what the ticket sealed, signed by that wallet, once each and in order, and stops at
 * the first that does not land: what landed before it has landed, and the answer says which.
 *
 * Ryntra takes no fee of its own on any of it. The swap inside an opening pays the pool's own fee, out of whose
 * protocol share Ryntra's referral is paid where its account exists.
 */

import { Keypair, type Connection } from "@solana/web3.js";

import { signatureStates, type LiquidityRelay, type RelayState } from "../liquidity/studio/actions.ts";
import { PRO_CARE_STOP_PCTS, isProCareStopPct, stopBelowOf, watchOf } from "./care.ts";
import { endProCare, holdProCare, proCareGate, recordProCare, type ProCareDeps, type ProCareHold } from "./care.server.ts";
import { SOL_MINT, coinKindOf } from "./coins.ts";
import { EARN_PRO_ACTIONS, earnProGate, earnProShapeOpen, earnProStopped, heldByStop, type EarnProAction, type EarnProNetwork } from "./gate.ts";
import { lamportsOf, priceOfTick, readPier, type ProPier } from "./piers.server.ts";
import type { StockSeats } from "./stocks.ts";
import { MAX_TICKET_MESSAGES, checkEarnProSigned, digestOf, issueEarnProTicket, openCosigners, readEarnProTicket, sealCosigners, ticketKeyHere, type Cosigner } from "./ticket.ts";
import { CARE_RIGHTS, CUSTOM_GOAL, DlmmProRefusal, earnProConnection, earnProVenue, isEarnStyle, isOpenGoal, isShapeColumns, type DlmmProBuild, type DlmmProRefusalCode, type DlmmProTx, type DlmmProVenue, type EarnStyle, type OpenGoal } from "./venue.server.ts";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The least SOL one opening takes: under it the rent outweighs the position. No most — the person's own amount and wallet are the bound, the price band holds the opening to its moment.
 */
export const EARN_PRO_MIN_LAMPORTS = 50_000_000n;
/** The band of the price a person's opening asks for; the venue holds it to an eighth of the way to the range's nearer edge. */
export const OPEN_BAND_BPS = 100;
/** The band «take and put back» is built for, and a removal's. */
export const COMPOUND_BAND_BPS = 20;
export const LEAVE_BAND_BPS = 100;

export type EarnProFailure = Readonly<{ ok: false; status: number; code: EarnProFailureCode; reason: string }>;
export type EarnProFailureCode =
  | "EARN_PRO_CLOSED"
  | "EARN_PRO_STOPPED"
  | "BAD_REQUEST"
  | "NOT_A_PIER"
  | "PIER_NOT_OPEN"
  | "AMOUNT_LOW"
  | "AMOUNT_HIGH"
  | "CARE_CLOSED"
  | "BALANCE_LOW"
  | "NOTHING_TO_DO"
  | "REFUSED"
  | "UNAVAILABLE"
  | "TICKET_INVALID"
  | "TICKET_EXPIRED"
  | "SIGNED_MISMATCH"
  | "NOT_SIGNED"
  | "SIMULATION_FAILED";

const fail = (status: number, code: EarnProFailureCode, reason: string): EarnProFailure => ({ ok: false, status, code, reason });

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const isAddress = (value: unknown): value is string => typeof value === "string" && ADDRESS.test(value);

export type EarnProReviewInput =
  /** `columns` — only with the goal `custom`: the person's own grid, 32 columns of 0 to 8 cells, painted on both sides of the price. */
  | Readonly<{ action: "open"; owner: string; pool: string; goal: OpenGoal; style: EarnStyle; lamports: string; columns?: readonly number[] }>
  | Readonly<{ action: "compound" | "collect" | "leave" | "close" | "care_off"; owner: string; pool: string; nftMint: string }>
  | Readonly<{ action: "care_on"; owner: string; pool: string; nftMint: string; stopPct: (typeof PRO_CARE_STOP_PCTS)[number] }>;

/** A request's body as a Review's input; null for anything that is not one. */
export function parseEarnProReview(body: unknown): EarnProReviewInput | null {
  if (!body || typeof body !== "object") return null;
  const { action, owner, pool, nftMint, goal, style, lamports, stopPct, columns } = body as Record<string, unknown>;
  if (typeof action !== "string" || !(EARN_PRO_ACTIONS as readonly string[]).includes(action) || !isAddress(owner) || !isAddress(pool)) return null;
  if (action === "open") {
    if (!isOpenGoal(goal) || !isEarnStyle(style) || typeof lamports !== "string" || !/^\d{1,20}$/.test(lamports)) return null;
    if (goal === CUSTOM_GOAL) return isShapeColumns(columns) ? { action, owner, pool, goal, style, lamports, columns: [...columns] } : null;
    if (columns !== undefined) return null;
    return { action, owner, pool, goal, style, lamports };
  }
  if (!isAddress(nftMint)) return null;
  if (action === "care_on") return isProCareStopPct(stopPct) ? { action, owner, pool, nftMint, stopPct } : null;
  return { action: action as "compound" | "collect" | "leave" | "close" | "care_off", owner, pool, nftMint };
}

type Amounts = Readonly<{ xRaw: string; yRaw: string; lamports: string }>;

export type EarnProSummary =
  | Readonly<{
      action: "open";
      /** What goes into the position at the price it is built for. */
      goesIn: Amounts;
      /** What the opening may leave in the wallet of what was named: a deposit is sized to land anywhere in its band. */
      staysLamports: string;
      /** The band of the price, basis points either way: outside it nothing lands. */
      bandBps: number;
      /** The range the position earns in, token Y per token X. */
      lowerPrice: number;
      upperPrice: number;
      ranges: number;
      /** The swap sent first: what of the SOL it turns into the other coin, and the pool's own fee on it. */
      swap: Readonly<{ lamports: string; feeBps: number; referral: boolean }>;
      networkLamports: number;
      /** The rent the position keeps until it is closed — it comes back then. */
      depositLamports: number;
      position: string;
      nftMint: string;
    }>
  | Readonly<{ action: "compound"; collected: Amounts; bandBps: number; networkLamports: number }>
  | Readonly<{ action: "collect"; fees: Amounts | null; rewards: readonly Readonly<{ mint: string; symbol: string | null; leastRaw: string }>[]; networkLamports: number; depositLamports: number }>
  | Readonly<{ action: "leave"; expected: Amounts; minimum: Amounts; bandBps: number; fees: Amounts | null; rewards: readonly Readonly<{ mint: string; symbol: string | null; leastRaw: string }>[]; networkLamports: number }>
  | Readonly<{ action: "close"; networkLamports: number }>
  /** The stop watches `stopCoin` counted in `stopUnit`: SOL in dollars on a dollar pier, the staked SOL in SOL on a staked one. */
  | Readonly<{ action: "care_on"; agent: string; rights: readonly string[]; stopBelow: number | null; stopCoin: string; stopUnit: string; networkLamports: number }>
  | Readonly<{ action: "care_off"; networkLamports: number }>;

export type EarnProReview = Readonly<{
  network: EarnProNetwork;
  action: EarnProAction;
  ticket: string;
  /** The unsigned transactions, in the order the wallet signs and the relay sends them. */
  transactions: readonly string[];
  expiresAt: number;
  summary: EarnProSummary;
}>;

/** `stocks` — the stocks engine's shelf a deployment that opened stock pools reads; none — no coin is a stock. */
export type EarnProDeps = Readonly<{ env?: Env; connection?: Connection; venue?: DlmmProVenue; now?: () => number; freshKey?: () => Keypair; care?: ProCareDeps; relayMs?: number; pollMs?: number; stocks?: StockSeats }>;

const REFUSALS: Readonly<Partial<Record<DlmmProRefusalCode, Readonly<{ status: number; code: EarnProFailureCode }>>>> = {
  BAD_INPUT: { status: 422, code: "REFUSED" },
  AMOUNT_ZERO: { status: 422, code: "AMOUNT_LOW" },
  NO_POOL: { status: 404, code: "NOT_A_PIER" },
  NOT_OPEN: { status: 409, code: "PIER_NOT_OPEN" },
  PAUSED: { status: 409, code: "PIER_NOT_OPEN" },
  NO_LIQUIDITY: { status: 422, code: "REFUSED" },
  PARTIAL_FILL: { status: 422, code: "REFUSED" },
  BALANCE_LOW: { status: 422, code: "BALANCE_LOW" },
  NOTHING_TO_DO: { status: 409, code: "NOTHING_TO_DO" },
  TX_TOO_LARGE: { status: 422, code: "REFUSED" },
  FOREIGN_SIGNER: { status: 422, code: "REFUSED" },
};

/** A venue's refusal as the surface's answer; anything else is the network not answering — nothing was built. */
function failureOf(error: unknown): EarnProFailure {
  if (error instanceof DlmmProRefusal) {
    const known = REFUSALS[error.code];
    if (known) return fail(known.status, known.code, error.message);
  }
  return fail(503, "UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
}

const nothing = async <T>(work: () => Promise<T>): Promise<T | null> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof DlmmProRefusal && error.code === "NOTHING_TO_DO") return null;
    throw error;
  }
};

const amountsOf = (pier: ProPier, xRaw: string, yRaw: string): Amounts => ({ xRaw, yRaw, lamports: (lamportsOf(pier, BigInt(xRaw), BigInt(yRaw)) ?? 0n).toString() });
const networkOf = (builds: readonly Pick<DlmmProTx, "feeLamports">[]): number => builds.reduce((sum, build) => sum + build.feeLamports, 0);

/** The fees and each reward of a position, whatever the venue finds something of — built for the owner. */
async function collects(venue: DlmmProVenue, pier: ProPier, at: Readonly<{ pool: string; nftMint: string; owner: string }>) {
  const fees = await nothing(() => venue.positions.collect(at));
  const rewards: { build: DlmmProBuild; mint: string; symbol: string | null; leastRaw: string }[] = [];
  for (const reward of pier.rewards) {
    const build = await nothing(() => venue.rewards.collect({ ...at, index: reward.index }));
    if (build) rewards.push({ build, mint: build.rewardMint, symbol: reward.symbol, leastRaw: build.accruedRaw });
  }
  return { fees, rewards };
}

/** A Review: the gate, the pier read now, the build, the seal. */
export async function reviewEarnPro(input: EarnProReviewInput, deps: EarnProDeps = {}): Promise<Readonly<{ ok: true; value: EarnProReview }> | EarnProFailure> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const gate = earnProGate(env);
  if (!gate.open) return fail(404, "EARN_PRO_CLOSED", "Earning on DLMM Pro is not served here.");
  if (heldByStop(input.action) && earnProStopped(env)) return fail(403, "EARN_PRO_STOPPED", "New money is stopped for now. Taking out stays open.");
  if (input.action === "open" && input.goal === CUSTOM_GOAL && !earnProShapeOpen(env)) return fail(404, "EARN_PRO_CLOSED", "A shape of one's own is not served here yet.");
  if (!ticketKeyHere(env)) return fail(503, "UNAVAILABLE", "This server cannot seal a Review; nothing was built.");
  const connection = deps.connection ?? earnProConnection(gate.network);
  const venue = deps.venue ?? earnProVenue(gate.network, connection, env);
  try {
    const read = await readPier(gate.network, input.pool, { env, connection, venue, ...(deps.stocks ? { stocks: deps.stocks } : {}) });
    if (!read) return fail(404, "NOT_A_PIER", "No DLMM Pro pier lives at this address.");
    /* New money and a new care only where the pier is served; taking out and taking back wherever the person holds. */
    if (heldByStop(input.action) && !read.served) return fail(404, "NOT_A_PIER", "No DLMM Pro pier lives at this address.");
    const { pier } = read;
    const at = "nftMint" in input ? { pool: input.pool, nftMint: input.nftMint, owner: input.owner } : null;
    let builds: readonly DlmmProTx[];
    let cosigners: readonly Cosigner[] = [];
    let summary: EarnProSummary;
    let nftMint: string;
    let stopBelow: number | null = null;

    if (input.action === "open") {
      const lamports = BigInt(input.lamports);
      if (lamports < EARN_PRO_MIN_LAMPORTS) return fail(422, "AMOUNT_LOW", "The least one opening takes is 0.05 SOL.");
      if (!pier.takesDeposits) return fail(409, "PIER_NOT_OPEN", "The pier takes no deposit now.");
      const fresh = (deps.freshKey ?? Keypair.generate)();
      nftMint = fresh.publicKey.toBase58();
      const built = await venue.earn.open({ pool: input.pool, wallet: input.owner, nftMint, goal: input.goal, style: input.style, ...(input.columns ? { columns: input.columns } : {}), pay: { mint: SOL_MINT, amountRaw: input.lamports }, slippageBps: OPEN_BAND_BPS });
      if (!built.swap) return fail(422, "REFUSED", "The opening was not built from SOL.");
      builds = built.steps;
      cosigners = built.steps.flatMap((step, index) => (step.cosigners.includes(nftMint) ? [{ index, key: fresh }] : []));
      const goesIn = amountsOf(pier, built.deposit.xRaw, built.deposit.yRaw);
      /* The swap's own fee is paid out of what was named; what neither went in nor was paid as that fee stays in the wallet. */
      const stays = lamports - BigInt(goesIn.lamports) - (BigInt(built.swap.amountInRaw) * BigInt(Math.round(built.swap.feeBps * 100))) / 1_000_000n;
      summary = {
        action: "open",
        goesIn,
        staysLamports: (stays > 0n ? stays : 0n).toString(),
        bandBps: built.bandBps,
        lowerPrice: priceOfTick(built.plan.tickLowerId, pier.x.decimals, pier.y.decimals),
        upperPrice: priceOfTick(built.plan.tickUpperId, pier.x.decimals, pier.y.decimals),
        ranges: built.shape.ranges.length,
        swap: { lamports: built.swap.amountInRaw, feeBps: built.swap.feeBps, referral: built.swap.referral },
        networkLamports: built.feeLamports,
        depositLamports: built.rentLamports - built.rentReturnedLamports,
        position: built.position,
        nftMint,
      };
    } else if (input.action === "compound") {
      nftMint = input.nftMint;
      const built = await venue.positions.compound({ ...at!, slippageBps: COMPOUND_BAND_BPS });
      builds = [built];
      summary = { action: "compound", collected: amountsOf(pier, built.expected.xRaw, built.expected.yRaw), bandBps: COMPOUND_BAND_BPS, networkLamports: built.feeLamports };
    } else if (input.action === "collect") {
      nftMint = input.nftMint;
      const found = await collects(venue, pier, at!);
      const all = [...(found.fees ? [found.fees] : []), ...found.rewards.map((reward) => reward.build)];
      if (all.length === 0) return fail(409, "NOTHING_TO_DO", "The position has nothing to take yet.");
      builds = all;
      summary = {
        action: "collect",
        fees: found.fees ? amountsOf(pier, found.fees.expected.xRaw, found.fees.expected.yRaw) : null,
        rewards: found.rewards.map(({ mint, symbol, leastRaw }) => ({ mint, symbol, leastRaw })),
        networkLamports: networkOf(all),
        depositLamports: all.reduce((sum, build) => sum + build.rentLamports - build.rentReturnedLamports, 0),
      };
    } else if (input.action === "leave") {
      nftMint = input.nftMint;
      /* Built together, sent in order: the removal, then what the position earned (rehearsed — `REHEARSAL.md` §15, G8). */
      const removal = await nothing(() => venue.positions.remove({ ...at!, bps: 10_000, slippageBps: LEAVE_BAND_BPS }));
      const found = await collects(venue, pier, at!);
      const all = [...(removal ? [removal] : []), ...(found.fees ? [found.fees] : []), ...found.rewards.map((reward) => reward.build)];
      if (all.length === 0) return fail(409, "NOTHING_TO_DO", "The position holds nothing to take out.");
      builds = all;
      summary = {
        action: "leave",
        expected: amountsOf(pier, removal?.expected.xRaw ?? "0", removal?.expected.yRaw ?? "0"),
        minimum: amountsOf(pier, removal?.minimum.xRaw ?? "0", removal?.minimum.yRaw ?? "0"),
        bandBps: LEAVE_BAND_BPS,
        fees: found.fees ? amountsOf(pier, found.fees.expected.xRaw, found.fees.expected.yRaw) : null,
        rewards: found.rewards.map(({ mint, symbol, leastRaw }) => ({ mint, symbol, leastRaw })),
        networkLamports: networkOf(all),
      };
    } else if (input.action === "close") {
      nftMint = input.nftMint;
      const built = await venue.positions.close(at!);
      builds = [built];
      summary = { action: "close", networkLamports: built.feeLamports };
    } else if (input.action === "care_on") {
      nftMint = input.nftMint;
      const care = proCareGate(env);
      if (!care.open) return fail(404, "CARE_CLOSED", "No agent looks after positions here.");
      /* An agent looks after a position only where it knows the coin: in a pool opened to any coin the person does. */
      const kind = coinKindOf(gate.network, pier.solIsX ? pier.y.mint : pier.x.mint, env);
      if (kind === null) return fail(404, "CARE_CLOSED", "No agent looks after positions in this pool; the position is yours to look after.");
      /* The position must be this pier's: the approval itself names only the NFT. */
      await venue.positions.read({ pool: input.pool, nftMint });
      const watch = watchOf(pier, kind);
      stopBelow = stopBelowOf(watch.value, input.stopPct);
      const built = await venue.earn.approveCare({ nftMint, owner: input.owner, agent: care.agent });
      builds = [built];
      summary = { action: "care_on", agent: care.agent, rights: [...CARE_RIGHTS], stopBelow, stopCoin: watch.coin, stopUnit: watch.unit, networkLamports: built.feeLamports };
    } else {
      nftMint = input.nftMint;
      await venue.positions.read({ pool: input.pool, nftMint });
      const built = await venue.earn.endCare({ nftMint, owner: input.owner });
      builds = [built];
      summary = { action: "care_off", networkLamports: built.feeLamports };
    }

    if (builds.length > MAX_TICKET_MESSAGES) return fail(422, "REFUSED", "The action does not fit one approval.");
    const messages = builds.map((build) => digestOf(build.wireBase64));
    if (messages.some((digest) => digest === null)) return fail(503, "UNAVAILABLE", "A built transaction could not be read back; nothing is offered.");
    const issuedAt = now();
    const ticket = issueEarnProTicket({ network: gate.network, owner: input.owner, action: input.action, pool: input.pool, nftMint, messages: messages as string[], cosign: sealCosigners(cosigners, env), stopBelow }, env, issuedAt);
    if (!ticket) return fail(503, "UNAVAILABLE", "This server cannot seal a Review; nothing was built.");
    const read$ = readEarnProTicket(ticket, env, issuedAt);
    return { ok: true, value: { network: gate.network, action: input.action, ticket, transactions: builds.map((build) => build.wireBase64), expiresAt: read$.ok ? read$.ticket.expiresAt : issuedAt, summary } };
  } catch (error) {
    return failureOf(error);
  }
}

const RELAY_MS = 45_000;
const CALL_MS = 8_000;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The endpoint did not answer in time.")), Math.max(1, ms));
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

async function landed(connection: Connection, signature: string, deadline: number, pollMs: number): Promise<Readonly<{ state: "LANDED" | "FAILED" | "UNKNOWN"; reason: string | null }>> {
  while (Date.now() < deadline) {
    const status = await within(connection.getSignatureStatuses([signature]), Math.min(CALL_MS, Math.max(1, deadline - Date.now()))).then((answer) => answer.value[0], () => undefined);
    if (status?.err) return { state: "FAILED", reason: JSON.stringify(status.err).slice(0, 200) };
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return { state: "LANDED", reason: null };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { state: "UNKNOWN", reason: null };
}

/**
 * The wallet's signed bytes: held to the Review's ticket, then sent once each, in order, and settled from the chain's
 * answer. A refusal before the first send means nothing moved. A care's approval that landed is written into the
 * agent's book only once the chain itself shows it; a care taken back stops its row.
 */
export async function submitEarnPro(body: unknown, deps: EarnProDeps = {}): Promise<Readonly<{ ok: true; value: LiquidityRelay & Readonly<{ action: EarnProAction; nftMint: string }> }> | EarnProFailure> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  if (!body || typeof body !== "object") return fail(400, "BAD_REQUEST", "A relay takes a ticket and the signed transactions.");
  const { ticket: sealed, signed } = body as Record<string, unknown>;
  if (!Array.isArray(signed)) return fail(400, "BAD_REQUEST", "A relay takes a ticket and the signed transactions.");
  const read = readEarnProTicket(sealed, env, now());
  if (!read.ok) return read.code === "TICKET_EXPIRED" ? fail(410, "TICKET_EXPIRED", "The Review is older than its transactions; review again.") : fail(400, "TICKET_INVALID", "The Review's ticket is not one this server sealed.");
  const { ticket } = read;
  const gate = earnProGate(env);
  if (!gate.open || gate.network !== ticket.network) return fail(404, "EARN_PRO_CLOSED", "Earning on DLMM Pro is not served here.");
  if (heldByStop(ticket.action) && earnProStopped(env)) return fail(403, "EARN_PRO_STOPPED", "New money is stopped for now. Nothing was sent.");
  const cosigners = openCosigners(ticket.cosign, env);
  if (!cosigners) return fail(400, "TICKET_INVALID", "The Review's ticket is not one this server sealed.");
  const checked = checkEarnProSigned(ticket, signed, cosigners);
  if (!checked.ok) return fail(422, checked.code, checked.code === "NOT_SIGNED" ? "A signature is missing or does not match." : "The signed bytes are not the ones Review showed.");
  const connection = deps.connection ?? earnProConnection(gate.network);
  /* A care's row before its approval leaves: an answer lost on the way back never leaves a care nobody keeps. */
  let held: ProCareHold | null = null;
  if (ticket.action === "care_on") {
    held = await holdProCare({ owner: ticket.owner, pool: ticket.pool, nftMint: ticket.nftMint, stopBelow: ticket.stopBelow }, { ...deps.care, env }).catch(() => null);
    if (!held) return fail(503, "UNAVAILABLE", "The agent's book could not be written; nothing was sent.");
  }

  const deadline = Date.now() + (deps.relayMs ?? RELAY_MS);
  const results: { signature: string; state: RelayState; reason: string | null }[] = checked.signatures.map((signature) => ({ signature, state: "NOT_SENT", reason: null }));
  for (const [index, wire] of checked.wires.entries()) {
    const result = results[index]!;
    if (Date.now() >= deadline) break;
    try {
      await within(connection.sendRawTransaction(Buffer.from(wire, "base64"), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }), Math.min(CALL_MS, Math.max(1, deadline - Date.now())));
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n")[0]!.slice(0, 200) : "refused";
      /* A preflight refusal means the network never took the bytes — unless it had them already; anything else may have landed, so the chain is asked. */
      if (/simulation failed|preflight|blockhash not found/i.test(message) && !/already been processed|AlreadyProcessed/i.test(message)) {
        result.state = "FAILED";
        result.reason = message;
        if (index === 0) {
          await held?.undo().catch(() => undefined);
          return fail(422, /blockhash not found/i.test(message) ? "TICKET_EXPIRED" : "SIMULATION_FAILED", "The network refused the transaction before it was sent. Nothing moved.");
        }
        break;
      }
    }
    const answer = await landed(connection, result.signature, deadline, deps.pollMs ?? 1_500);
    result.state = answer.state;
    result.reason = answer.reason;
    if (answer.state !== "LANDED") break;
  }
  const settled = results.every((result) => result.state === "LANDED");
  if (settled && ticket.action === "care_on") await recordProCare({ owner: ticket.owner, pool: ticket.pool, nftMint: ticket.nftMint, stopBelow: ticket.stopBelow }, { ...deps.care, env, connection, ...(deps.venue ? { venue: deps.venue } : {}) }).catch(() => null);
  if (settled && (ticket.action === "care_off" || ticket.action === "close")) await endProCare({ owner: ticket.owner, nftMint: ticket.nftMint }, { ...deps.care, env }).catch(() => undefined);
  console.info(`earn-pro relay: ${ticket.network} ${ticket.action} ${results.map((result) => `${result.signature.slice(0, 8)}=${result.state}`).join(" ")}`);
  return { ok: true, value: { results, settled, action: ticket.action, nftMint: ticket.nftMint } };
}

/** The chain's word on signatures a relay sent — for an answer lost on the way back. Null where the chain did not answer. */
export async function earnProSignatureStates(signatures: readonly string[], deps: EarnProDeps = {}) {
  const gate = earnProGate(deps.env ?? process.env);
  if (!gate.open) return null;
  try {
    return await signatureStates(deps.connection ?? earnProConnection(gate.network), signatures);
  } catch {
    return null;
  }
}
