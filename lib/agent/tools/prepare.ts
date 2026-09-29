/**
 * The Prepare tools — a draft in the contract's own schema, never a write to
 * the product (`RYN-AGENT-TEXT-001`; the Owner's rule of 2026-09-22 §3, §7).
 *
 * A plan draft is `PlanRules` judged and sized by the plan engine's own
 * functions, with every assumption named, opened in the builder where the
 * person edits and saves; a monitoring draft is one evidence condition the
 * builder carries into a new version; a comparison is a card of established
 * and unestablished facts that ranks nothing; a trade draft is a side, a mint
 * and a sum that open the Spot ticket, where the Review, the confirmation and
 * the wallet's signature stay. Nothing here stores a plan, activates one,
 * builds bytes or reaches a provider key.
 */

import { z } from "zod";

import { BASE58, EvidenceConditionSchema, PLAN_ID, PlanRulesSchema, planAssetKind, type AgentCard, type AgentHandoff, type PlanRules } from "../../api/v1/contract.ts";
import { validateEvidenceConditions } from "../../evidence/conditions.ts";
import { EVIDENCE_METRICS } from "../../evidence/metrics.ts";
import { INVALIDATION_EXAMPLE_UNDER_ENTRY, MAX_PRICE_OVER_ENTRY } from "../../plans/builder-defaults.ts";
import { sizingContextOf } from "../../plans/service.ts";
import { computePlanSizing, type PlanIssue } from "../../plans/sizing.ts";
import type { StockRow } from "../../stocks/universe.server.ts";
import { FRESHNESS_MS, figure, pctText, stateOf, usdCompactText, usdText, whenText, type Locale } from "../provenance.ts";
import { resolveAsset, type ResolvedAsset } from "./readers.ts";
import { evidenceRun, marketRun, retiredLine, stockRun, w } from "./research.ts";
import { emptyRun, type AgentTool, type ToolNote, type ToolRun } from "./types.ts";

const Usd = z.number().finite().positive().max(1_000_000_000);
const Query = z.string().min(1).max(44);

/** The thesis a draft carries until the person writes one: a stand-in the builder treats as empty, never words the agent invented. */
export const THESIS_STAND_IN = "—";

/** One per cent of the budget kept for costs, never under ten cents — the builder's own rule. */
const reserveFor = (budget: number): number => Math.max(0.1, Math.round(budget) / 100);

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** A per-unit price rounded the way the builder writes one: two decimals above a cent, six significant digits below. */
function roundUnit(value: number): number {
  if (value >= 0.01) return round2(value);
  return Number(value.toPrecision(6));
}

function note(section: ToolNote["section"], text: string, cites: readonly string[]): ToolNote {
  return { section, text: text.slice(0, 400), cites };
}

/* ------------------------------------------------------------ a plan draft */

const PlanDraftInput = z
  .object({
    query: Query,
    riskUsd: Usd.nullable().default(null),
    budgetUsd: Usd.nullable().default(null),
    entryUsd: Usd.nullable().default(null),
    maxPriceUsd: Usd.nullable().default(null),
    invalidationUsd: Usd.nullable().default(null),
    targetUsd: Usd.nullable().default(null),
    horizonDays: z.number().int().min(1).max(3650).nullable().default(null),
    condition: EvidenceConditionSchema.nullable().default(null),
  })
  .strict();

