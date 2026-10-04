/**
 * The Brief — five questions and no more.
 *
 * *What changed · what matters for this thesis or plan · which data supports
 * it · what is unknown · what to check next.* It is a **format over the
 * agent engine**, not a second one: every sentence is written from the
 * `ToolRun`s the same Research tools produced, every figure is printed
 * exactly as the tool printed it, and every sentence carries the citations
 * of the reads it stands on. Where the reads gave nothing, the Brief says
 * *insufficient data* and fills nothing.
 *
 * What it never does: compute a figure, add two states together, turn an
 * unavailable read into a zero, or tell a person what to trade. The Brief
 * describes; the Critic argues; the person decides.
 *
 * Pure: the projection in, the Brief out.
 */

import { AGENT_BRIEF_SECTIONS, AgentBriefSchema, type AgentBrief, type AgentSentence } from "../../api/v1/contract.ts";
import type { Locale } from "../provenance.ts";
import type { ToolNote } from "../tools/types.ts";
import { nothingRead, subjectSymbol, type LensReads } from "./reads.ts";

export type BriefSection = (typeof AGENT_BRIEF_SECTIONS)[number];

/**
 * A Brief is brief. The two sections a surface opens are held to four
 * sentences each — past that a person stops reading, and a wall of text is a
 * defect; the three folded sections may carry more, because they are read on
 * purpose.
 */
const LIMITS: Readonly<Record<BriefSection, number>> = { changed: 4, matters: 4, supports: 6, unknown: 5, checks: 4 };

const w = (locale: Locale, en: string, uk: string): string => (locale === "uk" ? uk : en);

const line = (text: string, cites: readonly string[]): AgentSentence => ({ text: text.slice(0, 400), cites: [...new Set(cites)].slice(0, 6) });

