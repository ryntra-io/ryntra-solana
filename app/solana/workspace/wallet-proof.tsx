"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { bytesToBase64, signInWithWallet, type SignInInput } from "@/lib/solana/wallet-signin.client";

import { postWalletProof, walletAuthGeneration, announceAccountChange, settleWalletChange } from "@/lib/account/wallet-auth.client";
import { actActionFor, ensureWalletFact, proofActionFor, proofCanAct, proofStatusFor, registerWalletActor, revalidateWalletFact, seedWalletFact,
  setWalletFact, subscribeWalletFact, unknownWalletFact, walletFact, type ProvenVia, type WalletFact } from "@/lib/account/wallet-proof-store.client";
import { useSolanaI18n } from "./i18n/provider";

import { useSolanaConnection } from "./connection";

/**
 * Proof of ownership for the connected Solana wallet, as a hook.
 *
 * The answer is shared: every page, every component and every tab reads one
 * fact (`lib/account/wallet-proof-store.client.ts`), which the server hands to
 * the first render and one read keeps fresh. So somebody who signed once sees
 * every page as theirs, and a page that has not asked yet says «checking»,
 * never «not confirmed».
 *
 * `prove()` asks for the one signature that is missing: a person with no
 * account signs in (the sign-in is the proof for every page after it), a person
 * signed in by another door links the wallet to that account (the link is the
 * proof while it lasts), a proven address asks for nothing. `link()` binds the
 * address to the account signed in right now.
 *
 * A link proves the wallet for reading only (decision 62). `canAct` says the
 * wallet's own signature stands behind the proof; `act()` asks for it when it
 * does not — a sign-in, or the short `prove` for a person signed in by another
 * door — and every mounted hook offers that to `ensureWalletActs()`, which a
 * write calls first.
 * The state names exactly what the person has: a connected address is
 * `unproven`, a signature that verified is `proven`, a store that cannot
 * answer is `checking`.
 */
export type WalletProofState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "unproven" }
  | { status: "proven"; address: string; expiresAt: string | null }
  | { status: "signing" }
  | { status: "refused" | "failed" | "unsupported" | "taken"; reason: string };

type Seed = Readonly<{ signedIn: boolean; walletAddress: string | null; provenAddress: string | null; provenVia: ProvenVia | null; checking: boolean }>;
const SeedContext = createContext<Seed | null>(null);

/**
 * The server's answer, before the page draws. Rendered by the cabinet layout
 * around everything that asks; outside it the hook asks the server itself.
 */
export function WalletProofSeed({ address, via = null, signedIn, walletAddress, checking, renderedAt, children }: {
  address: string | null; via?: ProvenVia | null; signedIn: boolean; walletAddress: string | null; checking: boolean;
  /** The server's clock at render, so an older render never replaces a newer answer. */
  renderedAt: number; children: ReactNode;
}) {
  const seed = useMemo<Seed>(() => ({ signedIn, walletAddress, provenAddress: address, provenVia: address ? via : null, checking }), [signedIn, walletAddress, address, via, checking]);
  /* Filled once on the client before the children render, so the first
     client render already reads the shared store; later server answers (a
     layout refreshed after a sign-in) replace it from an effect. */
  useState(() => { if (typeof window !== "undefined") seedWalletFact(seed, renderedAt); });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    seedWalletFact(seed, renderedAt);
  }, [seed, renderedAt]);
  return <SeedContext.Provider value={seed}>{children}</SeedContext.Provider>;
}

/** The shared fact, falling back to the server's seed until this tab has its own answer. */
export function useWalletFact(): WalletFact {
  const seed = useContext(SeedContext);
  const live = useSyncExternalStore(subscribeWalletFact, walletFact, unknownWalletFact);
  if (live.status !== "unknown" || !seed) return live;
  return seed.checking ? { ...live, status: "down" }
    : { status: "known", signedIn: seed.signedIn, walletAddress: seed.walletAddress, provenAddress: seed.provenAddress, provenVia: seed.provenVia, expiresAt: null, at: 0 };
}

type Local = Extract<WalletProofState, { status: "signing" | "refused" | "failed" | "unsupported" | "taken" }>;

