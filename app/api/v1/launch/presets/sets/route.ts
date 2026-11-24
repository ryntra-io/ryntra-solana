import { apiFailure, apiJson, apiMajorRefusal, readApiBody } from "@/lib/api/v1/http";
import { FixedWindowLimiter, clientIp, rateLimitHeaders } from "@/lib/http-control";
import { setsDeps } from "@/lib/launch/presets-market/runtime.server";
import { SETS_LIMIT_DEFAULT, SetSaveRequestSchema, listSets, saveSet } from "@/lib/launch/presets-market/service.server";
import { limitSubject } from "@/lib/launch/runtime.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A wallet saves a few sets an hour at most; every save checks a signature and writes once. */
const SAVES = new FixedWindowLimiter({ limit: 10, windowMs: 60 * 60 * 1000, maxKeys: 5_000 });

/**
 * `GET /api/v1/launch/presets/sets` — the ready launch sets of this network, the most used first: Ryntra's own
 * (one per preset served here) and creators' sets, each with its five numbers — the curve, the market cap at the start
 * and at the move into its pool, the fee on the first buyers and the creator's share — its author and how many launches
 * it started. Public: no wallet, no key. `?limit=` from 1 to 50 (12 by default). `use.feeLamports` is the price of
 * starting from a set, zero until the operator sets it. Without the store the answer is Ryntra's own sets (`stored: false`).
 *
 * The presets route (`../route.ts`) and its answer are unchanged.
 */
export async function GET(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const deps = setsDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const raw = new URL(request.url).searchParams.get("limit");
  const limit = raw === null ? SETS_LIMIT_DEFAULT : Number.parseInt(raw, 10);
  return apiJson(await listSets(deps, Number.isFinite(limit) ? limit : SETS_LIMIT_DEFAULT));
}

/**
 * `POST /api/v1/launch/presets/sets` — a creator's set kept: `{ name, author, terms, issuedAt, signature }`,
 * where `signature` is the author's wallet signing the text `setSaveText` writes from the same fields (a message, never a
 * transaction) within ten minutes of `issuedAt`. The numbers must be a served preset's own or, on an own curve, within
 * this network's bounds. Builds and signs nothing.
 */
export async function POST(request: Request) {
  const refused = apiMajorRefusal(request.headers);
  if (refused) return refused;
  const deps = setsDeps();
  if (!deps) return apiFailure("LAUNCH_UNAVAILABLE", "Launch is not served here.");
  const rate = SAVES.consume(`launch-sets:${limitSubject(clientIp(request.headers))}`);
  if (!rate.allowed) return apiFailure("RATE_LIMITED", "Too many requests.", { headers: rateLimitHeaders(rate) });
  const read = await readApiBody(request, SetSaveRequestSchema, 4_096);
  if (!read.ok) return read.response;
  const saved = await saveSet(deps, read.body);
  if (!saved.ok) return apiFailure(saved.code, saved.message);
  return apiJson({ set: saved.set }, 201);
}
