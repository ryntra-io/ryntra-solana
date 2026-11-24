import { mandateConnection } from "@/lib/mandate/service.server";
import { COPY_STOP_SEND_SCHEMA, copyMoneyDoor, sendMoneyCopyStop } from "@/lib/wallet-watch/copy-money-door.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Her signed stop, relayed: `POST {owner, policy, items}` — the stop itself first (nothing else goes when it
 * does not land), then each of the rest on its own; the copy marked stopped once its policy is gone from the chain.
 * Never closed by the switch; what still stands is read after, and kept on the row as «the rest» while it does.
 * Only her own proven wallet and her own copy. Never signs.
 */
export async function POST(request: Request) {
  const door = await copyMoneyDoor(request, "stop-send", COPY_STOP_SEND_SCHEMA);
  if (door instanceof Response) return door;
  return sendMoneyCopyStop(door, { connection: mandateConnection(door.gate.network) });
}
