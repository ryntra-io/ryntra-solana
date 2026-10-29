import type { ResolvedSession, SessionResolveOutcome, WalletChain } from "./rpc";

/** A removed link cannot remain a customer identity through an older cookie. */
export function walletSessionBound(session: Pick<ResolvedSession, "kind" | "method" | "walletChain" | "walletAddress" | "account">): boolean {
  if (session.kind !== "customer") return false;
  if (session.method !== "solana_siws") return true;
  return session.walletChain === "solana" && Boolean(session.walletAddress)
    && (session.account?.wallets.some((w) => w.chain === "solana" && w.address === session.walletAddress) ?? false);
}

/**
 * The address the last `link` signature in this browser named (SOL-W3). It is
 * a preference, not a credential: it only picks which of the account's own
 * linked wallets the proof names, and an address the account does not hold is
 * ignored. `httpOnly`, set by `POST /api/auth/solana` with `action=link`.
 */
export const LINKED_WALLET_COOKIE = "rwl";

/**
 * The doors whose account session a linked wallet proves: email (and its
 * recovery), Google and Telegram OpenID Connect — named, not «everything but
 * a wallet sign-in», so a door added later proves nothing until it is listed.
 */
const LINK_PROVING_METHODS: ReadonlySet<ResolvedSession["method"]> = new Set(["email_password", "email_recovery", "google_oidc", "telegram_oidc"]);

/** Whether a session opened by this door reads a proof from its account's links. */
export function linkProvesFor(method: ResolvedSession["method"]): boolean {
  return LINK_PROVING_METHODS.has(method);
}

/**
 * Which Solana address a recorded customer session proves, or `null`.
 *
 * A wallet sign-in (`solana_siws`) proves the address it signed with, while
 * that address is still linked to its account — unchanged. A session opened by
 * email, Google or Telegram OpenID Connect proves a Solana wallet linked to the
 * same account: a link is made only by that wallet's signature over this
 * server's message (`action=link`, or the sign-in that created the account), so
 * the account already proved it owns the wallet. The links are read live from the session's own row, so an
 * unlinked wallet stops proving on the next request, a wallet linked to another
 * account is never in this list, and a revoked, idle or expired session never
 * reaches here. `preferred` picks among several linked wallets; otherwise the
 * one linked last.
 */
export function sessionWalletAddress(session: Pick<ResolvedSession, "kind" | "method" | "accountId" | "walletChain" | "walletAddress" | "account">, preferred: string | null): string | null {
  if (session.kind !== "customer") return null;
  if (session.method === "solana_siws") {
    return session.walletChain === "solana" && session.walletAddress && walletSessionBound(session) ? session.walletAddress : null;
  }
  if (!session.accountId || !linkProvesFor(session.method)) return null;
  const linked = (session.account?.wallets ?? []).filter((w) => w.chain === "solana").map((w) => w.address);
  if (linked.length === 0) return null;
  return preferred && linked.includes(preferred) ? preferred : linked[linked.length - 1];
}

/**
 * The proof a resolved `rt` session carries: the session's own answer, never a
 * cached one. A store that does not answer is `unavailable`, not «not proven».
 * A linked wallet (`via: "link"`) counts only with `allowLink` — a link proves
 * a wallet for reading, never for a write, a payout or a binding.
 */
export function sessionWalletProof(outcome: SessionResolveOutcome, preferred: string | null, allowLink = false):
  | Readonly<{ status: "ok"; proof: Readonly<{ sessionId: string; chain: "solana"; address: string; method: ResolvedSession["method"]; expiresAt: string; via: "signin" | "link" }> }>
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "unavailable" }> {
  if (outcome.status === "unavailable") return { status: "unavailable" };
  if (outcome.status !== "ok") return { status: "absent" };
  const s = outcome.session;
  const address = sessionWalletAddress(s, preferred);
  const via = s.method === "solana_siws" ? "signin" : "link";
  if (!address || (via === "link" && !allowLink)) return { status: "absent" };
  return { status: "ok", proof: { sessionId: s.id, chain: "solana", address, method: s.method, expiresAt: s.expiresAt, via } };
}

/**
 * A proven wallet (the type `lib/session.ts` hands out). `via` names the
 * carrier: `proof` — the separate `rw` signature; `signin` — the wallet's own
 * sign-in (web or native); `link` — an account session proving a wallet its
 * account linked (SOL-W3), for reading only.
 */
export type WalletProof = Readonly<{
  sessionId: string;
  chain: WalletChain;
  address: string;
  method: ResolvedSession["method"];
  expiresAt: string;
  via: "proof" | "signin" | "link";
}>;

export type WalletProofRead =
  | Readonly<{ status: "ok"; proof: WalletProof }>
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "unavailable" }>;

/** The three cookies a browser's proof is read from: `rw`, `rt` and the link's hint `rwl`. */
export type WalletProofCookies = Readonly<{ rw: string | null; rt: string | null; linked: string | null }>;

/** What the read needs from the server: the token check and the session store. */
export type WalletProofDeps = Readonly<{
  verify: (token: string) => Readonly<{ subject: Readonly<{ kind: string; sessionId?: string }>; admin: boolean }> | null;
  resolve: (sessionId: string) => Promise<SessionResolveOutcome>;
}>;

/**
 * The browser's proof, as `readWalletProof` reads it: the separate `rw` proof
 * first, then the account session `rt` (its wallet sign-in, or — only with
 * `allowLink` — a wallet its account linked). Without `allowLink` a link alone
 * is `absent`, so every caller that writes, pays or binds answers «sign with
 * the wallet», as before SOL-W3.
 */
export async function readCookieWalletProof(jar: WalletProofCookies, deps: WalletProofDeps, options: Readonly<{ allowLink?: boolean }> = {}): Promise<WalletProofRead> {
  let unavailable = false;
  const proof = deps.verify(jar.rw ?? "");
  if (proof && !proof.admin && proof.subject.kind === "session" && proof.subject.sessionId) {
    const outcome = await deps.resolve(proof.subject.sessionId);
    if (outcome.status === "ok") {
      const s = outcome.session;
      if (s.kind === "wallet" && s.walletChain && s.walletAddress) {
        return { status: "ok", proof: { sessionId: s.id, chain: s.walletChain, address: s.walletAddress, method: s.method, expiresAt: s.expiresAt, via: "proof" } };
      }
    } else if (outcome.status === "unavailable") unavailable = true;
  }
  const account = deps.verify(jar.rt ?? "");
  if (account && !account.admin && account.subject.kind === "session" && account.subject.sessionId) {
    const read = sessionWalletProof(await deps.resolve(account.subject.sessionId), jar.linked, options.allowLink === true);
    if (read.status === "ok") return read;
    if (read.status === "unavailable") unavailable = true;
  }
  return unavailable ? { status: "unavailable" } : { status: "absent" };
}

/**
 * The proof a v1 route accepts on the cookie carrier: a read takes a wallet
 * linked to the signed-in account, a mutation never does. A link alone on a mutation is `absent`, the same answer
 * as no proof at all.
 */
export async function intentWalletProof(intent: "read" | "mutation", read: (options: Readonly<{ allowLink: boolean }>) => Promise<WalletProofRead>): Promise<WalletProofRead> {
  const answer = await read({ allowLink: intent === "read" });
  if (answer.status === "ok" && answer.proof.via === "link" && intent !== "read") return { status: "absent" };
  return answer;
}
