import { NextRequest, NextResponse } from "next/server";

import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { familyOf, normalizeWallet, type PartnerNetwork } from "@/lib/growth/partner";
import { partnerDeps } from "@/lib/growth/partner-deps.server";
import { resolvePartner } from "@/lib/growth/partner-store";
import { noteDevice } from "@/lib/growth/protect-deps.server";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { launchNetwork } from "@/lib/launch/config.server";
import { ryntraOwnWallets } from "@/lib/launch/runtime.server";
import { REFERRAL_COOKIE } from "@/lib/rewards/referral";
import { getWalletProofFrom } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `GET /api/growth/partner?network=solana&creator=<wallet>[&code=<code>]` — Solana only —
 * the «Invited by» line on a launch's review, before the creator signs.
 *
 * Answers the partner a launch of this creator would be bound to, masked —
 * or, with `code`, the partner that code would make instead (the creator's
 * «Change»), refused — for the creator's own proven wallet — when it is their
 * own. Nothing is written: the binding is
 * written by the launch flow itself once the launch is signed.
 *
 * Earlier launches and the creator's inviter are read only for the creator's
 * own proven wallet; anybody else learns only what their own browser carries
 * from `/r/<code>`, and an answer that never depends on whether two wallets
 * are one person (`resolvePartner`). The team is the same list the launch
 * flow binds with.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

export async function GET(req: NextRequest) {
  const rate = consumeSolanaReadRequest(req.headers);
  if (!rate.allowed) return json({ error: "rate limited" }, 429);
  const params = req.nextUrl.searchParams;
  /* Solana only: the EVM network's studio reads through its own runtime, with its own list of the team's wallets. */
  const network = params.get("network") ?? "solana";
  if (network !== "solana") return json({ error: "bad request" }, 400);
  const family = familyOf(network as PartnerNetwork);
  const creator = normalizeWallet(family, params.get("creator"));
  if (!creator) return json({ error: "bad request" }, 400);

  const proof = await getWalletProofFrom(req.headers).catch(() => null);
  const proven = Boolean(proof && proof.chain === family && normalizeWallet(family, proof.address) === creator);
  const code = params.get("code");
  const store = getGuardRuntime().store;
  /* A launch binds a partner only on mainnet; a stand offers none, so the review and the build agree. */
  const launch = launchNetwork();
  if (launch?.cluster !== "mainnet") return json({ ok: true, partner: null, proven });
  const deps = partnerDeps(store, { ownWallets: () => ryntraOwnWallets(launch, store) });
  /* S4: the creator's own proven wallet seen with this request, kept as hashes only. */
  if (proven) await noteDevice(store, creator, req.headers);
  try {
    const resolution = await resolvePartner(store, deps, {
      network: network as PartnerNetwork,
      creator,
      carriedCode: req.cookies.get(REFERRAL_COOKIE)?.value ?? null,
      proven,
      choice: code !== null ? { kind: "code", code } : { kind: "offered" },
    });
    if (!resolution.ok) return json({ ok: false, code: resolution.code });
    return json({ ok: true, partner: resolution.view, proven });
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
