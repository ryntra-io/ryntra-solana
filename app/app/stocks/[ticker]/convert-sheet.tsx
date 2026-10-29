"use client";

import { ArrowUpRight } from "@phosphor-icons/react";
import { Button, TradeTicket, amountForShare, newDraft, ticketModel, type TicketDraft, type TicketReviewed } from "@ryntra/core/ui";
import { ryntraFeeOfWhich } from "./ryntra-fee-line";
import Link from "next/link";
import { pagePath } from "@/lib/site/localized";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { approxUsd, buyCosts, dollars, formatUnits, unitsFromRaw } from "@/app/app/invest/company-model";
import { FIRST_PURCHASE_LAMPORTS, PURCHASE_FEE_LAMPORTS, solShort } from "@/app/app/invest/funding-model";
import { investWords, numberLocale, reserveLine } from "@/app/app/invest/invest-words";
import { useWalletData } from "@/app/app/wallet-data";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatUsdPrice } from "@/app/solana/workspace/spot/spot-format";
import { useSpotMarket } from "@/app/solana/workspace/spot/use-spot-data";
import { plainAmount, SPOT_QUOTE_ASSETS, useSpotTicket, type SpotQuoteAsset } from "@/app/solana/workspace/spot/use-spot-ticket";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import { swapFailureCopy } from "@/lib/solana/swap-failure-copy";
import { SPOT_SALE_SIDE } from "@/lib/spot/ticket-state";
import { deadlineExact } from "@/lib/stocks/conversion-watch";
import { NETWORK_LABEL, SOL_COIN, chainUnits, solGas, ticketBalances, ticketMarket, ticketPrices, unitsOf as ticketUnits, type TicketCoin } from "@/lib/ticket/solana-ticket";

import company from "./company.module.css";
import { STOCK_VENUE, stockTicketBase, stockTicketView } from "./stock-ticket";
import { tradeFailureLine } from "./trade-failure-words";

/**
 * The swap before the issuer's deadline, and the quiet sale — the IPO and
 * conversion watch's one action, drawn as the purchase's sheet is.
 *
 * «Обміняти на SpaceX (SPCXx)» sells the pre-IPO token straight into the
 * listed token the issuer points to; «Продати за USDC» sells it for dollars.
 * Either is an ordinary swap at the live quote — the issuer's own word:
 * conversion «happens through normal trading» — on the one execution path
 * the product has (`useSpotTicket`: `/order` → the wallet's signature over
 * the reviewed bytes → `/execute` → `/recover`). No ratio is promised.
 *
 * **Намір.** How much of what the wallet holds — all of it, half or a
 * quarter — and at once what it brings from the live quote. **Межі · дозвіл.**
 * One press prepares the exact Review, four lines: what leaves the wallet,
 * what arrives at least, all costs with the issuer's fee on its own line, and
 * the rate — how much the swap gives against the company's price on the
 * exchange, a discount said as one. The route, the issuer's deadline to the
 * minute and its notice are one press deep under «Деталі». **Виконання ·
 * доказ.** The signature, the network, the receipt: «✓ Обміняно · 0,067
 * SpaceX (SPCXx)».
 *
 * Nothing here signs or spends: the wallet does, when the person presses.
 */

export type ConvertMode = "swap" | "sell";

/** The listed token the issuer points the swap to, as the page read it. */
export type ConvertTarget = Readonly<{
  mint: string;
  symbol: string;
  company: string;
  icon: string | null;
  /** The target's Scaled UI multiplier, when its mint carries one. */
  multiplier: number | null;
  /** The company's price on the exchange, per share — the target issuer's reference; null when unread. */
  exchangeUsd: number | null;
  /** What the target token is, in one line (its issuer's truth). */
  truth: string;
}>;

