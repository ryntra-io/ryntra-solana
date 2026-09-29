import { NextResponse } from "next/server";

import { serverAggClient } from "@/lib/predictions/agg/adapter";

import { getAdminSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * The one server-side read of the AGG lab (`RYN-AGG-LAB-001`): the paper
 * accounts of the Owner's AGG app, read with the server key the aggregator
 * documents for partner backends (`x-app-api-key`, scope `read`). It exists
 * so the paper trade the Owner places in the browser is confirmed from the
 * other side — the aggregator's own ledger — and nowhere else. The key comes
 * from the server environment (`AGG_API_KEY`, set in the Vercel project by
 * the Owner) and never leaves this route; a local stand without it answers
 * 503 honestly. Admin session only, like the page.
 */

const AGG_API = "https://api.agg.market";

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const appId = process.env.AGG_APP_ID?.trim();
  const apiKey = process.env.AGG_API_KEY?.trim();
  if (!appId || !apiKey) {
    return NextResponse.json(
      { error: "unavailable", reason: "AGG_APP_ID or AGG_API_KEY is not set on this server; the paper ledger is read with the server key only." },
      { status: 503 },
    );
  }

  const client = serverAggClient({ baseUrl: AGG_API, appId, apiKey });
  /* The app-management reads the SDK has no method for: a user's order history
     and positions as the partner backend sees them (`/apps/{appId}/users/{id}`),
     read with the same key so a browser-mode paper order can be looked for on
     both ledgers the aggregator keeps. */
  const partnerRead = async (path: string): Promise<unknown> => {
    const response = await fetch(`${AGG_API}/apps/${encodeURIComponent(appId)}${path}`, {
      headers: { "x-app-id": appId, "x-app-api-key": apiKey, accept: "application/json" },
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as unknown;
    return { status: response.status, body };
  };
  try {
    const page = await client.listPaperTradingAccounts({ limit: 20 });
    const accounts = await Promise.all(
      (page.data ?? []).map(async (account) => {
        const userId = account.externalId?.startsWith("user:") ? account.externalId.slice(5) : null;
        const [portfolio, orders, positions, userOrders, userPositions] = await Promise.all([
          client.getPaperTradingPortfolio(account.id),
          client.listPaperTradingOrders(account.id, { limit: 20 }),
          client.listPaperTradingPositions(account.id, { limit: 20 }),
          userId ? partnerRead(`/users/${encodeURIComponent(userId)}/orders?limit=20`) : Promise.resolve(null),
          userId ? partnerRead(`/users/${encodeURIComponent(userId)}/positions?limit=20`) : Promise.resolve(null),
        ]);
        return {
          userId,
          userOrders,
          userPositions,
          id: account.id,
          externalId: account.externalId,
          status: account.status,
          currency: account.currency,
          createdAt: account.createdAt,
          startingBalance: account.startingBalance,
          cashBalance: portfolio.cashBalance,
          marketValue: portfolio.marketValue,
          equity: portfolio.equity,
          realizedPnl: portfolio.realizedPnl,
          unrealizedPnl: portfolio.unrealizedPnl,
          orders: (orders.data ?? []).map((order) => ({
            id: order.id,
            createdAt: order.createdAt,
            venue: order.venue,
            side: order.side,
            status: order.status,
            marketQuestion: order.marketQuestion,
            outcomeLabel: order.outcomeLabel,
            requestedSpend: order.requestedSpend,
            filledShares: order.filledShares,
            avgPrice: order.avgPrice,
            notional: order.notional,
            cashDelta: order.cashDelta,
            rejectionReason: order.rejectionReason,
          })),
          positions: (positions.data ?? []).map((position) => ({
            id: position.id,
            venue: position.venue,
            marketQuestion: position.marketQuestion,
            outcomeLabel: position.outcomeLabel,
            size: position.size,
            avgEntryPrice: position.avgEntryPrice,
            markPrice: position.markPrice,
            markSource: position.markSource,
            marketValue: position.marketValue,
            unrealizedPnl: position.unrealizedPnl,
            liquidityStatus: position.liquidityStatus,
          })),
        };
      }),
    );
    return NextResponse.json({ readAt: new Date().toISOString(), count: accounts.length, accounts });
  } catch (caught) {
    const record = caught && typeof caught === "object" ? (caught as Record<string, unknown>) : {};
    const status = typeof record.status === "number" ? record.status : 502;
    const message = typeof record.message === "string" ? record.message : String(caught);
    return NextResponse.json({ error: "provider", status, message }, { status: 502 });
  }
}
