import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import type { BacktestImportManifest, NormalizedTrade } from "./types.ts";

export const TRADINGVIEW_FILE_MAX_BYTES = 1_000_000;
export const TRADINGVIEW_MAX_ROWS = 20_000;

function parseStrictUtcDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(value + "T00:00:00.000Z");
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}

const DateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => parseStrictUtcDate(value) !== null, "Date must be a real YYYY-MM-DD calendar date.");
const ManifestSchema: z.ZodType<BacktestImportManifest> = z.object({
  schemaVersion: z.literal(1),
  provider: z.literal("tradingview"),
  strategyVersionId: z.string().uuid(),
  compilerVersion: z.string().min(1).max(64),
  pineHash: z.string().regex(/^[a-f0-9]{64}$/),
  symbol: z.string().min(2).max(64),
  timeframe: z.string().min(1).max(8),
  timezone: z.literal("UTC"),
  compileWindow: z.object({ start: DateSchema, end: DateSchema }).strict(),
  initialCapital: z.number().finite().positive().max(1_000_000_000_000),
  exportedAt: z.string().datetime(),
  tradesFileHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  metricsFileHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

const hash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[\s$€£¥%]/g, "").replace(/,(?=\d{3}(?:\D|$))/g, "");
  if (!cleaned) return null;
  const negative = /^\(.*\)$/.test(value.trim());
  const source = cleaned.replace(/[()]/g, "").replace(/\u2212/g, "-");
  let normalized = source;
  const comma = source.lastIndexOf(",");
  const dot = source.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot ? source.replace(/\./g, "").replace(",", ".") : source.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = /^-?\d{1,3}(?:,\d{3})+$/.test(source) ? source.replace(/,/g, "") : source.replace(",", ".");
  }
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? (negative ? -Math.abs(parsed) : parsed) : null;
}

function text(record: Record<string, unknown>, names: string[]): string {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function numeric(record: Record<string, unknown>, names: string[]): number | null {
  for (const name of names) {
    const value = num(record[name]);
    if (value !== null) return value;
  }
  return null;
}

function parseCsv(value: string): Record<string, string>[] {
  return parse(value.replace(/^\uFEFF/, ""), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: false,
    max_record_size: 64_000,
  }) as Record<string, string>[];
}

function parseUtcDateTime(value: string): number | null {
  const source = value.trim();
  if (!source) return null;
  const plain = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(source);
  if (plain) {
    const date = parseStrictUtcDate(plain[1]);
    const hour = Number(plain[2]);
    const minute = Number(plain[3]);
    const second = Number(plain[4] ?? "0");
    if (date === null || hour > 23 || minute > 59 || second > 59) return null;
    return date + hour * 3_600_000 + minute * 60_000 + second * 1_000;
  }
  const zoned = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/.exec(source);
  if (!zoned || parseStrictUtcDate(zoned[1]) === null
    || Number(zoned[2]) > 23 || Number(zoned[3]) > 59 || Number(zoned[4] ?? "0") > 59) {
    return null;
  }
  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasAny(headers: Set<string>, names: string[]): boolean {
  return names.some((name) => headers.has(name));
}

function normalizeTrades(rows: Record<string, string>[]): NormalizedTrade[] | null {
  if (!rows.length || rows.length > TRADINGVIEW_MAX_ROWS) return null;
  const headers = new Set(Object.keys(rows[0]));
  if (!hasAny(headers, ["Trade #", "Trade number"])
    || !headers.has("Type")
    || !hasAny(headers, ["Date/Time", "Date and time"])
    || !headers.has("Price")
    || !hasAny(headers, ["Contracts", "Quantity", "Qty", "Position size"])
    || !hasAny(headers, ["Profit", "Net P&L", "P&L"])) {
    return null;
  }

  const grouped = new Map<string, { entry?: Record<string, string>; exit?: Record<string, string> }>();
  for (const row of rows) {
    const id = text(row, ["Trade #", "Trade number"]);
    const type = text(row, ["Type"]).toLowerCase();
    const isEntry = type.includes("entry");
    const isExit = type.includes("exit");
    if (!id || id.length > 64 || isEntry === isExit) return null;
    const item = grouped.get(id) ?? {};
    if (isEntry) {
      if (item.entry) return null;
      item.entry = row;
    } else {
      if (item.exit) return null;
      item.exit = row;
    }
    grouped.set(id, item);
  }

  const trades: NormalizedTrade[] = [];
  for (const [id, pair] of grouped) {
    if (!pair.entry || !pair.exit) return null;
    const entryPrice = numeric(pair.entry, ["Price"]);
    const exitPrice = numeric(pair.exit, ["Price"]);
    const quantity = numeric(pair.entry, ["Contracts", "Quantity", "Qty", "Position size"])
      ?? numeric(pair.exit, ["Contracts", "Quantity", "Qty", "Position size"]);
    const grossPnl = numeric(pair.exit, ["Profit", "Net P&L", "P&L"]);
    const entryAt = parseUtcDateTime(text(pair.entry, ["Date/Time", "Date and time"]));
    const exitAt = parseUtcDateTime(text(pair.exit, ["Date/Time", "Date and time"]));
    const tradeType = [
      text(pair.entry, ["Type"]),
      text(pair.entry, ["Signal"]),
      text(pair.exit, ["Type"]),
      text(pair.exit, ["Signal"]),
    ].join(" ").toLowerCase();
    const side: "long" | "short" = tradeType.includes("short") ? "short" : "long";
    if (entryPrice === null || exitPrice === null || quantity === null || grossPnl === null
      || entryAt === null || exitAt === null || exitAt < entryAt
      || entryPrice <= 0 || exitPrice <= 0 || quantity <= 0) {
      return null;
    }
    trades.push({ id, side, entryAt, exitAt, entryPrice, exitPrice, quantity, grossPnl, fees: 0, netPnl: grossPnl });
  }
  return trades.length ? trades.sort((a, b) => a.entryAt - b.entryAt) : null;
}

function normalizeMetricKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/%/g, " percent ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function deriveBenchmarkReturnPercent(metrics: Record<string, number>, initialCapital: number): number | null {
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) return null;
  const normalized = new Map(Object.entries(metrics).map(([key, value]) => [normalizeMetricKey(key), value]));
  const percent = normalized.get("buy and hold percent gain")
    ?? normalized.get("buy hold percent gain")
    ?? normalized.get("buy and hold return percent");
  if (percent !== undefined && Number.isFinite(percent) && percent >= -100 && percent <= 100_000) return percent;
  const amount = normalized.get("buy and hold return") ?? normalized.get("buy hold return");
  if (amount === undefined || !Number.isFinite(amount)) return null;
  const derived = (amount / initialCapital) * 100;
  return derived >= -100 && derived <= 100_000 ? derived : null;
}

