/**
 * One answer to «is this browser signed in, and which wallet has it proven»,
 * shared by every page, every component and every tab.
 *
 * Before this each `useWalletProof()` asked on its own and kept its own copy,
 * so a page that had not asked yet showed «Confirm wallet» to somebody who had
 * signed a minute ago on another page. Now there is one fact:
 *
 *   - the server hands it to the first render (`seedWalletFact`), so a page
 *     knows before it draws;
 *   - one read refreshes it for everybody (`revalidateWalletFact`), never two
 *     at once;
 *   - a signature anywhere updates it everywhere (`setWalletFact`), and other
 *     tabs hear it over a BroadcastChannel;
 *   - a store that does not answer (`503`, a dropped connection) is `down`:
 *     «checking», never «not proven» and never «signed out», retried quietly.
 *
 * It never prompts a wallet and never touches a credential; the cookies stay
 * `httpOnly` and the server stays the judge of every request.
 */

export type WalletFact = Readonly<{
  /** `unknown` until the server has said anything in this tab; `down` while it cannot answer. */
  status: "unknown" | "known" | "down";
  signedIn: boolean;
  /** The address a wallet sign-in signed with, or `null` for another door or none. */
  walletAddress: string | null;
  /** The address this browser has proven, by sign-in or by a separate proof. */
  provenAddress: string | null;
  /**
   * What proved it: `signin` — the wallet's sign-in; `proof` — a separate
   * signature (`prove`); `link` — a wallet linked to the account signed in by
   * email or Google (SOL-W3), which proves it for reading only. `null` when
   * nothing is proven or the server did not say.
   */
  provenVia: ProvenVia | null;
  expiresAt: string | null;
  /**
   * The server's clock when it gave this answer (ms), `0` before it has. Every
   * answer is ordered by it, so an older one — a render cached by the router,
   * a read that left before a sign-in — never replaces a newer one.
   */
  at: number;
}>;

export type ProofStatus = "idle" | "checking" | "proven" | "unproven";
export type ProvenVia = "signin" | "proof" | "link";

function viaOf(value: unknown): ProvenVia | null {
  return value === "signin" || value === "proof" || value === "link" ? value : null;
}

const UNKNOWN: WalletFact = Object.freeze({ status: "unknown", signedIn: false, walletAddress: null, provenAddress: null, provenVia: null, expiresAt: null, at: 0 });
const CHANNEL = "ryntra-wallet-proof-state";
/** The invitation line listens here for the address, on any page (Growth line). */
const PROVEN_CHANNEL = "ryntra-wallet-proven";
const STALE_MS = 60_000;

let fact: WalletFact = UNKNOWN;
/* Bumped by every answer this tab did not ask for (a signature, another tab). */
let version = 0;
let inflight: Promise<WalletFact> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 5_000;
let channel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function write(next: WalletFact, broadcast: boolean): void {
  fact = Object.freeze({ ...next });
  emit();
  if (broadcast) post(CHANNEL, fact);
}

function post(name: string, message: unknown): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const out = new BroadcastChannel(name);
    out.postMessage(message);
    out.close();
  } catch {
    /* No channel: the other tab reads the fact on its next focus instead. */
  }
}

function listen(): void {
  if (channel || typeof BroadcastChannel === "undefined") return;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      const value = event.data as Partial<WalletFact> | null;
      if (!value || value.status !== "known") return;
      version += 1;
      write({ status: "known", signedIn: value.signedIn === true, walletAddress: value.walletAddress ?? null,
        provenAddress: value.provenAddress ?? null, provenVia: viaOf(value.provenVia), expiresAt: value.expiresAt ?? null, at: Math.max(fact.at + 1, Number(value.at) || 0) }, false);
    };
  } catch {
    channel = null;
  }
}

export function subscribeWalletFact(listener: () => void): () => void {
  listeners.add(listener);
  listen();
  return () => {
    listeners.delete(listener);
  };
}

