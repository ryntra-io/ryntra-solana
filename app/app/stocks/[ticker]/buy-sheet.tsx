"use client";

import { HourglassMedium } from "@phosphor-icons/react";
import { Button, TradeTicket, newDraft, ticketModel, type TicketDraft, type TicketReviewed } from "@ryntra/core/ui";
import { ryntraFeeOfWhich } from "./ryntra-fee-line";
import Link from "next/link";
import { pagePath } from "@/lib/site/localized";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { approxUsd, DEFAULT_BUY_USD, dollars, formatUnits, isNoRoute, MAX_BUY_USD, MIN_BUY_USD, unitsFromRaw, unitsPhrase } from "@/app/app/invest/company-model";
import { FIRST_PURCHASE_LAMPORTS, PURCHASE_FEE_LAMPORTS, solShort } from "@/app/app/invest/funding-model";
import { buyByRuleWord, investWords, numberLocale, plainLeavesOpenLine, reserveFirstLine, reserveLine, routeMinimumLine, setMinimumWord } from "@/app/app/invest/invest-words";
import { useRouteMinimum } from "@/app/app/invest/use-route-minimum";
import { useWalletData } from "@/app/app/wallet-data";
import { helpTopic } from "@/app/shell/help-topics";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { openSolanaConnection } from "@/app/solana/workspace/connection-trigger.client";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { formatUsdPrice } from "@/app/solana/workspace/spot/spot-format";
import { useSpotMarket } from "@/app/solana/workspace/spot/use-spot-data";
import { SPOT_QUOTE_ASSETS, useSpotTicket } from "@/app/solana/workspace/spot/use-spot-ticket";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import { fitsMonth, occurrenceAt, openOccurrence, purchaseSumUsd } from "@/app/app/invest/autoinvest-model";
import { conditionReviewLine, deferralLine } from "@/app/app/invest/price-condition-view";
import { useConditionFacts } from "@/app/app/invest/use-condition-facts";
import type { AutoinvestRule, ExecutionPlanBinding, PlanAssetRead, RuleBudget, TradingPlan } from "@/lib/api/v1/contract";
import { checkPriceCondition, type PriceFacts } from "@/lib/autoinvest/price-condition";
import { dueWords, ruleWhenLine, usdWord } from "@/lib/autoinvest/words";
import { LOSS_LIMIT_PRESETS, lossLimitPurchase, type LossLimitPreset } from "@/lib/plans/purchase";
import { explorerTxUrl } from "@/lib/solana/explorer";
import { SOLANA_MAINNET_USDC_MINT } from "@/lib/solana/send-kinds";
import { swapFailureCopy } from "@/lib/solana/swap-failure-copy";
import { SPOT_PURCHASE_SIDE } from "@/lib/spot/ticket-state";
import { SALE_MAY_FAIL, type SwapCheck } from "@/lib/stocks/check";
import { NETWORK_LABEL, SOL_COIN, plainRaw, referenceOf, solGas, ticketBalances, ticketMarket, ticketPrices, unitsOf, type TicketCoin } from "@/lib/ticket/solana-ticket";

import company from "./company.module.css";
import { useSheetAboveKeyboard, useSumReadyOnDesk } from "./sheet-keyboard";
import { QuickSums } from "./quick-sums";
import { STOCK_VENUE, stockTicketBase, stockTicketView } from "./stock-ticket";
import { tradeFailureLine } from "./trade-failure-words";
import { ensureWalletActs } from "@/lib/account/wallet-proof-store.client";

/**
 * The purchase in dollars — «Простий»'s one action on a company, drawn as a
 * sheet that rises from the bottom of a phone and stands in the middle of a
 * wide screen.
 *
 * **Намір.** A sum in dollars from $1, typed freely — the sheet opens on $10,
 * a default and not advice — or a share of the wallet's USDC in one tap:
 * 25 %, 50 %, 75 % or 100 % — and at once what it buys: «≈ 0,0787 частки
 * Apple · усі витрати ≈ $0,06», from the same live quote Spot shows. Where
 * the quote finds no route for the sum, the company says its own minimum,
 * read from the same quote — «На $1 маршруту зараз немає. IREN — від $5.» —
 * and the one action puts it in. A loss limit is the person's choice: «Немає»
 * by default, or −5 % / −10 %. **Межі · дозвіл.** One button, «Купити за
 * $10», prepares the exact Review on the one execution path the product has
 * (`useSpotTicket`: `/order` → the wallet's signature over the reviewed bytes
 * → `/execute` → `/recover`), and the Review is four lines — what leaves the
 * wallet, what arrives at least, all costs, what the token is — and
 * «Підписати». The one-time reserve that opens a new token's account is its
 * own line under «Усі витрати», never among them: it stays in the wallet;
 * when it is more than the purchase itself, the Review says so first. A
 * chosen loss limit is first written as the plan the published rules make of
 * it (`lib/plans/purchase.ts`) behind the wallet's proof, and the Review is
 * judged against it. **Виконання · доказ.** The signature, the network, and
 * the receipt: «✓ У тебе є частинка Apple · $20». **Нагляд.** Under a loss
 * limit, Ryntra watches it — said only when a channel can carry the warning.
 *
 * Nothing here signs or spends: the wallet does, when the person presses.
 *
 * **Цифри — сервера (contract 1.20.0).** What the sum buys, «Усі витрати»
 * with the issuer's fee inside them, the reserve and «Що це» are the `check`
 * the quote and the order answer (`lib/stocks/check.ts`): the sheet draws
 * them and counts none of them, so the phone shows the same figures for the
 * same sum.
 *
 * **За правилом.** A reminder of an autoinvest rule opens this same sheet on
 * the rule's sum: one tap from the note, and the fresh Review is prepared at
 * once — the same four lines, the same signature, the order naming the rule
 * and the occurrence (`origin.rule`, refused by the server if the reminder is
 * not open). The receipt carries the rule and the next purchase. A reminder
 * that is bought, on its way, missed or gone says so instead, and offers no
 * purchase — nothing is caught up. After a plain purchase the receipt offers
 * «Купувати щотижня», the rule's sheet on the same sum. A reminder whose
 * purchase does not fit what is left of the month's budget says so — «Правила
 * стоять до 1-го числа» — and offers «Змінити бюджет» in the purchase's
 * place.
 *
 * **Поки нагадування відкрите.** While a rule's reminder is open for this
 * company, the page's first action is «Купити $20 за правилом» — this sheet
 * on the rule's sum — and an ordinary purchase is the second, quiet one,
 * saying the reminder stays open; its sheet says it again before any sum. The
 * rule counts only a purchase by the rule: the words say so, the path is the
 * same.
 *
 * **Умова ціни.** A rule with a price condition is judged again here on the
 * company's figures, read afresh while the sheet is open: met, the rule's
 * purchase carries the condition's line — the deviation, the reference, the
 * limit, the data's time — over the purchase and in the Review; not met, or
 * the data old, the sheet says «Купівлю відкладено» with the reason and
 * offers no purchase, and the order route would refuse it too. A purchase the
 * tick deferred says why the same way; the rule judges it again.
 */

/* The sheet opens on $10 — a default, not advice; any sum from a dollar is the person's own. */
const DEFAULT_USD = DEFAULT_BUY_USD;
const USDC = SPOT_QUOTE_ASSETS[0];
/* The dollars the company is bought with; the network's fee is paid in SOL (`SOL_COIN`). */
const USDC_COIN: TicketCoin = { mint: SOLANA_MAINNET_USDC_MINT, symbol: "USDC", decimals: 6, digits: 2 };
const MIN_BUY_RAW = BigInt(MIN_BUY_USD * 10 ** 6);
const API_HEADERS = { accept: "application/json", "X-Ryntra-API": "1" } as const;

