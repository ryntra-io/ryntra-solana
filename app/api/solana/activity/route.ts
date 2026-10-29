import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { recordWalletSeen } from "@/lib/admin/wallet-presence";
import { getGuardRuntime } from "@/lib/guard/runtime";
import {
  bridgeOutcome,
  listSolanaWalletActions,
  sendOutcome,
  swapOutcome,
  type SolanaWalletAction,
} from "@/lib/solana/action-ledger";
import { fetchTokenCatalog } from "@/lib/solana/catalog";
import { readCctpBurnClaim } from "@/lib/solana/cctp-burn-claim";
import { fetchCctpAttestation } from "@/lib/solana/cctp-attestation";
import { projectBridgeDetails, projectReverseBridgeArrival } from "@/lib/solana/activity-bridge";
import { enrichActivityMetadata, projectLaneOutcome } from "@/lib/solana/activity-projection";
import { observeTransfer } from "@/lib/solana/observe";
import { readCrossSwapOrder } from "@/lib/mayan/cross-swap-order";
import { fetchMayanSwapStatus } from "@/lib/mayan/explorer-api";
import { fetchRelayIntentStatus } from "@/lib/relay/status-api";
import { crossSwapOutcome } from "@/lib/solana/action-ledger";
import { historyDestinationFor } from "@/lib/swap/cross-swap-service";
import { parseHumanAmount } from "@/lib/swap/catalog";
import { readSendAttempt } from "@/lib/solana/send-attempt";
import { readSwapOwnerRecovery } from "@/lib/solana/swap-owner-lock";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { SOLANA_NETWORKS, createSolanaRpcHandle } from "@/lib/solana/rpc";
import { listRewardEntries } from "@/lib/rewards/ledger";
import { rewardsView } from "@/lib/rewards/view";
import { unconfiguredReserve } from "@/lib/rewards/balance";
import { cashbackByTrade } from "@/lib/solana/trade-cashback";
import { readWalletProofFrom } from "@/lib/session";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";
import { byDeadline } from "@/lib/launch/flow.server";
import { settleLaunchTrade } from "@/lib/launch/record.server";
import { launchMarketDeps } from "@/lib/launch/runtime.server";
import { isLaunchOrigin } from "@/lib/solana/action-origin";

/** How long one page load waits for a launch trade in flight to be read from the chain. */
const LAUNCH_SETTLE_MS = 6_000;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What this wallet did here.
 *
 * ## Public by address, for the same reason Holdings is
 *
 * Ryntra splits public from private on proof of ownership, and it draws the
 * line where the chain already draws it: anybody can put an address into an
 * explorer, so gating a read of public chain facts behind a signature is
 * theatre rather than security. `/api/solana/holdings` is the precedent this
 * route matches deliberately — same request shape, same read-path limiter, no
 * session.
 *
 * Everything this returns is visible under that same address on chain: a
 * signature, an amount, a moment, whether it finished. What it does not return
 * is anything a person authored — no note, no label, no counterparty name.
 * Those are private wallet-scoped data in that same sense and they wait on a
 * Solana sign-in this repository does not have; `/api/auth/wallet` is EVM SIWE
 * and refuses wallet-only accounts on purpose.
 *
 * ## The index says what happened; the lane says where it is now
 *
 * A history row is written once by the lane that made it and would then start
 * ageing: a bridge burned yesterday says `IN_FLIGHT` forever if nothing comes
 * back to correct it, and the one moment that matters most — Circle attesting,
 * so the money is claimable by a signature only this person can give — happens
 * in a route that never learns the owner.
 *
 * So state is not trusted from the index. For the two lanes whose own durable
 * record is addressable from the row, the record is read and the outcome
 * recomputed: `solanaCctpBurns` by the burn intent, `solanaSendAttempts` by the
 * signature. The row supplies identity and the amounts; the lane supplies the
 * truth about where it is. A lane record that has gone is not an error — the
 * row keeps the outcome it was written with rather than inventing a newer one.
 *
 * The reads are bounded: at most `ENRICHMENT_LIMIT` of the newest rows, because
 * this is a page load and a wallet with three hundred transfers must not turn
 * one request into three hundred store reads. Older rows keep their written
 * outcome, which is correct for them — a row that old is settled.
 */
const RequestSchema = z
  .object({ owner: z.string().min(32).max(44), network: z.enum(SOLANA_NETWORKS).default("mainnet") })
  .strict();

/** How many of the newest rows are re-read from their lane on one page load. */
const ENRICHMENT_LIMIT = 25;

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

