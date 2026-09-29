import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { readBaseErc20Allowance } from "@/lib/base/cctp-burn";
import { evmCctpAddresses, readBaseUsdcBalance } from "@/lib/base/cctp-observe";
import { baseRpcCall, createEvmRpcHandle, hexQuantityToDecimal } from "@/lib/base/rpc";
import { bridgeFailure, bridgeHeaders, describeBridgeIssues } from "@/lib/solana/bridge-http";
import { cctpProtocolFeeRaw } from "@/lib/solana/cctp-plan";
import {
  CCTP_DIRECTIONS,
  cctpLaneFacts,
  EVM_ADDRESS_PATTERN,
  SOLANA_ADDRESS_PATTERN,
  type CctpChain,
} from "@/lib/solana/cctp-direction";
import { fetchCctpProviderSnapshot } from "@/lib/solana/cctp-provider";
import { SOLANA_CCTP_MAINNET_REGISTRY } from "@/lib/solana/cctp-registry";
import { SOLANA_TOKEN_PROGRAM } from "@/lib/solana/cctp-receive";
import { createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { associatedTokenAccount } from "@/lib/solana/token-account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * What you hold on the sending side, and what the provider will currently take.
 *
 * A read, and only a read. It exists because the card has to tell the truth
 * about a transfer *before* anyone asks for one to be built: a balance to press
 * MAX against, the permission that decides how many wallet prompts this will
 * take, and the limits Circle is actually applying right now rather than a pair
 * of numbers compiled into the page.
 *
 * ## The limits are derived, not written down
 *
 * Circle publishes no minimum transfer for CCTP. What exists is arithmetic: an
 * amount at or below the fee arrives as nothing, so the smallest sendable
 * amount is the smallest one that leaves something behind. And what exists at
 * the top is the sender's own balance, plus — for Fast only — the allowance
 * Circle will still sign early against. Both are read here on every request, so
 * a limit that moves moves on the card.
 */

const RequestSchema = z
  .object({
    direction: z.enum(CCTP_DIRECTIONS),
    solanaWallet: z.string().regex(SOLANA_ADDRESS_PATTERN).nullable().default(null),
    baseWallet: z.string().regex(EVM_ADDRESS_PATTERN).nullable().default(null),
  })
  .strict();

export async function POST(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return bridgeFailure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return bridgeFailure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return bridgeFailure(400, "VALIDATION_ERROR", describeBridgeIssues(parsed.error), rate);
  const { direction, solanaWallet, baseWallet } = parsed.data;
  const lane = cctpLaneFacts(direction);

  const provider = await fetchCctpProviderSnapshot({ direction });
  const standard =
    provider.fees.state === "AVAILABLE" ? provider.fees.tiers.find((tier) => tier.mode === "STANDARD") ?? null : null;

  let source: Readonly<{
    chain: CctpChain;
    wallet: string | null;
    usdcRaw: string | null;
    nativeRaw: string | null;
    /** The standing permission Circle holds, on a lane that needs one. */
    allowanceRaw: string | null;
    observedBy: string | null;
    reason: string | null;
  }>;

  if (lane.source.chain !== "solana") {
    /* `baseWallet` is the EVM wallet, whichever EVM chain this lane leaves
       from; the field keeps the name every existing caller sends. */
    if (!baseWallet) {
      source = {
        chain: lane.source.chain,
        wallet: null,
        usdcRaw: null,
        nativeRaw: null,
        allowanceRaw: null,
        observedBy: null,
        reason: `No ${lane.source.label} wallet is connected, so there is nothing to read yet.`,
      };
    } else {
      const handle = createEvmRpcHandle(lane.evmChain);
      const addresses = evmCctpAddresses(lane.evmChain);
      const [usdc, native, allowance] = await Promise.all([
        readBaseUsdcBalance(handle, baseWallet),
        baseRpcCall<string>(handle, "eth_getBalance", [baseWallet, "latest"]),
        readBaseErc20Allowance(handle, { token: addresses.usdc, owner: baseWallet, spender: addresses.tokenMessenger }),
      ]);
      source = {
        chain: lane.source.chain,
        wallet: baseWallet,
        usdcRaw: usdc.ok ? usdc.raw : null,
        nativeRaw: native.ok ? hexQuantityToDecimal(native.value) : null,
        allowanceRaw: allowance.ok ? allowance.raw : null,
        observedBy: usdc.ok ? usdc.observedBy : handle.endpoints[0].host,
        reason: usdc.ok ? null : usdc.reason,
      };
    }
  } else if (!solanaWallet) {
    source = {
      chain: "solana",
      wallet: null,
      usdcRaw: null,
      nativeRaw: null,
      allowanceRaw: null,
      observedBy: null,
      reason: "No Solana wallet is connected, so there is nothing to read yet.",
    };
  } else {
    const handle = createSolanaRpcHandle({ network: "mainnet" });
    let usdcRaw: string | null = null;
    let nativeRaw: string | null = null;
    let reason: string | null = null;
    try {
      const tokenAccount = await associatedTokenAccount({
        owner: solanaWallet,
        mint: SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address,
        tokenProgram: SOLANA_TOKEN_PROGRAM,
      });
      const [balance, lamports] = await Promise.all([
        withRpcDiscipline(handle, (abortSignal) =>
          handle.rpc.getTokenAccountBalance(tokenAccount as never, { commitment: "confirmed" }).send({ abortSignal }),
        ).catch(() => null),
        withRpcDiscipline(handle, (abortSignal) =>
          handle.rpc.getBalance(solanaWallet as never, { commitment: "confirmed" }).send({ abortSignal }),
        ).catch(() => null),
      ]);
      /* An account that does not exist yet is a zero balance rather than an
         unreadable one: the person holds no USDC on this chain, which is a fact
         and the right thing to show beside a MAX button. */
      usdcRaw = balance ? String(balance.value.amount) : "0";
      nativeRaw = lamports ? String(lamports.value) : null;
    } catch (cause) {
      reason = cause instanceof Error ? cause.message : String(cause);
    }
    source = {
      chain: "solana",
      wallet: solanaWallet,
      usdcRaw,
      nativeRaw,
      allowanceRaw: null,
      observedBy: (handle.answered() ?? handle.endpoints[0]).host,
      reason,
    };
  }

  /* The destination's readiness, when the destination is Solana and a wallet
     has been named. CCTP credits a token account and creates none, so whether
     one exists is part of what a person is entitled to know beforehand. */
  let destination: Readonly<{
    chain: CctpChain;
    wallet: string | null;
    tokenAccount: string | null;
    accountExists: boolean | null;
  }> = { chain: lane.destination.chain, wallet: null, tokenAccount: null, accountExists: null };
  if (lane.destination.chain === "solana" && solanaWallet) {
    try {
      const handle = createSolanaRpcHandle({ network: "mainnet" });
      const tokenAccount = await associatedTokenAccount({
        owner: solanaWallet,
        mint: SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address,
        tokenProgram: SOLANA_TOKEN_PROGRAM,
      });
      const read = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc.getAccountInfo(tokenAccount as never, { commitment: "confirmed", encoding: "base64" }).send({ abortSignal }),
      );
      destination = {
        chain: "solana",
        wallet: solanaWallet,
        tokenAccount,
        accountExists: read.value !== null && read.value !== undefined,
      };
    } catch {
      destination = { chain: "solana", wallet: solanaWallet, tokenAccount: null, accountExists: null };
    }
  } else if (lane.destination.chain !== "solana" && baseWallet) {
    destination = { chain: lane.destination.chain, wallet: baseWallet, tokenAccount: null, accountExists: true };
  }

  /* The smallest amount that still arrives as something. With a zero-basis-point
     Standard tier that is one base unit; with a non-zero one it is the first
     amount whose rounded-up fee is smaller than itself. */
  let minimumRaw: string | null = null;
  if (standard) {
    let candidate = 1n;
    for (let step = 0; step < 24 && BigInt(cctpProtocolFeeRaw(candidate.toString(), standard.minimumFeeBps)) >= candidate; step += 1) {
      candidate *= 10n;
    }
    minimumRaw = BigInt(cctpProtocolFeeRaw(candidate.toString(), standard.minimumFeeBps)) < candidate ? candidate.toString() : null;
  }

  return Response.json(
    {
      data: {
        direction,
        lane,
        source,
        destination,
        provider,
        limits: {
          minimumRaw,
          minimumReason: standard
            ? "The smallest amount that still leaves something after Circle's fee for this route."
            : "Circle's fee for this route could not be read, so no minimum can be stated.",
          /* The maximum is what the sender holds. Nothing else caps a Standard
             transfer, and saying otherwise would be inventing a limit. */
          maximumRaw: source.usdcRaw,
          maximumReason: "Your own balance on the sending chain.",
          fastAllowanceRaw:
            provider.allowance.state === "AVAILABLE" ? provider.allowance.allowance.allowanceRaw : null,
        },
      },
    },
    { headers: bridgeHeaders(rate) },
  );
}