export type BuySheetProps = Readonly<{
  mint: string;
  /** The token's symbol — the venue's key, never shown at rest. */
  symbol: string;
  /** The company as a person names it. */
  name: string;
  icon: string | null;
  /** The mint's decimals from the chain, when read. */
  decimals: number | null;
  /** The Scaled UI Amount multiplier, when the mint carries one. */
  multiplier: number | null;
  unit: "share" | "token";
  preIpo: boolean;
  /** The one line of truth about what the token is — before a private company's sum; «Перевірка» says the server's own (1.20.0), with the issuer's fee the chain states on its own line under «Усі витрати». */
  truth: string;
  locale: WorkspaceLocale;
  /** A purchase under an autoinvest reminder — from the note's link or the rule on the page; null for a plain purchase. */
  ruleBuy?: RuleBuy | null;
  /** The rule purchase is over (bought, closed, or the sheet was closed). */
  onRuleBuyEnd?: () => void;
  /** Read the rules again — after the wallet's proof, after a purchase under one. */
  onRulesReload?: () => void;
  /** «Купувати щотижня» on a plain purchase's receipt: the rule's sheet on the same sum; absent when the company has a rule already. */
  onBuyWeekly?: (amountUsd: number) => void;
  /** The month's autoinvest budget as the rules' read last said it: a reminder's purchase that does not fit it is not offered. */
  budget?: RuleBudget | null;
  /** «Змінити бюджет» — the budget's sheet, when the month's budget holds a reminder's purchase. */
  onChangeBudget?: () => void;
  /** A rule's reminder open for this company right now: its purchase is the first action, and an ordinary one says the reminder stays open. */
  ruleOffer?: RuleOffer | null;
  /**
   * The issuer's event said before a purchase (the IPO and conversion watch):
   * «SpaceX вийшла на біржу. Куплений SPACEX треба обміняти до 12 березня
   * 2027 — після строку токен згорить.» — under the truth, before any sum, and
   * again in the Review's «Що це»; null where the token has none.
   */
  eventLine?: string | null;
  /** A private company's strongest risks, said in the sheet before any sum (UX-500): a sale may not go through, the company's own word about tokens like this one. */
  riskLines?: readonly string[];
  /** On a phone, «Купити» also stands pinned over the bottom bar while the card's own button is out of sight (UX-501). */
  pinned?: boolean;
  /** «Купити» quiet: a holder's one orange action on the page is the swap. */
  quiet?: boolean;
  /** «Умова ціни»: the facts a rule's price condition is judged on, as the page read them — the sheet reads them again while a rule's purchase is open. */
  conditionFacts?: PriceFacts | null;
  /** «Швидка купівля» over «Купити»: the person's dollar sums, each one tap from the sheet on that sum with its Review. */
  quickBuy?: boolean;
  /** The company's price per share or token in dollars, as the page read it: the ticket's dollar sums and its reference. */
  priceUsd?: number | null;
}>;

/** The rule's purchase offered first while its reminder is open: its sum, what the reminder is, and the press that opens it. */
export type RuleOffer = Readonly<{
  amountUsd: number;
  /** «Час твоєї покупки · Щотижня · чт о 19:00» — above the purchase, so the rule is read before the price. */
  context: string;
  onBuy: () => void;
}>;

/** An autoinvest reminder to buy under: the rule and its occurrence as named, and how the read of the rules stands. */
export type RuleBuy = Readonly<{
  ruleId: string;
  /** The occurrence the note names; null for the rule's open one. */
  dueAt: string | null;
  /** The rule as read now; null while it is read, or when it cannot be. */
  rule: AutoinvestRule | null;
  read: "idle" | "loading" | "ready" | "unproven" | "failed";
}>;

export function BuySheet(props: BuySheetProps) {
  const word = investWords(props.locale);
  const { connection } = useSolanaConnection();
  const [open, setOpen] = useState(false);
  const { ruleBuy = null, onRuleBuyEnd } = props;
  const ruleKey = ruleBuy ? `${ruleBuy.ruleId}:${ruleBuy.dueAt ?? ""}` : null;

  useEffect(() => {
    /* A reminder opens the sheet on its own: one tap from the note to the Review. */
    if (ruleKey) setOpen(true);
  }, [ruleKey]);

  const [amountText, setAmountText] = useState(String(DEFAULT_USD));
  const [limit, setLimit] = useState<LossLimitPreset | null>(null);
  const [resume, setResume] = useState(false);
  /* A quick sum pressed: the sheet opens on it, a plain purchase with no loss limit, and its Review is asked for once. */
  const [quickTap, setQuickTap] = useState(0);
  const pickQuick = useCallback((usd: number) => {
    setAmountText(String(usd));
    setLimit(null);
    setQuickTap((tap) => tap + 1);
    setOpen(true);
  }, []);
  /* «Купити» itself is a sum the person chooses in the sheet: no quick tap carries over into it. */
  const openPlain = useCallback(() => {
    setQuickTap(0);
    setOpen(true);
  }, []);

  const wasOpen = useRef(false);
  const closedOnRule = useRef(false);
  useEffect(() => {
    /* The sheet closed on a reminder's purchase: the page lets the reminder go, so the next «Купити» is a plain one — unless it closed only for the wallet's panel and comes back.
       Only a close with a reminder's purchase in it counts: an ordinary purchase closed beside an open reminder must not end the rule's purchase pressed next. */
    if (wasOpen.current && !open) closedOnRule.current = ruleKey !== null;
    if (open) closedOnRule.current = false;
    wasOpen.current = open;
    if (closedOnRule.current && !resume && ruleKey) {
      closedOnRule.current = false;
      onRuleBuyEnd?.();
    }
  }, [open, resume, ruleKey, onRuleBuyEnd]);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

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

  /* On a phone the sheet stands above the keyboard the sum raises: «Купити за $1» stays in sight. */
  useSheetAboveKeyboard(dialog, open);
  useSumReadyOnDesk(dialog, open);

  useEffect(() => {
    /* A wallet connected for this purchase: the sheet comes back with the sum the person chose. */
    if (resume && connection) {
      setResume(false);
      setOpen(true);
    }
  }, [resume, connection]);

  useEffect(() => {
    /* A connection the person walked away from does not bring the sheet back minutes later. */
    if (!resume) return undefined;
    const timer = window.setTimeout(() => setResume(false), 90_000);
    return () => window.clearTimeout(timer);
  }, [resume]);

  /* Nothing closes the sheet while a Review is being prepared, signed or sent: the flow keeps running and says so. */
  const requestClose = useCallback(() => {
    if (!busy) setOpen(false);
  }, [busy]);

  const connectFirst = useCallback(() => {
    /* One way to connect: the header's own panel (connection-trigger.client.ts). The modal sheet steps aside first, or the panel would sit under it. */
    setResume(true);
    dialog.current?.close();
    setOpen(false);
    window.requestAnimationFrame(() => {
      openSolanaConnection();
    });
  }, []);

  const { ruleOffer = null, quiet = false, pinned = false } = props;
  const plainNoteId = useId();
  const lang = props.locale === "uk" ? "uk" : "en";

  /* On a phone the card's «Купити» sits below the chart and the company's way: while it is out of sight, the same purchase stands pinned over the bottom bar (UX-501). */
  /* The anchor is watched whenever it is drawn — it comes and goes with a reminder's purchase and a holder's quiet «Купити». */
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const [cardInView, setCardInView] = useState(true);
  useEffect(() => {
    if (!anchor || typeof IntersectionObserver === "undefined") {
      setCardInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => setCardInView(entry?.isIntersecting ?? true));
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [anchor]);
  const pinnedPrice = props.priceUsd === null || props.priceUsd === undefined ? null : formatUsdPrice(props.priceUsd, numberLocale(props.locale));

  return (
    <>
      {ruleOffer ? (
        /* A rule's reminder is open: its purchase first, on its sum; an ordinary purchase second, saying the reminder stays open — the rule counts only a purchase by the rule. */
        <>
          <p className={company.ruleDue} translate="no">
            <span>
              {ruleOffer.context.split(" · ").map((part, index) => (
                <Fragment key={`${index}-${part}`}>
                  {index > 0 ? " · " : null}
                  <span>{part}</span>
                </Fragment>
              ))}
            </span>
          </p>
          <Button variant="primary" block className={company.buy} data-sheet-open={open ? "true" : undefined} data-rule-first="true" aria-haspopup="dialog" onClick={ruleOffer.onBuy} lang={lang}>
            {buyByRuleWord(props.locale, ruleOffer.amountUsd)}
          </Button>
          <Button variant="secondary" block className={company.plainBuy} aria-haspopup="dialog" aria-describedby={plainNoteId} onClick={openPlain} lang={lang}>
            {word("plainPurchase")}
          </Button>
          <p id={plainNoteId} className={company.plainNote}>
            {word("reminderStaysOpen")}
          </p>
        </>
      ) : (
        <>
          {props.quickBuy ? (
            /* «Швидка купівля»: each of the person's sums one tap from the sheet on it with its Review; the pencil changes them, the same sums as on Spot. */
            <QuickSums locale={props.locale} onPick={pickQuick} />
          ) : null}
          {/* The card's «Купити» and, after it, the anchor the pinned purchase watches — one grid item, so no gap of its own. */}
          <div className={company.buyWrap}>
            <Button variant={quiet ? "secondary" : "primary"} block className={company.buy} data-sheet-open={open ? "true" : undefined} data-quiet={quiet ? "true" : undefined} aria-haspopup="dialog" onClick={openPlain} lang={lang}>
              {word("buy")}
            </Button>
            {pinned && !quiet ? <span ref={setAnchor} className={company.buyAnchor} aria-hidden="true" /> : null}
          </div>
          {pinned && !quiet ? (
            <>
              <div className={company.pinnedBuy} data-pinned-buy data-hidden={cardInView || open ? "true" : undefined}>
                <Button variant="primary" block aria-haspopup="dialog" onClick={openPlain} lang={lang}>
                  <span translate="no">{`${word("buy")} ${props.name}${pinnedPrice ? ` · ${pinnedPrice}` : ""}`}</span>
                </Button>
              </div>
            </>
          ) : null}
        </>
      )}
      <dialog
        ref={dialog}
        className={company.sheet}
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          requestClose();
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          /* A press on the dimmed page around the sheet closes it; a press inside never reaches the dialog itself. */
          if (event.target === event.currentTarget) requestClose();
        }}
      >
        {open || busy ? (
          <BuyFlow
            {...props}
            ruleBuy={ruleBuy}
            titleId={titleId}
            quickTap={quickTap}
            amountText={amountText}
            onAmountText={setAmountText}
            limit={limit}
            onLimit={setLimit}
            onBusy={setBusy}
            onClose={requestClose}
            onConnect={connectFirst}
            onBuyWeekly={
              props.onBuyWeekly
                ? (amountUsd: number) => {
                    /* The purchase's sheet steps aside for the rule's, on the same sum. */
                    dialog.current?.close();
                    setOpen(false);
                    props.onBuyWeekly?.(amountUsd);
                  }
                : undefined
            }
            onChangeBudget={
              props.onChangeBudget
                ? () => {
                    /* The purchase's sheet steps aside for the budget's: one sheet at a time. */
                    dialog.current?.close();
                    setOpen(false);
                    props.onChangeBudget?.();
                  }
                : undefined
            }
          />
        ) : null}
      </dialog>
    </>
  );
}

