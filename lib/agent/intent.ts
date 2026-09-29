/**
 * What a question is — the intent (`RYN-AGENT-TEXT-001`).
 *
 * One schema, two writers. The deterministic parser below reads the person's
 * words in either language and fills it; a configured model fills the same
 * schema under a strict output format (`model.ts`). Either way the server
 * decides which tools run from the intent — the model never names a tool or
 * an argument of its own, so every argument a tool sees is one this schema
 * validated (the Owner's rule of 2026-09-22 §17).
 *
 * The parser is honest about its reach: it recognises the shapes of the
 * product's own vocabulary — a symbol, a mint, a plan id, a sum, a window —
 * and the verbs that make a question a research, a preparation, a request
 * to execute (refused, then prepared for Review) or a request for a secret
 * (refused). What it cannot place is `unknown`, and the answer says what the
 * agent can do instead of guessing.
 *
 * Pure: no store, no clock, no network.
 */

import { z } from "zod";

import { AGENT_QUESTION_CLASSES, BASE58, PLAN_ID, type AgentContext, type AgentQuestionClass } from "../api/v1/contract.ts";
import { EVIDENCE_METRIC_IDS, EVIDENCE_WINDOWS } from "../evidence/metrics.ts";

const Usd = z.number().finite().positive().max(1_000_000_000);

