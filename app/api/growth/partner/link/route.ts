import { NextRequest, NextResponse } from "next/server";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { issueWalletNonce, walletNonceIssuedHere } from "@/lib/auth/wallet-nonce";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { normalizeWallet } from "@/lib/growth/partner";
import {
  buildWalletLinkFields,
  verifyWalletLink,
  walletLinkMessage,
  walletLinkNonceContext,
  WalletLinkRequestSchema,
} from "@/lib/growth/wallet-link";
import { linkWallets } from "@/lib/growth/wallet-link-store";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { readWalletProofFrom } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One partner's Solana and EVM wallets, linked by a signature from each.
 *
 * `GET ?solana=<address>&evm=<0x…>` — the exact message both wallets sign
 *   (built here, with a nonce minted for this pair and a ten-minute expiry).
 * `POST { message, solanaSignature, evmSignature }` — only for the Solana
 *   wallet proven in this browser: a pair of signatures some other page
 *   collected links nothing. Both signatures are checked against the message
 *   and the link is written; a newer link both wallets signed replaces an
 *   older one, and the history keeps every link.
 *
 * Signing moves nothing and authorizes no transaction; the message says so.
 * The message is EIP-4361, so an EVM wallet warns when the page asking is not
 * this site.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

/** The origin this request was actually served on. Never read from the body. */
function siteFor(req: NextRequest): { domain: string; uri: string } {
  const url = new URL(req.url);
  return { domain: url.host, uri: url.origin };
}

export async function GET(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  const solana = normalizeWallet("solana", req.nextUrl.searchParams.get("solana"));
  const evm = normalizeWallet("evm", req.nextUrl.searchParams.get("evm"));
  if (!solana || !evm) return json({ error: "bad request" }, 400);
  const nonce = issueWalletNonce(walletLinkNonceContext(solana, evm));
  if (!nonce) return json({ error: "unavailable" }, 503);
  /* Nothing about existing links: whether two addresses are one person is
     not a question this route answers to whoever asks. The signer learns it
     from the POST. */
  const message = walletLinkMessage(buildWalletLinkFields({ ...siteFor(req), solana, evm, nonce, now: Date.now() }));
  return json({ ok: true, message });
}

export async function POST(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return json({ error: "forbidden origin" }, 403);
  }
  const body = await readAgentControlJson(req);
  if (!body.ok) return json({ error: "bad request" }, body.status);
  const parsed = WalletLinkRequestSchema.safeParse(body.value);
  if (!parsed.success) return json({ error: "bad request" }, 400);

  const verified = await verifyWalletLink({
    message: parsed.data.message,
    solanaSignature: parsed.data.solanaSignature,
    evmSignature: parsed.data.evmSignature as `0x${string}`,
    expected: siteFor(req),
    nonceIssuedHere: (nonce, context) => walletNonceIssuedHere(nonce, context),
    now: Date.now(),
  });
  if (!verified.ok) return json({ ok: false, code: "NOT_VERIFIED", reason: verified.reason }, 400);
  const proof = await readWalletProofFrom(req.headers).catch(() => ({ status: "unavailable" }) as const);
  if (proof.status === "unavailable") return json({ error: "unavailable" }, 503);
  if (proof.status !== "ok" || proof.proof.chain !== "solana" || proof.proof.address !== verified.solana) return json({ ok: false, code: "PROOF_REQUIRED" }, 401);
  try {
    const outcome = await linkWallets(getGuardRuntime().store, { solana: verified.solana, evm: verified.evm, signedAt: verified.issuedAt, now: new Date().toISOString() });
    if (!outcome.ok) return json({ ok: false, code: outcome.code }, 409);
    return json({ ok: true, created: outcome.created, solana: outcome.link.solana, evm: outcome.link.evm });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
