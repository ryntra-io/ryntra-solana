/**
 * The Critic — what argues against the thesis.
 *
 * It looks, on purpose, for the seven things a person about to act will not
 * look for themselves: an assumption that conflicts with a figure actually
 * read, a risk that was never established, a condition of their own plan
 * that is currently unmet, a previous result of their own that points the
 * other way, evidence that is stale or absent, a structural property of the
 * asset, and a thesis under-specified on its own terms.
 *
 * What it never does — and what the tests hold it to:
 *
 * - **It never says buy or sell.** No finding carries a direction; a
 *   directive sentence is dropped before a person sees it, whether the
 *   deterministic composer or a model wrote it (`isDirective`).
 * - **It never invents a figure.** Every number is one a tool read, printed
 *   as the tool printed it, carrying its own citation and state. A missing
 *   figure is the finding, never a zero.
 * - **It is never silent about what it could not do.** `gaps` say what was
 *   not challenged and why, so an empty list is never read as approval.
 *
 * Pure: the projection in, the findings out.
 */

import { AgentCriticSchema, type AgentCritic, type AgentCriticFinding, type AgentCriticKind, type AgentFigure, type AgentSentence, type AgentState, type PlanCheckId } from "../../api/v1/contract.ts";
import type { Locale } from "../provenance.ts";
import type { ToolFact } from "../tools/types.ts";
import { conditionKindWords, findingOutcomeWords } from "../../monitoring/engine.ts";
import { TOOL_SOURCE_WORDS } from "../tools/market-data.ts";
import { checkWord, windowWords } from "../tools/research.ts";
import { asFigure, nothingRead, subjectSymbol, type LensReads } from "./reads.ts";

const w = (locale: Locale, en: string, uk: string): string => (locale === "uk" ? uk : en);

/** The opening every finding of a kind uses, so a reader learns the register once. */
export function criticOpening(kind: AgentCriticKind, locale: Locale): string {
  switch (kind) {
    case "assumption-conflict":
      return w(locale, "This assumption conflicts with", "Це припущення суперечить");
    case "risk-not-established":
      return w(locale, "This risk is not established", "Цей ризик не встановлено");
    case "plan-condition-unmet":
      return w(locale, "This plan condition is currently unmet", "Ця умова плану зараз не виконана");
    case "previous-result":
      return w(locale, "Your previous result shows", "Твій попередній результат показує");
    case "evidence-missing":
      return w(locale, "The evidence behind this", "Докази під цим");
    case "asset-structure":
      return w(locale, "The asset itself carries", "Сам актив несе");
    case "thesis-weakness":
      return w(locale, "The thesis is weak where", "Теза слабка там, де");
  }
}

/**
 * A sentence that tells a person to trade — an imperative, or a
 * recommendation wrapped around a verb of trading. The word *buy* is not
 * the offence: *a buy at this price would not pass the plan* is a finding,
 * and *buy at this price* is a command. The distinction is position and
 * lead-in, so the patterns test for an imperative at the start of a
 * sentence, or a recommending phrase within two words of a trading verb.
 *
 * Applied to every finding, whoever wrote it — the deterministic composer
 * is held to the same rule as a model, and the test proves both.
 */
const TRADE_EN = "buy|sell|short|long|swap|send|transfer|ape|dump|accumulate|exit|enter|hold|take profit|cut|add|average down|double down";
const TRADE_UK = "купи|купуй|продай|продавай|заходь|виходь|фіксуй|тримай|додай|усередни|набирай|скидай";

/** Cyrillic is not `\w` in a JavaScript regular expression, so a word boundary after a Ukrainian verb has to be written out. */
const END = "(?![\\p{L}\\p{N}_])";
const START = "(?<![\\p{L}\\p{N}_])";

const DIRECTIVE: readonly RegExp[] = [
  new RegExp(`(?:^|[.;!?]\\s+)(?:just |now |please |so )?(?:${TRADE_EN})\\b`, "i"),
  new RegExp(`\\b(?:you (?:should|ought to|need to|must|can|could)|i(?:'d| would)|we (?:recommend|suggest|should)|consider|better to|time to|it pays to|worth)\\s+(?:\\w+\\s+){0,2}(?:${TRADE_EN})(?:ing|s|ed)?\\b`, "i"),
  new RegExp(`(?:^|[.;!?…]\\s+)(?:${TRADE_UK})${END}`, "iu"),
  new RegExp(`${START}(?:тобі варто|варто (?:купити|продати|зайти|вийти|тримати|додати)|раджу|рекомендую|треба (?:купити|продати)|час (?:заходити|виходити|купувати|продавати))${END}`, "iu"),
];

export function isDirective(text: string): boolean {
  return DIRECTIVE.some((pattern) => pattern.test(text));
}

/**
 * A sentence that says where a price goes. Neither format may: the Brief
 * describes what was read, the Critic argues with a thesis and holds none,
 * and no read here is ever allowed to say where a price goes. The guard is
 * applied to a model's words, which are the only ones that can arrive as a
 * forecast.
 */
