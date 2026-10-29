"use client";

import { Warning } from "@phosphor-icons/react";
import { Button, TradeTicket, amountForShare, newDraft, ticketModel, type TicketDraft, type TicketReviewed } from "@ryntra/core/ui";
import { ryntraFeeOfWhich } from "./ryntra-fee-line";
import Link from "next/link";
import { pagePath } from "@/lib/site/localized";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { approxUsd, formatUnits, unitsFromRaw, unitsPhrase } from "@/app/app/invest/company-model";
import { FIRST_PURCHASE_LAMPORTS, PURCHASE_FEE_LAMPORTS, solShort } from "@/app/app/invest/funding-model";
import { heldLine, investWords, sellableSolLine, numberLocale, reserveLine, sellForWord } from "@/app/app/invest/invest-words";
import { MIN_SALE_USD, isOverPosition, isWholePosition, solForSale, openingSaleUsd, positionUsd, saleAssetOf, unitsOf, type SaleAsset, type SaleLines } from "@/app/app/invest/sale-model";
import { useWalletData } from "@/app/app/wallet-data";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { openSolanaConnection } from "@/app/solana/workspace/connection-trigger.client";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatUsdMoney } from "@/app/solana/workspace/spot/spot-format";
import { useStockAsset } from "@/app/solana/workspace/spot/stock-context";
import { useSpotMarket } from "@/app/solana/workspace/spot/use-spot-data";
import { plainAmount, SPOT_QUOTE_ASSETS, useSpotTicket } from "@/app/solana/workspace/spot/use-spot-ticket";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { SOLANA_MAINNET_USDC_MINT } from "@/lib/solana/send-kinds";
import { swapFailureCopy } from "@/lib/solana/swap-failure-copy";
import { SPOT_SALE_SIDE } from "@/lib/spot/ticket-state";
import type { CheckBasis, CheckOrderFigures } from "@/lib/stocks/check";
import { NETWORK_LABEL, SOL_COIN, assetOf, chainUnits, referenceOf, solGas, ticketBalances, ticketMarket, ticketPrices, uiUnits, unitsOf as unitsOf_, type TicketCoin } from "@/lib/ticket/solana-ticket";

import company from "./company.module.css";
import { useSheetAboveKeyboard, useSumReadyOnDesk } from "./sheet-keyboard";
import { STOCK_VENUE, stockTicketBase, stockTicketView } from "./stock-ticket";
import { tradeFailureLine } from "./trade-failure-words";

/**
 * «Продати з позиції» — the sale of a company the wallet holds, drawn as the
 * purchase's sheet is and opened from two places: the reader's position on
 * the company's page and the position in Portfolio.
 *
 * **Намір.** A sum in dollars from $1, typed freely — the sheet opens on $10
 * when the position is worth that, a default and never advice — or a share of
 * the position in one tap: 25 %, 50 %, 75 % or 100 %, the last exactly what
 * the wallet holds. At once what it brings, from the same live quote Spot
 * shows: «≈ $9,97 USDC · усі витрати ≈ $0,03». **Межі · дозвіл.** One press,
 * «Продати на $10», prepares the exact Review on the one execution path the
 * product has (`useSpotTicket` on the sale's side: `/order` → the wallet's
 * signature over the reviewed bytes → `/execute` → `/recover`), and the Review
 * is four lines — what leaves the wallet, what arrives at least, all costs,
 * what the token is — and «Підписати». **Виконання · доказ.** The signature,
 * the network, and the receipt: «✓ Продано · $9,97».
 *
 * A private company's token says before any sum what it is and that selling
 * may not be possible, and «Перевірка» says both again; the issuer's fee on
 * the transfer is the one the chain states for the mint, on its own line
 * under «Усі витрати».
 *
 * **Цифри — сервера (contract 1.20.0).** What the sale gives and brings,
 * «Усі витрати» with the issuer's fee inside them, the reserve and «Що це»
 * are the `check` the quote and the order answer (`lib/stocks/check.ts`): the
 * sheet draws them and counts none of them, so the phone shows the same
 * figures for the same sum.
 *
 * Nothing here signs or spends: the wallet does, when the person presses.
 */

