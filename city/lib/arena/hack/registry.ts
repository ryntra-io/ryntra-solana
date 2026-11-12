/**
 * The order registry of Hack (CITY-223): a clean storage interface and an in-memory implementation, and the thin glue
 * that opens orders, moves them and takes findings through the rules (`rules.ts`). The storage is kept behind an
 * interface so the real store — a database, with routes, limits and idempotency — can be dropped in without touching
 * the rules: that store is CITY-226. Nothing here reaches a network, a database or money.
 *
 * `HackRegistry` is for tests and for the in-memory path; it holds no keys and does no crypto — the permission check is
 * the injected verifier (`permission.ts`), the same one the server will hand in. Owner-only moves (pause, resume,
 * close, settle) check the caller is the protocol's owner; the deadline move is the system's.
 *
 * Pure of side effects beyond its own store: no clock, no network, no money.
 */

import { assessFinding, type AssessInput, type Assessment, type HackProof } from "./rules.ts";
import { checkFinding, type Finding } from "./finding.ts";
import { checkGrant, scopeHash, type PermissionGrant, type PermissionVerifier } from "./permission.ts";
import { canMove, checkOrder, moveOrder, type Order, type OrderMove, type OrderStatus } from "./order.ts";

/** An order with the owner's permission grant that opened it. */
export type StoredOrder = { readonly order: Order; readonly grant: PermissionGrant };

/** The storage Hack needs, as an interface: CITY-226 implements it over a database. All async, so a DB fits as-is. */
export interface HackStore {
  putOrder(stored: StoredOrder): Promise<void>;
  getOrder(id: string): Promise<StoredOrder | null>;
  listOrders(filter?: { status?: OrderStatus; protocol?: string }): Promise<StoredOrder[]>;
  setOrderStatus(id: string, status: OrderStatus): Promise<void>;
  putFinding(finding: Finding): Promise<void>;
  getFinding(id: string): Promise<Finding | null>;
  findingsForOrder(orderId: string): Promise<Finding[]>;
}

/** An in-memory `HackStore`: Maps, no persistence. The registry's default; a database replaces it in CITY-226. */
export function createMemoryHackStore(): HackStore {
  const orders = new Map<string, StoredOrder>();
  const findings = new Map<string, Finding>();
  const byOrder = new Map<string, Set<string>>();
  return {
    async putOrder(stored) {
      orders.set(stored.order.id, stored);
    },
    async getOrder(id) {
      return orders.get(id) ?? null;
    },
    async listOrders(filter) {
      let list = [...orders.values()];
      if (filter?.status) list = list.filter((s) => s.order.status === filter.status);
      if (filter?.protocol) list = list.filter((s) => s.order.protocol === filter.protocol);
      return list;
    },
    async setOrderStatus(id, status) {
      const stored = orders.get(id);
      if (stored) orders.set(id, { ...stored, order: { ...stored.order, status } });
    },
    async putFinding(finding) {
      findings.set(finding.id, finding);
      let ids = byOrder.get(finding.order);
      if (!ids) byOrder.set(finding.order, (ids = new Set()));
      ids.add(finding.id);
    },
    async getFinding(id) {
      return findings.get(id) ?? null;
    },
    async findingsForOrder(orderId) {
      const ids = byOrder.get(orderId);
      return ids ? [...ids].map((id) => findings.get(id)!).filter(Boolean) : [];
    },
  };
}

export type OpenResult =
  | { ok: true; order: Order }
  | { ok: false; where: "order" | "permission"; detail: string };

export type SubmitResult =
  | { ok: true; finding: Finding; assessment: Assessment }
  | { ok: false; detail: string };

export type MoveResult =
  | { ok: true; order: Order }
  | { ok: false; detail: string };

export type HackRegistry = {
  openOrder(order: Order, grant: PermissionGrant): Promise<OpenResult>;
  submitFinding(finding: Finding, proof: HackProof): Promise<SubmitResult>;
  applyMove(orderId: string, move: OrderMove, by?: string): Promise<MoveResult>;
  order(id: string): Promise<StoredOrder | null>;
  orders(filter?: { status?: OrderStatus; protocol?: string }): Promise<StoredOrder[]>;
  finding(id: string): Promise<Finding | null>;
  findings(orderId: string): Promise<Finding[]>;
};

/** Moves only the protocol owner may make; `open` is `openOrder`, `deadline` is the system's. */
const OWNER_MOVES: readonly OrderMove[] = ["pause", "resume", "close", "settle"];

export function createHackRegistry(options: { verify: PermissionVerifier; store?: HackStore }): HackRegistry {
  const store = options.store ?? createMemoryHackStore();
  const verify = options.verify;

  return {
    async openOrder(order, grant) {
      // Open from a draft, or accept one already marked open; nothing else opens an order.
      let opened: Order;
      if (order.status === "draft") opened = moveOrder(order, "open");
      else if (order.status === "open") opened = order;
      else return { ok: false, where: "order", detail: `an order opens from draft, not ${order.status}` };

      const issues = checkOrder(opened);
      if (issues.length > 0) return { ok: false, where: "order", detail: issues[0]!.detail };

      // A draft submission to the rules would be refused for permission anyway; check it here so an order never opens
      // without the owner's consent on its own scope and window.
      const probe = probeGrant(opened, grant, verify);
      if (probe) return { ok: false, where: "permission", detail: probe };

      await store.putOrder({ order: opened, grant });
      return { ok: true, order: opened };
    },

    async submitFinding(finding, proof) {
      const shape = checkFinding(finding);
      if (shape.length > 0) return { ok: false, detail: shape[0]!.detail };
      const stored = await store.getOrder(finding.order);
      if (!stored) return { ok: false, detail: "no such order" };
      // A finding is filed once: a second filing under the same id never overwrites the first one's evidence or verdict.
      if (await store.getFinding(finding.id)) return { ok: false, detail: "this finding was already filed" };

      const prior = await store.findingsForOrder(finding.order);
      const input: AssessInput = { order: stored.order, grant: stored.grant, finding, proof, prior };
      const assessment = assessFinding(input, verify);
      const recorded: Finding = { ...finding, status: assessment.status };
      await store.putFinding(recorded);
      return { ok: true, finding: recorded, assessment };
    },

    async applyMove(orderId, move, by) {
      const stored = await store.getOrder(orderId);
      if (!stored) return { ok: false, detail: "no such order" };
      // An owner's move names the owner; one that names nobody is nobody's.
      if (OWNER_MOVES.includes(move) && by !== stored.order.protocol) {
        return { ok: false, detail: "only the protocol owner may make this move" };
      }
      if (!canMove(stored.order, move)) return { ok: false, detail: `cannot ${move} from ${stored.order.status}` };
      const next = moveOrder(stored.order, move);
      await store.setOrderStatus(orderId, next.status);
      return { ok: true, order: next };
    },

    order: (id) => store.getOrder(id),
    orders: (filter) => store.listOrders(filter),
    finding: (id) => store.getFinding(id),
    findings: (orderId) => store.findingsForOrder(orderId),
  };
}

/** The owner's consent on the order's own id, scope and window — the same check `checkGrant` makes, surfaced on open. */
function probeGrant(order: Order, grant: PermissionGrant, verify: PermissionVerifier): string | null {
  const issues = checkGrant(
    grant,
    { order: order.id, protocol: order.protocol, scopeHash: scopeHash(order.scope), opensAt: order.opensAt, closesAt: order.closesAt },
    verify,
  );
  return issues.length > 0 ? issues[0]!.detail : null;
}
