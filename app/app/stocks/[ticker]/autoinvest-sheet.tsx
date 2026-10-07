"use client";

import { CheckCircle, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { browserTimeZone, deferredNow, firstDue, lastSettled, openingSchedule, purchaseSumUsd, reminderOpenNow, RULE_MAX_USD, ruleZone, timeOfInput, withCadence } from "@/app/app/invest/autoinvest-model";
import { BudgetRow } from "@/app/app/invest/budget-row";
import { dollars, MIN_BUY_USD, parseDollars } from "@/app/app/invest/company-model";
import { buyByRuleWord, investWords, numberLocale, routeMinimumLine, setAsideExample, setMinimumWord, type InvestWord } from "@/app/app/invest/invest-words";
import { anchorNowLine, anchorStandingLine, conditionNowLine, conditionShort, deferralLine } from "@/app/app/invest/price-condition-view";
import { useConditionFacts } from "@/app/app/invest/use-condition-facts";
import { useRuleAsset } from "@/app/app/invest/use-rule-asset";
import { useQuoteRoute, useRouteMinimum } from "@/app/app/invest/use-route-minimum";
import type { RuleWrite } from "@/app/app/invest/use-rules";
import { Help } from "@/app/shell/help";
import type { WorkspaceLocale } from "@/app/shell/locale";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { MarketIcon } from "@/app/solana/workspace/spot/market-list";
import { useWalletProof } from "@/app/solana/workspace/wallet-proof";
import type { AutoinvestRule, RuleAssetRead, RuleBudget, RuleCreateRequest, RuleKind, RuleOccurrence, RulePaymentEvent, RuleStatus } from "@/lib/api/v1/contract";
import { dipTriggerUsd } from "@/lib/autoinvest/dip";
import { ageWord, floorLine, floorMetLine, isListedToken } from "@/lib/autoinvest/floor";
import {
  PAYMENT_FIXED_MAX_USD,
  PAYMENT_FIXED_MIN_USD,
  PAYMENT_PERCENT_PRESETS,
  PAYMENT_ROUNDUP_STEPS_USD,
  PRICE_CONDITION_DEFAULT_PCT,
  PRICE_CONDITION_PRESETS_PCT,
  RULE_DEFAULT_USD,
  RULE_DIP_PRESETS_PCT,
  RULE_MINIMUM_USD,
} from "@/lib/autoinvest/limits";
import { contributionCents, RULE_PAYMENT_MODES, type RulePaymentMode } from "@/lib/autoinvest/payments";
import { checkPriceCondition, conditionLine, type PriceFacts, type PriceReference } from "@/lib/autoinvest/price-condition";
import type { RuleCadence, RuleSchedule } from "@/lib/autoinvest/schedule";
import { cadenceWord, dayWords, dueWords, paymentsLine, pctWord, priceWord, ruleWhenLine, usdWord, WEEKDAY_SHORT } from "@/lib/autoinvest/words";

import { SheetTruth } from "./buy-sheet";
import company from "./company.module.css";

/**
 * «Автоінвест» on a company, a sheet like the purchase's: from the bottom of
 * a phone, in the middle of a wide screen.
 *
 * **Намір.** Two rules: «Регулярно» — a sum in dollars from $1, every day,
 * week or month, the day and the time on the person's own clock, and at once
 * when the first reminder comes («Перша купівля: чт, 24 вер. о 19:00») from
 * the same schedule functions the server reminds with. The sheet opens on
 * «Щотижня · $10» — a default, not advice: the sum and how often are the
 * person's own, on their own budget, from a dollar. From a receipt's
 * «Купувати щотижня» it opens weekly on the sum just bought. A company whose
 * live route starts above the sum says its own minimum from the quote before
 * the rule is turned on, and the one action puts it in; and «Якщо впаде» —
 * the sum and how far the price must fall below the price now («Ryntra
 * нагадає при $319,15 або нижче»). The sum reads «Кожна купівля» — it is each
 * purchase, never the month's budget. **Межі.** The month's budget for every
 * rule, the person's own choice, as its own line — «Бюджет не задано ·
 * Задати» or «Бюджет місяця $10 з $50 · Змінити» — that opens the budget's
 * own sheet («Не більше на місяць»). Under it, always: «Ryntra нагадає — ти
 * підтвердиш одним дотиком. Гроші лишаються у твоєму гаманці.» **Дозвіл** is
 * not asked here: a rule only schedules a reminder; «Увімкнути» writes it
 * behind the wallet's proof — a signed message, never a transaction — and
 * every purchase later is its own signature.
 *
 * A company that already has a rule opens it instead: what it is, when the
 * next purchase is or the line its price must fall to, what became of the
 * last one, and pause, turn on again or delete. When its reminder is open,
 * the one orange action buys it: «Купити $20 за правилом».
 *
 * **Умова ціни**: a company with a reference — PreStocks' valuation for a
 * private one, the reference per share for a listed one — offers «Не
 * купувати, якщо дорожче за орієнтир більш ніж на N %», 5 % unless the person
 * picks 2 %, 10 % or «Без умови», with how the price stands now. A rule that
 * has it says so, and a purchase it deferred says why — the reason, the
 * figure and the data's time.
 *
 * **Any token with liquidity** (1.31.0): the same sheet on a coin, a meme or
 * a new token reads what a rule on it would stand on from the server
 * (`useRuleAsset`) — the floor, and for a meme or a new token the facts of
 * its risk, said before the button; a token under the floor, flagged by the
 * venue's audit or unread offers no «Увімкнути». A token's «Умова ціни»
 * stands against the price when the rule is turned on and opens on «Без
 * умови»: a fixed point is a ceiling, and a recurring buy keeps buying unless
 * the person sets one. The sheet also stands inside Spot's order
 * (`variant: "ticket"`): no head, no close — the ticket's own tab leaves it.
 */

/** A new rule — on a sum (a receipt's), and how often it opens: daily unless said (a receipt's «Купувати щотижня» says weekly) — or an existing rule to manage. */
export type AutoinvestMode = Readonly<{ kind: "compose"; amountUsd: number | null; cadence?: RuleCadence }> | Readonly<{ kind: "manage"; rule: AutoinvestRule }>;

/** «Щотижня $10 в Apple» · «$10 of Apple, every week»; «Якщо Apple впаде на 5 % — докупити $20» · «If Apple falls 5% — buy $20 more»; «Округлення кожної оплати до $1 — в Apple» · «Round every payment up to $1 — into Apple». */
export function ruleSentence(rule: Pick<AutoinvestRule, "amountUsd" | "schedule" | "dip"> & Partial<Pick<AutoinvestRule, "payments">>, name: string, lang: "en" | "uk"): string {
  const usd = usdWord(rule.amountUsd, lang);
  if (rule.payments) return lang === "uk" ? `${paymentsLine(rule.payments, "uk")} — в ${name}` : `${paymentsLine(rule.payments, "en")} — into ${name}`;
  if (rule.dip) {
    return lang === "uk" ? `Якщо ${name} впаде на ${pctWord(rule.dip.dropPct, "uk")} — докупити ${usd}` : `If ${name} falls ${pctWord(rule.dip.dropPct, "en")} — buy ${usd} more`;
  }
  const cadence = rule.schedule?.cadence ?? "weekly";
  return lang === "uk" ? `${cadenceWord(cadence, "uk")} ${usd} в ${name}` : `${usd} of ${name}, ${cadenceWord(cadence, "en").toLowerCase()}`;
}

type Channel = "unknown" | "connected" | "none";
type Step = "idle" | "proving" | "saving";

const API_HEADERS = { accept: "application/json", "X-Ryntra-API": "1" } as const;
const CADENCES: readonly RuleCadence[] = ["daily", "weekly", "monthly"];
const KINDS: readonly RuleKind[] = ["schedule", "dip", "payments"];
const DEFAULT_DROP = RULE_DIP_PRESETS_PCT[0];
/* «З кожної оплати» opens on the round-up to $1 — a default, not advice. */
const DEFAULT_PERCENT = PAYMENT_PERCENT_PRESETS[1];
/** The payment an example line reads — «Оплата $3,40 → $0,60 в Apple» — and the incoming transfer. */
const EXAMPLE_PAYMENT_USD = 3.4;
const EXAMPLE_INCOMING_USD = 100;
/** How many counted events the rule's sheet names; the rest are counted all the same. */
const EVENTS_SHOWN = 6;

export type AutoinvestSheetProps = Readonly<{
  open: boolean;
  mode: AutoinvestMode;
  mint: string;
  name: string;
  icon: string | null;
  preIpo: boolean;
  truth: string;
  /** The issuer's event before a rule's first purchase (the IPO and conversion watch): the token bought must be swapped by the deadline. */
  eventLine?: string | null;
  /** The price the page shows now — the reference point a «Якщо впаде» rule would start from. */
  priceUsd: number | null;
  /** «Умова ціни»: whose figure the price is set against for this company; null when it has none, and no condition is offered. */
  /* undefined: not known here (Home's «Додати правило») — the sheet reads it from the company's row. */
  conditionReference?: PriceReference | null;
  /** The facts the condition is judged on, as the page read them — read again while the sheet is open. */
  conditionFacts?: PriceFacts | null;
  /** The month's budget as the rules' read last said it; null before it is read. */
  budget: RuleBudget | null;
  locale: WorkspaceLocale;
  onClose: () => void;
  onConnect: () => void;
  onCreate: (request: RuleCreateRequest) => Promise<RuleWrite>;
  onSetStatus: (ruleId: string, status: RuleStatus) => Promise<RuleWrite>;
  onRemove: (ruleId: string) => Promise<RuleWrite>;
  /** The budget's own sheet, over this one — the month's budget is set there, never beside the rule's sum. */
  onEditBudget: () => void;
  /** An open reminder, bought now: the purchase sheet on the rule's sum. */
  onBuyNow: (rule: AutoinvestRule, occurrence: RuleOccurrence) => void;
  /** 1.19.0: «Мій рахунок» — a counted payment's other side is the person's own account; absent where the page cannot write it. */
  onMarkOwn?: (signature: string) => Promise<RuleWrite>;
  /** 1.31.0: a token of the venue's list — a coin, a meme, a new token — rather than a company; the sheet reads its floor and its facts of risk. */
  token?: boolean;
  /** 1.31.0: `ticket` stands inside Spot's order — no head and no close; `sheet` (the default) a dialog over the page. */
  variant?: "sheet" | "ticket";
  /** What stands in the one action's place while no wallet is connected — the ticket's own connect row. */
  connectAction?: ReactNode;
}>;

export function AutoinvestSheet(props: AutoinvestSheetProps) {
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

  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  return (
    <dialog
      ref={dialog}
      className={company.sheet}
      aria-labelledby={titleId}
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
      {open ? <AutoinvestFlow {...props} titleId={titleId} onBusy={setBusy} onClose={requestClose} /> : null}
    </dialog>
  );
}

/** What became of a rule's last occurrence, in one word. */
function lastWord(state: RuleOccurrence["state"]): InvestWord {
  if (state === "bought") return "lastBought";
  if (state === "pending") return "lastPending";
  if (state === "held") return "budgetSpent";
  if (state === "deferred") return "purchaseDeferred";
  return "lastMissed";
}

/** The limits the sheet offers, and «Без умови». */
const CONDITION_CHOICES: readonly (number | null)[] = [...PRICE_CONDITION_PRESETS_PCT, null];

/**
 * The facts of a meme's or a new token's risk, before the button: its age,
 * liquidity, the ten largest holders, who can still mint or freeze, the
 * organic score and Jupiter's list — each a fact as the venue states it,
 * never a verdict.
 */
function RiskFacts({ read, locale, compact = false }: Readonly<{ read: RuleAssetRead; locale: WorkspaceLocale; compact?: boolean }>) {
  const word = investWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const numbers = numberLocale(locale);
  const risk = read.risk;
  if (!risk) return null;
  const pct = (value: number) => `${new Intl.NumberFormat(numbers, { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)}${lang === "uk" ? " %" : "%"}`;
  /* Liquidity as the market's header says it: «$7,2 млн» · «$7.2M». */
  const usd = (value: number) => `$${new Intl.NumberFormat(numbers, { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
  const authority = (disabled: boolean | null) => (disabled === null ? word("riskNotStated") : disabled ? word("riskClosed") : word("riskOpen"));
  /* In Spot the market's header already states the age, the liquidity and the top holders: the ticket keeps only what it lacks. */
  const rows: readonly (readonly [string, string, "risk" | undefined])[] = [
    ...(compact
      ? []
      : ([
          [word("riskAge"), risk.ageHours === null ? word("riskNotStated") : ageWord(risk.ageHours, lang), undefined],
          [word("riskLiquidity"), risk.liquidityUsd === null ? word("riskNotStated") : usd(risk.liquidityUsd), undefined],
          [word("riskTopHolders"), risk.topHoldersPct === null ? word("riskNotStated") : pct(risk.topHoldersPct), risk.topHoldersPct !== null && risk.topHoldersPct >= 50 ? "risk" : undefined],
        ] as const)),
    [word("riskMint"), authority(risk.mintAuthorityDisabled), risk.mintAuthorityDisabled === false ? "risk" : undefined],
    [word("riskFreeze"), authority(risk.freezeAuthorityDisabled), risk.freezeAuthorityDisabled === false ? "risk" : undefined],
    [word("riskOrganic"), risk.organicScore === null ? word("riskNotStated") : `${Math.round(risk.organicScore)} / 100`, undefined],
    [word("riskVerified"), risk.verified ? word("riskVerifiedYes") : word("riskVerifiedNo"), risk.verified ? undefined : "risk"],
  ];
  return (
    <section className={company.riskFacts} aria-label={word("riskFacts")} data-risk-facts>
      <p className={company.limitLabel}>{word("riskFacts")}</p>
      <dl className={company.riskGrid}>
        {rows.map(([label, value, tone]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd translate="no" data-caution={tone === "risk" ? "true" : undefined}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <p className={company.ruleNote}>{word("riskSource")}</p>
    </section>
  );
}

function AutoinvestFlow({
  mode,
  mint,
  name,
  icon,
  preIpo,
  truth,
  eventLine = null,
  priceUsd,
  conditionReference,
  conditionFacts = null,
  budget,
  locale,
  titleId,
  onBusy,
  onClose,
  onConnect,
  onCreate,
  onSetStatus,
  onRemove,
  onEditBudget,
  onBuyNow,
  onMarkOwn,
  token: tokenProp = false,
  variant = "sheet",
  connectAction = null,
}: AutoinvestSheetProps & { titleId: string; onBusy: (busy: boolean) => void }) {
  const word = investWords(locale);
  const numbers = numberLocale(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const { connection } = useSolanaConnection();
  const proof = useWalletProof();
  const proven = proof.state.status === "proven";

  const [nowMs, setNowMs] = useState(() => Date.now());
  const [timeZone] = useState(() => browserTimeZone());
  useEffect(() => {
    /* «Перша купівля» is counted from now, not from when the sheet opened: a time a minute ahead stays honest while the person reads. */
    const timer = window.setInterval(() => setNowMs(Date.now()), 20_000);
    return () => window.clearInterval(timer);
  }, []);
  /* A token of the venue's list (1.31.0): what a rule on it would stand on, read from the server while a rule is being written. */
  const token = mode.kind === "manage" ? isListedToken(mode.rule.asset) : tokenProp;
  const tokenRead = useRuleAsset(mint, token && mode.kind === "compose");
  const tokenFacts = tokenRead.read;
  /* A token's reference is its price now, fresh from the read — the price a fall counts from and a condition stands against. */
  const tokenPrice = tokenFacts?.priceUsd ?? null;
  const [kind, setKind] = useState<RuleKind>("schedule");
  const [dropPct, setDropPct] = useState<number>(DEFAULT_DROP);
  /* «З кожної оплати»: the mode and its one figure — the round-up to $1 unless the person picks another. */
  const [payMode, setPayMode] = useState<RulePaymentMode>("roundup");
  const [roundTo, setRoundTo] = useState<number>(PAYMENT_ROUNDUP_STEPS_USD[0]);
  const [fixedText, setFixedText] = useState(String(RULE_MINIMUM_USD));
  const [percent, setPercent] = useState<number>(DEFAULT_PERCENT);
  /* The least sum a reminder opens at: a dollar, or the company's own minimum from the live quote when a dollar does not route. */
  const [thresholdUsd, setThresholdUsd] = useState<number>(RULE_MINIMUM_USD);
  const [ownAsk, setOwnAsk] = useState<string | null>(null);
  /*
   * «Умова ціни»: 5 % unless the person picks another limit or «Без умови» —
   * offered only where the company has a reference. A sheet opened without
   * the company's row (Home's «Додати правило») reads it, and turns nothing
   * on until it knows whether there is a reference to offer.
   */
  /* A token opens on «Без умови»: its reference is a fixed point, so a limit is a ceiling the person sets on purpose. */
  const [limitPct, setLimitPct] = useState<number | null>(token || conditionReference === null ? null : PRICE_CONDITION_DEFAULT_PCT);
  const conditionRead = useConditionFacts(mint, !token && conditionReference !== null && (mode.kind === "compose" || mode.rule.priceCondition !== null), conditionFacts);
  const conditionFresh = conditionRead.facts;
  const reference: PriceReference | null = token ? (tokenPrice !== null ? "enabled" : null) : (conditionReference ?? conditionFresh?.reference ?? null);
  const referencePending = token ? tokenRead.status === "idle" || tokenRead.status === "loading" : conditionReference === undefined && conditionRead.status !== "ready" && conditionRead.status !== "failed";
  const [amountText, setAmountText] = useState(String(mode.kind === "compose" && mode.amountUsd !== null ? Math.max(MIN_BUY_USD, Math.round(mode.amountUsd * 100) / 100) : RULE_DEFAULT_USD));
  /* «Щодня · $1» unless the sheet was opened for another cadence: «щодня по $1» is two taps. */
  const [schedule, setSchedule] = useState<RuleSchedule>(() => openingSchedule(Date.now(), browserTimeZone(), mode.kind === "compose" ? mode.cadence : undefined));
  const [step, setStep] = useState<Step>("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const [made, setMade] = useState<AutoinvestRule | null>(null);
  const [changing, setChanging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [channel, setChannel] = useState<Channel>("unknown");

  useEffect(() => {
    onBusy(step !== "idle" || changing);
  }, [step, changing, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);

  useEffect(() => {
    /* Whether a reminder can reach Telegram — read only for a proven wallet; a sheet never says a channel it has not read. */
    if (!proven) return undefined;
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
  }, [proven]);

  /* Whether the rule's sum routes into the company now, and if not, the company's own minimum from the same quote — asked before the rule is turned on, never after. */
  const composing = mode.kind === "compose" && made === null;
  const typed = parseDollars(amountText, lang);
  const typedValid = typed !== null && typed >= MIN_BUY_USD && typed <= RULE_MAX_USD;
  /* A «З кожної оплати» rule's purchases are its reminders' sums, from its minimum up: the minimum is what must route. */
  const routedSum = kind === "payments" ? thresholdUsd : typedValid ? typed : null;
  const route = useQuoteRoute(mint, routedSum, composing);
  const routeMinimum = useRouteMinimum(mint, routedSum, composing && route === "no-route");
  useEffect(() => {
    /* A dollar that does not route into the company: the rule reminds from the company's own minimum, and says so. */
    const found = routeMinimum.state === "found" ? routeMinimum.minimumUsd : null;
    if (kind === "payments" && found !== null && found > thresholdUsd) setThresholdUsd(found);
  }, [kind, routeMinimum, thresholdUsd]);

  const ticket = variant === "ticket";
  const bodyClass = ticket ? `${company.sheetBody} ${company.ticketBody}` : company.sheetBody;
  const head = (title: string) =>
    ticket ? null : (
    <div className={company.sheetHead}>
      <span className={company.grab} aria-hidden="true" />
      <MarketIcon mint={mint} icon={icon} symbol={name} size={32} className={company.sheetLogo} />
      <h2 id={titleId} className={company.sheetTitle}>
        {title}
      </h2>
      <button type="button" className={company.sheetClose} onClick={onClose} disabled={step !== "idle" || changing} aria-label={word("close")}>
        <X size={18} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );

  const channelLine =
    channel === "none" ? (
      <p className={company.ruleNote}>
        <Link href="/app/settings#account" prefetch={false}>
          {word("connectTelegramReminder")}
        </Link>
      </p>
    ) : channel === "connected" ? (
      <p className={company.ruleNote}>{word("remindersTelegram")}</p>
    ) : null;

  /* ------------------------------------------------------------ done */
  if (made) {
    const next = made.nextDueAt && made.schedule ? dueWords(Date.parse(made.nextDueAt), made.schedule.timeZone, lang) : null;
    return (
      <div className={bodyClass} data-sheet="autoinvest-on">
        {head(`${word("autoinvest")} · ${name}`)}
        <div className={company.receipt} data-tone="matched" role="status">
          <span className={company.receiptMark} aria-hidden="true">
            <CheckCircle size={44} weight="fill" />
          </span>
          <p className={company.receiptTitle}>{word("autoinvestOn")}</p>
          <p className={company.receiptSub}>{ruleSentence(made, name, lang)}</p>
          {next ? <p className={company.receiptWatch}>{`${word("firstPurchase")}: ${next}`}</p> : null}
          {made.priceCondition ? (
            <p className={company.receiptWatch} translate="no">
              {typeof made.priceCondition.referenceUsd === "number"
                ? `${word("priceCondition")}: ${anchorStandingLine(made.priceCondition.referenceUsd, made.priceCondition.limitPct, lang)}`
                : `${word("priceCondition")}: ${conditionShort(made.priceCondition.limitPct, reference, lang)}`}
            </p>
          ) : null}
          {made.dip ? <p className={company.receiptWatch} translate="no">{`${word("remindAt")} ${priceWord(made.dip.triggerUsd, lang)} ${word("orLower")}`}</p> : null}
          {made.payments ? <p className={company.receiptWatch} translate="no">{`${word("remindFrom")} ${usdWord(made.amountUsd, lang)} · ${word("countingSince")} ${dueWords(Date.parse(made.payments.since), made.payments.timeZone, lang)}`}</p> : null}
        </div>
        <p className={company.rulePromise}>{word("autoinvestPromise")}</p>
        {channelLine}
        <div className={company.sheetActions}>
          <button type="button" className="rw-btn rw-btn--primary" onClick={onClose}>
            {word("done")}
          </button>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------ manage */
  if (mode.kind === "manage") {
    const rule = mode.rule;
    const due = reminderOpenNow(rule, nowMs);
    /* A purchase the price condition holds back: why, and until when the rule judges it again. */
    const deferred = due ? null : deferredNow(rule, nowMs);
    const last = lastSettled(rule);
    const paused = rule.status === "paused";
    const zone = ruleZone(rule, timeZone);
    const next = rule.nextDueAt ? dueWords(Date.parse(rule.nextDueAt), zone, lang) : null;
    const payments = rule.payments;
    const change = async (run: () => Promise<RuleWrite>, after?: () => void) => {
      setFailure(null);
      if (!proven) {
        const ok = await proof.prove();
        if (ok !== true) {
          setFailure(word("walletDeclined"));
          return;
        }
      }
      setChanging(true);
      const result = await run();
      setChanging(false);
      if (!result.ok) {
        setFailure(
          result.code === "RULE_LIQUIDITY_LOW"
            ? word("floorRefusesTurnOn")
            : result.code === "ASSET_UNCONFIRMED" && token
              ? word("tokenNotSupported")
              : result.code === "UNAVAILABLE" && (rule.dip || token)
                ? token
                  ? word("tokenUnreadable")
                  : word("priceUnknownNow")
                : word("ruleChangeFailed"),
        );
        return;
      }
      after?.();
    };
    /* A token's purchase held back by its floor says so first: a thin pool is the reason whatever the price says. */
    const floorHeld = deferred?.floor && deferred.floor.verdict !== "met" ? deferred.floor : null;
    return (
      <div className={bodyClass} data-sheet="autoinvest-rule">
        {head(`${word("autoinvest")} · ${name}`)}
        <div className={company.ruleSummary}>
          {/* A «З кожної оплати» rule's figure is what it has gathered; its minimum is the line under it. */}
          <p className={company.ruleAmount}>{usdWord(payments ? payments.gatheredUsd : rule.amountUsd, lang)}</p>
          <p className={company.ruleWhen}>{payments ? `${word("gathered")} · ${word("remindFrom").toLowerCase()} ${usdWord(rule.amountUsd, lang)}` : ruleWhenLine(rule, lang)}</p>
        </div>
        <dl className={company.review} aria-label={word("autoinvest")}>
          {payments ? (
            <>
              <div>
                <dt>{word("whatToSetAside")}</dt>
                <dd translate="no">{paymentsLine(payments, lang)}</dd>
              </div>
              <div>
                <dt>{paused ? word("onPause") : word("countingSince")}</dt>
                <dd translate="no">{paused ? "—" : dueWords(Date.parse(payments.since), zone, lang)}</dd>
              </div>
            </>
          ) : rule.dip ? (
            <>
              <div>
                <dt>{word("referencePoint")}</dt>
                <dd translate="no">
                  {priceWord(rule.dip.anchorUsd, lang)}
                  <span>{`${rule.dip.anchorFrom === "purchase" ? word("fromPurchase") : word("fromEnabled")} · ${dayWords(Date.parse(rule.dip.anchorAt), zone, lang)}`}</span>
                </dd>
              </div>
              <div>
                <dt>{paused ? word("onPause") : word("remindAt")}</dt>
                <dd translate="no">
                  {paused ? "—" : priceWord(rule.dip.triggerUsd, lang)}
                  {paused ? null : <span>{word("orLower")}</span>}
                </dd>
              </div>
            </>
          ) : (
            <div>
              <dt>{paused ? word("onPause") : word("nextPurchase")}</dt>
              <dd translate="no">{paused ? "—" : (next ?? "—")}</dd>
            </div>
          )}
          {rule.priceCondition ? (
            <div>
              <dt>{typeof rule.priceCondition.referenceUsd === "number" ? word("priceWhenOn") : word("priceCondition")}</dt>
              <dd translate="no">
                {typeof rule.priceCondition.referenceUsd === "number" ? anchorStandingLine(rule.priceCondition.referenceUsd, rule.priceCondition.limitPct, lang) : conditionShort(rule.priceCondition.limitPct, reference, lang)}
              </dd>
            </div>
          ) : null}
          {floorHeld ? (
            <div data-deferral={`floor-${floorHeld.verdict}`}>
              <dt>{word("purchaseDeferred")}</dt>
              <dd translate="no">
                {floorLine(floorHeld, "", lang)}
                <span>{`${word("checksAgainUntil")} ${dueWords(Date.parse(deferred?.openUntil ?? ""), zone, lang)}`}</span>
              </dd>
            </div>
          ) : deferred?.condition ? (
            <div data-deferral={deferred.condition.verdict}>
              <dt>{word("purchaseDeferred")}</dt>
              <dd translate="no">
                {deferralLine(deferred.condition, name, nowMs, zone, lang)}
                <span>{`${word("checksAgainUntil")} ${dueWords(Date.parse(deferred.openUntil), zone, lang)}`}</span>
              </dd>
            </div>
          ) : null}
          {due ? (
            <div>
              <dt>{word("timeToBuy")}</dt>
              <dd translate="no">{usdWord(purchaseSumUsd(rule, due), lang)}</dd>
            </div>
          ) : deferred ? null : last ? (
            <div>
              <dt>{word(lastWord(last.state))}</dt>
              <dd translate="no">
                {rule.dip ? dayWords(Date.parse(last.dueAt), zone, lang) : dueWords(Date.parse(last.dueAt), zone, lang)}
                {last.state === "bought" && last.spentUsd !== null ? <span>{dollars(last.spentUsd, numbers)}</span> : null}
              </dd>
            </div>
          ) : null}
        </dl>
        {rule.dip && !paused ? <p className={company.ruleNote}>{word("oneReminderPerFall")}</p> : null}
        {payments ? (
          <PaymentEvents
            events={payments.events}
            incoming={payments.mode === "percent"}
            read={payments.read}
            zone={zone}
            locale={locale}
            asking={ownAsk}
            busy={changing}
            onAsk={onMarkOwn ? setOwnAsk : null}
            onConfirm={(signature) => void change(() => (onMarkOwn ? onMarkOwn(signature) : Promise.resolve({ ok: false as const, code: null })), () => setOwnAsk(null))}
          />
        ) : null}
        <p className={company.rulePromise}>{word("autoinvestPromise")}</p>
        {channelLine}
        {failure ? <p className={company.sheetError}>{failure}</p> : null}
        {confirmDelete ? (
          <div className={company.sheetActions} data-confirm="delete">
            <p className={company.sheetNote}>{word("deleteConfirm")}</p>
            <button type="button" className="rw-btn" disabled={changing} onClick={() => void change(() => onRemove(rule.id), onClose)}>
              {word("deleteYes")}
            </button>
            <button type="button" className={company.quietButton} disabled={changing} onClick={() => setConfirmDelete(false)}>
              {word("cancel")}
            </button>
          </div>
        ) : (
          <div className={company.sheetActions}>
            {due ? (
              <button type="button" className="rw-btn rw-btn--primary" disabled={changing} onClick={() => onBuyNow(rule, due)}>
                {buyByRuleWord(locale, purchaseSumUsd(rule, due))}
              </button>
            ) : paused ? (
              <button type="button" className="rw-btn rw-btn--primary" disabled={changing} onClick={() => void change(() => onSetStatus(rule.id, "active"))}>
                {changing ? word("turningOn") : word("turnOnAgain")}
              </button>
            ) : ticket ? null : (
              /* In the ticket the rule simply stands: nothing to close, and the ticket's one orange action stays the order's. */
              <button type="button" className="rw-btn rw-btn--primary" disabled={changing} onClick={onClose}>
                {word("done")}
              </button>
            )}
            {paused ? null : (
              <button type="button" className="rw-btn" disabled={changing} onClick={() => void change(() => onSetStatus(rule.id, "paused"))}>
                {word("pause")}
              </button>
            )}
            <button type="button" className={company.quietButton} disabled={changing} onClick={() => setConfirmDelete(true)}>
              {word("deleteRule")}
            </button>
          </div>
        )}
      </div>
    );
  }

  /* ------------------------------------------------------------ compose */
  const amount = parseDollars(amountText, lang);
  const valid = amount !== null && amount >= MIN_BUY_USD && amount <= RULE_MAX_USD;
  const first = kind === "schedule" ? firstDue(schedule, nowMs) : null;
  const weekdays = WEEKDAY_SHORT[lang];
  /* A fall counts from the price now: the token's own from the read, the company's from its page. */
  const fallFrom = token ? tokenPrice : priceUsd;
  const trigger = fallFrom !== null && fallFrom > 0 ? dipTriggerUsd(fallFrom, dropPct) : null;
  /* How the price stands against the reference now, judged at the limit chosen — the same judgement the rule's tick makes. */
  const conditionNow = reference && limitPct !== null ? checkPriceCondition(limitPct, conditionFresh, nowMs) : null;

  /* «З кожної оплати»: the fixed sum typed, and what the rule would set aside from an example — the same function the tick counts with. */
  const fixed = parseDollars(fixedText, lang);
  const fixedValid = fixed !== null && fixed >= PAYMENT_FIXED_MIN_USD && fixed <= PAYMENT_FIXED_MAX_USD && Math.abs(Math.round(fixed * 100) - fixed * 100) < 1e-6;
  const payTerms = { mode: payMode, roundToUsd: payMode === "roundup" ? roundTo : null, fixedUsd: payMode === "fixed" && fixedValid ? fixed : null, percent: payMode === "percent" ? percent : null } as const;
  const exampleDirection = payMode === "percent" ? "in" : "out";
  const exampleUsd = payMode === "percent" ? EXAMPLE_INCOMING_USD : EXAMPLE_PAYMENT_USD;
  const exampleAdd = contributionCents(payTerms, { direction: exampleDirection, amountMicro: BigInt(Math.round(exampleUsd * 1_000_000)) }) / 100;

  const enable = async () => {
    setFailure(null);
    if (!connection) {
      onConnect();
      return;
    }
    if (kind === "payments") {
      if (payMode === "fixed" && !fixedValid) return;
    } else if (!valid || amount === null) return;
    if (!proven) {
      setStep("proving");
      const ok = await proof.prove();
      setStep("idle");
      if (ok !== true) {
        setFailure(word("walletDeclined"));
        return;
      }
    }
    setStep("saving");
    const priceCondition = reference && limitPct !== null ? { limitPct } : null;
    const each = Math.round((amount ?? 0) * 100) / 100;
    const request: RuleCreateRequest =
      kind === "payments"
        ? {
            asset: { mint },
            amountUsd: Math.round(thresholdUsd * 100) / 100,
            kind: "payments",
            payments: { mode: payMode, roundToUsd: payTerms.roundToUsd, fixedUsd: payTerms.fixedUsd === null ? null : Math.round(payTerms.fixedUsd * 100) / 100, percent: payTerms.percent, timeZone },
            priceCondition,
            locale: lang,
          }
        : kind === "dip"
          ? { asset: { mint }, amountUsd: each, kind: "dip", dip: { dropPct, timeZone }, priceCondition, locale: lang }
          : { asset: { mint }, amountUsd: each, kind: "schedule", schedule: { ...schedule, timeZone }, priceCondition, locale: lang };
    const result = await onCreate(request);
    setStep("idle");
    if (!result.ok || !result.rule) {
      setFailure(
        result.ok
          ? word("autoinvestFailed")
          : result.code === "RULE_LIMIT_REACHED"
            ? word("ruleLimit")
            : result.code === "RULE_LIQUIDITY_LOW"
              ? word("noRuleOnToken")
              : result.code === "UNAVAILABLE" && (kind === "dip" || token)
                ? token
                  ? word("tokenUnreadable")
                  : word("priceUnknownNow")
                : word("autoinvestFailed"),
      );
      return;
    }
    setMade(result.rule);
  };

  const noRoute = valid && route === "no-route";
  const minimumUsd = noRoute && routeMinimum.state === "found" ? routeMinimum.minimumUsd : null;
  const minimumLine = !noRoute || amount === null ? null : minimumUsd !== null ? routeMinimumLine(locale, dollars(amount, numbers), name, dollars(minimumUsd, numbers)) : routeMinimum.state === "finding" ? word("findingMinimum") : word("unavailableNow");

  /* A token no rule can name now: under the floor, flagged, or unread — said before the button, and the button turns nothing on. */
  const tokenBlock: string | null = !token
    ? null
    : tokenRead.status === "refused"
      ? word("noRuleOnToken")
      : tokenRead.status === "failed"
        ? word("tokenUnreadable")
        : tokenFacts?.refusal
          ? tokenFacts.refusal.code === "RULE_LIQUIDITY_LOW"
            ? word("noRuleOnToken")
            : word("flaggedSuspicious")
          : tokenFacts?.floor && tokenFacts.floor.verdict !== "met"
            ? word("tokenUnreadable")
            : null;

  const cta = ((): Readonly<{ label: string; disabled: boolean; run?: () => void }> => {
    if (!connection) return { label: word("connectWallet"), disabled: false };
    if (token && referencePending) return { label: word("reading"), disabled: true };
    if (tokenBlock) return { label: word("turnOn"), disabled: true };
    if (kind === "payments") {
      if (payMode === "fixed" && !fixedValid) return { label: word("turnOn"), disabled: true };
      /* The reminders' sums must route into the company: the minimum is raised to the company's own before the rule can be turned on. */
      if (route === "no-route") return { label: routeMinimum.state === "finding" ? word("findingMinimum") : word("unavailableNow"), disabled: true };
      if (step === "proving") return { label: word("confirming"), disabled: true };
      if (step === "saving") return { label: word("turningOn"), disabled: true };
      if (referencePending) return { label: word("reading"), disabled: true };
      return { label: word("turnOn"), disabled: false };
    }
    if (amount !== null && amount < MIN_BUY_USD) return { label: word("minimum"), disabled: true };
    if (!valid) return { label: word("turnOn"), disabled: true };
    /* A sum with no route would only ever remind of a purchase that cannot happen: the one action puts in the company's own minimum instead. */
    if (noRoute && minimumUsd !== null) return { label: setMinimumWord(locale, dollars(minimumUsd, numbers)), disabled: false, run: () => setAmountText(String(minimumUsd)) };
    if (noRoute) return { label: word("turnOn"), disabled: true };
    if (step === "proving") return { label: word("confirming"), disabled: true };
    if (step === "saving") return { label: word("turningOn"), disabled: true };
    /* Whether the company has a reference to offer the condition against is read first — a rule is never turned on past its default without knowing. */
    if (referencePending) return { label: word("reading"), disabled: true };
    return { label: word("turnOn"), disabled: kind === "schedule" ? first === null : trigger === null };
  })();

  /* A token no rule can name: what it stands on and why, and nothing to fill in for a rule that cannot be turned on. */
  if (token && tokenBlock) {
    return (
      <div className={bodyClass} data-sheet="autoinvest" data-blocked>
        {head(`${word("autoinvest")} · ${name}`)}
        {tokenFacts?.class === "meme" ? <RiskFacts read={tokenFacts} locale={locale} compact={ticket} /> : null}
        {tokenFacts?.floor ? (
          <p className={company.floorLine} data-floor={tokenFacts.floor.verdict} translate="no">
            <b>{word("floorTitle")}</b>
            <span>{tokenFacts.floor.verdict === "met" ? floorMetLine(tokenFacts.floor, lang) : floorLine(tokenFacts.floor, "", lang)}</span>
          </p>
        ) : null}
        {/* One tone with the floor's line, and the next step where there is one: the market order beside it. */}
        <p className={company.blockNote} role="status" data-token-block>
          {tokenBlock}
        </p>
        {ticket ? (
          <div className={company.sheetActions}>
            <button type="button" className="rw-btn" onClick={onClose}>
              {word("buyAtMarket")}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={bodyClass} data-sheet="autoinvest" data-kind={kind}>
      {head(`${word("autoinvest")} · ${name}`)}
      {preIpo ? <SheetTruth truth={truth} eventLine={eventLine} /> : null}
      {/* A token's standing before anything else: the floor for a recurring buy and, for a meme or a new token, the facts of its risk. */}
      {token && tokenFacts?.class === "meme" ? <RiskFacts read={tokenFacts} locale={locale} compact={ticket} /> : null}
      {token && tokenFacts?.floor ? (
        <p className={company.floorLine} data-floor={tokenFacts.floor.verdict} translate="no">
          <b>{word("floorTitle")}</b>
          <span>{tokenFacts.floor.verdict === "met" ? floorMetLine(tokenFacts.floor, lang) : floorLine(tokenFacts.floor, "", lang)}</span>
        </p>
      ) : null}

      <div className={company.kindSwitch} role="group" aria-label={word("ruleKind")}>
        {KINDS.map((option) => (
          <button key={option} type="button" className={company.chip} aria-pressed={kind === option} disabled={step !== "idle"} onClick={() => setKind(option)}>
            {/* In Spot's order the tab already says «Регулярно»: the schedule's chip names what it is. */}
            {option === "dip" ? word("ifFalls") : option === "payments" ? word("fromPayments") : ticket ? word("scheduleShort") : word("regularly")}
          </button>
        ))}
      </div>

      {kind === "payments" ? (
        /* «З кожної оплати»: what to set aside from the wallet's own USDC, an example on live figures, the minimum a reminder opens at, and what never counts behind the «?». */
        <>
          <div className={company.ruleWhenGroup}>
            <span className={company.limitLabel} id={`${titleId}-what`}>
              {word("whatToSetAside")}
            </span>
            <div className={`${company.kindSwitch} ${company.modeSwitch}`} role="group" aria-labelledby={`${titleId}-what`}>
              {RULE_PAYMENT_MODES.map((option) => (
                <button key={option} type="button" className={company.chip} aria-pressed={payMode === option} disabled={step !== "idle"} onClick={() => setPayMode(option)}>
                  {option === "roundup" ? word("modeRoundup") : option === "fixed" ? word("modeFixed") : word("modePercent")}
                </button>
              ))}
            </div>
          </div>
          {payMode === "roundup" ? (
            <div className={company.ruleRow}>
              <span className={company.limitLabel} id={`${titleId}-step`}>
                {word("roundUpTo")}
              </span>
              <div className={company.limitChips} role="group" aria-labelledby={`${titleId}-step`}>
                {PAYMENT_ROUNDUP_STEPS_USD.map((stepUsd) => (
                  <button key={stepUsd} type="button" className={company.chip} aria-pressed={roundTo === stepUsd} disabled={step !== "idle"} onClick={() => setRoundTo(stepUsd)}>
                    {usdWord(stepUsd, lang)}
                  </button>
                ))}
              </div>
            </div>
          ) : payMode === "fixed" ? (
            <>
              <p className={company.amountLabel} aria-hidden="true">
                {word("fromEveryPayment")}
              </p>
              <label className={company.amount}>
                <span className={company.srOnly}>{word("fromEveryPayment")}</span>
                <span className={company.amountSign} aria-hidden="true">
                  $
                </span>
                <input
                  className={company.amountInput}
                  value={fixedText}
                  onChange={(event) => setFixedText(event.target.value)}
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={step !== "idle"}
                  aria-describedby={`${titleId}-first`}
                />
              </label>
            </>
          ) : (
            <div className={company.ruleRow}>
              <span className={company.limitLabel} id={`${titleId}-pct`}>
                {word("ofEveryIncoming")}
              </span>
              <div className={company.limitChips} role="group" aria-labelledby={`${titleId}-pct`}>
                {PAYMENT_PERCENT_PRESETS.map((pct) => (
                  <button key={pct} type="button" className={company.chip} aria-pressed={percent === pct} disabled={step !== "idle"} onClick={() => setPercent(pct)}>
                    {pctWord(pct, lang)}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p id={`${titleId}-first`} className={company.estimate} aria-live="polite" translate="no">
            {payMode === "fixed" && !fixedValid ? word("minimum") : setAsideExample(locale, exampleDirection, exampleUsd, exampleAdd, name)}
          </p>
          <p className={company.ruleNote} data-pay-minimum translate="no">
            {`${word("remindFrom")} ${usdWord(thresholdUsd, lang)}`}
            {thresholdUsd > RULE_MINIMUM_USD ? ` · ${routeMinimumLine(locale, dollars(RULE_MINIMUM_USD, numbers), name, dollars(thresholdUsd, numbers))}` : ""}
          </p>
          <p className={company.ruleNote} data-pay-counts>
            {payMode === "percent" ? word("incomingCount") : word("paymentsCount")} <Help topic="paymentsRule" locale={locale} />
          </p>
        </>
      ) : (
        <>
          {/* The rule's sum is each purchase — never the month's budget, which is its own line below. */}
          <p className={company.amountLabel} aria-hidden="true">
            {word("eachPurchase")}
          </p>
          <label className={company.amount}>
            <span className={company.srOnly}>{word("eachPurchase")}</span>
            <span className={company.amountSign} aria-hidden="true">
              $
            </span>
            <input
              className={company.amountInput}
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              disabled={step !== "idle"}
              aria-describedby={`${titleId}-first`}
            />
          </label>
          {/* No quick sums: a rule's sum is the person's own, typed — a fixed sum of their choosing. */}
          {minimumLine ? (
            <p className={company.estimate} data-route-minimum aria-live="polite">
              {minimumLine}
            </p>
          ) : null}
        </>
      )}

      {kind === "payments" ? null : kind === "schedule" ? (
        <>
          <div className={company.ruleRow}>
            <span className={company.limitLabel} id={`${titleId}-often`}>
              {word("howOften")}
            </span>
            <div className={company.limitChips} role="group" aria-labelledby={`${titleId}-often`}>
              {CADENCES.map((cadence) => (
                <button key={cadence} type="button" className={company.chip} aria-pressed={schedule.cadence === cadence} disabled={step !== "idle"} onClick={() => setSchedule((current) => withCadence(current, cadence, nowMs))}>
                  {cadenceWord(cadence, lang)}
                </button>
              ))}
            </div>
          </div>

          <div className={company.ruleWhenGroup} role="group" aria-labelledby={`${titleId}-when`}>
            <span className={company.limitLabel} id={`${titleId}-when`}>
              {word("when")}
            </span>
            {schedule.cadence === "weekly" ? (
              <div className={company.dayChips}>
                {weekdays.map((day, index) => (
                  <button key={day} type="button" className={company.dayChip} aria-pressed={schedule.weekday === index + 1} disabled={step !== "idle"} onClick={() => setSchedule((current) => ({ ...current, weekday: index + 1 }))}>
                    {day}
                  </button>
                ))}
              </div>
            ) : null}
            <div className={company.whenFields}>
              {schedule.cadence === "monthly" ? (
                <label className={company.field}>
                  <span>{word("dayOfMonth")}</span>
                  <select value={schedule.monthDay ?? 1} disabled={step !== "idle"} onChange={(event) => setSchedule((current) => ({ ...current, monthDay: Number(event.target.value) }))}>
                    {Array.from({ length: 31 }, (_, index) => index + 1).map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className={company.field}>
                <span>{word("timeOfDay")}</span>
                <input
                  type="time"
                  value={schedule.time}
                  step={60}
                  disabled={step !== "idle"}
                  onChange={(event) => {
                    const time = timeOfInput(event.target.value);
                    if (time) setSchedule((current) => ({ ...current, time }));
                  }}
                />
              </label>
            </div>
          </div>

          <p id={`${titleId}-first`} className={company.estimate} aria-live="polite">
            {first !== null ? `${word("firstPurchase")}: ${dueWords(first, timeZone, lang)}` : " "}
          </p>
        </>
      ) : (
        <>
          <div className={company.ruleRow}>
            <span className={company.limitLabel} id={`${titleId}-far`}>
              {word("howFar")}
            </span>
            <div className={company.limitChips} role="group" aria-labelledby={`${titleId}-far`}>
              {RULE_DIP_PRESETS_PCT.map((pct) => (
                <button key={pct} type="button" className={company.chip} aria-pressed={dropPct === pct} disabled={step !== "idle"} onClick={() => setDropPct(pct)}>
                  {`−${pctWord(pct, lang)}`}
                </button>
              ))}
            </div>
          </div>
          <p id={`${titleId}-first`} className={company.estimate} aria-live="polite" translate="no">
            {trigger !== null && fallFrom !== null ? `${word("remindAt")} ${priceWord(trigger, lang)} ${word("orLower")} · ${word("priceNow")} ${priceWord(fallFrom, lang)}` : word("priceUnknownNow")}
          </p>
          <p className={company.ruleNote}>{word("oneReminderPerFall")}</p>
        </>
      )}

      {/* «Умова ціни»: the most the price may stand above the company's reference, 5 % unless the person picks another — and how it stands now. */}
      {reference ? (
        <>
          <div className={company.ruleRow}>
            <span className={company.limitLabel} id={`${titleId}-condition`}>
              {word("priceCondition")}
            </span>
            <div className={company.limitChips} role="group" aria-labelledby={`${titleId}-condition`}>
              {CONDITION_CHOICES.map((choice) => (
                <button key={choice ?? "none"} type="button" className={company.chip} aria-pressed={limitPct === choice} disabled={step !== "idle"} onClick={() => setLimitPct(choice)}>
                  {choice === null ? word("noCondition") : pctWord(choice, lang)}
                </button>
              ))}
            </div>
          </div>
          {limitPct !== null ? (
            <p className={company.estimate} data-condition-line>
              {conditionLine(limitPct, reference, lang)}
            </p>
          ) : null}
          {token && limitPct !== null && tokenPrice !== null ? (
            <p className={company.ruleNote} data-condition-now="anchor" translate="no">
              {anchorNowLine(tokenPrice, limitPct, lang)}
            </p>
          ) : conditionNow ? (
            <p className={company.ruleNote} data-condition-now={conditionNow.verdict} translate="no">
              {conditionNowLine(conditionNow, lang)}
            </p>
          ) : null}
        </>
      ) : null}

      {/* The month's budget for every rule — its own line, its own sheet over this one; the rule's sum above is never it. */}
      <BudgetRow budget={budget} locale={locale} variant="sheet" onEdit={onEditBudget} />

      <p className={company.rulePromise}>{word("autoinvestPromise")}</p>
      {channelLine}
      {failure ? <p className={company.sheetError}>{failure}</p> : null}

      <div className={company.sheetActions}>
        {!connection && connectAction ? (
          connectAction
        ) : (
          <button type="button" className="rw-btn rw-btn--primary" disabled={cta.disabled} onClick={cta.run ?? (() => void enable())}>
            {cta.label}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The same rule, inside Spot's order (1.31.0): «Регулярно» beside «Ринок» on
 * every token — the flow without its dialog, its head or its close.
 */
export function AutoinvestPanel(props: Omit<AutoinvestSheetProps, "open" | "variant"> & Readonly<{ onBusy?: (busy: boolean) => void }>) {
  const titleId = useId();
  const { onBusy, ...rest } = props;
  const noteBusy = useCallback((busy: boolean) => onBusy?.(busy), [onBusy]);
  return <AutoinvestFlow {...rest} open variant="ticket" titleId={titleId} onBusy={noteBusy} />;
}

/**
 * The newest counted events of a «З кожної оплати» rule: the sum, the rule's
 * share, the time and — where the transfer carried one — its Solana Pay
 * label; never the other side's name. An event still waiting can be named
 * the person's own account: «Мій рахунок», asked once more before it is
 * written.
 */
function PaymentEvents({
  events,
  incoming,
  read,
  zone,
  locale,
  asking,
  busy,
  onAsk,
  onConfirm,
}: Readonly<{
  events: readonly RulePaymentEvent[];
  incoming: boolean;
  read: Readonly<{ at: string; state: "ok" | "partial" | "unavailable" }> | null;
  zone: string;
  locale: WorkspaceLocale;
  asking: string | null;
  busy: boolean;
  onAsk: ((signature: string | null) => void) | null;
  onConfirm: (signature: string) => void;
}>) {
  const word = investWords(locale);
  const lang = locale === "uk" ? "uk" : "en";
  const title = incoming ? word("recentIncoming") : word("recentPayments");
  const shown = events.slice(0, EVENTS_SHOWN);
  return (
    <section className={company.payEvents} aria-label={title} data-pay-events>
      <p className={company.limitLabel}>{title}</p>
      {shown.length === 0 ? (
        <p className={company.ruleNote}>{incoming ? word("noIncomingYet") : word("noPaymentsYet")}</p>
      ) : (
        <ul className={company.payList}>
          {shown.map((event) => (
            <li key={event.signature} className={company.payItem} data-waiting={event.dueAt === null ? "true" : undefined}>
              <div className={company.payRow}>
                <span className={company.payWhat} translate="no">{`${event.direction === "out" ? word("paymentWord") : word("incomingWord")} ${usdWord(event.amountUsd, lang)}`}</span>
                <span className={company.payAdd} translate="no">{`+${usdWord(event.addUsd, lang)}`}</span>
              </div>
              <p className={company.payMeta} translate="no">
                {[dueWords(Date.parse(event.at), zone, lang), event.dueAt ? word("inReminder") : null].filter(Boolean).join(" · ")}
              </p>
              {event.label ? (
                <p className={company.payLabel} translate="no">
                  {`${word("solanaPayLabel")}: ${event.label}`}
                </p>
              ) : null}
              {event.dueAt === null && onAsk ? (
                asking === event.signature ? (
                  <div className={company.payConfirm} data-confirm="own">
                    <p className={company.sheetNote}>{word("myAccountConfirm")}</p>
                    <div className={company.payConfirmActions}>
                      <button type="button" className="rw-btn" disabled={busy} onClick={() => onConfirm(event.signature)}>
                        {word("myAccountYes")}
                      </button>
                      <button type="button" className={company.quietButton} disabled={busy} onClick={() => onAsk(null)}>
                        {word("cancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className={company.payOwn} disabled={busy} onClick={() => onAsk(event.signature)}>
                    {word("myAccount")}
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {read && read.state !== "ok" ? (
        <p className={company.ruleNote} data-pay-read={read.state}>
          {read.state === "partial" ? word("readPartial") : word("readUnavailable")}
        </p>
      ) : null}
    </section>
  );
}
