import { NextRequest, NextResponse } from "next/server";

import { accountLegacyClose, sessionResolve, sessionRevoke, sessionRevokeAccount, type LegacyCloseResult } from "@/lib/account/rpc";
import { supabaseAuthCookieNames } from "@/lib/auth/cookie-policy";
import { supabaseServer } from "@/lib/auth/supabase";
import { verifySession } from "@/lib/beta/token";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getAdminSessionDetail, getSession, getWalletProof } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign out — here, or everywhere.
 *
 * Deleting a cookie is not a revocation, so a recorded session is revoked in
 * the store first and the cookie is cleared second. `scope: "all"` revokes
 * every session of the account (customer and admin alike) and asks Supabase
 * to drop the identity sessions on every device. A legacy stateless token has
 * no row to revoke; clearing it is all that can be done and it expires on its
 * own within its 30 days.
 *
 * The wallet proof (`rw`) is cleared on a plain logout as well: a person who
 * leaves their account on a shared device should not leave a proven wallet
 * behind either. The local receipts vault is untouched — it is the person's
 * own data on their own device.
 */

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: privateNoStoreHeaders() });
  }
  let scope: "this" | "all" = "this";
  try {
    const body = (await req.json()) as { scope?: unknown };
    if (body.scope === "all") scope = "all";
  } catch {
    /* an empty body means this device */
  }

  const [session, admin, proof] = await Promise.all([getSession(), getAdminSessionDetail(), getWalletProof()]);

  /* Every step can fail on its own, and a cleared cookie is not a revocation.
     What the answer reports is what actually happened in the store, so a
     caller — and the person reading the screen — is never told they are signed
     out everywhere while a copied cookie still works. */
  let revoked = true;
  let legacy: LegacyCloseResult | null = null;

  if (scope === "all" && session?.accountId) {
    const count = await sessionRevokeAccount({ accountId: session.accountId, reason: "logout_all" });
    revoked = count !== null;
    /* A stateless cookie has no row. Closing legacy access for this one
       account is what reaches the copies of it, and it needs no secret
       rotation and touches nobody else. A database that does not carry the
       cutoff yet is not a failure — it is the position every deployment was in
       before it existed — but a store that refuses is. */
    legacy = await accountLegacyClose(session.accountId, "logout_all");
    if (legacy === "unavailable") revoked = false;
  } else {
    if (session?.sessionId && !(await sessionRevoke(session.sessionId, "logout"))) revoked = false;
    if (admin?.sessionId && !(await sessionRevoke(admin.sessionId, "logout"))) revoked = false;
  }
  if (proof && !(await sessionRevoke(proof.sessionId, "logout"))) revoked = false;

  /* A cookie that names a recorded session but resolved to nothing has two
     very different explanations: the row is already gone, or the store cannot
     be reached. The first is a finished logout; the second is a live session
     this request did not touch. Reading the row's own answer tells them apart,
     because reporting «signed out everywhere» while a store outage left every
     row untouched is exactly the false comfort this endpoint must never give. */
  if (!session && !admin) {
    for (const name of ["rt", "rta"] as const) {
      const parsed = verifySession(req.cookies.get(name)?.value ?? "");
      if (!parsed || parsed.subject.kind !== "session") continue;
      const outcome = await sessionResolve(parsed.subject.sessionId, false);
      if (outcome.status === "unavailable") revoked = false;
    }
  }

  const client = await supabaseServer();
  let identityEnded = true;
  if (client) {
    /* Nothing to end is not a failure to end it: a visitor with no identity
       session pressing «вийти» must still get a plain answer, not a 503. */
    identityEnded = await client.auth
      .signOut({ scope: scope === "all" ? "global" : "local" })
      .then((r) => !r.error || /session|missing|not authenticated/i.test(r.error.message))
      .catch(() => false);
  }

  const complete = revoked && identityEnded;
  const res = NextResponse.json(
    { ok: complete, scope, revoked, identityEnded, legacy },
    { status: complete ? 200 : 503, headers: privateNoStoreHeaders() },
  );
  /* The cookies go either way: this browser must not keep acting as the
     account. What the status says is whether the other copies are gone too. */
  res.cookies.delete("rt");
  res.cookies.delete("rta");
  res.cookies.delete("rw");
  for (const name of supabaseAuthCookieNames(req.cookies.getAll().map((c) => c.name))) res.cookies.delete(name);
  return res;
}
