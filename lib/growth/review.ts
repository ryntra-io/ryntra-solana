import { z } from "zod";

import { PROTECT_RULES, HOUR_MS, SIGNAL_CODES, SIGNAL_STRENGTH, type SignalCode, trustScore } from "./protect.ts";
import { PARTNER_NETWORKS, type PartnerNetwork, walletKey } from "./partner.ts";

/**
 * The review queue — S10: a case per subject, written as an append-only log.
 *
 * A subject is a partner's pool (`pool:<network>:<pool>`) or a wallet
 * (`wallet:<wallet>`). Every step is an event, numbered, never rewritten:
 * the case opening with its signals, more signals found later, the person's
 * appeal, the reviewer's freeze and decision. The log is the audit trail: who
 * did what, when, and why.
 *
 * ## What a case does to money
 *
 * While a case is open — opened by signals, reopened by new ones or by an
 * appeal — the money it covers waits: nothing becomes available on its own.
 * The reviewer's decision is one of three, each with its reason:
 * - `CLEAR` — paid as earned;
 * - `ADJUST` — paid up to the amount the reviewer names, the rest returned;
 * - `CANCEL` — nothing paid; what waited goes back to Ryntra.
 * A freeze holds a subject's money however the case stands, until it is lifted.
 *
 * The answer is due `PROTECT_RULES.reviewHours` after the case (or the appeal)
 * opened it; the queue shows what is overdue. People never see the reasons.
 */

export const REVIEW_EVENT_COLLECTION = "growthReviewEvents" as const;

export const REVIEW_EVENT_KINDS = ["OPENED", "SIGNALS", "APPEALED", "DECIDED", "FROZEN", "UNFROZEN"] as const;
export type ReviewEventKind = (typeof REVIEW_EVENT_KINDS)[number];

