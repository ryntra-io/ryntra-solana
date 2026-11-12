/**
 * Hack on the server (CITY-226): what the routes do, on the store (`contract.ts`) and the library's rules (CITY-223),
 * without HTTP — so every rule is tested in node, and the routes (`api.ts`) only read requests and write answers.
 *
 *   open    — a protocol opens an order on a copy of its own contract, with its owner's signed permission;
 *   take    — an agent of another owner takes it, as an attacker or a defender (one owner plays one side);
 *   submit  — the attacker files a finding: the rules over the judge decide it, the store files it once, under a lock;
 *   move    — the protocol owner pauses, resumes, closes or settles; the deadline is the system's, applied on the way;
 *   resolve: confirm or reject.
 *
 * A finding's proof comes from the sandbox (`prove`, CITY-224), never from the agent: until a sandbox answers, a
 * finding waits for review and only the owner's rejection moves it. Nothing here moves money: `payable` is only «the
 * rules would allow a reward».
 */

import { hashOf } from "../../../../../lib/ring/judge/index.ts";
import { checkFinding, FINDING_FORMAT, isFindingId, isSeverity, severityRank, type Finding, type FindingStatus, type Severity } from "../finding.ts";
import { checkOrder, isOrderId, moveOrder, type Order, type OrderStatus, ORDER_STATUSES } from "../order.ts";
import { checkGrant, scopeHash, type PermissionGrant, type PermissionVerifier } from "../permission.ts";
import { assessFinding, MIN_REWARDED, type HackOutcome, type HackProof } from "../rules.ts";
import { isAddress, isName, type FindingTarget } from "../scope.ts";
import type { StoredOrder } from "../registry.ts";
import {
  dayStart,
  HACK_LIMITS,
  isHackRole,
  OWNER_MOVES,
  verdictOf,
  type FiledFinding,
  type FiledReason,
  type HackDb,
  type HackRole,
  type Take,
  type Verdict,
} from "./contract.ts";

/** The person behind a request: the wallet they proved, and the Ryntra account their agents live under. */
export type HackCaller = { readonly wallet: string; readonly account: string | null };

/** Whose agent a hunter is (the Ring's agents, CITY-50): `a:<account id>` and whether it plays; `null` — no such agent. */
export type AgentRead = { readonly account: string; readonly active: boolean } | null;

export type HackServiceDeps = {
  db: HackDb;
  /** The owner's signature check (`verify.ts` on the server; a fake in tests). */
  verify: PermissionVerifier;
  /**
   * The sandbox's verdict on a finding's run in the fork (CITY-224). `null` while no sandbox answers: the finding then
   * waits for review (`NO_EVIDENCE`) and counts only when a deterministic run proves it.
   */
  prove: (input: { order: Order; finding: Finding }) => Promise<HackProof | null>;
  /** Whose agent a hunter is. Absent only on a developer's stand, where agents are names. */
  agentOf?: (hunter: string) => Promise<AgentRead>;
  /**
   * Whether a copy is kept for an order's target (`../ranges/range.ts`), so its runs can be played at all (CITY-238).
   * Absent — not asked: an order on any copy opens, as before.
   */
  playable?: (target: Order["target"]) => boolean;
  now: () => number;
  newId: () => string;
  limits?: typeof HACK_LIMITS;
};

export type HackErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "NOT_YOURS"
  | "NOT_YOUR_AGENT"
  | "AGENT_OFF"
  | "SIGN_IN"
  | "BAD_ORDER"
  | "BAD_FINDING"
  | "NO_PERMISSION"
  | "WINDOW"
  | "EXISTS"
  | "RATE_LIMITED"
  | "CLOSED"
  | "SELF_AUDIT"
  | "BOTH_SIDES"
  | "HUNTER_TAKEN"
  | "NOT_TAKEN"
  | "BAD_MOVE"
  | "UNRESOLVED"
  | "SETTLED"
  | "NOT_PENDING"
  | "NO_RUN";

export type Outcome<T> = { ok: true; value: T } | { ok: false; code: HackErrorCode; message: string };

/** An order as anyone may see it, with the owner's signed permission so anyone can check it. */
export type OrderView = Omit<Order, "format"> & { readonly permission: PermissionGrant };

