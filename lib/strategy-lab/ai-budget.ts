/**
 * Best-effort spend and concurrency control for optional Strategy Lab AI calls.
 *
 * This controller is deliberately process-local: it coordinates one warm runtime
 * instance only. It is neither cross-instance nor durable idempotency, and it must
 * not be used as evidence, approval, persistence, or execution state.
 */

export type StrategyAiOperation = "formalize" | "review";

export type StrategyAiCallInput = {
  userKey: string;
  operation: StrategyAiOperation;
  requestId: string;
  /** SHA-256 of the full canonical, validated operation payload (lowercase hex). */
  payloadHash: string;
};

export type StrategyAiErrorSnapshot = Readonly<{
  name: string;
  message: string;
  code?: string;
}>;

export type StrategyAiCompletion<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: StrategyAiErrorSnapshot }>;

export type StrategyAiControlResult<T> =
  | {
      decision: "allowed" | "idempotent";
      retryAfterSeconds: 0;
      completion: StrategyAiCompletion<T>;
    }
  | {
      decision: "idempotency-conflict";
      retryAfterSeconds: 0;
    }
  | {
      decision: "in-flight" | "global-in-flight" | "user-budget" | "global-budget";
      retryAfterSeconds: number;
    };

type Clock = () => number;

export type StrategyAiBudgetOptions = {
  perUserLimit: number;
  perUserWindowMs: number;
  globalLimit: number;
  globalWindowMs: number;
  completedTtlMs: number;
  maxCompletedEntries: number;
  maxUserBuckets: number;
  maxGlobalInFlight?: number;
  inFlightRetryAfterSeconds?: number;
  now?: Clock;
};

type Bucket = {
  count: number;
  resetAt: number;
};

type CompletedEntry = {
  completion: StrategyAiCompletion<unknown>;
  expiresAt: number;
  payloadHash: string;
};

type InFlightEntry = {
  key: string;
  payloadHash: string;
};

const CANONICAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function retryAfter(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1_000));
}

function cacheKey(input: StrategyAiCallInput): string {
  return JSON.stringify([input.userKey, input.operation, input.requestId]);
}

function validateInput(input: StrategyAiCallInput): void {
  if (!input || typeof input !== "object") throw new TypeError("input is required");
  if (typeof input.userKey !== "string" || input.userKey.length < 1 || input.userKey.length > 160) {
    throw new TypeError("userKey must contain 1 to 160 characters");
  }
  if (input.operation !== "formalize" && input.operation !== "review") {
    throw new TypeError("operation must be formalize or review");
  }
  if (typeof input.requestId !== "string" || !CANONICAL_UUID_RE.test(input.requestId)) {
    throw new TypeError("requestId must be a canonical lowercase UUID");
  }
  if (typeof input.payloadHash !== "string" || !SHA256_RE.test(input.payloadHash)) {
    throw new TypeError("payloadHash must be a lowercase SHA-256 hex digest");
  }
}

function ownDataProperty(source: unknown, key: string): unknown {
  if ((typeof source !== "object" || source === null) && typeof source !== "function") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function boundedText(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === "string" && value.length > 0 ? value.slice(0, maxLength) : fallback;
}

function snapshotError(error: unknown): StrategyAiErrorSnapshot {
  const code = ownDataProperty(error, "code");
  const snapshot: { name: string; message: string; code?: string } = {
    name: boundedText(ownDataProperty(error, "name"), "Error", 80),
    message: boundedText(ownDataProperty(error, "message"), "AI loader failed", 500),
  };
  if (typeof code === "string" || typeof code === "number") snapshot.code = String(code).slice(0, 80);
  return Object.freeze(snapshot);
}

function immutableJsonClone(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("completion contains a non-finite number");
    return value;
  }
  if (typeof value !== "object") throw new TypeError("completion is not JSON-safe");
  if (seen.has(value)) throw new TypeError("completion contains a cycle");
  seen.add(value);

  if (Array.isArray(value)) {
    const cloned = value.map((entry) => immutableJsonClone(entry, seen));
    seen.delete(value);
    return Object.freeze(cloned);
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("completion contains a non-plain object");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("completion contains symbol keys");
  }

  const cloned: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) throw new TypeError("completion contains an accessor");
    const clonedValue = immutableJsonClone(descriptor.value, seen);
    Object.defineProperty(cloned, key, {
      value: clonedValue,
      enumerable: true,
      writable: false,
      configurable: false,
    });
  }
  seen.delete(value);
  return Object.freeze(cloned);
}

