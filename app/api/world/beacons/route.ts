import { beaconApi } from "@/lib/world/beacons/server";
import { beaconsMode } from "@/lib/world/beacons/switch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Until the owner opens the account's beacons (`NEXT_PUBLIC_RYNTRA_CITY_BEACONS=open`), nothing is read or kept here. */
const closed = () =>
  Response.json({ error: { code: "BEACONS_CLOSED", message: "Beacons are kept on this device." } }, { status: 404, headers: { "cache-control": "private, no-store" } });

export async function GET(req: Request) {
  if (beaconsMode(process.env.NEXT_PUBLIC_RYNTRA_CITY_BEACONS) !== "open") return closed();
  return beaconApi().list(req);
}

export async function POST(req: Request) {
  if (beaconsMode(process.env.NEXT_PUBLIC_RYNTRA_CITY_BEACONS) !== "open") return closed();
  return beaconApi().save(req);
}
