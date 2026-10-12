"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";

import type { NormalizedCandle } from "@/lib/chart/types";
import type { SolanaWalletAction } from "@/lib/solana/action-ledger";
import { readWalletHoldingsUntilComplete } from "@/lib/solana/holdings.client";
import type { SpotPool, SpotTimeframe } from "@/lib/spot/candles";
import { TIMEFRAME_TTL_MS } from "@/lib/spot/candles";
import type { SpotMarket, SpotMarketListRow, SpotView } from "@/lib/spot/markets";
import { spotListReadIncomplete, spotReadRetryDelayMs } from "@/lib/spot/read-retry";
import { currentSpotSnapshot } from "@/lib/spot/ticket-state";
import type { TokenAbout } from "@/lib/spot/token-about";
import { createWatchlistWriter } from "@/lib/spot/watchlist-client";

/**
 * The reads behind the Spot page, as hooks. Each one names the three things
 * a surface must be able to say about a figure — loading, unavailable, or a
 * value with the time it was observed — so the page never draws a zero for a
 * source that did not answer.
 */

type ReadState<T> =
  | Readonly<{ status: "loading"; value: T | null }>
  | Readonly<{ status: "ready"; value: T; observedAt: string; stale: boolean }>
  | Readonly<{ status: "unavailable"; value: T | null; reason: string }>;

function useScopedRead<T>(key: string | null, empty: T) {
  const initial = useRef(empty).current;
  const activeKey = useRef(key);
  activeKey.current = key;
  const [snapshot, setSnapshot] = useState<{ key: string | null; state: T }>({ key: null, state: initial });
  const setState = useCallback((next: SetStateAction<T>) => {
    setSnapshot((current) => {
      if (activeKey.current !== key) return current;
      const previous = current.key === key ? current.state : initial;
      return { key, state: typeof next === "function" ? (next as (value: T) => T)(previous) : next };
    });
  }, [initial, key]);
  return [currentSpotSnapshot(snapshot, key, initial), setState] as const;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<{ ok: true; value: T } | { ok: false; reason: string; code: string | null; status: number }> {
  try {
    const response = await fetch(url, { signal, headers: { accept: "application/json" } });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const error = (body.error ?? {}) as { message?: string; code?: string };
      return { ok: false, reason: error.message ?? `HTTP ${response.status}`, code: typeof error.code === "string" ? error.code : null, status: response.status };
    }
    return { ok: true, value: body as T };
  } catch (failure) {
    if (failure instanceof DOMException && failure.name === "AbortError") return { ok: false, reason: "aborted", code: null, status: 0 };
    return { ok: false, reason: "The request did not complete.", code: null, status: 0 };
  }
}

/* ------------------------------------------------------------- the list */

export type MarketListState = ReadState<readonly SpotMarketListRow[]> & Readonly<{
  /** The verified universe did not answer; a category view may be short. */
  partial?: boolean;
  /** Consecutive failed reads, so the column can wait before it says so. */
  failures?: number;
}>;

export type MarketListRead = MarketListState & Readonly<{ retry: () => void }>;

/**
 * The market column: one ranked view, a search, or the watchlist's mints.
 *
 * A `null` view is a view not yet resolved — the address bar, then the
 * browser's memory — and reads nothing, so the page asks for one list on
 * arrival rather than one for the default and another for the one it kept.
 * Search is debounced; the ranked views refresh every minute while the tab is
 * visible, which is the provider's own cadence for them. A read that fails is
 * asked again on its own — quickly, then steadily — and a partial category
 * read counts as a failure rather than as an empty category.
 */
