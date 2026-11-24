import { NextResponse } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { FixedWindowLimiter } from "@/lib/http-control";
import { relayCall } from "@/lib/privacy/relay-handler.server";
import { servedNetwork } from "@/lib/privacy/relay-key.server";
import { RELAY_LIMIT } from "@/lib/privacy/relay-limit.server";
import { readWalletProofFrom } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `/api/v1/privacy/<network>/{rpc|spr|policy|session}/**` — Ryntra's relay to Helius for the private balance (Ryntra
 * Private).
 *
 * The browser's Privacy Rings SDK sends every HTTP call here; the relay adds the network's Helius key server-side and
 * forwards the bytes; `policy` hands over the prover's signed policy for the network, which the site's content policy
 * keeps the browser from fetching itself; `session` hands the page its short-lived relay session token — where the key is
 * a paid one, only to a wallet the browser proved to Ryntra with the wallet's own signature (`readWalletProofFrom`). Prover requests
 * are encrypted to the attested enclave, so the relay carries ciphertext it cannot read; no body is logged or kept. It
 * builds nothing and signs nothing: transactions arrive signed by the person's wallet.
 *
 * Open on one network only — the one `NEXT_PUBLIC_RYNTRA_PRIVATE` names (`devnet` or `mainnet`), with that network's key
 * on this server (`relay-key.server.ts`); every other path is 404. What passes is decided in `relay-handler.server.ts`:
 * where the key is a paid one, only the ring's own transactions and accounts, only with the page's session token, and
 * only as the call the relay checked — rebuilt, never the bytes as they came. The limit is shared by every instance
 * (`relay-limit.server.ts`) — there by the address's /64 and by the session's wallet, a proof by its own ceiling besides:
 * when its store does not answer, the call is refused (503), never let through.
 */

/* Per address, per warm instance: a cheap floor in front of the shared count, so one hot loop never reaches the store. */
const limiter = new FixedWindowLimiter({ ...RELAY_LIMIT, maxKeys: 10_000 });

type Params = { params: Promise<{ network: string; target: string; path?: string[] }> };

async function relay(request: Request, { params }: Params): Promise<Response> {
  const { network: asked, target, path = [] } = await params;
  const served = servedNetwork(asked);
  if (!served) return new NextResponse(null, { status: 404 });
  return relayCall(request, { network: served.network, key: served.key, target, path }, {
    fetch: (input, init) => fetch(input, init),
    store: () => getGuardRuntime().store,
    limiter,
    now: () => Date.now(),
    walletProof: (incoming) => readWalletProofFrom(incoming.headers),
  });
}

export const GET = relay;
export const POST = relay;
