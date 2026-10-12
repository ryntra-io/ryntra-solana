import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { readSwapCarrier } from "@/lib/solana/swap-carrier.server";
import { readSignatureStatus } from "@/lib/solana/recover";
import { createIndependentReadHandle, createSolanaRpcHandle } from "@/lib/solana/rpc";
import { readSendAttempt } from "@/lib/solana/send-attempt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Read one Send signature that is already across the submit boundary.
 *
 * Send was the only lane without this. Swap has `../../swap/recover`, Bridge
 * has `../../bridge/recover`, and `app/api/solana/transfer` had `plan`, `adopt`
 * and `settle` — so `recoverSend()` existed but was reachable only from inside
 * a settle request. A person whose transfer went quiet, or whose tab reloaded
 * between the wallet approving and the answer arriving, had a signature in hand
 * and no route in this product that would tell them what happened to their
 * money.
 *
 * **This route cannot move anything.** It accepts no transaction bytes, imports
 * no submit adapter and holds no signing key. It reads the durable attempt
 * ledger, asks two independent operators what the network did with a signature,
 * and says so. That is why it needs no owner session: presenting a signature
 * this deployment already recorded is the authorization, and a person whose
 * money is in an unknown state must not need an admin login to find out.
 *
 * It also never releases the attempt. An entry past the submit boundary stays
 * reserved forever by design — the one-directional rule in `send-attempt.ts` —
 * and reading it is how it resolves, never sending again.
 */

const RequestSchema = z
  .object({
    network: z.enum(["mainnet", "devnet"]),
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
  })
  .strict();

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: responseHeaders(rate) });
}

export async function POST(request: Request) {
  /*
   * Recovery is a read, and it must not spend the budget that acting needs.
   *
   * The action window is 12 requests a minute and the read window is 60. The
   * card polls this route every three seconds while an outcome is open — twenty
   * a minute — so on the action budget it would answer 429 after about thirty
   * seconds, and the same exhaustion would then refuse the `plan` and `settle`
   * calls the person needs to do anything at all. The failure would land on
   * exactly the person whose money is already in an unknown state.
   *
   * This route builds nothing, signs nothing and submits nothing, which is the
   * whole reason it is allowed to be cheap.
   */
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  /* The site's origin for a browser, the native bearer for the phone (1.22.0,
     the rule the swap routes follow); a
     bearer that fails is refused by its own code and never falls through
     (`lib/solana/swap-carrier.ts`). The attempt ledger is keyed by the
     signature and names no wallet, so the bearer binds nothing more here
     than the site does: presenting a signature is what this read asks for. */
  const carrier = await readSwapCarrier(request, "The recovery request must come from this site.");
  if (!carrier.ok) return failure(carrier.status, carrier.code, carrier.message, rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return failure(400, "VALIDATION_ERROR", "The recovery request did not match its schema.", rate);
  }
  const { network, signature } = parsed.data;

  const store = getGuardRuntime().store;
  if (store.durability !== "DURABLE_MULTI_WRITER") {
    return failure(
      503,
      "STORE_NOT_DURABLE",
      "Recovery requires the durable attempt ledger that records a submit crossing.",
      rate,
    );
  }

  const attempt = await readSendAttempt({ store, network, signature });
  /*
   * A signature this deployment never recorded.
   *
   * It is not an error and must not read like one. `../settle` refuses before
   * it claims a signature — an expired window, a policy refusal, a request that
   * never arrived — while the browser has already written the attempt down,
   * which is exactly the ordering that makes the record worth keeping. The
   * chain is still the authority on whether those bytes exist, so the read
   * continues and the absence is reported as a fact rather than as a failure.
   */
  const recorded = attempt.ok ? attempt.record : null;
  if (!attempt.ok && attempt.code === "SEND_ATTEMPT_UNAVAILABLE") {
    return failure(503, "SEND_ATTEMPT_UNAVAILABLE", attempt.reason, rate);
  }

  const primary = createSolanaRpcHandle({ network });
  const independent = createIndependentReadHandle(primary);

  const primaryRead = await readSignatureStatus(primary, signature);
  /* A second operator, when the deployment has one. The receipt's independence
     claim rests on this, and recovery states plainly when it is missing rather
     than presenting one operator's answer as two. */
  const independentRead = independent ? await readSignatureStatus(independent, signature) : null;

  return Response.json(
    {
      data: {
        network,
        signature,
        attempt: recorded
          ? {
              state: recorded.state,
              reservedAt: recorded.reservedAt,
              updatedAt: recorded.updatedAt,
              receiptHash: recorded.receiptHash,
            }
          : null,
        primary: primaryRead,
        independent: independentRead,
      },
    },
    { headers: responseHeaders(rate) },
  );
}