export const REVIEW_DECISIONS = ["CLEAR", "ADJUST", "CANCEL"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

const AT = z.string().datetime({ offset: true });
const SUBJECT = /^(?:pool:(?:solana|arc):[0-9A-Za-z]{32,66}|wallet:[0-9A-Za-z]{32,44})$/;
const MICROS = /^(?:0|[1-9][0-9]*)$/;

export const ReviewEventSchema = z
  .object({
    schema: z.literal(1),
    subject: z.string().regex(SUBJECT),
    seq: z.number().int().nonnegative(),
    kind: z.enum(REVIEW_EVENT_KINDS),
    at: AT,
    /** `system` for a run of the rules; the reviewer's admin identity; `person` for the subject's own appeal. */
    by: z.string().min(1).max(120),
    /** OPENED, SIGNALS: the codes found — never their evidence, which lives hashed and expires. */
    signals: z.array(z.enum(SIGNAL_CODES)).max(SIGNAL_CODES.length).optional(),
    decision: z.enum(REVIEW_DECISIONS).optional(),
    /** ADJUST: the most the subject is paid, USD micro-units. */
    ceilingUsdMicros: z.string().regex(MICROS).optional(),
    /** DECIDED, FROZEN, UNFROZEN: the reviewer's reason; APPEALED: the person's words. */
    note: z.string().min(1).max(1000).optional(),
    /* Any version of the rules: a newer build's event is still read, never a hole in the log. */
    rulesVersion: z.string().regex(/^protect-[0-9]+\.[0-9]+\.[0-9]+$/),
  })
  .strict()
  .refine((event) => event.seq !== 0 || event.kind === "OPENED" || event.kind === "FROZEN" || event.kind === "APPEALED", "a case begins with its opening, a freeze or an appeal")
  .refine((event) => (event.kind === "OPENED" || event.kind === "SIGNALS") === (event.signals !== undefined && event.signals.length > 0), "signals come with an opening and only there")
  .refine((event) => (event.kind === "DECIDED") === (event.decision !== undefined), "a decision is a decided event")
  .refine((event) => (event.decision === "ADJUST") === (event.ceilingUsdMicros !== undefined), "an adjustment names its amount")
  .refine((event) => !["DECIDED", "FROZEN", "UNFROZEN", "APPEALED"].includes(event.kind) || event.note !== undefined, "a decision, a freeze and an appeal say why");
export type ReviewEvent = z.output<typeof ReviewEventSchema>;

export function poolSubject(network: PartnerNetwork, pool: string): string {
  return `pool:${network}:${/^0x/i.test(pool) ? pool.toLowerCase() : pool}`;
}

export function walletSubject(wallet: string): string {
  return `wallet:${walletKey(wallet)}`;
}

export function parseSubject(subject: string): Readonly<{ kind: "pool"; network: PartnerNetwork; pool: string }> | Readonly<{ kind: "wallet"; wallet: string }> | null {
  if (!SUBJECT.test(subject)) return null;
  const [kind, a, b] = subject.split(":");
  if (kind === "wallet") return { kind: "wallet", wallet: a! };
  return (PARTNER_NETWORKS as readonly string[]).includes(a!) ? { kind: "pool", network: a as PartnerNetwork, pool: b! } : null;
}

/** Events sort by number; the key keeps them in that order under one prefix. */
export function reviewEventKey(subject: string, seq: number): string {
  return `${subject}:${String(seq).padStart(6, "0")}`;
}

export const CASE_STATES = ["OPEN", "DECIDED", "NONE"] as const;
export type CaseState = (typeof CASE_STATES)[number];

export type CaseView = Readonly<{
  subject: string;
  /** `OPEN` — waits for a decision; `DECIDED` — answered; `NONE` — no case (a freeze alone). */
  state: CaseState;
  /** Every code ever found on the subject, and those found since the last decision. */
  signals: readonly SignalCode[];
  newSignals: readonly SignalCode[];
  trust: number;
  openedAt: string | null;
  /** When the answer is due; null — nothing is due. */
  dueAt: string | null;
  overdue: boolean;
  appealed: boolean;
  decision: Readonly<{ kind: ReviewDecision; ceilingUsdMicros: string | null; note: string; by: string; at: string }> | null;
  frozen: Readonly<{ note: string; by: string; at: string }> | null;
  events: readonly ReviewEvent[];
}>;

/** A subject's case from its events, at a moment. */
export function caseOf(subject: string, events: readonly ReviewEvent[], now: string): CaseView {
  const list = [...events].filter((event) => event.subject === subject).sort((a, b) => a.seq - b.seq);
  let open = false;
  let openedAt: string | null = null;
  let since: string | null = null;
  let appealed = false;
  const all = new Set<SignalCode>();
  let fresh = new Set<SignalCode>();
  let decision: CaseView["decision"] = null;
  let frozen: CaseView["frozen"] = null;
  for (const event of list) {
    switch (event.kind) {
      case "OPENED":
      case "SIGNALS":
        for (const code of event.signals ?? []) {
          all.add(code);
          fresh.add(code);
        }
        if (!openedAt) openedAt = event.at;
        if (!open) since = event.at;
        open = true;
        break;
      case "APPEALED":
        if (!open) since = event.at;
        open = true;
        appealed = true;
        break;
      case "DECIDED":
        open = false;
        since = null;
        appealed = false;
        fresh = new Set();
        decision = { kind: event.decision!, ceilingUsdMicros: event.ceilingUsdMicros ?? null, note: event.note!, by: event.by, at: event.at };
        break;
      case "FROZEN":
        frozen = { note: event.note!, by: event.by, at: event.at };
        break;
      case "UNFROZEN":
        frozen = null;
        break;
    }
  }
  /* A freeze is answered within the same hours as a case: lifted, or decided. */
  /* A freeze is due like a case — from the freeze, or from a decision taken while it stayed: lifted or decided again. */
  const frozenDue = !open && frozen ? (decision && Date.parse(decision.at) > Date.parse(frozen.at) ? decision.at : frozen.at) : null;
  const dueFrom = open && since ? since : frozenDue;
  const dueAt = dueFrom ? new Date(Date.parse(dueFrom) + PROTECT_RULES.reviewHours * HOUR_MS).toISOString() : null;
  const codes = SIGNAL_CODES.filter((code) => all.has(code));
  return {
    subject,
    state: open ? "OPEN" : decision ? "DECIDED" : "NONE",
    signals: codes,
    newSignals: SIGNAL_CODES.filter((code) => fresh.has(code)),
    trust: trustScore(codes),
    openedAt,
    dueAt,
    overdue: dueAt !== null && Date.parse(now) > Date.parse(dueAt),
    appealed,
    decision,
    frozen,
    events: list,
  };
}

/**
 * What a subject's case does to its money now.
 * - `PAY` — nothing holds it;
 * - `HOLD` — it waits: a case open, or a freeze;
 * - `CEILING` — paid up to `ceilingUsdMicros`;
 * - `CANCEL` — nothing is paid.
 * An open case after a cancellation stays cancelled until decided otherwise; one after an adjustment holds.
 */
export type MoneyEffect = Readonly<{ kind: "PAY" | "HOLD" | "CANCEL" }> | Readonly<{ kind: "CEILING"; ceilingUsdMicros: bigint }>;

export function moneyEffect(view: CaseView): MoneyEffect {
  if (view.decision?.kind === "CANCEL") return { kind: "CANCEL" };
  if (view.frozen) return { kind: "HOLD" };
  /* Open by an appeal alone — no signal since the last decision: a question. It holds nothing the decision let go: an
     adjustment keeps its amount, a case with no decision and no signal pays as before. */
  if (view.state === "OPEN" && view.newSignals.length === 0) {
    if (view.decision?.kind === "ADJUST") return { kind: "CEILING", ceilingUsdMicros: BigInt(view.decision.ceilingUsdMicros ?? "0") };
    if (!view.decision && view.signals.length === 0) return { kind: "PAY" };
    if (view.decision) return { kind: "PAY" };
  }
  if (view.state === "OPEN") return { kind: "HOLD" };
  if (view.decision?.kind === "ADJUST") return { kind: "CEILING", ceilingUsdMicros: BigInt(view.decision.ceilingUsdMicros ?? "0") };
  return { kind: "PAY" };
}

/**
 * The signals a run found that the case does not hold since its last decision — the ones that open or reopen it. A
 * decided case covers the signals it was decided on, on the evidence it had: a code it never held reopens it, and so
 * does a code it held that shows new evidence (`renewed` — a new shared source, a new transfer).
 */
export function unseenSignals(view: CaseView, found: readonly SignalCode[], renewed: readonly SignalCode[] = []): SignalCode[] {
  /* Every code the case ever held: a code it held is raised again only on new evidence. */
  const known = new Set(view.signals);
  const again = new Set(renewed);
  /* `renewed` is new evidence since the case last looked at its signals (the caller's reference), so a renewed code is
     raised again even while open: the reviewer's next decision must see it. */
  return [...new Set(found)].filter((code) => !known.has(code) || again.has(code)).sort((a, b) => SIGNAL_CODES.indexOf(a) - SIGNAL_CODES.indexOf(b));
}

export { SIGNAL_STRENGTH };
