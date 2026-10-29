import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { accountMethods } from "@/lib/account/config";
import { accountWalletUnlink, sessionList, sessionResolve, sessionRevoke } from "@/lib/account/rpc";
import { LINKED_WALLET_COOKIE } from "@/lib/account/wallet-session";
import { verifySession } from "@/lib/beta/token";
import { matchIdentity } from "@/lib/auth/identity-link";
import { supabaseServer, supabaseVerifiedUser } from "@/lib/auth/supabase";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The account's own identity list, for Settings.
 *
 * GET answers what the account signs in with — provider identities held by
 * Supabase, the legacy Telegram bot link, proven wallets — and its live
 * sessions. Nothing here carries an address of another account or any secret.
 *
 * POST `unlink` removes one provider identity through Supabase, which refuses
 * to unlink the last one, so an account cannot lock itself out; `unlink_wallet`
 * removes a proven wallet link — and with it the proof that link gave this
 * account's session (SOL-W3), plus a separate `rw` proof of the same address
 * this browser still holds. Adding an identity is a round trip that starts
 * at `/api/auth/oauth?purpose=link`; adding a password is `/api/auth/password`.
 */

type IdentityRow = Readonly<{ id: string; provider: "email" | "google" | "telegram" | "other"; label: string | null; createdAt: string | null }>;

function providerOf(provider: string): IdentityRow["provider"] {
  if (provider === "email") return "email";
  if (provider === "google") return "google";
  if (provider === "custom:telegram") return "telegram";
  return "other";
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: privateNoStoreHeaders() });
}

export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: "unauthorized" }, 401);

  let identities: IdentityRow[] = [];
  let identityStore: "ok" | "signed_out" | "unavailable" | "off" | "mismatch" = "off";
  if (accountMethods().email) {
    const client = await supabaseServer();
    if (!client) identityStore = "unavailable";
    else {
      const user = await supabaseVerifiedUser(client);
      /* Two cookies, two people. The identity session in this browser belongs
         to whoever signed in last at the verifier, which is not necessarily the
         account `rt` names — a shared device, a second tab, a link opened over
         somebody else's session. Listing that person's sign-in methods under
         this account would expose their addresses and invite an unlink against
         the wrong user, so the list is only served when the two agree. */
      const agreement = user ? await matchIdentity(session, user.id) : "signed_out";
      if (!user || agreement === "unbound") identityStore = "signed_out";
      else if (agreement === "unavailable") identityStore = "unavailable";
      else if (agreement === "mismatch") identityStore = "mismatch";
      else {
        identityStore = "ok";
        identities = (user.identities ?? []).map((i) => ({
          id: i.identity_id ?? i.id,
          provider: providerOf(i.provider),
          label: providerOf(i.provider) === "email" ? (user.email ?? null) : typeof i.identity_data?.name === "string" ? i.identity_data.name : typeof i.identity_data?.preferred_username === "string" ? `@${i.identity_data.preferred_username}` : null,
          createdAt: i.created_at ?? null,
        }));
      }
    }
  }

  const sessions = session.accountId ? await sessionList(session.accountId) : null;
  return json({
    accountId: session.accountId,
    telegramLinked: session.telegramId !== null,
    identityStore,
    identities,
    wallets: session.account?.wallets ?? [],
    sessions: (sessions ?? []).map((s) => ({ ...s, current: s.id === session.sessionId })),
    currentMethod: session.method,
  });
}

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("unlink"), identityId: z.string().min(1).max(128) }),
  z.object({ action: z.literal("unlink_wallet"), chain: z.enum(["solana", "evm"]), address: z.string().min(20).max(64) }),
]);

export async function POST(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return json({ error: "forbidden" }, 403);
  }
  const session = await getSession();
  if (!session?.accountId) return json({ error: "unauthorized" }, 401);

  let parsed: z.infer<typeof BodySchema>;
  try {
    const result = BodySchema.safeParse(await req.json());
    if (!result.success) return json({ error: "bad request" }, 400);
    parsed = result.data;
  } catch {
    return json({ error: "bad request" }, 400);
  }

  if (parsed.action === "unlink_wallet") {
    /* The link was the account's proof of this wallet, and the session reads
       its links live, so that proof ends with this request. A `rw` proof of the
       same address in this browser is a second, account-less one: it is closed
       too, so «unlinked» means no private read of the wallet from here. Which
       `rw` this browser holds is asked before anything changes: a store that
       does not answer is a 503 with the link still in place, never a link gone
       and a proof left open behind a deleted cookie. */
    const rw = verifySession(req.cookies.get("rw")?.value ?? "");
    const rwOutcome = rw && !rw.admin && rw.subject.kind === "session" ? await sessionResolve(rw.subject.sessionId, false) : null;
    if (rwOutcome?.status === "unavailable") return json({ error: "unavailable" }, 503);
    const result = await accountWalletUnlink(session.accountId, parsed.chain, parsed.address);
    if (!result.ok) return json({ error: result.error }, result.error === "unavailable" ? 503 : result.error === "not_found" ? 404 : 409);
    let res = json({ ok: true });
    if (rwOutcome && (rwOutcome.status !== "ok" || (rwOutcome.session.kind === "wallet" && rwOutcome.session.walletAddress === parsed.address))) {
      /* The link is gone; a proof the store would not close keeps its cookie and says 503, so the page asks again
         rather than hearing «done» over a proof still open. */
      if (rwOutcome.status === "ok" && !(await sessionRevoke(rwOutcome.session.id, "logout"))) res = json({ error: "unavailable", unlinked: true }, 503);
      else res.cookies.delete("rw");
    }
    if (req.cookies.get(LINKED_WALLET_COOKIE)?.value === parsed.address) res.cookies.delete(LINKED_WALLET_COOKIE);
    return res;
  }

  if (!accountMethods().email) return json({ error: "unavailable", status: "off" }, 503);
  const client = await supabaseServer();
  if (!client) return json({ error: "unavailable" }, 503);
  const user = await supabaseVerifiedUser(client);
  if (!user) return json({ error: "identity session required", status: "signed_out" }, 401);
  /* An unlink is irreversible for the person who owns the method. It runs only
     when the identity session and the product session are the same person. */
  const agreement = await matchIdentity(session, user.id);
  if (agreement === "unavailable") return json({ error: "unavailable" }, 503);
  if (agreement !== "match") return json({ error: "identity mismatch", status: agreement === "unbound" ? "signed_out" : "mismatch" }, 409);
  const identity = (user.identities ?? []).find((i) => (i.identity_id ?? i.id) === parsed.identityId);
  if (!identity) return json({ error: "not found" }, 404);
  const result = await client.auth.unlinkIdentity(identity);
  if (result.error) {
    return json({ error: /last|only|at least/i.test(result.error.message) ? "last_method" : "refused" }, 409);
  }
  return json({ ok: true });
}