export function walletFact(): WalletFact {
  return fact;
}

/** The server render's snapshot: nothing is known about this tab yet. */
export function unknownWalletFact(): WalletFact {
  return UNKNOWN;
}

/**
 * What the server already knew when it rendered the page. It fills an empty
 * store, and replaces the fact only when it is newer than what this tab has
 * (a layout refreshed after a sign-in) — never a fresher answer with an older one.
 */
export function seedWalletFact(seed: Readonly<{ signedIn: boolean; walletAddress: string | null; provenAddress: string | null; provenVia?: ProvenVia | null; checking: boolean }>, renderedAt: number): void {
  if (fact.at >= renderedAt) return;
  if (seed.checking) {
    if (fact.status !== "known") write({ ...fact, status: "down" }, false);
    scheduleRetry();
    return;
  }
  write({ status: "known", signedIn: seed.signedIn, walletAddress: seed.walletAddress, provenAddress: seed.provenAddress,
    provenVia: seed.provenAddress ? seed.provenVia ?? null : null,
    expiresAt: fact.provenAddress === seed.provenAddress ? fact.expiresAt : null, at: renderedAt }, false);
}

/** A signature that verified, a sign-out, a cleared wallet: the new fact for every page and tab. */
export function setWalletFact(next: Readonly<{ signedIn: boolean; walletAddress: string | null; provenAddress: string | null; provenVia?: ProvenVia | null; expiresAt?: string | null }>): void {
  version += 1;
  write({ status: "known", signedIn: next.signedIn, walletAddress: next.walletAddress, provenAddress: next.provenAddress,
    provenVia: next.provenAddress ? next.provenVia ?? null : null,
    expiresAt: next.expiresAt ?? null, at: Math.max(fact.at + 1, Date.now()) }, true);
  if (next.provenAddress) post(PROVEN_CHANNEL, next.provenAddress);
}

export function forgetWalletFact(): void {
  setWalletFact({ signedIn: false, walletAddress: null, provenAddress: null });
}