function snapshotCompletion<T>(completion: StrategyAiCompletion<T>): StrategyAiCompletion<T> {
  if (!completion.ok) {
    return Object.freeze({ ok: false, error: snapshotError(completion.error) });
  }
  try {
    return Object.freeze({ ok: true, value: immutableJsonClone(completion.value) as T });
  } catch {
    return Object.freeze({
      ok: false,
      error: Object.freeze({
        name: "UncacheableCompletion",
        message: "AI loader completion was not JSON-safe",
      }),
    });
  }
}

function cloneCompletion<T>(completion: StrategyAiCompletion<unknown>): StrategyAiCompletion<T> {
  return snapshotCompletion(completion as StrategyAiCompletion<T>);
}

/**
 * Runs at most one upstream AI call per user at a time and caches the settled
 * result by user + operation + requestId. The caller must bind payloadHash to
 * the full canonical request; UUID reuse with a changed payload fails closed.
 *
 * Budgets are fixed windows that start with the first accepted call. Only a new
 * allowed call consumes them; retries and blocked calls do not. Loader failures
 * become bounded immutable error snapshots, so an upstream rejection is never
 * left as an internal unhandled promise or a mutable cached reference.
 */
export class StrategyAiBudgetController {
  readonly perUserLimit: number;
  readonly perUserWindowMs: number;
  readonly globalLimit: number;
  readonly globalWindowMs: number;
  readonly completedTtlMs: number;
  readonly maxCompletedEntries: number;
  readonly maxUserBuckets: number;
  readonly maxGlobalInFlight: number;
  readonly inFlightRetryAfterSeconds: number;

  private readonly now: Clock;
  private readonly completed = new Map<string, CompletedEntry>();
  private readonly inFlightByUser = new Map<string, InFlightEntry>();
  private readonly userBuckets = new Map<string, Bucket>();
  private globalBucket: Bucket | null = null;

  constructor(options: StrategyAiBudgetOptions) {
    this.perUserLimit = positiveInteger(options.perUserLimit, "perUserLimit");
    this.perUserWindowMs = positiveInteger(options.perUserWindowMs, "perUserWindowMs");
    this.globalLimit = positiveInteger(options.globalLimit, "globalLimit");
    this.globalWindowMs = positiveInteger(options.globalWindowMs, "globalWindowMs");
    this.completedTtlMs = positiveInteger(options.completedTtlMs, "completedTtlMs");
    this.maxCompletedEntries = positiveInteger(options.maxCompletedEntries, "maxCompletedEntries");
    this.maxUserBuckets = positiveInteger(options.maxUserBuckets, "maxUserBuckets");
    this.maxGlobalInFlight = positiveInteger(options.maxGlobalInFlight ?? 4, "maxGlobalInFlight");
    this.inFlightRetryAfterSeconds = positiveInteger(
      options.inFlightRetryAfterSeconds ?? 1,
      "inFlightRetryAfterSeconds",
    );
    this.now = options.now ?? Date.now;
  }

  get completedSize(): number {
    return this.completed.size;
  }

  get inFlightSize(): number {
    return this.inFlightByUser.size;
  }

  get userBucketSize(): number {
    return this.userBuckets.size;
  }

  /** Removes expired completed entries and per-user windows. In-flight calls are never evicted. */
  cleanup(): { completedEntries: number; userBuckets: number; inFlightUsers: number } {
    const now = this.readNow();
    this.sweep(now);
    return {
      completedEntries: this.completed.size,
      userBuckets: this.userBuckets.size,
      inFlightUsers: this.inFlightByUser.size,
    };
  }