export const preparePlanDraft: AgentTool<typeof PlanDraftInput> = {
  name: "prepare_plan_draft",
  kind: "prepare",
  description: "A plan draft in the contract's PlanRules for one asset, from the person's figures and named assumptions, judged and sized by the plan engine — opened in the builder, never saved here.",
  input: PlanDraftInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const resolved = await resolveAsset(ctx.readers, input.query);
    if (resolved.kind === "none") {
      if (resolved.reason === "retired") return { ...emptyRun("prepare_plan_draft", "prepare", "empty"), notes: [note("observation", retiredLine(input.query, locale), [])] };
      return { ...emptyRun("prepare_plan_draft", "prepare", resolved.reason === "not-listed" ? "empty" : "unavailable"), notes: [note("observation", resolved.reason === "not-listed" ? w(locale, `“${input.query}” is not a token the catalogue lists or a confirmed stock, so no plan can name it.`, `«${input.query}» — не токен із каталогу і не підтверджена акція, тож план не може його назвати.`) : w(locale, `The catalogue did not answer for “${input.query}” right now.`, `Каталог зараз не відповів щодо «${input.query}».`), [])] };
    }
    const asset = await ctx.readers.planAsset(resolved.mint);
    /* The asset as the plan would carry it, with its own figures beside the draft, so the person sees what the draft stands on. */
    const read = resolved.kind === "stock" ? stockRun(resolved.row, ctx) : marketRun(resolved.market, resolved.observedAt, resolved.stale, ctx);
    if (!asset.ok) {
      return { ...read, tool: "prepare_plan_draft", kind: "prepare", outcome: "refused", notes: [...read.notes.filter((entry) => entry.section === "observation"), note("meaning", w(locale, `No plan can name ${resolved.symbol}: ${asset.message}`, `План не може назвати ${resolved.symbol}: ${asset.message}`), read.cards.map((card) => ("cite" in card ? card.cite : "")).filter(Boolean))], draft: null };
    }
    const planAsset = asset.read.asset;
    const token = planAssetKind(planAsset) !== "stock";
    const unit = (planAsset.unitBasis ?? "share") === "share" ? w(locale, "per share", "за акцію") : w(locale, "per token", "за токен");
    const cite = ctx.citations.add({ tool: "prepare_plan_draft", source: w(locale, "Plan engine (draft)", "Рушій планів (чернетка)"), observedAt: asset.read.observedAt, state: asset.read.planningPrice ? asset.read.planningPrice.state : "unknown", ref: resolved.mint, href: `/app/strategies/new?mint=${resolved.mint}` });
    const assumptions: string[] = [];
    const entry = input.entryUsd ?? asset.read.planningPrice?.perUnit ?? null;
    if (input.entryUsd === null && asset.read.planningPrice) assumptions.push(w(locale, `Entry taken as the planning price ${usdText(asset.read.planningPrice.perUnit, locale)} ${unit} (${asset.read.planningPrice.source}, ${whenText(asset.read.planningPrice.observedAt, locale)}, ${asset.read.planningPrice.state}) — an indication, not the executable quote.`, `Вхід узято як ціну планування ${usdText(asset.read.planningPrice.perUnit, locale)} ${unit} (${asset.read.planningPrice.source}, ${whenText(asset.read.planningPrice.observedAt, locale)}, ${asset.read.planningPrice.state === "current" ? "актуально" : "застаріло"}) — індикація, не виконуване котирування.`));
    const draftId = ctx.newDraftId();
    if (entry === null) {
      /* No indication and no figure from the person: nothing is invented; the builder asks for the entry. */
      const handoff: AgentHandoff = { kind: "builder", href: `/app/strategies/new?mint=${resolved.mint}${input.budgetUsd ? `&budget=${input.budgetUsd}` : ""}`, label: w(locale, "Open in the builder", "Відкрити у конструкторі"), primary: true };
      const card: AgentCard = { kind: "planDraft", draftId, asset: planAsset, rules: null, sizing: null, planningPrice: null, prefill: { entryUsd: null, maxPriceUsd: input.maxPriceUsd, invalidationUsd: input.invalidationUsd, targetUsd: input.targetUsd, budgetUsd: input.budgetUsd, riskUsd: input.riskUsd, validUntil: null }, issues: [{ path: "entry.pricePerShare", message: w(locale, "No price indication is available for this asset right now; write the entry yourself in the builder.", "Індикації ціни для цього активу зараз немає; впиши вхід сам у конструкторі.") }], assumptions: [w(locale, "Nothing was assumed about the entry: no indication was available and no figure was named.", "Про вхід нічого не припущено: індикації не було, цифри не названо.")], handoff };
      return { tool: "prepare_plan_draft", kind: "prepare", outcome: "ok", state: "unknown", facts: read.facts, notes: [...read.notes.filter((entry) => entry.section === "observation"), note("meaning", w(locale, `A draft on ${resolved.symbol} needs an entry price: no indication is available right now, and none is invented. The builder opens with the asset and asks for it.`, `Чернетці на ${resolved.symbol} потрібна ціна входу: індикації зараз немає, і вона не вигадується. Конструктор відкривається з активом і питає її.`), [cite.id])], cards: [...read.cards, card], handoffs: [handoff], draft: card };
    }
    const maxPrice = input.maxPriceUsd ?? roundUnit(entry * MAX_PRICE_OVER_ENTRY);
    if (input.maxPriceUsd === null) assumptions.push(w(locale, `Maximum price ${usdText(maxPrice, locale)} — two per cent above the entry, the builder's protective default.`, `Максимальна ціна ${usdText(maxPrice, locale)} — на два відсотки вище входу, захисне значення конструктора.`));
    const invalidation = input.invalidationUsd ?? roundUnit(entry * INVALIDATION_EXAMPLE_UNDER_ENTRY);
    if (input.invalidationUsd === null) assumptions.push(w(locale, `Invalidation ${usdText(invalidation, locale)} — ten per cent under the entry, an example to replace with where your thesis is wrong.`, `Інвалідація ${usdText(invalidation, locale)} — на десять відсотків нижче входу, приклад, який заміни на рівень, де твоя теза хибна.`));
    const costBufferBps = 100;
    const lossPerUnit = entry - invalidation + (entry * costBufferBps) / 10_000;
    let risk = input.riskUsd;
    let budget = input.budgetUsd;
    if (risk === null && budget !== null) {
      /* The person named money but not a loss: the risk is assumed as a tenth of the budget and said so. */
      risk = round2(budget / 10);
      assumptions.push(w(locale, `Planned risk ${usdText(risk, locale)} — a tenth of the budget, assumed; the loss you plan for is your decision.`, `Плановий ризик ${usdText(risk, locale)} — десята частина бюджету, припущення; збиток, який ти плануєш, — твоє рішення.`));
    }
    if (risk === null && budget === null) {
      /* The prices are established; the money is the person's and is never invented: the draft opens with the prices filled and asks for the risk and the budget. */
      const validUntilOpen = new Date(ctx.nowMs + (input.horizonDays ?? 30) * 86_400_000).toISOString();
      const handoffOpen: AgentHandoff = { kind: "builder", href: `/app/strategies/new?mint=${resolved.mint}&draft=${draftId}`, label: w(locale, "Open the draft in the builder", "Відкрити чернетку у конструкторі"), primary: true };
      const cardOpen: AgentCard = { kind: "planDraft", draftId, asset: planAsset, rules: null, sizing: null, planningPrice: asset.read.planningPrice, prefill: { entryUsd: roundUnit(entry), maxPriceUsd: maxPrice, invalidationUsd: roundUnit(invalidation), targetUsd: input.targetUsd !== null ? roundUnit(input.targetUsd) : null, budgetUsd: null, riskUsd: null, validUntil: validUntilOpen }, issues: [{ path: "risk.plannedRiskUsd", message: w(locale, "Name the most you are willing to lose (the planned risk) and the budget in the builder; money is yours to decide.", "Назви у конструкторі, скільки ти готовий втратити (плановий ризик), і бюджет; гроші — твоє рішення.") }], assumptions: assumptions.slice(0, 10), handoff: handoffOpen };
      const factsOpen = [
        { ...figure({ label: w(locale, `Entry ${unit}`, `Вхід ${unit}`), number: roundUnit(entry), kind: "usd", unit: "USD", state: "current", cite: cite.id }, locale), key: "draft.entry" },
        { ...figure({ label: w(locale, "Max price", "Макс. ціна"), number: maxPrice, kind: "usd", unit: "USD", state: "current", cite: cite.id }, locale), key: "draft.maxPrice" },
        { ...figure({ label: w(locale, "Invalidation", "Інвалідація"), number: roundUnit(invalidation), kind: "usd", unit: "USD", state: "current", cite: cite.id }, locale), key: "draft.invalidation" },
      ];
      const notesOpen: ToolNote[] = [
        ...read.notes.filter((entry) => entry.section === "observation"),
        note("meaning", w(locale, `The draft on ${planAsset.symbol}: entry ${factsOpen[0].value} ${unit}, refuse above ${factsOpen[1].value}, invalidation ${factsOpen[2].value}. The planned risk and the budget are yours: the builder asks for them, and sizes the plan once they are written.`, `Чернетка на ${planAsset.symbol}: вхід ${factsOpen[0].value} ${unit}, відмова вище ${factsOpen[1].value}, інвалідація ${factsOpen[2].value}. Плановий ризик і бюджет — твої: конструктор запитає їх і розрахує розмір, щойно вони записані.`), [cite.id]),
        ...assumptions.map((assumption) => note("risks", assumption, [cite.id])),
        note("actions", w(locale, "Open the draft in the builder, write the risk, the budget and the thesis, then save or activate it — Ryntra saved nothing.", "Відкрий чернетку у конструкторі, впиши ризик, бюджет і тезу, потім збережи або активуй — Ryntra нічого не зберегла."), [cite.id]),
      ];
      return { tool: "prepare_plan_draft", kind: "prepare", outcome: "ok", state: cite.state, facts: [...read.facts, ...factsOpen], notes: notesOpen, cards: [...read.cards, cardOpen], handoffs: [handoffOpen, ...read.handoffs], draft: cardOpen };
    }
    if (budget === null && risk !== null) {
      /* The budget is the sum the planned risk sizes to, so the risk — the person's figure — is what limits the size; the reserve on top. */
      const units = lossPerUnit > 0 ? risk / lossPerUnit : 0;
      const notional = units * entry * 1.01;
      budget = Math.max(1, round2(notional + reserveFor(Math.max(1, notional))));
      assumptions.push(w(locale, `Budget ${usdText(budget, locale)} — the sum your planned risk sizes to at these prices (plus the reserve for costs), so the risk limits the size; raise or lower it in the builder.`, `Бюджет ${usdText(budget, locale)} — сума, до якої твій плановий ризик розміряє позицію за цими цінами (плюс резерв на витрати), тож розмір обмежує ризик; зміни його в конструкторі.`));
    }
    const reserve = round2(reserveFor(budget!));
    const validUntil = new Date(ctx.nowMs + (input.horizonDays ?? 30) * 86_400_000).toISOString();
    if (input.horizonDays === null) assumptions.push(w(locale, "The entry stays valid thirty days — the builder's default.", "Вхід дійсний тридцять днів — значення конструктора."));
    assumptions.push(w(locale, "The thesis is yours to write: the draft carries none.", "Тезу пишеш ти: чернетка її не несе."));
    const hasReference = !token && resolved.kind === "stock" && resolved.row.reference.perShare !== null;
    const rulesInput = {
      thesis: { text: THESIS_STAND_IN, whyNow: null, horizon: input.horizonDays ? { unit: "days" as const, value: Math.min(60, input.horizonDays) } : null, sources: [], assumptions: [] },
      entry: { pricePerShare: roundUnit(entry), maxPricePerShare: maxPrice, validUntil },
      capital: { budgetUsd: round2(budget!), reserveForCostsUsd: reserve },
      risk: { invalidationPerShare: roundUnit(invalidation), plannedRiskUsd: round2(risk!), costBufferBps },
      exit: { targetPerShare: input.targetUsd !== null ? roundUnit(input.targetUsd) : null, timeExitAt: null, invalidationIsOrder: false as const },
      execution: { maxSlippageBps: 50, maxQuoteAgeSeconds: 60, maxReferenceDeviationPct: hasReference ? 1.5 : null, referenceRequired: hasReference, minLiquidityUsd: null },
      evidenceConditions: input.condition ? [input.condition] : [],
    };
    const parsed = PlanRulesSchema.safeParse(rulesInput);
    const issues: PlanIssue[] = [];
    let rules: PlanRules | null = null;
    if (!parsed.success) {
      for (const issue of parsed.error.issues.slice(0, 8)) issues.push({ path: issue.path.join("."), message: issue.message });
    } else {
      rules = parsed.data;
      const conditionIssues = validateEvidenceConditions(rules.evidenceConditions);
      issues.push(...conditionIssues.map((issue) => ({ path: issue.path, message: issue.message })));
    }
    const sized = rules ? computePlanSizing(rules, ctx.nowMs, sizingContextOf(planAsset)) : null;
    if (sized && !sized.ok) issues.push(...sized.issues);
    const sizing = sized && sized.ok ? sized.sizing : null;
    const handoff: AgentHandoff = { kind: "builder", href: `/app/strategies/new?mint=${resolved.mint}&draft=${draftId}`, label: w(locale, "Open the draft in the builder", "Відкрити чернетку у конструкторі"), primary: true };
    const card: AgentCard = { kind: "planDraft", draftId, asset: planAsset, rules, sizing, planningPrice: asset.read.planningPrice, prefill: { entryUsd: roundUnit(entry), maxPriceUsd: maxPrice, invalidationUsd: roundUnit(invalidation), targetUsd: input.targetUsd !== null ? roundUnit(input.targetUsd) : null, budgetUsd: round2(budget!), riskUsd: round2(risk!), validUntil }, issues: issues.slice(0, 32).map((issue) => ({ path: issue.path, message: issue.message, ...(issue.code ? { code: issue.code } : {}) })), assumptions: assumptions.slice(0, 10), handoff };
    const facts = [
      { ...figure({ label: w(locale, `Entry ${unit}`, `Вхід ${unit}`), number: roundUnit(entry), kind: "usd", unit: "USD", state: "current", cite: cite.id }, locale), key: "draft.entry" },
      { ...figure({ label: w(locale, "Max price", "Макс. ціна"), number: maxPrice, kind: "usd", unit: "USD", state: "current", cite: cite.id }, locale), key: "draft.maxPrice" },
      { ...figure({ label: w(locale, "Invalidation", "Інвалідація"), number: roundUnit(invalidation), kind: "usd", unit: "USD", state: "current", cite: cite.id }, locale), key: "draft.invalidation" },
      { ...figure({ label: w(locale, "Planned risk", "Плановий ризик"), number: round2(risk!), kind: "usd", unit: "USD", state: "current", cite: cite.id }, locale), key: "draft.risk" },
      { ...figure({ label: w(locale, "Budget", "Бюджет"), number: round2(budget!), kind: "usd", unit: "USD", state: "current", cite: cite.id }, locale), key: "draft.budget" },
      { ...figure({ label: w(locale, "Size", "Розмір"), number: sizing?.units ?? null, kind: "units", unit: planAsset.symbol, state: sizing ? "current" : "unavailable", cite: cite.id }, locale), key: "draft.size" },
    ];
    const notes: ToolNote[] = [...read.notes.filter((entry) => entry.section === "observation")];
    if (sizing) {
      notes.push(note("meaning", w(locale, `The draft on ${planAsset.symbol}: entry ${facts[0].value} ${unit}, refuse above ${facts[1].value}, invalidation ${facts[2].value}, planned risk ${facts[3].value} inside a budget of ${facts[4].value} — the engine sizes it to ${facts[5].value} ${planAsset.symbol} (${usdText(sizing.notionalUsd, locale)}), limited by the ${sizing.limitedBy === "risk" ? "planned risk" : "budget"}.`, `Чернетка на ${planAsset.symbol}: вхід ${facts[0].value} ${unit}, відмова вище ${facts[1].value}, інвалідація ${facts[2].value}, плановий ризик ${facts[3].value} у бюджеті ${facts[4].value} — рушій розміряє її до ${facts[5].value} ${planAsset.symbol} (${usdText(sizing.notionalUsd, locale)}), обмежено ${sizing.limitedBy === "risk" ? "плановим ризиком" : "бюджетом"}.`), [cite.id]));
    } else {
      notes.push(note("meaning", w(locale, `The figures do not make a plan yet: ${issues.map((issue) => issue.message).join(" ")} The builder opens on the draft for you to fix them.`, `Цифри ще не складають план: ${issues.map((issue) => issue.message).join(" ")} Конструктор відкриється на чернетці, щоб ти їх виправив.`), [cite.id]));
    }
    for (const assumption of assumptions) notes.push(note("risks", assumption, [cite.id]));
    if (token) notes.push(note("counter", w(locale, `A plan on a token has no issuer reference: the invalidation is a rule you act on, and the Review judges liquidity from the catalogue and the price from a fresh quote.`, `План на токен не має референсу емітента: інвалідація — правило, за яким дієш ти, а Review судить ліквідність із каталогу і ціну зі свіжого котирування.`), [cite.id]));
    notes.push(note("actions", w(locale, `Open the draft in the builder, write the thesis, correct any figure, then save it as a draft or activate it — Ryntra saved nothing.`, `Відкрий чернетку у конструкторі, напиши тезу, виправ будь-яку цифру і збережи як чернетку або активуй — Ryntra нічого не зберегла.`), [cite.id]));
    return { tool: "prepare_plan_draft", kind: "prepare", outcome: "ok", state: cite.state, facts: [...read.facts, ...facts], notes, cards: [...read.cards, card], handoffs: [handoff, ...read.handoffs], draft: card };
  },
};

