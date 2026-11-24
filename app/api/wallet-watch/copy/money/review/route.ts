import { mandateConnection } from "@/lib/mandate/service.server";
import { COPY_REVIEW_SCHEMA, copyMoneyDoor, reviewMoneyCopy } from "@/lib/wallet-watch/copy-money-door.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * «Повторюй за гаманцем» with money, her review: `POST {owner, leader, perDaySol, sharePct, days, boundPct,
 * coins?}` → her unsigned transactions (one approval), the review's name and the copy's policy, what the signature moves
 * into her vault and her worst day. The record is kept by the server; only it ever goes into the book. Closed without
 * the switch (`MONEY_CLOSED`); only her own proven wallet (`lib/wallet-watch/copy-money-door.server.ts`). Never signs.
 */
export async function POST(request: Request) {
  const door = await copyMoneyDoor(request, "review", COPY_REVIEW_SCHEMA);
  if (door instanceof Response) return door;
  return reviewMoneyCopy(door, { connection: mandateConnection(door.gate.network) });
}