const USDC = SPOT_QUOTE_ASSETS[0];
const RAW = /^\d+$/;
/* The dollars a sale brings, a USDC each, as every sum on the page; the smallest sale is a dollar, all of a position always is. */
const USDC_COIN: TicketCoin = { mint: SOLANA_MAINNET_USDC_MINT, symbol: "USDC", decimals: 6, digits: 2 };
const MIN_SALE_RAW = BigInt(MIN_SALE_USD * 10 ** 6);

export type SellSheetProps = Readonly<{
  open: boolean;
  /** The company as its page or the position's read states it; null while it is read. */
  asset: SaleAsset | null;
  /** The head while the company is read — the position's own logo and name. */
  placeholder?: Readonly<{ mint: string; name: string; icon: string | null }> | null;
  /** The company could not be read. */
  failed?: boolean;
  /** A coin's sale (`CoinPositionSale`): its unread state is said of the coin. */
  coin?: boolean;
  /**
   * A coin's «Перевірка» lines on the order the server answered — the server
   * counts a company's (`check`, 1.20.0) and no coin's, so the coin's sale
   * hands in the count (`coinSaleLines`); the sheet draws, never counts.
   */
  linesOf?: ((order: CheckOrderFigures, basis: CheckBasis) => SaleLines | null) | null;
  locale: WorkspaceLocale;
  onClose: () => void;
  onConnect: () => void;
  /** «Швидкий продаж»: the share of the position the sheet opens on, with its Review asked for once per tap. */
  quickShare?: Readonly<{ pct: number; tap: number }> | null;
}>;

export function SellSheet(props: SellSheetProps) {
  const { open, onClose, asset, placeholder = null, failed = false, locale } = props;
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

  /* On a phone the sheet stands above the keyboard the sum raises: «Продати на $1» stays in sight. */
  useSheetAboveKeyboard(dialog, open);
  useSumReadyOnDesk(dialog, open);

  /* Nothing closes the sheet while a Review is being prepared, signed or sent: the flow keeps running and says so. */
  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  return (
    <dialog
      ref={dialog}
      className={company.sheet}
      aria-labelledby={titleId}
      data-sale
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        /* A press on the dimmed page around the sheet closes it; a press inside never reaches the dialog itself. */
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      {open || busy ? (
        asset ? (
          <SellFlow key={asset.mint} asset={asset} linesOf={props.linesOf ?? null} locale={locale} titleId={titleId} quickShare={props.quickShare ?? null} onBusy={setBusy} onClose={requestClose} onConnect={props.onConnect} />
        ) : (
          <SellPending placeholder={placeholder} failed={failed} coin={props.coin === true} locale={locale} titleId={titleId} onClose={requestClose} />
        )
      ) : null}
    </dialog>
  );
}

/**
 * The sale from a position in Portfolio: the same sheet, the company read the
 * way its page reads it (`/api/stocks/asset`, `saleAssetOf`) — the name, the
 * truth, the fee from the chain, the multiplier — while the position's own
 * logo and name stand in the head. Open while `mint` is set.
 */
export function PositionSale({ mint, placeholder, locale, onClose }: Readonly<{ mint: string | null; placeholder: SellSheetProps["placeholder"]; locale: WorkspaceLocale; onClose: () => void }>) {
  const read = useStockAsset(mint);
  const lang = locale === "uk" ? "uk" : "en";
  /* A read of the previous position is never drawn under this one's name. */
  const current = read && read.row.representation.mint === mint ? read : null;
  const asset = useMemo(() => (current ? saleAssetOf(current, lang) : null), [current, lang]);
  const connectFirst = useCallback(() => {
    onClose();
    window.requestAnimationFrame(() => openSolanaConnection());
  }, [onClose]);
  return <SellSheet open={mint !== null} asset={asset} placeholder={placeholder} failed={mint !== null && read === null} locale={locale} onClose={onClose} onConnect={connectFirst} />;
}

/** The head of every screen of the sheet: the company's logo, the screen's title, and the way out — «Ryntra попередить» wears it too. */
export function SheetHead({ mint, name, icon, title, titleId, onClose, disabled, locale }: Readonly<{ mint: string; name: string; icon: string | null; title: string; titleId: string; onClose: () => void; disabled: boolean; locale: WorkspaceLocale }>) {
  const word = investWords(locale);
  return (
    <div className={company.sheetHead}>
      <span className={company.grab} aria-hidden="true" />
      <MarketIcon mint={mint} icon={icon} symbol={name} size={32} className={company.sheetLogo} />
      <h2 id={titleId} className={company.sheetTitle}>
        {title}
      </h2>
      <Button variant="ghost" icon="x" className={company.sheetClose} onClick={onClose} disabled={disabled} aria-label={word("close")} lang={locale === "uk" ? "uk" : "en"} />
    </div>
  );
}