/* ------------------------------------------------------------ a monitoring draft */

const MonitoringDraftInput = z
  .object({
    query: Query.optional(),
    planId: z.string().regex(PLAN_ID).optional(),
    condition: EvidenceConditionSchema,
  })
  .strict();

function conditionHref(condition: z.output<typeof EvidenceConditionSchema>): string {
  return `${condition.metric}:${condition.window}:${condition.operator}:${condition.threshold}`;
}

export const prepareMonitoringDraft: AgentTool<typeof MonitoringDraftInput> = {
  name: "prepare_monitoring_draft",
  kind: "prepare",
  description: "One evidence condition on a plan (a new version) or an asset (a new plan), in the contract's shape, with the observation it stands against now — carried into the builder, never saved here.",
  input: MonitoringDraftInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const metric = EVIDENCE_METRICS.find((entry) => entry.id === input.condition.metric);
    const label = metric ? (locale === "uk" ? metric.words.uk.label : metric.words.en.label) : input.condition.metric;
    let subject: Extract<AgentCard, { kind: "monitoringDraft" }>["subject"] | null = null;
    let mint: string | null = null;
    if (input.planId || (input.query && !BASE58.test(input.query))) {
      const listed = await ctx.readers.plans(ctx.owner);
      const plan = input.planId ? listed.plans.find((entry) => entry.id === input.planId) ?? null : listed.plans.find((entry) => entry.status === "active" && entry.asset.symbol.toLowerCase() === input.query!.toLowerCase()) ?? listed.plans.find((entry) => entry.asset.symbol.toLowerCase() === input.query!.toLowerCase()) ?? null;
      if (plan) {
        subject = { kind: "plan", planId: plan.id, symbol: plan.asset.symbol };
        mint = plan.asset.mint;
      }
    }
    if (subject === null && input.query) {
      const resolved = await resolveAsset(ctx.readers, input.query);
      if (resolved.kind === "none") return { ...emptyRun("prepare_monitoring_draft", "prepare", resolved.reason === "not-listed" || resolved.reason === "retired" ? "empty" : "unavailable"), notes: [note("observation", resolved.reason === "retired" ? retiredLine(input.query, locale) : w(locale, `“${input.query}” is not a plan of yours or a token the catalogue lists.`, `«${input.query}» — не твій план і не токен із каталогу.`), [])] };
      subject = { kind: "asset", mint: resolved.mint, symbol: resolved.symbol };
      mint = resolved.mint;
    }
    if (subject === null || mint === null) return { ...emptyRun("prepare_monitoring_draft", "prepare", "empty"), notes: [note("meaning", w(locale, "A monitoring rule needs a plan or an asset to stand on: name one.", "Правилу Нагляду потрібен план або актив: назви один."), [])] };
    const read = await ctx.readers.evidence({ mint, window: input.condition.window });
    const evidence = evidenceRun(read, { mint, window: input.condition.window, symbol: subject.symbol }, ctx);
    const observed = evidence.facts.find((factRow) => factRow.key === `evidence.${input.condition.metric}`) ?? null;
    const draftId = ctx.newDraftId();
    const href = subject.kind === "plan" ? `/app/strategies/new?plan=${subject.planId}&evidence=${encodeURIComponent(conditionHref(input.condition))}` : `/app/strategies/new?mint=${mint}&evidence=${encodeURIComponent(conditionHref(input.condition))}`;
    const handoff: AgentHandoff = { kind: "builder", href, label: subject.kind === "plan" ? w(locale, "Add the rule as a new version", "Додати правило новою версією") : w(locale, "Start a plan with this rule", "Почати план із цим правилом"), primary: true };
    const cite = ctx.citations.add({ tool: "prepare_monitoring_draft", source: w(locale, "Monitoring draft", "Чернетка Нагляду"), observedAt: new Date(ctx.nowMs).toISOString(), state: "current", ref: subject.kind === "plan" ? subject.planId : mint, href });
    const operatorWord = { gt: w(locale, "above", "вище"), gte: w(locale, "at least", "не менше"), lt: w(locale, "below", "нижче"), lte: w(locale, "at most", "не більше") }[input.condition.operator];
    const thresholdText = metric?.unit === "usd" ? usdCompactText(input.condition.threshold, locale) : metric?.unit === "percent" ? pctText(input.condition.threshold, locale).replace("+", "") : metric?.unit === "flag" ? (input.condition.threshold >= 1 ? w(locale, "present", "є") : w(locale, "renounced", "відкликано")) : String(input.condition.threshold);
    const assumptions = [
      w(locale, `Mode ${input.condition.mode}: ${input.condition.mode === "required" ? "the Review refuses the plan's version when the rule is not met or cannot be judged" : "the Review names the rule and you decide"}.`, `Режим ${input.condition.mode === "required" ? "обов'язковий: Review відмовляє версії плану, коли правило не виконане чи не оцінене" : "дорадчий: Review називає правило, а вирішуєш ти"}.`),
      w(locale, "Monitoring watches a plan's rules once the plan is active; a rule outside a plan is not watched.", "Нагляд стежить за правилами плану, коли план активний; правило поза планом не стежиться."),
    ];
    const card: AgentCard = { kind: "monitoringDraft", draftId, subject, condition: input.condition, observed: observed ? { label: observed.label, value: observed.value, number: observed.number, unit: observed.unit, state: observed.state, cite: observed.cite } : null, assumptions, handoff };
    const notes: ToolNote[] = [
      note("meaning", w(locale, `The rule: ${label} ${operatorWord} ${thresholdText} over ${input.condition.window}${observed ? ` — observed now ${observed.value} (${observed.state})` : " — no observation is available now"}. ${subject.kind === "plan" ? `It goes onto your ${subject.symbol} plan as a new version you save.` : `It starts a plan on ${subject.symbol} that you write and save.`}`, `Правило: ${label} ${operatorWord} ${thresholdText} за ${input.condition.window}${observed ? ` — зараз спостерігається ${observed.value} (${observed.state === "current" ? "актуально" : observed.state === "stale" ? "застаріло" : "недоступно"})` : " — спостереження зараз недоступне"}. ${subject.kind === "plan" ? `Воно ляже на твій план ${subject.symbol} новою версією, яку ти збережеш.` : `Воно починає план на ${subject.symbol}, який ти напишеш і збережеш.`}`), [cite.id, ...(observed ? [observed.cite] : [])]),
      ...evidence.notes.filter((entry) => entry.section === "observation"),
      note("actions", w(locale, "Open the builder with the rule carried in; Ryntra saved nothing.", "Відкрий конструктор із перенесеним правилом; Ryntra нічого не зберегла."), [cite.id]),
    ];
    return { tool: "prepare_monitoring_draft", kind: "prepare", outcome: "ok", state: observed?.state ?? "unknown", facts: evidence.facts, notes, cards: [...evidence.cards, card], handoffs: [handoff], draft: card };
  },
};

