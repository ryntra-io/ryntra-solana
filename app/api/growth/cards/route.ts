import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { cardPercent, cardWords } from "@/lib/growth/card-copy";
import { listShareableTrades, makeTradeCard, tokenFacts } from "@/lib/growth/card-store";
import { heldDays, tradeCardImagePath, tradeCardPath, tradeKey } from "@/lib/growth/trade-cards";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getWalletProof, getWalletProofFrom } from "@/lib/session";

import { publicOrigin } from "./origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Trade cards of the signed-in wallet.
 *
 * `GET /api/growth/cards?address=<wallet>[&mint=<mint>]` — the wallet's
 * trades a card can be made of, newest first, measured from its receipts.
 * `POST /api/growth/cards` — `{ address, trade, locale, amounts }` — the card
 * of one of them: its page and its versioned picture.
 *
 * Both only behind the wallet's own proof: a person's trades and the cards of
 * them are theirs to show. The request names a trade, never a figure — every
 * number on a card is recomputed here from the receipts.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function GET(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  const url = new URL(req.url);
  const address = url.searchParams.get("address") ?? "";
  const mintParam = url.searchParams.get("mint");
  const mint = mintParam && MINT.test(mintParam) ? mintParam : null;
  const proof = await getWalletProofFrom(req.headers);
  if (!proof || proof.chain !== "solana" || proof.address !== address) {
    return json({ error: "proof required", proof: false }, 401);
  }
  try {
    const { trades, complete } = await listShareableTrades(getGuardRuntime().store, address, mint);
    const facts = await tokenFacts(trades);
    return json({
      complete,
      trades: trades.map((moment) => {
        const token = facts.get(moment.mint)!;
        return {
          key: tradeKey(moment),
          kind: moment.kind,
          mint: moment.mint,
          symbol: token.symbol,
          name: token.name,
          icon: token.icon,
          at: moment.at,
          openedAt: moment.openedAt,
          resultBps: moment.resultBps,
          costMicros: moment.costMicros.toString(),
          proceedsMicros: moment.proceedsMicros === null ? null : moment.proceedsMicros.toString(),
          quantityRaw: moment.quantityRaw.toString(),
          decimals: moment.decimals,
        };
      }),
    });
  } catch {
    return json({ ok: false, error: "CARDS_UNAVAILABLE" }, 503);
  }
}

const BodySchema = z
  .object({
    address: z.string().min(32).max(64),
    trade: z.string().regex(/^(SELL|BUY):[0-9A-Za-z_-]{1,128}$/),
    locale: z.enum(["en", "uk"]),
    amounts: z.boolean(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return json({ error: "forbidden origin" }, 403);
  }
  const body = await readAgentControlJson(req);
  if (!body.ok) return json({ error: "bad request" }, body.status);
  const parsed = BodySchema.safeParse(body.value);
  if (!parsed.success) return json({ error: "bad request" }, 400);
  const proof = await getWalletProof();
  if (!proof || proof.chain !== "solana" || proof.address !== parsed.data.address) {
    return json({ error: "proof required", proof: false }, 401);
  }
  try {
    const outcome = await makeTradeCard(getGuardRuntime().store, {
      wallet: parsed.data.address,
      key: parsed.data.trade,
      locale: parsed.data.locale,
      amounts: parsed.data.amounts,
      now: new Date().toISOString(),
    });
    if (outcome.state === "NOT_FOUND") return json({ ok: false, error: "TRADE_NOT_FOUND" }, 404);
    if (outcome.state === "INCOMPLETE") return json({ ok: false, error: "HISTORY_INCOMPLETE" }, 503);
    const card = outcome.card;
    const origin = publicOrigin(req);
    const figure = card.trade.kind === "SELL" && card.trade.resultBps !== null ? cardPercent(card.trade.resultBps, card.locale) : null;
    return json({
      ok: true,
      card: {
        id: card.id,
        url: `${origin}${tradeCardPath(card)}`,
        image: `${origin}${tradeCardImagePath(card)}`,
        text: cardWords(card.locale).postText(card.token.symbol, figure, card.trade.kind === "SELL" ? heldDays(card.trade.openedAt, card.trade.at) : null),
        alt: cardWords(card.locale).alt(card.token.symbol, figure),
      },
    });
  } catch {
    return json({ ok: false, error: "CARDS_UNAVAILABLE" }, 503);
  }
}