export type ConvertSheetProps = Readonly<{
  open: boolean;
  mode: ConvertMode;
  onClose: () => void;
  onConnect: () => void;
  /** The pre-IPO token being swapped or sold. */
  mint: string;
  symbol: string;
  /** The company, as a person names it. */
  name: string;
  icon: string | null;
  decimals: number | null;
  multiplier: number | null;
  /** The fee the token's mint withholds on every transfer, basis points — PreStocks' 1 %. */
  issuerFeeBps: number | null;
  into: ConvertTarget | null;
  /** The issuer's cut-off, ISO. */
  deadline: string;
  /** The issuer's own notice, and its word on how the swap works. */
  noticeUrl: string;
  mechanicsUrl: string | null;
  locale: WorkspaceLocale;
}>;

const USDC = SPOT_QUOTE_ASSETS[0];
const RAW = /^\d+$/;

export function ConvertSheet(props: ConvertSheetProps) {
  const { open, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  useEffect(() => {
    /* The page does not scroll under an open sheet. */
    if (!open) return undefined;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [open]);

  /* Nothing closes the sheet while a Review is being prepared, signed or sent. */
  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  return (
    <dialog
      ref={dialog}
      className={company.sheet}
      aria-labelledby={titleId}
      data-convert={props.mode}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      {open || busy ? <ConvertFlow key={props.mode} {...props} titleId={titleId} onBusy={setBusy} onClose={requestClose} /> : null}
    </dialog>
  );
}

function ConvertFlow({
  mode,
  mint,
  symbol,
  name,
  icon,
  decimals,
  multiplier,
  issuerFeeBps,
  into,
  deadline,
  noticeUrl,
  mechanicsUrl,
  locale,
  titleId,
  onBusy,
  onClose,
  onConnect,
}: ConvertSheetProps & { titleId: string; onBusy: (busy: boolean) => void }) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const { connection } = useSolanaConnection();
  const { text } = useSolanaI18n();
  const { holdings, refresh } = useWalletData();
  const router = useRouter();

  /* The swap goes into the listed token; the sale into USDC. */
  const swap = mode === "swap" && into !== null;
  const baseMarket = useSpotMarket(decimals === null ? mint : null);
  const targetMarket = useSpotMarket(swap ? into.mint : null);
  const sol = useSpotMarket(WRAPPED_SOL_MINT);
  const baseDecimals = decimals ?? (baseMarket.status === "ready" ? baseMarket.value.decimals : null);
  const solUsd = sol.value?.price ?? null;
  const target: SpotQuoteAsset = swap ? { mint: into.mint, symbol: into.symbol, decimals: targetMarket.value?.decimals ?? 0 } : USDC;

  /* ------------------------------------------------------------ the wallet */
  const heldRow = holdings.status === "ready" ? holdings.data.find((row) => row.mint === mint) ?? null : null;
  const heldRaw = heldRow && RAW.test(heldRow.amountRaw) ? BigInt(heldRow.amountRaw) : holdings.status === "ready" ? 0n : null;
  const solRow = holdings.status === "ready" ? holdings.data.find((row) => row.kind === "NATIVE_SOL") ?? null : null;
  const holdsTarget = holdings.status === "ready" && holdings.data.some((row) => row.mint === target.mint && RAW.test(row.amountRaw) && BigInt(row.amountRaw) > 0n);
  const cannotPayFee = connection !== null && solRow !== null && RAW.test(solRow.amountRaw) && solShort(BigInt(solRow.amountRaw), holdsTarget);

  /* ------------------------------------------------------------ the ticket's market */
  /* What is given counts in the units the wallet shows; what arrives — the listed token in its own, or dollars as USDC. */
  const giveCoin: TicketCoin = useMemo(() => ({ mint, symbol, decimals: baseDecimals ?? 0, digits: 4, multiplier }), [mint, symbol, baseDecimals, multiplier]);
  const getCoin: TicketCoin = useMemo(
    () => (swap && into ? { mint: into.mint, symbol: into.symbol, decimals: target.decimals, digits: 4, multiplier: into.multiplier } : { mint: USDC.mint, symbol: "USDC", decimals: USDC.decimals, digits: 2 }),
    [swap, into, target.decimals],
  );
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const balances = !connection
    ? null
    : heldRaw === null
      ? {}
      : ticketBalances([
          { coin: giveCoin, raw: heldRaw },
          { coin: SOL_COIN, raw: solRow?.amountRaw ?? (holdings.status === "ready" && holdings.complete ? "0" : null) },
        ]);
  const gas = useMemo(() => solGas(holdsTarget ? PURCHASE_FEE_LAMPORTS : FIRST_PURCHASE_LAMPORTS), [holdsTarget]);
  const ticketMarketOf = useMemo(() => ticketMarket({ id: `${mint}:${getCoin.mint}`, base: giveCoin, quote: getCoin, price: null }), [mint, giveCoin, getCoin]);

  /* How much: all of it until the person says otherwise — the swap is the holder's one action before the deadline. */
  const [amountText, setAmountText] = useState<string | null>(null);
  const [amountUnit, setAmountUnit] = useState<"token" | "usd">("token");
  const draft: TicketDraft = newDraft({ side: "sell", unit: amountUnit, amount: amountText ?? "" });
  /* The token's dollar price, as the last quote said it: a sum typed in dollars keeps meaning the same amount while the
     next quote is asked for — never «no price» because the sum itself changed. */
  const [lastGiveUsd, setLastGiveUsd] = useState<number | null>(null);
  const steadyPrices = useMemo(() => ticketPrices([{ coin: giveCoin, usd: lastGiveUsd }, { coin: getCoin, usd: swap ? (into?.exchangeUsd ?? null) : 1 }], clock, "Jupiter"), [giveCoin, getCoin, lastGiveUsd, swap, into, clock]);
  const baseInput = { side: "sell" as const, market: ticketMarketOf, base: giveCoin, quote: getCoin, draft, balances, prices: steadyPrices, reference: null, gas, unavailable: null, now: clock };
  const opening = ticketModel(stockTicketBase(baseInput), lang);
  useEffect(() => {
    if (amountText !== null || heldRaw === null || heldRaw <= 0n || baseDecimals === null || !opening.max) return;
    setAmountText(amountForShare(opening, 100, "token", {}, lang));
  }, [amountText, heldRaw, baseDecimals, opening, lang]);
  const typedShown = ticketUnits(opening.paid);
  const partRaw = typedShown === null || heldRaw === null || heldRaw <= 0n ? null : chainUnits(typedShown, giveCoin, heldRaw);
  const amount = partRaw !== null && partRaw > 0n && partRaw <= (heldRaw ?? 0n) && baseDecimals !== null ? plainAmount(partRaw.toString(), baseDecimals) : "";

  /* ------------------------------------------------------- the one execution path */
  const ticket = useSpotTicket({
    connection,
    side: SPOT_SALE_SIDE,
    baseMint: mint,
    baseDecimals,
    baseSymbol: symbol,
    quote: target,
    amount,
    text,
    onSettled: refresh,
    onRefresh: refresh,
  });
  const { phase, quoted, prepared, settled, attempt } = ticket;
  /* What Review agreed to, kept here: the hook lets the prepared order go before the answer settles. */
  const [agreed, setAgreed] = useState<TicketReviewed | null>(null);
  const working = phase === "PREPARING" || phase === "SIGNING" || phase === "EXECUTING" || phase === "RECOVERING";
  useEffect(() => {
    onBusy(working);
  }, [working, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);

  /* ------------------------------------------------------------ what it brings */
  const order = prepared?.order ?? quoted?.order ?? null;
  const outDecimals = order ? (prepared?.decimals?.[target.mint] ?? quoted?.decimals?.[target.mint] ?? (swap ? targetMarket.value?.decimals ?? null : USDC.decimals)) : null;
  const outUnits = order ? unitsFromRaw(order.outAmountRaw, outDecimals, swap ? into?.multiplier ?? null : null) : null;
  const inUnits = order ? unitsFromRaw(order.inAmountRaw, baseDecimals, multiplier) : null;
  const inUsd = order?.inUsdValue !== null && order?.inUsdValue !== undefined ? Number(order.inUsdValue) : null;
  const estimate =
    order && inUsd !== null && Number.isFinite(inUsd)
      ? buyCosts({
          spendUsd: inUsd,
          inUsdValue: order.inUsdValue,
          outUsdValue: order.outUsdValue,
          totalFeeBasisPoints: order.totalFeeBasisPoints,
          priceImpactPct: order.priceImpactPct,
          signatureFeeLamports: order.signatureFeeLamports,
          priorityFeeLamports: order.priorityFeeLamports,
          rentFeeLamports: prepared ? prepared.order.rentFeeLamports : null,
          solUsd,
          issuerFeeBasisPoints: issuerFeeBps,
        })
      : null;
  const ryntraFeeLine = ryntraFeeOfWhich(prepared?.order ?? quoted?.order ?? null, "", numbers);

  /* The rate against the company's price on the exchange: what one token brings, and how far below or above the listed share that is — the swap's price, shown honestly. */
  const perToken = outUnits !== null && inUnits !== null && inUnits > 0 ? outUnits / inUnits : null;
  const exchangeUsd = into?.exchangeUsd ?? null;
  const perTokenUsd = perToken === null ? null : swap ? (exchangeUsd !== null ? perToken * exchangeUsd : null) : perToken;
  const gapPct = perTokenUsd !== null && exchangeUsd !== null && exchangeUsd > 0 ? (perTokenUsd / exchangeUsd - 1) * 100 : null;
  const rateLine = (() => {
    if (perToken === null) return null;
    const figure = swap ? `1 ${symbol} → ${formatUnits(perToken, numbers)} ${into?.symbol ?? ""}` : `1 ${symbol} → ${formatUsdPrice(perToken, numbers)}`;
    return figure.trim();
  })();
  const gapLine = (() => {
    if (gapPct === null || exchangeUsd === null) return null;
    const size = Math.abs(gapPct);
    const pct = `${new Intl.NumberFormat(numbers, { maximumFractionDigits: size >= 10 ? 0 : 1 }).format(size)}%`;
    const company = into?.company ?? name;
    const listed = formatUsdPrice(exchangeUsd, numbers);
    if (size < 0.5) return lang === "uk" ? `≈ як ціна ${company} на біржі (${listed})` : `≈ ${company}'s price on the exchange (${listed})`;
    return lang === "uk"
      ? `на ${pct} ${gapPct < 0 ? "менше" : "більше"}, ніж ціна ${company} на біржі (${listed})`
      : `${pct} ${gapPct < 0 ? "below" : "above"} ${company}'s price on the exchange (${listed})`;
  })();
  const routeLine = order && order.route.length > 0 ? order.route.map((hop) => hop.label).join(" → ") : null;

  const quoteFailure = ticket.quoteFailure && amount ? tradeFailureLine(ticket.quoteFailure, ticket.quoteFailureMessage, swap ? "swap" : "sell", lang) : null;
  const quoteStop = ticket.quoteFailure ? !swapFailureCopy(ticket.quoteFailure.code, text).retryable : false;
  const blocked = quoted?.verdict.verdict === "BLOCKED";
  const failure = (() => {
    const code = ticket.actionFailure?.code ?? null;
    if (code === "WALLET_REFUSED") return word("walletDeclined");
    if (ticket.actionFailure) return tradeFailureLine(ticket.actionFailure, ticket.actionFailureMessage, swap ? "swap" : "sell", lang);
    return null;
  })();

  const topUpSol = useCallback(() => {
    const back = encodeURIComponent(pagePath(window.location.pathname));
    router.push(`/app/top-up?need=sol&from=${back}`);
  }, [router]);

  /* The ticket's dollar sums: the token's price from the quote's own figure, the listed share's from the exchange. */
  const giveUsd = inUsd !== null && inUnits !== null && inUnits > 0 ? inUsd / inUnits : null;
  /* Learned from the live quote alone, while nothing is being reviewed — never from the order a Review stands on — and
     held still while a sum is typed in dollars: a price that follows each new quote would resize the sum, ask again,
     and close the Review it was asked for. */
  const quotedOrder = quoted?.order ?? null;
  const quotedInUsd = quotedOrder?.inUsdValue !== null && quotedOrder?.inUsdValue !== undefined ? Number(quotedOrder.inUsdValue) : null;
  const quotedInUnits = quotedOrder ? unitsFromRaw(quotedOrder.inAmountRaw, baseDecimals, multiplier) : null;
  const quotedGiveUsd = quotedInUsd !== null && quotedInUnits !== null && quotedInUnits > 0 ? quotedInUsd / quotedInUnits : null;
  useEffect(() => {
    if (phase !== "IDLE" || quotedGiveUsd === null || !Number.isFinite(quotedGiveUsd) || quotedGiveUsd <= 0) return;
    if (amountUnit === "usd" && lastGiveUsd !== null) return;
    setLastGiveUsd(quotedGiveUsd);
  }, [phase, quotedGiveUsd, amountUnit, lastGiveUsd]);
  const prices = ticketPrices([{ coin: giveCoin, usd: giveUsd ?? lastGiveUsd }, { coin: getCoin, usd: swap ? exchangeUsd : 1 }], clock, "Jupiter");
  /* What arrives counts in the decimals the server read for the order, before the catalog's: a token the catalog has not
     read yet is never drawn as a million of itself. */
  const viewCoin: TicketCoin = swap && outDecimals !== null && outDecimals !== getCoin.decimals ? { ...getCoin, decimals: outDecimals } : getCoin;
  const viewMarket = viewCoin === getCoin ? ticketMarketOf : ticketMarket({ id: `${mint}:${viewCoin.mint}`, base: giveCoin, quote: viewCoin, price: null });
  const view = stockTicketView({
    agreed,
    ...baseInput,
    market: viewMarket,
    quote: viewCoin,
    prices: amountUnit === "usd" ? steadyPrices : prices,
    spot: { phase, quoted, quoting: ticket.quoting, prepared, preparedReadiness: ticket.preparedReadiness, bytesChanged: ticket.bytesChanged, reviewSecondsLeft: ticket.reviewSecondsLeft, settled, attempt },
    quoteFailed: quoteFailure,
    unavailable: blocked || quoteStop ? word(swap ? "swapUnavailable" : "saleUnavailable") : null,
    holding: swap && outDecimals === null && targetMarket.value?.decimals === undefined,
    time: new Intl.DateTimeFormat(numbers, { hour: "2-digit", minute: "2-digit" }).format(new Date(clock)),
    lang,
  });
  useEffect(() => {
    if (view.stage === "review" && view.reviewed) setAgreed(view.reviewed);
    // Taken once per prepared order as Review shows it: `view.reviewed` is a new object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, view.stage]);
  /* Let go when a new order is asked for, a Review is put down or the sheet starts over: an answer that comes without a
     Review of its own (another signature in flight) never reads an earlier Review's figures. */
  useEffect(() => {
    if (phase === "IDLE" || (phase === "PREPARING" && prepared === null)) setAgreed(null);
  }, [phase, prepared]);
  const outcome = view.outcome;
  const inReview = view.stage === "review";

  const targetWord = swap && into ? `${into.company} (${into.symbol})` : "USDC";
  const title = swap ? (lang === "uk" ? `Обміняти ${symbol}` : `Swap ${symbol}`) : lang === "uk" ? `Продати ${symbol}` : `Sell ${symbol}`;

  const head = (heading: string) => (
    <div className={company.sheetHead}>
      <span className={company.grab} aria-hidden="true" />
      <MarketIcon mint={mint} icon={icon} symbol={name} size={32} className={company.sheetLogo} />
      <h2 id={titleId} className={company.sheetTitle}>
        {heading}
      </h2>
      <Button variant="ghost" icon="x" className={company.sheetClose} onClick={onClose} disabled={working} aria-label={word("close")} lang={lang} />
    </div>
  );

  /* The receipt's title, as the sheet's head. */
  const context = ticket.settledContext;
  const gotRaw = settled?.observation?.actualOutputRaw ?? null;
  const gaveRaw = settled?.observation?.actualInputRaw ?? null;
  const got = gotRaw ? unitsFromRaw(gotRaw, swap ? (context?.quoteDecimals ?? outDecimals) : USDC.decimals, swap ? into?.multiplier ?? null : null) : null;
  const gave = gaveRaw ? unitsFromRaw(gaveRaw, context?.baseDecimals ?? baseDecimals, multiplier) : null;
  const heading = outcome
    ? outcome.kind === "FILLED"
      ? swap
        ? `${word("swapped")} · ${got !== null ? `${formatUnits(got, numbers)} ` : ""}${targetWord}`
        : `${word("sold")}${got !== null ? ` · ${dollars(got, numbers)}` : ""}`
      : outcome.kind === "NOTHING_HAPPENED"
        ? word(swap ? "nothingSwapped" : "nothingSold")
        : outcome.kind === "NOT_FILLED"
          ? word(swap ? "swapRejected" : "saleRejected")
          : word(swap ? "swapUnknownTx" : "saleUnknownTx")
    : null;

  /* «Усі витрати» as before: counted here on the order's figures (the server counts a company bought or sold for USDC only), the issuer's and Ryntra's parts on their own lines. */
  const count =
    estimate && amount
      ? {
          costLines: [
            ...(estimate.issuerFeeUsd != null && issuerFeeBps !== null && issuerFeeBps > 0 ? [{ label: word("issuerFeeOfWhich"), value: `${new Intl.NumberFormat(numbers, { maximumFractionDigits: 2 }).format(issuerFeeBps / 100)}% ${approxUsd(estimate.issuerFeeUsd, numbers)}` }] : []),
            ...(ryntraFeeLine ? [{ label: word("ryntraFeeOfWhich"), value: ryntraFeeLine.trim() }] : []),
          ],
          costsTotal: approxUsd(estimate.totalUsd, numbers),
        }
      : {};
  const none = connection !== null && heldRaw === 0n;
  const sheetName = view.stage === "review" ? "review" : view.stage === "result" ? (outcome ? "receipt" : "recovery") : "compose";

  return (
    <div
      className={company.sheetBody}
      data-sheet={sheetName}
      data-convert-compose={view.stage === "form" ? mode : undefined}
      data-convert-review={inReview ? mode : undefined}
      data-convert-receipt={outcome ? mode : undefined}
    >
      {head(heading ?? (inReview ? word("review") : view.stage === "result" ? name : title))}
      {view.stage === "form" ? (
        <p className={company.convertTo} translate="no">
          <span>{symbol}</span>
          <span aria-hidden="true">→</span>
          {swap && into ? <MarketIcon mint={into.mint} icon={into.icon} symbol={into.company} size={20} /> : <MarketIcon mint={USDC.mint} icon={USDC.icon} symbol="USDC" size={20} />}
          <span>{targetWord}</span>
        </p>
      ) : null}
      {view.stage === "form" && none ? (
        <>
          <p className={company.sheetNote} data-empty="token">
            {swap ? (lang === "uk" ? `У гаманці немає ${symbol} — обмінювати нічого.` : `There is no ${symbol} in this wallet — nothing to swap.`) : lang === "uk" ? `У гаманці немає ${symbol} — продавати нічого.` : `There is no ${symbol} in this wallet — nothing to sell.`}
          </p>
          <div className={company.sheetActions}>
            <Button variant="primary" block onClick={onClose} lang={lang}>
              {word("done")}
            </Button>
          </div>
        </>
      ) : (
        <TradeTicket
          quietLegs
          {...view.input}
          className={company.ticket}
          venue={STOCK_VENUE}
          network={NETWORK_LABEL}
          stage={view.stage}
          reviewed={view.reviewed}
          result={view.result}
          signing={view.signing}
          cancelWhileSigning={false}
          {...(connection ? { signer: `${connection.address.slice(0, 4)}…${connection.address.slice(-4)}` } : {})}
          {...count}
          reviewRows={inReview && rateLine ? [{ label: word("rowRate"), value: gapLine ? `${rateLine} · ${gapLine}` : rateLine }] : undefined}
          whatItIs={inReview ? word(swap ? "swapIsTrade" : "saleIsTrade") : undefined}
          titleAs="h3"
          lang={lang}
          onDraftChange={(next) => {
            if (next.unit !== amountUnit) setAmountUnit(next.unit);
            setAmountText(next.amount);
          }}
          /* «Спробувати ще» only where another press can help: not on a refusal this deployment cannot pass, nor on a sum over the limit. */
          onRetryQuote={quoteStop ? undefined : () => ticket.refreshQuote()}
          onConnect={onConnect}
          onReview={() => {
            /* One press at a time: none while the order is prepared or signed; a Review let go for its age asks a fresh price. */
            if (working) return;
            if (ticket.lockedReview) void ticket.cancelReview(true);
            else void ticket.review();
          }}
          {...(connection && view.stage === "form" && (phase === "PREPARING" || holdings.status !== "ready")
            ? {
                action:
                  phase !== "PREPARING" && holdings.status === "error" ? (
                    /* A wallet read that failed is read again on a press, never «Reading…» for good. */
                    <>
                      <p className={company.sheetError} role="status">
                        {word("walletUnread")}
                      </p>
                      <Button variant="primary" block onClick={refresh} lang={lang} data-ticket-action="">
                        {word("tryAgain")}
                      </Button>
                    </>
                  ) : (
                    <Button variant="primary" block disabled lang={lang} data-ticket-action="">
                      {phase === "PREPARING" ? word("preparingReview") : word("reading")}
                    </Button>
                  ),
              }
            : {})}
          onCancel={() => void ticket.cancelReview()}
          onConfirm={() => void ticket.sign()}
          onVerify={settled && outcome?.kind !== "NOTHING_HAPPENED" ? () => window.open(explorerTxUrl("mainnet", settled.signature), "_blank", "noopener,noreferrer") : undefined}
          onAgain={() => ticket.reset()}
        />
      )}
      {/* The step the held action names, said to a screen reader as it changes. */}
      <p className={company.srOnly} role="status">
        {view.stage === "form" && phase === "PREPARING" ? word("preparingReview") : ""}
      </p>

      {view.stage === "form" && !none ? (
        <>
          {ticket.lockedReview ? (
            <Button variant="secondary" block onClick={() => void ticket.cancelReview(true)} lang={lang}>
              {word("refreshPrice")}
            </Button>
          ) : null}
          {cannotPayFee ? (
            <>
              <p className={company.sheetNote} data-empty="sol">
                {word("needSol")}
              </p>
              <Button variant="secondary" block icon="wallet" onClick={topUpSol} lang={lang}>
                {word("topUpSol")}
              </Button>
            </>
          ) : null}
          {failure ? <p className={company.sheetError}>{failure}</p> : null}
        </>
      ) : null}

      {inReview ? (
        <>
          {/* The account the swap opens for the new token: its own line, never a cost — it stays in the wallet. */}
          {estimate?.accountUsd ? <p className={company.sheetNote} data-reserve>{reserveLine(locale, approxUsd(estimate.accountUsd, numbers))}</p> : null}
          <details className={company.risk} data-convert-details>
            <summary>{word("details")}</summary>
            <dl className={company.convertFacts}>
              {routeLine ? (
                <div>
                  <dt>{word("swapRoute")}</dt>
                  <dd translate="no">{routeLine}</dd>
                </div>
              ) : null}
              <div>
                <dt>{word("issuerDeadline")}</dt>
                <dd translate="no">{deadlineExact(deadline, lang)}</dd>
              </div>
              {swap && into ? (
                <div>
                  <dt>{word("whatYouGet")}</dt>
                  <dd>{into.truth}</dd>
                </div>
              ) : null}
              <div>
                <dt>{word("issuerNotice")}</dt>
                <dd>
                  <a href={noticeUrl} target="_blank" rel="noreferrer noopener">
                    {noticeUrl.replace(/^https:\/\/(www\.)?/, "")} <ArrowUpRight size={12} aria-hidden="true" />
                  </a>
                  {mechanicsUrl ? (
                    <a href={mechanicsUrl} target="_blank" rel="noreferrer noopener">
                      {word("howSwapWorks")} <ArrowUpRight size={12} aria-hidden="true" />
                    </a>
                  ) : null}
                </dd>
              </div>
            </dl>
          </details>
          {failure ? <p className={company.sheetError}>{failure}</p> : null}
          {view.stale && !view.signing ? (
            <Button variant="secondary" block onClick={() => void ticket.cancelReview(true)} lang={lang}>
              {word("refreshPrice")}
            </Button>
          ) : null}
        </>
      ) : null}

      {view.stage === "result" && outcome ? (
        <>
          {outcome.kind === "FILLED" && gave !== null ? (
            <p className={company.receiptSub} translate="no">
              {`${word("receiptFor")} ${formatUnits(gave, numbers)} ${symbol}`}
            </p>
          ) : null}
          {outcome.kind === "FILLED" && outcome.note ? <p className={company.receiptNote}>{outcome.note === "BELOW_MINIMUM" ? word("belowMinimum") : word("notAsReviewed")}</p> : null}
          <div className={company.sheetActions}>
            {outcome.kind === "FILLED" ? (
              <Button variant="primary" block onClick={onClose} lang={lang}>
                {word("done")}
              </Button>
            ) : null}
            <p className={company.sheetLinks}>
              <Link href="/app/activity" prefetch={false}>
                {word("history")}
              </Link>
              {/* After a filled trade: the position as it now stands, among everything the wallet holds. */}
              {outcome.kind === "FILLED" ? (
                <Link href="/app/portfolio" prefetch={false}>
                  {word("portfolio")}
                </Link>
              ) : null}
            </p>
          </div>
        </>
      ) : null}

      {view.stage === "result" && !outcome ? (
        <>
          <p className={company.sheetNote} role="status">
            {word(swap ? "swapUnknownTx" : "saleUnknownTx")}
          </p>
          {failure ? <p className={company.sheetError}>{failure}</p> : null}
          <div className={company.sheetActions}>
            <Button variant="primary" block loading={phase === "RECOVERING"} disabled={phase === "RECOVERING"} onClick={() => void ticket.recover()} lang={lang}>
              {phase === "RECOVERING" ? word("checkingTx") : word("checkTx")}
            </Button>
            <p className={company.sheetLinks}>
              <Link href="/app/activity" prefetch={false}>
                {word("history")}
              </Link>
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** A hook the page's blocks share: which sheet is open, and the address's `?convert=1` / `?sell=1` read once on arrival. */
export function useConvertSheet(): Readonly<{ mode: ConvertMode | null; openSheet: (mode: ConvertMode) => void; close: () => void }> {
  const [mode, setMode] = useState<ConvertMode | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted: ConvertMode | null = params.get("convert") === "1" ? "swap" : params.get("sell") === "1" ? "sell" : null;
    if (!wanted) return;
    setMode(wanted);
    params.delete("convert");
    params.delete("sell");
    params.delete("from");
    const rest = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  }, []);
  return useMemo(() => ({ mode, openSheet: (next: ConvertMode) => setMode(next), close: () => setMode(null) }), [mode]);
}
