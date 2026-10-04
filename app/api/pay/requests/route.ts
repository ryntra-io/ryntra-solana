import { NextRequest, NextResponse } from "next/server";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import {
  assemblePaymentRequest,
  CreatePaymentRequestInputSchema,
  derivePaymentStatus,
  newPublicId,
  newReferenceKey,
  projectPublicPaymentRequest,
  type PaymentRequestOwner,
} from "@/lib/pay/model";
import { createPaymentRequest, listPaymentRequestsByWallet, readPaymentRequest, readPaymentSettlement } from "@/lib/pay/store";
import { mutationOriginAllowed } from "@/lib/security";
import { getWalletProof } from "@/lib/session";
import { fetchTokenCatalog } from "@/lib/solana/catalog";
import { readMintAccount } from "@/lib/solana/mint";
import { buildSolanaPayUrl } from "@/lib/solana/payment-request";
import { createSolanaRpcHandle } from "@/lib/solana/rpc";
import { NATIVE_SOL_DECIMALS } from "@/lib/solana/send-kinds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `/api/pay/requests` — a proven wallet creates and lists its own requests.
 *
 * Both verbs sit behind proof of ownership of the connected wallet (payment
 * requests are private wallet-scoped data). The recipient of a new request is
 * the proven address — never a body field — so a request can only ever ask
 * money for the wallet that signed in. The public page reads none of this; it
 * has its own route.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

function publicOrigin(req: NextRequest): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  const address = new URL(req.url).searchParams.get("address") ?? "";
  const proof = await getWalletProof();
  if (!proof || proof.chain !== "solana" || proof.address !== address) return json({ error: "proof required", proof: false }, 401);

  const store = getGuardRuntime().store;
  const owners = await listPaymentRequestsByWallet(store, { network: "mainnet", wallet: address });
  const now = new Date();
  const origin = publicOrigin(req);
  const rows = [];
  for (const owner of owners.slice(0, 50)) {
    const record = await readPaymentRequest(store, owner.id);
    if (!record) continue;
    const settlement = await readPaymentSettlement(store, record.id);
    const projected = projectPublicPaymentRequest({ request: record, settlement, now });
    rows.push({ ...projected, url: `${origin}/pay/${record.id}` });
  }
  return json({ ok: true, address, rows });
}

export async function POST(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  const proof = await getWalletProof();
  if (!proof || proof.chain !== "solana") return json({ error: "proof required", proof: false }, 401);

  const body = await readAgentControlJson(req);
  if (!body.ok) return json({ error: "body not accepted" }, body.status);
  const parsed = CreatePaymentRequestInputSchema.safeParse(body.value);
  if (!parsed.success) return json({ error: "validation", message: parsed.error.issues[0]?.message ?? "Not accepted." }, 400);
  const input = parsed.data;

  let decimals = NATIVE_SOL_DECIMALS;
  let symbol = "SOL";
  if (input.mint !== null) {
    const handle = createSolanaRpcHandle({ network: "mainnet", timeoutMs: 6_000, retries: 1 });
    const read = await readMintAccount(handle, input.mint);
    if (!read.ok) return json({ error: "mint", message: read.reason }, 422);
    decimals = read.decoded.decimals;
    const catalog = await fetchTokenCatalog([input.mint], 2_500).catch(() => null);
    const entry = catalog?.ok ? catalog.byMint[input.mint] : null;
    symbol = entry?.symbol?.trim() || `${input.mint.slice(0, 4)}…${input.mint.slice(-4)}`;
  }

  const store = getGuardRuntime().store;
  const now = new Date();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = newPublicId();
    const reference = await newReferenceKey();
    const assembled = assemblePaymentRequest({ id, reference, recipient: proof.address, input, decimals, symbol, now });
    if (!assembled.ok) return json({ error: assembled.code, message: assembled.reason }, 400);
    const owner: PaymentRequestOwner = {
      schema: "ryntra.pay.owner",
      schemaVersion: "1.0.0",
      id,
      network: "mainnet",
      wallet: proof.address,
      accountId: null,
      proofSessionId: proof.sessionId,
      createdAt: assembled.request.createdAt,
    };
    const created = await createPaymentRequest(store, { request: assembled.request, owner });
    if (created.ok) {
      const projected = projectPublicPaymentRequest({ request: assembled.request, settlement: null, now });
      const pay = buildSolanaPayUrl({
        recipient: assembled.request.recipient,
        amount: assembled.request.amountDisplay,
        splToken: assembled.request.mint,
        decimals: assembled.request.decimals,
        reference: assembled.request.reference,
        message: assembled.request.description,
      });
      return json({
        ok: true,
        id,
        url: `${publicOrigin(req)}/pay/${id}`,
        payUrl: pay.ok ? pay.url : null,
        request: projected,
        status: derivePaymentStatus({ request: assembled.request, settlement: null, now }).status,
      });
    }
    if (created.reason === "STORE_FAILED") return json({ error: "unavailable" }, 503);
    /* ID_TAKEN / REFERENCE_TAKEN: draw again. */
  }
  return json({ error: "unavailable" }, 503);
}