export function useSpotList(view: SpotView | null, query: string, watchlist: readonly string[]): MarketListRead {
  const ticket = useRef(0);
  const trimmed = query.trim();
  const searching = trimmed.length > 0;
  /* Only the watchlist view reads by the watchlist's mints; the others must
     not re-read because a star was pressed. */
  const watchlistKey = view === "watchlist" && !searching ? watchlist.join(",") : "";
  const [state, setState] = useScopedRead<MarketListState>(view === null ? null : `${view}:${trimmed}:${watchlistKey}`, { status: "loading", value: null });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  useEffect(() => {
    if (view === null) return;
    const my = ++ticket.current;
    const controller = new AbortController();
    let failures = 0;
    let retryTimer: number | undefined;
    const run = async () => {
      let url: string;
      if (searching) url = `/api/spot/markets?q=${encodeURIComponent(trimmed)}&limit=40`;
      else if (view === "watchlist") {
        if (watchlistKey.length === 0) {
          setState({ status: "ready", value: [], observedAt: new Date().toISOString(), stale: false });
          return;
        }
        url = `/api/spot/markets?mints=${encodeURIComponent(watchlistKey)}`;
      } else url = `/api/spot/markets?view=${view}&limit=150`;
      const read = await getJson<{ rows: SpotMarketListRow[]; observedAt: string; stale?: boolean; partial?: boolean }>(url, controller.signal);
      if (ticket.current !== my) return;
      const incomplete = read.ok && spotListReadIncomplete({ view, searching, partial: read.value.partial ?? false, rowCount: read.value.rows.length });
      if (!read.ok || incomplete) {
        if (!read.ok && read.reason === "aborted") return;
        failures += 1;
        const reason = read.ok ? "The market list was only partly read." : read.reason;
        setState((current) => ({ status: "unavailable", value: current.value, reason, failures }));
        const again = () => {
          retryTimer = window.setTimeout(() => {
            if (ticket.current !== my) return;
            if (document.visibilityState === "visible") void run();
            else again();
          }, spotReadRetryDelayMs(failures));
        };
        again();
        return;
      }
      failures = 0;
      setState({ status: "ready", value: read.value.rows, observedAt: read.value.observedAt, stale: read.value.stale ?? false, partial: read.value.partial ?? false });
    };
    setState((current) => ({ status: "loading", value: current.value }));
    const timer = window.setTimeout(() => void run(), searching ? 250 : 0);
    const interval = !searching && view !== "watchlist"
      ? window.setInterval(() => { if (document.visibilityState === "visible" && retryTimer === undefined) void run(); }, 60_000)
      : undefined;
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [view, trimmed, searching, watchlistKey, setState, attempt]);

  return useMemo(() => ({ ...state, retry }), [state, retry]);
}

/* ------------------------------------------------------------ one market */

export type MarketState = ReadState<SpotMarket> | Readonly<{ status: "unknown"; value: null }>;

/**
 * The selected market, polled every fifteen seconds while visible. A read
 * that fails is asked again after a short pause on its own, so a price refused
 * on arrival is not a price missing for fifteen seconds.
 */
export function useSpotMarket(mint: string | null): MarketState {
  const [state, setState] = useScopedRead<MarketState>(mint, { status: "loading", value: null });
  useEffect(() => {
    if (!mint) {
      setState({ status: "loading", value: null });
      return;
    }
    const controller = new AbortController();
    let live = true;
    let failures = 0;
    let retryTimer: number | undefined;
    setState((current) => ({ status: "loading", value: current.value && current.value.mint === mint ? current.value : null }));
    const run = async () => {
      const read = await getJson<{ market: SpotMarket | null; observedAt: string; stale: boolean }>(`/api/spot/market?mint=${encodeURIComponent(mint)}`, controller.signal);
      if (!live) return;
      if (!read.ok) {
        if (read.reason === "aborted") return;
        failures += 1;
        setState((current) => ({ status: "unavailable", value: current.value, reason: read.reason }));
        if (retryTimer === undefined) {
          retryTimer = window.setTimeout(() => {
            retryTimer = undefined;
            if (live && document.visibilityState === "visible") void run();
          }, spotReadRetryDelayMs(failures));
        }
        return;
      }
      failures = 0;
      if (read.value.market === null) {
        setState({ status: "unknown", value: null });
        return;
      }
      setState({ status: "ready", value: read.value.market, observedAt: read.value.observedAt, stale: read.value.stale });
    };
    void run();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible" && retryTimer === undefined) void run(); }, 15_000);
    return () => {
      live = false;
      controller.abort();
      window.clearInterval(interval);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [mint, setState]);
  return state;
}

/* ------------------------------------------------------------ what it is */

export type TokenAboutRead = Readonly<{ status: "loading" } | { status: "ready"; about: TokenAbout } | { status: "unavailable" }>;

/**
 * «Що це за монета»: the description the token's creator wrote in its
 * metadata (`/api/spot/about`), read once per market — a creator rarely
 * rewrites it, and the edge keeps it for an hour. A route that did not answer
 * is `unavailable`, which the header says as such, never as a silence.
 */
export function useTokenAbout(mint: string | null, name: string, symbol: string): TokenAboutRead {
  const [state, setState] = useScopedRead<TokenAboutRead>(mint, { status: "loading" });
  /* The names the header shows are only a filter for a description that repeats them; a later read of them does not ask again. */
  const names = useRef({ name, symbol });
  names.current = { name, symbol };
  useEffect(() => {
    if (!mint) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    const query = new URLSearchParams({ mint });
    if (names.current.name) query.set("name", names.current.name);
    if (names.current.symbol) query.set("symbol", names.current.symbol);
    void getJson<{ about: TokenAbout }>(`/api/spot/about?${query.toString()}`, controller.signal).then((read) => {
      if (!read.ok) {
        if (read.reason !== "aborted") setState({ status: "unavailable" });
        return;
      }
      setState({ status: "ready", about: read.value.about });
    });
    return () => controller.abort();
  }, [mint, setState]);
  return state;
}

/* --------------------------------------------------------------- candles */

export type CandlesValue = Readonly<{ mint: string; candles: readonly NormalizedCandle[]; pool: SpotPool; timeframe: SpotTimeframe }>;
/** Why a market has no chart, as the server names it — printed in the frame. */
export type NoChartCode = "NO_POOL" | "NO_MAJOR_QUOTE" | "THIN" | "QUIET" | "STALE" | "PRICE_MISMATCH";
export type CandlesState = ReadState<CandlesValue> | Readonly<{ status: "none"; value: null; code: NoChartCode | null; reason: string }>;

/**
 * Candles for the selected market and timeframe, re-read at the timeframe's
 * own cadence. `none` is the honest answer for a mint no pool prices: the
 * chart says so rather than drawing a flat line.
 */
export function useSpotCandles(mint: string | null, timeframe: SpotTimeframe): CandlesState {
  const [state, setState] = useScopedRead<CandlesState>(mint ? `${mint}:${timeframe}` : null, { status: "loading", value: null });
  useEffect(() => {
    if (!mint) {
      setState({ status: "loading", value: null });
      return;
    }
    const controller = new AbortController();
    let live = true;
    /* Keep the last bars on screen only while they are this market's on this
       timeframe; a new market starts from an empty frame, never from the old
       one's candles. */
    setState((current) => ({
      status: "loading",
      value: current.value && current.value.mint === mint && current.value.timeframe === timeframe ? current.value : null,
    }));
    const run = async () => {
      const read = await getJson<{ timeframe: SpotTimeframe; candles: NormalizedCandle[]; pool: SpotPool; observedAt: string; stale: boolean }>(
        `/api/spot/candles?mint=${encodeURIComponent(mint)}&tf=${timeframe}`,
        controller.signal,
      );
      if (!live) return;
      if (!read.ok) {
        if (read.reason === "aborted") return;
        if (read.status === 404) {
          const code = (read.code ?? "").replace(/^CANDLES_/, "");
          const known: readonly NoChartCode[] = ["NO_POOL", "NO_MAJOR_QUOTE", "THIN", "QUIET", "STALE", "PRICE_MISMATCH"];
          setState({ status: "none", value: null, code: known.includes(code as NoChartCode) ? (code as NoChartCode) : null, reason: read.reason });
        } else setState((current) => ({ status: "unavailable", value: current.value, reason: read.reason }));
        return;
      }
      setState({
        status: "ready",
        value: { mint, candles: read.value.candles, pool: read.value.pool, timeframe: read.value.timeframe },
        observedAt: read.value.observedAt,
        stale: read.value.stale,
      });
    };
    /* A read that fails is asked again after a short pause, once per
       failure, before the timeframe's own cadence takes over: a cold instance
       or a source that blinked must not leave the frame empty for two minutes. */
    let retry: number | undefined;
    const attempt = async () => {
      await run();
      if (!live) return;
      setState((current) => {
        if (current.status === "unavailable" && retry === undefined) {
          retry = window.setTimeout(() => { retry = undefined; if (document.visibilityState === "visible") void attempt(); }, 8_000);
        }
        return current;
      });
    };
    void attempt();
    const interval = window.setInterval(() => { if (document.visibilityState === "visible") void attempt(); }, Math.max(15_000, TIMEFRAME_TTL_MS[timeframe]));
    return () => {
      live = false;
      controller.abort();
      window.clearInterval(interval);
      if (retry !== undefined) window.clearTimeout(retry);
    };
  }, [mint, timeframe, setState]);
  return state;
}

/* ------------------------------------------------------------- watchlist */

const WATCHLIST_KEY = "ryntra.spot.watchlist.v1";
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function readLocal(owner: string | null): string[] {
  try {
    const raw = window.localStorage.getItem(`${WATCHLIST_KEY}:${owner ?? "guest"}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((mint): mint is string => typeof mint === "string" && BASE58.test(mint)).slice(0, 200) : [];
  } catch {
    return [];
  }
}

function writeLocal(owner: string | null, mints: readonly string[]): void {
  try {
    window.localStorage.setItem(`${WATCHLIST_KEY}:${owner ?? "guest"}`, JSON.stringify(mints));
  } catch {
    /* A denied store loses nothing the server does not keep. */
  }
}

export type WatchlistSync = "guest" | "unproven" | "syncing" | "synced" | "offline";

/**
 * The watchlist: instant locally, the server's row when the wallet is proven.
 *
 * On first read with a proof the two lists are merged rather than one
 * overwriting the other, so stars pressed before proving are kept. Every
 * later change writes the whole list, and a write that fails keeps the local
 * copy and reports `offline` — the star still works, it just has not travelled.
 */
export function useSpotWatchlist(owner: string | null, proven: boolean) {
  const [mints, setMints] = useScopedRead<readonly string[]>(owner ?? "guest", []);
  const [sync, setSync] = useScopedRead<WatchlistSync>(owner ?? "guest", "guest");
  const merged = useRef<string | null>(null);
  const localMints = useRef<{ owner: string | null; mints: readonly string[] }>({ owner: null, mints: [] });
  const writeVersion = useRef(0);
  const writer = useRef(createWatchlistWriter(async (value) => {
    const response = await fetch("/api/spot/watchlist", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: value.owner, mints: value.mints }),
    });
    return { ok: response.ok, status: response.status };
  }));

  const save = useCallback((address: string, next: readonly string[]) => {
    const version = ++writeVersion.current;
    setSync("syncing");
    void writer.current({ owner: address, mints: next }).then((response) => {
      if (version === writeVersion.current) setSync(response.ok ? "synced" : response.status === 401 ? "unproven" : "offline");
    }).catch(() => { if (version === writeVersion.current) setSync("offline"); });
  }, [setSync]);

  useEffect(() => {
    const local = readLocal(owner);
    localMints.current = { owner, mints: local };
    setMints(local);
    writeVersion.current += 1;
    merged.current = null;
    setSync(owner ? (proven ? "syncing" : "unproven") : "guest");
  }, [owner, proven, setMints, setSync]);

  useEffect(() => {
    if (!owner || !proven || merged.current === owner) return;
    let live = true;
    const version = writeVersion.current;
    void (async () => {
      const read = await getJson<{ mints: string[] }>(`/api/spot/watchlist?address=${encodeURIComponent(owner)}`);
      if (!live || version !== writeVersion.current) return;
      if (!read.ok) {
        setSync(read.status === 401 ? "unproven" : "offline");
        return;
      }
      merged.current = owner;
      // A click while the initial GET was pending is already saved; do not undo it.
      if (version !== writeVersion.current) return;
      const local = readLocal(owner);
      const union = [...new Set([...read.value.mints, ...local])].slice(-200);
      localMints.current = { owner, mints: union };
      setMints(union);
      writeLocal(owner, union);
      if (union.length !== read.value.mints.length) {
        save(owner, union);
      } else setSync("synced");
    })();
    return () => {
      live = false;
    };
  }, [owner, proven, save, setMints, setSync]);

  const toggle = useCallback(
    (mint: string) => {
      if (!BASE58.test(mint)) return;
      const current = localMints.current.owner === owner ? localMints.current.mints : readLocal(owner);
      const next = current.includes(mint) ? current.filter((entry) => entry !== mint) : [...current, mint].slice(-200);
      localMints.current = { owner, mints: next };
      setMints(next);
      writeLocal(owner, next);
      if (owner && proven) save(owner, next);
      else writeVersion.current += 1;
    },
    [owner, proven, save, setMints],
  );

  const has = useCallback((mint: string) => mints.includes(mint), [mints]);
  return { mints, has, toggle, sync };
}

/* -------------------------------------------------------------- holdings */

export type SpotHolding = Readonly<{
  kind: "NATIVE_SOL" | "TOKEN";
  mint: string | null;
  amountRaw: string;
  spendableRaw: string;
  decimals: number;
  symbol: string | null;
  catalog: Readonly<{ usdPrice: string | null }> | null;
}>;

export type HoldingsState = ReadState<readonly SpotHolding[]> & Readonly<{
  /** True while the last answer covered one token program but not the other. */
  partial?: boolean;
}>;

/**
 * The wallet's balances, re-read on demand (after a fill) and on wallet
 * change; a partial answer — one token program read, the other not — is read
 * again on its own and flagged `partial` until it is whole, so a missing row
 * is never mistaken for an empty balance.
 */
export function useSpotHoldings(owner: string | null, generation: number): HoldingsState {
  const [state, setState] = useScopedRead<HoldingsState>(owner, { status: "loading", value: null });
  useEffect(() => {
    if (!owner) {
      setState({ status: "loading", value: null });
      return;
    }
    const controller = new AbortController();
    setState((current) => ({ status: "loading", value: current.value }));
    void readWalletHoldingsUntilComplete<SpotHolding>({
      owner,
      signal: controller.signal,
      onRead: (read) => {
        if (controller.signal.aborted) return;
        if (!read.ok) {
          setState({ status: "unavailable", value: null, reason: read.reason });
          return;
        }
        setState({ status: "ready", value: read.rows, observedAt: new Date().toISOString(), stale: false, partial: read.tokenRead !== "COMPLETE" });
      },
    });
    return () => controller.abort();
  }, [owner, generation, setState]);
  return state;
}

/* ----------------------------------------------------------------- fills */

export type FillsState = ReadState<readonly SolanaWalletAction[]>;

/** The wallet's Spot fills and swaps touching the selected market, newest first. */
export function useSpotFills(owner: string | null, generation: number): FillsState {
  const [state, setState] = useScopedRead<FillsState>(owner, { status: "loading", value: null });
  useEffect(() => {
    if (!owner) {
      setState({ status: "loading", value: null });
      return;
    }
    let live = true;
    setState((current) => ({ status: "loading", value: current.value }));
    void (async () => {
      try {
        const response = await fetch("/api/solana/activity", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner, network: "mainnet" }),
        });
        const body = (await response.json().catch(() => ({}))) as { data?: { actions?: SolanaWalletAction[] }; error?: { message?: string } };
        if (!live) return;
        if (!response.ok) {
          setState((current) => ({ status: "unavailable", value: current.value, reason: body.error?.message ?? `HTTP ${response.status}` }));
          return;
        }
        const rows = (body.data?.actions ?? []).filter((action) => action.lane === "SWAP");
        setState({ status: "ready", value: rows, observedAt: new Date().toISOString(), stale: false });
      } catch {
        if (!live) return;
        setState((current) => ({ status: "unavailable", value: current.value, reason: "The request did not complete." }));
      }
    })();
    return () => {
      live = false;
    };
  }, [owner, generation, setState]);
  return state;
}

/** The holding of one mint out of the wallet's rows, native SOL included. */
export function useHoldingOf(holdings: HoldingsState, mint: string | null, wrappedSol: string): SpotHolding | null {
  return useMemo(() => {
    if (!mint || !holdings.value) return null;
    if (mint === wrappedSol) return holdings.value.find((row) => row.kind === "NATIVE_SOL") ?? holdings.value.find((row) => row.mint === mint) ?? null;
    return holdings.value.find((row) => row.mint === mint) ?? null;
  }, [holdings, mint, wrappedSol]);
}

/* ------------------------------------------------------ the token page */

export type TokenPart = "overview" | "trades" | "holders" | "risk" | "pools";

/** A part of the token page: its answer, an answer that the part has nothing for this token (`none`), or a failure with its reason. */
export type TokenPartRead<T> =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading"; value: T | null }>
  | Readonly<{ status: "ready"; value: T }>
  | Readonly<{ status: "none"; code: string; reason: string }>
  | Readonly<{ status: "unavailable"; value: T | null; reason: string }>;

const TOKEN_PART_REFRESH_MS: Readonly<Record<TokenPart, number>> = { overview: 60_000, trades: 45_000, holders: 90_000, risk: 120_000, pools: 180_000 };

/**
 * One part of the token page (`/api/spot/token`), read while `active` — a tab
 * reads only when it is open — and refreshed at the part's own cadence while
 * the tab is visible. The last answer stays on screen through a failed
 * refresh, and the failure is said beside it.
 */
export function useTokenPart<T>(mint: string | null, part: TokenPart, active: boolean): TokenPartRead<T> & Readonly<{ retry: () => void }> {
  const [state, setState] = useScopedRead<TokenPartRead<T>>(mint ? `${mint}:${part}` : null, { status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!mint || !active) return;
    let controller = new AbortController();
    const read = () => {
      controller.abort();
      controller = new AbortController();
      setState((current) => (current.status === "ready" ? current : { status: "loading", value: current.status === "unavailable" ? current.value : null }));
      void getJson<T & { none?: { code: string; reason: string } }>(`/api/spot/token?mint=${encodeURIComponent(mint)}&part=${part}`, controller.signal).then((answer) => {
        if (!answer.ok) {
          if (answer.reason === "aborted") return;
          setState((current) => ({ status: "unavailable", value: current.status === "ready" ? current.value : current.status === "loading" || current.status === "unavailable" ? current.value : null, reason: answer.reason }));
          return;
        }
        const body = answer.value;
        if (body.none) setState({ status: "none", code: body.none.code, reason: body.none.reason });
        else setState({ status: "ready", value: body });
      });
    };
    read();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") read();
    }, TOKEN_PART_REFRESH_MS[part]);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [mint, part, active, attempt, setState]);
  return useMemo(() => ({ ...state, retry }), [state, retry]);
}
