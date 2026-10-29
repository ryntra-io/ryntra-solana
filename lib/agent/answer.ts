/**
 * The answer — composed deterministically from the tools' own sentences, or
 * verified when a model wrote it.
 *
 * The answer has six sections, in this order: observation → what it means →
 * counter-argument → risks and unknowns → what to check → possible next
 * actions. The deterministic composer fills it from the notes the tools
 * wrote, each with its citations, and says *insufficient data* plainly when
 * the reads gave nothing to judge on. The verifier holds a model's words to
 * the same reads: a sentence that cites nothing that exists, or states a
 * figure no tool read and the person did not write, is dropped; an action
 * that commands a trade is dropped. Nothing a model wrote reaches a person
 * as a fact unless a tool read it first.
 *
 * AI-02: the server no longer writes in the model's place. A section the
 * model left empty stays empty — the generic sentences of the deterministic
 * composer (`defaults`) never fill a model's answer, which is what made a
 * good model read worse than it wrote (AI-01). Only the tools' own cited
 * sentences come back: where every sentence the model wrote in a section was
 * dropped, and in the observation, which a person must always see. And every
 * sentence reaches a person as a block of at most two lines on a phone
 * (`BLOCK_MAX_CHARS`): a longer one is cut at its sentence ends, each block
 * keeping the citations.
 *
 * AI-09: a headline is someone else's words. The figures in a `quote` note
 * hold a model only in a sentence that cites that headline — a number a
 * publication printed never becomes a figure the answer may state on another
 * source's citation. A sentence that carries a link, or calls the assistant
 * anything but Ryntra, is dropped like a command; a quote that commands a
 * trade never reaches a person even from the composer.
 */

import type { ReaderMemory } from "../assistant/memory/service.ts";
import type { Reader } from "../assistant/profile/service.ts";
import { AGENT_ANSWER_SECTIONS, AgentAnswerSchema, type AgentAnswer, type AgentQuestionClass, type AgentSentence } from "../api/v1/contract.ts";
import { CRYPTO_TERMS, extractSymbols, NETWORK_NAMES, NETWORK_TICKERS, type Intent } from "./intent.ts";
import type { CitationBook, Locale } from "./provenance.ts";
import { ordersAProgram, screenText, steersOrSells } from "../assistant/news/text.ts";
import { TOOL_SOURCE_WORDS } from "./tools/market-data.ts";
import type { ToolNote, ToolRun } from "./tools/types.ts";

export type Section = (typeof AGENT_ANSWER_SECTIONS)[number];

const LIMITS: Readonly<Record<Section, number>> = { observation: 8, meaning: 6, counter: 4, risks: 6, checks: 6, actions: 6 };

/** A block a person reads in at most two lines on a phone. */
export const BLOCK_MAX_CHARS = 200;