async function currentOutcome(
  store: ReturnType<typeof getGuardRuntime>["store"],
  action: SolanaWalletAction,
): Promise<SolanaWalletAction> {
  try {
    if (action.lane === "BRIDGE" && action.network === "mainnet") {
      const claim = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: action.actionId });
      if (!claim.ok) return action;
      const projected = projectLaneOutcome(action, {
        outcome: bridgeOutcome(claim.record.state),
        updatedAt: claim.record.updatedAt,
      });
      const missingAmount = projected.out === null && projected.in === null;
      const lookup = missingAmount && claim.record.burnSignature && claim.record.messageNonce
        ? await fetchCctpAttestation({ direction: claim.record.direction, transactionHash: claim.record.burnSignature }, { timeoutMs: 2_500 })
        : null;
      const detailed = projectBridgeDetails(projected, claim.record, lookup);
      const reverseSignature = claim.record.direction === "BASE_TO_SOLANA" ? claim.record.mintTransactionHash : null;
      if (
        detailed.in !== null ||
        detailed.out !== null ||
        detailed.outcome !== "DONE" ||
        claim.record.state !== "RECEIPTED" ||
        !reverseSignature
      ) return detailed;
      const observed = await observeTransfer(
        createSolanaRpcHandle({ network: "mainnet", timeoutMs: 2_500, retries: 0 }),
        reverseSignature,
      );
      return projectReverseBridgeArrival(detailed, claim.record, observed.ok ? observed : null);
    }
    if (action.lane === "CROSS_SWAP") {
      /* The one lane that had no branch here, so its rows were whatever the
         last write left and never healed. A person's first Robinhood Chain
         swap arrived and read "Swapped across chains 0.05 SOL": no asset
         received, no destination. Both live on the order record, and the
         amount can be asked of the provider when the record has not got it —
         the same shape the bridge above already uses. */
      const read = await readCrossSwapOrder({ store, intentDigest: action.actionId });
      if (!read.ok) return action;
      const order = read.record;
      const projected = projectLaneOutcome(action, {
        outcome: crossSwapOutcome(order.state),
        updatedAt: order.updatedAt,
      });
      let receivedAmount = order.receivedAmount;
      if (receivedAmount === null && order.state === "COMPLETED") {
        /* Relay is asked by the request id its quote carried; Mayan by the
           source signature. The record says which provider carried the order,
           and asking the other one would report a live swap as unknown. */
        const relayRequestId = order.provider === "RELAY" ? order.quoteId : null;
        const lookup = relayRequestId
          ? await fetchRelayIntentStatus(relayRequestId, { timeoutMs: 2_500, apiKey: resolveRelayApiKey() })
          : order.sourceTxHash
            ? await fetchMayanSwapStatus(order.sourceTxHash, { timeoutMs: 2_500 })
            : null;
        if (lookup?.found && lookup.toAmount) receivedAmount = lookup.toAmount;
      }
      const received = receivedAmount ? parseHumanAmount(receivedAmount, order.toDecimals) : null;
      return {
        ...projected,
        destination: historyDestinationFor(order.destinationChain),
        out: projected.out ?? { mint: null, amountRaw: order.amountInRaw, decimals: order.fromDecimals, symbol: order.fromSymbol },
        in: received ? { mint: null, amountRaw: received, decimals: order.toDecimals, symbol: order.toSymbol } : projected.in,
      };
    }
    if (action.lane === "SEND" && action.signature !== null) {
      const attempt = await readSendAttempt({ store, network: action.network, signature: action.signature });
      if (!attempt.ok) return action;
      return projectLaneOutcome(action, {
        outcome: sendOutcome(attempt.record.state),
        updatedAt: attempt.record.updatedAt,
      });
    }
    if (action.lane === "SWAP" && action.signature !== null && isLaunchOrigin(action.origin)) {
      /* A launch's trade has no swap lock: one still in flight is settled from the chain here, inside a short budget —
         the same settlement its submit and the reconciliation run, so the row is written once whoever gets there. */
      if (action.outcome !== "IN_FLIGHT") return action;
      const deps = launchMarketDeps();
      if (!deps || deps.network.cluster !== action.network) return action;
      /* A settlement that wrote the row answers it — done or failed; one still without an answer leaves the row as it is. */
      const settled = await byDeadline(() => settleLaunchTrade(deps, action.signature!), Date.now() + LAUNCH_SETTLE_MS, () => new Date(), null);
      return settled?.row ?? action;
    }
    if (action.lane === "SWAP" && action.signature !== null) {
      /* The row carries both halves of this lane's key, so the lock is
         addressable from it: the live owner slot when this is still the open
         swap, and the signature archive when a later Review has replaced it.
         Without this branch a swap settled by the recovery route — the exact
         case a person opens this page for — would read "on its way" forever,
         because the row was last written by a request that never came back. */
      const lock = await readSwapOwnerRecovery({ store, owner: action.wallet, signature: action.signature });
      if (!lock.ok) return action;
      return projectLaneOutcome(action, {
        outcome: swapOutcome(lock.record.state),
        updatedAt: lock.record.updatedAt,
      });
    }
  } catch {
    /* A lane whose record cannot be read leaves the row as written. An
       unreadable state is not a new state, and guessing one here is exactly
       the failure this product refuses everywhere else. */
  }
  return action;
}

