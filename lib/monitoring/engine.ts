/**
 * Provider-neutral condition engine for Ryntra Monitoring.
 *
 * Pure: the clock, the previous observation and the current reads go in;
 * status, findings and whether a crossing just happened come out. Nothing
 * here sends a notification, talks to a provider or authorizes a trade.
 * A stale or unavailable read is never a pass. A provider fault is not a
 * triggered condition.
 */

export type Locale = "en" | "uk";
export type Bi = Readonly<{ en: string; uk: string }>;

export type MonitorStatus = "watching" | "needs_attention" | "paused" | "unavailable";

export type ConditionKind =
  | "plan.price_bound"
  | "plan.invalidation"
  | "plan.expiry"
  | "plan.deviation"
  | "plan.evidence"
  /** 1.21.0: a position's target — the price its plan or «Ryntra попередить» named to sell at, reached. */
  | "plan.target"
  | "prediction.probability"
  | "prediction.resolution"
  | "prediction.signal";

export type FindingOutcome = "pass" | "fail" | "stale" | "unavailable" | "unknown";

/**
 * What a condition and an outcome are called for a person. The ids above are
 * the engine's own and belong in the store; a reader is told what was watched
 * and what was found. A kind this does not know is returned as it came —
 * honest, and never a guess.
 */
export function conditionKindWords(kind: string, locale: Locale): string {
  const words: Readonly<Record<string, Bi>> = {
    "plan.price_bound": { en: "the price against the plan's bound", uk: "ціна проти межі плану" },
    "plan.invalidation": { en: "the invalidation", uk: "інвалідація" },
    "plan.expiry": { en: "the entry window", uk: "вікно входу" },
    "plan.deviation": { en: "the deviation from the reference", uk: "відхилення від референсу" },
    "plan.evidence": { en: "an evidence condition", uk: "умова доказів" },
    "plan.target": { en: "the price against your target", uk: "ціна проти твоєї цілі" },
    "prediction.probability": { en: "the probability bound", uk: "межа ймовірності" },
    "prediction.resolution": { en: "the resolution", uk: "врегулювання" },
    "prediction.signal": { en: "a signal on the market", uk: "сигнал на ринку" },
  };
  return words[kind]?.[locale] ?? kind;
}

export function findingOutcomeWords(outcome: string, locale: Locale): string {
  const words: Readonly<Record<string, Bi>> = {
    pass: { en: "held", uk: "трималася" },
    fail: { en: "was not met", uk: "не виконана" },
    stale: { en: "could only be judged on a stale read", uk: "оцінювалася лише на застарілому читанні" },
    unavailable: { en: "could not be read", uk: "не вдалося прочитати" },
    unknown: { en: "could not be judged", uk: "не вдалося оцінити" },
  };
  return words[outcome]?.[locale] ?? outcome;
}

/**
 * The facts a finding stands on: what the market and the plan said at the
 * tick, as figures, so a client renders the finding in its own language
 * instead of repeating the tick's sentence. Every figure is optional — a kind
 * names the ones it uses; a reader prints what is there.
 */
export type FindingFacts = Readonly<{
  symbol?: string;
  /** The market price at the tick, USD per unit of the plan. */
  price?: number | null;
  /** The plan's maximum buy price, USD per unit. */
  bound?: number | null;
  /** The plan's invalidation, USD per unit — for a position, its loss limit. */
  invalidation?: number | null;
  /** 1.21.0: a position's target, USD per unit. */
  target?: number | null;
  /** The reference deviation at the tick, percent, and the plan's allowed deviation. */
  deviationPct?: number | null;
  maxDeviationPct?: number | null;
  /** The entry window's end, ISO. */
  validUntil?: string | null;
  /** The evidence metric a condition names. */
  metric?: string;
  /** The live probability and the plan's bound, for a prediction plan. */
  probability?: number | null;
  maxProbability?: number | null;
  /** When the market was observed, ISO, where the read states it. */
  observedAt?: string | null;
}>;

export type Finding = Readonly<{
  conditionId: string;
  kind: ConditionKind;
  outcome: FindingOutcome;
  material: boolean;
  key: string;
  title: Bi;
  reason: Bi;
  /** The figures behind the words (additive; absent on a finding written before them). */
  facts?: FindingFacts;
}>;

export type Crossing = Readonly<{
  identity: string;
  finding: Finding;
}>;

export type Observation = Readonly<{
  conditionId: string;
  key: string;
  at: string;
}>;