/* ------------------------------------------------------------ a comparison */

const ComparisonInput = z.object({ items: z.array(Query).min(1).max(4) }).strict();

type Cell = Readonly<{ text: string; established: boolean; cite: string | null }>;

const unknownCell = (locale: Locale): Cell => ({ text: w(locale, "unknown / not established", "невідомо / не встановлено"), established: false, cite: null });

function sameCompany(a: StockRow, b: StockRow): boolean {
  const ra = a.representation;
  const rb = b.representation;
  if (ra.companyKey && rb.companyKey) return ra.companyKey === rb.companyKey;
  return ra.underlying.symbol.toLowerCase() === rb.underlying.symbol.toLowerCase();
}

export const prepareComparison: AgentTool<typeof ComparisonInput> = {
  name: "prepare_comparison",
  kind: "prepare",
  description: "A side-by-side of two to four assets — or every representation of one company — as established facts with citations and 'unknown / not established' where none exists; nothing is ranked as best.",
  input: ComparisonInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const resolved: ResolvedAsset[] = [];
    for (const item of input.items) resolved.push(await resolveAsset(ctx.readers, item));
    let items = resolved.filter((entry): entry is Exclude<ResolvedAsset, { kind: "none" }> => entry.kind !== "none");
    /* One stock named: the comparison is the company's representations across issuers. */
    if (items.length === 1 && items[0].kind === "stock") {
      const anchor = items[0];
      const universe = await ctx.readers.stockRow(anchor.mint);
      if (universe.ok) {
        const others = universe.universe.rows.filter((row) => row.representation.mint !== anchor.mint && sameCompany(row, anchor.row)).slice(0, 3);
        items = [anchor, ...others.map((row) => ({ kind: "stock" as const, row, mint: row.representation.mint, symbol: row.representation.symbol }))];
      }
    }
    if (items.length < 2) {
      const missing = resolved.filter((entry) => entry.kind === "none").map((entry) => (entry.kind === "none" ? entry.query : ""));
      return { ...emptyRun("prepare_comparison", "prepare", "empty"), notes: [note("meaning", items.length === 1 ? w(locale, `Only ${items[0].symbol} could be placed${missing.length ? ` (${missing.join(", ")} is not on the catalogue)` : ""}; a comparison needs two.`, `Вдалося визначити лише ${items[0].symbol}${missing.length ? ` (${missing.join(", ")} немає в каталозі)` : ""}; порівнянню потрібні два.`) : w(locale, `None of ${input.items.join(", ")} is a token the catalogue lists or a confirmed stock.`, `Жоден із ${input.items.join(", ")} не є токеном каталогу чи підтвердженою акцією.`), [])] };
    }
    const runs = items.map((entry) => (entry.kind === "stock" ? stockRun(entry.row, ctx) : marketRun(entry.market, entry.observedAt, entry.stale, ctx)));
    const columns = items.map((entry) => ({ id: entry.mint, label: entry.symbol.slice(0, 160) }));
    const allStocks = items.every((entry) => entry.kind === "stock");
    const rows: { label: string; cells: Cell[] }[] = [];
    const cellOf = (run: ToolRun, key: string): Cell => {
      const factRow = run.facts.find((entry) => entry.key === key);
      if (!factRow || factRow.state === "unavailable" || factRow.state === "unknown") return unknownCell(locale);
      return { text: factRow.value, established: true, cite: factRow.cite };
    };
    const citeOf = (run: ToolRun): string | null => (run.cards[0] && "cite" in run.cards[0] ? run.cards[0].cite : null);
    if (allStocks) {
      const stocks = items as Extract<ResolvedAsset, { kind: "stock" }>[];
      rows.push({ label: w(locale, "Issuer", "Емітент"), cells: stocks.map((entry, i) => ({ text: entry.row.representation.issuer.label, established: true, cite: citeOf(runs[i]) })) });
      rows.push({ label: w(locale, "Instrument", "Інструмент"), cells: stocks.map((entry, i) => ({ text: entry.row.representation.instrument.class === "pre-ipo" ? w(locale, "pre-IPO", "pre-IPO") : w(locale, "listed equity", "лістингована акція"), established: true, cite: citeOf(runs[i]) })) });
      rows.push({ label: w(locale, "Rights", "Права"), cells: stocks.map((entry, i) => ({ text: { "issuer-terms": w(locale, "the issuer's terms", "умови емітента"), "economic-exposure": w(locale, "economic exposure", "економічна експозиція"), "loan-participation": w(locale, "loan participation", "участь у позиці") }[entry.row.representation.instrument.rights], established: true, cite: citeOf(runs[i]) })) });
      rows.push({ label: w(locale, "Unit", "Одиниця"), cells: stocks.map((entry, i) => ({ text: entry.row.representation.instrument.unitBasis === "share" ? w(locale, "one share", "одна акція") : w(locale, "one token", "один токен"), established: true, cite: citeOf(runs[i]) })) });
      rows.push({ label: w(locale, "Price", "Ціна"), cells: runs.map((run) => cellOf(run, "price")) });
      rows.push({ label: w(locale, "Issuer reference", "Референс емітента"), cells: runs.map((run) => cellOf(run, "reference")) });
      rows.push({ label: w(locale, "Deviation", "Відхилення"), cells: runs.map((run) => cellOf(run, "deviation")) });
      rows.push({ label: w(locale, "Session", "Сесія"), cells: runs.map((run) => cellOf(run, "session")) });
      rows.push({ label: w(locale, "Liquidity", "Ліквідність"), cells: runs.map((run) => cellOf(run, "liquidity")) });
      rows.push({ label: w(locale, "24h volume", "Обсяг за 24 год"), cells: runs.map((run) => cellOf(run, "volume24h")) });
      rows.push({ label: w(locale, "Multiplier", "Множник"), cells: runs.map((run) => cellOf(run, "multiplier")) });
      rows.push({ label: w(locale, "Transfer fee", "Комісія за переказ"), cells: stocks.map((entry, i) => (entry.row.transferFee ? { text: `${(entry.row.transferFee.basisPoints / 100).toFixed(2)} %`, established: true, cite: citeOf(runs[i]) } : entry.row.transferFee === null && entry.row.representation.tokenProgram ? { text: w(locale, "none read", "не зчитано"), established: true, cite: citeOf(runs[i]) } : unknownCell(locale))) });
      rows.push({ label: w(locale, "Lifecycle", "Життєвий цикл"), cells: stocks.map((entry, i) => (entry.row.lifecycle.source === "none" ? unknownCell(locale) : { text: `${entry.row.lifecycle.state}${entry.row.lifecycle.tradable ? "" : ` · ${w(locale, "not for a new purchase", "не для нової покупки")}`}`, established: true, cite: citeOf(runs[i]) })) });
      rows.push({ label: w(locale, "Redemption · dividends · corporate actions", "Викуп · дивіденди · корпоративні дії"), cells: stocks.map((entry, i) => (entry.row.representation.issuerNote ? { text: entry.row.representation.issuerNote.slice(0, 160), established: true, cite: citeOf(runs[i]) } : unknownCell(locale))) });
    } else {
      rows.push({ label: w(locale, "Kind", "Вид"), cells: items.map((entry, i) => ({ text: entry.kind === "stock" ? w(locale, "tokenized stock", "токенізована акція") : entry.market.category === "meme" ? w(locale, "meme", "мем") : entry.market.category === "crypto" ? w(locale, "crypto", "крипто") : w(locale, "uncategorised", "без категорії"), established: true, cite: citeOf(runs[i]) })) });
      rows.push({ label: w(locale, "Price", "Ціна"), cells: runs.map((run) => cellOf(run, "price")) });
      rows.push({ label: w(locale, "24h change", "Зміна за 24 год"), cells: runs.map((run) => cellOf(run, "change24h")) });
      rows.push({ label: w(locale, "Liquidity", "Ліквідність"), cells: runs.map((run) => cellOf(run, "liquidity")) });
      rows.push({ label: w(locale, "24h volume", "Обсяг за 24 год"), cells: runs.map((run) => cellOf(run, "volume24h")) });
      rows.push({ label: w(locale, "Market cap", "Капіталізація"), cells: runs.map((run) => cellOf(run, "marketCap")) });
      rows.push({ label: w(locale, "Holders", "Тримачі"), cells: runs.map((run) => cellOf(run, "holders")) });
      rows.push({ label: w(locale, "Verified", "Верифікація"), cells: items.map((entry, i) => ({ text: entry.kind === "stock" ? w(locale, "confirmed representation", "підтверджене представлення") : entry.market.verified ? w(locale, "Jupiter verified", "верифіковано Jupiter") : w(locale, "not verified", "не верифіковано"), established: true, cite: citeOf(runs[i]) })) });
      rows.push({ label: w(locale, "Mint authority", "Право емісії"), cells: items.map((entry, i) => (entry.kind === "token" && entry.market.audit.mintAuthorityDisabled !== null ? { text: entry.market.audit.mintAuthorityDisabled ? w(locale, "renounced", "відкликано") : w(locale, "present", "є"), established: true, cite: citeOf(runs[i]) } : unknownCell(locale))) });
      rows.push({ label: w(locale, "Top holders", "Найбільші тримачі"), cells: items.map((entry, i) => (entry.kind === "token" && entry.market.audit.topHoldersPct !== null ? { text: pctText(entry.market.audit.topHoldersPct, locale).replace("+", ""), established: true, cite: citeOf(runs[i]) } : unknownCell(locale))) });
    }
    const noteText = allStocks
      ? w(locale, "Established facts from the issuers' catalogues, the chain and the venue; a cell that reads unknown is not a zero and not a fault. Nothing here ranks a representation as best — the Review prices the exact deal.", "Установлені факти з каталогів емітентів, ланцюга і майданчика; клітинка «невідомо» — не нуль і не вада. Ніщо тут не називає представлення найкращим — Review оцінює саме угоду.")
      : w(locale, "Established facts from the Spot catalogue and the stock desk; unknown is unknown. Nothing here ranks an asset as best.", "Установлені факти з каталогу Spot і столу акцій; невідоме лишається невідомим. Ніщо тут не називає актив найкращим.");
    const href = allStocks ? `/app/stocks/${encodeURIComponent(items[0].symbol)}` : null;
    const card: AgentCard = { kind: "comparison", title: w(locale, `${items.map((entry) => entry.symbol).join(" · ")}`, `${items.map((entry) => entry.symbol).join(" · ")}`).slice(0, 160), columns, rows: rows.slice(0, 24), note: noteText, href };
    const cites = runs.map(citeOf).filter((cite): cite is string => cite !== null);
    const notes: ToolNote[] = [
      ...runs.flatMap((run) => run.notes.filter((entry) => entry.section === "observation")),
      note("meaning", allStocks ? w(locale, `${items.map((entry) => entry.symbol).join(" and ")} are ${items.length} representations of ${items[0].kind === "stock" ? items[0].row.representation.underlying.name ?? items[0].row.representation.underlying.symbol : ""} by different issuers: the same company, different terms — the rights, the unit and the reference are what differ, and the card sets them side by side.`, `${items.map((entry) => entry.symbol).join(" і ")} — ${items.length} представлення ${items[0].kind === "stock" ? items[0].row.representation.underlying.name ?? items[0].row.representation.underlying.symbol : ""} від різних емітентів: та сама компанія, різні умови — відрізняються права, одиниця і референс, і картка ставить їх поруч.`) : w(locale, `${items.map((entry) => entry.symbol).join(" and ")} set side by side on the venue's figures; where a fact is not established the card says so.`, `${items.map((entry) => entry.symbol).join(" і ")} поставлено поруч на цифрах майданчика; де факт не встановлено, картка так і каже.`), cites),
      note("counter", w(locale, "A comparison is a moment's figures; liquidity and deviation move, and the Review prices the exact deal at signing time.", "Порівняння — цифри одного моменту; ліквідність і відхилення рухаються, а Review оцінює саме угоду в момент підпису."), cites),
      ...runs.flatMap((run) => run.notes.filter((entry) => entry.section === "risks")).slice(0, 4),
    ];
    return { tool: "prepare_comparison", kind: "prepare", outcome: "ok", state: "current", facts: runs.flatMap((run) => run.facts), notes, cards: [card, ...runs.flatMap((run) => run.cards)].slice(0, 6), handoffs: runs.flatMap((run) => run.handoffs).slice(0, 4), draft: null };
  },
};