const FORECAST: readonly RegExp[] = [
  /\b(?:will|would|is going to|are going to|gonna|shall)\s+(?:\w+\s+){0,3}(?:reach|hit|go|rise|fall|drop|pump|dump|double|triple|moon|rally|recover|break|be worth)\b/i,
  /\b(?:expects?|expected|likely|set|poised|about)\s+to\s+(?:\w+\s+){0,2}(?:reach|hit|rise|fall|drop|double|recover|break|moon)\b/i,
  new RegExp(`${START}(?:зросте|виросте|впаде|обвалиться|досягне|подвоїться|потроїться|відновиться|проб'?є)${END}`, "iu"),
  new RegExp(`${START}піде\\s+(?:вгору|вниз|до|на)${END}`, "iu"),
];

export function isForecast(text: string): boolean {
  return FORECAST.some((pattern) => pattern.test(text));
}

const figureState = (figures: readonly AgentFigure[]): AgentState => {
  if (figures.length === 0) return "unknown";
  if (figures.some((figure) => figure.state === "unavailable")) return "unavailable";
  if (figures.some((figure) => figure.state === "unknown")) return "unknown";
  if (figures.some((figure) => figure.state === "stale")) return "stale";
  return "current";
};

type Draft = Readonly<{ kind: AgentCriticKind; id: string; body: string; facts: readonly ToolFact[]; cites?: readonly string[] }>;

/** Two kinds open a clause of their own and need a colon; the rest continue the opening sentence. */
const SEPARATOR: Readonly<Record<AgentCriticKind, string>> = {
  "assumption-conflict": " ",
  "risk-not-established": " ",
  "plan-condition-unmet": ": ",
  "previous-result": ": ",
  "evidence-missing": " ",
  "asset-structure": " ",
  "thesis-weakness": " ",
};

function finding(draft: Draft, locale: Locale): AgentCriticFinding {
  const figures = draft.facts.map(asFigure).slice(0, 6);
  const cites = [...new Set([...(draft.cites ?? []), ...draft.facts.map((fact) => fact.cite)])].slice(0, 6);
  return {
    id: draft.id.slice(0, 64),
    kind: draft.kind,
    text: `${criticOpening(draft.kind, locale)}${SEPARATOR[draft.kind]}${draft.body}`.replace(/\s+/g, " ").trim().slice(0, 400),
    figures,
    cites,
    state: figureState(figures),
  };
}

/** The order a person should meet them in: what is decided now, then what history says, then what is missing, then what the thesis never said. */
const PRIORITY: readonly AgentCriticKind[] = ["plan-condition-unmet", "assumption-conflict", "previous-result", "risk-not-established", "evidence-missing", "asset-structure", "thesis-weakness"];

/* ------------------------------------------------------------ the seven searches */

function assumptionConflicts(reads: LensReads, locale: Locale): Draft[] {
  const out: Draft[] = [];
  const price = reads.facts.get("price");
  if (!price || price.number === null) return out;
  const invalidation = reads.facts.get("plan.invalidation");
  const maxPrice = reads.facts.get("plan.maxPrice");
  const target = reads.facts.get("plan.target");
  const planning = reads.facts.get("plan.planningPrice");
  if (invalidation && invalidation.number !== null && price.number <= invalidation.number) {
    out.push({
      kind: "assumption-conflict",
      id: "assumption.invalidation",
      facts: [price, invalidation],
      body: w(
        locale,
        `a figure you already read: the price is ${price.value} and your own invalidation is ${invalidation.value}. The level at which you wrote that the thesis is wrong has been reached, so holding the thesis now is a new decision, not the one you made.`,
        `цифрі, яку ти вже прочитав: ціна ${price.value}, а твоя власна інвалідація ${invalidation.value}. Рівень, на якому ти записав, що теза хибна, досягнуто, тож тримати тезу зараз — це нове рішення, а не те, яке ти ухвалив.`,
      ),
    });
  }
  if (maxPrice && maxPrice.number !== null && price.number > maxPrice.number) {
    out.push({
      kind: "assumption-conflict",
      id: "assumption.maxPrice",
      facts: [price, maxPrice],
      body: w(
        locale,
        `your own entry rule: the price is ${price.value} and your maximum is ${maxPrice.value}. An entry here does not pass the plan, and a plan changed to fit the price is a different plan.`,
        `твоїм же правилом входу: ціна ${price.value}, а твій максимум ${maxPrice.value}. Вхід тут не проходить план, а план, змінений під ціну, — це вже інший план.`,
      ),
    });
  }
  if (target && target.number !== null && price.number >= target.number) {
    out.push({
      kind: "assumption-conflict",
      id: "assumption.target",
      facts: [price, target],
      body: w(
        locale,
        `the upside the plan itself names: the price is ${price.value} and your target is ${target.value}. The move the thesis was written for is behind this read, not ahead of it.`,
        `перспективою, яку називає сам план: ціна ${price.value}, а твоя ціль ${target.value}. Рух, заради якого писалася теза, позаду цього читання, а не попереду.`,
      ),
    });
  }
  if (planning && planning.number !== null && (price.number > planning.number || price.number < planning.number)) {
    const higher = price.number > planning.number;
    out.push({
      kind: "assumption-conflict",
      id: "assumption.planningPrice",
      facts: [price, planning],
      body: w(
        locale,
        `the price your size was computed on: the size stands on ${planning.value} and the market reads ${price.value}, ${higher ? "higher" : "lower"}. The number of units in the plan was decided against a price that is no longer the one on the screen.`,
        `ціною, на якій рахувався твій розмір: розмір стоїть на ${planning.value}, а ринок читає ${price.value}, ${higher ? "вище" : "нижче"}. Кількість одиниць у плані вирішено проти ціни, якої вже немає на екрані.`,
      ),
    });
  }
  return out;
}

