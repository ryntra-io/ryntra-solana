import { mandateConnection } from "@/lib/mandate/service.server";
import { COPY_FINISH_SCHEMA, copyMoneyDoor, finishMoneyCopy } from "@/lib/wallet-watch/copy-money-door.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The rest of her unfinished start: `POST {owner, policy, review}` → her unsigned transactions for what of it is
 * not on chain yet, built from the server's own record of her review; her start (`../start`) relays them and writes the
 * book. Closed without the switch (`MONEY_CLOSED`) — taking it home never is (`../stop`); only her own proven wallet and her
 * own review. Never signs.
 */
export async function POST(request: Request) {
  const door = await copyMoneyDoor(request, "finish", COPY_FINISH_SCHEMA);
  if (door instanceof Response) return door;
  return finishMoneyCopy(door, { connection: mandateConnection(door.gate.network) });
}
