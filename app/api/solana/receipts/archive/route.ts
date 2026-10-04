import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { walletReceiptsList, walletReceiptsPut } from "@/lib/account/rpc";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { bearerToken } from "@/lib/auth/native-session";
import { getWalletProofFrom } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The receipts archive for a proven wallet — history class B, server copy.
 *
 * The local vault stays the first copy; this is where a person puts receipts
 * so they survive a cleared browser or reach another device. Both directions
 * need the `rw` proof cookie for exactly the address in question: a connected
 * wallet proves nothing, and a proof for one address opens no other. Rows are
 * deduplicated by content hash and never overwritten — a signed receipt is
 * immutable, and a later import cannot change an earlier one.
 */

const PutSchema = z.object({
  address: z.string().min(32).max(44),
  rows: z.array(z.object({
    kind: z.enum(["send", "swap", "bridge", "receive", "other"]),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    payload: z.record(z.string(), z.unknown()),
    occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
  })).min(1).max(200),
});

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

export async function GET(req: NextRequest) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  /* The `rw` cookie in a browser, or the native bearer session for the same
     wallet (contract 1.1.0: receipts over the bearer). */
  const proof = await getWalletProofFrom(req.headers);
  if (!proof || proof.chain !== "solana" || proof.address !== address) return json({ error: "proof required", proof: false }, 401);
  const rows = await walletReceiptsList("solana", address, 200);
  if (rows === null) return json({ error: "unavailable" }, 503);
  return json({ ok: true, address, rows });
}

export async function PUT(req: NextRequest) {
  /* A bearer is not ambient, so a request that carries one skips the origin check a cookie needs. */
  if (!bearerToken(req.headers) && !mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  let parsed: z.infer<typeof PutSchema>;
  try {
    const raw = await req.text();
    if (raw.length > 512_000) return json({ error: "payload too large" }, 413);
    const result = PutSchema.safeParse(JSON.parse(raw));
    if (!result.success) return json({ error: "bad request" }, 400);
    parsed = result.data;
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const proof = await getWalletProofFrom(req.headers);
  if (!proof || proof.chain !== "solana" || proof.address !== parsed.address) return json({ error: "proof required", proof: false }, 401);
  const inserted = await walletReceiptsPut("solana", parsed.address, parsed.rows);
  if (inserted === null) return json({ error: "unavailable" }, 503);
  return json({ ok: true, inserted, offered: parsed.rows.length });
}
