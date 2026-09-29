import { PayLinkCreateRequestSchema, type PayLinkListResponse, type PayLinkResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { rateLimitHeaders } from "@/lib/http-control";
import { publicOriginOf } from "@/lib/pay/link";
import { payLinkDeps } from "@/lib/pay/links.deps.server";
import { createPayLink, listPayLinks } from "@/lib/pay/links.server";
import { DEFAULT_PAYMENT_EXPIRATION } from "@/lib/pay/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/api/v1/pay/requests` — the proven wallet's payment links (contract
 * 1.22.0): `POST` makes one, `GET` lists them. The same engine as the web's
 * `/api/pay/requests` («Отримати»), behind the phone's bearer or the web's
 * proof cookie; the recipient of a new link is the proven wallet, never a
 * field of the body, so a link can only ever ask money for the wallet that
 * proved itself.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  try {
    const links = await listPayLinks(getGuardRuntime().store, { wallet: proof.address, origin: publicOriginOf(request) });
    return apiJson({ address: proof.address, links: [...links] } satisfies PayLinkListResponse);
  } catch {
    return apiFailure("UNAVAILABLE", "The payment links could not be read. Try again.");
  }
}

export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, PayLinkCreateRequestSchema, 2_048);
  if (!read.ok) return read.response;
  const created = await createPayLink(payLinkDeps(getGuardRuntime().store), {
    wallet: proof.address,
    sessionId: proof.sessionId,
    input: {
      mint: read.body.mint ?? null,
      amount: read.body.amount ?? null,
      description: read.body.description ?? null,
      expiration: read.body.expiration ?? DEFAULT_PAYMENT_EXPIRATION,
    },
    origin: publicOriginOf(request),
  }).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "The payment link could not be recorded. Try again." }));
  if (!created.ok) return apiFailure(created.code, created.message);
  return apiJson({ link: created.link } satisfies PayLinkResponse, 201);
}
