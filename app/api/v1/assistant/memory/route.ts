import { agentDepsFor } from "@/app/api/v1/agent/runtime";
import { AssistantMemoryUpdateSchema, type AssistantMemoryResponse } from "@/lib/api/v1/contract";
import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { forgetEverything, readMemoryView, updateMemory, type WalletRead } from "@/lib/assistant/memory/service";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { storeSurvivesColdStart } from "@/lib/guard/store";
import { FixedWindowLimiter, rateLimitHeaders } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "private, no-store" } as const;
/** Thirty changes a minute per wallet: a person edits «Про мене» and forgets a note or two; a script would do thousands. */
const limiter = new FixedWindowLimiter({ limit: 30, windowMs: 60_000, maxKeys: 5_000 });
const UNAVAILABLE = "The assistant's memory needs a durable store; this deployment does not have one.";

/** What the wallet shows now, through the same holdings read the assistant answers from — within a short budget. */
async function walletRead(request: Request, owner: string): Promise<WalletRead | null> {
  try {
    const deps = await agentDepsFor(request, owner);
    const read = await Promise.race([deps.readers.holdings(owner), new Promise<null>((settle) => setTimeout(() => settle(null), 4_000))]);
    if (read === null) return null;
    return read.ok ? { ok: true, holdings: read.holdings } : { ok: false };
  } catch {
    return null;
  }
}

/**
 * `GET /api/v1/assistant/memory` (contract 1.59.0) — what Ryntra knows about
 * the proven wallet's person: «Про мене», the notes it kept, the answers of
 * «Знайомство», and what the wallet shows now. Reads only.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "read");
  if (!proof.ok) return proof.response;
  const guard = getGuardRuntime();
  if (!storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", UNAVAILABLE);
  /* `?picture=0` — the notes alone, after a message: the wallet is not read again. */
  const wallet = new URL(request.url).searchParams.get("picture") === "0" ? null : await walletRead(request, proof.address);
  return apiJson((await readMemoryView(guard.store, proof.address, wallet)) satisfies AssistantMemoryResponse, 200, NO_STORE);
}

/** `PUT /api/v1/assistant/memory` — «Про мене», whether Ryntra notices, or a note typed by hand. Writes only this wallet's record. */
export async function PUT(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const read = await readApiBody(request, AssistantMemoryUpdateSchema, 2_048);
  if (!read.ok) return read.response;
  const rate = limiter.consume(proof.address);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many changes in a minute; try again shortly.", { headers: rateLimitHeaders(rate) });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", UNAVAILABLE);
  const changed = await updateMemory(guard.store, proof.address, read.body, Date.now()).catch(() => null);
  if (changed === null) return apiFailure("UNAVAILABLE", "The memory could not be written now; try again.");
  if (!changed.ok) return apiFailure(changed.code, changed.reason);
  return apiJson((await readMemoryView(guard.store, proof.address, null)) satisfies AssistantMemoryResponse, 200, { ...rateLimitHeaders(rate), ...NO_STORE });
}

/** `DELETE /api/v1/assistant/memory` — «Забути все»: «Про мене» and every note, gone. «Знайомство» keeps its own «Змінити». */
export async function DELETE(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const proof = await requireWalletProof(request, "mutation");
  if (!proof.ok) return proof.response;
  const rate = limiter.consume(proof.address);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many changes in a minute; try again shortly.", { headers: rateLimitHeaders(rate) });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed || !storeSurvivesColdStart(guard.store)) return apiFailure("UNAVAILABLE", UNAVAILABLE);
  await forgetEverything(guard.store, proof.address);
  return apiJson((await readMemoryView(guard.store, proof.address, null)) satisfies AssistantMemoryResponse, 200, { ...rateLimitHeaders(rate), ...NO_STORE });
}
