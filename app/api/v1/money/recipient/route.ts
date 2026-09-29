import { RecipientCheckQuerySchema, type RecipientCheckResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal } from "@/lib/api/v1/http";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { rateLimitHeaders } from "@/lib/http-control";
import { publicOriginOf } from "@/lib/pay/link";
import { readPayLink } from "@/lib/pay/links.server";
import { readRequestIdByReference } from "@/lib/pay/store";
import { readMintAccount } from "@/lib/solana/mint";
import { checkRecipient } from "@/lib/solana/recipient-check.server";
import { createSolanaRpcHandle } from "@/lib/solana/rpc";
import { resolveNativeRecipient, resolveTokenRecipient } from "@/lib/solana/send-recipient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The hosts whose `/pay/<id>` is a Ryntra link, beside the one this request reached. */
const LINK_HOSTS = ["ryntra.io", "www.ryntra.io"] as const;

/**
 * `GET /api/v1/money/recipient?to=&mint=&from=` — the recipient check before
 * a transfer (contract 1.22.0): what was typed, pasted or scanned, whether it
 * is an address and why not, the sender's own, what the chain says of it for
 * the asset — the transfer builder's own classifier — and where to go next.
 * Public and wallet-free, like the transfer Review it precedes; on the Solana
 * read budget; it builds, signs and records nothing.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const parsed = RecipientCheckQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return apiFailure("VALIDATION_ERROR", `${issue?.path?.join(".") || "query"}: ${issue?.message ?? "did not match the contract"}`);
  }

  const store = getGuardRuntime().store;
  const origin = publicOriginOf(request);
  const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 6_000, retries: 1 });
  const check = await checkRecipient(
    {
      linkHosts: [...LINK_HOSTS, new URL(origin).host],
      readLink: (id) => readPayLink(store, { id, origin }),
      linkIdByReference: (reference) => readRequestIdByReference(store, reference),
      resolveNative: (address) => resolveNativeRecipient(handle, address),
      resolveToken: ({ address, mint, tokenProgram }) => resolveTokenRecipient({ handle, address, mint, tokenProgram }),
      tokenProgramOf: async (mint) => {
        const read = await readMintAccount(handle, mint);
        return read.ok ? { ok: true, tokenProgram: read.raw.owner } : { ok: false, unavailable: read.code === "RPC_FAILED" };
      },
    },
    parsed.data,
  ).catch(() => null);
  /* The store behind a link did not answer: nothing is called a pass that was not read. */
  if (!check) return apiFailure("UNAVAILABLE", "The recipient could not be checked. Try again.");
  return apiJson(check satisfies RecipientCheckResponse);
}
