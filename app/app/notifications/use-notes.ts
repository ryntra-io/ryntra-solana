"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";

import { onSurface, type BellSurface } from "./bell-surface";

/**
 * The wallet's notes, read once for the page (canon v5.4 В31, §11). The bell
 * in the top bar and Home's column read the same answer, so a note marked
 * read in one is read in the other and a count never disagrees with a list.
 *
 * The monitoring surface (`/api/monitoring`) is read behind the wallet's
 * proof, in the reader's language, and kept per wallet and language. A reader
 * that opens asks again only when the answer is older than it can bear; the
 * bell asks every two minutes while the page is visible.
 */

type Store = Readonly<{ key: string | null; status: "idle" | "loading" | "ready" | "failed"; surface: BellSurface | null; readAt: number }>;

const EMPTY: Store = { key: null, status: "idle", surface: null, readAt: 0 };
let store: Store = EMPTY;
let inflight: string | null = null;
const listeners = new Set<() => void>();

function publish(next: Store) {
  store = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const current = () => store;
const initial = () => EMPTY;

/** The eyes' fixture (`scripts/monitoring-qa/eyes.mjs`), the same one Нагляд reads. */
function fixtureSurface(): BellSurface | null {
  if (typeof window === "undefined") return null;
  return (window as { __RYNTRA_MONITORING_FIXTURE?: BellSurface }).__RYNTRA_MONITORING_FIXTURE ?? null;
}

async function load(key: string, locale: WorkspaceLocale): Promise<void> {
  if (inflight === key) return;
  inflight = key;
  if (store.key !== key) publish({ key, status: "loading", surface: null, readAt: 0 });
  else if (store.status !== "ready") publish({ ...store, status: "loading" });
  try {
    const response = await fetch("/api/monitoring", { headers: { accept: "application/json", "accept-language": locale } });
    if (store.key !== key) return;
    if (!response.ok) {
      /* A read that failed keeps what was read before; with nothing before, it says so. */
      publish({ ...store, status: store.surface ? "ready" : "failed" });
      return;
    }
    const body = (await response.json()) as BellSurface;
    if (store.key !== key) return;
    publish({ key, status: "ready", surface: onSurface(body), readAt: Date.now() });
  } catch {
    if (store.key === key) publish({ ...store, status: store.surface ? "ready" : "failed" });
  } finally {
    if (inflight === key) inflight = null;
  }
}

export type Notes = Readonly<{
  /** Without a wallet; before its proof; reading; not read; read. Never a zero that was not read. */
  phase: "guest" | "unproven" | "loading" | "failed" | "ready";
  surface: BellSurface | null;
  unread: number;
  signing: boolean;
  prove: () => void;
  /** Ask again — only when the answer is older than `maxAgeMs`. */
  reload: (maxAgeMs?: number) => void;
  markRead: (id: string) => void;
}>;

export function useNotes(locale: WorkspaceLocale): Notes {
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const address = connection?.address ?? null;
  const snapshot = useSyncExternalStore(subscribe, current, initial);
  const [fixture, setFixture] = useState<BellSurface | null>(null);
  useEffect(() => {
    setFixture(fixtureSurface());
  }, []);

  const proven = fixture !== null || (proof.state.status === "proven" && proof.state.address === address);
  const key = fixture ? `fixture:${locale}` : proven && address ? `${address}:${locale}` : null;

  useEffect(() => {
    if (!key) return;
    if (fixture) {
      if (store.key !== key) publish({ key, status: "ready", surface: onSurface(fixture), readAt: Date.now() });
      return;
    }
    if (store.key !== key || store.status === "idle") void load(key, locale);
  }, [key, locale, fixture]);

  const reload = useCallback(
    (maxAgeMs = 0) => {
      if (!key || fixture) return;
      if (store.key === key && store.status === "ready" && Date.now() - store.readAt < maxAgeMs) return;
      void load(key, locale);
    },
    [key, locale, fixture],
  );

  const markRead = useCallback(
    (id: string) => {
      if (store.key !== key || !store.surface) return;
      const surface = store.surface;
      if (!surface.recent.some((note) => note.id === id && note.unread)) return;
      publish({
        ...store,
        surface: { recent: surface.recent.map((note) => (note.id === id ? { ...note, unread: false } : note)), unread: Math.max(0, surface.unread - 1) },
      });
      if (fixture) return;
      void fetch("/api/monitoring", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ read: id }) }).catch(() => undefined);
    },
    [key, fixture],
  );

  const prove = useCallback(() => {
    void proof.prove();
  }, [proof]);

  const mine = key !== null && snapshot.key === key;
  const surface = mine ? snapshot.surface : null;
  const phase: Notes["phase"] = !address && !fixture ? "guest" : !proven ? "unproven" : surface ? "ready" : mine && snapshot.status === "failed" ? "failed" : "loading";
  return { phase, surface, unread: surface?.unread ?? 0, signing: proof.state.status === "signing", prove, reload, markRead };
}
