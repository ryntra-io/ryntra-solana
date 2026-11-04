/**
 * Where prepared actions live (CITY-161): the port and the memory adapter. Production is Postgres
 * (`./store-postgres.server.ts`) — one table a separately authorized migration provisions
 * (`db/migrations/20261031120000_city_161_intents.sql`); memory serves the tests and a local stand on one instance,
 * and says so (`durability`).
 *
 * The frozen fields are written once, by `insert`, and never again: `update` takes only the claim and the receipt,
 * under compare-and-set on the version the change was decided on, so two tabs pressing at the same moment never both
 * win. One signature answers one intent: a receipt whose signature is already another intent's is refused by the store
 * itself.
 *
 * A store that cannot answer throws `IntentStoreUnavailable`; a lost race is a value (`null`).
 */

import { holdsPlace, type IntentClaim, type IntentReceipt, type IntentRecord } from "./model.ts";

export type IntentStoreDurability = "EPHEMERAL_SINGLE_INSTANCE" | "DURABLE_MULTI_WRITER";

export class IntentStoreUnavailable extends Error {
  readonly reason: "NOT_PROVISIONED" | "UNREACHABLE" | "FULL";
  constructor(reason: "NOT_PROVISIONED" | "UNREACHABLE" | "FULL", message: string) {
    super(message);
    this.name = "IntentStoreUnavailable";
    this.reason = reason;
  }
}

export type IntentChange = Readonly<{ claim: IntentClaim | null; receipt: IntentReceipt | null; cancelledAt: string | null }>;

export type UpdateResult =
  | Readonly<{ ok: true; record: IntentRecord }>
  /** The version moved since the change was decided: read again. */
  | Readonly<{ ok: false; reason: "VERSION" }>
  /** The receipt's signature already answers another intent. */
  | Readonly<{ ok: false; reason: "SIGNATURE_TAKEN" }>;

export interface IntentStore {
  readonly durability: IntentStoreDurability;
  /** Writes a new intent; false when its id is taken. */
  insert(record: IntentRecord): Promise<boolean>;
  read(id: string): Promise<IntentRecord | null>;
  /** Sets the claim, the receipt and the withdrawal while the version is still `expected`; the version grows by one. */
  update(id: string, expected: number, change: IntentChange): Promise<UpdateResult>;
  /** How many intents bound to this wallet are still open or claimed. */
  openFor(wallet: string, now: Date): Promise<number>;
}

/** Enough for a stand; a busy one forgets intents a day past their deadline first. */
const MEMORY_LIMIT = 10_000;
const FORGET_AFTER_MS = 86_400_000;

export class MemoryIntentStore implements IntentStore {
  readonly durability = "EPHEMERAL_SINGLE_INSTANCE" as const;
  private readonly rows = new Map<string, IntentRecord>();
  private readonly signatures = new Map<string, string>();
  /** Tests: the next calls throw as an unreachable store would. */
  down = false;
  private readonly now: () => number;
  private readonly limit: number;

  constructor(options: Readonly<{ now?: () => number; limit?: number }> = {}) {
    this.now = options.now ?? (() => Date.now());
    this.limit = options.limit ?? MEMORY_LIMIT;
  }

  private gate(): void {
    if (this.down) throw new IntentStoreUnavailable("UNREACHABLE", "intent store down");
  }

  private forgetOld(): void {
    const cutoff = this.now() - FORGET_AFTER_MS;
    for (const [id, row] of this.rows) {
      const ends = Math.max(Date.parse(row.body.expiresAt), row.claim ? Date.parse(row.claim.until) : 0);
      if (ends < cutoff) {
        this.rows.delete(id);
        if (row.receipt) this.signatures.delete(row.receipt.signature);
      }
    }
  }

  async insert(record: IntentRecord): Promise<boolean> {
    this.gate();
    if (this.rows.has(record.body.id)) return false;
    if (this.rows.size >= this.limit) this.forgetOld();
    if (this.rows.size >= this.limit) throw new IntentStoreUnavailable("FULL", "intent store full");
    this.rows.set(record.body.id, structuredClone(record));
    return true;
  }

  async read(id: string): Promise<IntentRecord | null> {
    this.gate();
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }

  async update(id: string, expected: number, change: IntentChange): Promise<UpdateResult> {
    this.gate();
    const row = this.rows.get(id);
    if (!row || row.version !== expected) return { ok: false, reason: "VERSION" };
    const signature = change.receipt?.signature ?? null;
    if (signature && this.signatures.has(signature) && this.signatures.get(signature) !== id) return { ok: false, reason: "SIGNATURE_TAKEN" };
    const next: IntentRecord = {
      ...row,
      version: row.version + 1,
      claim: change.claim ? { ...change.claim } : null,
      receipt: change.receipt ? { ...change.receipt } : null,
      cancelledAt: change.cancelledAt,
    };
    this.rows.set(id, next);
    if (row.receipt && row.receipt.signature !== signature) this.signatures.delete(row.receipt.signature);
    if (signature) this.signatures.set(signature, id);
    return { ok: true, record: structuredClone(next) };
  }

  async openFor(wallet: string, now: Date): Promise<number> {
    this.gate();
    let count = 0;
    for (const row of this.rows.values()) if (row.body.for === wallet && holdsPlace(row, now)) count += 1;
    return count;
  }

  /** Tests only: what storage holds, changed behind the application's back. */
  tamper(id: string, edit: (record: IntentRecord) => IntentRecord): void {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, edit(structuredClone(row)));
  }
}
