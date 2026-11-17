/**
 * «Clean the wallet» — the service behind `/api/v1/wallet/clean/**`: the read, the short reader, the Review that builds
 * one clean, and the relay that sends it.
 *
 * A clean is the person's own wallet signing, once, a short package:
 *
 *   closes (empty accounts, wrapped SOL, litter burnt) → swaps of the small coins into SOL → the close of the accounts
 *   the swaps emptied
 *
 * The swaps are the swap engine's, as they are: the same venue, the same fee policy and lane choice, the same referral
 * and a partner's friend's discount (`lib/core/solana-swap/prepare.ts` asks it the same way), the same pre-sign check of
 * the provider's bytes. Nothing here changes a route, a fee or a signature: it only asks. Closing an account is free.
 * Ryntra never signs and never holds a key; the relay sends only what the ticket sealed.
 */

import "server-only";

import {
  ComputeBudgetProgram,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import { createBurnInstruction, createCloseAccountInstruction, createHarvestWithheldTokensToMintInstruction } from "@solana/spl-token";

import { readRefereeDiscountBps } from "../core/referee-discount.ts";
import { askVenueOrder } from "../core/solana-swap/venue-order.ts";
import { createJupiterSwapVenue, type JupiterSwapVenue } from "../core/venues/jupiter.ts";
import { getGuardRuntime } from "../guard/runtime.ts";
import { resolveSolanaLaneState } from "../solana/lane-state.ts";
import { resolveJupiterSwapEndpoint } from "../solana/quotes.ts";
import { verifiedJupiterReferral } from "../solana/referral-account.server.ts";
import { createSolanaRpcHandle } from "../solana/rpc.ts";
import { inspectJupiterSwapTransaction } from "../solana/swap-transaction-check.ts";
import { resolveServiceFeeConfig } from "../swap/service-fee.server.ts";
import type { WalletCleanBackResponse, WalletCleanReadResponse, WalletCleanReviewResponse, WalletCleanSubmitResponse, WalletCleanSummary } from "../api/v1/contract.ts";
import { cleanConnection, readAccounts, readWallet, within } from "./read.server.ts";
import {
  alreadyProcessed,
  WSOL_MINT,
  backOf,
  cleanItems,
  closeSteps,
  planOf,
  rentBackLamports,
  riskOf,
  smallUsd,
  takenItems,
  type CleanItem,
  type RiskReason,
} from "./rules.ts";
import { checkCleanSigned, cleanTicketKeyHere, issueCleanTicket, lookupsOf, readCleanTicket, stepDigest, TICKET_TTL_MS, type CleanStep } from "./ticket.ts";

type Env = Readonly<Record<string, string | undefined>>;

export const WALLET_CLEAN_ENV = "RYNTRA_WALLET_CLEAN";

/** Whether this deployment builds a clean: its own switch, a sealing key, and swapping open. */
export function cleanOpen(env: Env = process.env): boolean {
  return env[WALLET_CLEAN_ENV]?.trim() === "open" && cleanTicketKeyHere(env);
}

export type CleanFailureCode = "CLOSED" | "BAD_REQUEST" | "NOTHING_TO_DO" | "UNAVAILABLE" | "TICKET_INVALID" | "TICKET_EXPIRED" | "SIGNED_MISMATCH" | "NOT_SIGNED" | "SIMULATION_FAILED";
export type CleanFailure = Readonly<{ ok: false; status: number; code: CleanFailureCode; reason: string }>;
const fail = (status: number, code: CleanFailureCode, reason: string): CleanFailure => ({ ok: false, status, code, reason });

export type CleanDeps = Readonly<{ env?: Env; connection?: Connection; now?: () => number; venue?: SwapAsk; relayMs?: number; pollMs?: number }>;

/* ── the read ─────────────────────────────────────────────────────────── */

/** The items of a wallet now; with no market answer, only what needs no price: empty accounts and wrapped SOL. */
async function itemsNow(owner: string, connection: Connection) {
  const read = await readWallet(owner, connection);
  const all = cleanItems(owner, read.accounts, read.facts);
  const items = read.priced ? all : all.filter((item) => item.kind === "empty" || item.kind === "wrapped");
  return { read, items };
}

export async function cleanReadAnswer(owner: string, deps: CleanDeps = {}): Promise<WalletCleanReadResponse> {
  const env = deps.env ?? process.env;
  const connection = deps.connection ?? cleanConnection();
  const { read, items } = await itemsNow(owner, connection);
  const picked = items.filter((item) => item.picked);
  const risky: { mint: string; risk: RiskReason[] }[] = [];
  if (read.priced) {
    for (const mint of new Set(read.accounts.filter((account) => BigInt(account.amountRaw || "0") > 0n).map((account) => account.mint))) {
      const risk = riskOf(read.facts.get(mint) ?? null);
      if (risk.length) risky.push({ mint, risk: [...risk] });
    }
  }
  return {
    owner,
    items: items.slice(0, 300).map((item) => ({ ...item, risk: [...item.risk], symbol: item.symbol.slice(0, 24), name: item.name?.slice(0, 80) ?? null })),
    risky: risky.slice(0, 300),
    backLamports: rentBackLamports(picked),
    smallUsd: smallUsd(picked),
    solUsd: read.solUsd,
    priced: read.priced,
    canClean: cleanOpen(env),
    at: new Date((deps.now ?? Date.now)()).toISOString(),
  };
}

export async function cleanBackAnswer(owner: string, deps: CleanDeps = {}): Promise<WalletCleanBackResponse> {
  const accounts = await readAccounts(owner, deps.connection ?? cleanConnection());
  const back = backOf(owner, accounts);
  return { owner, lamports: back.lamports, accounts: back.accounts, at: new Date((deps.now ?? Date.now)()).toISOString() };
}

/* ── the Review ───────────────────────────────────────────────────────── */

/** A swap of one small coin into SOL, asked of the swap engine's own venue; the reason it could not be carried otherwise. */
export type SwapAsk = (item: CleanItem, owner: string) => Promise<Readonly<{ ok: true; wire: string; requestId: string | null; outLamports: bigint; feeBps: number }> | Readonly<{ ok: false; reason: "NO_ROUTE" | "TOO_SMALL" | "REFUSED" | "PAUSED" }>>;

/** The swap engine's venue, set up as the swap's prepare half sets it up: the keyed endpoint, the verified referral, the fee policy's lanes, the taker's discount. */
async function engineVenue(owner: string): Promise<JupiterSwapVenue | null> {
  const endpoint = resolveJupiterSwapEndpoint({ access: "production" });
  if (!endpoint.ok) return null;
  const config = resolveServiceFeeConfig();
  // The taker's discount as the Swap screen reads it; a discount not read is no swap here, never a fuller fee.
  const read = await Promise.all([verifiedJupiterReferral(config), readRefereeDiscountBps(getGuardRuntime().store, owner)]).catch(() => null);
  if (!read) return null;
  const [verified, feeDiscountBps] = read;
  return createJupiterSwapVenue({ endpoint, referral: verified.referral, config, lanes: { handle: createSolanaRpcHandle({ network: "mainnet" }), feeDiscountBps } });
}

function engineSwaps(): SwapAsk {
  const venues = new Map<string, Promise<JupiterSwapVenue | null>>();
  return async (item, owner) => {
    if (resolveSolanaLaneState("SWAP") !== "OPEN") return { ok: false, reason: "PAUSED" };
    const venue = await (venues.get(owner) ?? venues.set(owner, engineVenue(owner)).get(owner)!);
    if (!venue) return { ok: false, reason: "PAUSED" };
    const account = { kind: "WALLET", network: "solana", address: owner } as const;
    const answer = await askVenueOrder(venue, { network: "solana", inputAsset: item.mint, outputAsset: WSOL_MINT, amountRaw: item.amountRaw, account });
    if (!answer.ok) return { ok: false, reason: answer.code === "NO_ROUTE" || answer.code === "BUILD_FAILED" ? "NO_ROUTE" : "REFUSED" };
    const order = answer.quote.native;
    // The provider's bytes pass the swap's own pre-sign check for this wallet, and the wallet pays for them.
    const unsigned = await venue.build(answer.quote, account);
    const check = await inspectJupiterSwapTransaction({ wireBase64: unsigned.wireBase64, expectedTaker: owner });
    if (!check.ok) return { ok: false, reason: "REFUSED" };
    const out = /^\d+$/.test(order.outAmountRaw) ? BigInt(order.outAmountRaw) : 0n;
    if (out === 0n) return { ok: false, reason: "TOO_SMALL" };
    // What the ticket can carry and the relay can send: a managed order's id within Jupiter's own bound, at most eight tables.
    if (order.requestId.length > 128 || (lookupsOf(unsigned.wireBase64)?.length ?? 9) > 8) return { ok: false, reason: "REFUSED" };
    return { ok: true, wire: unsigned.wireBase64, requestId: order.requestId.startsWith("build:") ? null : order.requestId, outLamports: out, feeBps: order.ryntraFee.basisPoints };
  };
}

/** A close's priority: a short fixed price, well under a cent for the whole package. */
const CLOSE_CU_PRICE = 20_000;

function closeInstructions(item: CleanItem, owner: PublicKey, withBurn: boolean): TransactionInstruction[] {
  const program = new PublicKey(item.program);
  const account = new PublicKey(item.account);
  const mint = new PublicKey(item.mint);
  const steps = closeSteps(item);
  const out: TransactionInstruction[] = [];
  if (steps.harvest) out.push(createHarvestWithheldTokensToMintInstruction(mint, [account], program));
  if (withBurn && steps.burnRaw) out.push(createBurnInstruction(account, mint, owner, BigInt(steps.burnRaw), [], program));
  out.push(createCloseAccountInstruction(account, owner, owner, [], program));
  return out;
}

function closeWire(items: readonly CleanItem[], owner: PublicKey, blockhash: string, withBurn: boolean): string {
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 12_000 * items.length + 20_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CLOSE_CU_PRICE }),
    ...items.flatMap((item) => closeInstructions(item, owner, withBurn)),
  ];
  const message = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

