import {
  ACTIVITY_SCHEMA,
  STELLAR_ACTIVITY_STATES,
  applyActivityUpdate,
  newActivityRecord,
  sortActivity,
  type StellarActivityRecord,
  type StellarActivityState,
} from "./record.ts";

/**
 * Where a Stellar action is kept between sessions.
 *
 * ## The decision, and why it is this one
 *
 * **This browser, and nowhere else.** Not a Ryntra server, not an account, not a
 * synced profile. The answer follows from what this product already is.
 *
 * Ryntra holds no key, has no account for this workspace, and keeps no
 * server-side record of anyone using it. Adding a server-side history of who
 * paid whom would create exactly the database this product spent its whole design
 * avoiding — and it would do it for a convenience feature. A person's payment
 * history is the most sensitive thing this workspace could hold, and the
 * honest place for it is the machine they are sitting at.
 *
 * The costs are real and are stated on the Settings surface rather than hidden:
 * clearing site data clears the history, a second browser shows nothing, and a
 * private window forgets on close. None of that costs anybody their evidence —
 * the receipt is a file they downloaded and the ledger is public. What is lost is
 * a convenience, which is the right thing to lose.
 *
 * ## Failing closed
 *
 * Every read returns `[]` rather than throwing when storage is unavailable —
 * server rendering, a private window with storage disabled, a quota that is
 * full. A workspace that cannot list its history still has to render; an
 * exception here would blank a page over a convenience.
 *
 * Writes that cannot happen are **reported to the caller** rather than swallowed,
 * because the Send surface has to be able to say "this run will not be
 * remembered" instead of implying it was.
 */

export const ACTIVITY_STORAGE_KEY = "ryntra.stellar-activity.v1";

/**
 * How many actions are kept.
 *
 * A cap rather than unbounded growth: this is a browser key with a few megabytes
 * behind it, shared with every other origin preference. Fifty is far more than a
 * testnet workspace produces and small enough that the oldest entry leaving is a
 * decision rather than an accident. Trimming is oldest-first by `updatedAt`.
 */
export const ACTIVITY_LIMIT = 50;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    /* Access itself throws when cookies are blocked, before any read. */
    return null;
  }
}

/** Anything that is not exactly a record of the current schema is dropped. */
function parseRecord(value: unknown): StellarActivityRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.schema !== ACTIVITY_SCHEMA) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") return null;
  if (!STELLAR_ACTIVITY_STATES.includes(raw.state as StellarActivityState)) return null;
  if (raw.operation !== "payment") return null;
  for (const field of ["network", "assetCode", "amount", "destination"]) {
    if (typeof raw[field] !== "string") return null;
  }
  return raw as unknown as StellarActivityRecord;
}

/**
 * Parse a stored payload.
 *
 * Exported so the suite can prove the fail-closed behaviour without a browser:
 * a truncated write, a foreign key, a future schema and a hand-edited entry must
 * all resolve to "no history" rather than to a crash or to a half-record that
 * renders as a real one.
 */
export function parseActivityPayload(raw: string | null): readonly StellarActivityRecord[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const list = (parsed as { records?: unknown }).records;
  if (!Array.isArray(list)) return [];
  const records: StellarActivityRecord[] = [];
  for (const entry of list) {
    const record = parseRecord(entry);
    if (record) records.push(record);
  }
  return sortActivity(records);
}

export function readActivity(): readonly StellarActivityRecord[] {
  const store = storage();
  if (!store) return [];
  try {
    return parseActivityPayload(store.getItem(ACTIVITY_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Keep the newest `ACTIVITY_LIMIT`. Exported because the trim is worth testing. */
export function trimActivity(records: readonly StellarActivityRecord[]): readonly StellarActivityRecord[] {
  return sortActivity(records).slice(0, ACTIVITY_LIMIT);
}

/**
 * Insert or update one record, and say whether it was kept.
 *
 * The boolean is not decoration. A browser with storage disabled must not leave
 * the Send surface implying a run was recorded, so the caller can tell the
 * person plainly that this one will not be remembered.
 */
export function writeActivity(record: StellarActivityRecord): boolean {
  const store = storage();
  if (!store) return false;
  const existing = readActivity().filter((entry) => entry.id !== record.id);
  const next = trimActivity([record, ...existing]);
  try {
    store.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify({ schema: ACTIVITY_SCHEMA, records: next }));
    return true;
  } catch {
    /* Quota, or a private window that allows reads and refuses writes. */
    return false;
  }
}

/**
 * Record an intent, or update the one already open for it.
 *
 * One function rather than a create and an update, because the Send surface
 * calls it from eight lifecycle stages and the thing that must never happen is
 * eight rows for one payment.
 */
export function recordActivity(
  id: string,
  patch: Omit<Partial<StellarActivityRecord>, "id" | "schema" | "createdAt">,
  seed: Readonly<{
    now: string;
    network: string;
    assetCode: string;
    amount: string;
    destination: string;
    memo?: string | null;
    source?: string | null;
  }>,
): boolean {
  const found = readActivity().find((entry) => entry.id === id);
  const base = found ?? newActivityRecord({ id, ...seed });
  return writeActivity(applyActivityUpdate(base, patch, seed.now));
}

export function clearActivity(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(ACTIVITY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Whether this browser will remember anything at all. */
export function activityIsRetained(): boolean {
  return storage() !== null;
}
