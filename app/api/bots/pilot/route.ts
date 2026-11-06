import { z } from "zod";

import { readWalletProof } from "@/lib/session";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { mandateFailure, mandateHeaders, openMandate, readMandateBody } from "@/lib/mandate/http.server";
import { mandateConnection } from "@/lib/mandate/service.server";
import { joinPilot } from "@/lib/pilot/book.server";
import { joinDeps, pilotGate, pilotOf, viewOfPilot } from "@/lib/pilot/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * CITY-204 — the money autopilot: `GET ?owner=` — the wallet's plan and what the agent did with it (the shares now, what
 * it earned over the week, its last holds); `POST` — the plan the person just signed joins the book: its trade's mandate
 * from the agent's book, its legs' signatures from the chain (`lib/pilot/book.server.ts`). Public data only; this route
 * holds no key, builds nothing and signs nothing. Closed unless `RYNTRA_MONEY_PILOT=on` over the mandate's switch.
 */

const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
const Leg = z.object({ signature: Signature, position: Base58.nullish(), pool: Base58.nullish() }).strict();
const BodySchema = z
  .object({
    owner: Base58,
    said: z.string().max(140).nullish(),
    plan: z.record(z.string(), z.unknown()),
    policy: Base58.nullish(),
    legs: z.object({ saveUsdc: Leg.nullish(), saveSol: Leg.nullish(), pool: Leg.nullish() }).strict(),
  })
  .strict();

export async function GET(request: Request) {
  const door = openMandate(request, "pilot-read");
  if (door instanceof Response) return door;
  const gate = pilotGate(process.env);
  if (!gate.open) return mandateFailure(404, "PILOT_CLOSED", "Not found.", door.rate);
  const owner = Base58.safeParse(new URL(request.url).searchParams.get("owner"));
  if (!owner.success) return mandateFailure(400, "VALIDATION_ERROR", "Not an address.", door.rate);
  const view = await pilotOf(getGuardRuntime().store, gate.mandate.network, owner.data).catch(() => undefined);
  if (view === undefined) return mandateFailure(503, "UNAVAILABLE", "The autopilot did not answer.", door.rate);
  if (!view) return mandateFailure(404, "NO_PILOT", "No autopilot for this wallet.", door.rate);
  return Response.json(view, { headers: mandateHeaders(door.rate) });
}

export async function POST(request: Request) {
  const door = openMandate(request, "pilot");
  if (door instanceof Response) return door;
  const gate = pilotGate(process.env);
  if (!gate.open) return mandateFailure(404, "PILOT_CLOSED", "Not found.", door.rate);
  const body = await readMandateBody(request, BodySchema, door.rate);
  if (body instanceof Response) return body;
  const guard = getGuardRuntime();
  if (!guard.writes.allowed) return mandateFailure(503, "UNAVAILABLE", "The autopilot cannot be kept here now.", door.rate);
  /* Her wallet's sign-in, when she has one: then an older mandate of hers may take a plan too. */
  const read = await readWalletProof().catch(() => null);
  const proof = read?.status === "ok" ? read.proof : null;
  const proven = Boolean(proof && proof.chain === "solana" && proof.address === body.owner && proof.via !== "link");
  const joined = await joinPilot(
    { owner: body.owner, said: body.said ?? null, plan: body.plan, policy: body.policy ?? null, legs: body.legs, proven },
    joinDeps(gate, guard.store, mandateConnection(gate.mandate.network)),
  ).catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const, reason: "The autopilot did not answer." }));
  if (!joined.ok) return mandateFailure(joined.code === "UNAVAILABLE" ? 503 : 422, joined.code, joined.reason, door.rate);
  return Response.json(viewOfPilot(joined.entry), { headers: mandateHeaders(door.rate) });
}
