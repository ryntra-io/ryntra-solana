/**
 * The Market Weather data contract: what a market signal is, and the rules that decide whether a product may show it.
 *
 * Four promises, each enforced here rather than left to a caller:
 *
 * 1. **Source and time.** Every reading names the source it came from, the URL anyone can read again, and the time it
 *    was true — and says whether that time is the source's own or only the moment it was read.
 * 2. **Minimum liquidity.** A signal about a market thinner than the floor is `thin`, never `live`.
 * 3. **Two reads.** A value is `live` only when two readings from two different sources agree. One reading is
 *    `single_read`; two that differ are `disagree`.
 * 4. **Data delayed.** When the freshest reading is older than the policy allows, the signal is `delayed`.
 *
 * And one rule under all four: a figure nobody measured is `not_measured`, never a zero. A source that leaves a field
 * out, or sends text, `NaN` or `Infinity`, measured nothing; a source that sends `0` measured zero.
 *
 * Pure: no network, no clock unless given. Relative imports carry their extension, so `node --test` loads it as is.
 */

/** Where a reading came from. Each id is one endpoint family; two readings count as two only across different ids. */
export const SOURCES = ["jupiter-price-v3", "jupiter-tokens-v2", "meteora-dlmm", "meteora-damm-v2", "solana-rpc"] as const;
export type SourceId = (typeof SOURCES)[number];

/** A figure: the number a source measured, or the fact that it measured none and why. */
export type Measured =
  | Readonly<{ state: "measured"; value: number }>
  | Readonly<{ state: "not_measured"; why: string }>;

export const NOT_MEASURED_LABEL: Readonly<Record<"en" | "uk", string>> = Object.freeze({ en: "Not measured", uk: "Не виміряно" });

/** A number the source sent, as a figure. Anything but a finite number measured nothing. */
export function measure(raw: unknown, why = "the source did not state it"): Measured {
  return typeof raw === "number" && Number.isFinite(raw) ? { state: "measured", value: raw } : { state: "not_measured", why };
}

export const notMeasured = (why: string): Measured => ({ state: "not_measured", why });

/** The number inside a figure, or null. Never a zero standing in for nothing. */
export const valueOf = (figure: Measured): number | null => (figure.state === "measured" ? figure.value : null);

/** A figure for a screen: formatted when measured, «Not measured» when not. */
export function shown(figure: Measured, format: (value: number) => string, locale: "en" | "uk" = "en"): string {
  return figure.state === "measured" ? format(figure.value) : NOT_MEASURED_LABEL[locale];
}

/** One reading of one figure. */
export type Reading = Readonly<{
  source: SourceId;
  /** Where anyone can read the same figure again. */
  url: string;
  /** When the figure was true, ISO 8601. */
  observedAt: string;
  /** `source` when the source stated the time; `read` when it stated none and `observedAt` is the moment of reading. */
  timeFrom: "source" | "read";
  value: Measured;
  /** How a derived figure was made, in one line (e.g. a pool price converted to dollars). Absent on a direct figure. */
  derivation?: string;
}>;

