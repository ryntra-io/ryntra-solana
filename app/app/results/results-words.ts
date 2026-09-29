import type { WorkspaceLocale } from "@/app/shell/locale";
import type { PlanCheckId, PlanCostPart, PlanMemoryFact, PlanNoTradeOutcome, PlanNoTradeReason, PlanPosition, PlanResult } from "@/lib/api/v1/contract";

import { fmtUnits, fmtUsd, fmtWhen } from "../strategies/plans/plan-words";
import { conditionKindWords, findingOutcomeWords } from "@/lib/monitoring/engine";

/**
 * The words Results says — `RYN-RESULTS-MEMORY-001`.
 *
 * The server states kinds and figures; the sentence is composed here, in the
 * reader's language, from those figures. That is the whole reason no prose
 * is stored: a sentence built from the record cannot drift from it, cannot
 * be right in one language and wrong in the other, and cannot be written by
 * a model.
 *
 * Two rules hold everywhere below. A figure that was not established is an
 * em dash and a word for *not established* — never a zero and never a guess.
 * And nothing here congratulates, warns or advises: a plan whose rule
 * refused every Review did its work, and the sentence says so plainly.
 */

type Bi = Readonly<{ en: string; uk: string }>;
const bi = (en: string, uk: string): Bi => ({ en, uk });

export const RESULT_WORDS = {
  lead: bi(
    "Your plan against what actually happened — and why a plan made no trade.",
    "Твій план проти того, що сталося насправді, — і чому план не дав угоди.",
  ),
  /* the summary */
  summary: bi("At a glance", "Коротко"),
  openPositions: bi("Open", "Відкриті"),
  closedPositions: bi("Closed", "Закриті"),
  noTradePlans: bi("No trade", "Без угоди"),
  tradesMade: bi("Operations", "Операцій"),
  /* the sections */
  positionsTitle: bi("Positions under a plan", "Позиції за планом"),
  outcomesTitle: bi("Plans that made no trade", "Плани без угоди"),
  resultsTitle: bi("Recent results", "Останні результати"),
  memoryTitle: bi("What this remembers", "Що це пам'ятає"),
  memoryLead: bi(
    "Facts about your own plans, reviews and operations. Each one cites the record it stands on; none of them is written by a model.",
    "Факти про твої плани, рев'ю та операції. Кожен посилається на запис, на якому стоїть; жоден не написаний моделлю.",
  ),
  nothingYet: bi("Nothing here yet. A plan you write appears the moment it is reviewed or executed.", "Тут поки порожньо. План, який ти напишеш, з'явиться щойно його перевірять або виконають."),
  /* the legs */
  entry: bi("Entry", "Вхід"),
  exit: bi("Exit", "Вихід"),
  legUnknown: bi("Side not established", "Сторона не встановлена"),
  matchedByAsset: bi("Matched to this plan by its asset — you did not declare it under the plan.", "Зіставлено з планом за активом — ти не оголошував цю операцію за планом."),
  /* the position */
  position: bi("Position", "Позиція"),
  held: bi("Held", "Утримується"),
  bought: bi("Bought", "Куплено"),
  sold: bi("Sold", "Продано"),
  costBasis: bi("Cost basis", "Вартість входу"),
  proceeds: bi("Proceeds", "Виручка"),
  feesPaid: bi("Fees", "Комісії"),
  realised: bi("Realised", "Реалізовано"),
  stillOpen: bi("Still open — no realised result until it is closed.", "Ще відкрита — реалізованого результату немає, доки не закрита."),
  realisedMethod: bi("Proceeds minus the cost basis and the fees of both legs.", "Виручка мінус вартість входу і комісії обох ніг."),
  /* the difference */
  difference: bi("Where the difference went", "Куди пішла різниця"),
  marketMove: bi("The market, before the Review", "Ринок, до Review"),
  executionPart: bi("Execution, after the Review", "Виконання, після Review"),
  feePart: bi("Ryntra's fee", "Комісія Ryntra"),
  expectedAtReview: bi("What the Review modelled", "Що змоделював Review"),
  slippageLabel: bi("Slippage allowed", "Дозволений сліпедж"),
  feeLabel: bi("Fee rate", "Ставка комісії"),
  priceImpactLabel: bi("Price impact", "Вплив на ціну"),
  spendLabel: bi("Spend", "Сума"),
  theRule: bi("The rule", "Правило"),
  yourBound: bi("Your bound", "Твоя межа"),
  whatWasFound: bi("What was found", "Що знайдено"),
  reviewsCount: bi("Reviews", "Review"),
  noRealised: bi("No realised figure is stated because", "Реалізованого результату немає, бо"),
  estimateNote: bi("Modelled before the signature. An estimate, never what was paid.", "Змодельовано до підпису. Оцінка, ніколи не сплачене."),
  notEstablished: bi("not established", "не встановлено"),
  plannedPrice: bi("Planned", "План"),
  quotedPrice: bi("Before signing", "Перед підписом"),
  filledPrice: bi("Filled", "Виконано"),
  /* exit adherence */
  exitAdherence: bi("The exit against your rules", "Вихід проти твоїх правил"),
  ruledBy: bi("Judged on version", "Оцінено за версією"),
  laterRule: bi("A later version carries an exit rule this exit could not have followed; it was not applied backwards.", "Пізніша версія має правило виходу, якого цей вихід не міг дотримати; воно не застосоване заднім числом."),
  exitFollowed: bi("The exit met every rule that existed", "Вихід виконав кожне правило, що існувало"),
  exitDeviated: bi("The exit did not meet a rule that existed", "Вихід не виконав правило, що існувало"),
  exitUnknown: bi("The exit could not be judged", "Вихід неможливо оцінити"),
  /* what a person opens */
  openPlan: bi("Open the plan", "Відкрити план"),
  openHistory: bi("Open History", "Відкрити Історію"),
  transaction: bi("Transaction", "Транзакція"),
  details: bi("The figures behind this", "Цифри за цим"),
  /* citations */
  citesPlan: bi("plan", "план"),
  citesVersion: bi("version", "версія"),
  citesReview: bi("Review", "Review"),
  citesExecution: bi("operation", "операція"),
  citesLedger: bi("History row", "рядок Історії"),
  citesNote: bi("monitoring note", "нотатка Нагляду"),
} as const;