async function simulates(connection: Connection, wire: string): Promise<boolean> {
  try {
    const answer = await within(connection.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(wire, "base64")), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }));
    return answer.value.err === null;
  } catch {
    return false;
  }
}

/** A batch of closes the network takes as built; an account it refuses is left out and the rest go. */
async function closesThatLand(connection: Connection, batch: readonly CleanItem[], owner: PublicKey, blockhash: string): Promise<readonly CleanItem[]> {
  if (await simulates(connection, closeWire(batch, owner, blockhash, true))) return batch;
  const kept: CleanItem[] = [];
  for (const item of batch) if (await simulates(connection, closeWire([item], owner, blockhash, true))) kept.push(item);
  return kept;
}

async function tablesOf(connection: Connection, keys: readonly string[]): Promise<Map<string, AddressLookupTableAccount>> {
  const tables = new Map<string, AddressLookupTableAccount>();
  await Promise.all(
    [...new Set(keys)].map(async (key) => {
      const answer = await within(connection.getAddressLookupTable(new PublicKey(key))).catch(() => null);
      if (answer?.value) tables.set(key, answer.value);
    }),
  );
  return tables;
}

export type CleanReviewInput = Readonly<{ owner: string; add?: readonly string[]; drop?: readonly string[] }>;

/**
 * One clean, built: the wallet read now, what the person took in and out, the closes the network takes, the swaps the
 * engine routes, and the close after them — sealed in a ticket. Each swap the engine cannot carry is named, with why.
 */
