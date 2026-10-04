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
 * figure no tool read and the person did not write, is dropped; a section
 * left empty falls back to the deterministic sentences; an action that
 * commands a trade is dropped. Nothing a model wrote reaches a person as a
 * fact unless a tool read it first.
 */

import { AGENT_ANSWER_SECTIONS, AgentAnswerSchema, type AgentAnswer, type AgentQuestionClass, type AgentSentence } from "../api/v1/contract.ts";
import type { Intent } from "./intent.ts";
import type { CitationBook, Locale } from "./provenance.ts";
import type { ToolNote, ToolRun } from "./tools/types.ts";

export type Section = (typeof AGENT_ANSWER_SECTIONS)[number];

const LIMITS: Readonly<Record<Section, number>> = { observation: 8, meaning: 6, counter: 4, risks: 6, checks: 6, actions: 6 };

/** Everything the composer and the verifier see for one exchange. */
export type AnswerPacket = Readonly<{
  intent: Intent;
  personText: string;
  runs: readonly ToolRun[];
  citations: CitationBook;
  locale: Locale;
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

export function composeDeterministic(packet: AnswerPacket): AgentAnswer {
  const notes = packet.runs.flatMap((run) => run.notes);
  const refusal = WITHOUT_FILLER.includes(packet.intent.class);
  const insufficient = !refusal && insufficientData(packet.runs);
  const fallback = refusal ? {} : defaults(packet.intent.class, packet.locale, insufficient);
  const answer: AgentAnswer = { observation: [], meaning: [], counter: [], risks: [], checks: [], actions: [], insufficient };
  for (const section of AGENT_ANSWER_SECTIONS) {
    const own = sentences(notes, section);
    if (own.length > 0) answer[section] = own;
    else if (fallback[section]) answer[section] = [{ text: fallback[section]!, cites: [] }];
  }
  /* The unavailable reads are said in the risks, once each, so nothing missing is silent. */
  for (const run of packet.runs) {
    if (run.outcome === "unavailable" && !answer.risks.some((s) => s.text.includes(run.tool))) {
      if (answer.risks.length < LIMITS.risks) answer.risks.push({ text: w(packet.locale, `The read “${run.tool}” did not answer; what it would have said is missing here, not zero.`, `Читання «${run.tool}» не відповіло; те, що воно сказало б, тут відсутнє, а не дорівнює нулю.`), cites: [] });
    }
  }
  return AgentAnswerSchema.parse(answer);
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
    for (const note of run.notes) take(note.text);
    for (const card of run.cards) {
      if ("figures" in card) for (const figure of card.figures) take(figure.value);
      if (card.kind === "holdings") for (const row of card.rows) take(row.amount);
    }
  }
  if (extraText) take(extraText);
  return allowed;
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

const COMMANDS = /^\s*(buy|sell|swap|send|transfer|go long|go short|ape|dump|купи|продай|обміняй|відправ|заходь|виходь)\b/i;

export type Verification = Readonly<{ answer: AgentAnswer; dropped: number; fellBack: readonly Section[] }>;

/**
 * A model's answer held to the reads. Unknown citations, figures no source
 * read, and commands to trade are dropped; a section left empty takes the
 * deterministic sentences; the result always parses.
 */
export function verifyAnswer(draft: AgentAnswer, packet: AnswerPacket): Verification {
  const allowed = allowedNumbers(packet);
  const deterministic = composeDeterministic(packet);
  let dropped = 0;
  const fellBack: Section[] = [];
  const out: AgentAnswer = { observation: [], meaning: [], counter: [], risks: [], checks: [], actions: [], insufficient: draft.insufficient || deterministic.insufficient };
  for (const section of AGENT_ANSWER_SECTIONS) {
    const kept: AgentSentence[] = [];
    for (const sentence of draft[section].slice(0, LIMITS[section])) {
      const cites = [...new Set(sentence.cites)].filter((id) => packet.citations.has(id)).slice(0, 6);
      const citesUnknown = sentence.cites.some((id) => !packet.citations.has(id));
      const text = sentence.text.trim().slice(0, 400);
      if (text.length === 0 || citesUnknown || !figuresAllowed(text, allowed) || (section === "actions" && COMMANDS.test(text))) {
        dropped += 1;
        continue;
      }
      kept.push({ text, cites });
    }
    if (kept.length === 0 && deterministic[section].length > 0) {
      fellBack.push(section);
      out[section] = deterministic[section];
    } else {
      out[section] = kept;
    }
  }
  return { answer: AgentAnswerSchema.parse(out), dropped, fellBack };
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
