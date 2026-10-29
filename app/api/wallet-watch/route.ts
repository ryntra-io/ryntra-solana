import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { bearerToken } from "@/lib/auth/native-session";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { readWalletProofFrom } from "@/lib/session";
import { readSpotMarketsByMint, readSpotTokenFacts } from "@/lib/spot/markets.server";
import { isMintAccount } from "@/lib/wallet-watch/chain.server";
import { ALERT_MODES, changeFollows, forgetTold, isAddress, readActivity, readFollows, type FollowChange, type FollowsRecord } from "@/lib/wallet-watch/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Стеження за гаманцями» (SOL-R4): the wallets one proven wallet follows.
 *
 * Every verb needs proof for exactly the address in question — the `rw` proof cookie in a browser, or the native bearer
 * session — as the Spot watchlist. Following a token's address follows its creator, as Jupiter names it. Reads the
 * chain's record already kept; signs, sends and trades nothing.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const NAME = z.string().trim().min(1).max(32).nullable();

const PostSchema = z
  .object({
    address: z.string().regex(BASE58),
    /** A wallet's address, or a token's — then its creator is followed. */
    target: z.string().trim().regex(BASE58),
    name: NAME.optional(),
    alerts: z.enum(ALERT_MODES).optional(),
    locale: z.enum(["en", "uk"]).default("uk"),
  })
  .strict();

const PatchSchema = z
  .object({
    address: z.string().regex(BASE58),
    wallet: z.string().regex(BASE58),
    name: NAME.optional(),
    alerts: z.enum(ALERT_MODES).optional(),
    locale: z.enum(["en", "uk"]).default("uk"),
  })
  .strict();

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

type Proven = { ok: true; address: string } | { ok: false; response: NextResponse };

async function proven(req: NextRequest, address: string, read: boolean): Promise<Proven> {
  const proof = await readWalletProofFrom(req.headers, read ? { allowLink: true } : undefined);
  if (proof.status === "unavailable") return { ok: false, response: json({ error: "unavailable" }, 503) };
  const found = proof.status === "ok" ? proof.proof : null;
  if (!found || found.chain !== "solana" || found.address !== address) return { ok: false, response: json({ error: "proof required", proof: false }, 401) };
  return { ok: true, address };
}

async function body<T>(req: NextRequest, schema: z.ZodType<T>): Promise<T | null> {
  try {
    const raw = await req.text();
    if (raw.length > 4_000) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The list as the page draws it: each wallet with what is already kept of it — its last trade and the day's count. */
async function listOf(record: FollowsRecord | null) {
  const store = getGuardRuntime().store;
  const dayAgo = Date.now() / 1000 - 86_400;
  const activities = await Promise.all((record?.wallets ?? []).map((follow) => readActivity(store, follow.address).catch(() => null)));
  /* The last trades' tickers in one catalogue read; a ticker not read is the mint's short form on the page. */
  const mints = activities.flatMap((activity) => (activity?.trades[0] ? [activity.trades[0].mint] : []));
  const markets = mints.length > 0 ? await readSpotMarketsByMint(mints, 4_000).catch(() => null) : null;
  return Promise.all(
    (record?.wallets ?? []).map(async (follow, index) => {
      const activity = activities[index] ?? null;
      const last = activity?.trades[0] ?? null;
      return {
        ...follow,
        lastTrade: last ? { side: last.side, mint: last.mint, symbol: markets?.ok ? (markets.byMint.get(last.mint)?.symbol ?? null) : null, at: last.at } : null,
        trades24h: activity ? activity.trades.filter((trade) => trade.at !== null && trade.at >= dayAgo).length : null,
        readAt: activity?.readAt ?? null,
      };
    }),
  );
}

export async function GET(req: NextRequest) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  if (!BASE58.test(address)) return json({ error: "bad request" }, 400);
  const gate = await proven(req, address, true);
  if (!gate.ok) return gate.response;
  const record = await readFollows(getGuardRuntime().store, address).catch(() => null);
  return json({ ok: true, address, wallets: await listOf(record) });
}

export async function POST(req: NextRequest) {
  if (!bearerToken(req.headers) && !mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  const input = await body(req, PostSchema);
  if (!input) return json({ error: "bad request" }, 400);
  const gate = await proven(req, input.address, false);
  if (!gate.ok) return gate.response;
  /* A token's address: its creator is the wallet followed. Jupiter not answering is said, not guessed. */
  let wallet = input.target;
  let via: { mint: string; symbol: string } | null = null;
  const token = await readSpotTokenFacts(input.target).catch(() => null);
  /* Jupiter silent: the chain says whether it is a token — a wallet is followed all the same, a token waits for its creator. */
  if (!token || !token.ok) {
    const mint = await isMintAccount(input.target);
    if (mint !== false) return json({ error: "unavailable", code: "TOKEN_UNREAD" }, 503);
  }
  if (token?.ok && token.market) {
    const creator = token.facts?.dev ?? null;
    if (!creator || !isAddress(creator)) return json({ error: "no creator", code: "NO_CREATOR", symbol: token.market.symbol }, 422);
    wallet = creator;
    via = { mint: token.market.mint, symbol: token.market.symbol.slice(0, 24) };
  }
  const change: FollowChange = { kind: "add", follow: { address: wallet, name: input.name ?? null, alerts: input.alerts ?? (via ? "sells" : "all"), since: new Date().toISOString(), via }, alertsGiven: input.alerts !== undefined };
  const outcome = await changeFollows(getGuardRuntime().store, input.address, change, input.locale, new Date().toISOString());
  if (!outcome.ok) return json({ error: outcome.code === "LIMIT" ? "limit" : "conflict", code: outcome.code }, outcome.code === "LIMIT" ? 409 : 503);
  return json({ ok: true, address: input.address, followed: wallet, via, wallets: await listOf(outcome.record) });
}

export async function PATCH(req: NextRequest) {
  if (!bearerToken(req.headers) && !mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  const input = await body(req, PatchSchema);
  if (!input) return json({ error: "bad request" }, 400);
  const gate = await proven(req, input.address, false);
  if (!gate.ok) return gate.response;
  const outcome = await changeFollows(getGuardRuntime().store, input.address, { kind: "update", address: input.wallet, name: input.name, alerts: input.alerts }, input.locale, new Date().toISOString());
  if (!outcome.ok) return json({ error: outcome.code === "NOT_FOUND" ? "not found" : "conflict", code: outcome.code }, outcome.code === "NOT_FOUND" ? 404 : 503);
  return json({ ok: true, address: input.address, wallets: await listOf(outcome.record) });
}

export async function DELETE(req: NextRequest) {
  if (!bearerToken(req.headers) && !mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  const params = new URL(req.url).searchParams;
  const address = params.get("address") ?? "";
  const wallet = params.get("wallet") ?? "";
  const locale = params.get("locale") === "en" ? "en" : "uk";
  if (!BASE58.test(address) || !BASE58.test(wallet)) return json({ error: "bad request" }, 400);
  const gate = await proven(req, address, false);
  if (!gate.ok) return gate.response;
  const store = getGuardRuntime().store;
  const outcome = await changeFollows(store, address, { kind: "remove", address: wallet }, locale, new Date().toISOString());
  if (!outcome.ok) return json({ error: outcome.code === "NOT_FOUND" ? "not found" : "conflict", code: outcome.code }, outcome.code === "NOT_FOUND" ? 404 : 503);
  await forgetTold(store, address, wallet).catch(() => undefined);
  return json({ ok: true, address, wallets: await listOf(outcome.record) });
}
