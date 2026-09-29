import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { bearerToken } from "@/lib/auth/native-session";
import { getWalletProofFrom } from "@/lib/session";
import { SPOT_WATCHLIST_LIMIT, readSpotWatchlist, writeSpotWatchlist } from "@/lib/spot/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Spot watchlist of one proven wallet.
 *
 * Both verbs need proof for exactly the address in question — the `rw` proof
 * cookie in a browser, or the native bearer session (`RYN-API-CONTRACT-001`)
 * — the same gate as the receipt archive. A connected wallet proves nothing
 * and anyone can type an address, so without the proof the browser keeps its
 * own copy and the page offers proof of ownership as the way to sync it. A
 * bearer is not ambient, so a request that carries one skips the origin check
 * a cookie needs; the merge a phone does after sign-in is `/api/v1/watchlist/merge`.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const PutSchema = z
  .object({
    address: z.string().regex(BASE58),
    mints: z.array(z.string().regex(BASE58)).max(SPOT_WATCHLIST_LIMIT),
  })
  .strict();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

export async function GET(req: NextRequest) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!BASE58.test(address)) return json({ error: "bad request" }, 400);
  const proof = await getWalletProofFrom(req.headers);
  if (!proof || proof.chain !== "solana" || proof.address !== address) return json({ error: "proof required", proof: false }, 401);
  const mints = await readSpotWatchlist(getGuardRuntime().store, address);
  return json({ ok: true, address, mints });
}

export async function PUT(req: NextRequest) {
  if (!bearerToken(req.headers) && !mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  let parsed: z.infer<typeof PutSchema>;
  try {
    const raw = await req.text();
    if (raw.length > 32_000) return json({ error: "payload too large" }, 413);
    const result = PutSchema.safeParse(JSON.parse(raw));
    if (!result.success) return json({ error: "bad request" }, 400);
    parsed = result.data;
  } catch {
    return json({ error: "bad request" }, 400);
  }
  const proof = await getWalletProofFrom(req.headers);
  if (!proof || proof.chain !== "solana" || proof.address !== parsed.address) return json({ error: "proof required", proof: false }, 401);
  const wrote = await writeSpotWatchlist(getGuardRuntime().store, parsed.address, parsed.mints, new Date().toISOString());
  if (!wrote.ok) return json({ error: wrote.reason === "WATCHLIST_INVALID" ? "bad request" : "unavailable" }, wrote.reason === "WATCHLIST_INVALID" ? 400 : 503);
  return json({ ok: true, address: parsed.address, mints: wrote.mints });
}
