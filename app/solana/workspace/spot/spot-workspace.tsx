"use client";

import { X } from "@phosphor-icons/react";
import { Button, EmptyState, Skeleton } from "@ryntra/core/ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { createPortal } from "react-dom";

import type { ExecutionPlanBinding, RuleBinding } from "@/lib/api/v1/contract";
import { WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import type { SpotMarketListRow, SpotView } from "@/lib/spot/markets";
import { isSpotView } from "@/lib/spot/markets";
import type { TokenFacts, TokenMark } from "@/lib/spot/token-page";

import { LensPanel } from "@/app/app/lens/lens-panel";
import { useFitHeight } from "@/app/components/chart/use-fit-height";

import { useSolanaConnection } from "../connection.tsx";
import { EvidenceCard } from "../evidence/evidence-card.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { useWalletProof } from "../wallet-proof.tsx";
import { MarketHeader, TokenAbout } from "./market-header.tsx";
import { MarketList } from "./market-list.tsx";
import { capFactorOf, SpotChart, useSpotTimeframe } from "./spot-chart.tsx";
import type { SpotPanelId } from "./spot-layout.ts";
import { SpotTerminal } from "./spot-terminal.tsx";
import { RiskLine } from "./risk-line.tsx";
import { riskFactsOf } from "./risk-facts.ts";
import { SwapDeadline, hasSwapDeadline } from "./swap-deadline.tsx";
import { AccountPanel, TradingState } from "./trading-state.tsx";
import { TokenTabBody, tokenTabsOf, type TokenTab } from "./token-tabs.tsx";
import { openLimitCount } from "./limit-orders-view.ts";
import { useLimitOrders } from "./use-limit-orders.ts";
import type { SpotSide } from "./use-spot-ticket.ts";
import { useSpotCandles, useSpotFills, useSpotHoldings, useSpotList, useSpotMarket, useSpotWatchlist, useTokenPart } from "./use-spot-data.ts";

import styles from "./spot.module.css";

/* The ticket is the browser's alone: it stands in its own node after the page mounts (see `TicketSlot`), so the server
   never draws it — and its bundle keeps the core's trade ticket out of the server's. */
const SpotTicket = dynamic(() => import("./spot-ticket.tsx").then((loaded) => loaded.SpotTicket), { ssr: false });

const MINT_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const VIEW_KEY = "ryntra.spot.view.v1";

/**
 * Where the ticket stands now — its panel on a desk, its sheet on a phone. The ticket itself lives in one node of its
 * own that this place takes in: the terminal builds its panels again for a preset, «Скинути» or a panel brought back,
 * and a window crosses from a desk to a phone, but the ticket — what is typed, a Review, a signature on its way — is
 * the same one throughout.
 */
function TicketSlot({ home }: { home: HTMLElement | null }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = slot.current;
    if (!place || !home) return undefined;
    place.appendChild(home);
    return () => {
      if (home.parentNode === place) place.removeChild(home);
    };
  }, [home]);
  return <div ref={slot} className={styles.ticketSlot} data-ticket-slot />;
}

/**
 * Spot — one trading workspace, laid out as a trader's workplace (B16).
 *
 * On a desk it is the core's terminal (decision 61): the instrument strip in one line with the layout's presets, then
 * the chart, the ticket — the core's «Купити / Продати» (SOL-T1) — the market's tabs (Угоди · Холдери · Ліквідність ·
 * Ризик · Аналітика), the account's (Ордери · Позиція · Історія) and «Про токен» as panels that are dragged aside, up
 * and down, split, resized, put away and brought back; «Спокійно · Щільно · Торгівля · Скальп» and the arrangement kept
 * in this browser. On a phone: the strip, the chart, the segment, and «Купити | Продати» pinned above the bottom bar,
 * opening the same ticket as a sheet. One selected asset, one action. The markets open from the market's own name — a
 * menu over the chart on a desk, a sheet from the bottom on a phone. The selected mint lives in the address bar so a
 * market can be shared and reopened.
 */