export type TakeView = Omit<Take, "order">;

/**
 * A finding as a viewer may see it. The protocol owner and the hunter's owner see all of it; everyone else sees that it
 * exists, its status and the severity it counts at — never where the fault is, while the protocol may not have fixed it.
 */
export type FindingView = {
  readonly id: string;
  readonly order: string;
  readonly hunter: string;
  readonly status: FindingStatus;
  readonly severity: Severity | null;
  readonly payable: boolean;
  readonly submittedAt: number;
  readonly resolvedAt: number | null;
  readonly sealed: boolean;
  readonly hunterOwner?: string;
  readonly target?: FindingTarget;
  readonly vulnClass?: string;
  readonly claimed?: Severity;
  readonly title?: string;
  readonly logHash?: string | null;
  readonly reason?: FiledReason;
  readonly detail?: string;
  readonly resolvedBy?: string | null;
};

export type OpenInput = { readonly order: unknown; readonly grant: unknown };
export type TakeInput = { readonly order: unknown; readonly hunter: unknown; readonly role: unknown };
export type SubmitInput = {
  readonly id?: unknown;
  readonly order: unknown;
  readonly hunter: unknown;
  readonly target: unknown;
  readonly vulnClass: unknown;
  readonly severity: unknown;
  readonly title: unknown;
  readonly logHash?: unknown;
};
export type MoveInput = { readonly order: unknown; readonly move: unknown };
export type ResolveInput = { readonly finding: unknown; readonly verdict: unknown };

/** No sandbox answered: the rules read a missing verdict as «no evidence» — a review, never a counted finding. */
const NO_PROOF = { judgement: null, deterministic: false } as unknown as HackProof;

const fail = <T>(code: HackErrorCode, message: string): Outcome<T> => ({ ok: false, code, message });
const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function orderView(stored: StoredOrder): OrderView {
  const { format: _format, ...order } = stored.order;
  return { ...order, permission: stored.grant };
}

export function findingView(filed: FiledFinding, protocol: string, viewer: string | null): FindingView {
  const f = filed.finding;
  const base = {
    id: f.id,
    order: f.order,
    hunter: f.hunter,
    status: f.status,
    severity: filed.severity,
    payable: filed.payable,
    submittedAt: f.submittedAt,
    resolvedAt: filed.resolvedAt,
  };
  if (viewer === null || (viewer !== protocol && viewer !== f.hunterOwner)) return { ...base, sealed: true };
  return {
    ...base,
    sealed: false,
    hunterOwner: f.hunterOwner,
    target: f.target,
    vulnClass: f.vulnClass,
    claimed: f.severity,
    title: f.title,
    logHash: f.logHash,
    reason: filed.reason,
    detail: filed.detail,
    resolvedBy: filed.resolvedBy,
  };
}

const takeView = ({ order: _order, ...take }: Take): TakeView => take;

/** Only what a finding target is: a program, and the instruction and account when named. */
function targetOf(value: unknown): FindingTarget | null {
  if (!isRecord(value)) return null;
  const target: { program: string; instruction?: string; account?: string } = { program: value.program as string };
  if (value.instruction !== undefined) target.instruction = value.instruction as string;
  if (value.account !== undefined) target.account = value.account as string;
  return target;
}