type AssetRead = Readonly<{ status: "idle" | "loading" | "ready" | "failed"; read: PlanAssetRead | null }>;
type Channel = "unknown" | "connected" | "none";
type Step = "idle" | "proving" | "writing";

function BuyFlow({
  mint,
  symbol,
  name,
  icon,
  decimals,
  multiplier,
  unit,
  preIpo,
  truth,
  locale,
  titleId,
  amountText,
  onAmountText,
  limit: chosenLimit,
  onLimit,
  onBusy,
  onClose,
  onConnect,
  ruleBuy = null,
  onRulesReload,
  onBuyWeekly,
  budget = null,
  onChangeBudget,
  ruleOffer = null,
  eventLine = null,
  riskLines = [],
  conditionFacts = null,
  quickTap = 0,
  priceUsd = null,
}: BuySheetProps & {
  titleId: string;
  /** The count of quick sums pressed: a new one asks for the Review of the sheet's sum once. */
  quickTap?: number;
  amountText: string;
  onAmountText: (value: string) => void;
  limit: LossLimitPreset | null;
  onLimit: (value: LossLimitPreset | null) => void;
  onBusy: (busy: boolean) => void;
  onClose: () => void;
  onConnect: () => void;
}) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const { connection } = useSolanaConnection();
  const { text } = useSolanaI18n();
  const { holdings, refresh } = useWalletData();
  const proof = useWalletProof();
  /* The mint's decimals when the chain read did not bring them — the venue's own read; what the purchase costs is the server's count (1.20.0). */
  const market = useSpotMarket(decimals === null ? mint : null);
  const baseDecimals = decimals ?? (market.status === "ready" ? market.value.decimals : null);

  /* ---------------------------------------------------------- the rule's reminder */
  const ruleMode = ruleBuy !== null;
  const rule = ruleBuy?.rule ?? null;
  const occurrence = rule ? (ruleBuy?.dueAt ? occurrenceAt(rule, ruleBuy.dueAt) : openOccurrence(rule)) : null;
  /* One tap buys only while the reminder is open and the rule is on; anything else is said, never offered. */
  const ruleOpen = rule !== null && rule.status === "active" && occurrence !== null && occurrence.state === "due" && Date.parse(occurrence.openUntil) > Date.now();
  /* The month's budget: a reminder whose purchase does not fit what is left is said, never offered — the server refuses it too. */
  const budgetHolds = ruleOpen && rule !== null && !fitsMonth(rule, budget, occurrence);
  /*
   * The price condition (1.18.0): judged again on the company's figures, read
   * afresh every minute while a rule's purchase is open here.
   * Not met now — or the data old — and the purchase is said, never offered;
   * the order route judges the same facts the same way.
   */
  const conditionOf = rule?.priceCondition ?? null;
  const liveFacts = useConditionFacts(mint, ruleMode && conditionOf !== null, conditionFacts).facts;
  const conditionCheck = conditionOf ? checkPriceCondition(conditionOf.limitPct, liveFacts, Date.now()) : null;
  const conditionHolds = ruleOpen && !budgetHolds && conditionCheck !== null && conditionCheck.verdict !== "met";
  const ruleZone = rule?.schedule?.timeZone ?? rule?.dip?.timeZone ?? rule?.payments?.timeZone ?? "UTC";
  /* 1.19.0: a «З кожної оплати» reminder buys exactly what it gathered; every other, the rule's sum. */
  const ruleSum = rule ? purchaseSumUsd(rule, occurrence) : null;
  const ruleBinding = useMemo(() => (ruleOpen && rule && occurrence ? { ruleId: rule.id, dueAt: occurrence.dueAt } : null), [ruleOpen, rule, occurrence]);

  /* ---------------------------------------------------------- the ticket's market */
  /* A dollar is a USDC here, as every sum on the company's page is: the sheet's $10 is ten USDC. */
  const companyCoin: TicketCoin = useMemo(() => ({ mint, symbol, decimals: baseDecimals ?? 0, digits: 4, multiplier }), [mint, symbol, baseDecimals, multiplier]);
  const ticketMarketOf = useMemo(() => ticketMarket({ id: mint, base: companyCoin, quote: USDC_COIN, price: priceUsd, minQuoteRaw: MIN_BUY_RAW }), [mint, companyCoin, priceUsd]);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const priceAt = useMemo(() => (priceUsd === null ? 0 : Date.now()), [priceUsd]);
  const prices = useMemo(() => ticketPrices([{ coin: USDC_COIN, usd: 1 }, { coin: companyCoin, usd: priceUsd }], priceAt, "Jupiter"), [companyCoin, priceUsd, priceAt]);
  const reference = useMemo(() => referenceOf(priceUsd, 1, "Jupiter", priceAt), [priceUsd, priceAt]);
  const usdcRow = holdings.status === "ready" ? holdings.data.find((row) => row.mint === SOLANA_MAINNET_USDC_MINT) ?? null : null;
  const solRow = holdings.status === "ready" ? holdings.data.find((row) => row.kind === "NATIVE_SOL") ?? null : null;
  const companyRow = holdings.status === "ready" ? holdings.data.find((row) => row.mint === mint) ?? null : null;
  const holdsCompany = companyRow !== null && /^\d+$/.test(companyRow.amountRaw) && BigInt(companyRow.amountRaw) > 0n;
  /* The wallet as read: a balance not read yet is unknown, never zero; a complete read without USDC holds none. */
  const balances = !connection
    ? null
    : holdings.status !== "ready"
      ? {}
      : ticketBalances([
          { coin: USDC_COIN, raw: usdcRow?.amountRaw ?? (holdings.complete ? "0" : null) },
          { coin: SOL_COIN, raw: solRow?.amountRaw ?? (holdings.complete ? "0" : null) },
          { coin: companyCoin, raw: companyRow?.amountRaw ?? null },
        ]);
  /* The network's SOL: the fee, and for a company the wallet does not hold yet the account it opens. */
  const gas = useMemo(() => solGas(holdsCompany ? PURCHASE_FEE_LAMPORTS : FIRST_PURCHASE_LAMPORTS), [holdsCompany]);
  const [amountUnit, setAmountUnit] = useState<"token" | "usd">("token");

  /* A reminder's purchase is the rule's sum, no loss limit: the rule is the person's whole instruction. */
  const limit = ruleMode ? null : chosenLimit;
  const draft: TicketDraft = newDraft({ side: "buy", unit: ruleMode ? "token" : amountUnit, amount: ruleMode ? (ruleSum === null ? "" : String(ruleSum)) : amountText });
  const ticketBase = { side: "buy" as const, market: ticketMarketOf, base: companyCoin, quote: USDC_COIN, draft, balances, prices, reference, gas, unavailable: null, now: clock };
  /* What the sum typed is in USDC, as the ticket counts it: the sheet's order is sized from it. */
  const typed = ticketModel(stockTicketBase(ticketBase), lang);
  const typedRaw = unitsOf(typed.paid);
  const amount = ruleMode ? ruleSum : typedRaw === null ? null : Number(typedRaw) / 10 ** USDC_COIN.decimals;
  const valid = amount !== null && amount >= MIN_BUY_USD && amount <= MAX_BUY_USD;

  /* ---------------------------------------------------------- the loss limit */
  const [asset, setAsset] = useState<AssetRead>({ status: "idle", read: null });
  const [nowMs] = useState(() => Date.now());
  useEffect(() => {
    /* The asset the plan carries and its planning price, read the way the plan's own write resolves them — only once a limit is chosen. */
    if (!limit) return undefined;
    let live = true;
    setAsset((current) => (current.read ? current : { status: "loading", read: null }));
    fetch(`/api/v1/plans/asset?mint=${encodeURIComponent(mint)}`, { headers: API_HEADERS })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as PlanAssetRead | null;
        if (live) setAsset(response.ok && body?.asset ? { status: "ready", read: body } : { status: "failed", read: null });
      })
      .catch(() => {
        if (live) setAsset({ status: "failed", read: null });
      });
    return () => {
      live = false;
    };
  }, [limit, mint]);

  const made = useMemo(() => {
    const price = asset.read?.planningPrice?.perUnit ?? null;
    if (!limit || !valid || amount === null || price === null) return null;
    const { stopPct, targetPct } = LOSS_LIMIT_PRESETS[limit];
    const thesis = lang === "uk" ? `Купівля з межею збитку: межа −${stopPct}%, ціль +${targetPct}%.` : `Purchase with a loss limit: limit −${stopPct}%, target +${targetPct}%.`;
    return lossLimitPurchase({ amountUsd: amount, pricePerUnit: price, preset: limit, hasReference: asset.read?.planningPrice?.source === "issuer-reference", thesis, nowMs });
  }, [asset.read, limit, valid, amount, lang, nowMs]);

  const proven = proof.state.status === "proven";
  const [channel, setChannel] = useState<Channel>("unknown");
  useEffect(() => {
    /* The channel Ryntra warns through, read only for a proven wallet and only under a limit: «Ryntra попередить» is said only where it can. */
    if (!proven || !limit) return undefined;
    let live = true;
    fetch("/api/v1/notifications/telegram", { headers: API_HEADERS })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { telegram?: { connected?: boolean } } | null;
        if (live) setChannel(response.ok ? (body?.telegram?.connected === true ? "connected" : "none") : "unknown");
      })
      .catch(() => {
        if (live) setChannel("unknown");
      });
    return () => {
      live = false;
    };
  }, [proven, limit]);

  /* The plan a limited purchase is made under, written on the first press and kept for the same sum and limit. */
  const [plan, setPlan] = useState<Readonly<{ key: string; binding: ExecutionPlanBinding; limitPerUnit: number }> | null>(null);
  const planKey = limit && valid ? `${mint}:${amount}:${limit}` : null;
  const binding = plan && plan.key === planKey ? plan.binding : null;
  const [step, setStep] = useState<Step>("idle");
  const [stepFailure, setStepFailure] = useState<string | null>(null);
  const [wantReview, setWantReview] = useState(false);

  /* A settled purchase re-reads the wallet — and, under a reminder, the rule, which reads it back from History as bought. */
  const settledRefresh = useCallback(() => {
    refresh();
    if (ruleMode) onRulesReload?.();
  }, [refresh, ruleMode, onRulesReload]);

  /* ------------------------------------------------------- the one execution path */
  const ticket = useSpotTicket({
    connection,
    side: SPOT_PURCHASE_SIDE,
    baseMint: mint,
    baseDecimals,
    baseSymbol: symbol,
    quote: USDC,
    amount: valid && amount !== null ? (ruleMode ? String(amount) : typedRaw !== null ? plainRaw(typedRaw, USDC_COIN.decimals) : "") : "",
    planBinding: binding,
    ruleBinding,
    text,
    onSettled: settledRefresh,
    onRefresh: refresh,
  });
  const { phase, quoted, prepared, settled, attempt } = ticket;
  /* What Review agreed to, kept here: the hook lets the prepared order go before the answer settles. */
  const [agreed, setAgreed] = useState<TicketReviewed | null>(null);
  const working = phase === "PREPARING" || phase === "SIGNING" || phase === "EXECUTING" || phase === "RECOVERING";
  const busy = working || step !== "idle";

  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);

  /* The rule a purchase is made under, fixed when its Review is asked for: once History settles it, the reminder reads bought and is no longer open, and the receipt still names the rule it was bought by. */
  const [boughtUnder, setBoughtUnder] = useState<AutoinvestRule | null>(null);
  /* The price condition as judged when the Review was asked for — the Review shows what the order was judged on, not a figure that moves under the signature. */
  const [reviewedCondition, setReviewedCondition] = useState<ReturnType<typeof checkPriceCondition> | null>(null);

  useEffect(() => {
    /* The Review is asked for once the plan it is judged against exists — the binding reaches the order through the hook's next render. */
    if (!wantReview || (limit && !binding)) return;
    setWantReview(false);
    setBoughtUnder(ruleBinding && rule ? rule : null);
    setReviewedCondition(ruleBinding && rule ? conditionCheck : null);
    void ticket.review();
  }, [wantReview, limit, binding, ticket, ruleBinding, rule, conditionCheck]);

  const writePlan = async (): Promise<ExecutionPlanBinding | null> => {
    if (!made) return null;
    try {
      if (!(await ensureWalletActs())) return null;
      const response = await fetch("/api/v1/plans", {
        method: "POST",
        headers: { ...API_HEADERS, "content-type": "application/json" },
        body: JSON.stringify({ asset: { mint }, rules: made.rules, activate: true }),
      });
      const body = (await response.json().catch(() => null)) as { plan?: TradingPlan } | null;
      return response.ok && body?.plan ? { planId: body.plan.id, version: body.plan.version } : null;
    } catch {
      return null;
    }
  };

  /* One press at a time: a second tap or Enter while the limit is proven, written or the Review prepared asks for nothing again. */
  const pressing = useRef(false);
  const press = async () => {
    if (pressing.current || busy || wantReview) return;
    if (ticket.lockedReview) {
      void ticket.cancelReview(true);
      return;
    }
    pressing.current = true;
    try {
      await pressOnce();
    } finally {
      pressing.current = false;
    }
  };
  const pressOnce = async () => {
    setStepFailure(null);
    if (!connection) {
      onConnect();
      return;
    }
    if (ruleMode) {
      /* The rule is the wallet's: read behind its proof — one signed message, never a transaction — then the Review opens on its own. */
      if (!proven) {
        setStep("proving");
        const ok = await proof.prove();
        setStep("idle");
        if (ok === true) onRulesReload?.();
        return;
      }
      if (ruleOpen && !budgetHolds && !conditionHolds) setWantReview(true);
      return;
    }
    if (!valid) return;
    if (limit) {
      if (!made || !planKey) return;
      if (!binding) {
        if (!proven) {
          setStep("proving");
          const ok = await proof.prove();
          setStep("idle");
          if (ok !== true) return;
        }
        setStep("writing");
        const written = await writePlan();
        setStep("idle");
        if (!written) {
          setStepFailure(word("limitFailed"));
          return;
        }
        setPlan({ key: planKey, binding: written, limitPerUnit: made.limitPerUnit });
      }
    }
    setWantReview(true);
  };

  /* ------------------------------------------------------------ the wallet */
  const usdc = usdcRow ? Number(usdcRow.amountRaw) / 10 ** usdcRow.decimals : holdings.status === "ready" && holdings.complete ? 0 : null;
  const insufficient = connection !== null && valid && amount !== null && usdc !== null && amount > usdc + 1e-9;
  const cannotPayFee = connection !== null && solRow !== null && /^\d+$/.test(solRow.amountRaw) && solShort(BigInt(solRow.amountRaw), holdsCompany);
  const router = useRouter();
  /* «Поповнити» from the purchase: the top-up worded for what is missing, and the way back to this company. */
  const topUp = useCallback(
    (need: "sol" | null) => {
      const back = encodeURIComponent(pagePath(window.location.pathname));
      router.push(`/app/top-up?${need ? `need=${need}&` : ""}from=${back}`);
    },
    [router],
  );

  /* One tap from the reminder: the Review opens on its own, once, as soon as the wallet, its proof and the rule are all here and the wallet can pay. */
  const autoReviewed = useRef(false);
  useEffect(() => {
    if (!ruleMode || autoReviewed.current || !ruleOpen || budgetHolds || conditionHolds || !connection || !proven || baseDecimals === null) return;
    if (attempt || phase !== "IDLE" || insufficient || cannotPayFee || holdings.status !== "ready") return;
    autoReviewed.current = true;
    setWantReview(true);
  }, [ruleMode, ruleOpen, budgetHolds, conditionHolds, connection, proven, baseDecimals, attempt, phase, insufficient, cannotPayFee, holdings.status]);

  /* One tap from a quick sum: its Review, once, as soon as the wallet is read — or the sheet says what stands in the way (the balance, SOL for the fee) and waits for the person. */
  const quickAnswered = useRef(0);
  useEffect(() => {
    if (quickTap === 0 || quickAnswered.current === quickTap || ruleMode) return;
    if (!connection || baseDecimals === null || holdings.status !== "ready") return;
    quickAnswered.current = quickTap;
    if (attempt || phase !== "IDLE" || limit || !valid || insufficient || cannotPayFee) return;
    setWantReview(true);
  }, [quickTap, ruleMode, connection, baseDecimals, holdings.status, attempt, phase, limit, valid, insufficient, cannotPayFee]);

  /* -------------------------------------------------------- what it buys — as the server counts it */
  /*
   * «Перевірка» from the server (contract 1.20.0): what arrives, all costs and
   * the issuer's fee inside them are the quote's `check`, and once a Review is
   * prepared, the order's — with the reserve the simulation proved. The sheet
   * draws them and counts none of them, so the phone shows the same figures.
   */
  const check: SwapCheck | null = prepared ? (prepared.check ?? null) : (quoted?.check ?? null);
  const outUnits = check?.get.amount ?? null;
  const costs = valid ? (check?.costs ?? null) : null;
  /* The server answered the quote without its lines (the company could not be read): nothing is counted here in their place. */
  const uncounted = valid && quoted !== null && outUnits === null;
  /* Under the sum: «≈ 0,0787 частки Apple · усі витрати ≈ $0,06» — the server's figures; a cost it could not count is a dash. */
  const estimateLine = valid && outUnits !== null ? `≈ ${unitsPhrase(outUnits, unit, name, lang, numbers)} · ${word("allCosts")} ${costs ? approxUsd(costs.usd, numbers) : "—"}` : null;
  const quoteFailure = ticket.quoteFailure && valid ? tradeFailureLine(ticket.quoteFailure, ticket.quoteFailureMessage, "buy", lang) : null;
  const quoteStop = ticket.quoteFailure ? !swapFailureCopy(ticket.quoteFailure.code, text).retryable : false;
  const blocked = quoted?.verdict.verdict === "BLOCKED";
  /* No route for the sum typed: the company's own minimum, read from the same quote at the ladder's larger sums. A reminder's sum is the rule's own, so only a purchase the person types looks for one. */
  const noRoute = !ruleMode && valid && isNoRoute(ticket.quoteFailure?.code);
  const routeMinimum = useRouteMinimum(mint, valid ? amount : null, noRoute);
  const minimumUsd = noRoute && routeMinimum.state === "found" ? routeMinimum.minimumUsd : null;
  const minimumLine = !noRoute || amount === null ? null : minimumUsd !== null ? routeMinimumLine(locale, dollars(amount, numbers), name, dollars(minimumUsd, numbers)) : routeMinimum.state === "finding" ? word("findingMinimum") : null;

  const failure = (() => {
    if (stepFailure) return stepFailure;
    const code = ticket.actionFailure?.code ?? null;
    if (code === "WALLET_REFUSED") return word("walletDeclined");
    if (code === "PLAN_REVIEW_BLOCKED") return word("limitBlocked");
    /* The server's word on a reminder (1.12.0): not open any more, not this rule's purchase, not this wallet's rule. */
    if (code === "RULE_NOT_DUE") return word("reminderClosed");
    if (code === "RULE_NOT_FOUND") return word("ruleGone");
    if (code === "RULE_MISMATCH") return word("unavailableNow");
    if (code === "RULE_BUDGET_EXHAUSTED") return `${word("budgetBlocks")} ${word("rulesStand")}.`;
    /* 1.18.0: the server judged the rule's price condition on its own figures and it is not met now. */
    if (code === "RULE_PRICE_CONDITION") return word("conditionRefused");
    if (ruleMode && code === "UNAUTHORIZED") return word("confirmWalletToBuy");
    if (ticket.actionFailure) return tradeFailureLine(ticket.actionFailure, ticket.actionFailureMessage, "buy", lang);
    /* The wallet's proof is asked for only under a limit; a refusal is the person's, anything else leaves the limit unsaved. */
    if (limit && proof.state.status === "refused") return word("walletDeclined");
    if (limit && (proof.state.status === "failed" || proof.state.status === "unsupported" || proof.state.status === "taken")) return word("limitFailed");
    return null;
  })();

  /* ------------------------------------------------------------ the ticket */
  /* «Усі витрати» as the server counted them (1.20.0), with the issuer's and Ryntra's parts on their own lines. */
  const countOf = (lines: SwapCheck | null, order: Parameters<typeof ryntraFeeOfWhich>[0]) => {
    if (!lines?.costs || !valid) return {};
    const parts: { label: string; value: string }[] = [];
    if (lines.costs.issuerFee) parts.push({ label: word("issuerFeeOfWhich"), value: `${new Intl.NumberFormat(numbers, { maximumFractionDigits: 2 }).format(lines.costs.issuerFee.basisPoints / 100)}% ${approxUsd(lines.costs.issuerFee.usd, numbers)}` });
    const ryntra = ryntraFeeOfWhich(order, "", numbers);
    if (ryntra) parts.push({ label: word("ryntraFeeOfWhich"), value: ryntra.trim() });
    return { costLines: parts, costsTotal: approxUsd(lines.costs.usd, numbers) };
  };
  const over = amount !== null && amount > MAX_BUY_USD;
  const view = stockTicketView({
    agreed,
    ...ticketBase,
    spot: { phase, quoted, quoting: ticket.quoting, prepared, preparedReadiness: ticket.preparedReadiness, bytesChanged: ticket.bytesChanged, reviewSecondsLeft: ticket.reviewSecondsLeft, settled, attempt },
    /* No route for the sum: the company's own minimum, else the venue's own words. */
    quoteFailed: over ? word("maxBuy") : valid ? (minimumLine ?? quoteFailure) : null,
    unavailable: blocked || quoteStop ? word("unavailableNow") : null,
    holding: step !== "idle" || wantReview,
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

  const head = (title: string) => (
    <div className={company.sheetHead}>
      <span className={company.grab} aria-hidden="true" />
      <MarketIcon mint={mint} icon={icon} symbol={name} size={32} className={company.sheetLogo} />
      <h2 id={titleId} className={company.sheetTitle}>
        {title}
      </h2>
      <Button variant="ghost" icon="x" className={company.sheetClose} onClick={onClose} disabled={busy} aria-label={word("close")} lang={lang} />
    </div>
  );

  /* The order's own lines in Review: «Що це» as the server says it — the truth and the issuer's event said to a buyer. */
  const lines = prepared?.check ?? null;
  const paidUsd = lines?.spend.amount ?? null;
  const reserve = inReview && lines?.reserve?.usd ? approxUsd(lines.reserve.usd, numbers) : null;
  const reserveFirst = reserve !== null && lines?.reserve?.first === true && paidUsd !== null;
  const whatLine = lines ? lines.what.truth[lang] : truth;
  const buyerEvent = lines ? (lines.what.note?.kind === "issuer-event" ? lines.what.note[lang] : null) : eventLine;
  /* A private company's purchase: «Що це» says that a sale may not go through, as the sale's Review does (UX-500). */
  const saleMayFail = preIpo && lines?.what.note?.kind !== "sale-may-fail" ? SALE_MAY_FAIL[lang] : null;

  /* The receipt's title, as the sheet's head: what the person now holds, or what became of the order. */
  const context = ticket.settledContext;
  const spentRaw = settled?.observation?.actualInputRaw ?? null;
  const spent = spentRaw ? Number(spentRaw) / 10 ** (context?.quoteDecimals ?? USDC.decimals) : amount;
  const gotUnits = settled?.observation ? unitsFromRaw(settled.observation.actualOutputRaw, context?.baseDecimals ?? baseDecimals, multiplier) : null;
  const receiptTitle = outcome
    ? outcome.kind === "FILLED"
      ? `${unit === "token" ? (lang === "uk" ? `${word("ownToken")} ${name}` : `${name} ${word("ownToken")}`) : `${word("ownPiece")} ${name}`}${spent !== null ? ` · ${dollars(spent, numbers)}` : ""}`
      : outcome.kind === "NOTHING_HAPPENED"
        ? word("nothingHappened")
        : outcome.kind === "NOT_FILLED"
          ? word("notFilled")
          : word("unknownTx")
    : null;
  const watched = outcome?.kind === "FILLED" && plan && binding && settled ? plan : null;
  /* The receipt's mark of the rule, and when it reminds next — a «Якщо впаде» rule has none, its price decides. */
  const byRule = outcome?.kind === "FILLED" && ruleMode && boughtUnder ? boughtUnder : null;
  const nextDue = byRule ? (rule?.id === byRule.id ? rule.nextDueAt : byRule.nextDueAt) : null;
  const nextOfRule = byRule && nextDue && byRule.schedule ? dueWords(Date.parse(nextDue), byRule.schedule.timeZone, lang) : null;
  /* «Купувати щотижня» after a plain purchase, on the sum just bought. */
  const weekly = outcome?.kind === "FILLED" && !ruleMode && onBuyWeekly && spent !== null && spent >= MIN_BUY_USD - 0.005 ? Math.round(spent * 100) / 100 : null;

  /* ------------------------------------------------------------ a reminder, before its Review */
  if (ruleMode && view.stage === "form") {
    const next = rule?.nextDueAt && rule.schedule ? dueWords(Date.parse(rule.nextDueAt), rule.schedule.timeZone, lang) : null;
    /* What became of the reminder when it is not open: said plainly, with no purchase offered (never caught up). */
    const readFailed = ruleBuy?.read === "failed" && !rule;
    const nowSheet = Date.now();
    /* The price condition holds the purchase back (1.18.0): the tick deferred it, or the figures read now do not meet it — the reason, the figure and the data's time. */
    const waitingOn = occurrence?.state === "deferred" && occurrence.condition ? occurrence.condition : conditionHolds ? conditionCheck : null;
    const closedWord = (() => {
      if (readFailed) return word("ruleReadFailed");
      if (ruleBuy?.read === "ready" && !rule) return word("ruleGone");
      if (!rule) return null;
      /* Open, and the month's budget does not cover it: the rules stand until the 1st («Бюджет вичерпано»). */
      if (budgetHolds) return `${word("budgetBlocks")} ${word("rulesStand")}.`;
      if (waitingOn) return deferralLine(waitingOn, name, nowSheet, ruleZone, lang);
      if (ruleOpen) return null;
      if (occurrence?.state === "bought") return word("reminderBought");
      if (occurrence?.state === "pending") return word("reminderPending");
      return word("reminderClosed");
    })();
    /* Until when the rule judges a deferred purchase again: its window's end on the rule's own clock. */
    const waitsUntil = waitingOn && occurrence && (occurrence.state === "deferred" || occurrence.state === "due") ? dueWords(Date.parse(occurrence.openUntil), ruleZone, lang) : null;
    const ruleCta = (() => {
      if (ticket.lockedReview) return { label: word("refreshPrice"), disabled: false, run: () => void ticket.cancelReview(true) };
      if (!connection) return { label: word("connectWallet"), disabled: false, run: onConnect };
      if (step === "proving") return { label: word("confirming"), disabled: true, run: undefined };
      if (proof.state.status === "idle" || proof.state.status === "checking") return { label: word("reading"), disabled: true, run: undefined };
      if (!proven || ruleBuy?.read === "unproven") return { label: word("confirmWallet"), disabled: false, run: () => void press() };
      if (readFailed) return { label: word("tryAgain"), disabled: false, run: () => onRulesReload?.() };
      if (budgetHolds && onChangeBudget) return { label: word("changeBudget"), disabled: false, run: onChangeBudget };
      if (closedWord) return { label: word("done"), disabled: false, run: onClose };
      if (!rule) return { label: word("reading"), disabled: true, run: undefined };
      if (phase === "PREPARING" || wantReview) return { label: word("preparingReview"), disabled: true, run: undefined };
      /* What is missing is never a dead button: the one action brings it — dollars first, then the network's SOL. */
      if (insufficient) return { label: word("topUp"), disabled: false, run: () => topUp(null) };
      if (cannotPayFee) return { label: word("topUpSol"), disabled: false, run: () => topUp("sol") };
      if (blocked || quoteStop) return { label: word("unavailableNow"), disabled: true, run: undefined };
      return { label: buyByRuleWord(locale, ruleSum ?? rule.amountUsd), disabled: false, run: () => void press() };
    })();
    return (
      <div className={company.sheetBody} data-sheet="rule-buy" data-deferred={waitingOn ? "true" : undefined}>
        {head(waitingOn ? word("purchaseDeferred") : ruleOpen || !rule ? word("timeToBuy") : `${word("autoinvest")} · ${name}`)}
        {preIpo ? <SheetTruth truth={truth} eventLine={eventLine} risks={riskLines} /> : null}
        {rule ? (
          <div className={company.ruleSummary}>
            <p className={company.ruleAmount}>{lang === "uk" ? `${usdWord(ruleSum ?? rule.amountUsd, lang)} в ${name}` : `${usdWord(ruleSum ?? rule.amountUsd, lang)} of ${name}`}</p>
            <p className={company.ruleWhen}>{ruleWhenLine(rule, lang)}</p>
          </div>
        ) : (
          <span className={company.lineBone} aria-hidden="true" />
        )}
        {ruleOpen && !budgetHolds && !conditionHolds ? (
          <p className={company.estimate} aria-live="polite">
            {estimateLine ?? (quoteFailure ? quoteFailure : uncounted ? " " : word("pricing"))}
          </p>
        ) : null}
        {/* The rule's price condition met now: why the purchase is offered — the deviation, the reference, the limit, the data's time. */}
        {ruleOpen && !budgetHolds && !conditionHolds && conditionCheck ? (
          <p className={company.ruleNote} data-condition="met" translate="no">
            {`${word("priceCondition")} · ${conditionReviewLine(conditionCheck, nowSheet, ruleZone, lang)}`}
          </p>
        ) : null}
        {closedWord ? (
          <p className={company.sheetNote} data-deferral={waitingOn ? waitingOn.verdict : undefined} translate={waitingOn ? "no" : undefined}>
            {closedWord}
          </p>
        ) : null}
        {waitingOn ? <p className={company.ruleNote} translate="no">{waitsUntil ? `${word("checksAgainUntil")} ${waitsUntil}.` : word("ruleChecksAgain")}</p> : null}
        {closedWord && !waitingOn && next && rule?.status === "active" ? <p className={company.ruleNote} translate="no">{`${word("nextPurchase")}: ${next}`}</p> : null}
        {!closedWord && ruleOpen && !insufficient && cannotPayFee ? <p className={company.sheetNote} data-empty="sol">{word("needSol")}</p> : null}
        {failure ? <p className={company.sheetError}>{failure}</p> : null}
        <div className={company.sheetActions}>
          <Button variant="primary" block disabled={ruleCta.disabled} onClick={ruleCta.run} lang={lang}>
            {ruleCta.label}
          </Button>
          {connection && usdc !== null && ruleOpen ? (
            <p className={company.sheetLinks}>
              <span translate="no">{`${insufficient ? `${word("notEnough")} · ` : ""}${word("walletHas")} ${formatUnits(usdc, numbers)} USDC`}</span>
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------ the purchase on the core's ticket */
  const warning = helpTopic("lossLimitWarning", locale);
  const sheetName = view.stage === "review" ? "review" : view.stage === "result" ? (outcome ? "receipt" : "recovery") : "compose";
  const stepWord = step === "proving" ? word("confirming") : step === "writing" ? word("savingLimit") : phase === "PREPARING" || wantReview ? word("preparingReview") : null;
  /* While the sheet works, or the sum cannot be bought as it stands, the action waits in its own words — as the sheet's button did. */
  const holdWord =
    view.stage !== "form" || !connection
      ? null
      : stepWord ??
        /* A sum over one purchase's limit is not sent: the action stands held — the limit is said once, above it — rather than pressable and doing nothing. */
        (over
          ? `${word("buyFor")} ${dollars(amount ?? 0, numbers)}`
          : noRoute && routeMinimum.state === "none"
          ? word("unavailableNow")
          : valid && amount !== null && ((noRoute && routeMinimum.state === "finding") || (limit && !made && !insufficient))
            ? `${word("buyFor")} ${dollars(amount, numbers)}`
            : null);
  return (
    <div className={company.sheetBody} data-sheet={sheetName} data-check={inReview ? (lines ? lines.basis : "none") : undefined} data-rule={byRule ? "true" : undefined}>
      {head(receiptTitle ?? (inReview ? word("review") : view.stage === "result" ? name : `${word("buy")} ${name}`))}
      {view.stage === "form" && preIpo ? <SheetTruth truth={truth} eventLine={eventLine} risks={riskLines} /> : null}
      {/* An ordinary purchase while a rule's reminder is open says so before any sum: the reminder stays open. */}
      {view.stage === "form" && ruleOffer ? (
        <p className={company.plainSheetNote} data-rule-open>
          {plainLeavesOpenLine(locale, ruleOffer.amountUsd)}
        </p>
      ) : null}
      {/* The reserve a new token's account keeps, said first when it is more than the purchase itself. */}
      {reserveFirst && reserve && paidUsd !== null ? (
        <p className={company.sheetWarning} data-reserve-first>
          {reserveFirstLine(locale, reserve, dollars(paidUsd, numbers))}
        </p>
      ) : null}

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
              {buyerEvent ? <span data-company-event="buyer"> {buyerEvent}</span> : null}
              {saleMayFail ? <span data-sale-may-fail> {saleMayFail}</span> : null}
            </>
          ) : undefined
        }
        titleAs="h3"
        lang={lang}
        onDraftChange={(next) => {
          if (next.unit !== amountUnit) setAmountUnit(next.unit);
          onAmountText(next.amount);
        }}
        /* «Спробувати ще» only where another press can help: not on a refusal this deployment cannot pass, nor on a sum over the limit. */
        onRetryQuote={quoteStop || over ? undefined : () => ticket.refreshQuote()}
        onConnect={onConnect}
        onReview={() => void press()}
        {...(holdWord
          ? {
              action: (
                <Button variant="primary" block disabled lang={lang} data-ticket-action="">
                  {holdWord}
                </Button>
              ),
            }
          : {})}
        onCancel={() => void ticket.cancelReview()}
        onConfirm={() => void ticket.sign()}
        onVerify={settled && outcome?.kind !== "NOTHING_HAPPENED" ? () => window.open(explorerTxUrl("mainnet", settled.signature), "_blank", "noopener,noreferrer") : undefined}
        onAgain={() => ticket.reset()}
      />
      {/* The step the held action names, said to a screen reader as it changes. */}
      <p className={company.srOnly} role="status">
        {view.stage === "form" ? (stepWord ?? "") : ""}
      </p>

      {view.stage === "form" ? (
        <>
          {/* No route for this sum: the company's own minimum is one press away, never a dead button. */}
          {noRoute && minimumUsd !== null ? (
            <Button variant="secondary" block onClick={() => onAmountText(String(minimumUsd))} lang={lang}>
              {setMinimumWord(locale, dollars(minimumUsd, numbers))}
            </Button>
          ) : null}
          {ticket.lockedReview ? (
            <Button variant="secondary" block onClick={() => void ticket.cancelReview(true)} lang={lang}>
              {word("refreshPrice")}
            </Button>
          ) : null}
          <div className={company.limit}>
            <span className={company.limitLabel} id={`${titleId}-limit`}>
              {word("lossLimit")}
            </span>
            <div className={company.limitChips} role="group" aria-labelledby={`${titleId}-limit`}>
              {([null, "careful", "balanced"] as const).map((preset) => (
                <Button key={preset ?? "none"} variant={limit === preset ? "secondary" : "ghost"} aria-pressed={limit === preset} disabled={busy} onClick={() => onLimit(preset)} lang={lang}>
                  {preset === null ? word("limitNone") : `−${LOSS_LIMIT_PRESETS[preset].stopPct}%`}
                </Button>
              ))}
            </div>
          </div>
          {limit ? (
            <>
              {asset.status === "failed" ? <p className={company.sheetError}>{word("limitPriceUnknown")}</p> : made ? <LimitLine limitPerUnit={made.limitPerUnit} limit={limit} channel={proven ? channel : "unknown"} locale={locale} /> : <span className={company.lineBone} aria-hidden="true" />}
              {/* The warning in full one press deep, inside the sheet itself: the product's `?` opens in a portal the modal sheet would cover. */}
              <details className={company.risk}>
                <summary>{word("canLoseAll")}</summary>
                <p>{`${warning.short} ${warning.important}`}</p>
              </details>
            </>
          ) : null}
          {failure ? <p className={company.sheetError}>{failure}</p> : null}
          {/* What is missing is never a dead end: the top-up worded for it, dollars first, then the network's SOL. */}
          {insufficient ? (
            <Button variant="secondary" block icon="wallet" onClick={() => topUp(null)} lang={lang}>
              {word("topUp")}
            </Button>
          ) : valid && cannotPayFee ? (
            <>
              <p className={company.sheetNote} data-empty="sol">
                {word("needSol")}
              </p>
              <Button variant="secondary" block icon="wallet" onClick={() => topUp("sol")} lang={lang}>
                {word("topUpSol")}
              </Button>
            </>
          ) : null}
        </>
      ) : null}

      {inReview ? (
        <>
          {reserve ? <p className={company.sheetNote} data-reserve>{reserveLine(locale, reserve)}</p> : null}
          {plan && binding ? <LimitLine limitPerUnit={plan.limitPerUnit} limit={limit} channel={channel} locale={locale} /> : null}
          {ruleMode && boughtUnder ? (
            <p className={company.limitLine}>
              <span>{`${word("byRule")} · ${ruleWhenLine(boughtUnder, lang)}`}</span>
            </p>
          ) : null}
          {/* The rule's price condition, judged on the figures read now: the deviation, the reference, the limit, the data's time. */}
          {ruleMode && boughtUnder && reviewedCondition ? (
            <p className={company.limitLine} data-condition={reviewedCondition.verdict} translate="no">
              <span>{`${word("priceCondition")} · ${conditionReviewLine(reviewedCondition, Date.now(), ruleZone, lang)}`}</span>
            </p>
          ) : null}
          {failure ? <p className={company.sheetError}>{failure}</p> : null}
          {/* A price that no longer holds: the Review keeps its figures, and a fresh one is one press. */}
          {view.stale && !view.signing ? (
            <Button variant="secondary" block onClick={() => void ticket.cancelReview(true)} lang={lang}>
              {word("refreshPrice")}
            </Button>
          ) : null}
        </>
      ) : null}

      {view.stage === "result" && outcome ? (
        <>
          {outcome.kind === "FILLED" && gotUnits !== null ? <p className={company.receiptSub}>{unitsPhrase(gotUnits, unit, name, lang, numbers)}</p> : null}
          {outcome.kind === "FILLED" && outcome.note ? <p className={company.receiptNote}>{outcome.note === "BELOW_MINIMUM" ? word("belowMinimum") : word("notAsReviewed")}</p> : null}
          {byRule ? (
            <p className={company.ruleMark}>
              <span>{`${word("byRule")} · ${ruleWhenLine(byRule, lang)}`}</span>
              {nextOfRule ? <span translate="no">{`${word("nextPurchase")}: ${nextOfRule}`}</span> : null}
            </p>
          ) : null}
          {watched ? (
            channel === "connected" ? (
              <p className={company.receiptWatch}>
                {word("watchingLimit")} <b translate="no">{formatUsdPrice(watched.limitPerUnit, numbers)}</b>
              </p>
            ) : (
              <p className={company.receiptWatch}>
                <Link href="/app/settings#account" prefetch={false}>
                  {word("limitSavedNoChannel")}
                </Link>
              </p>
            )
          ) : null}
          <div className={company.sheetActions}>
            {outcome.kind === "FILLED" ? (
              <Button variant="primary" block onClick={onClose} lang={lang}>
                {word("done")}
              </Button>
            ) : null}
            {weekly !== null ? (
              <Button variant="secondary" block onClick={() => onBuyWeekly?.(weekly)} lang={lang}>
                {word("buyWeekly")}
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
            {word("unknownTx")}
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

/**
 * A private company's truth at the top of the sheet, before any sum, with
 * its strongest risks under it — a sale may not go through, the company's
 * own word about tokens like this one (UX-500) — and, where the issuer opened
 * a swap window, the event in the same box: the token bought now must be
 * swapped by the issuer's deadline (the IPO and conversion watch).
 */
export function SheetTruth({ truth, eventLine, risks = [] }: { truth: string; eventLine: string | null; risks?: readonly string[] }) {
  if (!eventLine && risks.length === 0) {
    return (
      <p className={company.sheetWarning} data-company-truth>
        {truth}
      </p>
    );
  }
  return (
    <div className={company.sheetWarning}>
      <p data-company-truth>{truth}</p>
      {risks.map((risk) => (
        <p key={risk} className={company.sheetRisk} data-buy-risk>
          {risk}
        </p>
      ))}
      {eventLine ? (
        <p className={company.warningEvent} data-company-event="buyer">
          <HourglassMedium size={16} weight="bold" aria-hidden="true" />
          <span>{eventLine}</span>
        </p>
      ) : null}
    </div>
  );
}

/** The loss limit in one line: where it stands, and whether Ryntra can warn — said only when the channel is known. */
function LimitLine({ limitPerUnit, limit, channel, locale }: { limitPerUnit: number; limit: LossLimitPreset | null; channel: Channel; locale: WorkspaceLocale }) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const pct = limit ? ` · −${LOSS_LIMIT_PRESETS[limit].stopPct}%` : "";
  return (
    <p className={company.limitLine}>
      <span translate="no">{`${word("limitWord")} ${formatUsdPrice(limitPerUnit, numbers)}${pct}`}</span>
      {channel === "connected" ? <span>{word("warnsTelegram")}</span> : null}
      {channel === "none" ? (
        <Link href="/app/settings#account" prefetch={false}>
          {word("noProtection")}
        </Link>
      ) : null}
    </p>
  );
}