export function SpotWorkspace({
  initialMint,
  initialView,
  initialPlan,
  initialSide = null,
  initialAmount = null,
  initialRule = null,
  initialQuickUsd = null,
  launchMint = null,
}: {
  initialMint: string | null;
  initialView: SpotView | null;
  initialPlan: ExecutionPlanBinding | null;
  /** The side and the sum an asset page carried in (`?side=&amount=`), read once and forgotten by the address. */
  initialSide?: "BUY" | "SELL" | null;
  initialAmount?: string | null;
  /** 1.31.0: a rule's reminder the address named (`?rule=&due=`) — the ticket is its purchase while it is open. */
  initialRule?: RuleBinding | null;
  /** A quick sum tapped on a Pulse card (`?buy=`): the ticket's own quick tap, once. */
  initialQuickUsd?: number | null;
  /** The address's token when Ryntra launched it: the header links it to its launch page (SOL-C10, UX-403). */
  launchMint?: string | null;
}) {
  const { text, locale } = useSolanaI18n();
  /* Spot is a tool of Markets' «Для досвідчених»: one version, and its face is the full one — the list beside the
     chart, the candles with their indicators and drawing, every line of the ticket open. Nothing here decides by a mode. */
  const pro = true;
  const { connection } = useSolanaConnection();
  const owner = connection?.address ?? null;
  const proof = useWalletProof();
  const proven = proof.state.status === "proven" && proof.state.address === owner;

  /* The view is the address bar's, else the one this browser kept, else All — resolved before the first list is asked
     for, so arrival is one read and not a read for the default abandoned for a read for the kept one. */
  const [view, setView] = useState<SpotView | null>(initialView);
  const [query, setQuery] = useState("");
  const [selectedMint, setSelectedMint] = useState<string>(initialMint && MINT_SHAPE.test(initialMint) ? initialMint : WRAPPED_SOL_MINT);
  /* The plan the address named. Leaving it is the person's own act and is written back to the address, so a reload
     does not bring the plan back. */
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
    const url = new URL(window.location.href);
    if (!["side", "amount", "buy"].some((name) => url.searchParams.has(name))) return;
    url.searchParams.delete("side");
    url.searchParams.delete("amount");
    url.searchParams.delete("buy");
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
  }, [initialSide, initialAmount, initialQuickUsd]);
  const [selectedRow, setSelectedRow] = useState<SpotMarketListRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  /* A desk or a phone, by the width the frame is given (760 px, the stylesheet's): decided before the first paint, so
     neither face is drawn for the other. Null until then — the server draws the strip and the bones of the workplace. */
  const [phone, setPhone] = useState<boolean | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [sideRequest, setSideRequest] = useState<Readonly<{ side: SpotSide; at: number }> | null>(null);
  const tradeRef = useRef<HTMLDivElement>(null);
  /* The pinned button that opened the sheet: focus goes back to it when the sheet closes. */
  const tradeOpener = useRef<HTMLElement | null>(null);
  const openTrade = useCallback((side: SpotSide, opener: HTMLElement) => {
    tradeOpener.current = opener;
    setSideRequest({ side, at: Date.now() });
    setTradeOpen(true);
  }, []);
  /* Where the menu drops from on a desk: under the market's name, in the frame's own coordinates, so it moves with the page. */
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
  /* The ticket's own node (see `TicketSlot`), made once in the browser. */
  const [ticketHome, setTicketHome] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const node = document.createElement("div");
    node.className = styles.ticketHome ?? "";
    setTicketHome(node);
  }, []);
  const [timeframe, setTimeframe] = useSpotTimeframe();
  const sheetRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const read = () => setPhone(frame.getBoundingClientRect().width < 760);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  /* An intent carried in from another page — a side and a sum, a quick sum, a plan, a rule's reminder — opens the
     phone's ticket at once: the person came here to act on it. */
  const carriedIntent = Boolean(initialSide || initialAmount || initialQuickUsd || initialPlan || initialRule);
  useEffect(() => {
    if (carriedIntent && (frameRef.current?.getBoundingClientRect().width ?? 1024) < 760) setTradeOpen(true);
  }, [carriedIntent]);
  /* The phone's ticket sheet: Escape closes it, focus stays inside while it is open, the page under it holds still. */
  useEffect(() => {
    if (!tradeOpen || !phone) return;
    const sheet = tradeRef.current;
    window.requestAnimationFrame(() => sheet?.querySelector<HTMLElement>("[data-trade-close]")?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); setTradeOpen(false); return; }
      if (event.key !== "Tab" || !sheet) return;
      const nodes = [...sheet.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter((node) => node.getClientRects().length > 0);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      else if (!sheet.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      root.style.overflow = previous;
      window.requestAnimationFrame(() => tradeOpener.current?.focus());
    };
  }, [tradeOpen, phone]);
  /* A desk has no sheet: a phone turned wide closes it. */
  useEffect(() => {
    if (phone === false) setTradeOpen(false);
  }, [phone]);

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
  /* A phone: the candles take the first screen down to the pinned «Купити | Продати» (≈ 64 px and a breath; the frame's
     bottom bar the hook takes off itself) — measured down to the chart's own foot, whatever its bar and its line of the
     source and age come to in each language; the market's tabs follow under the fold (SOL-C12: the chart is the most of
     the first screen). A desk's terminal measures its own height. */
  /* A token with a swap deadline carries its red line over the pinned buttons, a token with risk facts their line: the
     bar is that much taller (UX-504, UX-156). */
  const deadlineBar = hasSwapDeadline(selectedMint) ? 72 : 0;
  const riskBar = riskFactsOf(market.value, Date.now()).length > 0 ? 40 : 0;
  useFitHeight(workspaceRef, { target: ".ryntra-chart__stage, [data-chart-state]", tail: "[data-terminal-chart]", variable: "--spot-phone-fit", min: 220, max: 640, margin: 64 + 12 + deadlineBar + riskBar });
  const candles = useSpotCandles(selectedMint, timeframe);
  const holdings = useSpotHoldings(owner, generation);
  const fills = useSpotFills(owner, generation);
  /* The wallet's limit orders, one read for the chart's lines, the account's count and «Ордери». */
  const limits = useLimitOrders(owner, generation);
  /* The token page's overview: the header's windows and the chart's marks, read on arrival and kept fresh. */
  const overview = useTokenPart<{ marks: readonly TokenMark[]; facts: TokenFacts | null; observedAt: string }>(selectedMint, "overview", true);
  const facts = overview.status === "ready" ? overview.value.facts : overview.status === "loading" || overview.status === "unavailable" ? (overview.value?.facts ?? null) : null;
  const marks = overview.status === "ready" ? overview.value.marks : overview.status === "loading" || overview.status === "unavailable" ? (overview.value?.marks ?? []) : [];
  /* The person's own trades of this market, from the wallet's history: the chart marks them beside the market's. */
  const ownTrades = useMemo(() => {
    if (!fills.value) return [];
    return fills.value
      .filter((action) => action.outcome === "DONE" && (action.out?.mint === selectedMint || action.in?.mint === selectedMint))
      .map((action) => ({ t: Math.floor(Date.parse(action.updatedAt) / 1000), side: action.in?.mint === selectedMint ? ("buy" as const) : ("sell" as const) }));
  }, [fills.value, selectedMint]);

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
    /* A fill changes both balances and the fills list. Two generation bumps re-read both: one a little after the chain
       has had time to be read, and one later for a public RPC that answers the old balance for a few seconds after
       finality — a person who has just bought must see the holding without reloading. */
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
  /* The page's one last price (B15): the header prints it, the ticket counts with it, and the chart's last bar closes at
     it while it is fresh — never two figures for one market. */
  const livePrice = market.status === "ready" && !market.stale ? (market.value?.price ?? null) : null;
  const native = selectedMint === WRAPPED_SOL_MINT;

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

  const header = (tools?: ReactNode) => (
    <MarketHeader
      state={market}
      fallback={fallback}
      starred={watchlist.has(selectedMint)}
      onStar={() => watchlist.toggle(selectedMint)}
      onOpenMarkets={openMarkets}
      marketsOpen={sheetOpen}
      pro={pro}
      facts={facts}
      selectedMint={selectedMint}
      tools={tools}
      launched={launchMint !== null && launchMint === selectedMint}
    />
  );
  const chart = <SpotChart symbol={symbol} mint={selectedMint} stock={marketValue?.category === "stock"} candles={candles} timeframe={timeframe} onTimeframe={setTimeframe} capFactor={capFactorOf(marketValue)} marks={marks} ownTrades={ownTrades} limits={limits} holdings={holdings} livePrice={livePrice} />;
  const analytics = <EvidenceCard key={selectedMint} mint={selectedMint} locale={locale} planHref={marketValue?.category === "stock" ? `/app/strategies/new?mint=${encodeURIComponent(selectedMint)}` : null} />;
  const ticket = (
    <SpotTicket
      /* B14: the sheet steps aside for the header's wallet panel, and hands the focus to the panel, not back to its opener. */
      onBeforeConnect={() => {
        tradeOpener.current = null;
        setTradeOpen(false);
      }}
      market={marketValue}
      fallback={fallback ? { mint: fallback.mint, symbol: fallback.symbol, decimals: fallback.decimals, icon: fallback.icon, category: fallback.category } : null}
      holdings={holdings}
      onSettled={settled}
      onRefresh={refresh}
      planBinding={planBinding}
      initialSide={initialSide}
      initialAmount={initialAmount}
      initialQuick={initialQuickUsd !== null && initialMint ? { usd: initialQuickUsd, mint: initialMint } : null}
      proven={proven}
      proving={proof.state.status === "signing"}
      onProve={() => void proof.prove()}
      onLeavePlan={leavePlan}
      ruleBinding={ruleBinding}
      onRuleBuy={buyByRule}
      onLeaveRule={leaveRule}
      sideRequest={sideRequest}
      /* What the wallet's history and orders say of a signature the ticket could not call final (UX-256). */
      history={fills.value}
      orders={limits.orders}
      priceObservedAt={market.status === "ready" ? market.observedAt : null}
      priceStale={market.status === "ready" ? market.stale : true}
    />
  );

  /* ------------------------------------------------------------ a desk: the panels of the terminal */

  const marketTabs = useMemo(() => tokenTabsOf(marketValue, facts, native), [marketValue, facts, native]);
  const ordersCount = openLimitCount(limits.orders);
  const fillsCount = useMemo(() => (fills.value ? fills.value.filter((action) => action.out?.mint === selectedMint || action.in?.mint === selectedMint).slice(0, 10).length : 0), [fills.value, selectedMint]);
  /* A market tab as a panel: the token's own body, the bones of its rows while the market is read, one sentence where
     a token has nothing for it. */
  const tabPanel = (tab: TokenTab, none: string): ReactNode =>
    !marketValue ? (
      <Skeleton lines={5} label={text("Loading market…")} />
    ) : marketTabs.includes(tab) ? (
      <TokenTabBody key={`${marketValue.mint}:${tab}`} tab={tab} market={marketValue} facts={facts} owner={owner} />
    ) : (
      <EmptyState text={none} />
    );
  const account = { market: marketValue, holdings, fills, limits, onRefresh: refresh };
  const deskPanels: Readonly<Record<SpotPanelId, Readonly<{ title: string; children: ReactNode }>>> = {
    chart: { title: text("Chart"), children: chart },
    ticket: { title: text("Buy / Sell"), children: <TicketSlot home={ticketHome} /> },
    trades: { title: text("Trades"), children: tabPanel("trades", text("No trades of this market were read yet.")) },
    holders: { title: text("Holders"), children: tabPanel("holders", native ? text("SOL is the network's own coin: its holders are not listed.") : text("No holders were read yet.")) },
    pools: { title: text("Liquidity"), children: tabPanel("pools", text("No pools of this market were read yet.")) },
    risk: { title: text("Risk"), children: tabPanel("risk", text("No risk facts were read yet.")) },
    analytics: { title: text("Analytics"), children: analytics },
    orders: { title: `${text("Orders")}${ordersCount > 0 ? ` · ${ordersCount}` : ""}`, children: <AccountPanel tab="orders" {...account} /> },
    position: { title: text("Position"), children: <AccountPanel tab="holding" {...account} /> },
    history: { title: `${text("History")}${fillsCount > 0 ? ` · ${fillsCount}` : ""}`, children: <AccountPanel tab="fills" {...account} /> },
    about: {
      title: text("About the token"),
      children: (
        <div className={styles.aboutPanel}>
          {marketValue && marketTabs.includes("asset") ? <TokenTabBody tab="asset" market={marketValue} facts={facts} owner={owner} /> : null}
          <TokenAbout market={marketValue} fallbackName={fallback?.name ?? ""} pool={pool} />
          {marketValue && marketTabs.includes("socials") ? <TokenTabBody tab="socials" market={marketValue} facts={facts} owner={owner} /> : null}
        </div>
      ),
    },
  };

  /* The frame is the layout's measure: Spot lays out by the width it is given beside the menu, not by the window's. */
  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        <div ref={workspaceRef} className={phone === null ? styles.pending : phone ? styles.workspace : styles.desk} data-depth="pro" data-face={phone === null ? "pending" : phone ? "phone" : "desk"}>
          {phone === null ? (
            <>
              {header()}
              {/* Before the canvas has been measured, the bones of the face that is coming: a block as tall as the
                  chart will be, by the same 760 px the faces are chosen by and from the same custom property the chart
                  itself reads. Twelve bars of text stood here, and the workplace dropped a screen's worth when the real
                  one arrived. */}
              <div className={styles.bonesChart} aria-hidden="true" />
              <p className="ryntra-visually-hidden" role="status" aria-live="polite">
                {text("Loading market…")}
              </p>
            </>
          ) : phone ? (
            <>
              {header()}
              {chart}
              {/* The bottom panel: the market's tabs, «Аналітика», and «Мої». */}
              <TradingState market={marketValue} facts={facts} native={native} holdings={holdings} fills={fills} limits={limits} pro={pro} onRefresh={refresh} phone analytics={analytics} />
              {/* The ticket is the sheet the pinned «Купити | Продати» opens; «Про токен» stands under the panel. */}
              <div className={styles.sideColumn} data-spot-side>
                <div
                  ref={tradeRef}
                  className={styles.tradeSheet}
                  data-open={tradeOpen ? "true" : undefined}
                  role={tradeOpen ? "dialog" : undefined}
                  aria-modal={tradeOpen ? true : undefined}
                  aria-label={tradeOpen ? text("Order ticket") : undefined}
                >
                  <div className={styles.tradeSheetHead}>
                    <b translate="no">{symbol}</b>
                    <button type="button" className={styles.sheetClose} onClick={() => setTradeOpen(false)} aria-label={text("Close")} data-trade-close>
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <TicketSlot home={ticketHome} />
                </div>
                <TokenAbout market={marketValue} fallbackName={fallback?.name ?? ""} pool={pool} />
              </div>
            </>
          ) : (
            <SpotTerminal panels={deskPanels} tools={(bar) => header(bar)} />
          )}

          {/* The one ticket, drawn into whichever place holds it now. */}
          {ticketHome && phone !== null ? createPortal(ticket, ticketHome) : null}

          {/* The Brief and the Critic on the selected token, closed until «Спитати Ryntra» (under «Відомості про актив»
              or in «Аналітика») is pressed, and then a full-width row under the workplace. */}
          <LensPanel key={`lens-${selectedMint}`} subject={symbol ? { kind: "asset", mint: selectedMint, symbol } : { kind: "asset", mint: selectedMint }} locale={locale} trigger="page" frameClassName={styles.lensRow} />
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

      {/* A phone: «Купити | Продати» pinned above the bottom bar, each opening the ticket on its side (B16) — the core's buttons. */}
      {phone && tradeOpen ? <div className={styles.tradeBackdrop} onClick={() => setTradeOpen(false)} aria-hidden="true" /> : null}
      {phone ? (
        <div className={styles.tradeBar} data-trade-bar>
          {/* A token with a swap deadline says it over «Купити», before the ticket opens (UX-504). */}
          <SwapDeadline mint={selectedMint} lang={locale === "uk" ? "uk" : "en"} />
          {/* The token's risk in one line over «Купити», before the ticket opens (UX-156). */}
          <RiskLine market={marketValue} lang={locale === "uk" ? "uk" : "en"} />
          <Button variant="primary" lang={locale === "uk" ? "uk" : "en"} onClick={(event) => openTrade("BUY", event.currentTarget)}>
            {symbol ? `${text("Buy")} ${symbol}` : text("Buy")}
          </Button>
          <Button variant="secondary" lang={locale === "uk" ? "uk" : "en"} onClick={(event) => openTrade("SELL", event.currentTarget)}>
            {text("Sell")}
          </Button>
        </div>
      ) : null}
    </>
  );
}