/** What a product may do with a signal. Only `live` is a fact to show as live. */
export const SIGNAL_STATUSES = ["live", "single_read", "disagree", "thin", "delayed", "not_measured"] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export const SIGNAL_KINDS = ["price", "change24h"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export type Signal = Readonly<{
  asset: string;
  kind: SignalKind;
  status: SignalStatus;
  /** The value the reads agree on (their mean), or the one reading's value; `not_measured` when none measured. */
  value: Measured;
  /** The source of the freshest measured reading, and its time; null when nothing was measured. */
  source: SourceId | null;
  at: string | null;
  liquidityUsd: Measured;
  reads: readonly Reading[];
  /** One line on why the status is not `live`; absent when it is. */
  why?: string;
}>;

export type WeatherPolicy = Readonly<{
  /** Below this pool depth in dollars a market is `thin`. Unmeasured liquidity is thin too: depth unknown is not depth. */
  minLiquidityUsd: number;
  /** A reading older than this is late; a signal whose freshest reading is late is `delayed`. */
  maxAgeMs: number;
  /** Two prices agree when they differ by at most this share of their mean, in percent. */
  priceAgreementPct: number;
  /** Two percent moves agree when they point the same way and differ by at most this many percentage points. */
  moveAgreementPts: number;
  /** A move of at least this many percent is an event worth a city's attention. */
  moveThresholdPct: number;
  /** One asset raises at most one move event per this many milliseconds. */
  cooldownMs: number;
  /** The weather needs at least this many assets with a live move; fewer is `not_measured` (or `fog` when late). */
  minAssets: number;
  /** A graduated pool counts as alive at a survival check when it holds at least this much in dollars and traded today. */
  survivalTvlUsd: number;
}>;

export const DEFAULT_POLICY: WeatherPolicy = Object.freeze({
  minLiquidityUsd: 50_000,
  maxAgeMs: 180_000,
  priceAgreementPct: 2,
  moveAgreementPts: 1.5,
  moveThresholdPct: 5,
  cooldownMs: 15 * 60_000,
  minAssets: 3,
  survivalTvlUsd: 5_000,
});

const stamp = (iso: string | null): number => {
  if (!iso) return Number.NaN;
  return Date.parse(iso);
};

/** Whether a reading is later than the policy allows at `now`. A reading with no valid time is late. */
export function isLate(reading: Pick<Reading, "observedAt">, now: number, policy: Pick<WeatherPolicy, "maxAgeMs">): boolean {
  const at = stamp(reading.observedAt);
  return !Number.isFinite(at) || now - at > policy.maxAgeMs;
}

function agree(kind: SignalKind, a: number, b: number, policy: WeatherPolicy): boolean {
  if (kind === "price") {
    const mid = (Math.abs(a) + Math.abs(b)) / 2;
    if (mid === 0) return a === b;
    return (Math.abs(a - b) / mid) * 100 <= policy.priceAgreementPct;
  }
  /* A move: the same direction (or both flat), and close in size. */
  const sameWay = Math.sign(a) === Math.sign(b) || (Math.abs(a) < policy.moveAgreementPts && Math.abs(b) < policy.moveAgreementPts);
  return sameWay && Math.abs(a - b) <= policy.moveAgreementPts;
}

/**
 * Judge one signal from its readings. The order of the checks is the order of the promises: nothing measured, then
 * depth, then lateness, then the two reads. A thin market is thin whatever its reads say; a late signal is late even
 * when two late reads agree.
 */
export function judgeSignal(
  args: Readonly<{ asset: string; kind: SignalKind; reads: readonly Reading[]; liquidityUsd: Measured; now: number; policy?: WeatherPolicy }>,
): Signal {
  const policy = args.policy ?? DEFAULT_POLICY;
  const measuredReads = args.reads.filter((read) => read.value.state === "measured");
  const freshest = [...measuredReads].sort((a, b) => stamp(b.observedAt) - stamp(a.observedAt))[0] ?? null;
  const base = { asset: args.asset, kind: args.kind, liquidityUsd: args.liquidityUsd, reads: args.reads };
  if (!freshest) {
    return { ...base, status: "not_measured", value: notMeasured("no source measured it"), source: null, at: null, why: "no source measured it" };
  }
  const head = { ...base, source: freshest.source, at: freshest.observedAt };
  const depth = valueOf(args.liquidityUsd);
  if (depth === null || depth < policy.minLiquidityUsd) {
    return { ...head, status: "thin", value: freshest.value, why: depth === null ? "liquidity not measured" : `liquidity below ${policy.minLiquidityUsd} USD` };
  }
  if (isLate(freshest, args.now, policy)) {
    return { ...head, status: "delayed", value: freshest.value, why: "data delayed" };
  }
  /* The freshest reading from each source that is itself on time: one per source, so one source never counts twice. */
  const bySource = new Map<SourceId, Reading>();
  for (const read of measuredReads) {
    if (isLate(read, args.now, policy)) continue;
    const known = bySource.get(read.source);
    if (!known || stamp(read.observedAt) > stamp(known.observedAt)) bySource.set(read.source, read);
  }
  const onTime = [...bySource.values()];
  if (onTime.length < 2) {
    /* A second source that answered, but late, is a delay — not a market with one source. */
    const sources = new Set(measuredReads.map((read) => read.source));
    if (sources.size >= 2) return { ...head, status: "delayed", value: freshest.value, why: "a second read is late" };
    return { ...head, status: "single_read", value: freshest.value, why: "one source only" };
  }
  const values = onTime.map((read) => valueOf(read.value) as number);
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (!agree(args.kind, values[i] as number, values[j] as number, policy)) {
        return { ...head, status: "disagree", value: freshest.value, why: "sources disagree" };
      }
    }
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { ...head, status: "live", value: { state: "measured", value: mean } };
}