function scheduleRetry(): void {
  if (retry || typeof setTimeout === "undefined") return;
  retry = setTimeout(() => {
    retry = null;
    if (listeners.size > 0) void revalidateWalletFact();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30_000);
}

/**
 * Ask the server once, for everybody. A `503` or a dropped request keeps the
 * last known answer and marks the store `down` — the person sees «checking»,
 * keeps their session and is asked again shortly.
 */
export function revalidateWalletFact(options: Readonly<{ fresh?: boolean }> = {}): Promise<WalletFact> {
  /* `fresh`: a credential just changed (a wallet change, Disconnect); an
     answer already on its way was given before it and must not count. */
  if (options.fresh) {
    version += 1;
    inflight = null;
  }
  if (inflight) return inflight;
  const asked = version;
  inflight = (async () => {
    try {
      const response = await fetch("/api/auth/solana/session", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const value = await response.json() as { signedIn?: unknown; walletAddress?: unknown; expiresAt?: unknown; proof?: { address?: unknown; via?: unknown; expiresAt?: unknown } | null; checking?: unknown; at?: unknown };
      /* A signature or another tab answered while this read was out: theirs is newer. */
      if (version !== asked) return fact;
      const provenAddress = typeof value.proof?.address === "string" ? value.proof.address : null;
      const next: WalletFact = {
        status: value.checking === true && !provenAddress ? "down" : "known",
        signedIn: value.signedIn === true,
        walletAddress: typeof value.walletAddress === "string" ? value.walletAddress : null,
        provenAddress,
        provenVia: provenAddress ? viaOf(value.proof?.via) : null,
        expiresAt: typeof value.proof?.expiresAt === "string" ? value.proof.expiresAt : null,
        at: Math.max(fact.at + 1, typeof value.at === "number" ? value.at : 0),
      };
      if (next.status === "down") {
        write({ ...fact, status: "down" }, false);
        scheduleRetry();
        return fact;
      }
      retryDelay = 5_000;
      /* Never re-broadcast: only a signature or a sign-out made here is news
         for other tabs; each tab reads the server on its own. */
      write(next, false);
      return fact;
    } catch {
      if (version !== asked) return fact;
      write({ ...fact, status: "down" }, false);
      scheduleRetry();
      return fact;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Read the server if this tab has never asked, or its answer is older than a minute. */
let checkedAt = 0;
export function ensureWalletFact(now = Date.now()): void {
  if (fact.status === "unknown" || (fact.status === "known" && now - checkedAt > STALE_MS)) {
    checkedAt = now;
    void revalidateWalletFact();
  }
}

/** One address against the shared fact: what a page shows for it. */
export function proofStatusFor(value: WalletFact, address: string | null): ProofStatus {
  if (!address) return "idle";
  if (value.provenAddress === address) return "proven";
  if (value.status !== "known") return "checking";
  return "unproven";
}

/**
 * Which signature a «Confirm wallet» button asks for. A person with no
 * account signs in — the one sign-in is the proof for every page after it;
 * a person signed in by another door (email, Google) links the wallet to
 * their account — one signature that proves it for as long as it stays linked
 * and the account stays signed in, with no daily proof (decision 62, SOL-W3);
 * a proven address asks for nothing — unless only a link proves it: a page
 * that still asks was refused (a write, or a read that does not take a link
 * yet), so it gets the wallet's own signature, as before SOL-W3, never a
 * silent «done» that leaves it refused.
 */
export function proofActionFor(value: WalletFact, address: string): "none" | "signin" | "link" | "prove" {
  if (value.provenAddress === address) return value.provenVia === "link" ? actActionFor(value, address) : "none";
  if (value.signedIn && value.walletAddress === null) return "link";
  return "signin";
}

/**
 * Whether the wallet's own signature stands behind the proof of this address,
 * so a write, a payment request or a binding may go: a link proves a wallet
 * for reading only (decision 62), and the server refuses it for anything else.
 */
export function proofCanAct(value: WalletFact, address: string | null): boolean {
  return Boolean(address) && value.provenAddress === address && value.provenVia !== null && value.provenVia !== "link";
}

/**
 * Which signature an action asks for: none when the wallet's own signature
 * already stands; a person with no account (or another wallet's sign-in)
 * signs in; a person signed in by another door — linked or not — signs the
 * short wallet proof (`prove`), as before SOL-W3.
 */
export function actActionFor(value: WalletFact, address: string): "none" | "signin" | "prove" {
  if (proofCanAct(value, address)) return "none";
  if (value.signedIn && value.walletAddress === null) return "prove";
  return "signin";
}

/* The mounted wallet hooks that can ask the connected wallet for that signature. */
const actors = new Set<() => Promise<boolean>>();
export function registerWalletActor(actor: () => Promise<boolean>): () => void {
  actors.add(actor);
  return () => { actors.delete(actor); };
}

/**
 * Before a write: when this browser's proof is a link alone, ask the connected
 * wallet for its own signature first (one `prove`, as before SOL-W3), so the
 * write is not refused. Anything else — proven by the wallet, nothing proven,
 * no wallet hook mounted — leaves the answer to the server, as before.
 */
export async function ensureWalletActs(): Promise<boolean> {
  if (fact.provenVia !== "link" || !fact.provenAddress) return true;
  const actor = [...actors].at(-1);
  return actor ? actor() : true;
}

/** Tests only: back to a fresh tab. */
export function resetWalletFactForTests(): void {
  fact = UNKNOWN;
  version = 0;
  checkedAt = 0;
  inflight = null;
  if (retry) clearTimeout(retry);
  retry = null;
  retryDelay = 5_000;
  channel?.close();
  channel = null;
  listeners.clear();
  actors.clear();
}