function risksNotEstablished(reads: LensReads, locale: Locale): Draft[] {
  const out: Draft[] = [];
  const risk = reads.facts.get("plan.risk");
  const liquidity = reads.facts.get("liquidity");
  const minLiquidity = reads.facts.get("plan.minLiquidity");
  if (risk && risk.number !== null && (!liquidity || liquidity.number === null)) {
    out.push({
      kind: "risk-not-established",
      id: "risk.liquidityUnknown",
      facts: liquidity ? [risk, liquidity] : [risk],
      body: w(
        locale,
        `in the one place it would be paid: your planned risk is ${risk.value}, and the liquidity that decides what leaving costs was not read. A planned loss assumes an exit at a price; no price of exit is established here.`,
        `саме там, де його довелося б платити: твій плановий ризик ${risk.value}, а ліквідність, яка вирішує, скільки коштує вихід, не прочитана. Плановий збиток припускає вихід за ціною; жодної ціни виходу тут не встановлено.`,
      ),
    });
  }
  if (reads.plan && minLiquidity && minLiquidity.number === null) {
    out.push({
      kind: "risk-not-established",
      id: "risk.noLiquidityFloor",
      facts: [minLiquidity],
      body: w(
        locale,
        `as a rule: this version names no minimum liquidity, so nothing in the plan refuses an entry into a market too thin to leave. The Review can only check the bounds you wrote.`,
        `як правило: ця версія не називає мінімальної ліквідності, тож ніщо в плані не відмовляє входу в ринок, з якого не вийти. Review може перевірити лише межі, які ти написав.`,
      ),
    });
  }
  const price = reads.facts.get("price");
  if (price && (price.state === "stale" || price.state === "unavailable")) {
    out.push({
      kind: "risk-not-established",
      id: "risk.priceState",
      facts: [price],
      body: w(
        locale,
        `on a current figure: the price this rests on is ${price.state === "stale" ? "stale" : "unavailable"}. Every distance from it — to the invalidation, to the maximum — is measured from a number that may no longer be true.`,
        `на актуальній цифрі: ціна, на якій це стоїть, ${price.state === "stale" ? "застаріла" : "недоступна"}. Кожна відстань від неї — до інвалідації, до максимуму — міряється від числа, яке вже може бути неправдою.`,
      ),
    });
  }
  const reference = reads.facts.get("reference");
  if (reference && (reference.state === "stale" || reference.state === "unavailable")) {
    out.push({
      kind: "risk-not-established",
      id: "risk.reference",
      facts: [reference],
      body: w(
        locale,
        `for a tokenized stock: the issuer's reference is ${reference.state === "stale" ? "stale" : "unavailable"}, so the deviation cannot be judged and a plan that requires the reference is blocked rather than passed.`,
        `для токенізованої акції: референс емітента ${reference.state === "stale" ? "застарілий" : "недоступний"}, тож відхилення не оцінити, а план, що вимагає референс, блокується, а не проходить.`,
      ),
    });
  }
  if (reads.holdings && reads.holdings.tokenRead !== "COMPLETE") {
    out.push({
      kind: "risk-not-established",
      id: "risk.holdingsIncomplete",
      facts: [],
      cites: [reads.holdings.cite],
      body: w(
        locale,
        `across the whole wallet: the token read came back ${reads.holdings.tokenRead.toLowerCase()}, so a position may be missing from the picture this decision is being made against.`,
        `по всьому гаманцю: читання токенів повернулося ${reads.holdings.tokenRead === "PARTIAL" ? "частковим" : "недоступним"}, тож у картині, проти якої ухвалюється це рішення, може бракувати позиції.`,
      ),
    });
  }
  if (reads.holdings && reads.holdings.unpriced > 0) {
    out.push({
      kind: "risk-not-established",
      id: "risk.unpriced",
      facts: [],
      cites: [reads.holdings.cite],
      body: w(
        locale,
        `for part of what you hold: the catalogue prices no ${reads.holdings.unpriced} of your tokens, so their weight against this decision is unknown and is not zero.`,
        `для частини того, що ти тримаєш: каталог не оцінює ${reads.holdings.unpriced} твоїх токенів, тож їхня вага проти цього рішення невідома і не дорівнює нулю.`,
      ),
    });
  }
  return out;
}

