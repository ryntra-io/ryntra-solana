import { crewsMode } from "@/lib/world/crew";

/** Until the owner opens crews on the server (`NEXT_PUBLIC_RYNTRA_CITY_CREWS=open`), nothing is read or kept here. */
export function crewsClosed(): Response | null {
  if (crewsMode(process.env.NEXT_PUBLIC_RYNTRA_CITY_CREWS) === "open") return null;
  return Response.json({ error: { code: "NOT_FOUND", message: "No such crew." } }, { status: 404, headers: { "cache-control": "private, no-store" } });
}