export function useWalletProof() {
  const { connection } = useSolanaConnection();
  const { locale, text } = useSolanaI18n();
  const fact = useWalletFact();
  const address = connection?.address ?? null;
  /* This button's own attempt — signing, a refusal, a failure — over the
     shared answer, and only for the address it was made with. */
  const [local, setLocal] = useState<{ address: string; state: Local } | null>(null);
  const currentAddress = useRef(address);
  currentAddress.current = address;
  const latestFact = useRef(fact);
  latestFact.current = fact;

  useEffect(() => {
    if (address) ensureWalletFact();
  }, [address]);

  const shared = proofStatusFor(fact, address);
  const state: WalletProofState = local && local.address === address && !(shared === "proven" && local.state.status !== "signing")
    ? local.state
    : shared === "proven" && address ? { status: "proven", address, expiresAt: fact.expiresAt }
      : { status: shared === "proven" ? "checking" : shared };

  const check = useCallback(async () => {
    await revalidateWalletFact();
  }, []);

  const run = useCallback(
    async (requested: "prove" | "link" | "signin" | "act") => {
      if (!connection) return false;
      const target = connection.address;
      /* A change of wallet still waiting to be sure clears now, before the
         generation is read: it must never cancel this sign-in or delete the
         session it makes. */
      settleWalletChange();
      const generation = walletAuthGeneration();
      const current = () => currentAddress.current === target && walletAuthGeneration() === generation;
      const fail = (status: Local["status"], reason = "") => { setLocal({ address: target, state: { status, reason: reason ? text(reason) : "" } as Local }); return false; };
      let action: "none" | "prove" | "link" | "signin" = requested === "prove" ? proofActionFor(latestFact.current, target)
        : requested === "act" ? actActionFor(latestFact.current, target) : requested;
      if (requested === "act" && action === "none") return true;
      /* A page that still asks while the shared answer says «proven», or
         before there is an answer, asks the server first: the proof may have
         ended (sign in again), the store may be down (say so), or the page
         was simply early (nothing to sign). Never a silent no-op, and never a
         guess that signs an email account out. */
      if (requested === "prove" && (action === "none" || latestFact.current.status !== "known")) {
        const fresh = await revalidateWalletFact();
        if (!current()) return false;
        if (fresh.status !== "known") return fail("failed", "Sign-in can't be checked right now. Try again in a moment.");
        action = proofActionFor(fresh, target);
        /* Asked again while a link already proves this address for reading:
           what is missing is the wallet's own signature for an action (a
           write was refused on the link alone) — the short `prove`. */
        if (action === "none" && fresh.provenVia === "link") action = actActionFor(fresh, target);
        if (action === "none") return true;
      }
      setLocal({ address: target, state: { status: "signing" } });
      try {
        const prepared = await fetch(`/api/auth/solana?address=${encodeURIComponent(target)}&action=${action}&locale=${locale === "uk" ? "uk" : "en"}`);
        if (!current()) return false;
        if (!prepared.ok) return fail("failed", prepared.status === 429 ? "Too many attempts. Wait a minute." : "Sign-in is unavailable right now.");
        const { input, message } = (await prepared.json()) as { input: SignInInput; message: string };
        const signed = await signInWithWallet(connection.wallet, input, message);
        if (!current()) return false;
        /* The wallet's overlay closed by the person (Seeker Connect): nothing to report, the button is as it was. */
        if (!signed.ok && signed.state === "CANCELLED") { setLocal(null); return false; }
        if (!signed.ok) return fail(signed.state === "REFUSED" ? "refused" : signed.state === "UNSUPPORTED" ? "unsupported" : "failed", signed.reason);
        if (signed.address !== target) return fail("failed", "Wallet changed. Start sign-in again.");
        const res = await postWalletProof({ action, locale: locale === "uk" ? "uk" : "en", address: signed.address,
          signedMessage: bytesToBase64(signed.signedMessage), signature: bytesToBase64(signed.signature) }, generation);
        if (!res || !current()) return false;
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; expiresAt?: string };
        if (res.ok && data.ok) {
          setLocal(null);
          /* One answer for every page and tab: the sign-in is the proof of its
             address, a link (or a separate proof) keeps the account it was
             made in. The invitation line hears the address on its own channel. */
          const before = latestFact.current;
          if (action === "link") {
            /* What a link proves is the server's to say: an email account's
               session proves it, a wallet sign-in keeps proving its own
               address. The fresh answer is the one every page and tab gets. */
            const fresh = await revalidateWalletFact({ fresh: true });
            if (fresh.status === "known") setWalletFact(fresh);
            /* The link itself succeeded; whether it proves this address is
               the state's to say (a wallet sign-in keeps its own). */
            return true;
          }
          setWalletFact(action === "signin"
            ? { signedIn: true, walletAddress: signed.address, provenAddress: signed.address, provenVia: "signin", expiresAt: data.expiresAt ?? null }
            : { signedIn: before.signedIn, walletAddress: before.walletAddress, provenAddress: signed.address, provenVia: "proof", expiresAt: data.expiresAt ?? null });
          if (action === "signin") announceAccountChange();
          return true;
        }
        if (res.status === 409) return fail("taken", "This wallet belongs to another Ryntra account. Sign out, then sign in with this wallet to open it.");
        if (res.status === 401 && action === "link") return fail("failed", "Sign in to your account first, then link the wallet.");
        if (res.status === 503) return fail("failed", "Sign-in is unavailable right now.");
        return fail("failed", "That signature could not be verified.");
      } catch {
        if (!current()) return false;
        return fail("failed", "The request could not be completed.");
      }
    },
    [connection, locale, text],
  );

  /* Any mounted hook can ask the connected wallet before a write elsewhere on the page. With no wallet connected
     nothing is registered: the write goes, the server refuses it and the page says what it says for an unproven
     wallet — never a press that silently does nothing. */
  useEffect(() => (connection ? registerWalletActor(() => run("act")) : undefined), [run, connection]);

  return {
    address,
    state,
    canAct: proofCanAct(fact, address),
    act: () => run("act"),
    prove: () => run("prove"),
    signIn: () => run("signin"),
    link: () => run("link"),
    recheck: check,
  };
}