/** A position's company still being read, or unread: its own logo and name, and one line. */
function SellPending({ placeholder, failed, coin, locale, titleId, onClose }: Readonly<{ placeholder: SellSheetProps["placeholder"]; failed: boolean; coin: boolean; locale: WorkspaceLocale; titleId: string; onClose: () => void }>) {
  const word = investWords(locale);
  return (
    <div className={company.sheetBody} data-sheet={failed ? "sale-unread" : "sale-reading"}>
      <SheetHead mint={placeholder?.mint ?? ""} name={placeholder?.name ?? ""} icon={placeholder?.icon ?? null} title={placeholder ? `${word("sell")} ${placeholder.name}` : word("sell")} titleId={titleId} onClose={onClose} disabled={false} locale={locale} />
      {failed ? (
        <>
          <p className={company.sheetNote} role="status">
            {coin ? word("coinUnread") : word("companyUnread")}
          </p>
          <div className={company.sheetActions}>
            <Button variant="primary" block onClick={onClose} lang={locale === "uk" ? "uk" : "en"}>
              {word("close")}
            </Button>
          </div>
        </>
      ) : (
        <span className={company.lineBone} aria-hidden="true" />
      )}
    </div>
  );
}

function SellFlow({ asset, linesOf, locale, titleId, quickShare = null, onBusy, onClose, onConnect }: Readonly<{ asset: SaleAsset; linesOf: SellSheetProps["linesOf"]; locale: WorkspaceLocale; titleId: string; quickShare?: SellSheetProps["quickShare"]; onBusy: (busy: boolean) => void; onClose: () => void; onConnect: () => void }>) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const { connection } = useSolanaConnection();
  const { text } = useSolanaI18n();
  const { holdings, refresh } = useWalletData();
  const router = useRouter();
  const { mint, symbol, name, icon, unit, preIpo, truth } = asset;
  const coin = unit === "coin";
  /* SOL is the wallet's own lamports, not a token account: its row is the native one, and what may be sold leaves the network's fee behind. */
  const native = asset.nativeSol === true;
  /* The mint's decimals when the chain read did not bring them — the venue's own read; what the sale costs is the server's count (1.20.0). */
  const market = useSpotMarket(asset.decimals === null ? mint : null);
  /* «5,2 JUP» for a coin; a company's shares or tokens in words. */
  const amountWords = (value: number) => (coin ? `${formatUnits(value, numbers)} ${symbol}` : unitsPhrase(value, unit, name, lang, numbers));
  const baseDecimals = asset.decimals ?? (market.status === "ready" ? market.value.decimals : null);

  /* ------------------------------------------------------------ the position */
  const heldRow = holdings.status === "ready" ? (holdings.data.find((row) => (native ? row.kind === "NATIVE_SOL" : row.mint === mint)) ?? null) : null;
  const heldAmount = heldRow && RAW.test(heldRow.amountRaw) ? BigInt(heldRow.amountRaw) : null;
  const readRaw = heldAmount !== null ? (native ? solForSale(heldAmount) : heldAmount) : holdings.status === "ready" ? 0n : null;
  /* The position as last read, while the wallet is read again — after a signature, or a send the network refused — so an open Review is never closed by the re-read itself. */
  const [lastRaw, setLastRaw] = useState<bigint | null>(null);
  useEffect(() => {
    if (readRaw !== null) setLastRaw(readRaw);
  }, [readRaw]);
  const heldRaw = readRaw ?? lastRaw;
  /* The multiplier the page read from the chain, else the one the wallet's read carries (1.15.0): the unit the wallet shows and the venue prices. */
  const multiplier = asset.multiplier ?? heldRow?.uiMultiplier ?? null;
  const price = asset.priceUsd;
  const valueUsd = heldRaw !== null && baseDecimals !== null ? positionUsd(heldRaw, baseDecimals, multiplier, price) : null;
  const heldUnits = heldRaw !== null && baseDecimals !== null ? unitsOf(heldRaw, baseDecimals, multiplier) : null;

  /* ------------------------------------------------------------ the ticket's market */
  /* What is sold counts in the units the wallet shows; the dollars arrive as USDC, a dollar each, as every sum on the page. */
  const saleCoin: TicketCoin = useMemo(() => ({ mint, symbol, decimals: baseDecimals ?? 0, digits: 4, multiplier: native ? null : multiplier }), [mint, symbol, baseDecimals, native, multiplier]);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const priceAt = useMemo(() => (price === null ? 0 : Date.now()), [price]);
  const prices = useMemo(() => ticketPrices([{ coin: USDC_COIN, usd: 1 }, { coin: saleCoin, usd: price }], priceAt, "Jupiter"), [saleCoin, price, priceAt]);
  const reference = useMemo(() => referenceOf(price, 1, "Jupiter", priceAt), [price, priceAt]);
  const solRow = holdings.status === "ready" ? (holdings.data.find((row) => row.kind === "NATIVE_SOL") ?? null) : null;
  /* The dollars arrive in the wallet's USDC account; a wallet without one opens it, and the network would refuse a sale its SOL cannot carry. */
  const holdsUsdc = holdings.status === "ready" && holdings.data.some((row) => row.mint === SOLANA_MAINNET_USDC_MINT && RAW.test(row.amountRaw) && BigInt(row.amountRaw) > 0n);
  const balances = !connection
    ? null
    : heldRaw === null
      ? {}
      : ticketBalances([
          { coin: saleCoin, raw: heldRaw },
          ...(native ? [] : [{ coin: SOL_COIN, raw: solRow?.amountRaw ?? (holdings.status === "ready" && holdings.complete ? "0" : null) }]),
        ]);
  /* SOL sold is already what the fee leaves; any other sale needs SOL for the fee, and the USDC account when the wallet has none. */
  const gas = useMemo(() => (native ? solGas(0n) : solGas(holdsUsdc ? PURCHASE_FEE_LAMPORTS : FIRST_PURCHASE_LAMPORTS)), [native, holdsUsdc]);

  /* ------------------------------------------------------------ the sum */
  /* The sum opens once the position is read: $10 when it is worth that, else no sum — never a preselected sale of everything. */
  const [amountText, setAmountText] = useState<string | null>(null);
  const [amountUnit, setAmountUnit] = useState<"token" | "usd">("usd");
  useEffect(() => {
    if (amountText !== null || heldRaw === null || baseDecimals === null) return;
    const opening = openingSaleUsd(valueUsd);
    setAmountText(opening === null ? "" : String(opening));
  }, [amountText, heldRaw, baseDecimals, valueUsd]);
  const draft: TicketDraft = newDraft({ side: "sell", unit: amountUnit, amount: amountText ?? "" });
  const heldShown = heldRaw !== null ? uiUnits(heldRaw, saleCoin) : null;
  /* Dollars typed within half a cent of the position's value are all of it — the value the page shows, typed back, sells
     the whole position; beyond that half cent they are more than the position (`isWholePosition`, `isOverPosition`). */
  const typedUsd = amountUnit === "usd" && (amountText ?? "").trim() !== "" ? Number((amountText ?? "").replace(/\s/g, "").replace(",", ".")) : null;
  const usdOver = typedUsd !== null && isOverPosition(typedUsd, valueUsd);
  const usdWhole = typedUsd !== null && !usdOver && isWholePosition(typedUsd, valueUsd) && heldShown !== null && heldShown > 0n;
  /* So the ticket counts such a sum as all of the position, not as half a cent more than the wallet holds. */
  const typedAsPaid = usdWhole ? unitsOf_(ticketModel(stockTicketBase({ side: "sell", market: ticketMarket({ id: mint, base: saleCoin, quote: USDC_COIN, price, minQuoteRaw: null }), base: saleCoin, quote: USDC_COIN, draft, balances: {}, prices, reference, gas, unavailable: null, now: clock }), lang).paid) : null;
  const wholeRoom = heldShown !== null && typedAsPaid !== null && typedAsPaid > heldShown ? typedAsPaid : heldShown;
  const saleBalances = usdWhole && balances && wholeRoom !== null ? { ...balances, [assetOf(saleCoin.mint)]: { units: wholeRoom.toString(), asset: assetOf(saleCoin.mint), decimals: saleCoin.decimals } } : balances;
  /* A sale of all the ticket shows is the whole position: no smallest sum stands in its way. */
  const draftModel = (minimum: boolean) =>
    ticketModel(stockTicketBase({ side: "sell", market: ticketMarket({ id: mint, base: saleCoin, quote: USDC_COIN, price, minQuoteRaw: minimum ? MIN_SALE_RAW : null }), base: saleCoin, quote: USDC_COIN, draft, balances: saleBalances, prices, reference, gas, unavailable: null, now: clock }), lang);
  const open = draftModel(false);
  const typedShown = usdWhole ? heldShown : unitsOf_(open.paid);
  const whole = usdWhole || (typedShown !== null && heldShown !== null && heldShown > 0n && typedShown >= heldShown);
  const ticketMarketOf = useMemo(() => ticketMarket({ id: mint, base: saleCoin, quote: USDC_COIN, price, minQuoteRaw: whole ? null : MIN_SALE_RAW }), [mint, saleCoin, price, whole]);
  const typed = whole ? open : draftModel(true);
  /* What the chain moves for what was typed: never more than the position, all of it when all of it was typed. */
  const saleRaw = typedShown === null || heldRaw === null || heldRaw <= 0n ? null : chainUnits(typedShown, saleCoin, heldRaw);
  /* The smallest sale is the sum typed, as it always was: a $1 sale whose quote brings $0,99 after costs is still a $1 sale.
     Once the typed sum passes, the venue's answer is not measured against it again. */
  const viewMarket = useMemo(() => (typed.fieldError === null && price !== null ? ticketMarket({ id: mint, base: saleCoin, quote: USDC_COIN, price, minQuoteRaw: null }) : ticketMarketOf), [typed.fieldError, mint, saleCoin, price, ticketMarketOf]);
  const over = usdOver || (!usdWhole && typedShown !== null && heldShown !== null && typedShown > heldShown);
  const valid = saleRaw !== null && saleRaw > 0n && !over && typed.fieldError === null && baseDecimals !== null;
  const amount = valid && baseDecimals !== null ? plainAmount(saleRaw.toString(), baseDecimals) : "";

  /* ------------------------------------------------------- the one execution path */
  const ticket = useSpotTicket({
    connection,
    side: SPOT_SALE_SIDE,
    baseMint: mint,
    baseDecimals,
    baseSymbol: symbol,
    quote: USDC,
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

  /* ------------------------------------------------------------ the wallet */
  const cannotPayFee = connection !== null && solRow !== null && RAW.test(solRow.amountRaw) && solShort(BigInt(solRow.amountRaw), holdsUsdc);
  const topUpSol = useCallback(() => {
    const back = encodeURIComponent(pagePath(window.location.pathname));
    router.push(`/app/top-up?need=sol&from=${back}`);
  }, [router]);

  /* ------------------------------------------------------------ what it brings — as the server counts it */
  /*
   * «Перевірка» from the server (contract 1.20.0): what the sale gives, what it
   * brings, all costs with the issuer's fee from the chain inside them are the
   * quote's `check`, and once a Review is prepared, the order's — with the
   * reserve the simulation proved. The sheet draws them and counts none of
   * them, so the phone shows the same figures.
   */
  const check: SaleLines | null = useMemo(() => {
    if (!linesOf) return prepared ? (prepared.check ?? null) : (quoted?.check ?? null);
    /* A coin's: the same order, its lines handed in by the coin's sale. */
    const order = prepared?.order ?? quoted?.order ?? null;
    return order ? linesOf(order, prepared ? "order" : "quote") : null;
  }, [linesOf, prepared, quoted]);
  const quoteFailure = ticket.quoteFailure && amount ? tradeFailureLine(ticket.quoteFailure, ticket.quoteFailureMessage, "sell", lang) : null;
  const quoteStop = ticket.quoteFailure ? !swapFailureCopy(ticket.quoteFailure.code, text).retryable : false;
  const blocked = quoted?.verdict.verdict === "BLOCKED";
  const failure = (() => {
    const code = ticket.actionFailure?.code ?? null;
    if (code === "WALLET_REFUSED") return word("walletDeclined");
    return tradeFailureLine(ticket.actionFailure, ticket.actionFailureMessage, "sell", lang);
  })();
  /* «Усі витрати» as the server counted them, with the issuer's and Ryntra's parts on their own lines. */
  const countOf = (lines: SaleLines | null, order: Parameters<typeof ryntraFeeOfWhich>[0]) => {
    if (!lines?.costs || !amount) return {};
    const parts: { label: string; value: string }[] = [];
    if (lines.costs.issuerFee) parts.push({ label: word("issuerFeeOfWhich"), value: `${new Intl.NumberFormat(numbers, { maximumFractionDigits: 2 }).format(lines.costs.issuerFee.basisPoints / 100)}% ${approxUsd(lines.costs.issuerFee.usd, numbers)}` });
    const ryntra = ryntraFeeOfWhich(order, "", numbers);
    if (ryntra) parts.push({ label: word("ryntraFeeOfWhich"), value: ryntra.trim() });
    return { costLines: parts, costsTotal: approxUsd(lines.costs.usd, numbers) };
  };

  const view = stockTicketView({
    agreed,
    side: "sell",
    market: viewMarket,
    base: saleCoin,
    quote: USDC_COIN,
    draft,
    balances: saleBalances,
    prices,
    reference,
    gas,
    spot: { phase, quoted, quoting: ticket.quoting, prepared, preparedReadiness: ticket.preparedReadiness, bytesChanged: ticket.bytesChanged, reviewSecondsLeft: ticket.reviewSecondsLeft, settled, attempt },
    quoteFailed: amount ? quoteFailure : null,
    unavailable: !asset.sellable || blocked || quoteStop ? word("saleUnavailable") : null,
    holding: false,
    time: new Intl.DateTimeFormat(numbers, { hour: "2-digit", minute: "2-digit" }).format(new Date(clock)),
    lang,
    now: clock,
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

  /* One tap from a quick share: the share goes in once the position is read, and its Review is asked for once the sale can be judged — or the sheet says what stands in the way and waits for the person. */
  const quickPicked = useRef(0);
  const [quickArmed, setQuickArmed] = useState<Readonly<{ tap: number; text: string }> | null>(null);
  useEffect(() => {
    if (!quickShare || quickPicked.current === quickShare.tap || heldRaw === null || baseDecimals === null) return;
    quickPicked.current = quickShare.tap;
    const share = amountForShare(open, quickShare.pct, "token", prices, lang);
    setAmountUnit("token");
    setAmountText(share);
    setQuickArmed({ tap: quickShare.tap, text: share });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickShare, heldRaw, baseDecimals]);
  const { review: openReview } = ticket;
  useEffect(() => {
    if (!quickArmed || !quickShare) return;
    /* The person chose another share before the sale could be judged: the tap is theirs no longer. */
    if (amountText !== quickArmed.text) {
      setQuickArmed(null);
      return;
    }
    if (!connection || holdings.status !== "ready") return;
    if (attempt || phase !== "IDLE" || !valid || cannotPayFee || blocked || !asset.sellable) {
      setQuickArmed(null);
      return;
    }
    setQuickArmed(null);
    void openReview();
  }, [quickArmed, quickShare, amountText, connection, holdings.status, attempt, phase, valid, cannotPayFee, blocked, asset.sellable, openReview]);

  const head = (title: string) => <SheetHead mint={mint} name={name} icon={icon} title={title} titleId={titleId} onClose={onClose} disabled={working} locale={locale} />;

  /* The receipt's title, as the sheet's head. */
  const context = ticket.settledContext;
  const gotRaw = settled?.observation?.actualOutputRaw ?? null;
  const gaveRaw = settled?.observation?.actualInputRaw ?? null;
  const got = gotRaw && RAW.test(gotRaw) ? Number(gotRaw) / 10 ** (context?.quoteDecimals ?? USDC.decimals) : null;
  const gave = gaveRaw ? unitsFromRaw(gaveRaw, context?.baseDecimals ?? baseDecimals, multiplier) : null;
  const receiptTitle = outcome
    ? outcome.kind === "FILLED"
      ? `${word("sold")}${got !== null ? ` · ${formatUsdMoney(got, numbers)}` : ""}`
      : outcome.kind === "NOTHING_HAPPENED"
        ? word("nothingSold")
        : outcome.kind === "NOT_FILLED"
          ? word("saleRejected")
          : word("saleUnknownTx")
    : null;

  /* The order's own lines in Review: «Що це» as the server says it — the truth and, on a private company's token, «Продати може не вийти». */
  const inReview = view.stage === "review";
  const lines = inReview ? check : null;
  const reserve = lines?.reserve?.usd ? approxUsd(lines.reserve.usd, numbers) : null;
  const whatLine = lines ? lines.what.truth[lang] : truth;
  const mayFail = lines ? (lines.what.note?.kind === "sale-may-fail" ? lines.what.note[lang] : null) : preIpo ? word("saleMayFail") : null;
  const none = connection !== null && heldRaw === 0n;
  const sheetName = view.stage === "review" ? "review" : view.stage === "result" ? (outcome ? "receipt" : "recovery") : "compose";

  return (
    <div className={company.sheetBody} data-sheet={sheetName} data-sale-compose={view.stage === "form" ? true : undefined} data-sale-review={inReview ? true : undefined} data-sale-receipt={outcome ? true : undefined} data-check={inReview ? (lines ? lines.basis : "none") : undefined}>
      {head(receiptTitle ?? (inReview ? word("review") : view.stage === "result" ? name : `${word("sell")} ${name}`))}
      {/* A private company's token: what it is, and that selling may not be possible, before any sum. */}
      {view.stage === "form" && preIpo ? (
        <div className={company.sheetWarning} data-sale-caution>
          <p data-company-truth>{truth}</p>
          <p className={company.warningEvent} data-sale-may-fail>
            <Warning size={16} weight="bold" aria-hidden="true" />
            <span>{word("saleMayFail")}</span>
          </p>
        </div>
      ) : null}
      {view.stage === "form" && none ? (
        <>
          <p className={company.sheetNote} data-empty="token">
            {native ? word("solKeptForFees") : coin ? word("nothingToSellCoin") : word("nothingToSell")}
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
          {...countOf(check, prepared?.order ?? quoted?.order ?? null)}
          whatItIs={
            inReview ? (
              <>
                {whatLine}
                {mayFail ? <span data-sale-may-fail> {mayFail}</span> : null}
              </>
            ) : undefined
          }
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
          {valid && cannotPayFee ? (
            <>
              <p className={company.sheetNote} data-empty="sol">
                {word("needSol")}
              </p>
              <Button variant="secondary" block icon="wallet" onClick={topUpSol} lang={lang}>
                {word("topUpSol")}
              </Button>
            </>
          ) : null}
          {over && valueUsd !== null && heldShown !== null && heldShown > 0n ? (
            <>
              <p className={company.sheetNote} data-sale-over="true">
                {`${word("overPosition")} · ${formatUsdMoney(valueUsd, numbers)}`}
              </p>
              <Button
                variant="secondary"
                block
                onClick={() => {
                  setAmountUnit("token");
                  setAmountText(amountForShare(open, 100, "token", prices, lang));
                }}
                lang={lang}
              >
                {sellForWord(locale, formatUsdMoney(valueUsd, numbers), true)}
              </Button>
            </>
          ) : null}
          {failure ? <p className={company.sheetError}>{failure}</p> : null}
          {heldUnits !== null && heldUnits > 0 ? (
            <p className={company.sheetLinks}>
              <span translate="no">{(native ? sellableSolLine : heldLine)(locale, amountWords(heldUnits), valueUsd !== null ? formatUsdMoney(valueUsd, numbers) : null)}</span>
            </p>
          ) : null}
        </>
      ) : null}

      {inReview ? (
        <>
          {/* The account the sale opens for the dollars, if the wallet has none: its own line, never a cost — it stays in the wallet. */}
          {reserve ? <p className={company.sheetNote} data-reserve>{reserveLine(locale, reserve)}</p> : null}
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
          {outcome.kind === "FILLED" && gave !== null ? <p className={company.receiptSub}>{amountWords(gave)}</p> : null}
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
        /* An order whose answer is still being looked for: never sent again, only checked. */
        <>
          <p className={company.sheetNote} role="status">
            {word("saleUnknownTx")}
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
