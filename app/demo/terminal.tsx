"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { PaperList, PaperTrade } from "@/lib/paper/rpc";
import { applyThemePref, getThemePref, resolveTheme } from "@/app/app/theme";
import { RISK_RULES, assessRisk, type RiskRules } from "@/lib/risk";
import { loadRiskRules } from "@/lib/risk-settings";
import { usMarketOpen } from "@/lib/market-hours";
import { classifyRwaRisk, type RwaRiskLevel } from "@/lib/rwa/risk";
import { PlanCard, type PlanCardStatus, type PlanCardRiskItem, type PlanCardChecklistItem } from "@/app/components/plan-card";
import { Sun, Moon } from "@phosphor-icons/react";
/* The core's tokens, its components (the chart's icon buttons and its screen-reader text) and the chart; not its base,
   which would restyle the workspace's own html and body. */
import "@ryntra/core/tokens.css";
import "@ryntra/core/ui.css";
import "@ryntra/core/chart.css";
import type { ChartLevel, OrderLine, TradingLayerState } from "@ryntra/core/adapters";
import { RyntraChart } from "@ryntra/core/chart";
import { ArcusChartFeed, PRICE_BASIS, onTick, resolutionOf, timeframeOf, type ArcusCandle, type ArcusTimeframe } from "./arcus-chart-source";
import { FLAGS } from "@/app/config/features";
import { createLatestAccountRequestGate } from "@/lib/demo/latest-account-request";

/* Ryntra demo terminal — paper trading on LIVE Arcus public market data.
   No keys, no custody, no real orders. SL/TP are simulated client-side while open. */

type Market = {
  marketDisplayName: string; fullAssetName: string; tickSize: string; stepSize: string; minOrderNotional: string;
  category?: string; fundingRate?: string; nextFundingRate?: string; nextFundingAt?: number;
  oraclePrice?: string; markPrice?: string; initialMarginFraction?: string; offHoursInitialMarginFraction?: string;
  priceChange24h?: string; volume24hNotional?: string; openInterest?: string; lastTradePrice?: string;
  /** Venue fact (RWA markets only): accounts for US holidays/half-days — stronger than our local NYSE estimate. */
  isOutsideRth?: boolean;
};
type Candle = ArcusCandle;

const WS_URL = "wss://api.arcus.xyz/v1/ws";
const CHECKLIST_BASE = ["Trend & structure", "Key levels marked", "Risk & R:R accepted", "News / events checked", "Plan written below"];
const MISTAKES = ["", "FOMO entry", "No plan", "Early exit", "Late entry", "Oversized", "Moved stop", "Revenge trade", "Other"];
/** The core's indicator worker from this site's own file: the page's policy allows no worker from a blob. */
const indicatorWorker = () => new Worker(new URL("../solana/workspace/spot/indicator-worker.ts", import.meta.url), { type: "module" });

const fmtUsd = (n: number) => (n >= 0 ? "+" : "") + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPx = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 8 });

/* ---------- RWA risk monitor helpers ---------- */

/** Arcus fundingRate is an hourly fraction (crypto base 0.0000125/h = 0.01%/8h). */
const fmtFundingHr = (r: number) => `${(r * 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%/h`;
const fmtFundingApr = (r: number) => `${(r * 24 * 365 * 100).toFixed(1)}%`;
const fmtDur = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
};
const fmtPct = (frac?: string) => (frac ? `${(Number(frac) * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%` : "—");
const fmtCompact = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
};
const RWA_RISK_LABEL: Record<RwaRiskLevel, string> = { ok: "OK", caution: "Caution", avoid: "Avoid", unknown: "Partial data" };

/* ---------- live account (read-only, public-by-address Arcus data) ---------- */

type LiveFill = {
  tradeId: string; marketDisplayName: string; side: "BUY" | "SELL"; size: string; price: string;
  fee: string; closedPnl: string; positionEffect: string; createdAt: number; sequenceNumber: number;
};
type LivePosition = {
  marketDisplayName: string; side: "LONG" | "SHORT"; size: string; averageEntryPrice: string;
  unrealizedPnl?: string; markPrice?: string; cumulativeFunding?: { sinceOpen?: string };
};
type LiveOrder = {
  orderId: string; marketDisplayName: string; side: string; type: string; price: string;
  originalSize: string; remainingSize: string; status: string;
};
type LiveNote = { followed_plan: boolean | null; mistake_tag: string | null; lesson: string | null };

