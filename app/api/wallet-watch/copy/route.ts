import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { bearerToken } from "@/lib/auth/native-session";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { mandateConnection } from "@/lib/mandate/service.server";
import { readWalletProofFrom } from "@/lib/session";
import { readSpotMarketsByMint } from "@/lib/spot/markets.server";
import { COPY_BOUNDS, COPY_SHARES, copyBudgetIssue, copyTermsOf, solOf, termDayOf } from "@/lib/wallet-watch/copy-agent";
import { copyMoneyGate, moneyCopiesOf } from "@/lib/wallet-watch/copy-money-door.server";
import { changePaper, paperSummary, readPaper, startAgentCopy, stopCopy, type PaperRecord } from "@/lib/wallet-watch/paper";
import { WRAPPED_SOL } from "@/lib/wallet-watch/trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Повторюй за гаманцем»: the wallets one proven wallet's agent copies on paper, on her budget — start, stop,
 * and each copy at the price now. Every verb needs proof for exactly the address in question, as the paper copies of
 * SOL-R3 (`../paper/route.ts`), in the same record: the cron fills both (`runWalletWatchPass`). This route never fills,
 * signs, sends or trades.
 * The read below carries her copies with money — and her starts
 * that landed only in part — whatever the switch: reading her own copies, like stopping them, never waits for it.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const PostSchema = z
  .object({
    address: z.string().regex(BASE58),
    leader: z.string().regex(BASE58),
    /** Her day's budget, SOL: any sum — the mandate's technical bounds only (`copyBudgetIssue`). */
    perDaySol: z.number().positive().finite().max(1e9),
    sharePct: z.number().refine((value) => (COPY_SHARES as readonly number[]).includes(value)),
    days: z.number().int().min(1),
    slippagePct: z.number().refine((value) => (COPY_BOUNDS as readonly number[]).includes(value)),
    name: z.string().trim().min(1).max(32).nullable().optional(),
    /** «Start with money»: closed — refused, nothing kept. */
    money: z.boolean().optional(),
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

const moneyOpen = () => copyMoneyGate(process.env).open;

/** The copies as the screen draws them: each with its terms, its result at the price now and its newest fills. */
async function copiesOf(record: PaperRecord | null, nowMs: number) {
  const copies = record?.copies ?? [];
  const mints = [...new Set(copies.flatMap((copy) => Object.keys(copy.positions)))];
  const markets = await readSpotMarketsByMint([...mints, WRAPPED_SOL], 4_000).catch(() => null);
  const prices = new Map<string, number | null>(mints.map((mint) => [mint, markets?.ok ? (markets.byMint.get(mint)?.price ?? null) : null]));
  const solUsd = markets?.ok ? (markets.byMint.get(WRAPPED_SOL)?.price ?? null) : null;
  const nowS = Math.floor(nowMs / 1000);
  return copies.map((copy) => {
    const terms = copy.agent ?? null;
    const today = terms && terms.dayN === termDayOf(Math.floor(Date.parse(copy.since) / 1000), nowS) ? terms.daySpentSol : 0;
    return {
      leader: copy.leader,
      name: copy.name,
      sizeSol: copy.sizeSol,
      slippagePct: copy.slippagePct,
      since: copy.since,
      agent: terms
        ? { perDaySol: solOf(terms.perDayRaw), perTradeSol: solOf(terms.perTradeRaw), days: terms.days, sharePct: terms.sharePct, endsAt: terms.endsAt, todaySol: today, ended: Date.parse(terms.endsAt) <= nowMs }
        : null,
      summary: paperSummary(copy, prices, solUsd),
      positions: Object.entries(copy.positions).map(([mint, position]) => ({ mint, ...position })),
      fills: copy.fills.slice(0, 20),
    };
  });
}

export async function GET(req: NextRequest) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!BASE58.test(address)) return json({ error: "bad request" }, 400);
  const refused = await proven(req, address, true);
  if (refused) return refused;
  /* A store that did not answer is said, never «no copies» — the screen would offer to start over one that exists. */
  const record = await readPaper(getGuardRuntime().store, address).then((found) => ({ found }), () => null);
  if (!record) return json({ error: "unavailable" }, 503);
  /* Her copies with money and her unfinished starts, whatever the switch (`money` — whether a start is open);
     a book that did not answer is said (null), never «none». */
  const moneyCopies = await moneyCopiesOf(getGuardRuntime().store, address, Date.now(), () => mandateConnection("mainnet")).catch(() => null);
  return json({ ok: true, address, money: moneyOpen(), copies: await copiesOf(record.found, Date.now()), moneyCopies });
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
  /* Money is never started here: closed — said so; open — it has its own door (`./money/**`). Nothing is kept,
     nothing is read. */
  if (input.money === true) return moneyOpen() ? json({ error: "bad request", code: "MONEY_ROUTE" }, 400) : json({ error: "closed", code: "MONEY_CLOSED" }, 403);
  const issue = copyBudgetIssue(input);
  if (issue) return json({ error: "bad request", code: "BUDGET", issue }, 400);
  const refused = await proven(req, input.address, false);
  if (refused) return refused;
  const nowIso = new Date().toISOString();
  const leader = input.leader;
  const settings = { terms: copyTermsOf(input, nowIso), slippagePct: input.slippagePct, name: input.name ?? null };
  const outcome = await changePaper(getGuardRuntime().store, input.address, (copies) => startAgentCopy(copies, leader, settings, nowIso), nowIso);
  if (!outcome.ok) return json({ error: outcome.code === "LIMIT" ? "limit" : "conflict", code: outcome.code }, outcome.code === "LIMIT" ? 409 : 503);
  return json({ ok: true, address: input.address, money: moneyOpen(), copies: await copiesOf(outcome.record, Date.now()) });
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
  return json({ ok: true, address, money: moneyOpen(), copies: await copiesOf(outcome.record, Date.now()) });
}