function planConditionsUnmet(reads: LensReads, locale: Locale): Draft[] {
  const out: Draft[] = [];
  const plan = reads.plan;
  if (!plan) return out;
  const status = reads.facts.get("plan.status");
  if (plan.status !== "active" && status) {
    out.push({
      kind: "plan-condition-unmet",
      id: "plan.status",
      facts: [status],
      cites: [plan.cite],
      body: w(
        locale,
        `the plan is ${status.value}, not active. No Review passes on a version that is not live, whatever the market does.`,
        `план — ${status.value}, а не активний. Жоден Review не проходить на версії, яка не жива, хай що робить ринок.`,
      ),
    });
  }
  const entryWindow = reads.facts.get("plan.entryWindow");
  if (entryWindow && entryWindow.value === w(locale, "over", "минуло")) {
    out.push({
      kind: "plan-condition-unmet",
      id: "plan.entryWindow",
      facts: [entryWindow],
      cites: [plan.cite],
      body: w(
        locale,
        `the entry window you gave this version has passed. Until a new version carries a new validity, the Review refuses it — and rewriting the date is a decision, not a formality.`,
        `вікно входу, яке ти дав цій версії, минуло. Доки нова версія не понесе новий термін, Review їй відмовляє — а переписати дату означає ухвалити рішення, а не залагодити формальність.`,
      ),
    });
  }
  const review = plan.review;
  if (review) {
    for (const check of review.failed.slice(0, 4)) {
      out.push({
        kind: "plan-condition-unmet",
        id: `plan.check.${check.id}`,
        facts: [],
        cites: [plan.cite],
        body:
          check.outcome === "fail"
            ? w(
                locale,
                `${checkWord(check.id, locale)} did not pass the Review of ${review.checkedAt.slice(0, 10)} — it expected “${check.expected}”${check.actual ? ` and found “${check.actual}”` : ""}${check.required ? "; it is a required check, so the order could not be built" : "; it is advisory, so it was named and not enforced"}.`,
                `${checkWord(check.id, locale)} — перевірка не пройшла Review від ${review.checkedAt.slice(0, 10)}: очікувалось «${check.expected}»${check.actual ? `, знайдено «${check.actual}»` : ""}${check.required ? "; вона обов'язкова, тож ордер не збудувався" : "; вона дорадча, тож її назвали, але не примусили"}.`,
              )
            : w(
                locale,
                `${checkWord(check.id, locale)} could not be judged at the Review of ${review.checkedAt.slice(0, 10)} — it expected “${check.expected}”. An unknown is not a pass, and this one${check.required ? " blocks" : " is named"}.`,
                `${checkWord(check.id, locale)} — перевірку не вдалося оцінити на Review від ${review.checkedAt.slice(0, 10)}: очікувалось «${check.expected}». Невідомість не є проходженням, і ця${check.required ? " блокує" : " названа"}.`,
              ),
      });
    }
  }
  return out;
}

function previousResults(reads: LensReads, locale: Locale): Draft[] {
  const out: Draft[] = [];
  for (const entry of reads.memory) {
    const symbol = entry.symbol ?? w(locale, "this wallet", "цей гаманець");
    const value = (key: string): ToolFact | null => entry.values.get(key) ?? null;
    const facts = [...entry.values.values()].slice(0, 4);
    if (entry.kind === "blocked-by-rule") {
      const raw = value("rule");
      const rule = raw === null ? null : { ...raw, value: checkWord(raw.value as PlanCheckId, locale) };
      const plans = value("plans");
      out.push({
        kind: "previous-result",
        id: `memory.${entry.id}`,
        facts,
        body: w(
          locale,
          `${plans?.value ?? ""} plan(s) you wrote on ${symbol} never traded, because ${rule?.value ?? "a rule"}${value("bound") ? ` (${value("bound")!.value})` : ""} refused every Review. The rule did its work; changing it to let this one through changes what it was protecting you from.`,
          `${plans?.value ?? ""} план(ів), які ти написав на ${symbol}, так і не торгували, бо ${rule?.value ?? "правило"}${value("bound") ? ` (${value("bound")!.value})` : ""} відмовило кожному Review. Правило зробило свою роботу; змінити його, щоб пропустити цей раз, означає змінити те, від чого воно захищало.`,
        ),
      });
      continue;
    }
    if (entry.kind === "entry-vs-plan") {
      const actual = value("actual");
      const planned = value("planned");
      const diff = value("diff");
      out.push({
        kind: "previous-result",
        id: `memory.${entry.id}`,
        facts,
        body: w(
          locale,
          `your last entry on ${symbol} was ${actual?.value ?? "—"} against the ${planned?.value ?? "—"} you planned${diff ? ` — ${diff.value}` : ""}. The same gap between plan and fill is available to this decision.`,
          `твій останній вхід на ${symbol} був ${actual?.value ?? "—"} проти запланованих ${planned?.value ?? "—"}${diff ? ` — ${diff.value}` : ""}. Той самий розрив між планом і виконанням доступний і цьому рішенню.`,
        ),
      });
      continue;
    }
    if (entry.kind === "exit-adherence") {
      const verdict = value("verdict");
      if (verdict && verdict.value.toLowerCase().includes(w(locale, "followed", "відповідав").toLowerCase())) continue;
      out.push({
        kind: "previous-result",
        id: `memory.${entry.id}`,
        facts,
        body: w(
          locale,
          `your exit on ${symbol} at ${value("price")?.value ?? "—"} was judged ${verdict?.value ?? "unknown"} against the rules that stood before it. What the plan said about leaving and what happened were not the same thing.`,
          `твій вихід із ${symbol} за ${value("price")?.value ?? "—"} оцінено як ${verdict?.value ?? "невідомо"} проти правил, що стояли до нього. Те, що план казав про вихід, і те, що сталося, — не одне й те саме.`,
        ),
      });
      continue;
    }
    if (entry.kind === "trades-made") {
      const reviewed = value("reviewed");
      const traded = value("traded");
      if (reviewed === null || traded === null || reviewed.number === null || traded.number === null || reviewed.number <= traded.number) continue;
      out.push({
        kind: "previous-result",
        id: `memory.${entry.id}`,
        facts,
        body: w(
          locale,
          `of ${reviewed.value} Review(s) you ran on ${symbol}, ${traded.value} became trades. Most of your own judgements on this asset ended in not acting.`,
          `з ${reviewed.value} Review, які ти прогнав на ${symbol}, ${traded.value} стали угодами. Більшість твоїх же суджень щодо цього активу закінчилися бездіяльністю.`,
        ),
      });
      continue;
    }
    if (entry.kind === "position-open") {
      out.push({
        kind: "previous-result",
        id: `memory.${entry.id}`,
        facts,
        body: w(
          locale,
          `a ${symbol} position is already open — ${value("unitsHeld")?.value ?? "—"} for ${value("costBasis")?.value ?? "—"}. Whatever is decided here is added to exposure you already carry, not taken in isolation.`,
          `позиція на ${symbol} уже відкрита — ${value("unitsHeld")?.value ?? "—"} на ${value("costBasis")?.value ?? "—"}. Хай що вирішується тут, воно додається до експозиції, яку ти вже несеш, а не береться окремо.`,
        ),
      });
      continue;
    }
    if (entry.kind === "monitoring-said") {
      out.push({
        kind: "previous-result",
        id: `memory.${entry.id}`,
        facts,
        body: w(
          locale,
          `Monitoring has already written on ${symbol} — ${value("finding") ? conditionKindWords(value("finding")!.value, locale) : ""} ${value("outcome") ? findingOutcomeWords(value("outcome")!.value, locale) : ""}. It described the moment it was checked and is not a current authorization.`.replace(/\s+/g, " "),
          `Нагляд уже писав по ${symbol} — ${value("finding") ? conditionKindWords(value("finding")!.value, locale) : ""} ${value("outcome") ? findingOutcomeWords(value("outcome")!.value, locale) : ""}. Він описав момент перевірки і не є поточним дозволом.`.replace(/\s+/g, " "),
        ),
      });
    }
  }
  return out;
}

