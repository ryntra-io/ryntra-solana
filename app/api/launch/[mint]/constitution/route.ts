import { NextResponse } from "next/server";

import { BASE58 } from "@/lib/api/v1/contract";
import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { rateLimitHeaders } from "@/lib/http-control";
import { readMarketConstitution } from "@/lib/launch/constitution.server";
import { launchViewDeps, ryntraOwnWallets } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store", "access-control-allow-origin": "*" } as const;

/**
 * `GET /api/launch/{mint}/constitution` — the Market Constitution v1 of a Ryntra launch (MOS-1): the document with its
 * SHA-256, `{ state: "READ", schema, sha256, document, observedAt }`; `UNREAD` when the chain could not be read now,
 * `REFUSED` when the token's facts are not a Ryntra launch. `?format=canonical` serves the exact bytes the hash is of, so
 * anyone can check it: `curl …?format=canonical | sha256sum`. Public, open to any origin, read-only.
 */
export async function GET(request: Request, context: { params: Promise<{ mint: string }> }) {
  const view = launchViewDeps();
  const deps = view ? { ...view, ownWallets: () => ryntraOwnWallets(view.network, view.store) } : null;
  if (!deps) return NextResponse.json({ error: "Launch is not served here." }, { status: 404, headers: NO_STORE });
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { ...NO_STORE, ...rateLimitHeaders(rate) } });
  const { mint } = await context.params;
  if (!BASE58.test(mint)) return NextResponse.json({ error: "mint: not an address" }, { status: 400, headers: NO_STORE });
  const read = await readMarketConstitution(deps, mint).catch(() => undefined);
  if (read === null) return NextResponse.json({ error: "No Ryntra launch of this token here." }, { status: 404, headers: NO_STORE });
  if (!read) return NextResponse.json({ state: "UNREAD", reason: "CHAIN_UNREAD" }, { status: 503, headers: NO_STORE });
  if (read.state !== "READ") return NextResponse.json(read, { status: read.state === "REFUSED" ? 422 : 503, headers: NO_STORE });
  const headers = { ...NO_STORE, "x-ryntra-constitution-sha256": read.sha256 };
  if (new URL(request.url).searchParams.get("format") === "canonical") {
    return new NextResponse(read.canonical, { status: 200, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
  }
  return NextResponse.json({ state: read.state, schema: read.schema, sha256: read.sha256, document: read.document, observedAt: read.observedAt }, { headers });
}