export function resultWordsFor(locale: WorkspaceLocale) {
  return (key: keyof typeof RESULT_WORDS): string => RESULT_WORDS[key][locale];
}

/* ------------------------------------------------------------ the no-trade sentence */

/**
 * Why a plan made no trade, said from the outcome's own figures. Every
 * sentence is a statement about a rule, never about the person: this is the
 * plan working, and the word *failed* appears nowhere.
 */
export function noTradeSentence(outcome: PlanNoTradeOutcome, locale: WorkspaceLocale): string {
  const symbol = outcome.asset.underlying.symbol || outcome.asset.symbol;
  /* The Review's own `expected` and `found` are the words the server wrote in
     English at the moment it judged. They are facts, and they belong beside
     the sentence as figures — never inside it, or a Ukrainian sentence ends
     up half in English. The figure grid under this carries them verbatim. */
  const every = outcome.everyReview && outcome.reviews > 1;
  const inAll = bi(` — in all ${outcome.reviews} Reviews`, ` — в усіх ${outcome.reviews} Review`);
  const say: Readonly<Record<PlanNoTradeReason, Bi>> = {
    "entry-bound-unmet": bi(
      `No trade: the executable price stayed above the most this plan will pay${every ? inAll.en : ""}.`,
      `Без угоди: виконувана ціна лишалася вищою за максимум, який готовий платити план${every ? inAll.uk : ""}.`,
    ),
    "liquidity-unavailable": bi(
      `No trade: the venue's liquidity never reached the floor this plan requires${every ? inAll.en : ""}.`,
      `Без угоди: ліквідність майданчика так і не сягнула порогу, якого вимагає план${every ? inAll.uk : ""}.`,
    ),
    "conditions-unmet": bi(
      `No trade: a condition you required on the evidence was not met, or could not be judged${every ? inAll.en : ""}.`,
      `Без угоди: умова щодо доказів, яку ти вимагав, не виконана або її неможливо оцінити${every ? inAll.uk : ""}.`,
    ),
    "invalidated-before-entry": bi(
      "No trade: at the Review the price was already at or below your invalidation — the thesis was wrong before the entry.",
      "Без угоди: на Review ціна вже була на рівні інвалідації або нижче — теза була хибною ще до входу.",
    ),
    "review-blocked": bi("No trade: a rule of this plan refused the order; the rule and its figures are below.", "Без угоди: правило цього плану відмовило ордеру; саме правило і його цифри — нижче."),
    expired: bi("No trade: the entry window closed before a price the plan accepts appeared.", "Без угоди: вікно входу закрилося раніше, ніж з'явилася ціна, яку план приймає."),
    cancelled: bi("No trade: you cancelled this plan.", "Без угоди: ти скасував цей план."),
    "reviewed-not-taken": bi(
      `No trade: ${outcome.reviews === 1 ? "one Review" : `${outcome.reviews} Reviews`} passed and you did not proceed.`,
      `Без угоди: ${outcome.reviews === 1 ? "один Review" : `${outcome.reviews} Review`} пройшов, і ти не став продовжувати.`,
    ),
    "no-review": bi(`${symbol} is live and nothing has been reviewed under it yet.`, `${symbol} активний, і за ним ще нічого не перевіряли.`),
  };
  return say[outcome.reason][locale];
}

