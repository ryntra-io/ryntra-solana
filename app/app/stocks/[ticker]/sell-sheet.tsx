"use client";

import { ArrowUpRight, CheckCircle, Warning, X, XCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { approxUsd, dollars, parseDollars, unitsFromRaw, unitsPhrase } from "@/app/app/invest/company-model";
import { solShort } from "@/app/app/invest/funding-model";
import { heldLine, investWords, numberLocale, reserveLine, sellForWord } from "@/app/app/invest/invest-words";
import { isOverPosition, isWholePosition, MIN_SALE_USD, openingSaleUsd, positionUsd, rawForUsd, SALE_SHARE_PRESETS_PCT, saleAssetOf, shareRaw, shareUsd, unitsOf, type SaleAsset } from "@/app/app/invest/sale-model";
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
import { classifySpotFill } from "@/lib/solana/fill-outcome";
import { SOLANA_MAINNET_USDC_MINT } from "@/lib/solana/send-kinds";
import { swapFailureCopy } from "@/lib/solana/swap-failure-copy";
import { SPOT_SALE_SIDE } from "@/lib/spot/ticket-state";
import type { SwapCheck } from "@/lib/stocks/check";

import company from "./company.module.css";
import { useSheetAboveKeyboard } from "./sheet-keyboard";
import { SumField } from "./sum-field";

/**
 * «Продати з позиції» — the sale of a company the wallet holds
 * (`RYN-BUY-FLOW-001`, subtask 1; canon v5.6 §4 «Купити за 60 с · продати»),
 * drawn as the purchase's sheet is and opened from two places: the reader's
 * position on the company's page and the position in Portfolio.
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
 * A private company's token (canon §6.2, §7) says before any sum what it is
 * and that selling may not be possible, and «Перевірка» says both again; the
 * issuer's fee on the transfer is the one the chain states for the mint, on
 * its own line under «Усі витрати».
 *
 * **Цифри — сервера (contract 1.20.0; `RYN-BUY-FLOW-001`, subtask 2).** What
 * the sale gives and brings, «Усі витрати» with the issuer's fee inside them,
 * the reserve and «Що це» are the `check` the quote and the order answer
 * (`lib/stocks/check.ts`): the sheet draws them and counts none of them, so
 * the phone shows the same figures for the same sum.
 *
 * Nothing here signs or spends: the wallet does, when the person presses.
 */

const USDC = SPOT_QUOTE_ASSETS[0];
const RAW = /^\d+$/;

export type SellSheetProps = Readonly<{
  open: boolean;
  /** The company as its page or the position's read states it; null while it is read. */
  asset: SaleAsset | null;
  /** The head while the company is read — the position's own logo and name. */
  placeholder?: Readonly<{ mint: string; name: string; icon: string | null }> | null;
  /** The company could not be read. */
  failed?: boolean;
  locale: WorkspaceLocale;
  onClose: () => void;
  onConnect: () => void;
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

  /* On a phone the sheet stands above the keyboard the sum raises: «Продати на $1» stays in sight (`RYN-BUY-FLOW-001`, subtask 5). */
  useSheetAboveKeyboard(dialog, open);

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
          <SellFlow key={asset.mint} asset={asset} locale={locale} titleId={titleId} onBusy={setBusy} onClose={requestClose} onConnect={props.onConnect} />
        ) : (
          <SellPending placeholder={placeholder} failed={failed} locale={locale} titleId={titleId} onClose={requestClose} />
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
      <button type="button" className={company.sheetClose} onClick={onClose} disabled={disabled} aria-label={word("close")}>
        <X size={18} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}

/** A position's company still being read, or unread: its own logo and name, and one line. */
function SellPending({ placeholder, failed, locale, titleId, onClose }: Readonly<{ placeholder: SellSheetProps["placeholder"]; failed: boolean; locale: WorkspaceLocale; titleId: string; onClose: () => void }>) {
  const word = investWords(locale);
  return (
    <div className={company.sheetBody} data-sheet={failed ? "sale-unread" : "sale-reading"}>
      <SheetHead mint={placeholder?.mint ?? ""} name={placeholder?.name ?? ""} icon={placeholder?.icon ?? null} title={placeholder ? `${word("sell")} ${placeholder.name}` : word("sell")} titleId={titleId} onClose={onClose} disabled={false} locale={locale} />
      {failed ? (
        <>
          <p className={company.sheetNote} role="status">
            {word("companyUnread")}
          </p>
          <div className={company.sheetActions}>
            <button type="button" className="rw-btn rw-btn--primary" onClick={onClose}>
              {word("close")}
            </button>
          </div>
        </>
      ) : (
        <span className={company.lineBone} aria-hidden="true" />
      )}
    </div>
  );
}

function SellFlow({ asset, locale, titleId, onBusy, onClose, onConnect }: Readonly<{ asset: SaleAsset; locale: WorkspaceLocale; titleId: string; onBusy: (busy: boolean) => void; onClose: () => void; onConnect: () => void }>) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const { connection } = useSolanaConnection();
  const { text } = useSolanaI18n();
  const { holdings, refresh } = useWalletData();
  const router = useRouter();
  const { mint, symbol, name, icon, unit, preIpo, truth } = asset;
  /* The mint's decimals when the chain read did not bring them — the venue's own read; what the sale costs is the server's count (1.20.0). */
  const market = useSpotMarket(asset.decimals === null ? mint : null);
  const baseDecimals = asset.decimals ?? (market.status === "ready" ? market.value.decimals : null);

  /* ------------------------------------------------------------ the position */
  const heldRow = holdings.status === "ready" ? (holdings.data.find((row) => row.mint === mint) ?? null) : null;
  const readRaw = heldRow && RAW.test(heldRow.amountRaw) ? BigInt(heldRow.amountRaw) : holdings.status === "ready" ? 0n : null;
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

  /* ------------------------------------------------------------ the sum */
  /* The sum opens once the position is read: $10 when it is worth that, else no sum — never a preselected sale of everything. */
  const [amountText, setAmountText] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  useEffect(() => {
    if (amountText !== null || heldRaw === null || baseDecimals === null) return;
    const opening = openingSaleUsd(valueUsd);
    setAmountText(opening === null ? "" : String(opening));
  }, [amountText, heldRaw, baseDecimals, valueUsd]);

  const typed = amountText === null ? null : parseDollars(amountText, lang);
  const over = pct === null && typed !== null && isOverPosition(typed, valueUsd);
  const whole = pct === 100 || (pct === null && typed !== null && !over && isWholePosition(typed, valueUsd));
  const saleRaw = heldRaw === null || heldRaw <= 0n ? null : pct !== null ? shareRaw(heldRaw, pct) : typed !== null && !over ? rawForUsd(typed, heldRaw, baseDecimals, multiplier, price) : null;
  /* A sum under a dollar is not a sale; the whole position always is (canon v5.5 В35). */
  const belowMinimum = !whole && typed !== null && typed < MIN_SALE_USD - 1e-9;
  const valid = saleRaw !== null && saleRaw > 0n && !over && !belowMinimum && baseDecimals !== null;
  const amount = valid && baseDecimals !== null ? plainAmount(saleRaw.toString(), baseDecimals) : "";

  const pickShare = (value: number) => {
    if (heldRaw === null || baseDecimals === null) return;
    const usd = shareUsd(heldRaw, baseDecimals, multiplier, price, value);
    setPct(value);
    setAmountText(usd === null ? "" : String(usd));
  };
  const typeSum = (value: string) => {
    setPct(null);
    setAmountText(value);
  };

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
  const working = phase === "PREPARING" || phase === "SIGNING" || phase === "EXECUTING" || phase === "RECOVERING";
  useEffect(() => {
    onBusy(working);
  }, [working, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);

  /* ------------------------------------------------------------ the wallet */
  const solRow = holdings.status === "ready" ? (holdings.data.find((row) => row.kind === "NATIVE_SOL") ?? null) : null;
  /* The dollars arrive in the wallet's USDC account; a wallet without one opens it, and the network would refuse a sale its SOL cannot carry. */
  const holdsUsdc = holdings.status === "ready" && holdings.data.some((row) => row.mint === SOLANA_MAINNET_USDC_MINT && RAW.test(row.amountRaw) && BigInt(row.amountRaw) > 0n);
  const cannotPayFee = connection !== null && solRow !== null && RAW.test(solRow.amountRaw) && solShort(BigInt(solRow.amountRaw), holdsUsdc);
  const topUpSol = useCallback(() => {
    const back = encodeURIComponent(window.location.pathname);
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
  const check: SwapCheck | null = prepared ? (prepared.check ?? null) : (quoted?.check ?? null);
  const outUsdc = check?.get.amount ?? null;
  const costs = amount ? (check?.costs ?? null) : null;
  /* «з них комісія емітента 3% ≈ $0,03» — the share of the sale the mint withholds on the transfer, at the rate the chain states (canon v5.2 §7, §12). */
  const issuerFee = costs?.issuerFee ? `${word("issuerFeeOfWhich")} ${new Intl.NumberFormat(numbers, { maximumFractionDigits: 2 }).format(costs.issuerFee.basisPoints / 100)}% ${approxUsd(costs.issuerFee.usd, numbers).replace(" ", " ")}` : null;
  /* The server answered the quote without its lines (the company could not be read): nothing is counted here in their place. */
  const uncounted = Boolean(amount) && quoted !== null && outUsdc === null;
  const quoteFailure = ticket.quoteFailure && amount ? ticket.quoteFailureMessage : null;
  const quoteStop = ticket.quoteFailure ? !swapFailureCopy(ticket.quoteFailure.code, text).retryable : false;
  const blocked = quoted?.verdict.verdict === "BLOCKED";
  const failure = (() => {
    const code = ticket.actionFailure?.code ?? null;
    if (code === "WALLET_REFUSED") return word("walletDeclined");
    return ticket.actionFailureMessage ?? null;
  })();

  const head = (title: string) => <SheetHead mint={mint} name={name} icon={icon} title={title} titleId={titleId} onClose={onClose} disabled={working} locale={locale} />;

  /* ------------------------------------------------------------ the receipt */
  const outcome = phase === "SETTLED" && settled ? classifySpotFill(settled) : null;
  if (outcome) {
    const context = ticket.settledContext;
    const gotRaw = settled?.observation?.actualOutputRaw ?? null;
    const gaveRaw = settled?.observation?.actualInputRaw ?? null;
    const got = gotRaw && RAW.test(gotRaw) ? Number(gotRaw) / 10 ** (context?.quoteDecimals ?? USDC.decimals) : null;
    const gave = gaveRaw ? unitsFromRaw(gaveRaw, context?.baseDecimals ?? baseDecimals, multiplier) : null;
    const tone = outcome.kind === "FILLED" ? (outcome.note === null ? "matched" : "caution") : outcome.kind === "NOT_FILLED" ? "risk" : outcome.kind === "NOTHING_HAPPENED" ? "quiet" : "caution";
    const title =
      outcome.kind === "FILLED"
        ? `${word("sold")}${got !== null ? ` · ${formatUsdMoney(got, numbers)}` : ""}`
        : outcome.kind === "NOTHING_HAPPENED"
          ? word("nothingSold")
          : outcome.kind === "NOT_FILLED"
            ? word("saleRejected")
            : word("saleUnknownTx");
    return (
      <div className={company.sheetBody} data-sheet="receipt" data-sale-receipt>
        {head(name)}
        <div className={company.receipt} data-tone={tone} role="status">
          <span className={company.receiptMark} aria-hidden="true">
            {tone === "matched" ? <CheckCircle size={44} weight="fill" /> : tone === "risk" ? <XCircle size={44} weight="fill" /> : <Warning size={44} weight="fill" />}
          </span>
          <p className={company.receiptTitle} translate="no">
            {title}
          </p>
          {outcome.kind === "FILLED" && gave !== null ? <p className={company.receiptSub}>{unitsPhrase(gave, unit, name, lang, numbers)}</p> : null}
          {outcome.kind === "FILLED" && outcome.note ? <p className={company.receiptNote}>{outcome.note === "BELOW_MINIMUM" ? word("belowMinimum") : word("notAsReviewed")}</p> : null}
        </div>
        <div className={company.sheetActions}>
          {outcome.kind === "FILLED" ? (
            <button type="button" className="rw-btn rw-btn--primary" onClick={onClose}>
              {word("done")}
            </button>
          ) : (
            <button type="button" className="rw-btn rw-btn--primary" onClick={() => ticket.reset()}>
              {word("tryAgain")}
            </button>
          )}
          <p className={company.sheetLinks}>
            <Link href="/app/activity" prefetch={false}>
              {word("history")}
            </Link>
            {settled && outcome.kind !== "NOTHING_HAPPENED" ? (
              <a href={explorerTxUrl("mainnet", settled.signature)} target="_blank" rel="noreferrer noopener">
                {word("transaction")} <ArrowUpRight size={12} aria-hidden="true" />
              </a>
            ) : null}
          </p>
        </div>
      </div>
    );
  }

  if (phase === "RECOVERY" || phase === "RECOVERING" || attempt) {
    return (
      <div className={company.sheetBody} data-sheet="recovery">
        {head(name)}
        <p className={company.sheetNote} role="status">
          {word("saleUnknownTx")}
        </p>
        {failure ? <p className={company.sheetError}>{failure}</p> : null}
        <div className={company.sheetActions}>
          <button type="button" className="rw-btn rw-btn--primary" disabled={phase === "RECOVERING"} onClick={() => void ticket.recover()}>
            {phase === "RECOVERING" ? word("checkingTx") : word("checkTx")}
          </button>
          <p className={company.sheetLinks}>
            <Link href="/app/activity" prefetch={false}>
              {word("history")}
            </Link>
          </p>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------ the Review */
  const inReview = (phase === "REVIEW" || phase === "SIGNING" || phase === "EXECUTING") && prepared !== null;
  if (inReview && prepared) {
    /* The order's own lines, as the server counted them on these exact bytes (1.20.0); a figure it could not count is a dash, never one counted here. */
    const lines = prepared.check ?? null;
    const sellUnits = lines?.spend.amount ?? null;
    const sellUsd = lines?.spend.usd ?? null;
    const minUsdc = lines?.get.atLeast ?? null;
    const ready = ticket.preparedReadiness?.ready === true;
    const seconds = ticket.reviewSecondsLeft;
    /* The account the sale opens for the dollars, if the wallet has none: its own line, never a cost — it stays in the wallet (canon v5.5 В35). */
    const reserve = lines?.reserve?.usd ? approxUsd(lines.reserve.usd, numbers) : null;
    /* «Що це» as the server says it — the truth and, on a private company's token, «Продати може не вийти»; the page's own words only when the server could not read the company. */
    const whatLine = lines ? lines.what.truth[lang] : truth;
    const mayFail = lines ? (lines.what.note?.kind === "sale-may-fail" ? lines.what.note[lang] : null) : preIpo ? word("saleMayFail") : null;
    const caution = lines ? lines.what.caution : preIpo;
    return (
      <div className={company.sheetBody} data-sheet="review" data-sale-review data-check={lines ? lines.basis : "none"}>
        {head(word("review"))}
        <dl className={company.review} aria-label={word("review")}>
          <div>
            <dt>{word("rowSell")}</dt>
            <dd translate="no">
              {sellUnits === null ? "—" : unitsPhrase(sellUnits, unit, name, lang, numbers)}
              {sellUsd !== null ? <span>{approxUsd(sellUsd, numbers)}</span> : null}
            </dd>
          </div>
          <div>
            <dt>{word("rowGet")}</dt>
            <dd translate="no">
              {outUsdc === null ? "—" : `≈ ${formatUsdMoney(outUsdc, numbers)} USDC`}
              {minUsdc !== null ? <span>{`${word("atLeast")} ${formatUsdMoney(minUsdc, numbers)}`}</span> : null}
            </dd>
          </div>
          <div>
            <dt>{word("rowCosts")}</dt>
            <dd translate="no">
              {costs ? approxUsd(costs.usd, numbers) : "—"}
              {issuerFee ? <span data-issuer-fee>{issuerFee}</span> : null}
            </dd>
            {reserve ? <dd data-reserve>{reserveLine(locale, reserve)}</dd> : null}
          </div>
          <div>
            <dt>{word("rowWhat")}</dt>
            <dd data-prose="true" data-caution={caution ? "true" : undefined}>
              {whatLine}
              {mayFail ? <span data-sale-may-fail>{mayFail}</span> : null}
            </dd>
          </div>
        </dl>
        {failure ? <p className={company.sheetError}>{failure}</p> : null}
        <p className={company.sheetTimer} aria-live="off">
          {ready && seconds !== null && seconds > 0 ? `${word("priceHolds")} ${seconds} ${word("seconds")}` : ready ? "" : word("priceExpired")}
        </p>
        <div className={company.sheetActions}>
          {phase === "SIGNING" || phase === "EXECUTING" ? (
            <button type="button" className="rw-btn rw-btn--primary" disabled>
              {phase === "SIGNING" ? word("inWallet") : word("sending")}
            </button>
          ) : ready && !ticket.bytesChanged ? (
            <button type="button" className="rw-btn rw-btn--primary" onClick={() => void ticket.sign()}>
              {word("sign")}
            </button>
          ) : (
            <button type="button" className="rw-btn rw-btn--primary" onClick={() => void ticket.cancelReview(true)}>
              {word("refreshPrice")}
            </button>
          )}
          <button type="button" className={company.quietButton} disabled={working} onClick={() => void ticket.cancelReview()}>
            {word("cancel")}
          </button>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------ compose */
  const none = connection !== null && heldRaw === 0n;
  const sumWord = typed !== null ? dollars(typed, numbers) : null;
  const cta = (() => {
    if (ticket.lockedReview) return { label: word("refreshPrice"), disabled: false, run: () => void ticket.cancelReview(true) };
    if (!connection) return { label: word("connectWallet"), disabled: false, run: onConnect };
    if (holdings.status !== "ready" || baseDecimals === null) return { label: word("reading"), disabled: true, run: undefined };
    if (none) return { label: word("done"), disabled: false, run: onClose };
    if (!asset.sellable) return { label: word("saleUnavailable"), disabled: true, run: undefined };
    /* More than the position is never a dead button: the one action puts in all of it. */
    if (over && valueUsd !== null) return { label: sellForWord(locale, formatUsdMoney(valueUsd, numbers), true), disabled: false, run: () => pickShare(100) };
    if (belowMinimum) return { label: word("minimum"), disabled: true, run: undefined };
    if (!valid || sumWord === null) return { label: word("sell"), disabled: true, run: undefined };
    if (phase === "PREPARING") return { label: word("preparingReview"), disabled: true, run: undefined };
    if (cannotPayFee) return { label: word("topUpSol"), disabled: false, run: topUpSol };
    if (blocked || quoteStop) return { label: word("saleUnavailable"), disabled: true, run: undefined };
    return { label: sellForWord(locale, sumWord, whole), disabled: false, run: () => void ticket.review() };
  })();
  const estimateLine = (() => {
    if (none || amountText === null) return " ";
    if (over && valueUsd !== null) return `${word("overPosition")} · ${formatUsdMoney(valueUsd, numbers)}`;
    if (!valid) return " ";
    /* The server's figures: what the sale brings and all costs; a cost it could not count is a dash. */
    if (outUsdc !== null) return `≈ ${formatUsdMoney(outUsdc, numbers)} USDC · ${word("allCosts")} ${costs ? approxUsd(costs.usd, numbers) : "—"}`;
    if (uncounted) return " ";
    return quoteFailure ?? word("pricing");
  })();

  return (
    <div className={company.sheetBody} data-sheet="compose" data-sale-compose>
      {head(`${word("sell")} ${name}`)}
      {/* A private company's token: what it is, and that selling may not be possible, before any sum (canon §6.2, §7). */}
      {preIpo ? (
        <div className={company.sheetWarning} data-sale-caution>
          <p data-company-truth>{truth}</p>
          <p className={company.warningEvent} data-sale-may-fail>
            <Warning size={16} weight="bold" aria-hidden="true" />
            <span>{word("saleMayFail")}</span>
          </p>
        </div>
      ) : null}
      {none ? (
        <p className={company.sheetNote} data-empty="token">
          {word("nothingToSell")}
        </p>
      ) : (
        <>
          {/* A press chooses the whole sum and the keyboard's own key is the one action (`sum-field.tsx`): $1 is a tap and a key from the sheet's $10. */}
          <SumField
            value={amountText ?? ""}
            onChange={typeSum}
            onGo={() => {
              if (!cta.disabled) cta.run?.();
            }}
            label={word("amount")}
            describedBy={`${titleId}-estimate`}
            placeholder="0"
            disabled={working || amountText === null}
          />
          {/* The quick choices are shares of the position — 25 · 50 · 75 · 100 %; a share under a dollar is not offered, all of it always is. */}
          {heldRaw !== null && heldRaw > 0n && baseDecimals !== null ? (
            <div className={company.presets} role="group" aria-label={word("quickPositionShares")}>
              {SALE_SHARE_PRESETS_PCT.map((value) => {
                const usd = shareUsd(heldRaw, baseDecimals, multiplier, price, value);
                return (
                  <button key={value} type="button" className={company.preset} aria-pressed={pct === value} disabled={working || (value < 100 && (usd === null || usd < MIN_SALE_USD))} onClick={() => pickShare(value)}>
                    {`${value}%`}
                  </button>
                );
              })}
            </div>
          ) : null}
          <p id={`${titleId}-estimate`} className={company.estimate} aria-live="polite" data-sale-over={over ? "true" : undefined}>
            {estimateLine}
          </p>
          {valid && cannotPayFee ? (
            <p className={company.sheetNote} data-empty="sol">
              {word("needSol")}
            </p>
          ) : null}
        </>
      )}
      {failure ? <p className={company.sheetError}>{failure}</p> : null}
      <div className={company.sheetActions}>
        <button type="button" className="rw-btn rw-btn--primary" disabled={cta.disabled} onClick={cta.run}>
          {cta.label}
        </button>
        {heldUnits !== null && heldUnits > 0 ? (
          <p className={company.sheetLinks}>
            <span translate="no">{heldLine(locale, unitsPhrase(heldUnits, unit, name, lang, numbers), valueUsd !== null ? formatUsdMoney(valueUsd, numbers) : null)}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