function LiveAccount({ wallet }: { wallet: string | null }) {
  const [addr, setAddr] = useState(wallet ?? "");
  const [addrIn, setAddrIn] = useState(wallet ?? "");
  const [data, setData] = useState<{ fills: LiveFill[]; positions: LivePosition[]; orders: LiveOrder[] } | null>(null);
  const [notes, setNotes] = useState<Record<string, LiveNote>>({});
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [dataStale, setDataStale] = useState(false);
  const requestGateRef = useRef<ReturnType<typeof createLatestAccountRequestGate> | null>(null);
  const currentAddressRef = useRef(addr);
  if (!requestGateRef.current) requestGateRef.current = createLatestAccountRequestGate();
  const [draft, setDraft] = useState<Record<string, { followed?: boolean; mistake: string; lesson: string }>>({});
  const isOwn = !!wallet && addr.toLowerCase() === wallet.toLowerCase();

  const load = useCallback(async (a: string, showLoading = true) => {
    const gate = requestGateRef.current!;
    if (a.trim().toLowerCase() !== currentAddressRef.current.trim().toLowerCase()) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(a)) {
      gate.cancel();
      setDataStale(false);
      setData(null);
      setLastLoadedAt(null);
      setErr("Enter a valid 0x… address");
      setLoading(false);
      return;
    }
    const ticket = gate.begin(a);

    if (showLoading) {
      setLoading(true);
      setDataStale(true);
      setErr(null);
    }
    try {
      const r = await fetch(`/api/arcus?kind=account&address=${a}`, { signal: ticket.signal });
      if (!gate.accepts(ticket, currentAddressRef.current)) return;
      if (!r.ok) {
        setErr(`Could not load account data (${r.status}).`);
        setDataStale(true);
        return;
      }
      const nextData = (await r.json()) as { fills: LiveFill[]; positions: LivePosition[]; orders: LiveOrder[] };
      if (!gate.accepts(ticket, currentAddressRef.current)) return;
      setData(nextData);
      setLastLoadedAt(Date.now());
      setDataStale(false);
      setErr(null);
    } catch (error) {
      if (!gate.accepts(ticket, currentAddressRef.current) || (error instanceof Error && error.name === "AbortError")) return;
      setDataStale(true);
      setErr("Network error. Check your connection and retry.");
    } finally {
      if (gate.accepts(ticket, currentAddressRef.current)) setLoading(false);
    }
  }, []);

  useEffect(() => {
    currentAddressRef.current = addr;
    if (!addr) {
      requestGateRef.current?.cancel();
      return;
    }
    void load(addr);
    const t = setInterval(() => void load(addr, false), 8000);
    return () => {
      clearInterval(t);
      requestGateRef.current?.cancel();
    };
  }, [addr, load]);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/live");
        if (r.ok) setNotes((await r.json()) as Record<string, LiveNote>);
      } catch { /* notes stay empty */ }
    })();
  }, []);

  const saveNote = async (f: LiveFill) => {
    const d = draft[f.tradeId];
    if (!d) return;
    const r = await fetch("/api/live", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tradeId: f.tradeId, market: f.marketDisplayName, side: f.side,
        pnl: Number(f.closedPnl || 0), followed: d.followed ?? null, mistake: d.mistake || null, lesson: d.lesson || null,
      }),
    });
    if (r.ok) {
      const saved = (await r.json()) as LiveNote;
      setNotes((n) => ({ ...n, [f.tradeId]: saved }));
    }
  };

  const now = Date.now() * 1000;
  const closes = (data?.fills ?? []).filter((f) => f.positionEffect?.startsWith("CLOSE"));
  const pnl24 = closes.filter((f) => now - f.createdAt < 24 * 3600 * 1e6).reduce((s, f) => s + Number(f.closedPnl || 0), 0);
  const pnl7d = closes.filter((f) => now - f.createdAt < 7 * 24 * 3600 * 1e6).reduce((s, f) => s + Number(f.closedPnl || 0), 0);
  const fees7d = (data?.fills ?? []).filter((f) => now - f.createdAt < 7 * 24 * 3600 * 1e6).reduce((s, f) => s + Number(f.fee || 0), 0);

  return (
    <section className="dm-live-wrap">
      <div className="dm-live-head">
        <span className="dm-live-title">Live Arcus account · read-only</span>
        <div className="dm-live-addr">
          <input value={addrIn} onChange={(e) => setAddrIn(e.target.value.trim())} placeholder="0x… wallet address" aria-label="Wallet address to inspect" spellCheck={false} />
          <button
            className="dm-close"
            disabled={loading}
            aria-busy={loading}
            onClick={() => {
              requestGateRef.current?.cancel();
              setDataStale(false);
              setData(null);
              setLastLoadedAt(null);
              setErr(null);
              const nextAddress = addrIn.trim();
              currentAddressRef.current = nextAddress;
              if (!/^0x[a-fA-F0-9]{40}$/.test(nextAddress)) {
                setAddr(nextAddress);
                void load(nextAddress);
                return;
              }
              setLoading(true);
              if (addr.toLowerCase() === nextAddress.toLowerCase()) void load(nextAddress);
              else setAddr(nextAddress);
            }}
          >
            {loading ? "Loading…" : "Load"}
          </button>
        </div>
        {isOwn ? <span className="dm-live dm-live-live">your address · alerts on</span> : addr ? <span className="dm-live dm-live-connecting">view-only</span> : null}
      </div>
      {err ? (
        <div className="dm-error-state" role="alert">
          <p className="dm-err">{err}</p>
          {/^0x[a-fA-F0-9]{40}$/.test(addr) ? (
            <button className="dm-close" disabled={loading} onClick={() => void load(addr)}>
              {loading ? "Retrying…" : "Retry"}
            </button>
          ) : null}
        </div>
      ) : null}
      {data && dataStale ? (
        <p className="dm-stale-state" role="status">
          Showing the last successful account response from{" "}
          {lastLoadedAt ? <time dateTime={new Date(lastLoadedAt).toISOString()}>{new Date(lastLoadedAt).toLocaleTimeString("en-GB")}</time> : "an earlier refresh"}.
          {" "}A refresh failed; these values are stale until retry succeeds.
        </p>
      ) : null}
      {!addr && !wallet ? (
        <p className="dm-empty">Submit your wallet in @RyntraBeta_bot (step 2) to auto-connect your account, or paste any address above to view it. No keys, ever — this layer is read-only public data.</p>
      ) : null}

      {data ? (
        <>
          <div className="dm-live-stats">
            <div><span>Realized PnL 24h</span><b className={pnl24 >= 0 ? "dm-long" : "dm-short"}>{fmtUsd(pnl24)}</b></div>
            <div><span>Realized PnL 7d</span><b className={pnl7d >= 0 ? "dm-long" : "dm-short"}>{fmtUsd(pnl7d)}</b></div>
            <div><span>Fees 7d</span><b>${fees7d.toFixed(2)}</b></div>
            <div><span>Open positions</span><b>{data.positions.length}</b></div>
          </div>

          <h3 className="dm-live-h">Positions</h3>
          {data.positions.length === 0 ? <p className="dm-empty">No open positions on this address.</p> : (
            <div className="dm-table-wrap">
              <table className="dm-table">
                <thead><tr><th>Market</th><th>Side</th><th>Size</th><th>Avg entry</th><th>uPnL</th><th>Funding since open</th></tr></thead>
                <tbody>
                  {data.positions.map((p, i) => (
                    <tr key={i}>
                      <td>{p.marketDisplayName}</td>
                      <td className={p.side === "LONG" ? "dm-long" : "dm-short"}>{p.side}</td>
                      <td>{Math.abs(Number(p.size)).toLocaleString("en-US", { maximumFractionDigits: 6 })}</td>
                      <td>{fmtPx(Number(p.averageEntryPrice))}</td>
                      <td className={p.unrealizedPnl == null ? "" : Number(p.unrealizedPnl) >= 0 ? "dm-long" : "dm-short"}>{p.unrealizedPnl != null ? fmtUsd(Number(p.unrealizedPnl)) : "—"}</td>
                      <td>{p.cumulativeFunding?.sinceOpen != null ? fmtUsd(Number(p.cumulativeFunding.sinceOpen)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="dm-live-h">Open orders</h3>
          {data.orders.length === 0 ? <p className="dm-empty">No open orders.</p> : (
            <div className="dm-table-wrap">
              <table className="dm-table">
                <thead><tr><th>Market</th><th>Side</th><th>Type</th><th>Price</th><th>Remaining</th></tr></thead>
                <tbody>
                  {data.orders.map((o) => (
                    <tr key={o.orderId}>
                      <td>{o.marketDisplayName}</td>
                      <td className={o.side === "BUY" ? "dm-long" : "dm-short"}>{o.side}</td>
                      <td>{o.type}</td>
                      <td>{fmtPx(Number(o.price))}</td>
                      <td>{o.remainingSize}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="dm-live-h">Recent fills{isOwn ? " · add journal notes" : ""}</h3>
          <div className="dm-journal">
            {(data.fills ?? []).length === 0 ? (
              <p className="dm-empty">No fills on this address yet. Trades on your connected Arcus account show up here automatically — read-only public data, no keys.</p>
            ) : null}
            {(data.fills ?? []).slice(0, 25).map((f) => {
              const pnl = Number(f.closedPnl || 0);
              const isClose = f.positionEffect?.startsWith("CLOSE");
              const note = notes[f.tradeId];
              const d = draft[f.tradeId] ?? { followed: note?.followed_plan ?? undefined, mistake: note?.mistake_tag ?? "", lesson: note?.lesson ?? "" };
              const fillTime = new Date(f.createdAt / 1000).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
              const status: PlanCardStatus = !isClose ? "next" : note?.followed_plan === true ? "ready" : note?.followed_plan === false ? "caution" : "next";
              const statusLabel = !isClose ? "Open" : note?.followed_plan === true ? "Followed plan" : note?.followed_plan === false ? "Plan broken" : "Review needed";
              const riskItems: PlanCardRiskItem[] = [
                { label: "Side", value: f.side, mono: false, tone: "neutral" },
                { label: "Size @ price", value: `${f.size} @ ${fmtPx(Number(f.price))}` },
                { label: "Effect", value: f.positionEffect?.replaceAll("_", " ") || "FILL", mono: false, tone: "neutral" },
                ...(isClose ? [{ label: "Realized PnL", value: fmtUsd(pnl), tone: (pnl >= 0 ? "ok" : "danger") as PlanCardRiskItem["tone"] }] : []),
              ];
              return (
                <PlanCard
                  key={f.tradeId + f.sequenceNumber}
                  className="dm-jplan"
                  eyebrow="Live account fill"
                  title={f.marketDisplayName}
                  mode="Live"
                  status={status}
                  statusLabel={statusLabel}
                  instrument={fillTime}
                  riskItems={riskItems}
                  footerNote="Live account fill · read-only import. Journal notes never place orders."
                >
                  {isOwn && isClose ? (
                    <div className="dm-jform">
                      <span>Followed plan?</span>
                      <button className={d.followed === true ? "on" : ""} onClick={() => setDraft((j) => ({ ...j, [f.tradeId]: { ...d, followed: true } }))}>Yes</button>
                      <button className={d.followed === false ? "on dm-no" : ""} onClick={() => setDraft((j) => ({ ...j, [f.tradeId]: { ...d, followed: false } }))}>No</button>
                      <select value={d.mistake} onChange={(e) => setDraft((j) => ({ ...j, [f.tradeId]: { ...d, mistake: e.target.value } }))}>
                        {MISTAKES.map((m) => <option key={m} value={m}>{m || "mistake tag…"}</option>)}
                      </select>
                      <input placeholder="lesson" maxLength={300} value={d.lesson} onChange={(e) => setDraft((j) => ({ ...j, [f.tradeId]: { ...d, lesson: e.target.value } }))} />
                      <button className="dm-save" onClick={() => void saveNote(f)}>{note ? "Update" : "Save"}</button>
                    </div>
                  ) : undefined}
                </PlanCard>
              );
            })}
          </div>
        </>
      ) : loading && addr ? <p className="dm-empty" role="status">Loading account data…</p> : null}
    </section>
  );
}

/**
 * `visitor` is read-only, and it is read-only at the *request* level rather
 * than by hiding buttons. Nothing in this component calls `/api/paper` when it
 * is set, so there is no state to lose and no request to reject — the account
 * boundary is still enforced by the route, which reads the session exactly as
 * it always did.
 */
export function DemoTerminal({
  name,
  wallet,
  embedded = false,
  visitor = false,
}: {
  name: string;
  wallet: string | null;
  embedded?: boolean;
  visitor?: boolean;
}) {
  const [markets, setMarkets] = useState<Market[]>([]);
  /* The market list answered — or did not: the chart opens on the venue's steps, or on the fallback ones. */
  const [marketsRead, setMarketsRead] = useState(false);
  const [market, setMarket] = useState("BTC-USD");
  const [tf, setTf] = useState<ArcusTimeframe>("1m");
  const [price, setPrice] = useState<number | null>(null);
  const [bbo, setBbo] = useState<{ bid: number | null; ask: number | null }>({ bid: null, ask: null });
  const [wsState, setWsState] = useState<"connecting" | "live" | "down">("connecting");
  const [feeFrac, setFeeFrac] = useState(0.00045);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // ticket
  const [side, setSide] = useState<"long" | "short">("long");
  const [entryMode, setEntryMode] = useState<"market" | "limit">("market");
  const [entryIn, setEntryIn] = useState("");
  const [sizeIn, setSizeIn] = useState("");
  const [slIn, setSlIn] = useState("");
  const [tpIn, setTpIn] = useState("");
  const [checks, setChecks] = useState<boolean[]>(CHECKLIST_BASE.map(() => false));
  const [reason, setReason] = useState("");
  const [placing, setPlacing] = useState(false);
  const [ticketErr, setTicketErr] = useState<string | null>(null);
  const [riskAck, setRiskAck] = useState(false);
  const [ticketTab, setTicketTab] = useState<"order" | "risk" | "plan">("order");
  const [riskRules, setRiskRules] = useState<RiskRules>(RISK_RULES);

  // portfolio
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [list, setList] = useState<PaperList | null>(null);
  const [tab, setTab] = useState<"positions" | "journal">("positions");
  const [journalDraft, setJournalDraft] = useState<Record<string, { followed?: boolean; mistake: string; lesson: string }>>({});

  /* One chart feed a market (`arcus-chart-source.ts`, SOL-T4): the REST read and the stream's candles go in, the
     core's chart listens. The venue's steps come with the market list, which may arrive after the chart opened. */
  const [held, setHeld] = useState<Readonly<{ market: string; feed: ArcusChartFeed }> | null>(null);
  const closingRef = useRef<Set<string>>(new Set());
  const priceRef = useRef<number | null>(null);
  const listRef = useRef<PaperList | null>(null);
  listRef.current = list;
  priceRef.current = price;

  const api = useCallback(
    async (payload: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> => {
      try {
        const r = await fetch("/api/paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = (await r.json()) as { error?: string };
        return r.ok ? { ok: true, data: j } : { ok: false, error: j.error ?? "request failed" };
      } catch {
        return { ok: false, error: "network error" };
      }
    },
    []
  );

  const refreshList = useCallback(async () => {
    /* A visitor has no paper account, so this is not a request that would fail
       — it is a request with no subject. Skipping it keeps a 401 out of the
       console on a page that is working exactly as intended. */
    if (visitor) return;
    try {
      const r = await fetch("/api/paper");
      if (r.ok) setList((await r.json()) as PaperList);
    } catch { /* keep last */ }
  }, [visitor]);

  /* ---------- bootstrap: markets, fees, portfolio ---------- */
  useEffect(() => {
    let alive = true;
    const loadMarkets = async () => {
      try {
        const r = await fetch("/api/arcus?kind=markets");
        const j = (await r.json()) as { markets: Market[] };
        if (alive && j.markets?.length) setMarkets(j.markets);
      } catch { /* selector stays with default */ }
      if (alive) setMarketsRead(true);
    };
    void loadMarkets();
    // periodic refresh keeps funding / oracle fields in the risk monitor current
    const t = setInterval(() => void loadMarkets(), 120_000);
    void (async () => {
      try {
        const r = await fetch("/api/arcus?kind=fees");
        const j = (await r.json()) as { takerFeeFraction: number };
        if (alive && j.takerFeeFraction > 0) setFeeFrac(j.takerFeeFraction);
      } catch { /* fallback stays */ }
    })();
    void refreshList();
    return () => { alive = false; clearInterval(t); };
  }, [refreshList]);

  /* ---------- risk monitor clock (off-hours + funding countdown) ---------- */
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  /* ---------- appearance + device-local prefs ---------- */
  useEffect(() => {
    setRiskRules(loadRiskRules());
    const resolved = resolveTheme(getThemePref());
    setTheme(resolved);
    document.documentElement.setAttribute("data-theme", resolved);
  }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyThemePref(next);
  };
  const listed = markets.find((m) => m.marketDisplayName === market) ?? null;
  const tickSize = listed?.tickSize ?? null;
  const stepSize = listed?.stepSize ?? null;
  const minNotional = listed?.minOrderNotional ?? null;
  /* One feed a market, made once the market list has answered: the chart opens on the venue's own steps and is not
     opened a second time when they arrive. */
  useEffect(() => {
    if (!marketsRead) return;
    const next = new ArcusChartFeed({ market, tick: tickSize ?? "0.01", lot: stepSize ?? "0.0001", minNotional });
    setHeld({ market, feed: next });
    return () => next.dispose();
  }, [market, marketsRead, tickSize, stepSize, minNotional]);
  const feed = held && held.market === market ? held.feed : null;
  /* The stream reaches the feed through a ref: a new feed (the market list brought the venue's steps) keeps the connection. */
  const feedRef = useRef<ArcusChartFeed | null>(null);
  feedRef.current = feed;
  /* seed candles on market/tf change (the feed keeps every interval it was given; the chart asks it) */
  useEffect(() => {
    if (!feed) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/arcus?kind=candles&market=${market}&tf=${tf}`);
        const j = (await r.json()) as { candles: Candle[] };
        if (!cancelled && j.candles) feed.put(tf, j.candles);
      } catch { /* chart stays empty until WS fills */ }
    })();
    return () => { cancelled = true; };
  }, [feed, market, tf]);

  /* reset price on market switch so the SL/TP simulator never evaluates the new market's
     trades against the previous market's last price (would fire false auto-closes); reset bbo
     for the same reason — a carried-over book would feed spread/one-sided signals measured on
     the PREVIOUS market into the new market's risk verdict during the WS reconnect window */
  useEffect(() => {
    setPrice(null);
    priceRef.current = null;
    setBbo({ bid: null, ask: null });
  }, [market]);

  /* ---------- live data (WS) ---------- */
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    /* The candles channel answered on this connection: from then on any frame says the chart's stream works. */
    let candlesFlowing = false;

    // if the exchange rejects the CANDLES subscription (e.g. an unsupported tf), keep the chart moving via REST
    const startPollFallback = () => {
      if (poll) return;
      poll = setInterval(() => {
        void fetch(`/api/arcus?kind=candles&market=${market}&tf=${tf}`)
          .then((r) => r.json())
          .then((j: { candles?: Candle[] }) => {
            if (!closed && j.candles) feedRef.current?.put(tf, j.candles);
          })
          .catch(() => { /* next tick retries */ });
      }, 30_000);
    };
    const stopPollFallback = () => {
      if (poll) { clearInterval(poll); poll = null; }
    };

    const connect = () => {
      setWsState("connecting");
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        candlesFlowing = false;
        setWsState("live");
        ws?.send(JSON.stringify({ type: "subscribe", channel: "bbo", id: market }));
        ws?.send(JSON.stringify({ type: "subscribe", channel: "candles", id: `${market}/${tf}` }));
      };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(String(e.data)) as { type: string; channel?: string; contents?: unknown };
          if (m.type === "error") {
            // only a candles-subscription rejection warrants the REST fallback — a bbo/transient
            // error must not shadow a healthy live stream with lagging snapshots
            if (String(e.data).includes("candles")) {
              candlesFlowing = false;
              startPollFallback();
            }
            return;
          }
          if (candlesFlowing && !poll) feedRef.current?.alive();
          if (m.channel === "bbo" && m.contents) {
            const c = m.contents as { bestBid?: { price: string } | null; bestAsk?: { price: string } | null };
            const bid = c.bestBid ? Number(c.bestBid.price) : null;
            const ask = c.bestAsk ? Number(c.bestAsk.price) : null;
            const mid = bid && ask ? (bid + ask) / 2 : bid ?? ask;
            if (mid) setPrice(mid);
            setBbo({ bid, ask });
          } else if (m.channel === "candles" && m.contents) {
            stopPollFallback(); // the channel is healthy — a live frame beats the REST fallback
            candlesFlowing = true;
            const c = m.contents as { candles?: Candle[]; isSnapshot?: boolean } & Candle;
            if (c.candles) {
              feedRef.current?.put(tf, c.candles);
              feedRef.current?.alive();
            } else if (c.openTime) {
              feedRef.current?.tick(tf, c);
              const px = Number(c.close);
              if (px > 0) setPrice((p) => p ?? px);
            }
          }
        } catch { /* ignore malformed frame */ }
      };
      ws.onclose = () => {
        if (closed) return;
        candlesFlowing = false;
        feedRef.current?.down();
        setWsState("down");
        retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (poll) clearInterval(poll);
      ws?.close();
      /* The next interval's stream has not answered yet: the chart is not live until it does. */
      feedRef.current?.down();
    };
  }, [market, tf]);

  /* ---------- SL/TP simulation while terminal is open ---------- */
  useEffect(() => {
    if (!price || !list) return;
    for (const tr of list.open) {
      if (tr.market !== market) continue; // only simulate the streamed market
      if (closingRef.current.has(tr.id)) continue;
      const sl = tr.sl ? Number(tr.sl) : null;
      const tp = tr.tp ? Number(tr.tp) : null;
      let hit: "sl" | "tp" | null = null;
      if (tr.side === "long") {
        if (sl && price <= sl) hit = "sl";
        else if (tp && price >= tp) hit = "tp";
      } else {
        if (sl && price >= sl) hit = "sl";
        else if (tp && price <= tp) hit = "tp";
      }
      if (hit) {
        closingRef.current.add(tr.id);
        const exitPx = hit === "sl" ? (sl as number) : (tp as number);
        void api({ action: "close", tradeId: tr.id, exit: exitPx, reason: hit }).then(async (r) => {
          if (r.ok) {
            // hold the guard until the refreshed list (without this trade) has landed, so
            // the sub-second BBO ticks in between don't fire a duplicate close on stale state
            await refreshList();
            closingRef.current.delete(tr.id);
          } else {
            // keep a cooldown so a persistent failure does not retry on every tick
            setTimeout(() => closingRef.current.delete(tr.id), 30_000);
            void refreshList();
          }
        });
      }
    }
  }, [price, list, market, api, refreshList]);

  /* ---------- price lines: ticket plan + open trades on this market ---------- */
  const entry = entryMode === "market" ? price ?? 0 : Number(entryIn) || 0;
  const size = Number(sizeIn) || 0;
  const sl = Number(slIn) || 0;
  const tp = Number(tpIn) || 0;

  /* The open trades on this market as levels on the core's chart: their lines are shown, never dragged. */
  const levels = useMemo<ChartLevel[]>(() => {
    if (!feed) return [];
    const step = feed.instrument.tick;
    const out: ChartLevel[] = [];
    const add = (id: string, at: number, label: string) => {
      if (at > 0) out.push({ id, kind: "level", price: onTick(at, step), basis: PRICE_BASIS, label });
    };
    for (const tr of list?.open ?? []) {
      if (tr.market !== market) continue;
      add(`${tr.id}-entry`, Number(tr.entry_price), `${tr.side} entry`);
      if (tr.sl) add(`${tr.id}-sl`, Number(tr.sl), "SL");
      if (tr.tp) add(`${tr.id}-tp`, Number(tr.tp), "TP");
    }
    return out;
  }, [feed, list, market]);

  /* The ticket's plan as the draft lines of the core's trading layer — drag a line to set the ticket input, or type
     to move the line. Entry is a line only in limit mode (a market entry follows the live price). The layer moves a
     draft only on live data, sends nothing, and never drafts an order of its own here: this terminal is paper. */
  const trading = useMemo<TradingLayerState | null>(() => {
    if (!feed) return null;
    const instrument = feed.instrument;
    const step = instrument.tick;
    const opens = side === "long" ? "buy" : "sell";
    const closes = side === "long" ? "sell" : "buy";
    const amount = size > 0 ? String(size) : "0";
    const line = (id: string, role: OrderLine["role"], lineSide: "buy" | "sell", at: number, trigger: boolean, leg: number): OrderLine => ({
      id, role, state: "draft", side: lineSide, price: onTick(at, step), trigger: trigger ? onTick(at, step) : null,
      trigger_kind: trigger ? "last" : null, size: amount, remaining: amount, reduce_only: trigger, tif: null, intent_id: null, leg, refusal: null,
    });
    const lines: OrderLine[] = [];
    if (entryMode !== "market" && entry > 0 && (sl > 0 || tp > 0)) lines.push(line("plan-entry", "limit", opens, entry, false, 0));
    if (tp > 0) lines.push(line("plan-tp", "take_profit", closes, tp, true, 1));
    if (sl > 0) lines.push(line("plan-sl", "stop_loss", closes, sl, true, 2));
    const mid = bbo.bid && bbo.ask ? (bbo.bid + bbo.ask) / 2 : null;
    return {
      instrument,
      view: PRICE_BASIS,
      lines,
      position: null,
      tradable: true,
      not_tradable_reason: null,
      armed: false,
      prices: mid ? { mid: onTick(mid, step) } : price ? { last: onTick(price, step) } : {},
      fee_rate: feeFrac > 0 && feeFrac < 1 ? feeFrac.toFixed(8).replace(/0+$/, "").replace(/\.$/, "") : undefined,
    };
  }, [feed, side, size, entryMode, entry, sl, tp, bbo, price, feeFrac]);

  const chartMarks = useMemo(() => ({ view: PRICE_BASIS, marks: [], levels }), [levels]);

  const onDraftMove = (id: string, at: string): void => {
    if (id === "plan-sl") setSlIn(at);
    else if (id === "plan-tp") setTpIn(at);
    else if (id === "plan-entry") setEntryIn(at);
  };

  /* ---------- ticket math ---------- */
  const notional = entry * size;
  const riskPerUnit = sl > 0 && entry > 0 ? Math.abs(entry - sl) : 0;
  const feesEst = notional * feeFrac * 2;
  const maxLoss = riskPerUnit * size + feesEst;
  const rr = riskPerUnit > 0 && tp > 0 ? Math.abs(tp - entry) / riskPerUnit : null;
  const slSideOk = sl > 0 && entry > 0 && (side === "long" ? sl < entry : sl > entry);
  const tpSideOk = tp === 0 || (entry > 0 && (side === "long" ? tp > entry : tp < entry));
  const reasonOk = reason.trim().length >= 10;

  /* ---------- RWA risk monitor: funding, off-hours regime, price-band distance ---------- */
  const mInfo = useMemo(() => markets.find((m) => m.marketDisplayName === market) ?? null, [markets, market]);
  const isRwa = !!mInfo?.category && mInfo.category !== "CRYPTO";
  /* item 4 is market-aware; length stays CHECKLIST_BASE.length so checks state + journal denominators are stable */
  const checklist = useMemo(() => {
    const c = [...CHECKLIST_BASE];
    c[3] = isRwa ? "News / events checked" : "Market conditions checked";
    return c;
  }, [isRwa]);
  const usOpenLocal = useMemo(() => usMarketOpen(new Date(clock)), [clock]);
  /* prefer the venue's isOutsideRth fact when present; local NYSE clock stays as fallback.
     Copy keeps the conservative "(est.)" qualifier either way. */
  const usOpen = mInfo?.isOutsideRth != null ? !mInfo.isOutsideRth : usOpenLocal;
  const offHours = isRwa && !usOpen;
  const fundingHr = mInfo?.fundingRate != null ? Number(mInfo.fundingRate) : null;
  const nextFundingMs = mInfo?.nextFundingAt ? mInfo.nextFundingAt * 1000 - clock : null;
  const oracle = mInfo?.oraclePrice ? Number(mInfo.oraclePrice) : null;
  const entryDevPct = oracle && entryMode === "limit" && entry > 0 ? ((entry - oracle) / oracle) * 100 : null;
  const bandWarn = offHours && entryDevPct != null && Math.abs(entryDevPct) > 2;

  /* ---------- Risk Guard v1: per-trade risk, daily loss limit, loss-streak cooldown ---------- */
  const risk = useMemo(
    () => assessRisk({
      maxLoss: maxLoss > 0 && slSideOk ? maxLoss : null,
      balance: list?.stats.balance ?? RISK_RULES.baseBalance,
      closed: list?.closed ?? [],
      offHours,
    }, riskRules),
    [maxLoss, slSideOk, list, offHours, riskRules]
  );
  const canPlace =
    entry > 0 && size > 0 && slSideOk && tpSideOk && reasonOk && !placing && notional >= 5 &&
    (!risk.ackRequired || riskAck);
  /* tab attention dots: "this tab blocks the button / needs a look" */
  const riskDot = risk.overRisk || (risk.ackRequired && !riskAck);
  const planDot = !reasonOk;
  /* the disabled button says WHY — mirrors canPlace clause by clause */
  const gateLabel =
    placing ? "Placing…"
    : entry <= 0 ? (entryMode === "limit" ? "Enter entry price" : "Waiting for live price")
    : size <= 0 ? "Enter size"
    : notional < 5 ? "Min order: $5 notional"
    : !slSideOk ? "Set stop-loss to continue"
    : !tpSideOk ? "Fix take-profit side"
    : !reasonOk ? "Write your plan to continue"
    : risk.ackRequired && !riskAck ? "Acknowledge risk (Risk tab)"
    : `Place paper ${side === "long" ? "buy" : "sell"}`;

  /* market stats for the selected instrument (all from the markets payload) */
  const chg24 = mInfo?.priceChange24h != null ? Number(mInfo.priceChange24h) * 100 : null;
  const mark = mInfo?.markPrice ? Number(mInfo.markPrice) : null;
  const spread = bbo.bid != null && bbo.ask != null ? bbo.ask - bbo.bid : null;
  const spreadBps = spread != null && bbo.ask ? (spread / bbo.ask) * 10000 : null;
  /* one-sided book (#15): exactly one side missing = warning; both missing = no data yet (null,
     indistinguishable from an empty book over WS — fail toward "unknown", not a false alarm) */
  const bookOneSided = bbo.bid == null && bbo.ask == null ? null : (bbo.bid == null) !== (bbo.ask == null);

  /* ---------- RWA risk verdict (lib/rwa/risk) — measured signals only; oracle/sequencer
     freshness checks are not connected yet, so the verdict never claims more than we know */
  const rwaVerdict = useMemo(
    () => classifyRwaRisk({
      symbol: market,
      assetType: mInfo == null ? "unknown" : isRwa ? "equity-perp" : "crypto",
      marketOpen: isRwa ? usOpen : null,
      offHours,
      oracleFresh: null,
      oraclePaused: null,
      sequencerUp: null,
      spreadBps,
      premiumPct: null, // perps price vs oracle is a different signal (mark-price basis) — not wired yet
      bookOneSided,
      fundingRateHourly: fundingHr,
      initialMarginFraction: mInfo?.initialMarginFraction ? Number(mInfo.initialMarginFraction) : null,
      offHoursInitialMarginFraction: mInfo?.offHoursInitialMarginFraction ? Number(mInfo.offHoursInitialMarginFraction) : null,
      corporateAction: isRwa ? "unknown" : "none",
    }),
    [market, mInfo, isRwa, usOpen, offHours, spreadBps, bookOneSided, fundingHr]
  );

  /* ---------- canonical Plan Card summary (drives the Plan tab header) ---------- */
  const planStatus: PlanCardStatus =
    canPlace ? "ready"
    : (!(entry > 0) || !(size > 0) || notional < 5 || !slSideOk || !tpSideOk || !reasonOk) ? "blocked"
    : "caution";
  const planStatusLabel = planStatus === "ready" ? "Ready" : planStatus === "blocked" ? "Incomplete" : "Caution";
  const planRiskItems: PlanCardRiskItem[] = [
    slSideOk
      ? { label: "Max risk", value: risk.riskPct != null ? `${risk.riskPct.toFixed(2)}% · -$${maxLoss.toFixed(2)}` : `-$${maxLoss.toFixed(2)}`, tone: risk.overRisk ? "danger" : "ok" }
      : { label: "Stop-loss", value: "Not set", tone: "danger" },
    { label: "R : R", value: rr ? rr.toFixed(2) : "—", tone: rr != null && rr >= 1.5 ? "ok" : "neutral" },
    ...(isRwa
      ? [{ label: "Market", value: offHours ? "Off-hours (est.)" : "Regular hrs (est.)", tone: (offHours ? "warning" : "ok") as PlanCardRiskItem["tone"] }]
      : fundingHr != null
        ? [{ label: "Funding", value: fmtFundingHr(fundingHr), tone: "neutral" as PlanCardRiskItem["tone"] }]
        : []),
    ...(isRwa ? [{ label: "Oracle", value: "Not evaluated · paper scope", tone: "neutral" as PlanCardRiskItem["tone"] }] : []),
  ];
  const planChecklist: PlanCardChecklistItem[] = [
    { label: "Entry reason written", done: reasonOk, required: true },
    { label: "Stop-loss set", done: slSideOk, required: true },
    { label: "Risk within your rule", done: !risk.overRisk },
    ...(offHours ? [{ label: "Off-hours acknowledged", done: !risk.ackRequired || riskAck, required: risk.ackRequired }] : []),
  ];


  const place = async () => {
    setTicketErr(null);
    setPlacing(true);
    const r = await api({
      action: "open", market, side, entry, size, sl, tp: tp > 0 ? tp : null,
      checklist: checklist.map((item, i) => ({ item, checked: checks[i] })),
      reason: reason.trim(),
      riskAck,
      // enforcement uses the rules from THIS request (server clamps) — client UI and server always agree
      rules: { maxRiskPctWarn: riskRules.maxRiskPctWarn, dailyLossLimitPct: riskRules.dailyLossLimitPct, lossStreak: riskRules.lossStreak },
    });
    setPlacing(false);
    if (!r.ok) {
      setTicketErr(r.error ?? "failed");
      // deliberate switch on the user's own click — surfaces the ack checkbox after a server risk-guard 422
      if (r.error?.startsWith("risk guard")) setTicketTab("risk");
      return;
    }
    setReason(""); setChecks(CHECKLIST_BASE.map(() => false)); setSizeIn(""); setSlIn(""); setTpIn("");
    setRiskAck(false);
    void refreshList();
  };

  const closeManual = async (tr: PaperTrade) => {
    const px = priceRef.current;
    if (!px || tr.market !== market) return;
    closingRef.current.add(tr.id);
    await api({ action: "close", tradeId: tr.id, exit: px, reason: "manual" });
    closingRef.current.delete(tr.id);
    void refreshList();
  };

  const saveJournal = async (tr: PaperTrade) => {
    const d = journalDraft[tr.id];
    if (!d) return;
    await api({ action: "journal", tradeId: tr.id, followed: d.followed ?? null, mistake: d.mistake || null, lesson: d.lesson || null });
    setJournalDraft((j) => ({ ...j, [tr.id]: { ...d } }));
    void refreshList();
  };

  const unrealized = (tr: PaperTrade): number | null => {
    if (tr.market !== market || !price) return null;
    const dir = tr.side === "long" ? 1 : -1;
    return (price - Number(tr.entry_price)) * Number(tr.size) * dir - Number(tr.fees);
  };

  const stats = list?.stats;

  return (
    <div className={`dm-root${embedded ? " dm-embedded" : ""}`} translate="no">
      {/* top bar */}
      <header className="dm-top">
        {embedded ? (
          <span className="dm-paper-badge">PAPER</span>
        ) : (
          <Link href="/" className="dm-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={22} height={22} />
            <b>Ryntra</b>
            <span className="dm-paper-badge">PAPER</span>
          </Link>
        )}
        <div className="dm-market">
          <select value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Market">
            {(markets.length ? markets : [{ marketDisplayName: market, fullAssetName: "" } as Market]).map((m) => (
              <option key={m.marketDisplayName} value={m.marketDisplayName}>{m.marketDisplayName}{m.fullAssetName ? ` · ${m.fullAssetName}` : ""}</option>
            ))}
          </select>
          <span className={`dm-price ${wsState}`}>{price ? fmtPx(price) : "…"}</span>
          {chg24 != null ? <span className={`dm-chg ${chg24 >= 0 ? "dm-long" : "dm-short"}`}>{chg24 >= 0 ? "+" : ""}{chg24.toFixed(2)}%</span> : null}
          <span className={`dm-live dm-live-${wsState}`}>{wsState === "live" ? "live" : wsState === "connecting" ? "connecting" : "reconnecting"}</span>
        </div>
        <div className="dm-actions">
          <span className="dm-balance" title="Paper balance">{stats ? `$${stats.balance.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "$10,000"}</span>
          {/* Inside the workspace the shell owns the top bar and the cabinet
              already carries a theme control; a second one in the canvas is how
              one product starts reading as two. Standalone still needs its own. */}
          {embedded ? null : (
            <button className="dm-theme" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === "dark" ? <Sun size={15} weight="bold" /> : <Moon size={15} weight="bold" />}
            </button>
          )}
          {embedded ? null : <span className="dm-hello">{name}</span>}
        </div>
      </header>

      {/* market stats sub-strip */}
      <div className="dm-substrip">
        <div className="dm-stat"><span>Mark</span><b>{mark != null ? fmtPx(mark) : "—"}</b></div>
        <div className="dm-stat"><span>Oracle</span><b>{oracle != null ? fmtPx(oracle) : "—"}</b></div>
        <div className="dm-stat"><span>Bid / Ask</span><b>{bbo.bid != null ? fmtPx(bbo.bid) : "—"} / {bbo.ask != null ? fmtPx(bbo.ask) : "—"}</b></div>
        <div className="dm-stat"><span>Spread</span><b>{spreadBps != null ? `${spreadBps.toFixed(1)} bps` : "—"}</b></div>
        <div className="dm-stat"><span>24h vol</span><b>{mInfo?.volume24hNotional ? `$${fmtCompact(Number(mInfo.volume24hNotional))}` : "—"}</b></div>
        <div className="dm-stat"><span>Open interest</span><b>{mInfo?.openInterest ? fmtCompact(Number(mInfo.openInterest)) : "—"}</b></div>
        {fundingHr != null ? (
          <div className="dm-stat" title={`≈ ${fmtFundingApr(fundingHr)} annualized · ${fundingHr > 0 ? "longs pay shorts" : fundingHr < 0 ? "shorts pay longs" : "flat"}`}>
            <span>Funding{nextFundingMs != null && nextFundingMs > 0 ? " · next" : ""}</span>
            <b className={fundingHr > 0 ? "dm-short" : fundingHr < 0 ? "dm-long" : ""}>
              {fmtFundingHr(fundingHr)}{nextFundingMs != null && nextFundingMs > 0 ? <span className="dm-stat-sub"> {fmtDur(nextFundingMs)}</span> : null}
            </b>
          </div>
        ) : null}
        {isRwa ? (
          <span
            className={`dm-risk-badge${offHours ? " off" : ""}`}
            title={offHours
              ? "Underlying US market likely closed (estimated from NYSE regular hours — Arcus applies its own calendar incl. holidays/half-days). Off-hours regime: funding fixed near SOFR+0.5% APR, higher initial margin, price bands."
              : "Real-world-asset perp. Regular US hours (estimated). Off-hours guardrails apply when the underlying market is closed."}
          >
            {offHours ? "RWA · OFF-HRS?" : "RWA · RTH?"}
          </span>
        ) : null}
      </div>

      <nav className="dm-modes">
        <button className={mode === "paper" ? "on" : ""} onClick={() => setMode("paper")}>Paper terminal</button>
        <button className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>Live account · read-only</button>
        <button className="dm-mode-locked" disabled aria-describedby="live-execution-boundary">Live execution · unavailable</button>
      </nav>
      <p className="dm-mode-boundary" id="live-execution-boundary">
        No live order action exists in this terminal. Any future route requires separate provider, legal, security, reliability, eligibility, release, and explicit human-authorization gates.
      </p>

      {mode === "live" ? (
        <main className="dm-grid dm-grid-live">
          <LiveAccount wallet={wallet} />
        </main>
      ) : (
      <main className="dm-grid">
        {/* chart */}
        <section className="dm-chart-wrap">
          {/* The core's chart (SOL-T4): its tokens resolve on this box, Graphite or Porcelain as the terminal's theme. */}
          <div className="dm-chart" data-theme={theme === "light" ? "porcelain" : "graphite"} data-demo-chart>
            {feed ? (
              <RyntraChart
                key={`${market}|${theme}`}
                source={feed.source}
                instrument={market}
                resolution={resolutionOf(tf)}
                onResolutionChange={(next) => {
                  const x = timeframeOf(next);
                  if (x) setTf(x);
                }}
                lang="en"
                symbol={
                  <span className="dm-chart-head">
                    <b translate="no">{market}</b>
                    <span className="dm-chart-note">Live Arcus market data · fills simulated</span>
                  </span>
                }
                label={`${market} · price`}
                trading={trading}
                onDraftMove={onDraftMove}
                marks={chartMarks}
                drawings={FLAGS.terminal.chartDrawings ? { profile: null, legacy: () => [`ryntra-drawings:demo:${market}`] } : null}
                indicatorWorker={indicatorWorker}
                className="dm-core-chart"
              />
            ) : null}
          </div>
        </section>

        {/* SmartTrade ticket */}
        <aside className="dm-ticket">
          <div className="dm-ticket-head">
            <b>SmartTrade</b>
            <span className="dm-paper-badge">PAPER</span>
          </div>
          <div className="dm-ticket-tabs" role="tablist" aria-label="Ticket sections">
            <button role="tab" aria-selected={ticketTab === "order"} className={ticketTab === "order" ? "on" : ""} onClick={() => setTicketTab("order")}>Order</button>
            <button role="tab" aria-selected={ticketTab === "risk"} className={ticketTab === "risk" ? "on" : ""} onClick={() => setTicketTab("risk")}>
              Risk{riskDot ? <i className="dm-tabdot" aria-hidden /> : null}
            </button>
            <button role="tab" aria-selected={ticketTab === "plan"} className={ticketTab === "plan" ? "on" : ""} onClick={() => setTicketTab("plan")}>
              Plan{planDot ? <i className="dm-tabdot" aria-hidden /> : null}
            </button>
          </div>

          {ticketTab === "order" ? (
          <div className="dm-ticket-pane" role="tabpanel">
          <div className="dm-sides">
            <button className={`dm-side-long${side === "long" ? " on" : ""}`} onClick={() => setSide("long")}>Buy · Long</button>
            <button className={`dm-side-short${side === "short" ? " on" : ""}`} onClick={() => setSide("short")}>Sell · Short</button>
          </div>
          <div className="dm-row2">
            <label className="dm-field">
              <span>Entry</span>
              <div className="dm-entry">
                <button className={entryMode === "market" ? "on" : ""} onClick={() => setEntryMode("market")}>Mkt</button>
                <button className={entryMode === "limit" ? "on" : ""} onClick={() => setEntryMode("limit")}>Lim</button>
                <input inputMode="decimal" placeholder={price ? fmtPx(price) : "price"} value={entryMode === "market" ? (price ? String(price.toFixed(2)) : "") : entryIn}
                  disabled={entryMode === "market"} onChange={(e) => setEntryIn(e.target.value)} />
              </div>
            </label>
            <label className="dm-field">
              <span>Size ({market.split("-")[0]})</span>
              <input inputMode="decimal" placeholder="0.01" value={sizeIn} onChange={(e) => setSizeIn(e.target.value)} />
            </label>
          </div>
          <div className="dm-row2">
            <label className="dm-field dm-sl">
              <span>Stop-loss · required</span>
              <input inputMode="decimal" placeholder={side === "long" ? "below entry" : "above entry"} value={slIn} onChange={(e) => setSlIn(e.target.value)} />
            </label>
            <label className="dm-field dm-tp">
              <span>Take-profit</span>
              <input inputMode="decimal" placeholder="optional" value={tpIn} onChange={(e) => setTpIn(e.target.value)} />
            </label>
          </div>
          {/* live consequences of size + SL, right where they're entered (full breakdown on the Risk tab) */}
          <div className="dm-ordersum" aria-live="polite" translate="no">
            <span><i>Notional</i><b>{notional > 0 ? `$${notional.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}</b></span>
            <span><i>Max loss</i><b className={maxLoss > 0 && slSideOk ? "dm-loss" : ""}>{maxLoss > 0 && slSideOk ? `-$${maxLoss.toFixed(2)}` : "—"}</b></span>
            <span><i>R:R</i><b>{rr ? rr.toFixed(2) : "—"}</b></span>
          </div>
          </div>
          ) : null}

          {ticketTab === "risk" ? (
          <div className="dm-ticket-pane" role="tabpanel">
          <div className="dm-calc">
            <div><span>Notional</span><b>{notional > 0 ? `$${notional.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : <i className="dm-wait">waiting for size</i>}</b></div>
            <div><span>Max loss</span><b className="dm-loss">{maxLoss > 0 && slSideOk ? `-$${maxLoss.toFixed(2)}` : <i className="dm-wait">waiting for stop-loss</i>}</b></div>
            <div><span>R:R</span><b>{rr ? rr.toFixed(2) : <i className="dm-wait">{riskPerUnit > 0 ? "waiting for take-profit" : "waiting for stop-loss"}</i>}</b></div>
            <div title="Open + close legs, estimated at entry price"><span>Fees ≈ 2 legs</span><b>{notional > 0 ? `$${feesEst.toFixed(2)}` : <i className="dm-wait">waiting for size</i>}</b></div>
          </div>
          {/* Risk Guard: per-trade risk bar + soft-block warnings */}
          <div className="dm-guard">
            <div className="dm-riskbar" title={`Max loss vs paper balance · your rule ${riskRules.maxRiskPctWarn}% per trade`}>
              <span className="dm-riskbar-label">
                Risk {risk.riskPct != null ? `${risk.riskPct.toFixed(2)}%` : "—"} <i>/ {riskRules.maxRiskPctWarn}% rule</i>
              </span>
              <div className="dm-riskbar-track">
                <div
                  className={`dm-riskbar-fill${risk.overRisk ? " over" : ""}`}
                  style={{ width: `${Math.min(100, ((risk.riskPct ?? 0) / riskRules.maxRiskPctWarn) * 100)}%` }}
                />
              </div>
            </div>
            {risk.overRisk && risk.riskPct != null ? (
              <p className="dm-warnline">Risking {risk.riskPct.toFixed(2)}% of balance on one trade — above your {riskRules.maxRiskPctWarn}% rule. Consider a smaller size or tighter stop.</p>
            ) : null}
            {risk.dailyLossHit ? (
              <p className="dm-warnline">Daily loss limit hit: {fmtUsd(risk.dailyPnl)} today (limit −{riskRules.dailyLossLimitPct}% of ${RISK_RULES.baseBalance.toLocaleString("en-US")}). Best trade tomorrow.</p>
            ) : null}
            {risk.streakHit ? (
              <p className="dm-warnline">{risk.streak} losses in a row (your limit: {riskRules.lossStreak}) — cooldown suggested. Step back and review the journal before the next entry.</p>
            ) : null}
            {risk.ackRequired ? (
              <label className="dm-ack">
                <input type="checkbox" checked={riskAck} onChange={(e) => setRiskAck(e.target.checked)} />
                I see the warnings above and still choose to trade
              </label>
            ) : null}
          </div>

          {mInfo && (isRwa || fundingHr != null) ? (
            <div className="dm-riskpanel">
              <span className="dm-check-title">Risk monitor{isRwa ? " · RWA" : ""}</span>
              <div className="dm-verdictrow" title={rwaVerdict.reasons.join(" ") || "No elevated risk signals in the data Ryntra measures today."}>
                <span>Observed risk state</span>
                <em className={`spot-verdict spot-verdict-${rwaVerdict.level}`}>{RWA_RISK_LABEL[rwaVerdict.level]}</em>
              </div>
              {rwaVerdict.reasons.length ? (
                <p className="dm-riskline">{rwaVerdict.reasons.join(" ")}</p>
              ) : null}
              {fundingHr != null ? (
                <p className="dm-riskline">
                  Funding {fmtFundingHr(fundingHr)} (≈{fmtFundingApr(fundingHr)}/yr) · {fundingHr > 0 ? "longs pay shorts" : fundingHr < 0 ? "shorts pay longs" : "flat"}
                  {nextFundingMs != null && nextFundingMs > 0 ? ` · next in ${fmtDur(nextFundingMs)}` : ""}
                </p>
              ) : null}
              {isRwa && !offHours ? (
                <p className="dm-riskline">
                  Regular US hours (est.) · margin {fmtPct(mInfo.initialMarginFraction)} now, {fmtPct(mInfo.offHoursInitialMarginFraction)} off-hours. Arcus applies its own market calendar (holidays/half-days may differ).
                </p>
              ) : null}
              {bandWarn && entryDevPct != null ? (
                <p className="dm-warnline">
                  Limit entry is {Math.abs(entryDevPct).toFixed(1)}% from oracle ({oracle ? fmtPx(oracle) : "—"}) — off-hours price bands can reject or delay fills that far out.
                </p>
              ) : null}
              <p className="dm-fine">Verdict uses only measured signals. Oracle freshness and corporate-action checks are not evaluated in this paper scope; independent sequencer monitoring is unavailable until its separately named gate passes.</p>
            </div>
          ) : null}

          {/* Off-hours Trading Guard — explicit block, not just a status line */}
          {mInfo && isRwa && offHours ? (
            <div className="dm-offguard">
              <span className="dm-offguard-title">Off-hours mode active</span>
              <p className="dm-warnline">
                The underlying US market is likely closed (est.). Arcus may apply higher initial margin ({fmtPct(mInfo.offHoursInitialMarginFraction)} vs {fmtPct(mInfo.initialMarginFraction)} in regular hours), price bands and thinner liquidity.
              </p>
              <ul className="dm-offguard-list">
                <li>Stay in paper — this terminal already simulates fills, no real orders</li>
                <li>Reduce size versus your regular-hours plan</li>
                <li>Set a stop-loss (required here anyway)</li>
                <li>Or wait for the US market open</li>
              </ul>
            </div>
          ) : null}

          {/* Liquidation simulator — honest roadmap, no invented liquidation prices */}
          {mInfo ? (
            <div className="dm-riskpanel">
              <span className="dm-check-title">Liquidation simulator</span>
              {mInfo.initialMarginFraction ? (
                <p className="dm-riskline">
                  Initial margin {fmtPct(mInfo.initialMarginFraction)}{isRwa && mInfo.offHoursInitialMarginFraction ? ` · off-hours ${fmtPct(mInfo.offHoursInitialMarginFraction)}` : ""} — live from Arcus market data.
                </p>
              ) : null}
              <p className="dm-riskline">
                Live liquidation checks are unavailable. They require fresh venue margin data plus
                separate Ryntra legal, security, reliability, eligibility, and release gates.
                Current checks cover only this paper plan&apos;s max loss, stop-loss side, and off-hours acknowledgement.
              </p>
              <div className="dm-verdictrow">
                <span>Stop-before-liquidation</span>
                <em className="spot-verdict spot-verdict-unknown">Unavailable · gated</em>
              </div>
              <p className="dm-riskline">No stop-before-liquidation verdict is available without the gated live margin inputs.</p>
            </div>
          ) : null}
          </div>
          ) : null}

          {ticketTab === "plan" ? (
          <div className="dm-ticket-pane" role="tabpanel">
          <PlanCard
            eyebrow="Pre-trade plan"
            title={`${market.split("-")[0]}${isRwa ? " Stock Token" : ""}`}
            subtitle={`${side === "long" ? "Buy · Long" : "Sell · Short"} · ${entryMode === "market" ? "Market" : "Limit"} · paper`}
            status={planStatus}
            statusLabel={planStatusLabel}
            instrument={market}
            mode="Paper"
            riskItems={planRiskItems}
            checklist={planChecklist}
            footerNote="Paper mode: simulated fills, no real orders. SL/TP simulate while this terminal is open."
          />
          <div className="dm-check">
            <span className="dm-check-title">Pre-trade checklist</span>
            {checklist.map((item, i) => (
              <label key={item}><input type="checkbox" checked={checks[i]} onChange={(e) => setChecks((c) => c.map((v, j) => (j === i ? e.target.checked : v)))} />{item}</label>
            ))}
          </div>
          <textarea
            className="dm-reason" rows={2} maxLength={500}
            placeholder="Why this trade? Setup, invalidation… (required, journal starts before the trade)"
            value={reason} onChange={(e) => setReason(e.target.value)}
          />
          </div>
          ) : null}

          {!slSideOk && sl > 0 ? <p className="dm-err">SL must be {side === "long" ? "below" : "above"} entry.</p> : null}
          {!tpSideOk && tp > 0 ? <p className="dm-err">TP must be {side === "long" ? "above" : "below"} entry.</p> : null}
          {ticketErr ? <p className="dm-err">{ticketErr}</p> : null}
          {/* A visitor can build the whole ticket — instrument, size, stop,
              plan, risk verdict — and the button says the one thing that is
              actually missing. It is a link rather than a disabled control,
              because "sign in" is an action a person can take and a greyed-out
              button is a dead end that explains nothing. */}
          {visitor ? (
            <Link className={`dm-place ${side}`} href="/beta">
              Sign in to record this trade
            </Link>
          ) : (
            <button className={`dm-place ${side}`} disabled={!canPlace} onClick={() => void place()}>
              {gateLabel}
            </button>
          )}
          <p className="dm-fine">
            {visitor
              ? "Paper mode: simulated fills, no real orders. The market data, risk verdict and readiness check above are live — only recording the trade needs an account."
              : "Paper mode: simulated fills, no real orders. SL/TP trigger while the terminal is open."}
          </p>
        </aside>

        {/* bottom panel */}
        <section className="dm-bottom">
          <div className="dm-tabs">
            <button className={tab === "positions" ? "on" : ""} onClick={() => setTab("positions")}>Positions {list ? `(${list.open.length})` : ""}</button>
            <button className={tab === "journal" ? "on" : ""} onClick={() => setTab("journal")}>Journal {list ? `(${list.closed.length})` : ""}</button>
            {stats ? (
              <span className="dm-stats">
                Win rate <b>{stats.win_rate ?? "—"}%</b> · Avg R <b>{stats.avg_r ?? "—"}</b> · Plan adherence <b>{stats.adherence_pct ?? "—"}%</b>
              </span>
            ) : null}
          </div>

          {tab === "positions" ? (
            <div className="dm-table-wrap">
              {visitor ? (
                <p className="dm-empty">
                  Positions and the journal belong to an account. Sign in and every trade you plan
                  here is recorded with its reason, its stop and what actually happened.{" "}
                  <Link href="/beta">Sign in</Link>
                </p>
              ) : null}
              {list && list.open.length === 0 ? <p className="dm-empty">No open paper positions. Plan one in the SmartTrade ticket.</p> : null}
              {list && list.open.length > 0 ? (
                <>
                <table className="dm-table">
                  <thead><tr><th>Market</th><th>Side</th><th>Entry</th><th>Size</th><th>SL</th><th>TP</th><th title="Excludes exit fee">uPnL</th><th /></tr></thead>
                  <tbody>
                    {list.open.map((tr) => {
                      const u = unrealized(tr);
                      const away = tr.market !== market;
                      return (
                        <tr key={tr.id}>
                          <td>
                            {away ? (
                              <button className="dm-mkt-link" title="Switch chart to this market" onClick={() => setMarket(tr.market)}>{tr.market}</button>
                            ) : tr.market}
                          </td>
                          <td className={tr.side === "long" ? "dm-long" : "dm-short"}>{tr.side}</td>
                          <td>{fmtPx(Number(tr.entry_price))}</td>
                          <td>{tr.size}</td>
                          <td>{tr.sl ? fmtPx(Number(tr.sl)) : "—"}</td>
                          <td>{tr.tp ? fmtPx(Number(tr.tp)) : "—"}</td>
                          <td className={u == null ? "" : u >= 0 ? "dm-long" : "dm-short"} title={u == null ? "Tap the market name to stream it and see live PnL" : "Excludes exit fee"}>{u == null ? "—" : fmtUsd(u)}</td>
                          <td><button className="dm-close" disabled={away || !price} onClick={() => void closeManual(tr)}>{away ? "Select market first" : !price ? "Waiting for price" : "Close"}</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="dm-empty">uPnL excludes the exit fee. SL/TP simulate only for the streamed market and only while this terminal is open.</p>
                </>
              ) : null}
            </div>
          ) : (
            <div className="dm-journal">
              {list && list.closed.length === 0 ? <p className="dm-empty">No closed trades yet. The journal fills itself as you trade.</p> : null}
              {(list?.closed ?? []).map((tr) => {
                const d = journalDraft[tr.id] ?? { followed: tr.followed_plan ?? undefined, mistake: tr.mistake_tag ?? "", lesson: tr.lesson ?? "" };
                const checkedCount = (tr.checklist ?? []).filter((c) => c.checked).length;
                const pnlNum = Number(tr.pnl);
                const jStatus: PlanCardStatus = tr.followed_plan === true ? "ready" : tr.followed_plan === false ? "caution" : "paper";
                const jLabel = tr.followed_plan === true ? "Followed plan" : tr.followed_plan === false ? "Broke plan" : "Review";
                return (
                  <PlanCard
                    key={tr.id}
                    className="dm-jplan"
                    eyebrow="Trade journal"
                    title={tr.market}
                    subtitle={`${tr.side === "long" ? "Long" : "Short"} · ${tr.exit_reason?.toUpperCase() ?? "CLOSED"}`}
                    mode="Paper"
                    status={jStatus}
                    statusLabel={jLabel}
                    instrument={tr.market}
                    riskItems={[
                      { label: "Result", value: fmtUsd(pnlNum), tone: pnlNum >= 0 ? "ok" : "danger" },
                      { label: "Exit", value: tr.exit_reason?.toUpperCase() ?? "—", mono: false, tone: "neutral" },
                      { label: "Checklist", value: `${checkedCount}/${CHECKLIST_BASE.length}`, tone: "neutral" },
                    ]}
                    footerNote={tr.reason ? `Plan: “${tr.reason}”` : undefined}
                  >
                    <div className="dm-jform">
                      <span>Followed plan?</span>
                      <button className={d.followed === true ? "on" : ""} onClick={() => setJournalDraft((j) => ({ ...j, [tr.id]: { ...d, followed: true } }))}>Yes</button>
                      <button className={d.followed === false ? "on dm-no" : ""} onClick={() => setJournalDraft((j) => ({ ...j, [tr.id]: { ...d, followed: false } }))}>No</button>
                      <select value={d.mistake} onChange={(e) => setJournalDraft((j) => ({ ...j, [tr.id]: { ...d, mistake: e.target.value } }))}>
                        {MISTAKES.map((m) => <option key={m} value={m}>{m || "mistake tag…"}</option>)}
                      </select>
                      <input placeholder="lesson" maxLength={300} value={d.lesson} onChange={(e) => setJournalDraft((j) => ({ ...j, [tr.id]: { ...d, lesson: e.target.value } }))} />
                      <button className="dm-save" onClick={() => void saveJournal(tr)}>Save</button>
                    </div>
                  </PlanCard>
                );
              })}
            </div>
          )}
        </section>
      </main>
      )}

      {embedded ? null : (
        <footer className="dm-foot">
          Paper trading simulation on live Arcus market data. Paper balance starts at $10,000. Illustrative only — no real orders, no keys, no custody. Not financial advice.
        </footer>
      )}
    </div>
  );
}