export async function reviewClean(input: CleanReviewInput, deps: CleanDeps = {}): Promise<Readonly<{ ok: true; value: WalletCleanReviewResponse }> | CleanFailure> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  if (!cleanOpen(env)) return fail(404, "CLOSED", "Cleaning a wallet is not served here.");
  const connection = deps.connection ?? cleanConnection();
  const owner = new PublicKey(input.owner);
  try {
    const { items } = await itemsNow(input.owner, connection);
    const plan = planOf(takenItems(items, { add: input.add ?? [], drop: input.drop ?? [] }));
    const ask = deps.venue ?? engineSwaps();

    const swaps: { item: CleanItem; wire: string; requestId: string | null; out: bigint; feeBps: number }[] = [];
    const skipped: WalletCleanSummary["skipped"][number][] = [];
    for (const item of plan.swaps) {
      const answer = await ask(item, input.owner).catch(() => ({ ok: false as const, reason: "REFUSED" as const }));
      if (answer.ok) swaps.push({ item, wire: answer.wire, requestId: answer.requestId, out: answer.outLamports, feeBps: answer.feeBps });
      else skipped.push({ mint: item.mint, symbol: item.symbol.slice(0, 24), reason: answer.reason });
    }

    const { blockhash } = await within(connection.getLatestBlockhash("confirmed"));
    const closes: (readonly CleanItem[])[] = [];
    for (const batch of plan.closes) {
      const kept = await closesThatLand(connection, batch, owner, blockhash);
      if (kept.length) closes.push(kept);
    }
    const after = swaps.map((swap) => swap.item);

    const wires: { kind: CleanStep["kind"]; wire: string; requestId: string | null }[] = [
      ...closes.map((batch) => ({ kind: "close" as const, wire: closeWire(batch, owner, blockhash, true), requestId: null })),
      ...swaps.map((swap) => ({ kind: "swap" as const, wire: swap.wire, requestId: swap.requestId })),
      ...(after.length ? [{ kind: "after" as const, wire: closeWire(after, owner, blockhash, false), requestId: null }] : []),
    ];
    if (!wires.length) return fail(409, "NOTHING_TO_DO", skipped.length ? "Jupiter takes none of these coins now; nothing was built." : "There is nothing to clean in this wallet.");

    const lookups = wires.map((entry) => lookupsOf(entry.wire));
    if (lookups.some((keys) => keys === null)) return fail(503, "UNAVAILABLE", "A transaction could not be read back; nothing was built.");
    const tables = await tablesOf(connection, lookups.flatMap((keys) => keys ?? []));
    const steps: CleanStep[] = [];
    for (const [index, entry] of wires.entries()) {
      const own = (lookups[index] ?? []).map((key) => tables.get(key));
      if (own.some((table) => !table)) return fail(503, "UNAVAILABLE", "A lookup table could not be read; nothing was built.");
      const digest = stepDigest(entry.wire, own as AddressLookupTableAccount[]);
      if (!digest) return fail(503, "UNAVAILABLE", "A transaction could not be read back; nothing was built.");
      steps.push({ kind: entry.kind, digest, lookups: lookups[index] ?? [], requestId: entry.requestId });
    }
    const issuedAt = now();
    const ticket = issueCleanTicket({ owner: input.owner, steps }, env, issuedAt);
    if (!ticket) return fail(503, "UNAVAILABLE", "This server cannot seal a clean; nothing was built.");

    const closed = closes.flat();
    const rent = BigInt(rentBackLamports(closed) + rentBackLamports(after));
    const swapLamports = swaps.reduce((sum, swap) => sum + swap.out, 0n);
    const fees = swaps.map((swap) => swap.feeBps);
    return {
      ok: true,
      value: {
        owner: input.owner,
        ticket,
        transactions: wires.map((entry) => entry.wire),
        kinds: wires.map((entry) => entry.kind),
        expiresAt: new Date(issuedAt + TICKET_TTL_MS).toISOString(),
        summary: {
          receiveLamports: (rent + swapLamports).toString(),
          rentLamports: rent.toString(),
          swapLamports: swapLamports.toString(),
          swaps: swaps.length,
          closes: closed.length + after.length,
          burns: closed.filter((item) => closeSteps(item).burnRaw !== null).length,
          feeBps: fees.length ? Math.max(...fees) : null,
          skipped: skipped.slice(0, 50),
          left: plan.left + Math.max(0, plan.closes.flat().length - closed.length),
        },
      },
    };
  } catch {
    return fail(503, "UNAVAILABLE", "The network could not be read now; nothing was built. Try again.");
  }
}

