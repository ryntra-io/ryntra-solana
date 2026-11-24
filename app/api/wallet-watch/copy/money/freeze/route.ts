import { COPY_FREEZE_SCHEMA, copyMoneyDoor, freezeMoneyCopy } from "@/lib/wallet-watch/copy-money-door.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Her freeze: `POST {owner, policy, frozen}` — on, the copy starts no new order; off, it works again.
 * Never closed by the switch (with it closed, no order goes out anyway); only her own proven wallet and her own
 * copy. Writes the switch and the copy's record; signs, sends and moves nothing.
 */
export async function POST(request: Request) {
  const door = await copyMoneyDoor(request, "freeze", COPY_FREEZE_SCHEMA);
  if (door instanceof Response) return door;
  return freezeMoneyCopy(door);
}