/** The short label for the outcome's own chip. */
export function noTradeLabel(reason: PlanNoTradeReason, locale: WorkspaceLocale): string {
  const say: Readonly<Record<PlanNoTradeReason, Bi>> = {
    "entry-bound-unmet": bi("Your price was never met", "Твою ціну так і не дали"),
    "liquidity-unavailable": bi("Liquidity under your floor", "Ліквідність нижче порога"),
    "conditions-unmet": bi("A condition was not met", "Умову не виконано"),
    "invalidated-before-entry": bi("Already invalidated", "Вже інвалідовано"),
    "review-blocked": bi("A rule refused it", "Правило відмовило"),
    expired: bi("The window closed", "Вікно закрилося"),
    cancelled: bi("You cancelled it", "Ти скасував"),
    "reviewed-not-taken": bi("Reviewed, not taken", "Перевірено, не взято"),
    "no-review": bi("Waiting for a price", "Чекає на ціну"),
  };
  return say[reason][locale];
}

/* ------------------------------------------------------------ the figures */

/** A cost part as text: the money and the percentage when both are established, the reason when neither is. */
export function costPartText(part: PlanCostPart, locale: WorkspaceLocale): string {
  if (part.basis === "unknown" || (part.usd === null && part.pct === null)) return RESULT_WORDS.notEstablished[locale];
  const money = part.usd === null ? null : `${part.usd > 0 ? "+" : ""}${fmtUsd(part.usd, locale)}`;
  const pct = part.pct === null ? null : `${part.pct > 0 ? "+" : ""}${part.pct.toFixed(2)}%`;
  return [money, pct].filter(Boolean).join(" · ");
}

/** Why a part could not be established, in the reader's language. */
export function costReasonText(reason: string | null, locale: WorkspaceLocale): string | null {
  if (!reason) return null;
  const say: Readonly<Record<string, Bi>> = {
    "no-review": bi("no Review was kept for this operation", "для цієї операції не збережено Review"),
    "no-planned-price": bi("this version planned no price for this leg", "ця версія не планувала ціни для цієї ноги"),
    "no-fill-price": bi("the fill's price per unit could not be established", "ціну за одиницю на виконанні не встановлено"),
    "fee-not-recorded": bi("the operation recorded no fee", "операція не записала комісії"),
  };
  return say[reason]?.[locale] ?? reason;
}

/** Why a position states no realised figure. */
export function unknownText(id: string, locale: WorkspaceLocale): string {
  const say: Readonly<Record<string, Bi>> = {
    "position-open": bi("the position is still open", "позиція ще відкрита"),
    "no-entry": bi("no entry has settled under this plan", "за цим планом не підтверджено жодного входу"),
    "side-not-established": bi("an operation's side was never recorded", "сторону однієї операції не записано"),
    "entry-not-valued": bi("an entry could not be valued in dollars", "вхід неможливо оцінити в доларах"),
    "exit-not-valued": bi("an exit could not be valued in dollars", "вихід неможливо оцінити в доларах"),
    "units-not-countable": bi("the units of an operation are not countable in this plan's unit", "одиниці операції не порахувати в одиниці цього плану"),
    "fee-not-recorded": bi("an operation recorded no fee", "операція не записала комісії"),
  };
  return say[id]?.[locale] ?? id;
}

/** The plan's own word for a check, reused by the exit checks. */
export function checkWord(id: PlanCheckId, locale: WorkspaceLocale): string {
  const say: Readonly<Partial<Record<PlanCheckId, Bi>>> = {
    exitTarget: bi("Your target", "Твоя ціль"),
    exitInvalidation: bi("Your invalidation", "Твоя інвалідація"),
    exitTime: bi("Your time exit", "Твій вихід за часом"),
    budget: bi("Budget", "Бюджет"),
    spend: bi("Spendable", "Дозволена сума"),
    entryPrice: bi("Entry bound", "Межа входу"),
    invalidation: bi("Above invalidation", "Вище інвалідації"),
    risk: bi("Planned risk", "Плановий ризик"),
    size: bi("Sized spend", "Плановий обсяг"),
    liquidity: bi("Liquidity", "Ліквідність"),
    evidence: bi("Evidence condition", "Умова доказів"),
  };
  return say[id]?.[locale] ?? id;
}

