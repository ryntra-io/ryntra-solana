"use client";

import { X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { ExecutionPlanBinding, RuleBinding } from "@/lib/api/v1/contract";
import { WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import type { SpotMarketListRow, SpotView } from "@/lib/spot/markets";
import { isSpotView } from "@/lib/spot/markets";

import { LensPanel } from "@/app/app/lens/lens-panel";
import { useFitHeight } from "@/app/components/chart/use-fit-height";

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
 * The market and its chart, the order ticket beside them, the wallet's state
 * below: one canvas, one selected asset, one action. The markets open from
 * the market's own name — a menu over the chart on a desk, a sheet from the
 * bottom on a phone — so the chart keeps the room. There is
 * one face — the full one; the components keep their `pro` switch, and this is
 * its one caller. The phone stacks the same panels in the order a person acts.
 * The selected mint lives in the address bar so a market can be shared and
 * reopened.
 */
export function SpotWorkspace({
  initialMint,
  initialView,
  initialPlan,
  initialSide = null,
  initialAmount = null,
  initialRule = null,
}: {
  initialMint: string | null;
  initialView: SpotView | null;
  initialPlan: ExecutionPlanBinding | null;
  /** The side and the sum an asset page carried in (`?side=&amount=`), read once and forgotten by the address. */
  initialSide?: "BUY" | "SELL" | null;
  initialAmount?: string | null;
  /** 1.31.0: a rule's reminder the address named (`?rule=&due=`) — the ticket is its purchase while it is open. */
  initialRule?: RuleBinding | null;
}) {
  const { text, locale } = useSolanaI18n();
  /* Spot is a tool of Markets' «Для досвідчених»: one version, and its face
     is the full one — the list beside the chart, the candles with their
     indicators and drawing, every line of the ticket open. A beginner buys on
     a company's page; nothing here decides by a mode. */
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
  /* A rule's reminder (1.31.0), kept in the address so a reload still opens its purchase; leaving it is the person's own act. */
  const [ruleBinding, setRuleBinding] = useState<RuleBinding | null>(initialRule);
  const buyByRule = useCallback((binding: RuleBinding) => {
    setRuleBinding(binding);
    const url = new URL(window.location.href);
    url.searchParams.set("rule", binding.ruleId);
    url.searchParams.set("due", binding.dueAt);
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
  }, []);
  const leaveRule = useCallback(() => {
    setRuleBinding(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("rule");
    url.searchParams.delete("due");
    url.searchParams.delete("from");
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
  /* Where the menu drops from on a desk: under the market's name, in the frame's own coordinates, so it moves
     with the page. */
  const [anchor, setAnchor] = useState<{ top: number; left: number; room: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const openMarkets = useCallback(() => {
    const name = workspaceRef.current?.querySelector<HTMLElement>("[data-spot-picker]")?.getBoundingClientRect();
    const frame = frameRef.current?.getBoundingClientRect();
    /* The room under the name stays true while the menu is open: the page holds still. */
    setAnchor(name && frame ? { top: Math.round(name.bottom - frame.top + 4), left: Math.round(name.left - frame.left), room: Math.round(window.innerHeight - name.bottom - 4 - 16) } : null);
    setSheetOpen((open) => !open);
  }, []);
  const [generation, setGeneration] = useState(0);
  const [timeframe, setTimeframe] = useSpotTimeframe();
  const sheetRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  /* The chart takes what the first screen has left under the header — a desk's stylesheet reads it, a phone keeps its own height. */
  /* The margin under the canvas is the chart panel's own foot — its padding and border — and a breath of the canvas's gap;
     a short window (720 px) with a tall header — a company's token, a meme — gets a shorter chart rather than one under its edge. */
  useFitHeight(workspaceRef, { target: `.${typeof CSS === "undefined" ? styles.chartCanvas : CSS.escape(styles.chartCanvas)}, [data-chart-state]`, variable: "--spot-fit", min: 240, margin: 21 });
  /* And the ticket ends on the first screen too, where it stands before the page scrolls: measured from the header,
     which starts on the same row and never sticks, so a scrolled page does not shrink it. */
  useFitHeight(workspaceRef, { target: "[data-terminal-header]", variable: "--spot-ticket-fit", min: 320, max: 4000, margin: 12 });

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
    /* The next opening starts from the whole list, not from the search that found this one. */
    setQuery("");
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
    /* The page holds still under the markets: the root is the scroller (the body clips sideways and passes nothing
       on), and a window that changes size closes the menu rather than leave it under a name that moved. */
    const root = document.documentElement;
    const previous = root.style.overflow;
    const gutter = root.style.scrollbarGutter;
    /* The scrollbar's place is kept, so nothing beside the menu shifts sideways when it opens and closes. */
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    /* Only a change of width moves the name; a phone's keyboard changes the height and must not close the sheet. */
    const width = window.innerWidth;
    const close = () => { if (window.innerWidth !== width) setSheetOpen(false); };
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      root.style.overflow = previous;
      root.style.scrollbarGutter = gutter;
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

  /* The frame is the layout's measure: Spot lays out by the width it is given beside the menu, not by the window's. */
  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        <div ref={workspaceRef} className={styles.workspace} data-depth={depth}>
          <MarketHeader
            state={market}
            fallback={fallback}
            starred={watchlist.has(selectedMint)}
            onStar={() => watchlist.toggle(selectedMint)}
            onOpenMarkets={openMarkets}
            marketsOpen={sheetOpen}
            pro={pro}
            pool={pool}
          />

          <SpotChart symbol={symbol} candles={candles} timeframe={timeframe} onTimeframe={setTimeframe} pro={pro} />

          {/* The two sensors of the selected token, on request — what the market did and how the token is built; a rule of the plan only where a plan can be made — a stock representation. */}
          <div className={styles.evidence}>
            <EvidenceCard key={selectedMint} mint={selectedMint} locale={locale} planHref={marketValue?.category === "stock" ? `/app/strategies/new?mint=${encodeURIComponent(selectedMint)}` : null} />
            <RiskCard
              key={`risk-${selectedMint}`}
              mint={selectedMint}
              locale={locale}
              planHref={marketValue?.category === "stock" ? `/app/strategies/new?mint=${encodeURIComponent(selectedMint)}` : null}
              assetKind={marketValue?.category === "stock" ? "issuer-backed" : marketValue?.category === "meme" ? "meme" : marketValue?.category === "crypto" ? "crypto" : "unknown"}
            />
            {/* The Brief on the selected token, and the Critic on request — the person's own plan, record and the token's structure, before the ticket. Closed until *Ask Ryntra* under Asset details is pressed, and then a full-width row of this same area: a second box on the `evidence` grid area drew over the Risk card. */}
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
            ruleBinding={ruleBinding}
            onRuleBuy={buyByRule}
            onLeaveRule={leaveRule}
          />

          <TradingState market={marketValue} holdings={holdings} fills={fills} pro={pro} onRefresh={refresh} />
        </div>

        {/* The markets: a menu under the market's name on a desk, a sheet from the bottom on a phone. */}
        {sheetOpen ? (
          <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={text("Markets")} ref={sheetRef} data-dense style={anchor ? ({ "--spot-menu-top": `${anchor.top}px`, "--spot-menu-left": `${anchor.left}px`, "--spot-menu-room": `${anchor.room}px` } as CSSProperties) : undefined}>
            <div className={styles.sheetHead}>
              <b>{text("Markets")}</b>
              <button type="button" className={styles.sheetClose} onClick={() => setSheetOpen(false)} aria-label={text("Close")}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            {listPanel}
          </div>
        ) : null}
      </div>

      {sheetOpen ? <div className={styles.sheetBackdrop} onClick={() => setSheetOpen(false)} aria-hidden="true" /> : null}
    </>
  );
}
