"use client";

import { ArrowUpRight, CheckCircle, Warning, X, XCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { approxUsd, buyCosts, dollars, formatUnits, unitsFromRaw } from "@/app/app/invest/company-model";
import { solShort } from "@/app/app/invest/funding-model";
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
import { classifySpotFill } from "@/lib/solana/fill-outcome";
import { WRAPPED_SOL_MINT } from "@/lib/solana/send-kinds";
import { swapFailureCopy } from "@/lib/solana/swap-failure-copy";
import { SPOT_SALE_SIDE } from "@/lib/spot/ticket-state";
import { deadlineExact } from "@/lib/stocks/conversion-watch";

import company from "./company.module.css";

/**
 * The swap before the issuer's deadline, and the quiet sale — the IPO and
 * conversion watch's one action (canon v5.2 В27, §7; `RYN-PRESTOCKS-001`,
 * session 2), drawn as the purchase's sheet is.
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

const SHARES = [100, 50, 25] as const;
type Share = (typeof SHARES)[number];
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

  const [share, setShare] = useState<Share>(100);
  const partRaw = heldRaw !== null && heldRaw > 0n ? (heldRaw * BigInt(share)) / 100n : null;
  const amount = partRaw !== null && partRaw > 0n && baseDecimals !== null ? plainAmount(partRaw.toString(), baseDecimals) : "";
  const giveUnits = partRaw !== null ? unitsFromRaw(partRaw.toString(), baseDecimals, multiplier) : null;

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
  const issuerFee = estimate?.issuerFeeUsd != null && issuerFeeBps !== null && issuerFeeBps > 0 ? `${word("issuerFeeOfWhich")} ${new Intl.NumberFormat(numbers, { maximumFractionDigits: 2 }).format(issuerFeeBps / 100)}% ${approxUsd(estimate.issuerFeeUsd, numbers).replace(" ", " ")}` : null;

  /* The rate against the company's price on the exchange: what one token brings, and how far below or above the listed share that is (canon §7 — «ціну обміну показує чесно»). */
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

  const quoteFailure = ticket.quoteFailure && amount ? ticket.quoteFailureMessage : null;
  const quoteStop = ticket.quoteFailure ? !swapFailureCopy(ticket.quoteFailure.code, text).retryable : false;
  const blocked = quoted?.verdict.verdict === "BLOCKED";
  const failure = (() => {
    const code = ticket.actionFailure?.code ?? null;
    if (code === "WALLET_REFUSED") return word("walletDeclined");
    if (ticket.actionFailureMessage) return ticket.actionFailureMessage;
    return null;
  })();

  const topUpSol = useCallback(() => {
    const back = encodeURIComponent(window.location.pathname);
    router.push(`/app/top-up?need=sol&from=${back}`);
  }, [router]);

  const targetWord = swap && into ? `${into.company} (${into.symbol})` : "USDC";
  const title = swap ? (lang === "uk" ? `Обміняти ${symbol}` : `Swap ${symbol}`) : lang === "uk" ? `Продати ${symbol}` : `Sell ${symbol}`;

  const head = (heading: string) => (
    <div className={company.sheetHead}>
      <span className={company.grab} aria-hidden="true" />
      <MarketIcon mint={mint} icon={icon} symbol={name} size={32} className={company.sheetLogo} />
      <h2 id={titleId} className={company.sheetTitle}>
        {heading}
      </h2>
      <button type="button" className={company.sheetClose} onClick={onClose} disabled={working} aria-label={word("close")}>
        <X size={18} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );

  /* ------------------------------------------------------------ the receipt */
  const outcome = phase === "SETTLED" && settled ? classifySpotFill(settled) : null;
  if (outcome) {
    const context = ticket.settledContext;
    const gotRaw = settled?.observation?.actualOutputRaw ?? null;
    const gaveRaw = settled?.observation?.actualInputRaw ?? null;
    const got = gotRaw ? unitsFromRaw(gotRaw, swap ? (context?.quoteDecimals ?? outDecimals) : USDC.decimals, swap ? into?.multiplier ?? null : null) : null;
    const gave = gaveRaw ? unitsFromRaw(gaveRaw, context?.baseDecimals ?? baseDecimals, multiplier) : null;
    const tone = outcome.kind === "FILLED" ? (outcome.note === null ? "matched" : "caution") : outcome.kind === "NOT_FILLED" ? "risk" : outcome.kind === "NOTHING_HAPPENED" ? "quiet" : "caution";
    const heading =
      outcome.kind === "FILLED"
        ? swap
          ? `${word("swapped")} · ${got !== null ? `${formatUnits(got, numbers)} ` : ""}${targetWord}`
          : `${word("sold")}${got !== null ? ` · ${dollars(got, numbers)}` : ""}`
        : outcome.kind === "NOTHING_HAPPENED"
          ? word("nothingSwapped")
          : outcome.kind === "NOT_FILLED"
            ? word("swapRejected")
            : word("unknownTx");
    return (
      <div className={company.sheetBody} data-sheet="receipt" data-convert-receipt={mode}>
        {head(name)}
        <div className={company.receipt} data-tone={tone} role="status">
          <span className={company.receiptMark} aria-hidden="true">
            {tone === "matched" ? <CheckCircle size={44} weight="fill" /> : tone === "risk" ? <XCircle size={44} weight="fill" /> : <Warning size={44} weight="fill" />}
          </span>
          <p className={company.receiptTitle} translate="no">
            {heading}
          </p>
          {outcome.kind === "FILLED" && gave !== null ? (
            <p className={company.receiptSub} translate="no">
              {`${word("receiptFor")} ${formatUnits(gave, numbers)} ${symbol}`}
            </p>
          ) : null}
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
          {word("unknownTx")}
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
    const po = prepared.order;
    const minOut = unitsFromRaw(po.minReceivedRaw, outDecimals, swap ? into?.multiplier ?? null : null);
    const ready = ticket.preparedReadiness?.ready === true;
    const seconds = ticket.reviewSecondsLeft;
    return (
      <div className={company.sheetBody} data-sheet="review" data-convert-review={mode}>
        {head(word("review"))}
        <dl className={company.review} aria-label={word("review")}>
          <div>
            <dt>{word("rowGive")}</dt>
            <dd translate="no">
              {inUnits === null ? "—" : `${formatUnits(inUnits, numbers)} ${symbol}`}
              {inUsd !== null ? <span>{approxUsd(inUsd, numbers)}</span> : null}
            </dd>
          </div>
          <div>
            <dt>{word("rowGet")}</dt>
            <dd translate="no">
              {outUnits === null ? "—" : swap ? `≈ ${formatUnits(outUnits, numbers)} ${targetWord}` : `≈ ${dollars(outUnits, numbers)} USDC`}
              {minOut !== null ? <span>{`${word("atLeast")} ${swap ? formatUnits(minOut, numbers) : dollars(minOut, numbers)}`}</span> : null}
            </dd>
          </div>
          <div>
            <dt>{word("rowCosts")}</dt>
            <dd translate="no">
              {estimate ? approxUsd(estimate.totalUsd, numbers) : "—"}
              {issuerFee ? <span data-issuer-fee>{issuerFee}</span> : null}
            </dd>
            {/* The account the swap opens for the new token: its own line, never a cost — it stays in the wallet (canon v5.5 В35). */}
            {estimate?.accountUsd ? <dd data-reserve>{reserveLine(locale, approxUsd(estimate.accountUsd, numbers))}</dd> : null}
          </div>
          <div>
            <dt>{word("rowRate")}</dt>
            <dd translate="no" data-convert-rate>
              {rateLine ?? "—"}
              {gapLine ? <span data-convert-gap={gapPct !== null && gapPct < 0 ? "below" : "above"}>{gapLine}</span> : null}
            </dd>
          </div>
        </dl>
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
          <p>{word("swapIsTrade")}</p>
        </details>
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
  const cta = (() => {
    if (ticket.lockedReview) return { label: word("refreshPrice"), disabled: false, run: () => void ticket.cancelReview(true) };
    if (!connection) return { label: word("connectWallet"), disabled: false, run: onConnect };
    if (holdings.status !== "ready" || baseDecimals === null) return { label: word("reading"), disabled: true, run: undefined };
    if (none) return { label: word("done"), disabled: false, run: onClose };
    if (phase === "PREPARING") return { label: word("preparingReview"), disabled: true, run: undefined };
    if (cannotPayFee) return { label: word("topUpSol"), disabled: false, run: topUpSol };
    if (blocked || quoteStop) return { label: word("swapUnavailable"), disabled: true, run: undefined };
    return { label: swap ? word("reviewSwap") : word("reviewSale"), disabled: !quoted, run: () => void ticket.review() };
  })();
  const estimateLine = (() => {
    if (none || !amount) return " ";
    if (outUnits !== null && estimate) return `≈ ${swap ? `${formatUnits(outUnits, numbers)} ${targetWord}` : `${dollars(outUnits, numbers)} USDC`} · ${word("allCosts")} ${approxUsd(estimate.totalUsd, numbers)}`;
    return quoteFailure ?? word("pricing");
  })();

  return (
    <div className={company.sheetBody} data-sheet="compose" data-convert-compose={mode}>
      {head(title)}
      <p className={company.convertTo} translate="no">
        <span>{symbol}</span>
        <span aria-hidden="true">→</span>
        {swap && into ? <MarketIcon mint={into.mint} icon={into.icon} symbol={into.company} size={20} /> : <MarketIcon mint={USDC.mint} icon={USDC.icon} symbol="USDC" size={20} />}
        <span>{targetWord}</span>
      </p>
      {none ? (
        <p className={company.sheetNote} data-empty="token">
          {lang === "uk" ? `У гаманці немає ${symbol} — обмінювати нічого.` : `There is no ${symbol} in this wallet — nothing to swap.`}
        </p>
      ) : (
        <>
          <div className={company.limit}>
            <span className={company.limitLabel} id={`${titleId}-share`}>
              {word("howMuch")}
            </span>
            <div className={company.limitChips} role="group" aria-labelledby={`${titleId}-share`}>
              {SHARES.map((value) => (
                <button key={value} type="button" className={company.chip} aria-pressed={share === value} disabled={working} onClick={() => setShare(value)}>
                  {value === 100 ? word("shareAll") : value === 50 ? word("shareHalf") : word("shareQuarter")}
                </button>
              ))}
            </div>
          </div>
          <p className={company.convertGive} translate="no">
            {giveUnits !== null ? `${formatUnits(giveUnits, numbers)} ${symbol}` : <span className={company.lineBone} aria-hidden="true" />}
          </p>
          <p className={company.estimate} aria-live="polite">
            {estimateLine}
          </p>
          {!cannotPayFee ? null : (
            <p className={company.sheetNote} data-empty="sol">
              {word("needSol")}
            </p>
          )}
        </>
      )}
      {failure ? <p className={company.sheetError}>{failure}</p> : null}
      <div className={company.sheetActions}>
        <button type="button" className="rw-btn rw-btn--primary" disabled={cta.disabled} onClick={cta.run}>
          {cta.label}
        </button>
      </div>
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
