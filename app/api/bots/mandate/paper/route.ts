import { NextResponse } from "next/server";

import { clientIp, FixedWindowLimiter, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { answerPaperClose, answerPaperStart, paperOriginAllowed } from "@/lib/mandate/paper/door.server";
import { readPaper } from "@/lib/mandate/paper/service.server";
import { PaperStoreUnavailable } from "@/lib/mandate/paper/store";
import { paperDeps, paperOpen, paperSecret } from "@/lib/mandate/paper/wire.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * The agent's week on paper.
 *
 * `GET` with `x-ryntra-paper: <key>` — the paper week of the key the person's browser holds: its plan, coin and budget,
 * its paper trades and its result after every fee beside plain holding; `{ paper: null }` when there is none.
 * `POST { owner, coin, symbol, plan, perDay, perTrade, days, bornAt }` — a new paper week on the person's own numbers, for
 * the wallet she proved (`lib/mandate/paper/door.server.ts`): one signed message, no transaction; the answer carries the
 * week's `key`, her wallet's own, which reads and ends it;
 * `POST { owner, action: "end" }` — she ends it; `POST { owner, action: "live" }` — she started with money from it, by the
 * mandate's own signature elsewhere: the paper stops and stays as it was. Both by the wallet's proof, as the start: the
 * week closed is the proven wallet's own, never one a key in the body names.
 *
 * Paper only: a quote of public prices, nothing signed but the proof of the wallet, nothing placed. Closed unless the
 * deployment says `RYNTRA_AGENT_PAPER=open`; open without its store (the migration not applied yet) it answers
 * `PAPER_NO_STORE`. A change comes from this site (403 `FORBIDDEN_ORIGIN` otherwise).
 *
 * A start is the proven wallet's (the door): without a proof 401, another wallet's proof 403; one paper week at a time per
 * wallet; the store's durable ledger admits a wallet three starts an hour and eight a day, everyone 240 an hour, before a
 * single quote is asked (`PAPER_LIMITED`, 429, reason `wallet`). Paper's own share of Jupiter (`lib/mandate/paper/quota.ts`):
 * a start it cannot afford now waits (`PAPER_BUSY`, 503). The address a request comes from only guards against a flood —
 * the windows below and the door's own (`RATE_LIMITED`, 429, reason `ip`); a read and an end touch the store alone.
 */

const READS = new FixedWindowLimiter({ limit: 60, windowMs: 60_000, maxKeys: 5_000 });
const WRITES = new FixedWindowLimiter({ limit: 12, windowMs: 60_000, maxKeys: 5_000 });
const BODY_MAX = 2_048;

function answer(status: number, body: unknown, rate: RateLimitDecision, retryAfterSeconds?: number) {
  const headers: Record<string, string> = { ...rateLimitHeaders(rate), "cache-control": "private, no-store" };
  if (retryAfterSeconds !== undefined) headers["Retry-After"] = String(retryAfterSeconds);
  return NextResponse.json(body, { status, headers });
}

const failure = (status: number, code: string, rate: RateLimitDecision) => answer(status, { error: { code } }, rate);

/** What the store's absence or a read that failed says: paper is not open now. */
function unavailable(error: unknown, rate: RateLimitDecision) {
  return failure(503, error instanceof PaperStoreUnavailable ? "PAPER_NO_STORE" : "PAPER_UNAVAILABLE", rate);
}

export async function GET(request: Request) {
  const rate = READS.consume(`agent-paper:read:${clientIp(request.headers)}`);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", rate);
  if (!paperOpen()) return failure(404, "PAPER_CLOSED", rate);
  try {
    const read = await readPaper(request.headers.get("x-ryntra-paper"), paperDeps());
    if (!read.ok) return failure(400, "VALIDATION_ERROR", rate);
    return answer(200, { paper: read.view }, rate);
  } catch (error) {
    return unavailable(error, rate);
  }
}

export async function POST(request: Request) {
  const rate = WRITES.consume(`agent-paper:write:${clientIp(request.headers)}`);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", rate);
  if (!paperOpen()) return failure(404, "PAPER_CLOSED", rate);
  if (!paperOriginAllowed(request)) return failure(403, "FORBIDDEN_ORIGIN", rate);
  const text = await request.text().catch(() => "");
  if (!text || text.length > BODY_MAX) return failure(400, "VALIDATION_ERROR", rate);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return failure(400, "VALIDATION_ERROR", rate);
    body = parsed as Record<string, unknown>;
  } catch {
    return failure(400, "VALIDATION_ERROR", rate);
  }
  try {
    const deps = paperDeps();
    if (body.action === "end" || body.action === "live") {
      /* The proven wallet's own week, by the same proof as its start — never a key the body carries. */
      const closed = await answerPaperClose(request, body, body.action === "end" ? "ended" : "live", { paper: deps, secret: paperSecret() });
      return answer(closed.status, closed.body, rate, closed.retryAfterSeconds);
    }
    if (body.action !== undefined && body.action !== "start") return failure(400, "VALIDATION_ERROR", rate);
    const started = await answerPaperStart(request, body, { paper: deps, secret: paperSecret() });
    return answer(started.status, started.body, rate, started.retryAfterSeconds);
  } catch (error) {
    return unavailable(error, rate);
  }
}