/** An evidence window as a person says it (AI-21) — one function for the answer and the formats. */
export { windowWords };

/** A read that did not answer, named as a person names its source — never the tool's own name (AI-21). */
export function readWords(tool: string, locale: Locale): string {
  const words = TOOL_SOURCE_WORDS[tool];
  return words ? (locale === "uk" ? words[1] : words[0]) : w(locale, "one of the reads", "одне з читань");
}

function evidenceGaps(reads: LensReads, locale: Locale): Draft[] {
  const out: Draft[] = [];
  const conditions = reads.facts.get("plan.conditions");
  for (const card of reads.evidence) {
    if (card.state === "FRESH") continue;
    const span = windowWords(card.window);
    out.push({
      kind: "evidence-missing",
      id: `evidence.${card.provider}.${card.window}`,
      facts: [],
      cites: [card.cite],
      body:
        card.state === "UNKNOWN"
          ? w(
              locale,
              `was never measured ${span[0]}: the source covers no observation of this mint. That is not a clean bill; nothing was checked.`,
              `ніколи не вимірювалися ${span[1]}: джерело не має спостереження про цей мінт. Це не чиста довідка; нічого не перевіряли.`,
            )
          : card.state === "STALE"
            ? w(
                locale,
                `is stale ${span[0]}${card.reason ? ` (${card.reason})` : ""}, so any reading of structure or flow here describes a moment that has passed.`,
                `застарілі ${span[1]}${card.reason ? ` (${card.reason})` : ""}, тож будь-яке читання структури чи потоку тут описує момент, який минув.`,
              )
            : w(
                locale,
                `is unavailable ${span[0]}${card.reason ? ` (${card.reason})` : ""}: concentration, authorities and flows were not read here — a gap, not a clean bill.`,
                `недоступні ${span[1]}${card.reason ? ` (${card.reason})` : ""}: концентрацію, права й потоки тут не прочитано — це прогалина, а не чиста довідка.`,
              ),
    });
  }
  if (reads.evidence.length === 0 && (reads.market || reads.stock)) {
    const cite = reads.market?.cite ?? reads.stock!.cite;
    out.push({
      kind: "evidence-missing",
      id: "evidence.none",
      facts: [],
      cites: [cite],
      body: w(
        locale,
        `is a price and nothing else: no permitted observation of the token's structure or flows was read here, so concentration, authorities and cohort flow are unexamined.`,
        `— це ціна і більше нічого: тут не прочитано жодного дозволеного спостереження про структуру чи потоки токена, тож концентрація, права та потік когорт лишилися неперевіреними.`,
      ),
    });
  }
  if (conditions && conditions.number !== null && conditions.number > 0 && reads.evidence.every((card) => card.state !== "FRESH")) {
    out.push({
      kind: "evidence-missing",
      id: "evidence.conditionUnjudgeable",
      facts: [conditions],
      body: w(
        locale,
        `is what your own version depends on: it carries ${conditions.value} evidence condition(s), and the observation they would be judged on is not fresh. A condition that cannot be judged does not quietly pass.`,
        `— це те, від чого залежить твоя ж версія: вона несе ${conditions.value} умов доказів, а спостереження, на якому їх судили б, не свіже. Умова, яку не можна оцінити, не проходить тихцем.`,
      ),
    });
  }
  for (const note of reads.notes.slice(0, 2)) {
    out.push({
      kind: "evidence-missing",
      id: `evidence.note.${note.inboxId}`,
      facts: [],
      cites: [note.cite],
      body: w(
        locale,
        `includes a monitoring note written on ${note.createdAt.slice(0, 10)} — “${note.title}”. It recorded a condition at the moment it was checked and is not a current authorization; whether it still holds is decided by a fresh Review, not by the note.`,
        `містить нотатку Нагляду від ${note.createdAt.slice(0, 10)} — «${note.title}». Вона зафіксувала умову в момент перевірки і не є поточним дозволом; чи тримається вона досі, вирішує свіжий Review, а не нотатка.`,
      ),
    });
  }
  return out;
}

