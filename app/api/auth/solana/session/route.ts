import { NextRequest, NextResponse } from "next/server";
import { sessionResolve, sessionRevoke } from "@/lib/account/rpc";
import { cookieBase, renewWalletSignin } from "@/lib/auth/account-session";
import { verifySession } from "@/lib/beta/token";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { readSession, readWalletProof } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one answer every page and every tab asks: is this browser signed in, and
 * which wallet address has it proven. It never prompts and never changes a
 * credential, except one: a wallet sign-in past half its term is renewed here,
 * so a person who keeps using the site stays signed in.
 *
 * A store that does not answer is `503 { checking: true }` — never a 200 that
 * says «signed out», so nobody is signed out because the store blinked.
 */
export async function GET(req: NextRequest) {
  const [read, proof] = await Promise.all([readSession(), readWalletProof()]);
  if (read.status === "unavailable" || (read.status === "absent" && proof.status === "unavailable")) {
    return NextResponse.json({ checking: true }, { status: 503, headers: { ...privateNoStoreHeaders(), "Retry-After": "5" } });
  }
  const session = read.status === "ok" ? read.session : null;
  const walletAddress = session?.method === "solana_siws" ? session.identityWallet : null;
  const renewed = session ? await renewWalletSignin({ sessionId: session.sessionId, accountId: session.accountId,
    method: session.method, walletAddress, expiresAt: session.expiresAt }) : null;
  const res = NextResponse.json({
    signedIn: Boolean(session?.accountId),
    walletAddress,
    expiresAt: renewed?.expiresAt ?? session?.expiresAt ?? null,
    proof: proof.status === "ok" ? { address: proof.proof.address, expiresAt: renewed && proof.proof.sessionId === session?.sessionId ? renewed.expiresAt : proof.proof.expiresAt } : null,
    checking: proof.status === "unavailable",
    at: Date.now(),
  }, { headers: privateNoStoreHeaders() });
  if (renewed) res.cookies.set(renewed.cookie.name, renewed.cookie.value, { ...cookieBase(req.url), maxAge: renewed.cookie.maxAge });
  return res;
}

/**
 * The wallet changed, or the person pressed Disconnect: close what the wallet
 * opened — a wallet sign-in (`rt`, method `solana_siws`) and a wallet proof
 * (`rw`). A session opened by another door (email, Google, Telegram) is that
 * door's and stays; the admin's `rta` and the identity provider's session are
 * untouched.
 */
export async function DELETE(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: privateNoStoreHeaders() });
  }
  let ok = true;
  const cleared: ("rt" | "rw")[] = [];
  for (const name of ["rt", "rw"] as const) {
    const parsed = verifySession(req.cookies.get(name)?.value ?? "");
    if (!parsed || parsed.admin || parsed.subject.kind !== "session") {
      if (name === "rw") cleared.push(name);
      continue;
    }
    const result = await sessionResolve(parsed.subject.sessionId, false);
    /* Unknown is not «someone else's»: a different wallet must not keep the
       old account open because the store blinked, so the cookie goes. */
    if (result.status === "unavailable") { ok = false; cleared.push(name); continue; }
    if (result.status !== "ok") { cleared.push(name); continue; }
    const walletOpened = result.session.kind === "wallet" || (result.session.kind === "customer" && result.session.method === "solana_siws");
    if (!walletOpened) continue;
    if (await sessionRevoke(result.session.id, "replaced")) cleared.push(name);
    else ok = false;
  }
  const res = NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: privateNoStoreHeaders() });
  for (const name of cleared) res.cookies.delete(name);
  return res;
}