/** The position in one line: what is held, or what it came to. */
export function positionSentence(position: PlanPosition, symbol: string, locale: WorkspaceLocale): string {
  if (position.state === "none") return locale === "uk" ? "Позиції за цим планом немає." : "There is no position under this plan.";
  const held = fmtUnits(Number(position.unitsHeld), locale);
  const bought = fmtUnits(Number(position.unitsIn), locale);
  const sold = fmtUnits(Number(position.unitsOut), locale);
  if (position.state === "open") {
    return locale === "uk"
      ? `Куплено ${bought} ${symbol}; утримується ${held}.`
      : `Bought ${bought} ${symbol}; ${held} held.`;
  }
  return locale === "uk" ? `Куплено ${bought} ${symbol}, продано ${sold} — позицію закрито.` : `Bought ${bought} ${symbol}, sold ${sold} — the position is closed.`;
}

/* ------------------------------------------------------------ memory */

const figureOf = (fact: PlanMemoryFact, key: string) => fact.figures.find((figure) => figure.key === key) ?? null;
const numberOf = (fact: PlanMemoryFact, key: string) => figureOf(fact, key)?.value ?? null;
const textOf = (fact: PlanMemoryFact, key: string) => figureOf(fact, key)?.text ?? null;

/**
 * One memory fact as a sentence, built from its own figures. A fact whose
 * figures do not make a sentence is not shown at all — better a shorter
 * memory than one that says something the record does not.
 */
export function memorySentence(fact: PlanMemoryFact, locale: WorkspaceLocale): string | null {
  const symbol = fact.scope.symbol ?? "";
  const uk = locale === "uk";
  switch (fact.kind) {
    case "plans-written": {
      const plans = numberOf(fact, "plans");
      const active = numberOf(fact, "active") ?? 0;
      if (plans === null) return null;
      return uk
        ? `${plans} ${plans === 1 ? "план" : plans < 5 ? "плани" : "планів"} на ${symbol}${active > 0 ? `, з них ${active} активних` : ""}.`
        : `${plans} plan${plans === 1 ? "" : "s"} written on ${symbol}${active > 0 ? `, ${active} of them live` : ""}.`;
    }
    case "trades-made": {
      const reviewed = numberOf(fact, "reviewed") ?? 0;
      const traded = numberOf(fact, "traded") ?? 0;
      return uk
        ? `На ${symbol}: ${reviewed} ${reviewed === 1 ? "план перевірено" : "планів перевірено"}, ${traded} ${traded === 1 ? "став угодою" : "стали угодами"}.`
        : `On ${symbol}: ${reviewed} plan${reviewed === 1 ? "" : "s"} reviewed, ${traded} became ${traded === 1 ? "a trade" : "trades"}.`;
    }
    case "blocked-by-rule": {
      const plans = numberOf(fact, "plans") ?? 0;
      const rule = textOf(fact, "rule");
      if (!rule) return null;
      /* The Review's own bound is an English phrase it wrote when it judged; it stands on the outcome's card as a figure, never inside a sentence that must read in one language. */
      const word = checkWord(rule as PlanCheckId, locale).toLowerCase();
      return uk
        ? `${plans} ${plans === 1 ? "план" : "планів"} на ${symbol} так і не торгували: правило «${word}» відмовило кожному Review.`
        : `${plans} plan${plans === 1 ? "" : "s"} on ${symbol} never traded: the rule “${word}” refused every Review.`;
    }
    case "entry-vs-plan": {
      const diff = numberOf(fact, "diff");
      const planned = numberOf(fact, "planned");
      const actual = numberOf(fact, "actual");
      if (diff === null || planned === null || actual === null) return null;
      const over = diff >= 0;
      return uk
        ? `Вхід на ${symbol} був ${fmtUsd(actual, locale)} проти планових ${fmtUsd(planned, locale)} — на ${Math.abs(diff).toFixed(2)}% ${over ? "вище" : "нижче"}.`
        : `The ${symbol} entry was ${fmtUsd(actual, locale)} against the planned ${fmtUsd(planned, locale)} — ${Math.abs(diff).toFixed(2)}% ${over ? "above" : "below"}.`;
    }
    case "position-open": {
      const held = numberOf(fact, "unitsHeld");
      const basis = numberOf(fact, "costBasis");
      if (held === null) return null;
      return uk
        ? `Позиція на ${symbol} відкрита: ${fmtUnits(held, locale)}${basis === null ? "" : ` за ${fmtUsd(basis, locale)}`}.`
        : `A ${symbol} position is open: ${fmtUnits(held, locale)}${basis === null ? "" : ` for ${fmtUsd(basis, locale)}`}.`;
    }
    case "exit-adherence": {
      const verdict = textOf(fact, "verdict");
      const price = numberOf(fact, "price");
      const rule = textOf(fact, "rule");
      if (!verdict) return null;
      if (verdict === "deviated" && rule) {
        return uk
          ? `Вихід із ${symbol}${price === null ? "" : ` за ${fmtUsd(price, locale)}`} не виконав правило «${checkWord(rule as PlanCheckId, locale).toLowerCase()}», яке вже існувало.`
          : `The ${symbol} exit${price === null ? "" : ` at ${fmtUsd(price, locale)}`} did not meet “${checkWord(rule as PlanCheckId, locale).toLowerCase()}”, a rule that already existed.`;
      }
      if (verdict === "followed") return uk ? `Вихід із ${symbol} виконав кожне правило, що існувало.` : `The ${symbol} exit met every rule that existed.`;
      return uk ? `Вихід із ${symbol} неможливо оцінити проти правил плану.` : `The ${symbol} exit could not be judged against the plan's rules.`;
    }
    case "monitoring-said": {
      const kind = textOf(fact, "finding");
      const outcome = textOf(fact, "outcome");
      if (!kind) return null;
      const said = findingWords(kind, outcome, locale);
      return uk ? `Нагляд записав по ${symbol}: ${said}.` : `Monitoring wrote on ${symbol}: ${said}.`;
    }
    default:
      return null;
  }
}