export async function parseTradingViewImport(input: { manifest: unknown; tradesCsv: string; performanceCsv: string }): Promise<
  | { ok: true; run: { manifest: BacktestImportManifest; trades: NormalizedTrade[]; metrics: Record<string, number>; rawFilesStored: false } }
  | { ok: false; error: "invalid-manifest" | "file-too-large" | "file-hash-mismatch" | "unsupported-trades-format" | "unsupported-performance-format" }
> {
  const manifest = ManifestSchema.safeParse(input.manifest);
  if (!manifest.success) return { ok: false, error: "invalid-manifest" };
  const start = parseStrictUtcDate(manifest.data.compileWindow.start);
  const end = parseStrictUtcDate(manifest.data.compileWindow.end);
  if (start === null || end === null || start >= end) return { ok: false, error: "invalid-manifest" };
  if (Buffer.byteLength(input.tradesCsv, "utf8") > TRADINGVIEW_FILE_MAX_BYTES
    || Buffer.byteLength(input.performanceCsv, "utf8") > TRADINGVIEW_FILE_MAX_BYTES) {
    return { ok: false, error: "file-too-large" };
  }

  const tradesFileHash = hash(input.tradesCsv);
  const metricsFileHash = hash(input.performanceCsv);
  if ((manifest.data.tradesFileHash && manifest.data.tradesFileHash !== tradesFileHash)
    || (manifest.data.metricsFileHash && manifest.data.metricsFileHash !== metricsFileHash)) {
    return { ok: false, error: "file-hash-mismatch" };
  }

  let tradeRows: Record<string, string>[];
  let metricRows: Record<string, string>[];
  try {
    tradeRows = parseCsv(input.tradesCsv);
  } catch {
    return { ok: false, error: "unsupported-trades-format" };
  }
  try {
    metricRows = parseCsv(input.performanceCsv);
  } catch {
    return { ok: false, error: "unsupported-performance-format" };
  }

  const trades = normalizeTrades(tradeRows);
  if (!trades) return { ok: false, error: "unsupported-trades-format" };
  if (trades.some((trade) => trade.side === "short" || trade.entryAt < start || trade.entryAt >= end)) {
    return { ok: false, error: "unsupported-trades-format" };
  }
  if (!metricRows.length || !("Metric" in metricRows[0]) || !("All" in metricRows[0]) || metricRows.length > 500) {
    return { ok: false, error: "unsupported-performance-format" };
  }
  const metrics: Record<string, number> = {};
  for (const row of metricRows) {
    const key = text(row, ["Metric"]);
    const value = num(row.All);
    if (key && key.length <= 120 && value !== null) metrics[key] = value;
  }
  if (!Object.keys(metrics).length) return { ok: false, error: "unsupported-performance-format" };

  return {
    ok: true,
    run: {
      manifest: { ...manifest.data, tradesFileHash, metricsFileHash },
      trades,
      metrics,
      rawFilesStored: false,
    },
  };
}
