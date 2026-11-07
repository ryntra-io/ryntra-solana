import { duelApi } from "@/lib/ring/duel/server";
import { ringApi } from "@/lib/ring/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * The Ring's routes in one handler (CITY-50) — GET /models, /model, /garage; POST /create, /change, /off — and its
 * duels (CITY-51) — GET /duel, /duels; POST /fight, closed until their own switch `NEXT_PUBLIC_RYNTRA_CITY_RING_DUELS`
 * opens. Instances do not share memory, so a deployment keeps the agents, their keys and the request keys in the database
 * (`lib/ring/supabase-store.ts`); the Ring does not open in production on one instance's memory (`lib/ring/ready.ts`).
 * Closed (404) until `NEXT_PUBLIC_RYNTRA_CITY_RING` says `open`.
 */
type Context = { params: Promise<{ action: string }> };

const notFound = () => Response.json({ error: { code: "NOT_FOUND", message: "There is no such route." } }, { status: 404 });

export async function GET(req: Request, { params }: Context) {
  const { action } = await params;
  if (action === "models") return ringApi().models(req);
  if (action === "model") return ringApi().model(req);
  if (action === "garage") return ringApi().garage(req);
  if (action === "duel") return duelApi().duel(req);
  if (action === "duels") return duelApi().duels(req);
  return notFound();
}

export async function POST(req: Request, { params }: Context) {
  const { action } = await params;
  if (action === "create") return ringApi().create(req);
  if (action === "change") return ringApi().change(req);
  if (action === "off") return ringApi().off(req);
  if (action === "fight") return duelApi().fight(req);
  return notFound();
}
