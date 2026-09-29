import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
} from "@solana/kit";

import { mutationOriginAllowed } from "@/lib/security";
import { bridgeFailure, bridgeHeaders, describeBridgeIssues } from "@/lib/solana/bridge-http";
import { SOLANA_ADDRESS_PATTERN } from "@/lib/solana/cctp-direction";
import {
  CCTP_LOOKUP_TABLE_ENV_BY_DOMAIN,
  cctpLookupCoverage,
  cctpReceiveLookupAddresses,
  readCctpLookupTable,
  resolveCctpLookupTableAddress,
} from "@/lib/solana/cctp-lookup-table";
import {
  buildCreateLookupTableInstruction,
  buildExtendLookupTableInstruction,
  deriveLookupTableAddress,
  LOOKUP_TABLE_EXTEND_CHUNK,
} from "@/lib/solana/cctp-lookup-table-build";
import { SOLANA_CCTP_MAINNET_REGISTRY } from "@/lib/solana/cctp-registry";
import { readTokenMessengerFeeRecipient, SOLANA_TOKEN_PROGRAM } from "@/lib/solana/cctp-receive";
import { deriveCctpReceiveAccounts } from "@/lib/solana/cctp-receive";
import { createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { sendTransactionOnce, SolanaSubmitRpcError } from "@/lib/solana/submit-rpc";
import { associatedTokenAccount } from "@/lib/solana/token-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The lane's address lookup table: what it is for, how it is built, and how it
 * is read back.
 *
 * A one-time operator step, and the reason it exists is a measurement rather
 * than a preference. The first real Base → Solana transfer compiled to **1,226
 * bytes of Solana's 1,232-byte limit**, and Phantom blocked it in red — not on
 * reputation, but because a wallet cannot safely simulate a transaction at the
 * edge of the packet size, which its own developer documentation names as this
 * exact case. Six bytes of headroom is a defect on its own terms too: a longer
 * attestation and the transfer would stop being constructible after the money
 * had already burned on Base.
 *
 * Fifteen of the twenty accounts a receive names never change. This table holds
 * them so the message carries indices instead of addresses.
 *
 * ## What this route may and may not do
 *
 * It builds and it submits once. It holds no key: the table's authority is the
 * wallet that signs, which means the deployment cannot alter or close its own
 * table without that wallet — and neither can anyone else. The bytes are
 * **simulated before they are offered to a wallet**, which is both the honest
 * thing and the fourth of Phantom's four published conditions.
 *
 * Nothing here touches a transfer. It cannot burn, receive, or move USDC, and it
 * reads no claim.
 */

/**
 * Which source chain the table is for. One table per source domain, because
 * the token pair and the remote messenger it holds are derived from the
 * domain the message comes from. Base when unsaid, as every earlier caller
 * meant; `ethereum` builds and reads the table the Ethereum → Solana receive
 * compresses through, under its own variable.
 */
const SourceChainSchema = z.enum(["base", "ethereum"]).default("base");

const StatusSchema = z.object({ phase: z.literal("STATUS"), sourceChain: SourceChainSchema }).strict();

const PlanSchema = z
  .object({
    phase: z.literal("PLAN"),
    sourceChain: SourceChainSchema,
    /** The wallet that will own the table and pay its rent. */
    authority: z.string().regex(SOLANA_ADDRESS_PATTERN),
  })
  .strict();

const SubmitSchema = z
  .object({
    phase: z.literal("SUBMIT"),
    sourceChain: SourceChainSchema,
    signedTransactionBase64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(12_000),
  })
  .strict();

const RequestSchema = z.discriminatedUnion("phase", [StatusSchema, PlanSchema, SubmitSchema]);

async function laneAddresses(sourceChain: "base" | "ethereum") {
  const handle = createSolanaRpcHandle({ network: "mainnet" });
  const usdc = SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address;
  const source = SOLANA_CCTP_MAINNET_REGISTRY.chains[sourceChain];
  const sourceDomain = source.domain;
  const remoteTokenHex = `${"0".repeat(24)}${source.asset.address.slice(2).toLowerCase()}`;
  const derived = await deriveCctpReceiveAccounts({
    sourceDomain,
    remoteTokenHex,
    nonce: `0x${"11".repeat(32)}`,
  });
  const messenger = await withRpcDiscipline(handle, (abortSignal) =>
    handle.rpc.getAccountInfo(derived.tokenMessenger as never, { commitment: "confirmed", encoding: "base64" }).send({ abortSignal }),
  );
  const encoded = messenger.value?.data;
  const owner = Array.isArray(encoded)
    ? readTokenMessengerFeeRecipient(Uint8Array.from(Buffer.from(String(encoded[0]), "base64")))
    : null;
  if (!owner) throw new Error("Circle's fee account for this route could not be read.");
  const feeRecipientTokenAccount = await associatedTokenAccount({
    owner,
    mint: usdc,
    tokenProgram: SOLANA_TOKEN_PROGRAM,
  });
  const addresses = await cctpReceiveLookupAddresses({
    sourceDomain,
    remoteTokenHex,
    feeRecipientTokenAccount,
  });
  return { handle, addresses, sourceDomain };
}

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return bridgeFailure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return bridgeFailure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return bridgeFailure(400, "VALIDATION_ERROR", describeBridgeIssues(parsed.error), rate);

  let lane: Awaited<ReturnType<typeof laneAddresses>>;
  try {
    lane = await laneAddresses(parsed.data.sourceChain);
  } catch (cause) {
    return bridgeFailure(
      503,
      "LANE_UNREADABLE",
      `The lane's constant accounts could not be derived: ${cause instanceof Error ? cause.message : String(cause)}`,
      rate,
    );
  }
  const { handle, addresses, sourceDomain } = lane;

  if (parsed.data.phase === "STATUS") {
    const configured = resolveCctpLookupTableAddress(process.env, sourceDomain);
    const table = await readCctpLookupTable(handle, configured);
    return Response.json(
      {
        data: {
          configured,
          table,
          expected: addresses,
          coverage: cctpLookupCoverage({ table, derived: addresses }),
        },
      },
      { headers: bridgeHeaders(rate) },
    );
  }

  if (!mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return bridgeFailure(403, "FORBIDDEN_ORIGIN", "This step must be requested from this site.", rate);
  }

  if (parsed.data.phase === "PLAN") {
    const authority = parsed.data.authority;
    if (addresses.length > LOOKUP_TABLE_EXTEND_CHUNK) {
      return bridgeFailure(
        422,
        "TOO_MANY_ADDRESSES",
        "This lane needs more addresses than one extend carries, so the table cannot be filled in a single signature.",
        rate,
      );
    }

    let slot: bigint;
    let blockhash: string;
    let lastValidBlockHeight: string;
    try {
      /* The create instruction re-derives the table from this slot, and the
         runtime refuses a slot that is not recent. One behind the tip is the
         safe choice: the tip can advance between the read and the signature. */
      const [current, latest] = await Promise.all([
        withRpcDiscipline(handle, (abortSignal) => handle.rpc.getSlot({ commitment: "finalized" }).send({ abortSignal })),
        withRpcDiscipline(handle, (abortSignal) =>
          handle.rpc.getLatestBlockhash({ commitment: "confirmed" }).send({ abortSignal }),
        ),
      ]);
      slot = BigInt(current);
      blockhash = String(latest.value.blockhash);
      lastValidBlockHeight = String(latest.value.lastValidBlockHeight);
    } catch (cause) {
      return bridgeFailure(
        503,
        "CLUSTER_UNAVAILABLE",
        `The cluster did not answer for a slot and a blockhash: ${cause instanceof Error ? cause.message : String(cause)}`,
        rate,
      );
    }

    const { address: table, bump } = await deriveLookupTableAddress({ authority, recentSlot: slot });
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayer(authority as Address, draft),
      (draft) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: blockhash as Blockhash, lastValidBlockHeight: BigInt(lastValidBlockHeight) },
          draft,
        ),
      (draft) =>
        appendTransactionMessageInstructions(
          [
            buildCreateLookupTableInstruction({ table, authority, payer: authority, recentSlot: slot, bump }),
            buildExtendLookupTableInstruction({ table, authority, payer: authority, addresses }),
          ],
          draft,
        ),
    );
    const compiled = compileTransaction(message);
    const unsignedWireBase64 = getBase64EncodedWireTransaction(compiled);

    /* Simulated before it is offered to a wallet, which is the fourth of
       Phantom's four published conditions and the right order regardless of
       which wallet is asked. */
    let simulation: Readonly<{ succeeded: boolean; error: string | null; unitsConsumed: string | null }>;
    try {
      const response = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc
          .simulateTransaction(unsignedWireBase64 as never, {
            encoding: "base64",
            sigVerify: false,
            replaceRecentBlockhash: false,
            commitment: "confirmed",
          })
          .send({ abortSignal }),
      );
      const failed = response.value.err !== null && response.value.err !== undefined;
      simulation = {
        succeeded: !failed,
        error: failed
          ? JSON.stringify(response.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
          : null,
        unitsConsumed:
          response.value.unitsConsumed === null || response.value.unitsConsumed === undefined
            ? null
            : String(response.value.unitsConsumed),
      };
    } catch (cause) {
      return bridgeFailure(
        503,
        "SIMULATION_UNAVAILABLE",
        `The cluster would not simulate this setup, so what it would do is unknown: ${cause instanceof Error ? cause.message : String(cause)}`,
        rate,
      );
    }
    if (!simulation.succeeded) {
      return bridgeFailure(
        409,
        "SIMULATION_FAILED",
        `This setup does not succeed in simulation, so nothing was offered to sign: ${simulation.error}`,
        rate,
      );
    }

    return Response.json(
      {
        data: {
          table,
          authority,
          recentSlot: slot.toString(),
          addresses,
          unsignedWireBase64,
          wireBytes: Buffer.from(unsignedWireBase64, "base64").length,
          simulation,
          /* What to put in the environment once this is signed and landed —
             the variable for this source domain, not Base's by habit. */
          environmentVariable: CCTP_LOOKUP_TABLE_ENV_BY_DOMAIN[sourceDomain],
        },
      },
      { headers: bridgeHeaders(rate) },
    );
  }

  let signature: string;
  try {
    signature = await sendTransactionOnce({
      handle,
      signedWireBase64: parsed.data.signedTransactionBase64,
      deadlineAt: Date.now() + 45_000,
    });
  } catch (cause) {
    if (cause instanceof SolanaSubmitRpcError) {
      return bridgeFailure(409, "SETUP_REJECTED", `The cluster rejected this setup: ${cause.message}`, rate);
    }
    return bridgeFailure(
      502,
      "SETUP_UNKNOWN",
      "The setup was handed to the network and the answer was lost. Read the table before sending it again.",
      rate,
    );
  }

  return Response.json({ data: { signature } }, { headers: bridgeHeaders(rate) });
}
