"use client";

import { X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExecutionPlanBinding } from "@/lib/api/v1/contract";
import { WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import type { SpotMarketListRow, SpotView } from "@/lib/spot/markets";
import { isSpotView } from "@/lib/spot/markets";

import { LensPanel } from "@/app/app/lens/lens-panel";

import { useSolanaConnection } from "../connection.tsx";
import { EvidenceCard } from "../evidence/evidence-card.tsx";
import { RiskCard } from "../evidence/risk-card.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { useWalletProof } from "../wallet-proof.tsx";
import { MarketHeader } from "./market-header.tsx";
import { MarketList } from "./market-list.tsx";
import { OrderTicket } from "./order-ticket.tsx";
import { SpotChart, useSpotTimeframe } from "./spot-chart.tsx";
import { TradingState } from "./trading-state.tsx";
import { useSpotCandles, useSpotFills, useSpotHoldings, useSpotList, useSpotMarket, useSpotWatchlist } from "./use-spot-data.ts";

import styles from "./spot.module.css";

const MINT_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const VIEW_KEY = "ryntra.spot.view.v1";

/**
 * Spot — one trading workspace.
 *
 * Markets on the left, the market in the middle, the order ticket on the
 * right, the wallet's state below: one canvas, one selected asset, one action.
 * Since canon v5.3 (В28) there is one face — the full one: the compact list,
 * the fuller chart and the fills; the components keep their `pro` switch,
 * and this is its one caller. The phone stacks the same panels in the order
 * a person acts. The selected mint lives in the address bar so a market can
 * be shared and reopened.
 */
export function SpotWorkspace({
  initialMint,
  initialView,
  initialPlan,
  initialSide = null,
  initialAmount = null,
}: {
  initialMint: string | null;
  initialView: SpotView | null;
  initialPlan: ExecutionPlanBinding | null;
  /** The side and the sum an asset page carried in (`?side=&amount=`), read once and forgotten by the address. */
  initialSide?: "BUY" | "SELL" | null;
  initialAmount?: string | null;
}) {
  const { text, locale } = useSolanaI18n();
  /* Spot is a tool of Markets' «Для досвідчених» (canon v5.3 В28): one
     version, and its face is the full one — the list beside the chart, the
     candles with their indicators and drawing, every line of the ticket open.
     A beginner buys on a company's page; nothing here decides by a mode. */
  const depth = "pro";
  const pro = true;
  const { connection } = useSolanaConnection();
  const owner = connection?.address ?? null;
  const proof = useWalletProof();
  const proven = proof.state.status === "proven" && proof.state.address === owner;

  /* The view is the address bar's, else the one this browser kept, else All —
     resolved before the first list is asked for, so arrival is one read and
     not a read for the default abandoned for a read for the kept one. */
  const [view, setView] = useState<SpotView | null>(initialView);
  const [query, setQuery] = useState("");
  const [selectedMint, setSelectedMint] = useState<string>(initialMint && MINT_SHAPE.test(initialMint) ? initialMint : WRAPPED_SOL_MINT);
  /* The plan the address named. Leaving it is the person's own act and is
     written back to the address, so a reload does not bring the plan back. */
  const [planBinding, setPlanBinding] = useState<ExecutionPlanBinding | null>(initialPlan);
  const leavePlan = useCallback(() => {
    setPlanBinding(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("plan");
    url.searchParams.delete("v");
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
  }, []);
  /* The carried intent is the ticket's opening state, not the address's memory: a reload does not type the sum again. */
  useEffect(() => {
    if (initialSide === null && initialAmount === null) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("side");
    url.searchParams.delete("amount");
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
  }, [initialSide, initialAmount]);
  const [selectedRow, setSelectedRow] = useState<SpotMarketListRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [timeframe, setTimeframe] = useSpotTimeframe();
  const sheetRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialView) return;
    let kept: SpotView = "all";
    try {
      const stored = window.localStorage.getItem(VIEW_KEY);
      if (isSpotView(stored)) kept = stored;
    } catch {
      /* The default view is fine. */
    }
    setView((current) => current ?? kept);
  }, [initialView]);

  const changeView = useCallback((next: SpotView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* Nothing to keep. */
    }
  }, []);

  const watchlist = useSpotWatchlist(owner, proven);
  const list = useSpotList(view, query, watchlist.mints);
  const market = useSpotMarket(selectedMint);
  const candles = useSpotCandles(selectedMint, timeframe);
  const holdings = useSpotHoldings(owner, generation);
  const fills = useSpotFills(owner, generation);

  /* The address bar follows the selection, without a navigation. */
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("mint") === selectedMint) return;
    url.searchParams.set("mint", selectedMint);
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
  }, [selectedMint]);

  const select = useCallback((row: SpotMarketListRow) => {
    setSelectedRow(row);
    setSelectedMint(row.mint);
    setSheetOpen(false);
  }, []);

  /* Keep the header alive with what the list knew while the detail loads. */
  const fallback = useMemo(() => {
    if (selectedRow && selectedRow.mint === selectedMint) return selectedRow;
    const fromList = list.value?.find((row) => row.mint === selectedMint) ?? null;
    return fromList;
  }, [list.value, selectedMint, selectedRow]);

  const settled = useCallback(() => {
    /* A fill changes both balances and the fills list. Two generation bumps
       re-read both: one a little after the chain has had time to be read, and
       one later for a public RPC that answers the old balance for a few
       seconds after finality — a person who has just bought must see the
       holding without reloading. */
    window.setTimeout(() => setGeneration((current) => current + 1), 1_500);
    window.setTimeout(() => setGeneration((current) => current + 1), 7_000);
  }, []);
  const refresh = useCallback(() => setGeneration((current) => current + 1), []);

  useEffect(() => {
    if (!sheetOpen) return;
    const workspace = workspaceRef.current;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setSheetOpen(false); return; }
      if (event.key !== "Tab") return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      const nodes = [...sheet.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
        .filter((node) => node.getClientRects().length > 0);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (!sheet.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      window.requestAnimationFrame(() => workspace?.querySelector<HTMLButtonElement>("[data-spot-picker]")?.focus());
    };
  }, [sheetOpen]);

  const marketValue = market.status === "ready" || market.status === "loading" || market.status === "unavailable" ? market.value : null;
  const symbol = marketValue?.symbol ?? fallback?.symbol ?? "";
  const pool = candles.value?.pool ?? null;

  const listPanel = (
    <MarketList
      view={view}
      onView={changeView}
      query={query}
      onQuery={setQuery}
      list={list}
      selectedMint={selectedMint}
      onSelect={select}
      isStarred={watchlist.has}
      onStar={watchlist.toggle}
      sync={watchlist.sync}
      onProve={() => void proof.prove()}
      proving={proof.state.status === "signing"}
      pro={pro}
      autoFocus={sheetOpen}
    />
  );

  return (
    <div ref={workspaceRef} className={styles.workspace} data-depth={depth}>
      {pro ? (
        <aside className={`${styles.panel} ${styles.markets}`} aria-label={text("Markets")}>
          <div className={styles.marketsInner}>{listPanel}</div>
        </aside>
      ) : null}

      <MarketHeader
        state={market}
        fallback={fallback}
        starred={watchlist.has(selectedMint)}
        onStar={() => watchlist.toggle(selectedMint)}
        onOpenMarkets={() => setSheetOpen(true)}
        showPicker
        pro={pro}
        pool={pool}
      />

      <SpotChart symbol={symbol} candles={candles} timeframe={timeframe} onTimeframe={setTimeframe} pro={pro} />

      {/* The two sensors of the selected token, on request — what the market did (RYN-NANSEN-EVIDENCE-001) and how the token is built (RYN-DDXYZ-RISK-001); a rule of the plan only where a plan can be made — a stock representation. */}
      <div className={styles.evidence}>
        <EvidenceCard key={selectedMint} mint={selectedMint} locale={locale} planHref={marketValue?.category === "stock" ? `/app/strategies/new?mint=${encodeURIComponent(selectedMint)}` : null} />
        <RiskCard
          key={`risk-${selectedMint}`}
          mint={selectedMint}
          locale={locale}
          planHref={marketValue?.category === "stock" ? `/app/strategies/new?mint=${encodeURIComponent(selectedMint)}` : null}
          assetKind={marketValue?.category === "stock" ? "issuer-backed" : marketValue?.category === "meme" ? "meme" : marketValue?.category === "crypto" ? "crypto" : "unknown"}
        />
        {/* The Brief on the selected token, and the Critic on request — the person's own plan, record and the token's structure, before the ticket (RYN-BRIEF-CRITIC-001). Closed until *Ask Ryn* under Asset details is pressed, and then a full-width row of this same area: a second box on the `evidence` grid area drew over the Risk card (RYN-FIRST-SCREEN-001). */}
        <LensPanel key={`lens-${selectedMint}`} subject={symbol ? { kind: "asset", mint: selectedMint, symbol } : { kind: "asset", mint: selectedMint }} locale={locale} trigger="page" frameClassName={styles.lensRow} />
      </div>

      <OrderTicket
        market={marketValue}
        fallback={fallback ? { mint: fallback.mint, symbol: fallback.symbol, decimals: fallback.decimals, icon: fallback.icon, category: fallback.category } : null}
        holdings={holdings}
        onSettled={settled}
        onRefresh={refresh}
        pro={pro}
        planBinding={planBinding}
        initialSide={initialSide}
        initialAmount={initialAmount}
        proven={proven}
        proving={proof.state.status === "signing"}
        onProve={() => void proof.prove()}
        onLeavePlan={leavePlan}
      />

      <TradingState market={marketValue} holdings={holdings} fills={fills} pro={pro} onRefresh={refresh} />

      {sheetOpen ? (
        <div className={styles.sheetBackdrop} onClick={(event) => { if (event.target === event.currentTarget) setSheetOpen(false); }}>
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={text("Markets")} ref={sheetRef}>
            <div className={styles.sheetHead}>
              <b>{text("Markets")}</b>
              <button type="button" className={styles.sheetClose} onClick={() => setSheetOpen(false)} aria-label={text("Close")}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            {listPanel}
          </div>
        </div>
      ) : null}
    </div>
  );
}