const SENTENCE_END = /(?<=[.!?…])\s+(?=[\p{Lu}\p{N}«"(])/u;

/**
 * One sentence as blocks of at most `BLOCK_MAX_CHARS`: split at its sentence
 * ends and packed greedily, every block keeping the citations. A single
 * sentence longer than a block is kept whole — cutting inside it would
 * change what it says.
 */
export function toBlocks(sentence: AgentSentence): AgentSentence[] {
  const text = sentence.text.trim();
  if (text.length <= BLOCK_MAX_CHARS) return [{ text, cites: sentence.cites }];
  /* Sentence ends first; a sentence still longer than a block is cut at its semicolons, the mark kept. */
  const parts = text
    .split(SENTENCE_END)
    .flatMap((part) => (part.length > BLOCK_MAX_CHARS ? part.split(/(?<=;)\s+/) : [part]))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const blocks: string[] = [];
  for (const part of parts) {
    const last = blocks.length > 0 ? blocks[blocks.length - 1] : null;
    if (last !== null && last.length + 1 + part.length <= BLOCK_MAX_CHARS) blocks[blocks.length - 1] = `${last} ${part}`;
    else blocks.push(part);
  }
  return blocks.map((block) => ({ text: block.slice(0, 400), cites: sentence.cites }));
}

function asBlocks(rows: readonly AgentSentence[], section: Section): AgentSentence[] {
  return rows.flatMap((row) => toBlocks(row)).slice(0, LIMITS[section]);
}

/** Everything the composer and the verifier see for one exchange. */
export type AnswerPacket = Readonly<{
  intent: Intent;
  personText: string;
  runs: readonly ToolRun[];
  citations: CitationBook;
  locale: Locale;
  /** AI-06: who reads the answer, from «Знайомство» — only what shapes the words; absent for a guest or a skip. */
  reader?: Reader | null;
  /** AI-18: «Про мене» and the person's notes — untrusted words that only shape the wording. */
  memory?: ReaderMemory | null;
}>;

const w = (locale: Locale, en: string, uk: string): string => (locale === "uk" ? uk : en);

/* ------------------------------------------------------------ the deterministic composer */

function dedupe(notes: readonly ToolNote[]): ToolNote[] {
  const seen = new Set<string>();
  const out: ToolNote[] = [];
  for (const note of notes) {
    const key = note.text.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(note);
  }
  return out;
}

function sentences(notes: readonly ToolNote[], section: Section): AgentSentence[] {
  return dedupe(notes.filter((note) => note.section === section))
    .slice(0, LIMITS[section])
    .map((note) => ({ text: note.text.slice(0, 400), cites: [...new Set(note.cites)].slice(0, 6) }));
}

/** The sentences a class carries when its tools wrote none for a section — the agent's own register, never a figure. */
function defaults(klass: AgentQuestionClass, locale: Locale, insufficient: boolean): Partial<Record<Section, string>> {
  const generic: Partial<Record<Section, string>> = {
    counter: w(locale, "What is read here is one moment's figures from named sources; none of it says where a price goes.", "Прочитане тут — цифри одного моменту з названих джерел; ніщо з цього не каже, куди піде ціна."),
    checks: w(locale, "The same reads again before a decision — the state beside each figure says whether it is current.", "Ті самі читання ще раз перед рішенням — стан біля кожної цифри каже, чи вона актуальна."),
    actions: w(locale, "Prepare a plan with your own entry, invalidation and planned risk; the Review judges the exact deal on a fresh quote.", "Підготуй план зі своїм входом, інвалідацією і плановим ризиком; Review судить саме угоду на свіжому котируванні."),
  };
  if (insufficient) {
    return {
      observation: w(locale, "There is not enough data to judge this: the reads answered nothing usable.", "Даних недостатньо, щоб це оцінити: читання не дали нічого придатного."),
      meaning: w(locale, "No conclusion is drawn from missing figures.", "З відсутніх цифр висновок не робиться."),
      risks: w(locale, "The gap itself is the risk: a decision here would rest on nothing read.", "Прогалина сама є ризиком: рішення тут спиралося б на непрочитане."),
      ...generic,
    };
  }
  switch (klass) {
    case "portfolio":
      return { ...generic, actions: w(locale, "Prepare a plan on a position you hold without one, or open Portfolio for the full list.", "Підготуй план на позицію, яку тримаєш без плану, або відкрий Портфель для повного списку.") };
    case "plan":
    case "plans":
    case "results":
      return { ...generic, actions: w(locale, "Open the plan to edit its rules into a new version, or the Review under it when you are ready to act.", "Відкрий план, щоб змінити правила новою версією, або Review під ним, коли готовий діяти.") };
    case "monitoring":
      return { ...generic, actions: w(locale, "Open the plan the note is about; a fresh Review decides whether the condition still holds.", "Відкрий план, про який нотатка; свіжий Review вирішує, чи умова досі тримається.") };
    case "compare":
      return { ...generic, actions: w(locale, "Open either asset's page for the priced comparison, or prepare a plan on the one whose terms fit you.", "Відкрий сторінку будь-якого активу для порівняння з цінами або підготуй план на той, чиї умови тобі підходять.") };
    default:
      return generic;
  }
}

/** True when no research tool answered with anything to stand on. */
export function insufficientData(runs: readonly ToolRun[]): boolean {
  const tools = runs.filter((run) => run.tool !== "service");
  if (tools.length === 0) return true;
  return tools.every((run) => run.outcome !== "ok" || run.facts.length === 0);
}

const WITHOUT_FILLER: readonly AgentQuestionClass[] = ["secret", "execute", "help", "unknown"];

/**
 * AI-09: whether a tool's sentence may reach a person as it is. A headline
 * that commands or advises a trade, steers a program or sells is not said —
 * not by the composer and not as the verifier's stand-in for a section the
 * model left empty. The feeds' screen keeps such headlines out; this keeps
 * them out again.
 */
function sayable(note: ToolNote): boolean {
  return !note.quote || !(COMMANDS.test(note.text) || ADVICE.test(note.text) || !screenText(note.text).ok);
}

/**
 * AI-21 (the phone's request 69): the head of «what moved the price?». The
 * move card's own line of the move — one figure, from one source, with its
 * time («SOL moved +3.3 % over 24 h on SOL/USDC · orca — DexScreener, Sep 22,
 * 09:59 UTC.») — leads the observation, where the catalogue's figure of the
 * same move used to stand without its source's time beside DexScreener's.
 * `null` when the move was not read: then nothing changes.
 */
export type MoveLead = Readonly<{
  sentence: AgentSentence;
  /** The token moved and the move's window: only that token's day figures from other sources are left out beside it. */
  mint: string;
  window: "1h" | "24h";
  /** The figure the head states, unsigned. */
  figure: number | null;
}>;

export function moveLead(runs: readonly ToolRun[]): MoveLead | null {
  for (const card of runs.flatMap((run) => run.cards)) {
    if (card.kind !== "move" || card.change === null) continue;
    const cite = card.change.cite;
    const row = card.rows.find((entry) => entry.mark === "fact" && entry.cites.includes(cite));
    if (row) return { sentence: { text: row.text, cites: [...row.cites] }, mint: card.mint, window: card.window, figure: card.change.number === null ? null : Math.abs(card.change.number) };
  }
  return null;
}

/** Whether a note's own figure of the move is left out beside the head: a day's figure of the same token — another token, or the hour asked about, keeps its own. */
function besideLead(note: ToolNote, packet: AnswerPacket, lead: MoveLead | null): boolean {
  if (!lead || lead.window !== "24h" || !note.withoutMove) return false;
  const refs = new Map(packet.citations.list().map((cite) => [cite.id, cite.ref] as const));
  return note.cites.length > 0 && note.cites.every((id) => refs.get(id) === lead.mint);
}

/** The tools' notes as an answer says them: beside the move's head, a sentence's own figure of the same move is left out (`withoutMove`). */
export function answerNotes(packet: AnswerPacket, lead: MoveLead | null): ToolNote[] {
  const notes = packet.runs.flatMap((run) => run.notes).filter(sayable);
  return notes.map((note) => (besideLead(note, packet, lead) ? { ...note, text: note.withoutMove! } : note));
}

/** A figure as a sentence prints it — to one or to two decimals. */
const printed = (figure: number): readonly number[] => [Math.round(figure * 10) / 10, Math.round(figure * 100) / 100];

/**
 * The day figures of the moved token that other sources state — the
 * catalogue's change and the candles' day move — unsigned, with the
 * citations they stand on. One that prints as the head's own figure is the
 * head's, whoever states it: a model saying it is not saying a second figure.
 */
function secondFigures(packet: AnswerPacket, lead: MoveLead | null): Readonly<{ figures: number[]; cites: Set<string>; head: readonly number[] }> {
  const out = { figures: [] as number[], cites: new Set<string>(), head: lead?.figure == null ? ([] as number[]) : [...printed(lead.figure)] };
  if (!lead || lead.window !== "24h") return out;
  const refs = new Map(packet.citations.list().map((cite) => [cite.id, cite.ref] as const));
  /* The head prints to two decimals: only a figure that prints the same there is the head's own. */
  const head = lead.figure === null ? null : Math.round(lead.figure * 100) / 100;
  for (const run of packet.runs) {
    for (const fact of run.facts) {
      if ((fact.key !== "change24h" && fact.key !== "candles.change") || fact.number === null || refs.get(fact.cite) !== lead.mint) continue;
      const value = Math.abs(fact.number);
      out.cites.add(fact.cite);
      if (head !== null && Math.round(value * 100) / 100 === head) continue;
      out.figures.push(value);
    }
  }
  return out;
}

/**
 * Whether a model's sentence says another source's figure of the day's move
 * beside the head: it states one of those figures and stands on their source,
 * or on nothing of the move's own (DexScreener, the move's lines). Only in
 * the observation and its meaning — a holder's share elsewhere that happens to
 * be the same number is not the move.
 */
function saysSecondFigure(section: Section, text: string, cites: readonly string[], second: ReturnType<typeof secondFigures>, packet: AnswerPacket): boolean {
  if (second.figures.length === 0 || (section !== "observation" && section !== "meaning") || !statesPercent(text, second.figures, second.head)) return false;
  const tools = new Map(packet.citations.list().map((cite) => [cite.id, cite.tool] as const));
  const ownSource = cites.some((id) => tools.get(id) === "price_move_read" || tools.get(id) === "dex_pairs_read");
  return cites.some((id) => second.cites.has(id)) || !ownSource;
}

const PERCENT = /(\d[\d,  ]*(?:[.,]\d+)?)\s?%/g;

/** Whether a sentence states one of these percentages, as printed (to one or two decimals) — a form the head also prints as (`except`) is the head's, not theirs. */
function statesPercent(text: string, figures: readonly number[], except: readonly number[] = []): boolean {
  if (figures.length === 0) return false;
  for (const match of text.matchAll(PERCENT)) {
    const value = normalise(match[1]);
    if (value === null) continue;
    if (except.some((form) => Math.abs(form - value) < 1e-9)) continue;
    if (figures.some((figure) => [figure, ...printed(figure)].some((form) => Math.abs(form - value) < 1e-9))) return true;
  }
  return false;
}

/**
 * The move's head first in the observation, said once. The section keeps its
 * limit by letting go of the last sentence that is not a report — the first
 * report is kept, as the composer promises, so «whether that news moved the
 * price is unknown» never points at nothing.
 */
function withLead(answer: AgentAnswer, lead: MoveLead | null, packet: AnswerPacket): AgentAnswer {
  if (!lead) return answer;
  const head = toBlocks(lead.sentence);
  const reports = new Set(packet.runs.flatMap((run) => run.notes.filter((note) => note.quote).flatMap((note) => note.cites)));
  const observation = [...head, ...answer.observation.filter((sentence) => !head.some((block) => block.text === sentence.text))];
  while (observation.length > LIMITS.observation) {
    let at = -1;
    for (let i = observation.length - 1; i >= head.length; i -= 1) if (!observation[i].cites.some((id) => reports.has(id))) { at = i; break; }
    observation.splice(at >= 0 ? at : observation.length - 1, 1);
  }
  return { ...answer, observation };
}

export function composeDeterministic(packet: AnswerPacket): AgentAnswer {
  /* A headline that commands or advises a trade is not said, even attributed — the feeds' screen keeps them out, and this keeps them out again. */
  /*
   * The marked lines of «what moved the price?» are the move card's own; the
   * composed answer does not say them twice — but keeps the first report and
   * every «unknown», so a client that draws no card still reads what was
   * reported and that the cause is not known.
   */
  const lead = moveLead(packet.runs);
  const all = answerNotes(packet, lead);
  const firstReport = all.find((note) => note.mark === "unverified") ?? null;
  const notes = all.filter((note) => !note.mark || note.mark === "unknown" || note === firstReport);
  const refusal = WITHOUT_FILLER.includes(packet.intent.class);
  const insufficient = !refusal && insufficientData(packet.runs);
  const fallback = refusal ? {} : defaults(packet.intent.class, packet.locale, insufficient);
  const answer: AgentAnswer = { observation: [], meaning: [], counter: [], risks: [], checks: [], actions: [], insufficient };
  for (const section of AGENT_ANSWER_SECTIONS) {
    const own = sentences(notes, section);
    if (own.length > 0) answer[section] = asBlocks(own, section);
    else if (fallback[section]) answer[section] = asBlocks([{ text: fallback[section]!, cites: [] }], section);
  }
  sayUnavailable(answer, packet);
  return AgentAnswerSchema.parse(withLead(answer, lead, packet));
}

/** The unavailable reads are said in the risks, once each, so nothing missing is silent — in a composed answer and in a model's alike. */
function sayUnavailable(answer: AgentAnswer, packet: AnswerPacket): void {
  const uk = packet.locale === "uk";
  /*
   * AI-03: each read that did not answer — by the tool's own sentence about
   * what it missed when it wrote one, else by the source as a person names it,
   * never the tool's own name — judged against what the answer's risks
   * actually hold: a model that wrote risks of its own does not silence a
   * source. When the list has no room for each, the missing sources share one
   * sentence, and it takes the place of the last risk no tool wrote.
   */
  const missing: { source: string; sentence: AgentSentence }[] = [];
  for (const run of packet.runs) {
    if (run.outcome !== "unavailable") continue;
    const own = run.notes.find((note) => note.section === "risks") ?? null;
    const words = TOOL_SOURCE_WORDS[run.tool];
    const source = words ? words[uk ? 1 : 0] : w(packet.locale, "one of the sources", "одне з джерел");
    const sentence: AgentSentence = own
      ? { text: own.text.trim(), cites: [...new Set(own.cites)].filter((id) => packet.citations.has(id)).slice(0, 6) }
      : { text: w(packet.locale, `${source[0].toUpperCase()}${source.slice(1)} did not answer; what it would have said is missing here, not zero.`, `Джерело «${source}» не відповіло; те, що воно сказало б, тут відсутнє, а не дорівнює нулю.`), cites: [] };
    const head = sentence.text.slice(0, 60);
    if (answer.risks.some((said) => said.text.startsWith(head) || sentence.text.startsWith(said.text.slice(0, 60)))) continue;
    if (missing.some((entry) => entry.source === source)) continue;
    missing.push({ source, sentence });
  }
  if (missing.length === 0) return;
  const blocks = missing.flatMap((entry) => toBlocks(entry.sentence));
  if (answer.risks.length + blocks.length <= LIMITS.risks) {
    answer.risks.push(...blocks);
    return;
  }
  const names = missing.map((entry) => entry.source);
  const merged: AgentSentence = {
    text: uk
      ? `${names.length === 1 ? `Джерело «${names[0]}» не відповіло` : `Джерела ${names.map((name) => `«${name}»`).join(", ")} не відповіли`}; того, що вони сказали б, тут немає, і це не нуль.`
      : `${(() => {
          const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
          return `${list[0].toUpperCase()}${list.slice(1)}`;
        })()} did not answer; what ${names.length === 1 ? "it" : "they"} would have said is missing here, not zero.`,
    cites: [...new Set(missing.flatMap((entry) => entry.sentence.cites))].slice(0, 6),
  };
  const toolRisks = new Set(packet.runs.flatMap((run) => run.notes.filter((note) => note.section === "risks").map((note) => note.text.trim().slice(0, 60))));
  /* The places the merged sentence takes, found once: free ones first, then the last risks no tool wrote — a tool's own risk only when nothing else is left. */
  const blocks2 = toBlocks(merged);
  const free = Math.max(0, LIMITS.risks - answer.risks.length);
  const taken: number[] = [];
  for (let i = answer.risks.length - 1; i >= 0 && taken.length < blocks2.length - free; i -= 1) if (!toolRisks.has(answer.risks[i].text.slice(0, 60))) taken.unshift(i);
  for (let i = answer.risks.length - 1; i >= 0 && taken.length < blocks2.length - free; i -= 1) if (!taken.includes(i)) taken.unshift(i);
  const keep = answer.risks.filter((_, i) => !taken.includes(i));
  answer.risks.splice(0, answer.risks.length, ...keep, ...blocks2.slice(0, LIMITS.risks - keep.length));
}

/* ------------------------------------------------------------ the verifier */

const NUMBER = /\d[\d,  ]*(?:[.,]\d+)?/g;

function normalise(token: string): number | null {
  const cleaned = token.replace(/[\s ]/g, "").replace(/,(?=\d{3}(?:\D|$))/g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/** Every figure the answer may state: the tools' numbers and their printed forms, the tools' sentences, the person's own words, and the format's structural numbers. */
export function allowedNumbers(packet: AnswerPacket): Set<number> {
  return allowedFromRuns(packet.runs, packet.personText);
}

/**
 * The same rule without a conversation: every figure the tools stated and
 * the format's own structural numbers. The Brief and the Critic hold a
 * model to this list exactly as the six-section answer does.
 */
export function allowedFromRuns(runs: readonly ToolRun[], extraText = ""): Set<number> {
  const allowed = new Set<number>([1, 2, 3, 4, 5, 6, 7, 10, 24, 30, 100]);
  const take = (text: string) => {
    for (const match of text.matchAll(NUMBER)) {
      const value = normalise(match[0]);
      if (value !== null) allowed.add(value);
    }
  };
  for (const run of runs) {
    for (const fact of run.facts) {
      if (fact.number !== null) {
        allowed.add(fact.number);
        allowed.add(Math.round(fact.number * 100) / 100);
      }
      take(fact.value);
    }
    /* A headline's figures are the publication's, not a read: they hold only the sentence that cites it (`quotedNumbers`). */
    for (const note of run.notes) if (!note.quote) take(note.text);
    for (const card of run.cards) {
      if ("figures" in card) for (const figure of card.figures) take(figure.value);
      if (card.kind === "holdings") for (const row of card.rows) take(row.amount);
    }
  }
  if (extraText) take(extraText);
  return allowed;
}

/** AI-09: the figures each headline printed, by the citation it carries. */
function quotedNumbers(runs: readonly ToolRun[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const run of runs) {
    for (const note of run.notes) {
      if (!note.quote) continue;
      for (const cite of note.cites) {
        const set = out.get(cite) ?? new Set<number>();
        for (const match of note.text.matchAll(NUMBER)) {
          const value = normalise(match[0]);
          if (value !== null) set.add(value);
        }
        out.set(cite, set);
      }
    }
  }
  return out;
}

function figuresAllowed(text: string, allowed: Set<number>): boolean {
  for (const match of text.matchAll(NUMBER)) {
    const value = normalise(match[0]);
    if (value === null) continue;
    let ok = allowed.has(value);
    if (!ok) {
      for (const candidate of allowed) {
        if (candidate !== 0 && Math.abs(candidate - value) / Math.abs(candidate) <= 0.005) {
          ok = true;
          break;
        }
      }
    }
    if (!ok) return false;
  }
  return true;
}

/* A Unicode-aware end: a word boundary sees none after a Cyrillic word, so «Купи SOL» once passed as a sentence. */
const COMMANDS = /^\s*(buy|sell|swap|send|transfer|approve|go long|go short|ape|dump|купи|купіть|продай|продайте|обміняй|обміняйте|відправ|відправте|заходь|виходь|докупи|докупіть|купуй|купуйте|продавай|продавайте|докуповуй|тримай|фіксуй)(?![\p{L}\p{N}_])/iu;

/**
 * Personal advice anywhere in a sentence, in any section: «you should buy»,
 * «I'd sell», «раджу купити», «тобі варто продати». A question that weighs
 * («чи варто тобі купувати») and a negation («не раджу») are not advice.
 */
const ADVICE = /(?<![\p{L}])(?:(?<!\b(?:which|whether|what|not|never)\b[^.!?]{0,40})(?:you should|you must|you'd better|i would|i'd|i recommend(?: you)?|i suggest(?: you)?)\s+(?:buy|sell|short|long|ape|dump|hold|exit|enter)|(?:consider|start) (?:buying|selling|shorting)|(?:good|great|right|best) (?:time|moment|entry) to (?:buy|sell|enter|exit)|take (?:some )?profits?|load up on|(?<!(?:не|чи)\s)(?:раджу|рекомендую|тобі варто|тобі слід|тобі треба|тобі краще)\s+(?:купити|продати|докупити|тримати|заходити|виходити|зафіксувати)|(?<!(?:не|чи)\s)(?:варто|слід|треба|краще)\s+(?:купити|продати|докупити)|(?:^|[,;:—–]\s*)(?:купи|продай|докупи|заходь|виходь|купуй|продавай|докуповуй|тримай)(?![\p{L}]))/iu;

/** AI-09: a link in a model's words — no answer of Ryntra's carries one; a source's link lives on its card. */
const LINK = /(?:https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(?:com|io|xyz|co|net|org|app|finance|fi|gg|me)\b\/)/i;
/** AI-09: the assistant is Ryntra to a person — never «Ryn», whatever a text asked it to be called. */
const PERSONA = /(?<![\p{L}\p{N}])ryn(?![\p{L}\p{N}])/iu;

/** AI-09: a sentence shaped like an order to a program or a sales line — the feeds' own screen, the product's own name allowed. */
/** Every run of five words of the headlines, lower case — a sentence that repeats one carries the headline, cited or not. */
function shinglesOf(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    const words = text.toLowerCase().split(/[^\p{L}\p{N}$]+/u).filter(Boolean);
    for (let i = 0; i + 5 <= words.length; i += 1) out.add(words.slice(i, i + 5).join(" "));
  }
  return out;
}

function echoes(text: string, shingles: Set<string>): boolean {
  if (shingles.size === 0) return false;
  const words = text.toLowerCase().split(/[^\p{L}\p{N}$]+/u).filter(Boolean);
  for (let i = 0; i + 5 <= words.length; i += 1) if (shingles.has(words.slice(i, i + 5).join(" "))) return true;
  return false;
}

function steers(text: string): boolean {
  return steersOrSells(text);
}

/** AI-03: the product's own vocabulary a person must never read — the instruction forbids it, and a sentence that still carries it is dropped. */
const INTERNAL_WORDS = /(?<![\p{L}])(packet|citation ids?|tool calls?|tool outputs?|пакет(?:і|у|ом)? даних|у пакеті|ідентифікатор(?:и|ів)? цитат)(?![\p{L}])/iu;

/*
 * AI-06a: a citation's id written into the words — «… UTC. c3», «[c4]», «citec1», «(c1, c2)» — is the engine's
 * bookkeeping, and it reached people on production. An id the packet knows moves out of the text into the sentence's
 * citations; an id it does not know leaves the text as it is.
 */
/* Ids may stand with commas, with spaces or glued together («c1c2», seen on production after the first fix). */
const CITE_GROUP = String.raw`(?:[Cc]ite[ \t:]*)?(c\d{1,3}(?:[ \t]*[,;]?[ \t]*(?:[Cc]ite[ \t:]*)?c\d{1,3})*)`;
/* Only where an id cannot be a word of the sentence: alone in brackets, or the sentence's last word. */
const CITE_BRACKETED = new RegExp(String.raw`[ \t]*[[(][ \t]*${CITE_GROUP}[ \t]*[\])]`, "gu");
const CITE_TRAILING = new RegExp(String.raw`[ \t]*(?<![\p{L}\p{N}\-–])${CITE_GROUP}[ \t]*([.!?]?)[ \t]*$`, "u");

export function liftCiteIds(text: string, known: (id: string) => boolean): Readonly<{ text: string; ids: readonly string[] }> {
  const ids: string[] = [];
  const take = (group: string): boolean => {
    const found = (group.toLowerCase().match(/c\d{1,3}/g) ?? []).filter((id, index, all) => all.indexOf(id) === index);
    if (!found.every(known)) return false;
    ids.push(...found);
    return true;
  };
  let out = text.replace(CITE_BRACKETED, (whole: string, group: string) => (take(group) ? "" : whole));
  out = out.replace(CITE_TRAILING, (whole: string, group: string, stop: string) => (take(group) ? stop : whole));
  if (ids.length === 0) return { text, ids };
  return { text: out.replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim(), ids };
}

/** `kept` — the model's own sentences that stood (AI-04: credits are kept only when one did). */
export type Verification = Readonly<{ answer: AgentAnswer; dropped: number; fellBack: readonly Section[]; kept: number }>;

/**
 * A model's answer held to the reads. Unknown citations, figures no source
 * read, and commands to trade are dropped. A section the model left empty
 * stays empty — but the observation, which takes the tools' own cited
 * sentences; a section whose every sentence was dropped takes the tools'
 * own cited sentences for it, never a generic one. The result always parses.
 */
export function verifyAnswer(draft: AgentAnswer, packet: AnswerPacket): Verification {
  const allowed = allowedNumbers(packet);
  const quoted = quotedNumbers(packet.runs);
  const quoteShingles = shinglesOf(packet.runs.flatMap((run) => run.notes.filter((note) => note.quote).map((note) => note.text)));
  const lead = moveLead(packet.runs);
  const notes = answerNotes(packet, lead);
  /* AI-21: beside the move's head, a model's sentence that states another source's figure of the same day's move, or says the head again on its own citation, is not kept. */
  const second = secondFigures(packet, lead);
  const restatesHead = (section: Section, text: string, cites: readonly string[]) => lead !== null && section === "observation" && cites.length > 0 && cites.every((id) => lead.sentence.cites.includes(id)) && lead.figure !== null && statesPercent(text, [lead.figure]);
  let dropped = 0;
  let keptTotal = 0;
  const fellBack: Section[] = [];
  /*
   * AI-03: «not enough data» is the reads' to say, not the model's. A model
   * that cannot name a move's cause says so in words — and still stands on
   * the figures it was given; a label of «insufficient» over an answer full of
   * cited figures was what a person saw beside «why is SOL moving?».
   */
  const out: AgentAnswer = { observation: [], meaning: [], counter: [], risks: [], checks: [], actions: [], insufficient: insufficientData(packet.runs) };
  for (const section of AGENT_ANSWER_SECTIONS) {
    const kept: AgentSentence[] = [];
    for (const sentence of draft[section].slice(0, LIMITS[section])) {
      const lifted = liftCiteIds(sentence.text.trim(), (id) => packet.citations.has(id));
      const cites = [...new Set([...sentence.cites, ...lifted.ids])].filter((id) => packet.citations.has(id)).slice(0, 6);
      const citesUnknown = sentence.cites.some((id) => !packet.citations.has(id));
      /* A sentence that was nothing but an id is no sentence. */
      const text = /[\p{L}\p{N}]/u.test(lifted.text) ? lifted.text.slice(0, 400) : "";
      /* AI-09: a headline's figures, for a sentence that cites that headline and no other. */
      /* A headline's figures only in a sentence that cites headlines and nothing else — never a publication's number dressed in a read's citation. */
      const own = cites.length > 0 && cites.every((id) => quoted.has(id)) ? new Set([...allowed, ...cites.flatMap((id) => [...(quoted.get(id) ?? [])])]) : allowed;
      /* The feeds' screen holds a sentence that carries a headline — by its citation or by its words — and no other: «never share your seed phrase» is Ryntra's own advice. */
      const carriesQuote = cites.some((id) => quoted.has(id)) || echoes(text, quoteShingles);
      /* A command or personal advice is dropped in every section, not only among the next steps. */
      /* The head said again is the head — not a dropped sentence of the model's. */
      if (restatesHead(section, text, cites)) continue;
      if (text.length === 0 || citesUnknown || saysSecondFigure(section, text, cites, second, packet) || !figuresAllowed(text, own) || COMMANDS.test(text) || ADVICE.test(text) || INTERNAL_WORDS.test(text) || LINK.test(text) || PERSONA.test(text) || ordersAProgram(text) || (carriesQuote && steers(text))) {
        dropped += 1;
        continue;
      }
      kept.push({ text, cites });
    }
    if (kept.length > 0) {
      keptTotal += kept.length;
      out[section] = asBlocks(kept, section);
      continue;
    }
    /*
     * The tools' own sentences — a cited fact, a transfer fee withheld, a
     * lifecycle that is not open, a copy's warning — come back where the
     * model wrote none; the composer's generic register never stands in for
     * a model (AI-01: that was what made a good model read worse).
     */
    const own = sentences(notes, section);
    if (own.length > 0) {
      fellBack.push(section);
      out[section] = asBlocks(own, section);
    }
  }
  sayUnavailable(out, packet);
  return { answer: AgentAnswerSchema.parse(withLead(out, lead, packet)), dropped, fellBack, kept: keptTotal };
}

/*
 * AI-06c: the bounds a talk is held to beyond every answer's — it stands on no read, so its words are the only thing
 * between a model and a person. Two layers (the critic's five rounds, `lib/assistant/talk-ai06c.test.mjs`):
 *
 * here, the shapes a word list catches without catching education with them — a figure, a link or a domain, a
 * contact, a secret asked for, custody claimed, a deed claimed, a definite forecast, a token named (a talk names none:
 * its questions are the server's buttons; SOL may be said only in a definition of it); and then, for what a list
 * cannot close in both directions — advice in any mood, a forecast or a call on timing, a safety claim in other
 * words — the everyday model's own yes/no on each sentence against a fixed rubric (`model.ts`, `judgeTalk`), which
 * the service asks before a word reaches the person. A sentence the judge flags, or a reply it could not judge, is
 * not said.
 */
const FORECAST_DEFINITE = new RegExp(
  String.raw`(?<![\p{L}])(?:(?:will|going to|gonna|(?:is|are) about to|about to|set to|expected to|poised to)\s+(?:\p{L}+\s+)?(?:rise|fall|drop|pump|dump|moon|crash|go up|go down|climb|surge|rally|recover|explode|skyrocket|soar|double|triple)|to the moon|price target|new (?:all[- ]time )?highs?|\d+\s?x(?![\p{L}])|(?:ten|hundred|thousand)[- ]?x|(?:зросте|виросте|подорожчає|подешевшає|впаде|обвалиться|полетить|полетять|стрельне|відскочить|піде вгору|піде вниз|буде рости|буде падати|ростиме|зростатиме|падатиме|дорожчатиме|дешевшатиме|подвоїться|потроїться|злетить)|нов(?:их|і|ого) максимум\p{L}*)(?![\p{L}])`,
  "iu",
);
/* SOL in a definition of it: a direction, a verdict or a sum on it — the talk read nothing to judge it by. */
const NAMED_VERDICT = new RegExp(
  String.raw`(?<![\p{L}])(?:(?:will|would|could|may|might|can|should|може|можуть|буде|будуть)\s+(?:\p{L}+\s+)?(?:rise|fall|climb|rally|double|triple|hit|reach|grow|go up|go down|be worth|зрости|вирости|впасти|подвоїти\p{L}*|рости|падати|коштувати)|expect\p{L}*|poised|heading|set for|bound to|rising|falling|gains?|upside|downside|bull\p{L}*|bear\p{L}*|potential|promising|undervalued|overvalued|cheap|bargain|must[- ]have|worth (?:it|buying|a lot)|big|moon|heights|regret|good (?:idea|time|buy|entry|investment)|time for|get into|consider|bag|flying|strong|hot\p{L}*|trend\p{L}*|early|bought|buy\p{L}*|sell\p{L}*|sold|invest\p{L}*|dollars?|usd|percent|%|ще покаже|очіку\p{L}*|потенціал\p{L}*|перспектив\p{L}*|недооцін\p{L}*|переоцін\p{L}*|дешев\p{L}*|вигідн\p{L}*|гарна ідея|купи\p{L}*|купу\p{L}*|прода\p{L}*|інвест\p{L}*|долар\p{L}*|відсот\p{L}*)(?![\p{L}])`,
  "iu",
);
/* The network by its name — «ринок Solana», «Solana is a blockchain» — is the place, not a token to judge; no verdict on it here either. */
const NETWORK_VERDICT = /(?<![\p{L}])(?:upside|downside|bullish|bearish|potential|promising|undervalued|overvalued|bargain|must[- ]have|heading (?:higher|up)|poised|moon|heights|gains|потенціал\p{L}*|перспективн\p{L}*|недооцін\p{L}*|вигідн\p{L}*)(?![\p{L}])/iu;
/* A hurry: «don't miss out», «не пропусти», «поки не пізно». */
const FOMO = /(?<![\p{L}])(?:miss out|fomo|too late|don'?t wait|last chance|before it'?s gone|не пропусти\p{L}*|не проґав\p{L}*|поки не пізно|останній шанс|не чекай)(?![\p{L}])/iu;
/* A claim that something was done: «your order is placed», «ордер розміщено», «I bought», «I'll send», «rebalances your wallet». */
const DONE = /(?<![\p{L}])(?:(?:your|the|твій|твоя|твоє|ваш)\s+(?:order|swap|trade|transaction|transfer|ордер|обмін|угода|угоду|транзакція|переказ)\s+(?:\p{L}+\s+)?(?:(?:is|was|has been)\s+)?(?:placed|executed|filled|sent|done|completed|розміщено|виконано|надіслано|відправлено|виконан\p{L}*|розміщен\p{L}*)|(?:order|trade|swap|ордер|угоду|обмін|транзакцію)\s+(?:розміщено|виконано|надіслано|відправлено|placed|executed|filled|sent)|(?:i|we|ryntra|я|ми)(?:\s+|['’]ve\s+)(?:have\s+|already\s+|just\s+|уже\s+|вже\s+)?(?:bought|sold|swapped|sent|signed|placed|executed|transferred|secured|купила|продала|обміняла|надіслала|підписала|розмістила|виконала|переказала)|(?:i'll|i'm going to|i am going to|i will|я зараз)\s+(?!(?:never|not|не|ніколи)(?![\p{L}]))(?:\p{L}+\s+)?(?:send|buy|sell|swap|sign|place|execute|transfer|надішлю|куплю|продам|обміняю|підпишу)|rebalanc\p{L}*|ребаланс\p{L}*|куплено|продано|обміняно|підписано|переказано)(?![\p{L}])/iu;
/* A contact to write to — a phishing shape: «@ryntra_support», «telegram at …», «ryntra_bot». */
const CONTACT = /@[A-Za-z0-9_]{3,}|(?<![\p{L}\p{N}])[a-z0-9]+_(?:bot|support|help|admin)(?![\p{L}\p{N}])|(?<![\p{L}])(?:telegram|discord|whatsapp|(?:on|in|via|the) signal(?: app)?|signal app|dm me|direct message|телеграм\p{L}*|діскорд\p{L}*|напиши в підтримку|support team)(?![\p{L}])/iu;
/* The instructions behind the reply are not the person's to read: «my instructions say…»; nor are words meant for the judge — a sentence for a person never speaks to a checker. */
const TALK_LEAK = /(?<![\p{L}])(?:my instructions|my prompt|system prompt|i was told to|i'?m instructed|мої інструкції|мені наказано|системн\p{L}* промпт|за інструкцією|checker|judge|verdict|rubric|rule none|rule: none|перевіряльник\p{L}*|перевіряюч\p{L}*|вердикт\p{L}*|рубрик\p{L}*)(?![\p{L}])/iu;
/* A secret is never asked for; only the warning never to share one may name it — and a warning with an exception («except with support») is the phishing shape itself. */
const SECRET_WORDS = /(?<![\p{L}])(?:seed(?: phrase)?|сід\p{L}*|mnemonic|мнемонік\p{L}*|private key|приватн\p{L}* ключ\p{L}*|password|парол\p{L}*|recovery phrase|secret phrase|фраз\p{L}* відновлення|секретн\p{L}* фраз\p{L}*)(?![\p{L}])/iu;
const NEVER_SHARE = /(?<![\p{L}])(?:never|ніколи|не|nobody|ніхто|no one)\s+(?:\p{L}+\s+){0,3}(?:share|give|send|tell|enter|type|ask|надсилай|кажи|давай|вводь|показуй|діли\p{L}*|проси\p{L}*|питає|попросить)(?![\p{L}])/iu;
const EXCEPTION = /(?<![\p{L}])(?:except|only|but|unless|other than|крім|окрім|лише|тільки|за винятком|хіба)(?![\p{L}])/iu;
/* Custody and safety claimed, or a wallet connected through someone's link — Ryntra holds no funds and no keys. */
const CUSTODY = /(?<![\p{L}])(?:safe with (?:me|us|ryntra)|protected by ryntra|під захистом ryntra|(?:ryntra|i|we|я|ми)(?:\s+|['’]ve\s+)(?:\p{L}+\s+){0,2}(?:keeps?|stores?|holds?|protects?|guards?|secures?|secured|зберіга\p{L}*|захища\p{L}*|трима\p{L}*|береж\p{L}*|бере\p{L}*)\s+(?:\p{L}+\s+){0,2}(?:funds|money|keys|wallets?|seed|savings|coins|кошт\p{L}*|грош\p{L}*|ключ\p{L}*|гаман\p{L}*|сід\p{L}*|монет\p{L}*)|keep your (?:funds|keys|money|wallet) safe|(?:в|у) безпеці (?:зі мною|у мене|з ryntra|у ryntra)|твої кошти в безпеці|connect (?:your )?wallet (?:at|via|through|on|using) |the link i (?:gave|sent)|via the link|за посиланням|підключи гаманець (?:за|на|через))/iu;
/* Personal advice with words between: «you should definitely buy», «я б купила», «варто придбати», «я раджу взяти». */
const TALK_ADVICE = new RegExp(
  String.raw`(?<![\p{L}])(?:(?:you|u)\s+(?:should|must|ought to)\s+(?:\p{L}+\s+){0,2}(?:buy|sell|short|ape|dump|grab|accumulate)|(?:я|ryntra)\s+б(?:и)?\s+(?:на твоєму місці\s+)?(?:купила|купив|продала|продав|взяла|взяв|докупила)|(?<!не\s)раджу\s+(?:\p{L}+\s+)?(?:купити|продати|взяти|придбати|тримати)|(?:варто|слід|треба|краще)\s+(?:\p{L}+\s+)?(?:придбати|купити|продати|докупити|закупитися))(?![\p{L}])`,
  "iu",
);
/* A figure written in words is a figure too: «ten thousand transactions per second», «сотні доларів». */
const WORD_FIGURE = /(?<![\p{L}])(?:hundreds?|thousands?|millions?|billions?|trillions?|per second|сотн\p{L}*|сот(?:ні|ень)|тисяч\p{L}*|мільйон\p{L}*|мільярд\p{L}*|трильйон\p{L}*|за секунду)(?![\p{L}])/iu;
/* A domain without a path is a link too in a talk: «jup.ag», «pump.fun», «t.me». */
const TALK_DOMAIN = /(?<![\p{L}\p{N}])[a-z0-9-]+\.(?:com|io|xyz|ag|fun|so|fi|app|finance|net|org|gg|me|ai|exchange|trade|money)(?![\p{L}\p{N}])|(?<![\p{L}])(?:dot (?:com|io|ag|me|fun))(?![\p{L}])/iu;
/* A claim Ryntra trades: «Ryntra can sign trades», «я можу купити»; «never», «not» and «не» after the modal do not match. */
const TALK_CAPABILITY = /(?<![\p{L}])(?:ryntra|i|я|вона)\s+(?:can|will|could|automatically|може|можу|буду|сама)\s+(?!(?:never|not|не|ніколи)(?![\p{L}]))(?:\p{L}+\s+)?(?:sign|send|buy|sell|swap|trade|execute|place|move your|підпис\p{L}*|надісл\p{L}*|надсила\p{L}*|купи\p{L}*|прода\p{L}*|обмін\p{L}*|торгу\p{L}*|викона\p{L}*|переказ\p{L}*)(?![\p{L}])/iu;

/* «Ryntra holds no funds and no keys» is the truth said; «Ryntra keeps your funds» is not. */
const NEGATION = /(?<![\p{L}])(?:no|neither|never|not|none|doesn't|don't|ні|не|жодн\p{L}*|ніколи)(?![\p{L}])/iu;
function claimsCustody(text: string): boolean {
  const found = CUSTODY.exec(text);
  return found !== null && !NEGATION.test(found[0]);
}

/**
 * The tokens a sentence of a talk names — a dollar stablecoin is money, not a subject; a term of crypto (MEV, AMM) is
 * a word to explain; Solana, Bitcoin and Ethereum by their names are networks.
 */
function namedIn(text: string): Readonly<{ tokens: readonly string[]; network: boolean }> {
  const symbols = extractSymbols(text).filter((symbol) => !/^(USDC|USDT|USD)$/i.test(symbol) && !CRYPTO_TERMS.has(symbol.toUpperCase()));
  const ticker = /(?<![A-Za-z0-9$])\$?SOL(?![A-Za-z0-9])/.test(text);
  /* «Біткоїн» is read as BTC: by its name it is the network; written as the ticker it is a token. */
  const named = (symbol: string) => symbol in NETWORK_TICKERS && !new RegExp(`(?<![A-Za-z0-9$])[$]?${symbol}(?![A-Za-z0-9])`).test(text);
  const networks = symbols.filter((symbol) => NETWORK_NAMES.has(symbol.toUpperCase()) || (symbol === "SOL" && !ticker) || named(symbol));
  return { tokens: symbols.filter((symbol) => !networks.includes(symbol)), network: networks.length > 0 };
}

/**
 * `kept` — the reply's blocks that stood; `firstBlocks` — how many of them are the first sentence, the answer itself;
 * `answered` — the first sentence stood; `dropped` — the model's sentences that did not.
 */
export type TalkVerification = Readonly<{ kept: readonly string[]; firstBlocks: number; answered: boolean; dropped: number }>;

/**
 * AI-06c: the first layer over a talk's reply — the shapes a list holds without
 * dropping education: the bounds of every answer (a command, personal advice,
 * a link, another name for the assistant, the engine's words, a figure the
 * person did not write) and a talk's own: a figure in words, a domain, a
 * contact, a secret asked for or allowed «except», custody or a deed claimed,
 * a definite forecast, a claim that Ryntra trades, its instructions quoted, a
 * hurry, a token named (SOL only in a definition of it, with no verdict). The
 * judge (`judgeTalk`) takes what stands here.
 */
export function verifyTalk(reply: readonly string[], personText: string, kind: "greeting" | "thanks" | "about" | "concept" | "chat" = "chat"): TalkVerification {
  /* Only the person's own figures: the answer's structural numbers (10, 100 …) would let «10x» through. */
  const allowed = new Set<number>();
  for (const match of personText.matchAll(NUMBER)) {
    const value = normalise(match[0]);
    if (value !== null) allowed.add(value);
  }
  const kept: string[] = [];
  let dropped = 0;
  let answered = false;
  let firstBlocks = 0;
  for (const [index, raw] of reply.slice(0, 3).entries()) {
    const text = raw.replace(/[*_#`]+/g, "").replace(/\s+/g, " ").trim().slice(0, 400);
    const named = namedIn(text);
    const solanaDefinition = kind === "concept" && named.tokens.every((symbol) => symbol === "SOL");
    const fails =
      !/[\p{L}]/u.test(text) ||
      !figuresAllowed(text, allowed) ||
      COMMANDS.test(text) ||
      ADVICE.test(text) ||
      TALK_ADVICE.test(text) ||
      FORECAST_DEFINITE.test(text) ||
      WORD_FIGURE.test(text) ||
      TALK_DOMAIN.test(text) ||
      TALK_CAPABILITY.test(text) ||
      INTERNAL_WORDS.test(text) ||
      LINK.test(text) ||
      PERSONA.test(text) ||
      ordersAProgram(text) ||
      FOMO.test(text) ||
      DONE.test(text) ||
      CONTACT.test(text) ||
      TALK_LEAK.test(text) ||
      (SECRET_WORDS.test(text) && (!NEVER_SHARE.test(text) || EXCEPTION.test(text))) ||
      claimsCustody(text) ||
      (named.tokens.length > 0 && (!solanaDefinition || NAMED_VERDICT.test(text))) ||
      (named.network && NETWORK_VERDICT.test(text));
    if (fails) {
      dropped += 1;
      continue;
    }
    const blocks = toBlocks({ text, cites: [] }).map((block) => block.text);
    if (index === 0) {
      answered = true;
      firstBlocks = blocks.length;
    }
    kept.push(...blocks);
  }
  return { kept: kept.slice(0, 4), firstBlocks: Math.min(firstBlocks, 4), answered, dropped };
}

/** One line for the turn's `text`: what the answer is about. */
export function headline(packet: AnswerPacket): string {
  const locale = packet.locale;
  const symbols = packet.intent.symbols.slice(0, 2).join(", ");
  switch (packet.intent.class) {
    case "market":
    case "stock":
      return w(locale, `About ${symbols || "the market"}`, `Про ${symbols || "ринок"}`);
    case "evidence":
      return w(locale, `Evidence on ${symbols || "the asset"}`, `Докази щодо ${symbols || "активу"}`);
    case "portfolio":
      return w(locale, "Your holdings", "Твої активи");
    case "plans":
      return w(locale, "Your plans", "Твої плани");
    case "plan":
      return w(locale, `Your ${symbols || ""} plan`.replace(/\s+/g, " "), `Твій план ${symbols || ""}`.trim());
    case "results":
      return w(locale, "Plan vs Actual", "План проти факту");
    case "monitoring":
      return w(locale, "What Monitoring found", "Що знайшов Нагляд");
    case "compare":
      return w(locale, `Comparison: ${packet.intent.compare.join(" · ")}`, `Порівняння: ${packet.intent.compare.join(" · ")}`);
    case "prepare_plan":
      return w(locale, `A plan draft on ${symbols || "the asset"}`, `Чернетка плану на ${symbols || "актив"}`);
    case "prepare_monitoring":
      return w(locale, "A monitoring rule draft", "Чернетка правила Нагляду");
    case "prepare_trade":
      return w(locale, `A trade draft on ${symbols || "the asset"}`, `Чернетка угоди на ${symbols || "актив"}`);
    case "execute":
      return w(locale, "Ryntra does not execute — prepared for Review", "Ryntra не виконує — підготовлено для Review");
    case "secret":
      return w(locale, "Ryntra does not share that", "Ryntra цього не розкриває");
    case "help":
      return w(locale, "What Ryntra can do", "Що вміє Ryntra");
    default:
      return w(locale, "What Ryntra can answer", "На що Ryntra може відповісти");
  }
}