export type MarketRead = Readonly<{
  lastPriceUsd: number | null;
  referencePerShare: number | null;
  deviationPct: number | null;
  observedAt: string | null;
}>;

export type EvidenceJudgement = Readonly<{
  conditionId: string;
  metric: string;
  outcome: "pass" | "fail" | "unknown";
  reason: string;
  state: "FRESH" | "STALE" | "UNAVAILABLE" | "UNKNOWN";
  served: "provider" | "cache" | "stale-cache" | "none";
}>;

export type PredictionRead = Readonly<{
  probability: number | null;
  endsAt: string | null;
  signalFingerprint: string | null;
  paper: true;
}>;

export type TradingPlanSnapshot = Readonly<{
  planId: string;
  symbol: string;
  status: string;
  paused: boolean;
  maxPricePerShare: number | null;
  invalidationPerShare: number;
  /** 1.21.0: where the position is to be sold — watched once the buy settled; null where none is named. */
  targetPerShare?: number | null;
  validUntil: string | null;
  maxReferenceDeviationPct: number | null;
  evidence: readonly Readonly<{
    conditionId: string;
    metric: string;
    required: boolean;
  }>[];
}>;

export type PredictionPlanSnapshot = Readonly<{
  planId: string;
  title: string;
  status: string;
  paused: boolean;
  paper: true;
  maxProbability: number | null;
  invalidationProbability: number | null;
  resolutionDeadline: string | null;
  monitoring: readonly Readonly<{
    conditionId: string;
    metric: "probability" | "volume24h" | "signal" | "resolution" | "plan";
    direction: "above" | "below" | "any";
    threshold: number | null;
  }>[];
}>;

function bi(en: string, uk: string): Bi {
  return { en, uk };
}

function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