function assetStructure(reads: LensReads, locale: Locale): Draft[] {
  const out: Draft[] = [];
  const symbol = subjectSymbol(reads) ?? w(locale, "this asset", "цей актив");
  const liquidity = reads.facts.get("liquidity");
  if (reads.market && !reads.market.verified) {
    out.push({
      kind: "asset-structure",
      id: "structure.unverified",
      facts: [],
      cites: [reads.market.cite],
      body: w(
        locale,
        `a name anyone can borrow: ${symbol} is not on the venue's verified list, and a plan cannot name an unverified token. Recognising the ticker is not the same as recognising the mint.`,
        `назву, яку може позичити будь-хто: ${symbol} немає у верифікованому списку майданчика, і план не може назвати неверифікований токен. Упізнати тікер — не те саме, що впізнати мінт.`,
      ),
    });
  }
  if (liquidity && liquidity.number !== null && liquidity.number < 100_000) {
    out.push({
      kind: "asset-structure",
      id: "structure.thinLiquidity",
      facts: [liquidity],
      body: w(
        locale,
        `a market of ${liquidity.value}: at that depth a few thousand dollars move the price, and the exit is paid at a worse one than the entry suggested.`,
        `ринок на ${liquidity.value}: на такій глибині кілька тисяч доларів рухають ціну, а вихід оплачується за гіршою, ніж обіцяв вхід.`,
      ),
    });
  }
  if (reads.market?.category === "meme") {
    out.push({
      kind: "asset-structure",
      id: "structure.meme",
      facts: [],
      cites: [reads.market.cite],
      body: w(
        locale,
        `no issuer and no obligation: ${symbol} is catalogued as a meme, so nothing behind it earns, reports or owes anything. Its price rests on attention, which no figure here measures and no rule of yours can bound.`,
        `ні емітента, ні зобов'язання: ${symbol} у каталозі — мем, тож за ним ніщо не заробляє, не звітує і нічого не винне. Його ціна стоїть на увазі, якої жодна цифра тут не міряє і жодне твоє правило не обмежує.`,
      ),
    });
  }
  const sniper = reads.facts.get("evidence.sniper_holding_pct");
  if (sniper && sniper.number !== null && sniper.number >= 10) {
    out.push({
      kind: "asset-structure",
      id: "structure.snipers",
      facts: [sniper],
      body: w(
        locale,
        `wallets the source labels as snipers holding ${sniper.value} — the label is the provider's judgement, not a fact about intent, and it is advisory. What it does say is that a known cohort can leave together.`,
        `гаманці, які джерело позначає як снайперів, тримають ${sniper.value} — мітка є судженням провайдера, а не фактом про намір, і вона дорадча. Що вона справді каже: відома когорта може вийти разом.`,
      ),
    });
  }
  const top10 = reads.facts.get("evidence.top10_holder_share_pct");
  if (top10 && top10.number !== null && top10.number >= 30) {
    out.push({
      kind: "asset-structure",
      id: "structure.concentration",
      facts: [top10],
      body: w(
        locale,
        `concentration: the ten largest holders hold ${top10.value} of the supply. A handful of wallets can decide the price of the whole market you would be entering.`,
        `концентрацію: десять найбільших тримачів мають ${top10.value} пропозиції. Жменя гаманців може вирішувати ціну всього ринку, до якого ти входив би.`,
      ),
    });
  }
  const mintAuthority = reads.facts.get("evidence.mint_authority");
  if (mintAuthority && mintAuthority.number !== null && mintAuthority.number >= 1) {
    out.push({
      kind: "asset-structure",
      id: "structure.mintAuthority",
      facts: [mintAuthority],
      body: w(locale, `a live mint authority: whoever holds it can increase the supply, and no price rule of yours can refuse that.`, `живе право емісії: той, хто його тримає, може збільшити пропозицію, і жодне твоє цінове правило цьому не відмовить.`),
    });
  }
  const freeze = reads.facts.get("evidence.freeze_authority");
  if (freeze && freeze.number !== null && freeze.number >= 1) {
    out.push({
      kind: "asset-structure",
      id: "structure.freezeAuthority",
      facts: [freeze],
      body: w(locale, `a live freeze authority: token accounts can be frozen, which is a risk to leaving rather than to the price.`, `живе право заморозки: токен-рахунки можна заморозити, і це ризик для виходу, а не для ціни.`),
    });
  }
  const tax = reads.facts.get("evidence.transfer_tax_pct");
  if (tax && tax.number !== null && tax.number > 0) {
    out.push({
      kind: "asset-structure",
      id: "structure.transferTax",
      facts: [tax],
      body: w(locale, `a transfer tax of ${tax.value} withheld on every transfer, which your planned risk does not model.`, `податок на переказ ${tax.value}, що утримується з кожного переказу і якого твій плановий ризик не моделює.`),
    });
  }
  if (reads.stock) {
    const stock = reads.stock;
    const rights = stock.instrument.rights === "issuer-terms" ? w(locale, "the issuer's terms", "умови емітента") : stock.instrument.rights === "economic-exposure" ? w(locale, "economic exposure with no shareholder rights", "економічну експозицію без прав акціонера") : w(locale, "loan participation", "участь у позиці");
    out.push({
      kind: "asset-structure",
      id: "structure.rights",
      facts: [],
      cites: [stock.cite],
      body: w(
        locale,
        `a claim that is not the share: ${stock.instrument.class === "pre-ipo" ? "a pre-IPO instrument" : "a tokenized listed stock"} from ${stock.issuer.label}, giving ${rights} — not the share itself, and not the rights of one.`,
        `претензію, яка не є акцією: ${stock.instrument.class === "pre-ipo" ? "pre-IPO інструмент" : "токенізована лістингова акція"} від ${stock.issuer.label}, що дає ${rights} — не саму акцію і не права акціонера.`,
      ),
    });
    if (stock.session.exchangeOpen === false) {
      out.push({
        kind: "asset-structure",
        id: "structure.session",
        facts: [],
        cites: [stock.cite],
        body: w(
          locale,
          `a closed reference exchange: the token trades against a reference that does not move until it opens, so the deviation can widen for that reason alone.`,
          `закриту референсну біржу: токен торгується проти референсу, що не рухається до відкриття, тож відхилення може зрости вже через це.`,
        ),
      });
    }
    if (!stock.lifecycle.tradable) {
      out.push({
        kind: "asset-structure",
        id: "structure.lifecycle",
        facts: [],
        cites: [stock.cite],
        body: w(locale, `an issuer lifecycle of ${stock.lifecycle.state}: a new purchase is not what the issuer supports right now.`, `життєвий цикл емітента — ${stock.lifecycle.state}: нова покупка зараз не те, що емітент підтримує.`),
      });
    }
  }
  return out;
}