export async function POST(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) {
    return Response.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests." } },
      { status: 429, headers: responseHeaders(rate) },
    );
  }
  const body = await readAgentControlJson(request);
  if (!body.ok) {
    return Response.json(
      { error: { code: body.code, message: "The request body was not accepted." } },
      { status: body.status, headers: responseHeaders(rate) },
    );
  }
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "That is not an address this route will read." } },
      { status: 400, headers: responseHeaders(rate) },
    );
  }

  const store = getGuardRuntime().store;
  /* Presence rides beside the history read rather than after it. This is the
     request a connected wallet always makes, so it is where "a wallet opened
     the cabinet" is measured for the admin — bounded by its own deadline and
     never a reason for the history to be late or missing. */
  const [listed] = await Promise.all([
    listSolanaWalletActions(store, {
      network: parsed.data.network,
      wallet: parsed.data.owner,
    }),
    parsed.data.network === "mainnet"
      ? recordWalletSeen(store, { wallet: parsed.data.owner, now: new Date().toISOString() })
      : Promise.resolve("unchanged" as const),
  ]);

  const head = await Promise.all(listed.actions.slice(0, ENRICHMENT_LIMIT).map((action) => currentOutcome(store, action)));
  const current = [...head, ...listed.actions.slice(ENRICHMENT_LIMIT)];

  /* Names, so a row can say "USDC" instead of a mint address.
     The swap lane works in raw base units end to end and stores no symbol,
     which is why this is resolved on the way out rather than on the way in: a
     name is a fact about the token that can change and be looked up again, not
     a fact about what happened. A catalogue that does not answer leaves the
     symbol null and the row says less rather than guessing. */
  const mints = current.flatMap((action) =>
    [action.out?.mint ?? null, action.in?.mint ?? null].filter((mint): mint is string => mint !== null),
  );
  const catalog = await fetchTokenCatalog(mints, 2_500);
  const named = catalog.ok ? catalog.byMint : {};
  const withSymbol = (leg: (typeof current)[number]["out"]) =>
    leg === null ? null : { ...leg, symbol: leg.symbol ?? (leg.mint ? (named[leg.mint]?.symbol ?? null) : null) };
  const actions = current.map((action) =>
    enrichActivityMetadata(
      { ...action, out: withSymbol(action.out), in: withSymbol(action.in) },
      [],
    ),
  );

  /*
   * Rewards, and only for somebody who has proved the address is theirs.
   *
   * Everything above this line is public by address because it is already
   * public on chain — that is the whole argument for this route having no
   * session. A reward is the opposite: it exists nowhere on chain, it is a
   * balance owed by Ryntra, and how much somebody has earned is not a fact a
   * stranger with their address gets to read. So the rows are appended only
   * behind the same proof the Rewards page itself requires, and a request
   * without proof gets exactly what it got before this change.
   *
   * The reserve is not read here. These rows say what was earned and what was
   * paid — both settled facts — and `Available` is a Rewards question that
   * belongs on the Rewards page beside the control it governs.
   *
   * The proof is the `rw` cookie in a browser or the native bearer session
   * (contract 1.1.0) — the same wallet, whichever client asks.
   */
  /* Rewards are an extra on this read: a store that blinked leaves them out
     rather than failing the history. */
  const proofRead = await readWalletProofFrom(request.headers, { allowLink: true });
  const proof = proofRead.status === "ok" ? proofRead.proof : null;
  const proven = proof !== null && proof.chain === "solana" && proof.address === parsed.data.owner;
  const entries = proven ? await listRewardEntries(store, parsed.data.owner) : null;
  const rewards =
    entries
      ? rewardsView({
          entries,
          reserve: unconfiguredReserve("Activity states settled rewards, not what is claimable."),
          heldUsdMicros: 0n,
          /* Activity lists rewards; the referral network belongs on Rewards. */
          referrals: { level1: 0, level2: 0 },
          referral: null,
          claim: null,
          locale: "en",
          limit: 25,
        }).rows
      : null;

  return Response.json(
    {
      data: {
        actions,
        /* Null for an unproven read, which is different from an empty list:
           one means "not yours to see", the other means "nothing yet". */
        rewards,
        /* The cashback each trade earned, by its signature (SOL-X1): a receipt's execution truth states the actual
           figure beside its own facts. The same proof as `rewards`, and null on the same terms. */
        cashback: entries ? cashbackByTrade(entries, parsed.data.owner) : null,
        /* Honest coverage. `complete` false means a row existed and could not
           be read — the surface says the list may be incomplete rather than
           presenting a short list as the whole truth. */
        complete: listed.complete,
        /* This history begins where the ledger does. A transfer made before it
           existed is on the chain and not in here, and the surface has to be
           able to say so instead of implying the wallet did nothing. */
        coverage: "RYNTRA_ACTIONS",
      },
    },
    { headers: responseHeaders(rate) },
  );
}