/* ------------------------------------------------------------ a trade draft */

const TradeDraftInput = z.object({ query: Query, side: z.enum(["BUY", "SELL"]).default("BUY"), amountUsd: Usd.nullable().default(null) }).strict();

export const prepareTradeDraft: AgentTool<typeof TradeDraftInput> = {
  name: "prepare_trade_draft",
  kind: "prepare",
  description: "A trade intention — side, mint, sum — that opens the Spot ticket, bound to the wallet's active plan on the asset where one exists; the fresh quote, the Review, the confirmation and the signature stay on the ticket. Never a transaction.",
  input: TradeDraftInput,
  async run(input, ctx) {
    const locale = ctx.locale;
    const resolved = await resolveAsset(ctx.readers, input.query);
    if (resolved.kind === "none") return { ...emptyRun("prepare_trade_draft", "prepare", resolved.reason === "not-listed" || resolved.reason === "retired" ? "empty" : "unavailable"), notes: [note("meaning", resolved.reason === "retired" ? retiredLine(input.query, locale) : w(locale, `“${input.query}” is not a token the catalogue lists, so no ticket can open on it.`, `«${input.query}» — не токен із каталогу, тож тікет на нього не відкрити.`), [])] };
    const read = resolved.kind === "stock" ? stockRun(resolved.row, ctx) : marketRun(resolved.market, resolved.observedAt, resolved.stale, ctx);
    const kind = resolved.kind === "stock" ? "stock" : resolved.market.category === "meme" ? "meme" : "crypto";
    const listed = await ctx.readers.plans(ctx.owner);
    const plan = listed.plans.find((entry) => entry.status === "active" && entry.asset.mint === resolved.mint) ?? null;
    const draftId = ctx.newDraftId();
    const amount = input.amountUsd !== null ? `&amount=${round2(input.amountUsd)}` : "";
    const binding = plan ? `&plan=${plan.id}&v=${plan.version}` : "";
    const href = `/app/spot?view=${kind}&mint=${resolved.mint}&side=${input.side.toLowerCase()}${amount}${binding}`;
    const handoff: AgentHandoff = { kind: "review", href, label: w(locale, `Open the ${input.side === "BUY" ? "buy" : "sell"} ticket for ${resolved.symbol}`, `Відкрити тікет на ${input.side === "BUY" ? "купівлю" : "продаж"} ${resolved.symbol}`), primary: true };
    const boundary = w(locale, "Nothing is signed or submitted here: the ticket takes a fresh quote, the Review judges it, you confirm, and your wallet signs.", "Тут нічого не підписується і не відправляється: тікет бере свіже котирування, Review його судить, ти підтверджуєш, а підписує твій гаманець.");
    const card: AgentCard = { kind: "tradeDraft", draftId, side: input.side, mint: resolved.mint, symbol: resolved.symbol, amountUsd: input.amountUsd !== null ? round2(input.amountUsd) : null, plan: plan ? { planId: plan.id, version: plan.version } : null, boundary, handoff };
    const cite = ctx.citations.add({ tool: "prepare_trade_draft", source: w(locale, "Trade draft", "Чернетка угоди"), observedAt: new Date(ctx.nowMs).toISOString(), state: "current", ref: resolved.mint, href });
    const notes: ToolNote[] = [
      ...read.notes.filter((entry) => entry.section === "observation"),
      note("meaning", plan ? w(locale, `The ticket opens under your active ${resolved.symbol} plan (version ${plan.version}): the Review judges the deal against its rules — the maximum price ${usdText(plan.current.rules.entry.maxPricePerShare, locale)}, the invalidation ${usdText(plan.current.rules.risk.invalidationPerShare, locale)}, the planned risk ${usdText(plan.current.rules.risk.plannedRiskUsd, locale)}.`, `Тікет відкривається під твоїм активним планом на ${resolved.symbol} (версія ${plan.version}): Review судить угоду за його правилами — максимальна ціна ${usdText(plan.current.rules.entry.maxPricePerShare, locale)}, інвалідація ${usdText(plan.current.rules.risk.invalidationPerShare, locale)}, плановий ризик ${usdText(plan.current.rules.risk.plannedRiskUsd, locale)}.`) : w(locale, `No active plan of yours names ${resolved.symbol}: the ticket opens without a plan, and the Review judges only the deal itself. A plan first is the way to bound the price and the risk.`, `Жоден твій активний план не називає ${resolved.symbol}: тікет відкривається без плану, і Review судить лише саму угоду. План спершу — спосіб обмежити ціну й ризик.`), [cite.id]),
      note("risks", boundary, [cite.id]),
      ...read.notes.filter((entry) => entry.section === "risks").slice(0, 3),
      note("actions", w(locale, `Open the ticket${input.amountUsd !== null ? ` with ${usdText(input.amountUsd, locale)}` : ""}; or prepare a plan on ${resolved.symbol} first.`, `Відкрий тікет${input.amountUsd !== null ? ` на ${usdText(input.amountUsd, locale)}` : ""}; або спершу підготуй план на ${resolved.symbol}.`), [cite.id]),
    ];
    return { tool: "prepare_trade_draft", kind: "prepare", outcome: "ok", state: read.state, facts: read.facts, notes, cards: [...read.cards, card], handoffs: [handoff, { kind: "builder", href: `/app/strategies/new?mint=${resolved.mint}`, label: w(locale, `Prepare a plan on ${resolved.symbol}`, `Підготувати план на ${resolved.symbol}`), primary: false }], draft: card };
  },
};

export const PREPARE_TOOLS = [preparePlanDraft, prepareMonitoringDraft, prepareComparison, prepareTradeDraft] as const;

export { stateOf, FRESHNESS_MS };