/* ── the relay ────────────────────────────────────────────────────────── */

const RELAY_MS = 45_000;
const CALL_MS = 8_000;

type RelayState = WalletCleanSubmitResponse["results"][number]["state"];

async function landed(connection: Connection, signature: string, deadline: number, pollMs: number): Promise<Readonly<{ state: "LANDED" | "FAILED" | "UNKNOWN"; reason: string | null }>> {
  while (Date.now() < deadline) {
    const status = await within(connection.getSignatureStatuses([signature]), Math.min(CALL_MS, Math.max(1, deadline - Date.now()))).then((answer) => answer.value[0], () => undefined);
    if (status?.err) return { state: "FAILED", reason: JSON.stringify(status.err).slice(0, 200) };
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return { state: "LANDED", reason: null };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { state: "UNKNOWN", reason: null };
}

const firstLine = (error: unknown): string => (error instanceof Error ? error.message.split("\n")[0]!.slice(0, 200) : "refused");

export type CleanRelayDeps = CleanDeps & Readonly<{ execute?: (signed: string, requestId: string) => Promise<Readonly<{ sent: boolean; reason: string | null }>> }>;

async function engineExecute(signed: string, requestId: string): Promise<Readonly<{ sent: boolean; reason: string | null }>> {
  const endpoint = resolveJupiterSwapEndpoint({ access: "production" });
  if (!endpoint.ok) return { sent: false, reason: endpoint.reason };
  const venue = createJupiterSwapVenue({ endpoint, referral: null, config: resolveServiceFeeConfig() });
  const answer = await venue.execute(signed, requestId);
  // Jupiter's «Failed» with no signature landed nothing; with one, the chain is asked.
  if (answer.ok) return { sent: answer.report.status === "Success" || answer.report.signature !== null, reason: answer.report.status === "Failed" ? answer.report.providerError : null };
  // The POST may have left: the chain is asked by signature, never Jupiter again.
  return { sent: answer.possiblySubmitted, reason: answer.reason.slice(0, 200) };
}

/**
 * The wallet's signed bytes: held to the ticket, then sent once each — the closes first, the swaps (Jupiter's managed
 * lane through its `/execute`, the rest through the deployment's RPC), and once the swaps have landed the close after
 * them, which the network refuses if a swap did not empty its account. Nothing is sent twice.
 */
export async function submitClean(body: unknown, deps: CleanRelayDeps = {}): Promise<Readonly<{ ok: true; value: WalletCleanSubmitResponse }> | CleanFailure> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  if (!body || typeof body !== "object") return fail(400, "BAD_REQUEST", "A relay takes a ticket and the signed transactions.");
  const { ticket: sealed, signed } = body as Record<string, unknown>;
  if (!Array.isArray(signed)) return fail(400, "BAD_REQUEST", "A relay takes a ticket and the signed transactions.");
  const read = readCleanTicket(sealed, env, now());
  if (!read.ok) return read.code === "TICKET_EXPIRED" ? fail(410, "TICKET_EXPIRED", "The clean is older than its transactions; review again.") : fail(400, "TICKET_INVALID", "The clean's ticket is not one this server sealed.");
  if (!cleanOpen(env)) return fail(404, "CLOSED", "Cleaning a wallet is not served here.");
  const { ticket } = read;
  const connection = deps.connection ?? cleanConnection();
  // The relay's whole time starts here: everything after, the tables included, fits inside the route's own minute.
  const deadline = Date.now() + (deps.relayMs ?? RELAY_MS);
  const tables = await tablesOf(connection, ticket.steps.flatMap((step) => step.lookups));
  const checked = checkCleanSigned(ticket, signed, tables);
  if (!checked.ok) return fail(422, checked.code, checked.code === "NOT_SIGNED" ? "The wallet's signature is missing or does not match." : "The signed bytes are not the ones the clean built.");

  const pollMs = deps.pollMs ?? 1_500;
  const execute = deps.execute ?? engineExecute;
  const results: { kind: CleanStep["kind"]; signature: string; state: RelayState; reason: string | null }[] = ticket.steps.map((step, index) => ({ kind: step.kind, signature: checked.signatures[index]!, state: "NOT_SENT", reason: null }));
  const sendRpc = async (index: number): Promise<boolean> => {
    try {
      await within(connection.sendRawTransaction(Buffer.from(checked.wires[index]!, "base64"), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }), Math.max(1, Math.min(CALL_MS, deadline - Date.now())));
      return true;
    } catch (error) {
      if (alreadyProcessed(error)) return true;
      const message = firstLine(error);
      // A preflight refusal means the network never took the bytes; anything else may have landed and is read back.
      if (/simulation failed|preflight|blockhash not found/i.test(message)) {
        results[index]!.reason = message;
        return false;
      }
      return true;
    }
  };

  // Every close and swap goes at once, each bounded by the relay's deadline: the function never outlives its money.
  const left = () => Math.max(1, deadline - Date.now());
  const sentNow: number[] = [];
  await Promise.all(
    ticket.steps.map(async (step, index) => {
      if (step.kind === "after") return;
      if (step.kind === "swap" && step.requestId) {
        const answer = await within(execute(checked.wires[index]!, step.requestId), left()).catch((error: unknown) => ({ sent: true, reason: firstLine(error) }));
        results[index]!.reason = answer.reason;
        if (answer.sent) sentNow.push(index);
      } else if (await sendRpc(index)) sentNow.push(index);
    }),
  );
  await Promise.all(
    sentNow.map(async (index) => {
      const answer = await landed(connection, results[index]!.signature, deadline, pollMs);
      results[index]!.state = answer.state;
      results[index]!.reason = answer.reason ?? results[index]!.reason;
    }),
  );
  const swapsLanded = ticket.steps.every((step, index) => step.kind !== "swap" || results[index]!.state === "LANDED");
  for (const [index, step] of ticket.steps.entries()) {
    if (step.kind !== "after") continue;
    if (!swapsLanded) {
      results[index]!.reason = "A swap did not land; its account stays for the next clean.";
      continue;
    }
    if (await sendRpc(index)) {
      const answer = await landed(connection, results[index]!.signature, deadline, pollMs);
      results[index]!.state = answer.state;
      results[index]!.reason = answer.reason;
    }
  }
  for (const result of results) if (result.state === "NOT_SENT" && result.reason === null) result.reason = "Not sent.";
  console.info(`wallet-clean relay: ${results.map((result) => `${result.kind}:${result.signature.slice(0, 8)}=${result.state}`).join(" ")}`);
  return { ok: true, value: { results: results.map((result) => ({ ...result, reason: result.reason?.slice(0, 240) ?? null })), settled: results.every((result) => result.state === "LANDED") } };
}

