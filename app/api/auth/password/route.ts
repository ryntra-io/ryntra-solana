import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { accountMethods } from "@/lib/account/config";
import { accountLegacyClose, sessionRevokeAccount } from "@/lib/account/rpc";
import { cookieBase, establishAccount, loginKindFor, openCustomerSession, recordSessionLogin, summarizeIdentity } from "@/lib/auth/account-session";
import { DEFAULT_RETURN_PATH, withAuthMarker } from "@/lib/auth/return-path";
import { supabaseServer, supabaseVerifiedUser } from "@/lib/auth/supabase";
import { FixedWindowLimiter, clientIp, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Set a new password.
 *
 * Two ways in, one rule: the identity session at Supabase must belong to the
 * person. After a recovery link that session is the only thing they hold, and
 * it is enough — the link was one-time, mailed to the address on the account.
 * A signed-in person changing their password from Settings holds both.
 *
 * Once the password is set every other product session of the account is
 * revoked (`password_reset`) and Supabase is told to drop its other sessions
 * too, so a stolen cookie does not outlive the reset. The current browser gets
 * a fresh product session so the person is not thrown out by their own reset.
 */

const LIMITER = new FixedWindowLimiter({ windowMs: 60_000, limit: 10, maxKeys: 10_000 });
const BodySchema = z.object({ password: z.string().min(8).max(256), next: z.string().max(512).optional() });

function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...privateNoStoreHeaders(), ...headers } });
}

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return json({ error: "forbidden" }, 403);
  }
  if (!accountMethods().email) return json({ status: "unavailable" }, 503);
  const decision = LIMITER.consume(`auth-password:${clientIp(req.headers)}`);
  if (!decision.allowed) return json({ status: "rate_limited" }, 429, rateLimitHeaders(decision));

  let parsed: z.infer<typeof BodySchema>;
  try {
    const result = BodySchema.safeParse(await req.json());
    if (!result.success) return json({ status: "invalid" }, 400);
    parsed = result.data;
  } catch {
    return json({ status: "invalid" }, 400);
  }

  const client = await supabaseServer();
  if (!client) return json({ status: "unavailable" }, 503);
  const user = await supabaseVerifiedUser(client);
  if (!user) return json({ status: "signed_out" }, 401);

  const updated = await client.auth.updateUser({ password: parsed.password });
  if (updated.error) {
    if (/password/i.test(updated.error.message) && /weak|short|least|character/i.test(updated.error.message)) return json({ status: "weak_password" }, 422);
    if (/same password|different from the old/i.test(updated.error.message)) return json({ status: "same_password" }, 422);
    return json({ status: "error" }, 400);
  }

  /* A recovery link proves one mailbox. It is not an instruction to join the
     account this browser was holding, so nothing is attached here. */
  const identity = summarizeIdentity(user, "email");
  const account = await establishAccount(identity, { attachTo: null });
  if (!account.ok) return json({ status: "error", reason: account.error }, 409);

  /* A fresh session for this browser first; then every other product session
     of the account — the one this browser held before included — and the
     identity sessions elsewhere. A stolen cookie does not outlive the reset. */
  const kind = loginKindFor("recovery");
  const opened = await openCustomerSession({ accountId: account.accountId, method: kind });
  if (!opened) return json({ status: "error", reason: "session_store" }, 503);

  /* The password is already changed; the revocation is a second step that can
     fail on its own. Reporting «updated» when the other sessions are still
     open is the dangerous half-truth here — somebody who reset a password
     because it leaked would walk away believing the thief was locked out. So
     the result says which half happened, and the sheet offers the way on. */
  const revoked = await sessionRevokeAccount({ accountId: account.accountId, keep: opened.sessionId, reason: "password_reset" });
  const legacy = await accountLegacyClose(account.accountId, "password_reset");
  const identitySignedOut = await client.auth
    .signOut({ scope: "others" })
    .then((r) => !r.error)
    .catch(() => false);
  const complete = revoked !== null && identitySignedOut && legacy !== "unavailable";
  await recordSessionLogin({ accountId: account.accountId, sessionId: opened.sessionId, method: kind, next: DEFAULT_RETURN_PATH });

  const res = json({
    status: complete ? "updated" : "updated_sessions_open",
    revoked: revoked ?? null,
    identitySignedOut,
    legacy,
    next: withAuthMarker(parsed.next && parsed.next.startsWith("/app") ? parsed.next : DEFAULT_RETURN_PATH, "ok"),
  });
  res.cookies.set(opened.cookie.name, opened.cookie.value, { ...cookieBase(req.url), maxAge: opened.cookie.maxAge });
  return res;
}
