import type { Severity } from '../finding.ts';
import type { Scope } from '../scope.ts';
import type { FindingView, MyAgent, OrderDetail, OrderView, RunFeed, TakeView, TurnRecord } from './contract.ts';

/**
 * What Hack's windows show, worked out from the routes' views (CITY-227): an order's phase and time left, its scope in
 * one name, a finding's level and where it stands, the run's journal as steps a person reads, and the board. Pure — no
 * words, no clock, no store — so every line is tested (`view.test.mjs`); the windows put the words on it.
 *
 * Imports only types from the library: nothing of the server (or its hashing) reaches a person's browser.
 */

/* ---------------------------------------------------------------- Orders */

/** Where an order stands for a person: `soon` before its window opens, `closed` once it is past it. */
export type Phase = 'draft' | 'soon' | 'open' | 'paused' | 'closed' | 'settled';

export function phaseOf(order: Pick<OrderView, 'status' | 'opensAt' | 'closesAt'>, now: number): Phase {
  const { status } = order;
  if ((status === 'open' || status === 'paused') && now > order.closesAt) return 'closed';
  if (status === 'open' && now < order.opensAt) return 'soon';
  return status;
}

/** True when an agent may be sent to the order now. */
export const takesAgents = (order: Pick<OrderView, 'status' | 'opensAt' | 'closesAt'>, now: number): boolean => phaseOf(order, now) === 'open';

const RANK: Readonly<Record<Phase, number>> = { open: 0, soon: 1, paused: 2, closed: 3, settled: 4, draft: 5 };

/** Open orders first, the one closing soonest on top; then the rest, newest first. */
export function sortOrders<T extends Pick<OrderView, 'status' | 'opensAt' | 'closesAt'>>(orders: readonly T[], now: number): T[] {
  return [...orders].sort((a, b) => {
    const pa = phaseOf(a, now);
    const pb = phaseOf(b, now);
    if (pa !== pb) return RANK[pa] - RANK[pb];
    return pa === 'open' ? a.closesAt - b.closesAt : b.opensAt - a.opensAt;
  });
}

/** The door's head: how many orders take agents now. */
export function summaryOf(orders: readonly Pick<OrderView, 'status' | 'opensAt' | 'closesAt'>[], now: number): { open: number; total: number } {
  return { open: orders.filter((o) => takesAgents(o, now)).length, total: orders.length };
}

/** Time left in an order's window, in its biggest whole unit; `null` once it is over. */
export type Left = { readonly unit: 'd' | 'h' | 'm'; readonly n: number } | null;