  /**
   * Executes loader for a fresh admitted request. The returned promise always
   * resolves for an upstream success/failure and for a settlement-clock failure.
   * Programmer errors in input or the admission clock are thrown synchronously.
   */
  execute<T>(input: StrategyAiCallInput, loader: () => T | PromiseLike<T>): Promise<StrategyAiControlResult<T>> {
    validateInput(input);
    if (typeof loader !== "function") throw new TypeError("loader must be a function");

    const now = this.readNow();
    this.sweep(now);
    const key = cacheKey(input);
    const cached = this.completed.get(key);
    if (cached) {
      if (cached.payloadHash !== input.payloadHash) {
        return Promise.resolve({ decision: "idempotency-conflict", retryAfterSeconds: 0 });
      }
      this.touchCompleted(key, cached);
      return Promise.resolve({
        decision: "idempotent",
        retryAfterSeconds: 0,
        completion: cloneCompletion<T>(cached.completion),
      });
    }

    const pending = this.inFlightByUser.get(input.userKey);
    if (pending?.key === key && pending.payloadHash !== input.payloadHash) {
      return Promise.resolve({ decision: "idempotency-conflict", retryAfterSeconds: 0 });
    }
    if (pending) {
      return Promise.resolve({
        decision: "in-flight",
        retryAfterSeconds: this.inFlightRetryAfterSeconds,
      });
    }

    if (this.inFlightByUser.size >= this.maxGlobalInFlight) {
      return Promise.resolve({
        decision: "global-in-flight",
        retryAfterSeconds: this.inFlightRetryAfterSeconds,
      });
    }

    const userBucket = this.userBuckets.get(input.userKey);
    if (userBucket && userBucket.count >= this.perUserLimit) {
      this.touchUserBucket(input.userKey, userBucket);
      return Promise.resolve({
        decision: "user-budget",
        retryAfterSeconds: retryAfter(userBucket.resetAt, now),
      });
    }

    if (this.globalBucket && this.globalBucket.count >= this.globalLimit) {
      return Promise.resolve({
        decision: "global-budget",
        retryAfterSeconds: retryAfter(this.globalBucket.resetAt, now),
      });
    }

    let admittedUserBucket = userBucket;
    if (!admittedUserBucket) {
      if (this.userBuckets.size >= this.maxUserBuckets) {
        let oldestResetAt = Number.POSITIVE_INFINITY;
        for (const bucket of this.userBuckets.values()) oldestResetAt = Math.min(oldestResetAt, bucket.resetAt);
        return Promise.resolve({
          decision: "global-budget",
          retryAfterSeconds: retryAfter(oldestResetAt, now),
        });
      }
      admittedUserBucket = { count: 0, resetAt: now + this.perUserWindowMs };
      this.userBuckets.set(input.userKey, admittedUserBucket);
    } else {
      this.touchUserBucket(input.userKey, admittedUserBucket);
    }

    if (!this.globalBucket) this.globalBucket = { count: 0, resetAt: now + this.globalWindowMs };
    admittedUserBucket.count += 1;
    this.globalBucket.count += 1;
    this.inFlightByUser.set(input.userKey, { key, payloadHash: input.payloadHash });

    return this.settle(input.userKey, key, input.payloadHash, now, loader);
  }

  private async settle<T>(
    userKey: string,
    key: string,
    payloadHash: string,
    admittedAt: number,
    loader: () => T | PromiseLike<T>,
  ): Promise<StrategyAiControlResult<T>> {
    let completion: StrategyAiCompletion<T>;
    try {
      completion = { ok: true, value: await loader() };
    } catch (error: unknown) {
      completion = { ok: false, error: snapshotError(error) };
    }

    if (this.inFlightByUser.get(userKey)?.key === key) this.inFlightByUser.delete(userKey);
    const completedAt = this.readSettlementNow(admittedAt);
    this.sweep(completedAt);
    this.makeCompletedRoom();
    const stored = snapshotCompletion(completion);
    this.completed.set(key, {
      completion: stored as StrategyAiCompletion<unknown>,
      expiresAt: completedAt + this.completedTtlMs,
      payloadHash,
    });

    return {
      decision: "allowed",
      retryAfterSeconds: 0,
      completion: cloneCompletion<T>(stored as StrategyAiCompletion<unknown>),
    };
  }

  private readNow(): number {
    const now = this.now();
    if (!Number.isFinite(now) || now < 0) throw new TypeError("now() must return a non-negative finite timestamp");
    return now;
  }

  private readSettlementNow(fallback: number): number {
    try {
      return this.readNow();
    } catch {
      return fallback;
    }
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.completed) {
      if (entry.expiresAt <= now) this.completed.delete(key);
    }
    for (const [userKey, bucket] of this.userBuckets) {
      if (bucket.resetAt <= now) this.userBuckets.delete(userKey);
    }
    if (this.globalBucket && this.globalBucket.resetAt <= now) this.globalBucket = null;
  }

  private makeCompletedRoom(): void {
    while (this.completed.size >= this.maxCompletedEntries) {
      const oldest = this.completed.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.completed.delete(oldest);
    }
  }

  private touchCompleted(key: string, entry: CompletedEntry): void {
    this.completed.delete(key);
    this.completed.set(key, entry);
  }

  private touchUserBucket(userKey: string, bucket: Bucket): void {
    this.userBuckets.delete(userKey);
    this.userBuckets.set(userKey, bucket);
  }
}