/** The Ukrainian sentence writes money the way the Ukrainian screen does: «$360,70», «$1 061,20». */
function moneyUk(n: number): string {
  return `$${n.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function isoMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function finding(partial: Omit<Finding, "material" | "key"> & { material?: boolean; key?: string }): Finding {
  const material = partial.material ?? (partial.outcome === "fail" || partial.outcome === "stale");
  const key = partial.key ?? `${partial.outcome}`;
  return { ...partial, material, key };
}

export function evaluateTradingPlan(input: Readonly<{
  plan: TradingPlanSnapshot;
  market: MarketRead;
  evidence: readonly EvidenceJudgement[];
  nowMs: number;
  previous: readonly Observation[];
}>): Readonly<{ status: MonitorStatus; findings: readonly Finding[]; crossings: readonly Crossing[] }> {
  if (input.plan.paused || input.plan.status === "cancelled" || input.plan.status === "draft") {
    return { status: "paused", findings: [], crossings: [] };
  }

  const findings: Finding[] = [];
  const symbol = input.plan.symbol;
  /*
   * A plan whose buy settled is watched as a position: its entry rules are
   * spent — the price bound, the window, the deviation and the evidence
   * decided an entry that already happened — and its loss limit is what
   * Ryntra warns about. The same condition as before the buy, so a line
   * already crossed is not announced twice; the words are the position's.
   * Ryntra never sells for the person.
   */
  const position = input.plan.status === "executed";

  if (!position && input.plan.maxPricePerShare !== null) {
    if (input.market.lastPriceUsd === null) {
      findings.push(finding({
        conditionId: "plan.price_bound",
        kind: "plan.price_bound",
        outcome: "unavailable",
        material: false,
        title: bi(`${symbol} price`, `Ціна ${symbol}`),
        reason: bi("The market price could not be read right now.", "Ринкову ціну зараз не вдалося прочитати."),
      }));
    } else if (input.market.lastPriceUsd > input.plan.maxPricePerShare) {
      findings.push(finding({
        conditionId: "plan.price_bound",
        kind: "plan.price_bound",
        outcome: "fail",
        title: bi(`${symbol} is above your price bound`, `${symbol} вище твоєї цінової межі`),
        reason: bi(
          `The market is ${money(input.market.lastPriceUsd)}. Your plan will not pay more than ${money(input.plan.maxPricePerShare)}.`,
          `Ринок ${moneyUk(input.market.lastPriceUsd)}. План не платить більше ніж ${moneyUk(input.plan.maxPricePerShare)}.`,
        ),
      }));
    } else {
      findings.push(finding({
        conditionId: "plan.price_bound",
        kind: "plan.price_bound",
        outcome: "pass",
        title: bi(`${symbol} price`, `Ціна ${symbol}`),
        reason: bi("The price is still within the bound you wrote.", "Ціна ще в межах, які ти записав."),
      }));
    }
  }

  if (input.market.lastPriceUsd === null) {
    findings.push(finding({
      conditionId: "plan.invalidation",
      kind: "plan.invalidation",
      outcome: "unavailable",
      material: false,
      title: position ? bi("Your loss limit", "Твоя межа збитку") : bi("Where the thesis is wrong", "Де теза хибна"),
      reason: bi("The market price could not be read right now.", "Ринкову ціну зараз не вдалося прочитати."),
    }));
  } else if (input.market.lastPriceUsd <= input.plan.invalidationPerShare) {
    findings.push(finding({
      conditionId: "plan.invalidation",
      kind: "plan.invalidation",
      outcome: "fail",
      title: position ? bi(`${symbol} reached your loss limit`, `${symbol} дійшов до твоєї межі збитку`) : bi(`${symbol} reached where the thesis is wrong`, `${symbol} дійшов до місця, де теза хибна`),
      reason: position
        ? bi(
            `The market is ${money(input.market.lastPriceUsd)}; your loss limit is ${money(input.plan.invalidationPerShare)}. Ryntra does not sign for you: a sale is yours to open and sign.`,
            `Ринок ${moneyUk(input.market.lastPriceUsd)}; твоя межа збитку — ${moneyUk(input.plan.invalidationPerShare)}. Ryntra не підписує за тебе: продаж відкриваєш і підписуєш ти.`,
          )
        : bi(
            `The market is ${money(input.market.lastPriceUsd)}. Your plan named ${money(input.plan.invalidationPerShare)} as the line where the idea failed.`,
            `Ринок ${moneyUk(input.market.lastPriceUsd)}. У плані ${moneyUk(input.plan.invalidationPerShare)} — межа, де ідея не справдилась.`,
          ),
    }));
  } else {
    findings.push(finding({
      conditionId: "plan.invalidation",
      kind: "plan.invalidation",
      outcome: "pass",
      title: position ? bi("Your loss limit", "Твоя межа збитку") : bi("Where the thesis is wrong", "Де теза хибна"),
      reason: position ? bi("The price is still above your loss limit.", "Ціна ще вище твоєї межі збитку.") : bi("The price is still above the line you named.", "Ціна ще вище межі, яку ти назвав."),
    }));
  }

  /* A position's target («Дія»): reached, the sale is the person's to open — the same words a loss limit has. */
  const target = position && typeof input.plan.targetPerShare === "number" && Number.isFinite(input.plan.targetPerShare) && input.plan.targetPerShare > input.plan.invalidationPerShare ? input.plan.targetPerShare : null;
  if (target !== null && input.market.lastPriceUsd !== null) {
    if (input.market.lastPriceUsd >= target) {
      findings.push(finding({
        conditionId: "plan.target",
        kind: "plan.target",
        outcome: "fail",
        title: bi(`${symbol} reached your target`, `${symbol} дійшов до твоєї цілі`),
        reason: bi(
          `The market is ${money(input.market.lastPriceUsd)}; your target is ${money(target)}. Ryntra does not sign for you: a sale is yours to open and sign.`,
          `Ринок ${moneyUk(input.market.lastPriceUsd)}; твоя ціль — ${moneyUk(target)}. Ryntra не підписує за тебе: продаж відкриваєш і підписуєш ти.`,
        ),
      }));
    } else {
      findings.push(finding({
        conditionId: "plan.target",
        kind: "plan.target",
        outcome: "pass",
        title: bi("Your target", "Твоя ціль"),
        reason: bi("The price is still below your target.", "Ціна ще нижче твоєї цілі."),
      }));
    }
  }

  const until = position ? null : isoMs(input.plan.validUntil);
  if (until !== null) {
    if (input.nowMs >= until) {
      findings.push(finding({
        conditionId: "plan.expiry",
        kind: "plan.expiry",
        outcome: "fail",
        title: bi("This plan has expired", "Цей план уже не чинний"),
        reason: bi("The entry window you wrote has passed. Review the plan before acting.", "Вікно входу, яке ти записав, минуло. Переглянь план, перш ніж діяти."),
      }));
    } else {
      findings.push(finding({
        conditionId: "plan.expiry",
        kind: "plan.expiry",
        outcome: "pass",
        title: bi("Entry window", "Вікно входу"),
        reason: bi("The entry window is still open.", "Вікно входу ще відкрите."),
      }));
    }
  }

  if (!position && input.plan.maxReferenceDeviationPct !== null) {
    if (input.market.deviationPct === null) {
      findings.push(finding({
        conditionId: "plan.deviation",
        kind: "plan.deviation",
        outcome: "unavailable",
        material: false,
        title: bi("Deviation from the reference", "Відхилення від орієнтира"),
        reason: bi("The reference deviation could not be read right now.", "Відхилення від орієнтира зараз не вдалося прочитати."),
      }));
    } else if (Math.abs(input.market.deviationPct) > input.plan.maxReferenceDeviationPct) {
      findings.push(finding({
        conditionId: "plan.deviation",
        kind: "plan.deviation",
        outcome: "fail",
        title: bi(`${symbol} has moved away from the reference`, `${symbol} відійшов від орієнтира`),
        reason: bi(
          `Deviation is ${pct(input.market.deviationPct)}. Your plan allows at most ${pct(input.plan.maxReferenceDeviationPct)}.`,
          `Відхилення ${pct(input.market.deviationPct)}. План дозволяє щонайбільше ${pct(input.plan.maxReferenceDeviationPct)}.`,
        ),
      }));
    } else {
      findings.push(finding({
        conditionId: "plan.deviation",
        kind: "plan.deviation",
        outcome: "pass",
        title: bi("Deviation from the reference", "Відхилення від орієнтира"),
        reason: bi("The deviation is still within the bound you wrote.", "Відхилення ще в межах, які ти записав."),
      }));
    }
  }

  for (const rule of position ? [] : input.plan.evidence) {
    const judged = input.evidence.find((row) => row.conditionId === rule.conditionId);
    if (!judged || judged.state === "UNAVAILABLE") {
      findings.push(finding({
        conditionId: rule.conditionId,
        kind: "plan.evidence",
        outcome: "unavailable",
        material: false,
        key: rule.required ? "unavailable" : "unavailable-advisory",
        title: bi("Market evidence needs to be refreshed", "Ринкові дані треба оновити"),
        reason: bi(
          judged?.reason || "The source did not answer. This is not a change in the market — it is missing data.",
          judged?.reason || "Джерело не відповіло. Це не зміна ринку — це відсутні дані.",
        ),
      }));
      continue;
    }
    if (judged.state === "STALE") {
      findings.push(finding({
        conditionId: rule.conditionId,
        kind: "plan.evidence",
        outcome: "stale",
        material: true,
        title: bi("Market evidence needs to be refreshed", "Ринкові дані треба оновити"),
        reason: bi("The last reading is older than this plan will trust. Review the plan on a fresh reading.", "Останнє читання старіше, ніж цей план довіряє. Переглянь план на свіжому читанні."),
      }));
      continue;
    }
    if (judged.outcome === "fail") {
      findings.push(finding({
        conditionId: rule.conditionId,
        kind: "plan.evidence",
        outcome: "fail",
        title: bi("Evidence changed since your last Review", "Дані змінились від останнього Review"),
        reason: bi(
          judged.reason || "A condition in your plan is no longer met.",
          judged.reason || "Умова в твоєму плані більше не виконується.",
        ),
      }));
    } else if (judged.outcome === "unknown") {
      findings.push(finding({
        conditionId: rule.conditionId,
        kind: "plan.evidence",
        outcome: "unknown",
        material: rule.required,
        key: rule.required ? "unknown" : "unknown-advisory",
        title: bi("Market evidence needs to be refreshed", "Ринкові дані треба оновити"),
        reason: bi(judged.reason || "This figure could not be judged.", judged.reason || "Цю цифру не вдалося оцінити."),
      }));
    } else {
      findings.push(finding({
        conditionId: rule.conditionId,
        kind: "plan.evidence",
        outcome: "pass",
        title: bi("Evidence condition", "Умова за даними ринку"),
        reason: bi("This condition still holds.", "Ця умова ще виконується."),
      }));
    }
  }

  /* The figures every finding of this tick stands on, once: the reader renders the kind from them. */
  const facts: FindingFacts = {
    symbol,
    price: input.market.lastPriceUsd,
    bound: input.plan.maxPricePerShare,
    invalidation: input.plan.invalidationPerShare,
    ...(target !== null ? { target } : {}),
    deviationPct: input.market.deviationPct,
    maxDeviationPct: input.plan.maxReferenceDeviationPct,
    validUntil: input.plan.validUntil,
    observedAt: input.market.observedAt,
  };
  const withFacts = findings.map((row) => ({ ...row, facts: row.kind === "plan.evidence" ? { ...facts, metric: input.plan.evidence.find((rule) => rule.conditionId === row.conditionId)?.metric } : facts }));
  return conclude(withFacts, input.previous, input.plan.planId);
}

export function evaluatePredictionPlan(input: Readonly<{
  plan: PredictionPlanSnapshot;
  market: PredictionRead;
  nowMs: number;
  previous: readonly Observation[];
}>): Readonly<{ status: MonitorStatus; findings: readonly Finding[]; crossings: readonly Crossing[] }> {
  if (input.plan.paused || input.plan.status === "cancelled" || input.plan.status === "draft") {
    return { status: "paused", findings: [], crossings: [] };
  }

  const findings: Finding[] = [];
  const paper = bi("Paper prediction", "Паперовий прогноз");

  if (input.plan.maxProbability !== null) {
    if (input.market.probability === null) {
      findings.push(finding({
        conditionId: "prediction.probability.max",
        kind: "prediction.probability",
        outcome: "unavailable",
        material: false,
        title: paper,
        reason: bi("The live probability could not be read right now.", "Живу ймовірність зараз не вдалося прочитати."),
      }));
    } else if (input.market.probability > input.plan.maxProbability) {
      findings.push(finding({
        conditionId: "prediction.probability.max",
        kind: "prediction.probability",
        outcome: "fail",
        title: bi("Paper prediction · Probability crossed your review level", "Паперовий прогноз · Ймовірність перетнула твій рівень перегляду"),
        reason: bi(
          `Live probability is ${pct(input.market.probability * 100)}. Your plan reviews above ${pct(input.plan.maxProbability * 100)}. This is not a real-money position.`,
          `Жива ймовірність ${pct(input.market.probability * 100)}. План переглядає вище ${pct(input.plan.maxProbability * 100)}. Це не позиція за реальні кошти.`,
        ),
      }));
    } else {
      findings.push(finding({
        conditionId: "prediction.probability.max",
        kind: "prediction.probability",
        outcome: "pass",
        title: paper,
        reason: bi("The probability is still within the bound you wrote.", "Ймовірність ще в межах, які ти записав."),
      }));
    }
  }

  if (input.plan.invalidationProbability !== null && input.market.probability !== null) {
    if (input.market.probability < input.plan.invalidationProbability) {
      findings.push(finding({
        conditionId: "prediction.invalidation",
        kind: "prediction.probability",
        outcome: "fail",
        title: bi("Paper prediction · Probability fell through your invalidation", "Паперовий прогноз · Ймовірність пробила твою межу"),
        reason: bi(
          `Live probability is ${pct(input.market.probability * 100)}. You named ${pct(input.plan.invalidationProbability * 100)} as where the thesis is wrong. This is not a real-money position.`,
          `Жива ймовірність ${pct(input.market.probability * 100)}. Ти назвав ${pct(input.plan.invalidationProbability * 100)} місцем, де теза хибна. Це не позиція за реальні кошти.`,
        ),
      }));
    }
  }

  const deadline = isoMs(input.plan.resolutionDeadline) ?? isoMs(input.market.endsAt);
  if (deadline !== null) {
    const hoursLeft = (deadline - input.nowMs) / 3_600_000;
    if (hoursLeft <= 0) {
      findings.push(finding({
        conditionId: "prediction.resolution",
        kind: "prediction.resolution",
        outcome: "fail",
        title: bi("Paper prediction · Resolution has arrived", "Паперовий прогноз · Розв'язання вже настало"),
        reason: bi("The market should have resolved. Review the paper position. This is not a real-money position.", "Ринок мав розв'язатися. Переглянь паперову позицію. Це не позиція за реальні кошти."),
      }));
    } else if (hoursLeft <= 24) {
      findings.push(finding({
        conditionId: "prediction.resolution",
        kind: "prediction.resolution",
        outcome: "fail",
        key: "approaching",
        title: bi("Paper prediction · Resolution is close", "Паперовий прогноз · Розв'язання близько"),
        reason: bi("This market resolves within a day. Review the paper plan. This is not a real-money position.", "Цей ринок розв'яжеться протягом доби. Переглянь паперовий план. Це не позиція за реальні кошти."),
      }));
    } else {
      findings.push(finding({
        conditionId: "prediction.resolution",
        kind: "prediction.resolution",
        outcome: "pass",
        title: paper,
        reason: bi("Resolution is still further out.", "Розв'язання ще не близько."),
      }));
    }
  }

  for (const rule of input.plan.monitoring) {
    if (rule.metric === "probability" && rule.threshold !== null && input.market.probability !== null) {
      const crossed = rule.direction === "above"
        ? input.market.probability > rule.threshold
        : rule.direction === "below"
          ? input.market.probability < rule.threshold
          : false;
      if (crossed) {
        findings.push(finding({
          conditionId: rule.conditionId,
          kind: "prediction.probability",
          outcome: "fail",
          title: bi(`Paper prediction · Probability crossed your ${pct(rule.threshold * 100)} review level`, `Паперовий прогноз · Ймовірність перетнула твій рівень ${pct(rule.threshold * 100)}`),
          reason: bi("This is not a real-money position.", "Це не позиція за реальні кошти."),
        }));
      } else {
        findings.push(finding({
          conditionId: rule.conditionId,
          kind: "prediction.probability",
          outcome: "pass",
          title: paper,
          reason: bi("This probability rule still holds.", "Це правило ймовірності ще виконується."),
        }));
      }
    }
    if (rule.metric === "signal") {
      const fingerprint = input.market.signalFingerprint;
      if (fingerprint) {
        const previous = input.previous.find((row) => row.conditionId === rule.conditionId);
        if (previous && previous.key !== `signal:${fingerprint}`) {
          findings.push(finding({
            conditionId: rule.conditionId,
            kind: "prediction.signal",
            outcome: "fail",
            key: `signal:${fingerprint}`,
            title: bi("Paper prediction · A research signal changed", "Паперовий прогноз · Змінився дослідницький сигнал"),
            reason: bi("A named signal on this market moved. Review the paper plan. This is not a real-money position.", "Названий сигнал на цьому ринку змінився. Переглянь паперовий план. Це не позиція за реальні кошти."),
          }));
        } else {
          findings.push(finding({
            conditionId: rule.conditionId,
            kind: "prediction.signal",
            outcome: "pass",
            key: `signal:${fingerprint}`,
            title: paper,
            reason: bi("No new named signal since the last look.", "Нового названого сигналу від останнього перегляду немає."),
          }));
        }
      }
    }
    if (rule.metric === "resolution" && rule.threshold !== null && deadline !== null) {
      const hoursLeft = (deadline - input.nowMs) / 3_600_000;
      if (hoursLeft <= rule.threshold) {
        findings.push(finding({
          conditionId: rule.conditionId,
          kind: "prediction.resolution",
          outcome: "fail",
          key: `within:${rule.threshold}`,
          title: bi("Paper prediction · Resolution is close", "Паперовий прогноз · Розв'язання близько"),
          reason: bi("This is not a real-money position.", "Це не позиція за реальні кошти."),
        }));
      }
    }
  }

  return conclude(findings, input.previous, input.plan.planId);
}

function conclude(
  findings: readonly Finding[],
  previous: readonly Observation[],
  subjectId: string,
): Readonly<{ status: MonitorStatus; findings: readonly Finding[]; crossings: readonly Crossing[] }> {
  const prior = new Map(previous.map((row) => [row.conditionId, row]));
  const crossings: Crossing[] = [];
  for (const row of findings) {
    if (!row.material) continue;
    const last = prior.get(row.conditionId);
    if (last?.key === row.key) continue;
    /* The identity is the transition, not the state: the same condition
       failing again after it recovered is a new crossing and a new note,
       while a retry of the same tick — the same prior observation — claims
       the same identity and writes nothing (2026-09-20; before it the
       identity was the state alone, and a plan that failed, recovered and
       failed again was never told the second time). */
    const since = last ? `${last.key}@${last.at}` : "first";
    crossings.push({
      identity: `${subjectId}:${row.conditionId}:${row.key}<${since}`,
      finding: row,
    });
  }

  const hasMaterial = findings.some((row) => row.material);
  const hasUnavailable = findings.some((row) => row.outcome === "unavailable");

  let status: MonitorStatus = "watching";
  if (hasMaterial) status = "needs_attention";
  else if (hasUnavailable) status = "unavailable";

  return { status, findings, crossings };
}

export function nextObservations(nowIso: string, findings: readonly Finding[]): Observation[] {
  return findings.map((row) => ({ conditionId: row.conditionId, key: row.key, at: nowIso }));
}
