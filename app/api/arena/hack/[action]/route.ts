import { hackApi, hackMachineCheck } from "@/city/lib/arena/hack/store/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* A take starts the agent's run, which plays after the answer has gone (CITY-238): the function lives as long as a run may. */
export const maxDuration = 300;

/*
 * The Arena's third door, Hack (CITY-226, CITY-238), in one handler — GET /orders, /order, /finding, /run; POST /open,
 * /take, /submit, /move, /confirm. The rules live in `city/lib/arena/hack/store/` (`api.ts`, `service.ts`) and
 * `city/lib/arena/hack/runs/`; instances do not share memory, so a deployment keeps orders, takes, findings, runs and
 * request keys in the database (`supabase/migrations/20261108180000_hack_v1.sql`, `20261110120000_hack_v2_runs.sql`).
 * Closed (404) until `NEXT_PUBLIC_RYNTRA_CITY_HACK` says `open`; production never opens on one instance's memory, nor
 * without the machine with no network that plays the runs.
 *
 * GET /machine is the operator's: one check run on the deployment's own machine, behind the cron secret, whatever the
 * door's switch says.
 */
type Context = { params: Promise<{ action: string }> };

const notFound = () => Response.json({ error: { code: "NOT_FOUND", message: "There is no such route." } }, { status: 404 });

export async function GET(req: Request, { params }: Context) {
  const { action } = await params;
  if (action === "orders") return hackApi().orders(req);
  if (action === "order") return hackApi().order(req);
  if (action === "finding") return hackApi().finding(req);
  if (action === "run") return hackApi().run(req);
  if (action === "machine") return hackMachineCheck(req);
  return notFound();
}

export async function POST(req: Request, { params }: Context) {
  const { action } = await params;
  if (action === "open") return hackApi().open(req);
  if (action === "take") return hackApi().take(req);
  if (action === "submit") return hackApi().submit(req);
  if (action === "move") return hackApi().move(req);
  if (action === "confirm") return hackApi().confirm(req);
  return notFound();
}