/**
 * A monitoring finding in the reader's language. The kinds and outcomes are
 * the monitoring engine's own stable ids; a kind this does not know is shown
 * as the id rather than guessed at, which is honest and never a 500.
 */
function findingWords(kind: string, outcome: string | null, locale: WorkspaceLocale): string {
  const kinds: Readonly<Record<string, Bi>> = {
    invalidation: bi("the invalidation", "інвалідація"),
    target: bi("the target", "ціль"),
    entry: bi("the entry bound", "межа входу"),
    validity: bi("the entry window", "вікно входу"),
    deviation: bi("the deviation from the reference", "відхилення від референсу"),
    liquidity: bi("the liquidity", "ліквідність"),
    evidence: bi("an evidence condition", "умова доказів"),
  };
  const outcomes: Readonly<Record<string, Bi>> = {
    crossed: bi("was crossed", "перетнуто"),
    reached: bi("was reached", "досягнуто"),
    met: bi("was met", "виконано"),
    unmet: bi("was not met", "не виконано"),
    unknown: bi("could not be judged", "неможливо оцінити"),
    passed: bi("passed", "минуло"),
  };
  /* The engine's own ids (`plan.price_bound`, …) are named by the engine's vocabulary; this map keeps the short forms an older record may carry. */
  const kindWord = kinds[kind]?.[locale] ?? conditionKindWords(kind, locale);
  const outcomeWord = outcome === null ? null : (outcomes[outcome]?.[locale] ?? findingOutcomeWords(outcome, locale));
  return outcomeWord === null ? kindWord : `${kindWord} ${outcomeWord}`;
}

/** The word for a citation's kind. */
export function citationWord(kind: PlanMemoryFact["cites"][number]["kind"], locale: WorkspaceLocale): string {
  const key = ({ plan: "citesPlan", version: "citesVersion", review: "citesReview", execution: "citesExecution", ledger: "citesLedger", note: "citesNote" } as const)[kind];
  return RESULT_WORDS[key][locale];
}

/**
 * The citation as a person reads it: what kind of record and when. The
 * record opens by its link, so its id is never printed — «plan 1a2b3c4d…ef01»
 * is the store's bookkeeping, not a word (canon v5.0 §0.0 rule 10). A version
 * is named by its number, the one id a person already knows.
 */
export function citationRef(cite: PlanMemoryFact["cites"][number], locale: WorkspaceLocale): string {
  const word = citationWord(cite.kind, locale);
  const number = cite.kind === "version" ? cite.id.split("#").pop() ?? "" : "";
  const label = /^\d+$/.test(number) ? `${word} ${number}` : word;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}${cite.at ? ` · ${fmtWhen(cite.at, locale)}` : ""}`;
}

/** The leg's own word. */
export function legWord(result: PlanResult, locale: WorkspaceLocale): string {
  if (result.actual.leg === "entry") return RESULT_WORDS.entry[locale];
  if (result.actual.leg === "exit") return RESULT_WORDS.exit[locale];
  return RESULT_WORDS.legUnknown[locale];
}