export const IntentSchema = z
  .object({
    class: z.enum(AGENT_QUESTION_CLASSES),
    /** Symbols the words name, as written (case kept for a ticker like `NVDAx`); resolved by the tools, never trusted as an identity. */
    symbols: z.array(z.string().min(1).max(32)).max(6),
    mints: z.array(z.string().regex(BASE58)).max(4),
    planId: z.string().regex(PLAN_ID).nullable(),
    amounts: z
      .object({
        /** The most the person is willing to lose, USD (`max risk $50`). */
        riskUsd: Usd.nullable(),
        budgetUsd: Usd.nullable(),
        /** A price per unit the person named as the entry. */
        entryUsd: Usd.nullable(),
        /** A price the person refuses to pay above (`refuse an entry above $220`). */
        maxPriceUsd: Usd.nullable(),
        invalidationUsd: Usd.nullable(),
        targetUsd: Usd.nullable(),
        /** The sum of a trade the person named. */
        tradeUsd: Usd.nullable(),
      })
      .strict(),
    window: z.enum(["24h", "7d", "now"]).nullable(),
    /** For a comparison: the two (or more) things compared, as written. */
    compare: z.array(z.string().min(1).max(32)).max(4),
    /** A horizon the person named, in days. */
    horizonDays: z.number().int().min(1).max(3650).nullable(),
    /** Whether the words ask about "this" — the context the session was opened from. */
    refersToContext: z.boolean(),
    /**
     * 1.10.0 (`RYN-BRIEF-CRITIC-001`): the format the words asked for beside
     * the answer — a short Brief, or the Critic's argument against the
     * thesis. It never changes the class or which tools run: the same reads
     * carry the six-section answer and the format, so a client that knows
     * nothing of either still reads a whole answer.
     */
    lens: z.enum(["brief", "critic"]).nullable(),
    /** True when the words ask why something moves or what changed — the flows are read beside the price. */
    movement: z.boolean(),
    /** The side of a trade the words name; null when they name none. */
    side: z.enum(["BUY", "SELL"]).nullable(),
    /** A measurable rule the words state, for a monitoring draft: the registry's metric and window, the direction, the figure in the metric's unit. */
    condition: z
      .object({
        metric: z.enum(EVIDENCE_METRIC_IDS),
        window: z.enum(EVIDENCE_WINDOWS),
        operator: z.enum(["gt", "gte", "lt", "lte"]),
        /** NaN when the words named the metric but no figure; the draft then asks for one. */
        threshold: z.number(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type Intent = z.infer<typeof IntentSchema>;

export const EMPTY_AMOUNTS: Intent["amounts"] = { riskUsd: null, budgetUsd: null, entryUsd: null, maxPriceUsd: null, invalidationUsd: null, targetUsd: null, tradeUsd: null };

/* ------------------------------------------------------------ vocabulary */

type Rule = Readonly<{ class: AgentQuestionClass; any: readonly RegExp[]; weight: number }>;

/**
 * Verbs and nouns, in both languages, by the class they point to. Order does
 * not decide; the weights do, and the refusals weigh most: a question that
 * asks to buy and to explain is first a request to buy, and a question that
 * asks for a key is a request for a key whatever else it asks.
 */
const RULES: readonly Rule[] = [
  {
    class: "secret",
    weight: 100,
    any: [
      /\b(api[ -]?key|secret|private key|seed phrase|mnemonic|password|passphrase|bearer|access token|session token|cookie|\.env|env var|environment variable|system prompt|your (instructions|prompt)|ignore (all |your |previous )?(instructions|rules)|developer mode|jailbreak)\b/i,
      /(апі[ -]?ключ|api[ -]?ключ|секрет|приватн(ий|ого) ключ|сід[ -]?фраз|мнемонік|парол|токен (сесії|доступу)|системн(ий|ого) промпт|тво(ї|їх) інструкці|ігноруй (усі |всі |попередні )?(інструкції|правила))/i,
      /\b(other|another|someone else'?s|their) wallet'?s? (session|plans?|holdings|portfolio|history|conversation)/i,
      /(чуж(ого|ий|і|ої)|інш(ого|ий|ої)) (гаманц|гаманця|сесі|план)/i,
      /(^|[^A-Za-z0-9])\.env(?![A-Za-z0-9])/i,
    ],
  },
  {
    class: "execute",
    weight: 90,
    any: [
      /* An imperative — the verb leads the sentence or follows a polite opener — not a question about buying. */
      /^\s*(?:please\s+|can you\s+|could you\s+|would you\s+|will you\s+|i want (?:you )?to\s+|i'?d like (?:you )?to\s+|go ahead and\s+|just\s+|now\s+)?(buy|sell|swap|send|transfer|bridge|sign|submit|broadcast|execute|approve|claim|purchase|cancel (?:the |my )?order|place (?:an? |the )?order)\b/i,
      /\b(buy|sell|swap|send|transfer|sign|submit|execute|purchase)\b[^?]*\b(for me|it now|right now|now|immediately|asap)\b[^?]*$/i,
      /(^|[\s,.!])(купи|купіть|продай|продайте|обміняй|обміняйте|свапни|відправ|відправте|переведи|перекажи|підпиши|підпишіть|виконай|виконайте|розмісти ордер|постав ордер|схвали|заклейм)((?<![\p{L}\p{N}_])|[\s,.!]|$)/iu,
    ],
  },
  {
    class: "prepare_trade",
    weight: 80,
    any: [/\b(prepare|draft|set up|ready)\b.{0,40}\b(trade|order|purchase|ticket|swap)\b/i, /(підготуй|склади|зроби чернетк|сформуй).{0,40}(угод|ордер|покупк|тікет|обмін)/i],
  },
  {
    class: "prepare_plan",
    weight: 70,
    any: [
      /\b(build|prepare|make|create|draft|write|set up|design)\b.{0,60}\bplan\b/i,
      /\bplan\b.{0,40}\b(with|at|for)\b.{0,40}\b(risk|budget|entry)\b/i,
      /\bmax(imum)? risk\b/i,
      /(побудуй|склади|підготуй|зроби|створи|напиши|сформуй).{0,60}план/i,
      /план.{0,40}(з|із|на|при).{0,40}(ризик|бюджет|вх[іо]д)/i,
      /максимальн(ий|им) ризик/i,
    ],
  },
  {
    class: "prepare_monitoring",
    weight: 65,
    any: [
      /\b(alert me|notify me|tell me when|let me know (when|if)|watch for|set (up )?(an? )?(alert|rule|condition|monitor)|monitoring rule)\b/i,
      /(сповісти|повідом(ляй|и) мене|дай знати|скажи,? коли|слідкуй за|постав (правило|умову|сповіщення|моніторинг)|правило моніторингу)/i,
    ],
  },
  {
    class: "compare",
    weight: 60,
    any: [/\b(compare|comparison|versus|vs\.?|difference between|which is (better|safer|cheaper)|or)\b/i, /(порівняй|порівнян|проти|різниц(я|ю) між|що (краще|безпечніше|дешевше)|чи краще)/i],
  },
  {
    class: "monitoring",
    weight: 55,
    any: [
      /\b(alert|notification|notif|inbox|why did i get|what (does|did) this (note|alert|notification) mean|needs? attention|attention)\b/i,
      /(сповіщенн|нотифікаці|повідомленн|чому (мені )?прийшло|що означає (це |ця )?(сповіщення|нотифікація)|потребує уваги|уваг)/i,
    ],
  },
  {
    class: "results",
    weight: 50,
    any: [
      /\b(results?|outcome|how did (my|the) plan (do|go)|plan vs actual|executed under)\b/i,
      /* The mobile line's request 28 (2026-09-23): what happened with, or how is, a plan — the plan named by its asset, the last one or this one. */
      /\bwhat (happened|became of|came of) (with |to )?(my|the|this|that) (last |latest |previous |recent )?([a-z0-9$]{2,12} )?plan\b/i,
      /\bhow('?s| is| was| did) (my|the|this|that) (last |latest |previous |recent )?([a-z0-9$]{2,12} )?plan (doing|going|do|go|turn(ing)? out|perform(ing)?|work(ing)?)\b/i,
      /\bdid (my|the|this|that) (last |latest |previous |recent )?([a-z0-9$]{2,12} )?plan (work|pay off|hit|fail)\b/i,
      /(результат|як (спрацював|пройшов) план|план проти факт)/i,
      /(що (сталося|вийшло|стало) (з|із) (моїм|цим|тим|останнім|моїм останнім) (\S+ )?план|як (там )?(мій|цей|мій останній) (\S+ )?план|як справи (з|із) (моїм |цим )?(\S+ )?план|чим (закінчився|завершився) (мій|цей) (\S+ )?план)/iu,
    ],
  },
  {
    class: "plan",
    weight: 45,
    any: [
      /\b(my|this|the|that) [a-z0-9]{2,12} plan\b/i,
      /\b(my|this|that) plan\b/i,
      /\b(invalidation|invalidated|entry (window|validity)|max price|planned risk|what changed in my)\b/i,
      /\bplan_[0-9a-f]{32}\b/,
      /(м(ій|ого|оєму) план|цей план|ц(ього|ьому) план|інвалідаці|максимальн(а|у) ціну|плановий ризик)/i,
    ],
  },
  {
    class: "plans",
    weight: 40,
    any: [/\b(my plans|which plans|plans need|active plans|list (my )?plans|strategies)\b/i, /(мої плани|які плани|плани потребують|активні плани|стратегії)/i],
  },
  {
    class: "portfolio",
    weight: 47,
    any: [
      /\b(portfolio|holdings?|balance|what (do|did) i (hold|own|have)|my wallet|exposure|positions?|unpriced|what changed in my (portfolio|wallet))\b/i,
      /(портфел|портфоліо|баланс|що (в мене|у мене) (є|на гаманці)|м(ій|ого) гаманц|експозиці|позиці|без ціни|що змінилось (у|в) (моєму )?(портфелі|гаманці))/i,
    ],
  },
  {
    class: "evidence",
    weight: 35,
    any: [
      /\b(risk|risks|risky|safe|safety|evidence|holders?|whales?|smart money|flows?|net flow|authority|mint authority|freeze|sniper|bundler|dev holding|top ?10|concentration|structure|rug|honeypot|tax|due diligence|what am i (actually )?buying)\b/i,
      /(ризик|небезпечн|безпечн|доказ|холдер|тримач|кит|smart money|розумні гроші|поток|потік|authority|фріз|заморо|снайпер|бандлер|топ ?10|концентрац|структур|скам|податок|що я (насправді )?купую)/i,
    ],
  },
  {
    class: "market",
    weight: 30,
    any: [
      /\b(price|priced|cost|worth|moving|move|moved|pump|dump|up|down|changed?|change|trend|volume|liquidity|market cap|what is|what'?s|tell me about|explain|about|status|session|open|closed|market hours|should i|is it (a )?good|good idea|worth (buying|it))\b/i,
      /(цін|коштує|рух|рухається|росте|падає|пампить|дампить|змін|обсяг|ліквідн|капіталізац|що таке|що з|розкажи про|поясни|стан|сесі|біржа (відкрита|закрита)|години торгів|чи варто|чи купувати|чи брати)/i,
    ],
  },
  {
    class: "help",
    weight: 20,
    any: [/\b(what can you do|help|how do (i|you)|what are you|who are you)\b/i, /(що ти вмієш|допомож|допомога|як (мені|ти)|хто ти|що ти)/i],
  },
];

/* ------------------------------------------------------------ entities */

const STOP_WORDS = new Set([
  "I", "A", "AN", "THE", "AND", "OR", "VS", "VERSUS", "FOR", "ME", "MY", "IS", "IT", "IN", "ON", "AT", "TO", "OF", "USD", "US", "PLAN", "BUY", "SELL", "SWAP", "SEND", "OK", "SO", "IF", "DO", "NO", "NOT", "MAX", "MIN", "RISK", "WHAT", "WHY", "HOW", "WHEN", "WHO", "ARE", "CAN", "YOU", "THIS", "THAT", "WITH", "FROM", "TWO", "ONE", "ALL", "ANY", "NEW", "OLD", "UP", "DOWN", "AI", "API", "ENV", "ETF", "IPO", "DEX", "CEX", "TVL", "FDV", "NFT", "APR", "APY", "PNL", "UTC", "USDC", "USDT",
]);

/** Quote assets a person names as money, not as the thing they ask about. */
const QUOTE_ASSETS = new Set(["USDC", "USDT", "USD"]);

/**
 * A symbol as the product writes one: all caps (`SOL`, `BONK`, a pre-IPO
 * token's `OPENAI`), a ticker with the issuer's suffix (`NVDAx`, `SPYx`), a
 * ticker with a lower-case prefix (a token a person may still hold, which
 * the tools answer is no longer supported), or a `$`-prefixed word. Names in prose (`solana`,
 * `bonk`) are also taken, lower-case, when the word is a known catalogue
 * name — the tools resolve or refuse them.
 */
export function extractSymbols(text: string): readonly string[] {
  const found: string[] = [];
  const push = (raw: string) => {
    const token = raw.replace(/^\$/, "");
    if (token.length < 2 || token.length > 16) return;
    if (STOP_WORDS.has(token.toUpperCase()) || QUOTE_ASSETS.has(token.toUpperCase())) return;
    if (!found.some((entry) => entry.toLowerCase() === token.toLowerCase())) found.push(token);
  };
  for (const match of text.matchAll(/\$[A-Za-z][A-Za-z0-9]{1,15}/g)) push(match[0]);
  for (const match of text.matchAll(/(?<![A-Za-z0-9$])([A-Z][A-Z0-9]{1,11}[a-z]{0,2}|t[A-Z][A-Za-z0-9]{1,11})(?![A-Za-z0-9])/g)) {
    const token = match[1];
    /* A capitalised English word at a sentence start (`Compare`, `What`) is not a symbol: two upper-case letters, a digit or a suffix make one. */
    if (/^[A-Z][a-z]+$/.test(token)) continue;
    push(token);
  }
  for (const match of text.matchAll(/\b(solana|bonk|bitcoin|ethereum|jupiter|wif|dogwifhat|pepe|popcat|jup|ray|raydium|orca|pyth|render|helium|hnt|bnb|usdc)\b/gi)) push(match[1].toUpperCase() === "SOLANA" ? "SOL" : match[1]);
  return found.slice(0, 6);
}

export function extractMints(text: string): readonly string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g)) {
    if (!out.includes(match[0])) out.push(match[0]);
  }
  return out.slice(0, 4);
}

function money(raw: string): number | null {
  const suffix = /([kKmM])$/.exec(raw)?.[1];
  const cleaned = raw.replace(/[\s,]/g, "").replace(/[kKmM]$/, "");
  const value = Number(cleaned) * (suffix ? (suffix.toLowerCase() === "k" ? 1_000 : 1_000_000) : 1);
  return Number.isFinite(value) && value > 0 && value <= 1_000_000_000 ? value : null;
}

/** A sum written as `$50`, `50$`, `50 USD`, `50 dollars`, `50 доларів`, `1,000`, `1k`, `$1M`. */
const SUM_RE = /\$\s?([0-9][0-9,]*(?:\.[0-9]+)?[kKmM]?)|([0-9][0-9,]*(?:\.[0-9]+)?[kKmM]?)\s?(?:\$|usd(?<![\p{L}\p{N}_])|dollars?(?<![\p{L}\p{N}_])|бакс(?:ів|и)?|долар(?:ів|и|а)?)/giu;

type AmountRole = keyof Intent["amounts"];

/**
 * The words that give a sum its role, read in a short window before it and
 * after it. Before wins over after (`max risk $50` names the risk; `$50 max
 * risk` names it too), the nearest role wins, and each sum plays one role.
 */
const ROLE_WORDS: readonly Readonly<{ role: AmountRole; before: RegExp; after: RegExp }>[] = [
  { role: "riskUsd", before: /(max(?:imum)?\s+risk|risk(?:\s+budget)?|willing to lose|lose(?:\s+at\s+most)?|ризик(?:ом|у)?|максимальн(?:ий|им)\s+ризик(?:ом)?|готов(?:ий|а)\s+втратити|втратити не більше)\s*(?:of|is|=|:|до|—|-)?\s*$/i, after: /^\s*(?:of\s+)?(?:max(?:imum)?\s+)?risk|^\s*(?:максимальн(?:ого)?\s+)?ризик/i },
  { role: "maxPriceUsd", before: /(refuse|no|not|never|don'?t|do not)\s+(?:an?\s+)?(?:entry|buy|purchase|price)?\s*(?:above|over|higher than|more than)\s*$|(max(?:imum)?\s+(?:entry\s+)?price|price\s+(?:cap|limit)|above|over|higher than|не вище|не дорожче|максимальн(?:а|у)\s+цін(?:а|у)|вище)\s*(?:of|is|=|:|за|—|-)?\s*$/i, after: /^\s*(?:max(?:imum)?\s+price|cap)/i },
  { role: "invalidationUsd", before: /(invalidation|invalidated|stop(?:\s+loss)?|wrong\s+(?:at|below)|below|under|інвалідаці(?:я|ї|єю)|стоп|нижче)\s*(?:at|of|is|=|:|на|—|-)?\s*$/i, after: /^\s*(?:invalidation|stop|інвалідаці)/i },
  { role: "targetUsd", before: /(target|take profit|goal|ціл(?:ь|і|ю)|тейк)\s*(?:at|of|is|=|:|price|на|—|-)?\s*$/i, after: /^\s*(?:target|ціл)/i },
  { role: "entryUsd", before: /(entry|enter|buy(?:ing)?\s+at|entering\s+at|вх(?:ід|оду|одом)|вхідн(?:а|у)\s+цін(?:а|у)|за ціною)\s*(?:of|price|is|=|:|around|near|~|at|—|-)?\s*$/i, after: /^\s*(?:entry|per (?:share|token|unit)|вх(?:ід|оду)|за (?:акцію|токен))/i },
  { role: "budgetUsd", before: /(budget|capital|spend(?:ing)?|бюджет(?:ом)?|капітал(?:ом)?|на суму)\s*(?:of|is|=|:|до|—|-)?\s*$/i, after: /^\s*(?:budget|of capital|бюджет(?:у)?)/i },
  { role: "tradeUsd", before: /(buy|sell|swap|trade|purchase|купи(?:ти)?|прода(?:й|ти)|обміня(?:й|ти))\s+(?:me\s+)?(?:for\s+)?$/i, after: /^\s*(?:of|worth of|worth|на)(?![\p{L}\p{N}_])/iu },
];

/** Every sum in the words with its role; a sum no words claim is the trade's sum in a trade and the budget in a plan. */
export function extractAmounts(text: string, fallback: AmountRole | null = null): Intent["amounts"] {
  const amounts: Record<AmountRole, number | null> = { ...EMPTY_AMOUNTS };
  const claimed = new Set<AmountRole>();
  for (const match of text.matchAll(SUM_RE)) {
    const raw = match[1] ?? match[2];
    const value = raw ? money(raw) : null;
    if (value === null || match.index === undefined) continue;
    const before = text.slice(Math.max(0, match.index - 48), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 32);
    const role = ROLE_WORDS.find((entry) => !claimed.has(entry.role) && entry.before.test(before))?.role ?? ROLE_WORDS.find((entry) => !claimed.has(entry.role) && entry.after.test(after))?.role ?? (fallback !== null && !claimed.has(fallback) ? fallback : null);
    if (role === null) continue;
    claimed.add(role);
    amounts[role] = value;
  }
  return amounts;
}

/* ------------------------------------------------------------ a condition */

const CONDITION_METRICS: readonly Readonly<{ metric: (typeof EVIDENCE_METRIC_IDS)[number]; window: "24h" | "7d" | "now"; words: RegExp; unit: "usd" | "pct" | "count" | "flag" }>[] = [
  { metric: "dex_volume_usd", window: "24h", words: /(?<![\p{L}\p{N}_])(volume|обсяг)(?![\p{L}\p{N}_])/iu, unit: "usd" },
  { metric: "whale_net_flow_usd", window: "24h", words: /(?<![\p{L}\p{N}_])(whale|whales|кит|китів)(?![\p{L}\p{N}_])/iu, unit: "usd" },
  { metric: "exchange_net_flow_usd", window: "24h", words: /(?<![\p{L}\p{N}_])(exchange (net )?flow|біржов(ий|і) потік)(?![\p{L}\p{N}_])/iu, unit: "usd" },
  { metric: "dex_net_volume_usd", window: "24h", words: /(?<![\p{L}\p{N}_])(net (volume|flow)|чист(ий|ого) (обсяг|потік))(?![\p{L}\p{N}_])/iu, unit: "usd" },
  { metric: "top10_holder_share_pct", window: "now", words: /(?<![\p{L}\p{N}_])(top ?10|top ten|топ ?10|concentration|концентрац)/iu, unit: "pct" },
  { metric: "holder_count", window: "now", words: /(?<![\p{L}\p{N}_])(holders?|тримач|холдер)/iu, unit: "count" },
  { metric: "sniper_holding_pct", window: "now", words: /(?<![\p{L}\p{N}_])(sniper|снайпер)/iu, unit: "pct" },
  { metric: "bundler_holding_pct", window: "now", words: /(?<![\p{L}\p{N}_])(bundler|бандлер)/iu, unit: "pct" },
  { metric: "dev_holding_pct", window: "now", words: /(?<![\p{L}\p{N}_])(dev(eloper)? holding|dev share|частк(а|у) розробник)/iu, unit: "pct" },
  { metric: "transfer_tax_pct", window: "now", words: /(?<![\p{L}\p{N}_])(transfer tax|tax|податок)/iu, unit: "pct" },
  { metric: "mint_authority", window: "now", words: /(?<![\p{L}\p{N}_])(mint authority|mint(ing)? (right|authority)|емісі)/iu, unit: "flag" },
  { metric: "freeze_authority", window: "now", words: /(?<![\p{L}\p{N}_])(freeze|заморо|фріз)/iu, unit: "flag" },
];

/** A condition in the words — the metric, the direction and the figure — for a monitoring draft; null when the words state no measurable rule. */
export function extractCondition(text: string): Intent["condition"] {
  const found = CONDITION_METRICS.find((entry) => entry.words.test(text));
  if (!found) return null;
  const below = /(?<![\p{L}\p{N}_])(below|under|drops?|falls?|less than|lower than|нижче|падає|менше)(?![\p{L}\p{N}_])/iu.test(text);
  const above = /(?<![\p{L}\p{N}_])(above|over|exceeds?|rises?|more than|higher than|climbs?|вище|більше|перевищ|росте)(?![\p{L}\p{N}_])/iu.test(text);
  const operator: "lt" | "gt" | null = below && !above ? "lt" : above && !below ? "gt" : below ? "lt" : null;
  let threshold: number | null = null;
  if (found.unit === "usd") {
    const sums = extractAmounts(text, "tradeUsd");
    threshold = sums.tradeUsd ?? sums.budgetUsd ?? sums.invalidationUsd ?? sums.maxPriceUsd ?? sums.riskUsd ?? null;
  } else if (found.unit === "pct") {
    const pct = /([0-9]{1,3}(?:\.[0-9]+)?)\s?%/.exec(text);
    threshold = pct ? Number(pct[1]) : null;
  } else if (found.unit === "count") {
    const count = /([0-9][0-9,]*[kKmM]?)\s*(?:holders?|тримач|холдер)/i.exec(text) ?? /(?:holders?|тримач|холдер)\D{0,20}([0-9][0-9,]*[kKmM]?)/i.exec(text);
    threshold = count ? money(count[1]) : null;
  } else {
    /* An authority: `renounced` is `lte 0`, `present` is `gte 1`; the words `renounced`/`removed` name the safe side. */
    const renounced = /(?<![\p{L}\p{N}_])(renounced|removed|revoked|gone|відкликан|знят)/iu.test(text);
    return { metric: found.metric, window: found.window, operator: renounced ? "lte" : "gte", threshold: renounced ? 0 : 1 };
  }
  return { metric: found.metric, window: found.window, operator: operator ?? "lt", threshold: threshold ?? Number.NaN };
}

export function extractWindow(text: string): Intent["window"] {
  if (/(?<![\p{L}\p{N}_])(24 ?h|24 hours|today|day|daily|за день|за добу|сьогодні|24 год)(?![\p{L}\p{N}_])/iu.test(text)) return "24h";
  if (/(?<![\p{L}\p{N}_])(7 ?d|week|weekly|7 days|за тиждень|тиждень|7 днів)(?![\p{L}\p{N}_])/iu.test(text)) return "7d";
  if (/(?<![\p{L}\p{N}_])(now|right now|structure|authority|holders|top ?10|зараз|структур|тримач|холдер)(?![\p{L}\p{N}_])/iu.test(text)) return "now";
  return null;
}

export function extractHorizonDays(text: string): number | null {
  const match = /(\d{1,3})\s*(day|days|week|weeks|month|months|дн(?:і|ів|я)|тижн(?:і|ів|я|ень)|місяц(?:і|ів|ь|я))/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2].toLowerCase();
  const factor = /^(week|тиж)/.test(unit) ? 7 : /^(month|місяц)/.test(unit) ? 30 : 1;
  return Math.min(3650, value * factor);
}

function refersToContext(text: string): boolean {
  return /\b(this|these|it|here|current)\b/i.test(text) || /(це|цей|ця|ці|цього|цю|цим|тут|поточн)/i.test(text);
}

/* ------------------------------------------------------------ the parser */

function classify(text: string): AgentQuestionClass {
  let best: { class: AgentQuestionClass; weight: number } | null = null;
  for (const rule of RULES) {
    if (rule.any.some((re) => re.test(text)) && (best === null || rule.weight > best.weight)) best = { class: rule.class, weight: rule.weight };
  }
  return best?.class ?? "unknown";
}

/**
 * The person's words into an intent. The context decides a bare question:
 * *what changed?* on a plan is about the plan, on the portfolio about the
 * holdings, on an asset about the market — and a symbol in the words always
 * outranks the context, because a person on SOL's page may well ask about
 * BONK.
 */
/**
 * The format the words asked for (`RYN-BRIEF-CRITIC-001`). Explicit only:
 * *what changed in my portfolio* is an ordinary question and must not drag a
 * Brief behind it, so nothing but a word that names the format triggers one.
 * The Critic wins when both are named — a person who asks to be argued with
 * is asking for the harder read.
 */
const BRIEF_WORDS = /(?<![\p{L}\p{N}_])(brief|briefing|tl;?dr|summar(y|ise|ize)|in short|short version|catch me up|стисло|коротко|бриф|підсуму(й|вати)|резюме|стислий огляд)(?![\p{L}\p{N}_])/iu;
const CRITIC_WORDS = /(?<![\p{L}\p{N}_])(critic|critics|critique|criticis[ez]|criticize|challenge|counter[- ]?argument|devil'?s advocate|poke holes|argue against|what'?s wrong with|what could go wrong|weak spot|weakness(es)?|критик(а|уй)?|розкритикуй|оскарж(и|ити)|контраргумент|аргументи проти|що не так|що може піти не так|слабк(е|і) (місце|місця))(?![\p{L}\p{N}_])/iu;

export function extractLens(words: string): "brief" | "critic" | null {
  if (CRITIC_WORDS.test(words)) return "critic";
  if (BRIEF_WORDS.test(words)) return "brief";
  return null;
}

export function parseIntent(text: string, context: AgentContext | null): Intent {
  const words = text.trim().slice(0, 2000);
  const symbols = extractSymbols(words);
  const mints = extractMints(words);
  const planMatch = /plan_[0-9a-f]{32}/.exec(words);
  const planId = planMatch?.[0] ?? (context?.kind === "plan" ? context.planId : null);
  let klass = classify(words);
  const contextual = refersToContext(words);

  /* A request to execute a trade is refused and, where the words name what to trade, prepared for Review. */
  if (klass === "execute" && /(?<![\p{L}\p{N}_])(prepare|draft|for review)(?![\p{L}\p{N}_])|підготуй|чернетк|на review/iu.test(words) && !/\b(buy|sell|swap|send|transfer|sign|submit)\b\s+(it|now|for me|this|now)/i.test(words)) klass = "prepare_trade";

  /* "Compare" needs two things; with fewer it is a question about the one. */
  const compare = klass === "compare" ? [...symbols, ...mints].slice(0, 4) : [];
  if (klass === "compare" && compare.length < 2 && !(context?.kind === "asset" && compare.length === 1)) klass = symbols.length > 0 || mints.length > 0 ? "market" : "unknown";

  /* "Why does this plan need attention" is a question about the plan: the plan tool reads its notes too. */
  if (klass === "monitoring" && (planMatch !== null || (context?.kind === "plan" && contextual))) klass = "plan";

  /* A bare question on a context is a question about the context. */
  if (klass === "unknown" || klass === "market") {
    if (symbols.length === 0 && mints.length === 0) {
      if (context?.kind === "plan") klass = "plan";
      else if (context?.kind === "portfolio") klass = klass === "unknown" ? "unknown" : "portfolio";
      else if (context?.kind === "note") klass = "monitoring";
      else if (context?.kind === "asset") klass = "market";
    }
  }
  /* A risk question about a plan's asset, with no symbol, stays about the plan's asset — the plan tool reads it. */
  if (klass === "market" && symbols.length === 0 && mints.length === 0 && context === null) klass = "unknown";
  /* "What changed in my portfolio" carries no symbol; "what changed" on an asset is the market; a plan question with a plan in context reads that plan. */
  if ((klass === "plan" || klass === "results") && planId === null && context?.kind !== "plan") klass = klass === "plan" && symbols.length === 0 ? "plans" : klass;
  /* A prepared plan needs an asset: the words, or the context's asset or plan. */
  if (klass === "prepare_plan" && symbols.length === 0 && mints.length === 0 && context?.kind !== "asset" && context?.kind !== "plan") klass = "prepare_plan";

  /*
   * A Brief or a Critic is a **format**, not a question of its own
   * (`RYN-BRIEF-CRITIC-001`): it takes the class of whatever it is about, so
   * the same tools read and the same six-section answer is written beside
   * it. With no subject at all it stays unknown, and the answer says what
   * Ryn can be asked instead of composing a format over nothing.
   */
  const lens = klass === "secret" ? null : extractLens(words);
  if (lens !== null && klass === "unknown") {
    if (planId !== null || context?.kind === "plan") klass = "plan";
    else if (symbols.length > 0 || mints.length > 0 || context?.kind === "asset") klass = "market";
    else if (context?.kind === "portfolio") klass = "portfolio";
    else if (context?.kind === "note") klass = "monitoring";
    else if (context?.kind === "page") klass = "plans";
  }

  const amounts = extractAmounts(words, klass === "execute" || klass === "prepare_trade" ? "tradeUsd" : klass === "prepare_plan" ? "budgetUsd" : null);
  return IntentSchema.parse({
    class: klass,
    symbols,
    mints,
    planId,
    amounts,
    window: extractWindow(words),
    compare,
    horizonDays: extractHorizonDays(words),
    refersToContext: contextual,
    lens,
    condition: klass === "prepare_monitoring" ? extractCondition(words) : null,
    movement: /(^|[^\p{L}])(why|moving|moves?|moved|pump(ing|ed)?|dump(ing|ed)?|changed?|rall(y|ied)|drop(ped|s)?|fell|falling|surg(e|ed|ing)|чому|рух|росте|зріс|зросла|падає|впав|впала|змінил|пампи|дампи)(?![\p{L}])/iu.test(words),
    side: /(^|[\s,.!])(sell|selling|продай|продайте|продати|продаж)(?![\p{L}])/iu.test(words) ? "SELL" : /(^|[\s,.!])(buy|buying|purchase|купи|купіть|купити|купівл)(?![\p{L}])/iu.test(words) ? "BUY" : null,
  });
}
