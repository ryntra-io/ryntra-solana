/**
 * The market chart's health events as the server writes them: only the fields the core's schema
 * (`ryntra.chart.telemetry/1`) names — the market on the chart, counts, durations and the source's state words — so
 * nothing else a browser sends reaches the log. A body that is not such an event writes nothing.
 */

export const TELEMETRY_SCHEMA = "ryntra.chart.telemetry/1";
const MAX_BODY = 8_192;
const TYPES = new Set(["first_candle", "alert", "health"]);
const RULES = new Set(["frames", "age", "gap", "reconnects", "first_candle", "engine", "gateway"]);
const STATES = new Set(["live", "delayed", "stale", "demo", "gap"]);
const MARKETS = new Set(["open", "closed", "halted", "resolved"]);
const SAFE_ID = /^[A-Za-z0-9:_.-]{1,96}$/;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const word = (v: unknown, set: ReadonlySet<string>): string | null => (typeof v === "string" && set.has(v) ? v : null);
const id = (v: unknown): string | null => (typeof v === "string" && SAFE_ID.test(v) ? v : null);

export function telemetryLine(text: string): string | null {
  if (!text || text.length > MAX_BODY) return null;
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!event || typeof event !== "object" || event.schema !== TELEMETRY_SCHEMA || !TYPES.has(String(event.type))) return null;
  const view = (event.view ?? null) as Record<string, unknown> | null;
  const out: Record<string, unknown> = {
    type: event.type,
    at: num(event.at),
    surface: id(event.surface),
    view: view ? { instrument: id(view.instrument), kind: id(view.kind), venue: id(view.venue), resolution: id(view.resolution) } : null,
  };
  if (event.type === "first_candle") out.ms = num(event.ms);
  if (event.type === "alert") Object.assign(out, { rule: word(event.rule, RULES), on: event.on === true, value: num(event.value), threshold: num(event.threshold) });
  if (event.type === "health")
    Object.assign(out, {
      fps: num(event.fps),
      long_frames: num(event.long_frames),
      age_ms: num(event.age_ms),
      age_max_ms: num(event.age_max_ms),
      state: word(event.state, STATES),
      market: word(event.market, MARKETS),
      gaps: num(event.gaps),
      reconnects: num(event.reconnects),
      engine_errors: num(event.engine_errors),
      first_candle_ms: num(event.first_candle_ms),
      alerts: Array.isArray(event.alerts) ? event.alerts.filter((r) => typeof r === "string" && RULES.has(r)) : [],
    });
  return JSON.stringify(out);
}
