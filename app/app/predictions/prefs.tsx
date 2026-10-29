"use client";

import { indexedDbLayoutStore, parseLayout, syncedLayoutStore, type LayoutStore } from "@ryntra/core/ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { PREFS_COOKIE, alignDates, changePrefs, encodePrefsCookie, hasNewer, mergePrefs, parsePrefs, type PredictPrefs } from "@/lib/predictions/preferences";

import { PredictPrefsContext, type PredictPrefsControl } from "./prefs-context";
import { usePredictionsWallet } from "./surface";

type AccountProfile = Readonly<{ prefs: PredictPrefs | null; layouts: Readonly<Record<string, unknown>> }>;

const ROUTE = "/api/predictions/preferences";

/** The browser's copy: a first-party cookie, a year, the whole site — so the server's first frame is already theirs. */
function writeCookie(prefs: PredictPrefs) {
  try {
    document.cookie = `${PREFS_COOKIE}=${encodePrefsCookie(prefs)}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // A browser that keeps no cookies keeps the settings for this visit only.
  }
}

function profileFrom(body: { prefs?: unknown; layouts?: unknown }): AccountProfile {
  return { prefs: body.prefs ? parsePrefs(body.prefs) : null, layouts: body.layouts && typeof body.layouts === "object" ? (body.layouts as Record<string, unknown>) : {} };
}

/** The account's copy; a read that fails is tried twice more, a little later each time. */
async function readAccount(): Promise<AccountProfile | null> {
  for (const wait of [0, 800, 2_500]) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      const response = await fetch(ROUTE, { headers: { accept: "application/json" }, cache: "no-store" });
      if (response.ok) return profileFrom((await response.json()) as { prefs?: unknown; layouts?: unknown });
      // Not signed in, or refused: trying again changes nothing.
      if (response.status < 500) return null;
    } catch {
      // The network blinked: try again.
    }
  }
  return null;
}

/** One write to the account; `keepalive` lets it finish while the page goes away. Null when it did not land. */
async function writeAccount(body: Readonly<{ prefs?: PredictPrefs; layout?: Readonly<{ page: string; value: unknown }> }>, keepalive = false): Promise<AccountProfile | null> {
  // A write the store could not take right now (two at once) is tried once more; the later date still wins there.
  for (const wait of keepalive ? [0] : [0, 1_000]) {
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      const response = await fetch(ROUTE, { method: "PUT", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), keepalive });
      if (response.ok) return profileFrom((await response.json()) as { prefs?: unknown; layouts?: unknown });
      if (response.status < 500) return null;
    } catch {
      // The network blinked: try again.
    }
  }
  return null;
}

/** How long one read of the account answers the market page's layouts before it is read again. */
const ACCOUNT_FRESH_MS = 10_000;
/** A run of changes to one layout (a drag, tab after tab) goes to the account once it settles. */
const LAYOUT_SETTLE_MS = 800;

/**
 * The account as a place for the workspace's layouts: read once and shared by
 * the three layouts for a few seconds; each layout written on its own, the
 * last of a quick run only.
 */
function accountLayoutStore(): LayoutStore {
  let cached: { at: number; read: Promise<AccountProfile | null> } | null = null;
  const waiting = new Map<string, ReturnType<typeof setTimeout>>();
  const profile = () => {
    if (!cached || Date.now() - cached.at > ACCOUNT_FRESH_MS) cached = { at: Date.now(), read: readAccount() };
    return cached.read;
  };
  return {
    read: async (page) => parseLayout((await profile())?.layouts[page] ?? null),
    write: async (page, layout) => {
      cached = null;
      const timer = waiting.get(page);
      if (timer) clearTimeout(timer);
      waiting.set(
        page,
        setTimeout(() => {
          waiting.delete(page);
          void writeAccount({ layout: { page, value: layout } });
        }, LAYOUT_SETTLE_MS),
      );
    },
  };
}

/**
 * The browser's own copy of the layouts, one per wallet: a second wallet in
 * the same browser starts from its own account, not from the first one's. A
 * layout made here before signing in is the wallet's start, and goes up to
 * its account if nothing later is there.
 */
function browserLayoutStore(owner: string): LayoutStore {
  const idb = indexedDbLayoutStore();
  const key = (page: string) => `${page}@${owner}`;
  return { read: async (page) => (await idb.read(key(page))) ?? (await idb.read(page)), write: (page, layout) => idb.write(key(page), layout) };
}

/**
 * Keeps the person's settings: drawn from the cookie the server read, kept in
 * the cookie on every change and — once a wallet is signed in — in the
 * account, where another device finds them. The two copies are merged choice
 * by choice, each from where it was made later, so two devices never undo
 * each other's choices; the account is read again whenever the page comes back
 * into view.
 */
export function PredictPrefsProvider({ initial, children }: { initial: PredictPrefs; children: ReactNode }) {
  const wallet = usePredictionsWallet();
  // The account holds the settings of a proven wallet only; a connected one that has not signed keeps them in the browser.
  const address = wallet.proven ? wallet.address : null;
  const [prefs, setPrefs] = useState(initial);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Whether the account holds what this browser holds: false after a write that did not land. */
  const [synced, setSynced] = useState(true);
  const latest = useRef(prefs);
  latest.current = prefs;
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; owner: string } | null>(null);

  const adopt = useCallback((next: PredictPrefs) => {
    latest.current = next;
    setPrefs(next);
    writeCookie(next);
  }, []);

  /** Sends this browser's copy to the account and takes back what the account knows newer. */
  const send = useCallback(
    async (keepalive = false) => {
      const answer = await writeAccount({ prefs: latest.current }, keepalive);
      setSynced(answer !== null);
      if (!answer?.prefs) return;
      const merged = hasNewer(latest.current, answer.prefs) ? (mergePrefs(latest.current, answer.prefs) ?? latest.current) : latest.current;
      const aligned = alignDates(merged, answer.prefs);
      if (aligned !== latest.current) adopt(aligned);
    },
    [adopt],
  );

  // A write still waiting is dropped on a change of wallet. The browser holds one copy of the settings (the cookie), so
  // the next wallet's sign-in merges this copy with its account: settings are the browser's, layouts the wallet's.
  useEffect(() => {
    const waiting = pending.current;
    if (waiting && waiting.owner !== address) {
      clearTimeout(waiting.timer);
      pending.current = null;
    }
  }, [address]);

  // Signed in, and each time the page comes back into view: the account's copy merged with this browser's.
  useEffect(() => {
    if (!address) return undefined;
    let live = true;
    const pull = () =>
      void readAccount().then((account) => {
        if (!live || !account) return;
        const mine = latest.current;
        if (account.prefs && hasNewer(mine, account.prefs)) adopt(mergePrefs(mine, account.prefs) ?? mine);
        if (hasNewer(account.prefs ?? parsePrefs(null), latest.current) && latest.current.updatedAt > 0) void send();
      });
    pull();
    const onVisible = () => {
      if (document.visibilityState === "visible") pull();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [address, adopt, send]);

  // Leaving the page with a change still waiting: it goes now, and may finish after the page is gone.
  useEffect(() => {
    const flush = () => {
      const waiting = pending.current;
      if (!waiting) return;
      clearTimeout(waiting.timer);
      pending.current = null;
      void send(true);
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [send]);

  const change = useCallback<NonNullable<PredictPrefsControl["change"]>>(
    (patch) => {
      adopt(changePrefs(latest.current, patch, Date.now()));
      if (!address) return;
      // A run of quick changes (a number typed, a list reordered) goes to the account once.
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = {
        owner: address,
        timer: setTimeout(() => {
          pending.current = null;
          void send();
        }, 600),
      };
    },
    [address, adopt, send],
  );

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current.timer);
    },
    [],
  );

  // One store per signed-in wallet; without a wallet the workspace keeps its layouts in the browser alone.
  const layoutStore = useMemo(() => (address ? syncedLayoutStore(browserLayoutStore(address), accountLayoutStore()) : undefined), [address]);

  const value = useMemo<PredictPrefsControl>(
    () => ({ prefs, change, layoutStore, layoutKey: address ?? undefined, signedIn: !!address, synced, openSettings: () => setSettingsOpen(true) }),
    [prefs, change, layoutStore, address, synced],
  );

  const sheet = useMemo(() => ({ open: settingsOpen, close: () => setSettingsOpen(false) }), [settingsOpen]);

  return (
    <PredictPrefsContext value={value}>
      <SheetContext.Provider value={sheet}>{children}</SheetContext.Provider>
    </PredictPrefsContext>
  );
}

const SheetContext = createContext<Readonly<{ open: boolean; close: () => void }>>({ open: false, close: () => undefined });

/** Whether the settings sheet is open; the section draws it beside its pages. */
export function useSettingsSheet() {
  return useContext(SheetContext);
}
