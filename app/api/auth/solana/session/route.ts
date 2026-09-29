import { NextRequest, NextResponse } from "next/server";
import { sessionResolve, sessionRevoke } from "@/lib/account/rpc";
import { verifySession } from "@/lib/beta/token";
import { privateNoStoreHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({ signedIn: Boolean(session?.accountId),
    walletAddress: session?.method === "solana_siws" ? session.identityWallet : null,
    expiresAt: session?.expiresAt ?? null }, { headers: privateNoStoreHeaders() });
}

/** Wallet context changed: discard only customer and proof credentials. */
export async function DELETE(req: NextRequest) {
  if (!mutationOriginAllowed(req.url, req.headers.get("origin"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: privateNoStoreHeaders() });
  }
  let ok = true;
  for (const name of ["rt", "rw"] as const) {
    const parsed = verifySession(req.cookies.get(name)?.value ?? "");
    if (!parsed || parsed.admin || parsed.subject.kind !== "session") continue;
    const result = await sessionResolve(parsed.subject.sessionId, false);
    if (result.status === "unavailable") ok = false;
    else if (result.status === "ok" && result.session.kind !== "admin") {
      if (!(await sessionRevoke(result.session.id, "replaced"))) ok = false;
    }
  }
  const res = NextResponse.json({ ok }, { status: ok ? 200 : 503, headers: privateNoStoreHeaders() });
  res.cookies.delete("rt");
  res.cookies.delete("rw");
  // rta and the identity-provider session are independent and untouched.
  return res;
}
