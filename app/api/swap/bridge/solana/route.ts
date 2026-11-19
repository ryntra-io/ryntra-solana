import { AddressLookupTableAccount, Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { z } from "zod";

import { consumeAgentControlRequest, consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { checkSignedCrossSwapTransaction, wireHash } from "@/lib/mayan/signed-transaction";
import { BRIDGE_SOLANA_PROGRAMS, BRIDGE_SOLANA_RELAY_PROGRAMS, signatureOfWire, solanaPlanOk } from "@/lib/relay/bridge-quote";
import { mutationOriginAllowed } from "@/lib/security";
import { createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { resendSameTransaction, sendTransactionOnce } from "@/lib/solana/submit-rpc";
import { LIGHTHOUSE_PROGRAM, lookupTableAddressesOf } from "@/lib/solana/wallet-modification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The Solana side of a Bridge order. A page cannot reach a Solana node (the site's policy), so the step of
 * a Relay plan the person's Solana wallet signs is built and sent here — and nothing else is:
 *
 * - `build` — the step's instructions as Relay's quote names them, every one of them a program Relay's plans use
 *   (`BRIDGE_SOLANA_PROGRAMS`), the person's wallet the only signer and the fee payer, with a fresh blockhash;
 * - `send` — the bytes the wallet signed, read against the bytes built (a wallet may add only its own guard), simulated
 *   with the signature checked, and sent once; when the network does not say whether it took them, the signature comes
 *   back with `unknown`, so the page follows the transfer instead of calling it failed;
 * - `status` — whether the network has it; while the order's blockhash is still valid the same signed bytes are offered
 *   again (the same transaction, never a second one), and once it is past, an order the network never saw is `expired`:
 *   nothing left the wallet.
 *
 * Signing is the wallet's alone; this server holds no key and adds no instruction.
 */
const Key = z.object({ pubkey: z.string().min(32).max(44), isSigner: z.boolean(), isWritable: z.boolean() }).passthrough();
const Instruction = z.object({ programId: z.string().min(32).max(44), keys: z.array(Key).max(64), data: z.string().max(4_096) }).passthrough();
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const Build = z.object({ action: z.literal("build"), owner: z.string().regex(BASE58), instructions: z.array(Instruction).min(1).max(24), lookupTables: z.array(z.string().regex(BASE58)).max(8).default([]) }).strict();
const Send = z.object({ action: z.literal("send"), owner: z.string().regex(BASE58), reviewed: z.string().min(40).max(4_000), signed: z.string().min(40).max(4_000) }).strict();
const Status = z
  .object({ action: z.literal("status"), signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/), signed: z.string().min(40).max(4_000).optional(), lastValidBlockHeight: z.number().int().positive().optional() })
  .strict();
const RequestSchema = z.discriminatedUnion("action", [Build, Send, Status]);

/** The programs a signed order may invoke: Relay's, and the guard a wallet may add of its own. */
const SIGNED_PROGRAMS = new Set([...BRIDGE_SOLANA_PROGRAMS, LIGHTHOUSE_PROGRAM]);

function respond(rate: RateLimitDecision) {
  const headers = { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
  return {
    ok: (body: Record<string, unknown>) => Response.json(body, { headers }),
    fail: (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status, headers }),
  };
}

function programsOf(wireBase64: string): string[] | null {
  try {
    const message = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64")).message;
    return message.compiledInstructions.map((ix) => message.staticAccountKeys[ix.programIdIndex]?.toBase58() ?? "");
  } catch {
    return null;
  }
}

async function lookupTablesOf(connection: Connection, addresses: readonly string[]): Promise<AddressLookupTableAccount[] | null> {
  if (addresses.length === 0) return [];
  const fetched = await Promise.all(addresses.map((address) => connection.getAddressLookupTable(new PublicKey(address))));
  if (fetched.some((entry) => entry.value === null)) return null;
  return fetched.map((entry) => entry.value as AddressLookupTableAccount);
}

async function build(input: z.output<typeof Build>, say: ReturnType<typeof respond>) {
  if (!solanaPlanOk(input.instructions.map((instruction) => instruction.programId))) return say.fail(409, "UNEXPECTED_PROGRAM", "This is not a plan of Relay's; nothing was built.");
  // The person's wallet is the only one asked to sign.
  if (input.instructions.some((instruction) => instruction.keys.some((key) => key.isSigner && key.pubkey !== input.owner))) {
    return say.fail(409, "SIGNER_SHAPE", "This plan asks another key to sign; nothing was built.");
  }
  const handle = createSolanaRpcHandle({ network: "mainnet" });
  const connection = new Connection(handle.endpoint, "confirmed");
  let instructions: TransactionInstruction[];
  try {
    instructions = input.instructions.map(
      (instruction) =>
        new TransactionInstruction({
          programId: new PublicKey(instruction.programId),
          keys: instruction.keys.map((key) => ({ pubkey: new PublicKey(key.pubkey), isSigner: key.isSigner, isWritable: key.isWritable })),
          data: Buffer.from(instruction.data, "hex"),
        }),
    );
  } catch {
    return say.fail(400, "ROUTE_SHAPE", "The plan's instructions could not be read.");
  }
  try {
    const tables = await lookupTablesOf(connection, input.lookupTables);
    if (tables === null) return say.fail(409, "BUILD_FAILED", "A lookup table of this plan is not on the network.");
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const message = new TransactionMessage({ payerKey: new PublicKey(input.owner), recentBlockhash: blockhash, instructions }).compileToV0Message(tables);
    if (message.header.numRequiredSignatures !== 1) return say.fail(409, "SIGNER_SHAPE", "This plan asks for more than the wallet's signature.");
    const unsigned = Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
    return say.ok({ unsigned, lastValidBlockHeight });
  } catch {
    return say.fail(502, "BUILD_FAILED", "The network did not answer; nothing was built.");
  }
}

async function send(input: z.output<typeof Send>, say: ReturnType<typeof respond>) {
  const programs = programsOf(input.signed);
  if (!programs || programs.length === 0) return say.fail(400, "UNREADABLE", "The signed order could not be read.");
  if (!programs.every((program) => SIGNED_PROGRAMS.has(program)) || !programs.some((program) => BRIDGE_SOLANA_RELAY_PROGRAMS.includes(program))) {
    return say.fail(409, "UNEXPECTED_PROGRAM", "The signed order reaches for a program this plan does not use; it was not sent.");
  }
  const reviewedPrograms = programsOf(input.reviewed);
  if (!reviewedPrograms || !solanaPlanOk(reviewedPrograms)) return say.fail(409, "UNEXPECTED_PROGRAM", "The order was not built here; it was not sent.");

  const handle = createSolanaRpcHandle({ network: "mainnet" });
  const lookupTables: Record<string, readonly string[]> = {};
  const addresses = [...new Set([...lookupTableAddressesOf(input.reviewed), ...lookupTableAddressesOf(input.signed)])];
  if (addresses.length > 0) {
    try {
      const connection = new Connection(handle.endpoint, "confirmed");
      const fetched = await Promise.all(addresses.map((address) => connection.getAddressLookupTable(new PublicKey(address))));
      fetched.forEach((entry, index) => {
        if (entry.value) lookupTables[addresses[index]!] = entry.value.state.addresses.map((address) => address.toBase58());
      });
    } catch {
      // Unread tables make the comparison stricter, never looser.
    }
  }
  const check = checkSignedCrossSwapTransaction({ reviewedWireBase64: input.reviewed, reviewedWireHash: wireHash(input.reviewed), signedWireBase64: input.signed, owner: input.owner, lookupTables });
  if (!check.ok) return say.fail(409, check.code, "The wallet returned a different order than the one built; it was not sent.");

  try {
    const simulation = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc.simulateTransaction(input.signed as never, { encoding: "base64", sigVerify: true, replaceRecentBlockhash: false, commitment: "confirmed" }).send({ abortSignal }),
    );
    if (simulation.value.err !== null && simulation.value.err !== undefined) {
      const error = JSON.stringify(simulation.value.err, (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry));
      if (/BlockhashNotFound/i.test(error)) return say.fail(409, "EXPIRED", "The order expired before it was sent. Nothing left your wallet.");
      return say.fail(409, "SIMULATION_FAILED", "The order would fail on the network, so it was not sent. Nothing left your wallet.");
    }
  } catch {
    return say.fail(502, "SIMULATION_UNAVAILABLE", "The network did not answer. Nothing was sent.");
  }
  try {
    const signature = await sendTransactionOnce({ handle, signedWireBase64: input.signed });
    return say.ok({ signature });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/Blockhash not found|block height exceeded|expired/i.test(message)) return say.fail(409, "EXPIRED", "The order expired before it was sent. Nothing left your wallet.");
    // It may be on its way: the signature is known, and the page follows it rather than calling it failed.
    return say.ok({ signature: check.signature, unknown: true });
  }
}

