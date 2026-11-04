import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { privateNoStoreHeaders } from "@/lib/http-control";
import { buildWeekAct, buildWeekProposal, payoutsMultisig, payoutsOn, payoutsTreasury, statementsFor, submitWeekAct } from "@/lib/partner-payouts/payouts.server";
import { mutationOriginAllowed } from "@/lib/security";
import { getAdminSession } from "@/lib/session";
import { TreasurySubmitRequestSchema } from "@/lib/solana/treasury/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `/api/admin/partner-payouts` (CITY-128) — the operator's weekly payout to partners, on the payout's own network
 * (`RYNTRA_PARTNER_PAYOUTS_NETWORK`): the treasury page's public switch stays off, and its old page stays closed.
 *
 * - `GET` — every week's statement, newest first: what each partner earned, what the week pays, what is carried.
 * - `POST { week, wallet, act?: "propose" | "approve" | "execute", format? }` — the bytes for the operator's wallet: the
 *   week's one Squads proposal (the treasury's payout batch, SOL-4), a vote «for» it, or its execution — only on the
 *   payout's multisig, only at the week's own proposal.
 * - `POST { act: "submit", buildId, wallet, signedWireBase64 }` — what the wallet signed, sent by the treasury's submit.
 * The server signs nothing: the wallet's own signature is the operator's act, so the operator's session is enough.
 */
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: privateNoStoreHeaders() });

const Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const BodySchema = z.union([
  z
    .object({
      act: z.enum(["propose", "approve", "execute"]).optional(),
      week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      wallet: Address,
      format: z.enum(["legacy", "v1"]).optional(),
    })
    .strict(),
  TreasurySubmitRequestSchema.extend({ act: z.literal("submit") }).strict(),
]);

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return json({ error: "unauthorized" }, 401);
  const treasury = payoutsTreasury();
  if (!treasury) return json({ ok: true, on: false, statements: [] });
  const statements = await statementsFor(treasury);
  return json({ ok: true, on: payoutsOn(), network: treasury.network, multisig: payoutsMultisig(), statements });
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) return json({ error: "forbidden" }, 403);
  const admin = await getAdminSession();
  if (!admin) return json({ error: "unauthorized" }, 401);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return json({ error: "bad_request" }, 400);
  const treasury = payoutsTreasury();
  if (!treasury) return json({ ok: false, code: "TREASURY_OFF", message: "The payout's network is not served here." }, 409);
  const request = parsed.data;
  if (request.act === "submit") {
    const { act: _act, ...submit } = request;
    const sent = await submitWeekAct(treasury, submit).catch(() => null);
    if (!sent) return json({ ok: false, code: "UNAVAILABLE", message: "No answer could be read from the network now." }, 503);
    return sent.ok ? json({ ok: true, submit: sent.submit }) : json(sent, 409);
  }
  const { act = "propose", ...rest } = request;
  if (act === "propose") {
    const built = await buildWeekProposal(treasury, rest);
    return built.ok ? json({ ok: true, build: built.build, statement: built.statement }) : json(built, 409);
  }
  const built = await buildWeekAct(treasury, { ...rest, act });
  return built.ok ? json({ ok: true, build: built.build }) : json(built, 409);
}
