/**
 * A Hack order (CITY-223): a protocol opens an audit on a **copy** of its contract — the target, the closed scope, the
 * reward it puts up, a deadline, and the owner's signed permission (`permission.ts`). Agents take the order, run an
 * exploit against the copy in the sandbox (CITY-224), and submit findings (`finding.ts`); the rules over the judge
 * (`rules.ts`) decide what counts. No money moves here — the reward is a reference to a reward pool (CITY-46), and the
 * money type is a later task (CITY-229); on the start wave an order is a training run behind a closed flag.
 *
 * The order's life is a small state machine:
 *
 *   draft ──open──▶ open ──pause──▶ paused ──resume──▶ open
 *                    │  │             │
 *                 close│ └──deadline──┤
 *                      ▼              ▼
 *                   closed ──settle──▶ settled
 *
 * Only `open` takes findings. `paused` is the owner's one-signature stop. `closed` is the deadline or the owner's
 * close; `settled` is the end after findings are resolved (a payout, when money arrives, belongs to CITY-229).
 *
 * Pure: no store, no clock, no network, no money.
 */

import { hashOf } from "../../../../lib/ring/judge/index.ts";
import { checkScope, checkTarget, isName, type Scope, type ScopeIssue, type TargetRef } from "./scope.ts";

export const ORDER_FORMAT = "ryntra-hack-order/1";

export const ORDER_STATUSES = ["draft", "open", "paused", "closed", "settled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** The moves of the state machine. `deadline` and `close` both reach `closed`; `settle` ends it. */
export const ORDER_MOVES = ["open", "pause", "resume", "close", "deadline", "settle"] as const;
export type OrderMove = (typeof ORDER_MOVES)[number];

/** From each status, the move → next status. A move not listed for a status is refused. */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, Partial<Record<OrderMove, OrderStatus>>>> = {
  draft: { open: "open" },
  open: { pause: "paused", close: "closed", deadline: "closed" },
  paused: { resume: "open", close: "closed", deadline: "closed" },
  closed: { settle: "settled" },
  settled: {},
};

/** What the reward points at — a reward pool (CITY-46). No amount here: the money type is CITY-229. */
export type RewardRef = {
  /** The prize-pool id this order's reward is held in (CITY-46). A reference only; nothing is paid here. */
  readonly pool: string;
  /** For the window's one honest line before a signature; the real figures come from the pools module. */
  readonly note?: string;
};

export type Order = {
  readonly format: typeof ORDER_FORMAT;
  readonly id: string;
  /** The protocol's owner wallet (base58) — who opened the order and who confirms findings. */
  readonly protocol: string;
  readonly title: string;
  readonly target: TargetRef;
  readonly scope: Scope;
  readonly reward: RewardRef;
  /** The window a finding's submission must fall in (unix ms). */
  readonly opensAt: number;
  readonly closesAt: number;
  readonly status: OrderStatus;
};

export type OrderIssueCode = "BAD_ORDER" | ScopeIssue["code"];
export type OrderIssue = { readonly code: OrderIssueCode; readonly detail: string };

const ID = /^[A-Za-z0-9._:-]{1,64}$/;
export const isOrderId = (value: unknown): value is string => typeof value === "string" && ID.test(value);
const isAddressLike = (value: unknown): value is string => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Everything wrong with an order; empty when it is well-formed. Checks the target is a copy and the scope names it. */
export function checkOrder(order: unknown): OrderIssue[] {
  if (order === null || typeof order !== "object") return [{ code: "BAD_ORDER", detail: "order is not an object" }];
  const o = order as Record<string, unknown>;
  const issues: OrderIssue[] = [];
  if (o.format !== ORDER_FORMAT) issues.push({ code: "BAD_ORDER", detail: `format must be ${ORDER_FORMAT}` });
  if (!isOrderId(o.id)) issues.push({ code: "BAD_ORDER", detail: "id: 1-64 of A-Z a-z 0-9 . _ : -" });
  if (!isAddressLike(o.protocol)) issues.push({ code: "BAD_ORDER", detail: "protocol: a base58 wallet address" });
  if (typeof o.title !== "string" || o.title.trim().length === 0 || o.title.length > 200) issues.push({ code: "BAD_ORDER", detail: "title: 1-200 characters" });
  if (!(ORDER_STATUSES as readonly unknown[]).includes(o.status)) issues.push({ code: "BAD_ORDER", detail: "status is not a known one" });
  if (!isCount(o.opensAt) || !isCount(o.closesAt) || (o.opensAt as number) > (o.closesAt as number)) issues.push({ code: "BAD_ORDER", detail: "opensAt ≤ closesAt (unix ms)" });

  const target = checkTarget(o.target);
  if (target) issues.push(target);
  const scope = checkScope(o.scope, target ? undefined : (o.target as TargetRef));
  if (scope) issues.push(scope);

  const reward = o.reward;
  if (reward === null || typeof reward !== "object" || !isName((reward as Record<string, unknown>).pool)) {
    issues.push({ code: "BAD_ORDER", detail: "reward needs a prize-pool id (pool)" });
  } else if ((reward as Record<string, unknown>).note !== undefined && typeof (reward as Record<string, unknown>).note !== "string") {
    issues.push({ code: "BAD_ORDER", detail: "reward.note must be a string" });
  }
  return issues;
}

/** The next status for a move, or `null` when the move is not allowed from here. */
export function nextStatus(from: OrderStatus, move: OrderMove): OrderStatus | null {
  return ORDER_TRANSITIONS[from]?.[move] ?? null;
}

/** True when a move is allowed from the order's current status. */
export const canMove = (order: Order, move: OrderMove): boolean => nextStatus(order.status, move) !== null;

export class OrderMoveRejected extends Error {
  override name = "OrderMoveRejected";
  readonly from: OrderStatus;
  readonly move: OrderMove;
  constructor(from: OrderStatus, move: OrderMove) {
    super(`a Hack order cannot ${move} from ${from}`);
    this.from = from;
    this.move = move;
  }
}

/** The order after a move; throws `OrderMoveRejected` when the move is not allowed from the current status. */
export function moveOrder(order: Order, move: OrderMove): Order {
  const next = nextStatus(order.status, move);
  if (next === null) throw new OrderMoveRejected(order.status, move);
  return { ...order, status: next };
}

/** Only an open order takes findings, and only within its window. */
export function takesFindingAt(order: Order, at: number): boolean {
  return order.status === "open" && at >= order.opensAt && at <= order.closesAt;
}

/** The order's canonical hash — its content without the mutable status, so the same audit keeps one id across moves. */
export function orderHash(order: Order): string {
  const { status: _status, ...rest } = order;
  return hashOf(rest);
}