/** Blocks past the order's last valid height before it is called expired: a margin for the network's own lag. */
const EXPIRY_MARGIN = 30;

async function status(input: z.output<typeof Status>, say: ReturnType<typeof respond>) {
  // The signed bytes offered again are only the ones this signature names, and only an order of Relay's.
  const signed = input.signed && signatureOfWire(input.signed) === input.signature ? input.signed : null;
  const programs = signed ? programsOf(signed) : null;
  const resendable = signed !== null && programs !== null && programs.every((program) => SIGNED_PROGRAMS.has(program)) && programs.some((program) => BRIDGE_SOLANA_RELAY_PROGRAMS.includes(program));
  const handle = createSolanaRpcHandle({ network: "mainnet" });
  try {
    // The height first, then the signature: an order that lands between the two reads is seen, never called expired.
    const height = input.lastValidBlockHeight !== undefined ? Number(await withRpcDiscipline(handle, (abortSignal) => handle.rpc.getBlockHeight({ commitment: "confirmed" }).send({ abortSignal }))) : null;
    const answer = await withRpcDiscipline(handle, (abortSignal) => handle.rpc.getSignatureStatuses([input.signature as never], { searchTransactionHistory: true }).send({ abortSignal }));
    const entry = answer.value[0];
    if (entry) {
      if (entry.err) return say.ok({ state: "failed" });
      return say.ok({ state: entry.confirmationStatus === "confirmed" || entry.confirmationStatus === "finalized" ? "confirmed" : "processing" });
    }
    // Past its blockhash and never seen: the order can no longer land, and nothing left the wallet.
    if (height !== null && input.lastValidBlockHeight !== undefined && height > input.lastValidBlockHeight + EXPIRY_MARGIN) return say.ok({ state: "expired" });
    // Still valid and not seen yet: the same signed bytes, offered again — the same transaction, never a second one.
    if (resendable && signed) await resendSameTransaction({ handle, signedWireBase64: signed }).catch(() => undefined);
    return say.ok({ state: "unknown" });
  } catch {
    return say.ok({ state: "unknown" });
  }
}

export async function POST(request: Request) {
  const body = await readAgentControlJson(request);
  const action = body.ok && body.value && typeof body.value === "object" ? (body.value as { action?: unknown }).action : null;
  // Building and sending count against the actions' window; reading a status, the reads'.
  const rate = action === "status" ? consumeSolanaReadRequest(request.headers) : consumeAgentControlRequest(request.headers);
  const say = respond(rate);
  if (!rate.allowed) return say.fail(429, "RATE_LIMITED", "Too many requests.");
  if (!mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) return say.fail(403, "ORIGIN_REFUSED", "Refused.");
  if (!body.ok) return say.fail(body.status, body.code, "The request body was not accepted.");
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return say.fail(400, "VALIDATION_ERROR", "The request did not match its schema.");
  const input = parsed.data;
  if (input.action === "build") return build(input, say);
  if (input.action === "send") return send(input, say);
  return status(input, say);
}
