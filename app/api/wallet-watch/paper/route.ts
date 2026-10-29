import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { bearerToken } from "@/lib/auth/native-session";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { readWalletProofFrom } from "@/lib/session";
import { readSpotMarketsByMint } from "@/lib/spot/markets.server";
import { changePaper, paperSummary, readPaper, startCopy, stopCopy, type PaperRecord } from "@/lib/wallet-watch/paper";
import { COPY_SIZES, COPY_SLIPPAGES } from "@/lib/wallet-watch/reality";
import { WRAPPED_SOL } from "@/lib/wallet-watch/trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Копіювання на папері» (SOL-R3): the wallets one proven wallet copies without money — start, stop, and each copy
 * at the price now. Every verb needs proof for exactly the address in question, as «Стеження за гаманцями». The fills
 * are the cron's (`runWalletWatchPass`); this route never fills, signs, sends or trades. Live copying is not here: it
 * waits for the legal opinion (D12) and the owner's canary (decisions 58, 64).
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const PostSchema = z
  .object({
    address: z.string().regex(BASE58),
    leader: z.string().regex(BASE58),
    sizeSol: z.number().refine((value) => (COPY_SIZES as readonly number[]).includes(value)),
    slippagePct: z.number().refine((value) => (COPY_SLIPPAGES as readonly number[]).includes(value)),
    name: z.string().trim().min(1).max(32).nullable().optional(),
  })
  .strict();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

async function proven(req: NextRequest, address: string, read: boolean): Promise<NextResponse | null> {
  const proof = await readWalletProofFrom(req.headers, read ? { allowLink: true } : undefined);
  if (proof.status === "unavailable") return json({ error: "unavailable" }, 503);
  const found = proof.status === "ok" ? proof.proof : null;
  if (!found || found.chain !== "solana" || found.address !== address) return json({ error: "proof required", proof: false }, 401);
  return null;
}

/** The copies as the page draws them: each with its result at the price now and its newest fills. */
async function copiesOf(record: PaperRecord | null) {
  const copies = record?.copies ?? [];
  const mints = [...new Set(copies.flatMap((copy) => Object.keys(copy.positions)))];
  const markets = await readSpotMarketsByMint([...mints, WRAPPED_SOL], 4_000).catch(() => null);
  const prices = new Map<string, number | null>(mints.map((mint) => [mint, markets?.ok ? (markets.byMint.get(mint)?.price ?? null) : null]));
  const solUsd = markets?.ok ? (markets.byMint.get(WRAPPED_SOL)?.price ?? null) : null;
  return copies.map((copy) => ({
    leader: copy.leader,
    name: copy.name,
    sizeSol: copy.sizeSol,
    slippagePct: copy.slippagePct,
    since: copy.since,
    summary: paperSummary(copy, prices, solUsd),
    positions: Object.entries(copy.positions).map(([mint, position]) => ({ mint, ...position })),
    fills: copy.fills.slice(0, 20),
  }));
}

export async function GET(req: NextRequest) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!BASE58.test(address)) return json({ error: "bad request" }, 400);
  const refused = await proven(req, address, true);
  if (refused) return refused;
  /* A store that did not answer is said, never «no copies» — the page would offer to start over one that exists. */
  const record = await readPaper(getGuardRuntime().store, address).then((found) => ({ found }), () => null);
  if (!record) return json({ error: "unavailable" }, 503);
  return json({ ok: true, address, copies: await copiesOf(record.found) });
}

export async function POST(req: NextRequest) {
  if (!bearerToken(req.headers) && !mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  if (Number(req.headers.get("content-length") ?? "0") > 2_000) return json({ error: "bad request" }, 400);
  let input: z.infer<typeof PostSchema> | null = null;
  try {
    const raw = await req.text();
    const parsed = raw.length > 2_000 ? null : PostSchema.safeParse(JSON.parse(raw));
    input = parsed?.success ? parsed.data : null;
  } catch {
    input = null;
  }
  if (!input) return json({ error: "bad request" }, 400);
  if (input.leader === input.address) return json({ error: "bad request", code: "SELF" }, 400);
  const refused = await proven(req, input.address, false);
  if (refused) return refused;
  const nowIso = new Date().toISOString();
  const leader = input.leader;
  const settings = { sizeSol: input.sizeSol, slippagePct: input.slippagePct, name: input.name ?? null };
  const outcome = await changePaper(getGuardRuntime().store, input.address, (copies) => startCopy(copies, leader, settings, nowIso), nowIso);
  if (!outcome.ok) return json({ error: outcome.code === "LIMIT" ? "limit" : "conflict", code: outcome.code }, outcome.code === "LIMIT" ? 409 : 503);
  return json({ ok: true, address: input.address, copies: await copiesOf(outcome.record) });
}

export async function DELETE(req: NextRequest) {
  if (!bearerToken(req.headers) && !mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  const params = new URL(req.url).searchParams;
  const address = params.get("address") ?? "";
  const leader = params.get("leader") ?? "";
  if (!BASE58.test(address) || !BASE58.test(leader)) return json({ error: "bad request" }, 400);
  const refused = await proven(req, address, false);
  if (refused) return refused;
  const outcome = await changePaper(getGuardRuntime().store, address, (copies) => stopCopy(copies, leader), new Date().toISOString());
  if (!outcome.ok) return json({ error: outcome.code === "NOT_FOUND" ? "not found" : "conflict", code: outcome.code }, outcome.code === "NOT_FOUND" ? 404 : 503);
  return json({ ok: true, address, copies: await copiesOf(outcome.record) });
}