function thesisWeakness(reads: LensReads, locale: Locale): Draft[] {
  const out: Draft[] = [];
  const symbol = subjectSymbol(reads) ?? w(locale, "this asset", "цей актив");
  if (!reads.plan) {
    if (reads.market || reads.stock) {
      out.push({
        kind: "thesis-weakness",
        id: "thesis.none",
        facts: [],
        cites: [reads.market?.cite ?? reads.stock!.cite],
        body: w(
          locale,
          `there is none: you have no plan on ${symbol}, so nothing states an entry, an invalidation or a planned risk that could be argued with. A thesis that is never written cannot be found wrong.`,
          `її просто немає: у тебе немає плану на ${symbol}, тож ніщо не заявляє входу, інвалідації чи планового ризику, з якими можна сперечатися. Тезу, яку ніколи не записали, не можна визнати хибною.`,
        ),
      });
    }
    return out;
  }
  const conditions = reads.facts.get("plan.conditions");
  if (conditions && conditions.number === 0) {
    out.push({
      kind: "thesis-weakness",
      id: "thesis.noCondition",
      facts: [conditions],
      body: w(
        locale,
        `nothing measures it: this version carries no evidence condition, so only price can ever refuse it. A thesis about holders, flows or authorities that no condition names is a belief, not a rule.`,
        `її ніщо не міряє: ця версія не несе жодної умови доказів, тож відмовити їй може лише ціна. Теза про тримачів, потоки чи права, яку не називає жодна умова, — це переконання, а не правило.`,
      ),
    });
  }
  const target = reads.facts.get("plan.target");
  const timeExit = reads.facts.get("plan.timeExit");
  if (target && target.number === null && timeExit && timeExit.state === "unknown") {
    out.push({
      kind: "thesis-weakness",
      id: "thesis.noExit",
      facts: [target, timeExit],
      body: w(
        locale,
        `it ends: the version names an entry and an invalidation, and neither a target nor a time exit. Nothing in it says when being right is finished.`,
        `вона закінчується: версія називає вхід та інвалідацію і не називає ні цілі, ні виходу за часом. Ніщо в ній не каже, коли правота вичерпана.`,
      ),
    });
  }
  const whyNow = reads.facts.get("plan.whyNow");
  if (whyNow && whyNow.state === "unknown") {
    out.push({
      kind: "thesis-weakness",
      id: "thesis.noWhyNow",
      facts: [whyNow],
      body: w(
        locale,
        `it meets time: *why now* is not stated on this version. It says what you believe about the asset, not why this moment is the one to act in.`,
        `вона зустрічається з часом: «чому зараз» на цій версії не заявлено. Вона каже, у що ти віриш щодо активу, а не чому діяти саме в цей момент.`,
      ),
    });
  }
  const assumptions = reads.facts.get("plan.assumptions");
  if (assumptions && assumptions.number === 0) {
    out.push({
      kind: "thesis-weakness",
      id: "thesis.noAssumptions",
      facts: [assumptions],
      body: w(
        locale,
        `it could be checked: no assumption is written down, so later nothing can be found to have been wrong — only the outcome, which teaches nothing about the reasoning.`,
        `її можна перевірити: жодне припущення не записане, тож потім не буде чого визнати хибним — лише результат, який нічого не каже про міркування.`,
      ),
    });
  }
  const sources = reads.facts.get("plan.sources");
  if (sources && sources.number === 0) {
    out.push({
      kind: "thesis-weakness",
      id: "thesis.noSources",
      facts: [sources],
      body: w(locale, `it comes from: no source is stated on this version, so the thesis stands on your own words alone.`, `звідки вона взялася: на цій версії не заявлено жодного джерела, тож теза стоїть лише на твоїх словах.`),
    });
  }
  const horizon = reads.facts.get("plan.horizon");
  if (horizon && horizon.state === "unknown") {
    out.push({
      kind: "thesis-weakness",
      id: "thesis.noHorizon",
      facts: [horizon],
      body: w(locale, `it expires: no horizon is stated, so the thesis cannot become wrong by time — only by price, and only if you keep watching.`, `вона спливає: горизонт не заявлено, тож теза не може стати хибною за часом — лише за ціною, і лише якщо ти продовжиш дивитися.`),
    });
  }
  return out;
}

