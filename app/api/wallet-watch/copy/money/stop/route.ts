import { mandateConnection } from "@/lib/mandate/service.server";
import { COPY_STOP_SCHEMA, copyMoneyDoor, stopMoneyCopy } from "@/lib/wallet-watch/copy-money-door.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Her stop: `POST {owner, policy}` → the copy frozen, then her unsigned transactions — the first takes every
 * policy off and the budget home, then the coins, then the emptied accounts; a coin that cannot move is named with its
 * reason. Never closed by the switch — her stop hangs on her copy's row (or, for a start that landed in part,
 * `review`: the server's record of it) and her wallet's proof alone; only her own proven wallet and her own copy. Never signs.
 */
export async function POST(request: Request) {
  const door = await copyMoneyDoor(request, "stop", COPY_STOP_SCHEMA);
  if (door instanceof Response) return door;
  return stopMoneyCopy(door, { connection: mandateConnection(door.gate.network) });
}