export function createHackService(deps: HackServiceDeps) {
  const { db, verify } = deps;
  const limits = deps.limits ?? HACK_LIMITS;

  /** The system's deadline, applied when an order is read past its window: it closes, as the state machine says. */
  async function current(id: string): Promise<StoredOrder | null> {
    const stored = await db.getOrder(id);
    if (!stored) return null;
    const { order } = stored;
    const now = deps.now();
    if ((order.status === "open" || order.status === "paused") && now > order.closesAt) {
      const moved = await db.move(id, "deadline", null, now);
      if (moved.ok) return { ...stored, order: moved.order };
      return db.getOrder(id);
    }
    return stored;
  }

  return {
    /** Orders, newest first, by status and protocol when given. */
    async orders(filter: { status?: unknown; protocol?: unknown } = {}): Promise<Outcome<OrderView[]>> {
      if (filter.status !== undefined && !(ORDER_STATUSES as readonly unknown[]).includes(filter.status)) return fail("BAD_REQUEST", "`status` is draft, open, paused, closed or settled.");
      if (filter.protocol !== undefined && !isAddress(filter.protocol)) return fail("BAD_REQUEST", "`protocol` is a wallet address.");
      const listed = await db.listOrders({ status: filter.status as OrderStatus | undefined, protocol: filter.protocol as string | undefined });
      const now = deps.now();
      const views: OrderView[] = [];
      for (const stored of listed) {
        const late = (stored.order.status === "open" || stored.order.status === "paused") && now > stored.order.closesAt;
        const fresh = late ? await current(stored.order.id) : stored;
        if (!fresh || (filter.status !== undefined && fresh.order.status !== filter.status)) continue;
        views.push(orderView(fresh));
      }
      return ok(views);
    },

    /** One order with the agents on it and its findings, as the viewer may see them. */
    async order(id: unknown, viewer: string | null): Promise<Outcome<{ order: OrderView; takes: TakeView[]; findings: FindingView[] }>> {
      if (!isOrderId(id)) return fail("BAD_REQUEST", "`id` names an order.");
      const stored = await current(id);
      if (!stored) return fail("NOT_FOUND", "There is no such order.");
      const [takes, filed] = await Promise.all([db.takes(id), db.filedForOrder(id)]);
      return ok({
        order: orderView(stored),
        takes: takes.map(takeView),
        findings: filed.map((f) => findingView(f, stored.order.protocol, viewer)),
      });
    },

    async finding(id: unknown, viewer: string | null): Promise<Outcome<{ finding: FindingView }>> {
      if (!isFindingId(id)) return fail("BAD_REQUEST", "`id` names a finding.");
      const filed = await db.filed(id);
      if (!filed) return fail("NOT_FOUND", "There is no such finding.");
      const stored = await db.getOrder(filed.finding.order);
      if (!stored) return fail("NOT_FOUND", "There is no such finding.");
      return ok({ finding: findingView(filed, stored.order.protocol, viewer) });
    },

    /** A protocol opens an order on a copy of its own contract, with its owner's signed permission. */
    async open(caller: HackCaller, input: OpenInput): Promise<Outcome<{ order: OrderView }>> {
      const raw = input.order;
      if (!isRecord(raw) || !isRecord(input.grant)) return fail("BAD_REQUEST", "The body is { order, grant }.");
      if (raw.protocol !== caller.wallet) return fail("NOT_YOURS", "An order is opened by its protocol's own wallet.");
      if (raw.status !== "draft" && raw.status !== "open") return fail("BAD_ORDER", "An order opens from draft.");
      const issues = checkOrder(raw);
      if (issues.length > 0) return fail("BAD_ORDER", issues[0]!.detail);
      const order = raw.status === "draft" ? moveOrder(raw as unknown as Order, "open") : (raw as unknown as Order);

      const now = deps.now();
      if (order.closesAt <= now) return fail("WINDOW", "The order's window is already over.");
      if (order.closesAt - order.opensAt > limits.maxWindowMs) return fail("WINDOW", "An order runs 90 days at most.");
      // An order nobody's agent could ever work is not opened: no copy of this target is kept to play on.
      if (deps.playable && !deps.playable(order.target)) return fail("BAD_ORDER", "No copy is kept for this target yet.");

      const grant = input.grant as unknown as PermissionGrant;
      const expect = { order: order.id, protocol: order.protocol, scopeHash: scopeHash(order.scope), opensAt: order.opensAt, closesAt: order.closesAt };
      const grantIssues = checkGrant(grant, expect, verify);
      if (grantIssues.length > 0) return fail("NO_PERMISSION", grantIssues[0]!.detail);
      // The owner signs the copy too: the order runs on exactly the copy the grant names — the same fork pin or deploy.
      if (hashOf(grant.target) !== hashOf(order.target)) return fail("NO_PERMISSION", "the grant names another copy than the order");

      const opened = await db.open({ order, grant }, { since: dayStart(now), perOwner: limits.ordersPerDay }, now);
      if (!opened.ok) {
        return opened.reason === "EXISTS"
          ? fail("EXISTS", "An order with this id is already open.")
          : fail("RATE_LIMITED", `A protocol opens ${limits.ordersPerDay} orders a day at most.`);
      }
      return ok({ order: orderView({ order: opened.order, grant }) });
    },

    /** An agent takes an order. One owner plays one side; the protocol's owner never attacks its own order. */
    async take(caller: HackCaller, input: TakeInput): Promise<Outcome<{ take: TakeView; again: boolean }>> {
      if (!isOrderId(input.order) || !isName(input.hunter) || !isHackRole(input.role)) return fail("BAD_REQUEST", "The body is { order, hunter, role }.");
      if (deps.agentOf) {
        if (!caller.account) return fail("SIGN_IN", "Sign in with your wallet to send an agent.");
        const agent = await deps.agentOf(input.hunter);
        if (!agent || agent.account !== caller.account) return fail("NOT_YOUR_AGENT", "Send one of your own agents.");
        if (!agent.active) return fail("AGENT_OFF", "This agent is off.");
      }
      const stored = await current(input.order);
      if (!stored) return fail("NOT_FOUND", "There is no such order.");
      const now = deps.now();
      const taken = await db.take({ order: input.order, hunter: input.hunter, owner: caller.wallet, role: input.role as HackRole }, { since: dayStart(now), perOwner: limits.takesPerDay }, now);
      if (taken.ok) return ok({ take: takeView(taken.take), again: taken.again });
      switch (taken.reason) {
        case "NOT_FOUND":
          return fail("NOT_FOUND", "There is no such order.");
        case "CLOSED":
          return fail("CLOSED", "This order is not open.");
        case "WINDOW":
          return fail("WINDOW", "This order is not open yet.");
        case "SELF_AUDIT":
          return fail("SELF_AUDIT", "A protocol's owner does not attack its own order.");
        case "BOTH_SIDES":
          return fail("BOTH_SIDES", "Your agents already play the other side of this order.");
        case "HUNTER_TAKEN":
          return fail("HUNTER_TAKEN", "This agent is already on this order.");
        case "RATE_LIMITED":
          return fail("RATE_LIMITED", `An owner takes ${limits.takesPerDay} orders a day at most.`);
      }
    },

    /** The attacker files a finding. The rules over the judge decide it; the store files it once, under the order's lock. */
    async submit(caller: HackCaller, input: SubmitInput): Promise<Outcome<{ finding: FindingView; outcome: HackOutcome }>> {
      if (input.id !== undefined && !isFindingId(input.id)) return fail("BAD_REQUEST", "`id`: 1-64 of A-Z a-z 0-9 . _ : -");
      if (!isOrderId(input.order)) return fail("BAD_REQUEST", "`order` names an order.");
      const now = deps.now();
      const finding: Finding = {
        format: FINDING_FORMAT,
        id: (input.id as string | undefined) ?? deps.newId(),
        order: input.order,
        hunter: input.hunter as string,
        hunterOwner: caller.wallet,
        target: targetOf(input.target) as FindingTarget,
        vulnClass: input.vulnClass as string,
        severity: input.severity as Severity,
        title: input.title as string,
        logHash: input.logHash === undefined ? null : (input.logHash as string | null),
        submittedAt: now,
        status: "submitted",
      };
      const shape = checkFinding(finding);
      if (shape.length > 0) return fail("BAD_FINDING", shape[0]!.detail);

      const stored = await current(finding.order);
      if (!stored) return fail("NOT_FOUND", "There is no such order.");
      if (stored.order.status !== "open") return fail("CLOSED", "This order is not open.");
      if (now < stored.order.opensAt) return fail("WINDOW", "This order is not open yet.");

      const prior = (await db.filedForOrder(finding.order)).map((f) => f.finding);
      let proof: HackProof | null = null;
      try {
        proof = await deps.prove({ order: stored.order, finding });
      } catch {
        proof = null;
      }
      const assessment = assessFinding({ order: stored.order, grant: stored.grant, finding, proof: proof ?? NO_PROOF, prior }, verify);
      const filed = await db.file(
        { finding, verdict: verdictOf(assessment) },
        { needTake: true, limit: { since: dayStart(now), perOwner: limits.findingsPerDay, perHunter: limits.findingsPerHunterDay } },
        now,
      );
      if (filed.ok) return ok({ finding: findingView(filed.filed, stored.order.protocol, caller.wallet), outcome: outcomeOf(filed.filed) });
      switch (filed.reason) {
        case "NOT_FOUND":
          return fail("NOT_FOUND", "There is no such order.");
        case "EXISTS":
          return fail("EXISTS", "A finding with this id is already filed.");
        case "NOT_TAKEN":
          return fail("NOT_TAKEN", "Take this order with this agent as an attacker first.");
        case "RATE_LIMITED":
          return fail("RATE_LIMITED", `An owner files ${limits.findingsPerDay} findings a day at most, an agent ${limits.findingsPerHunterDay}.`);
      }
    },

    /** The protocol owner's move: pause, resume, close or settle. */
    async move(caller: HackCaller, input: MoveInput): Promise<Outcome<{ order: OrderView }>> {
      if (!isOrderId(input.order) || !(OWNER_MOVES as readonly unknown[]).includes(input.move)) return fail("BAD_REQUEST", "The body is { order, move: pause | resume | close | settle }.");
      const stored = await current(input.order);
      if (!stored) return fail("NOT_FOUND", "There is no such order.");
      const moved = await db.move(input.order, input.move as (typeof OWNER_MOVES)[number], caller.wallet, deps.now());
      if (moved.ok) return ok({ order: orderView({ order: moved.order, grant: stored.grant }) });
      switch (moved.reason) {
        case "NOT_FOUND":
          return fail("NOT_FOUND", "There is no such order.");
        case "NOT_OWNER":
          return fail("NOT_YOURS", "Only the protocol's owner moves this order.");
        case "UNRESOLVED":
          return fail("UNRESOLVED", "Confirm or reject every finding under review first.");
        default:
          return fail("BAD_MOVE", `This order cannot ${String(input.move)} while it is ${moved.status ?? stored.order.status}.`);
      }
    },

    async resolve(caller: HackCaller, input: ResolveInput): Promise<Outcome<{ finding: FindingView }>> {
      if (!isFindingId(input.finding) || (input.verdict !== "confirm" && input.verdict !== "reject")) return fail("BAD_REQUEST", "The body is { finding, verdict: confirm | reject }.");
      const filed = await db.filed(input.finding);
      if (!filed) return fail("NOT_FOUND", "There is no such finding.");
      const stored = await db.getOrder(filed.finding.order);
      if (!stored) return fail("NOT_FOUND", "There is no such finding.");
      // What a confirmation would allow, if it is the first of its vulnerability (the store decides that under the lock).
      const payable = isSeverity(filed.finding.severity) && severityRank(filed.finding.severity) >= severityRank(MIN_REWARDED);
      const resolved = await db.resolve({ id: input.finding, by: caller.wallet, verdict: input.verdict as Verdict, payable }, deps.now());
      if (resolved.ok) return ok({ finding: findingView(resolved.filed, stored.order.protocol, caller.wallet) });
      switch (resolved.reason) {
        case "NOT_FOUND":
          return fail("NOT_FOUND", "There is no such finding.");
        case "NOT_OWNER":
          return fail("NOT_YOURS", "Only the protocol's owner confirms its findings.");
        case "SETTLED":
          return fail("SETTLED", "This order is settled.");
        case "NOT_PENDING":
          return fail("NOT_PENDING", "This finding is not waiting for review.");
        case "NO_RUN":
          return fail("NO_RUN", "Only a run in the fork can be confirmed; reject it or wait for the run.");
      }
    },
  };
}

export type HackService = ReturnType<typeof createHackService>;

/** What the filing came to, in the rules' words: the store may have made a confirmed finding a duplicate under its lock. */
function outcomeOf(filed: FiledFinding): HackOutcome {
  switch (filed.finding.status) {
    case "confirmed":
      return "counts";
    case "duplicate":
      return "duplicate";
    case "rejected":
      return "rejected";
    case "blocked":
      return "blocked";
    default:
      return filed.reason === "DESCRIPTION_ONLY" ? "description" : "review";
  }
}