export function timeLeft(closesAt: number, now: number): Left {
  const ms = closesAt - now;
  if (ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return { unit: 'm', n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { unit: 'h', n: hours };
  return { unit: 'd', n: Math.floor(hours / 24) };
}

/**
 * The scope in one name: the instructions in scope by their own names (two, and how many more), or the whole program —
 * never a program's address on the first screen (those live behind «Details»).
 */
export type ScopeName = { readonly kind: 'whole'; readonly programs: number } | { readonly kind: 'named'; readonly names: readonly string[]; readonly more: number };

export function scopeName(scope: Scope): ScopeName {
  const names = (scope.instructions ?? []).filter((n) => typeof n === 'string' && n.trim().length > 0);
  if (!names.length) return { kind: 'whole', programs: scope.programs.length };
  return { kind: 'named', names: names.slice(0, 2), more: Math.max(0, names.length - 2) };
}

/** A long address cut for «Details»: `NVcj…CKSZ`. */
export function short(value: string | null | undefined, head = 4, tail = 4): string {
  if (!value) return '—';
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/* ---------------------------------------------------------------- Agents */

const BODIES = ['engineer', 'tactician', 'scout', 'fighter', 'guardian'] as const;

/**
 * How an agent on an order looks: the person's own agent by its name and body; anyone else's by the Ring's way of
 * naming (a body and four characters of its id — no free text anyone reads), the attacker as an engineer and the
 * defender as a tactician until the characters of CITY-228 stand in.
 */
export type Look = { readonly name: string; readonly archetype: string; readonly mine: boolean };

export function lookOf(hunter: string, role: 'attacker' | 'defender' | null, mine: MyAgent | null, label: (archetype: string) => string): Look {
  if (mine && mine.id === hunter) return { name: mine.name, archetype: mine.archetype, mine: true };
  const archetype = role === 'defender' ? 'tactician' : role === 'attacker' ? 'engineer' : BODIES[hashIndex(hunter, BODIES.length)]!;
  const tag = hunter.replace(/[^0-9a-z]/gi, '').slice(0, 4).toUpperCase() || '0000';
  return { name: `${label(archetype)} ${tag}`, archetype, mine: false };
}

function hashIndex(text: string, size: number): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % size;
}

/** The person's own agent on this order, if it is there. */
export function myTake(detail: OrderDetail | null, mine: MyAgent | null): TakeView | null {
  if (!detail || !mine) return null;
  return detail.takes.find((t) => t.hunter === mine.id) ?? null;
}

/* ---------------------------------------------------------------- Findings */

/** Strongest first, as the library ranks them (`../finding.ts`); copied so no runtime of the library is bundled. */
export const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

/** Where a finding stands, as a person reads it. */
export type Tone = 'review' | 'confirmed' | 'duplicate' | 'missed' | 'blocked';

export function toneOf(status: FindingView['status']): Tone {
  switch (status) {
    case 'confirmed':
      return 'confirmed';
    case 'duplicate':
      return 'duplicate';
    case 'rejected':
      return 'missed';
    case 'blocked':
      return 'blocked';
    default:
      return 'review';
  }
}

/** The level a finding shows: the one it counts at, else the one its agent claimed (seen by the owners only). */
export const severityOf = (finding: FindingView): Severity | null => finding.severity ?? finding.claimed ?? null;

/** The protocol's owner may confirm a run the judge left for review — only one with a run in the copy behind it. */
export function canConfirm(finding: FindingView, order: Pick<OrderView, 'protocol' | 'status'>, me: string | null): boolean {
  return canReject(finding, order, me) && finding.reason === 'NEEDS_REVIEW' && !!finding.logHash;
}

/** The protocol's owner may reject any finding still under review. */
export function canReject(finding: FindingView, order: Pick<OrderView, 'protocol' | 'status'>, me: string | null): boolean {
  return !!me && me === order.protocol && order.status !== 'settled' && finding.status === 'needs_review' && !finding.sealed;
}

/** Findings newest first. */
export function sortFindings(findings: readonly FindingView[], ownerView: boolean): FindingView[] {
  return [...findings].sort((a, b) => {
    if (ownerView) {
      const wa = a.status === 'needs_review' ? 0 : 1;
      const wb = b.status === 'needs_review' ? 0 : 1;
      if (wa !== wb) return wa - wb;
    }
    return b.submittedAt - a.submittedAt;
  });
}

/* ---------------------------------------------------------------- The run, step by step */

/**
 * One step of a run as a person reads it. `read` — the agent looked at the copy; `build` — it put a move together;
 * `broke` / `held` / `unclear` — it tried the move on the copy; `filed` — it handed in a finding the judge reproduced;
 * `review` — one the judge could not decide; `refused` — the copy or its limits turned the step away. `took` and
 * `finding` are the order's own record, for a run whose journal is not served.
 */
export type StepKind = 'took' | 'read' | 'build' | 'broke' | 'held' | 'unclear' | 'filed' | 'review' | 'refused' | 'finding';

export type Step = {
  readonly n: number;
  readonly kind: StepKind;
  /** What «i» opens: the figures behind the step (sizes, units, the journal's hash). Never on the first screen. */
  readonly facts: Readonly<Record<string, string | number>>;
  /** A finding this step filed or is (the order's own record), so a tap opens its card. */
  readonly finding?: string;
  readonly severity?: Severity | null;
  readonly tone?: Tone;
  readonly role?: 'attacker' | 'defender';
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const numberOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
/** A refusal's own word, cut short — behind «i» only. */
const whyOf = (r: Rec): string => String(r.refusal ?? r.detail ?? '').slice(0, 120);
const hashOf = (v: unknown): string | null => (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v : null);

/** The harness's journal (`TurnRecord[]`) as the steps a person reads. Anything it does not know stays out. */
export function stepsOf(history: readonly TurnRecord[]): Step[] {
  const steps: Step[] = [];
  const push = (kind: StepKind, facts: Rec) => {
    const clean: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(facts)) if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) clean[k] = v;
    steps.push({ n: steps.length + 1, kind, facts: clean });
  };
  for (const turn of history) {
    const r = rec(turn?.result);
    switch (turn?.tool) {
      case 'read_account': {
        const account = rec(r.account);
        if (r.ok === true) push('read', { size: numberOf(account.dataLen) ?? '', account: short(account.address as string) });
        else push('refused', { why: whyOf(r) });
        break;
      }
      case 'assemble_tx':
        if (r.ok === true) push('build', { bytes: numberOf(r.bytes) ?? '', kind: String(r.kind ?? '') });
        else push('refused', { why: whyOf(r) });
        break;
      case 'run': {
        if (r.ok !== true) {
          push('refused', { why: whyOf(r) });
          break;
        }
        const usage = rec(r.usage);
        const facts = { steps: numberOf(usage.steps) ?? '', units: numberOf(usage.cu) ?? '', journal: short(hashOf(r.logHash), 8, 6) };
        push(r.reproduced === true ? 'broke' : r.reproduced === false ? 'held' : 'unclear', facts);
        break;
      }
      case 'submit':
        if (r.ok === true) push(r.verdict === 'PASS' ? 'filed' : 'review', { verdict: String(r.verdict ?? ''), severity: String(r.severity ?? ''), journal: short(hashOf(r.logHash), 8, 6) });
        else push('refused', { why: whyOf(r) });
        break;
      default:
        break;
    }
  }
  return steps;
}

/**
 * An agent's way on an order from the order's own record, when the run's journal is not served: it took the order,
 * then each finding it filed, oldest first, where each stands now.
 */
export function eventsOf(detail: OrderDetail | null, hunter: string): Step[] {
  if (!detail) return [];
  const take = detail.takes.find((t) => t.hunter === hunter);
  const steps: Step[] = [];
  if (take) steps.push({ n: 1, kind: 'took', facts: {}, role: take.role });
  const filed = detail.findings.filter((f) => f.hunter === hunter).sort((a, b) => a.submittedAt - b.submittedAt);
  for (const f of filed) steps.push({ n: steps.length + 1, kind: 'finding', facts: {}, finding: f.id, severity: severityOf(f), tone: toneOf(f.status) });
  return steps;
}

/** Where a run stands, in one word: still going, or how it ended. */
export type RunPhase = 'running' | 'found' | 'clean' | 'stopped' | 'spent' | 'fault' | 'void';

export function runPhase(feed: Pick<RunFeed, 'status' | 'result' | 'history'>): RunPhase {
  if (feed.status === 'running') return 'running';
  switch (feed.result) {
    case 'submitted':
      return 'found';
    case 'stopped':
    case 'over_turns':
      return feed.history.some((t) => t?.tool === 'run' && rec(t.result).reproduced === true) ? 'stopped' : 'clean';
    case 'aborted':
      return 'stopped';
    case 'out_of_budget':
      return 'spent';
    case 'fault':
      return 'fault';
    default:
      return 'void';
  }
}

/** Turns used of the cap, for «Step N of M»: never more than the cap, never less than the journal. */
export function turnsOf(feed: Pick<RunFeed, 'history' | 'maxTurns'>): { n: number; max: number } {
  const max = Math.max(1, Math.trunc(feed.maxTurns) || 1);
  return { n: Math.min(max, feed.history.length), max: Math.max(max, feed.history.length) };
}

/* ---------------------------------------------------------------- The board */

/** Points a confirmed finding scores, by its level. */
export const POINTS: Readonly<Record<Severity, number>> = { critical: 10, high: 6, medium: 3, low: 1, info: 0 };

export type BoardRow = {
  readonly rank: number;
  readonly hunter: string;
  readonly role: 'attacker' | 'defender';
  /** Attackers: points from confirmed findings. Defenders: orders they stood on that closed with nothing confirmed. */
  readonly score: number;
  /** Attackers: confirmed findings. Defenders: orders they stood on. */
  readonly count: number;
  readonly best: Severity | null;
};

/**
 * The board of what was read: attackers by the points of their confirmed findings, defenders by the orders they held —
 * an order that ended (closed or settled) with no confirmed finding. Ties go to more findings or orders, then the id.
 */
export function boardOf(details: readonly OrderDetail[], side: 'attacker' | 'defender', now: number): BoardRow[] {
  const rows = new Map<string, { score: number; count: number; best: Severity | null }>();
  const row = (hunter: string) => {
    let r = rows.get(hunter);
    if (!r) rows.set(hunter, (r = { score: 0, count: 0, best: null }));
    return r;
  };
  for (const { order, takes, findings } of details) {
    if (side === 'attacker') {
      for (const take of takes) if (take.role === 'attacker') row(take.hunter);
      for (const f of findings) {
        if (f.status !== 'confirmed') continue;
        const level = f.severity ?? 'info';
        const r = row(f.hunter);
        r.score += POINTS[level];
        r.count += 1;
        if (r.best === null || SEVERITY_ORDER.indexOf(level) < SEVERITY_ORDER.indexOf(r.best)) r.best = level;
      }
    } else {
      const ended = phaseOf(order, now) === 'closed' || phaseOf(order, now) === 'settled';
      const held = ended && !findings.some((f) => f.status === 'confirmed');
      for (const take of takes) {
        if (take.role !== 'defender') continue;
        const r = row(take.hunter);
        r.count += 1;
        if (held) r.score += 1;
      }
    }
  }
  return [...rows.entries()]
    .sort(([ha, a], [hb, b]) => b.score - a.score || b.count - a.count || ha.localeCompare(hb))
    .map(([hunter, r], i) => ({ rank: i + 1, hunter, role: side, score: r.score, count: r.count, best: r.best }));
}