/* ------------------------------------------------------------ what could not be challenged */

function gaps(reads: LensReads, found: readonly AgentCriticFinding[], locale: Locale): AgentSentence[] {
  const out: AgentSentence[] = [];
  const kinds = new Set(found.map((row) => row.kind));
  const say = (text: string, cites: readonly string[] = []) => out.push({ text: text.slice(0, 400), cites: [...new Set(cites)].slice(0, 6) });
  if (reads.memory.length === 0) {
    say(w(locale, "Your own record was not used: there is nothing in this wallet's memory about this subject yet, so no previous decision of yours argues either way.", "Твій власний запис не використано: у пам'яті цього гаманця ще нічого немає про цей предмет, тож жодне твоє попереднє рішення не свідчить ні за, ні проти."));
  }
  if (!reads.plan) {
    say(w(locale, "No plan was judged here, so no rule of yours was checked against the market.", "Жодного плану тут не оцінено, тож жодне твоє правило не перевірено проти ринку."));
  } else if (!reads.plan.review) {
    say(w(locale, "This plan has kept no Review, so nothing says how its rules behave against a real quote.", "Цей план не зберіг жодного Review, тож ніщо не каже, як його правила поводяться проти справжнього котирування."), [reads.plan.cite]);
  }
  if (!kinds.has("asset-structure") && reads.evidence.length === 0) {
    say(w(locale, "The asset's structure was not argued for or against: concentration and authorities were not measured in this read.", "Структуру активу не оскаржено ні за, ні проти: концентрацію та права в цьому читанні не вимірювали."));
  }
  say(w(locale, "Nothing here is a judgement about where the price goes; the Critic argues with a thesis, it does not hold one.", "Ніщо тут не є судженням про те, куди піде ціна; Критик сперечається з тезою, а не тримає власну."));
  return out.slice(0, 6);
}

/* ------------------------------------------------------------ the composer */

export function composeCritic(reads: LensReads, locale: Locale): AgentCritic {
  if (nothingRead(reads)) {
    return AgentCriticSchema.parse({
      findings: [],
      gaps: [
        { text: w(locale, "Insufficient data: nothing could be read about this subject, so nothing can be argued against it.", "Даних недостатньо: про цей предмет нічого не вдалося прочитати, тож і сперечатися нема з чим."), cites: [] },
        ...reads.unavailable.map((tool) => ({ text: w(locale, `The read of ${readWords(tool, locale)} did not answer; silence here is not agreement.`, `Читання «${readWords(tool, locale)}» не відповіло; мовчання тут не є згодою.`), cites: [] })),
      ].slice(0, 6),
      insufficient: true,
    });
  }
  const drafts = [...planConditionsUnmet(reads, locale), ...assumptionConflicts(reads, locale), ...previousResults(reads, locale), ...risksNotEstablished(reads, locale), ...evidenceGaps(reads, locale), ...assetStructure(reads, locale), ...thesisWeakness(reads, locale)];
  const seen = new Set<string>();
  const findings: AgentCriticFinding[] = [];
  for (const draft of drafts) {
    if (seen.has(draft.id)) continue;
    seen.add(draft.id);
    const row = finding(draft, locale);
    if (isDirective(row.text)) continue;
    findings.push(row);
  }
  findings.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  const kept = findings.slice(0, 12);
  return AgentCriticSchema.parse({ findings: kept, gaps: gaps(reads, kept, locale), insufficient: kept.length === 0 });
}
