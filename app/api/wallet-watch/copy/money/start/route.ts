import { mandateConnection } from "@/lib/mandate/service.server";
import { COPY_START_SCHEMA, copyMoneyDoor, startMoneyCopy } from "@/lib/wallet-watch/copy-money-door.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

/**
 * Her copy with money, started: `POST {owner, policy, review, items?}` — her signed transactions relayed in
 * order, then into the book only the record the server kept for that review, checked against the chain. Closed without
 * the switch (`MONEY_CLOSED`); only her own proven wallet. Never signs.
 */
export async function POST(request: Request) {
  const door = await copyMoneyDoor(request, "start", COPY_START_SCHEMA);
  if (door instanceof Response) return door;
  return startMoneyCopy(door, { connection: mandateConnection(door.gate.network) });
}