function dedupe(rows: readonly AgentSentence[]): AgentSentence[] {
  const seen = new Set<string>();
  const out: AgentSentence[] = [];
  for (const row of rows) {
    const key = row.text.trim();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

const notesOf = (reads: LensReads, section: ToolNote["section"]): AgentSentence[] => reads.runs.flatMap((run) => run.notes.filter((note) => note.section === section).map((note) => line(note.text, note.cites)));

/* ------------------------------------------------------------ what changed */

/**
 * A change is a figure that *is* a move, or a record that *is* an event —
 * never a level dressed as one. The 24h change and the deviation from a
 * reference are moves the desk read; a monitoring note, a version, a Review
 * and an execution are events the wallet's own records hold.
 */
function changed(reads: LensReads, locale: Locale): AgentSentence[] {
  const out: AgentSentence[] = [];
  const symbol = subjectSymbol(reads) ?? w(locale, "this asset", "цей актив");
  const change = reads.facts.get("change24h");
  const price = reads.facts.get("price");
  if (change && change.number !== null && price) {
    out.push(
      line(
        w(
          locale,
          `${symbol} moved ${change.value} over 24 hours and stands at ${price.value} (${price.state}).`,
          `${symbol} змінився на ${change.value} за 24 години і стоїть на ${price.value} (${price.state === "current" ? "актуально" : price.state === "stale" ? "застаріло" : price.state === "unavailable" ? "недоступно" : "невідомо"}).`,
        ),
        [change.cite, price.cite],
      ),
    );
  }
  for (const note of reads.notes.slice(0, 3)) {
    /* The note's own words, never its internal kind: a reader is told what was found, not what the store calls it. */
    const outcome = note.finding === null ? null : note.finding.outcome === "fail" ? w(locale, "a condition was not met", "умова не виконана") : note.finding.outcome === "pass" ? w(locale, "the condition held", "умова трималася") : w(locale, "it could not be judged", "оцінити не вдалося");
    out.push(line(w(locale, `Monitoring wrote: ${note.title}${outcome ? ` — ${outcome}` : ""}.`, `Нагляд записав: ${note.title}${outcome ? ` — ${outcome}` : ""}.`), [note.cite]));
  }
  const versionAt = reads.facts.get("plan.versionAt");
  const versions = reads.facts.get("plan.versions");
  if (reads.plan && versionAt) {
    out.push(
      line(
        w(
          locale,
          `Version ${reads.plan.version} of the ${reads.plan.symbol} plan was written ${versionAt.value}${versions && versions.number !== null && versions.number > 1 ? ` — ${versions.value} versions stand behind it` : ""}.`,
          `Версію ${reads.plan.version} плану ${reads.plan.symbol} записано ${versionAt.value}${versions && versions.number !== null && versions.number > 1 ? ` — за нею стоїть ${versions.value} версій` : ""}.`,
        ),
        [versionAt.cite],
      ),
    );
  }
  const review = reads.plan?.review ?? null;
  if (review) {
    const verdict = review.verdict === "ready" ? w(locale, "ready", "готово") : review.verdict === "blocked" ? w(locale, "blocked", "заблоковано") : w(locale, "attention", "увага");
    out.push(line(w(locale, `The latest Review of this plan was ${verdict}, with ${review.failed.length} check(s) that did not pass.`, `Останній Review цього плану — ${verdict}, ${review.failed.length} перевірок не пройшли.`), [reads.plan!.cite]));
  }
  const executions = reads.facts.get("plan.executions");
  if (executions && executions.number !== null && executions.number > 0) {
    out.push(line(w(locale, `${executions.value} execution(s) are recorded under this plan.`, `Під цим планом записано ${executions.value} виконань.`), [executions.cite]));
  }
  if (out.length === 0) {
    const anyCite = [...reads.facts.values()][0]?.cite;
    out.push(
      line(
        w(locale, "Nothing in these reads states a change: what is below is a level at one moment, not a move.", "Жодне з цих читань не каже про зміну: нижче — рівень одного моменту, а не рух."),
        anyCite ? [anyCite] : [],
      ),
    );
  }
  return out;
}

/* ------------------------------------------------------------ what matters */

/** What the reads mean for the thesis the person is holding — the plan's own bounds against the market, and the position the wallet actually has. */
function matters(reads: LensReads, locale: Locale): AgentSentence[] {
  const out: AgentSentence[] = [];
  const price = reads.facts.get("price");
  const invalidation = reads.facts.get("plan.invalidation");
  const maxPrice = reads.facts.get("plan.maxPrice");
  const symbol = subjectSymbol(reads) ?? w(locale, "this asset", "цей актив");
  if (price && price.number !== null && invalidation && invalidation.number !== null) {
    out.push(
      price.number <= invalidation.number
        ? line(w(locale, `The price ${price.value} is at or below your invalidation ${invalidation.value}: by your own rule the thesis is wrong at this price.`, `Ціна ${price.value} на рівні або нижче твоєї інвалідації ${invalidation.value}: за твоїм же правилом теза хибна за цієї ціни.`), [price.cite, invalidation.cite])
        : line(w(locale, `The price ${price.value} is above your invalidation ${invalidation.value}: on this read the thesis has not been called wrong.`, `Ціна ${price.value} вище твоєї інвалідації ${invalidation.value}: на цьому читанні теза не визнана хибною.`), [price.cite, invalidation.cite]),
    );
  }
  if (price && price.number !== null && maxPrice && maxPrice.number !== null && price.number > maxPrice.number) {
    out.push(line(w(locale, `The price ${price.value} is above your maximum ${maxPrice.value}: a buy at this price would not pass the plan.`, `Ціна ${price.value} вище твоєї максимальної ${maxPrice.value}: купівля за цією ціною не пройшла б план.`), [price.cite, maxPrice.cite]));
  }
  /* A tokenized stock's distance from its issuer's reference is a level, not a move: it belongs to what matters, never to what changed. */
  const deviation = reads.facts.get("deviation");
  if (deviation && deviation.number !== null) {
    out.push(line(w(locale, `The token stands ${deviation.value} from the issuer's reference: what you would pay is the executable price at the Review, not the reference.`, `Токен стоїть на ${deviation.value} від референсу емітента: платиться виконувана ціна на Review, а не референс.`), [deviation.cite]));
  }
  const liquidity = reads.facts.get("liquidity");
  const minLiquidity = reads.facts.get("plan.minLiquidity");
  if (liquidity && liquidity.number !== null && minLiquidity && minLiquidity.number !== null) {
    out.push(
      liquidity.number < minLiquidity.number
        ? line(w(locale, `Liquidity ${liquidity.value} is below the ${minLiquidity.value} your plan requires: the Review refuses on that alone.`, `Ліквідність ${liquidity.value} нижча за ${minLiquidity.value}, які вимагає твій план: Review відмовляє вже через це.`), [liquidity.cite, minLiquidity.cite])
        : line(w(locale, `Liquidity ${liquidity.value} meets the ${minLiquidity.value} your plan requires.`, `Ліквідність ${liquidity.value} відповідає ${minLiquidity.value}, які вимагає твій план.`), [liquidity.cite, minLiquidity.cite]),
    );
  }
  const entryWindow = reads.facts.get("plan.entryWindow");
  if (reads.plan && entryWindow && entryWindow.value === w(locale, "over", "минуло")) {
    out.push(line(w(locale, `The entry window of this plan has passed: the Review refuses this version until a new one carries a new validity.`, `Вікно входу цього плану минуло: Review відмовляє цій версії, доки нова не понесе новий термін.`), [entryWindow.cite]));
  }
  if (!reads.plan && (reads.market || reads.stock)) {
    const cite = reads.market?.cite ?? reads.stock!.cite;
    out.push(line(w(locale, `You have no plan on ${symbol}: there is no thesis here to measure these figures against.`, `У тебе немає плану на ${symbol}: тут немає тези, проти якої міряти ці цифри.`), [cite]));
  }
  for (const row of notesOf(reads, "meaning")) out.push(row);
  return out;
}

/* ------------------------------------------------------------ what supports it */

/** The data itself, as each tool stated it — the source, the figure and the time. */
function supports(reads: LensReads, locale: Locale): AgentSentence[] {
  const out = notesOf(reads, "observation");
  if (out.length === 0) {
    const first = [...reads.facts.values()][0];
    if (first) out.push(line(w(locale, `The only figure read here is ${first.label.toLowerCase()} ${first.value} (${first.state}).`, `Єдина прочитана тут цифра — ${first.label.toLowerCase()} ${first.value} (${first.state === "current" ? "актуально" : first.state === "stale" ? "застаріло" : first.state === "unavailable" ? "недоступно" : "невідомо"}).`), [first.cite]));
  }
  return out;
}

/* ------------------------------------------------------------ what is unknown */

/** Every figure that did not answer, and every read that did not return — named, never rounded to zero. */
function unknown(reads: LensReads, locale: Locale): AgentSentence[] {
  const out: AgentSentence[] = [];
  const missing = [...reads.facts.values()].filter((entry) => entry.state === "unavailable" || entry.state === "unknown");
  if (missing.length > 0) {
    const named = missing.slice(0, 6);
    out.push(
      line(
        w(locale, `Not answered by any source here: ${named.map((entry) => entry.label.toLowerCase()).join(", ")}${missing.length > named.length ? ", …" : ""}. Each is missing, not zero.`, `Жодне джерело тут не відповіло про: ${named.map((entry) => entry.label.toLowerCase()).join(", ")}${missing.length > named.length ? ", …" : ""}. Кожне з них відсутнє, а не дорівнює нулю.`),
        named.map((entry) => entry.cite),
      ),
    );
  }
  for (const tool of reads.unavailable) {
    out.push(line(w(locale, `The read “${tool}” did not answer; what it would have said is missing here.`, `Читання «${tool}» не відповіло; те, що воно сказало б, тут відсутнє.`), []));
  }
  for (const card of reads.evidence) {
    if (card.state === "FRESH") continue;
    out.push(
      line(
        card.state === "UNKNOWN"
          ? w(locale, `The evidence layer covers no observation for this mint over ${card.window}: not enough data, not a clean bill.`, `Шар доказів не має спостереження для цього мінта за ${card.window}: даних недостатньо, і це не чиста довідка.`)
          : w(locale, `The ${card.window} observation is ${card.state.toLowerCase()}${card.reason ? ` (${card.reason})` : ""}.`, `Спостереження за ${card.window} — ${card.state === "STALE" ? "застаріле" : "недоступне"}${card.reason ? ` (${card.reason})` : ""}.`),
        [card.cite],
      ),
    );
  }
  if (reads.holdings && reads.holdings.tokenRead !== "COMPLETE") {
    out.push(line(w(locale, `The wallet's token read is ${reads.holdings.tokenRead.toLowerCase()}: a position may be missing from this picture.`, `Читання токенів гаманця ${reads.holdings.tokenRead === "PARTIAL" ? "часткове" : "недоступне"}: позиція може бути відсутня в цій картині.`), [reads.holdings.cite]));
  }
  if (out.length === 0) {
    const anyCite = [...reads.facts.values()][0]?.cite;
    out.push(line(w(locale, "Every figure named here was answered by its source; what is missing is everything no source was asked for.", "Кожна названа тут цифра була відповіддю свого джерела; бракує лише того, про що джерел не питали."), anyCite ? [anyCite] : []));
  }
  return out;
}

/* ------------------------------------------------------------ what to check next */

function checks(reads: LensReads, locale: Locale): AgentSentence[] {
  const out = notesOf(reads, "checks");
  if (reads.plan) {
    out.push(line(w(locale, `A Review on a fresh quote is what decides the exact deal under this plan; nothing read here is that decision.`, `Рішення про саме цю угоду під цим планом ухвалює Review на свіжому котируванні; ніщо прочитане тут ним не є.`), [reads.plan.cite]));
  }
  if (out.length === 0) {
    const anyCite = [...reads.facts.values()][0]?.cite;
    out.push(line(w(locale, "The same reads again before a decision — the state beside each figure says whether it is current.", "Ті самі читання ще раз перед рішенням — стан біля кожної цифри каже, чи вона актуальна."), anyCite ? [anyCite] : []));
  }
  return out;
}

/* ------------------------------------------------------------ the composer */

export function composeBrief(reads: LensReads, locale: Locale): AgentBrief {
  const insufficient = nothingRead(reads);
  if (insufficient) {
    const said = (en: string, uk: string): AgentSentence[] => [line(w(locale, en, uk), [])];
    return AgentBriefSchema.parse({
      changed: said("Nothing could be read here, so no change can be stated.", "Тут нічого не вдалося прочитати, тож про зміну сказати нічого."),
      matters: said("Insufficient data: no conclusion is drawn from figures that were never read.", "Даних недостатньо: з цифр, які не були прочитані, висновок не робиться."),
      supports: said("No source answered for this subject.", "Жодне джерело не відповіло щодо цього предмета."),
      unknown: [
        ...said("Everything this Brief would stand on is missing.", "Усе, на чому стояв би цей Brief, відсутнє."),
        ...reads.unavailable.map((tool) => line(w(locale, `The read “${tool}” did not answer.`, `Читання «${tool}» не відповіло.`), [])),
      ],
      checks: said("Ask again when the reads return, or open the page the figure lives on.", "Спитай знову, коли читання повернуться, або відкрий сторінку, де живе цифра."),
      insufficient: true,
    });
  }
  const brief: AgentBrief = {
    changed: dedupe(changed(reads, locale)).slice(0, LIMITS.changed),
    matters: dedupe(matters(reads, locale)).slice(0, LIMITS.matters),
    supports: dedupe(supports(reads, locale)).slice(0, LIMITS.supports),
    unknown: dedupe(unknown(reads, locale)).slice(0, LIMITS.unknown),
    checks: dedupe(checks(reads, locale)).slice(0, LIMITS.checks),
    insufficient: false,
  };
  return AgentBriefSchema.parse(brief);
}
