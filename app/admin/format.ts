/**
 * Small display helpers shared by the admin panels. Client-safe, pure.
 * Dates are rendered in the operator's locale from ISO instants the server
 * produced in UTC; the definition beside a metric names the window and zone.
 */

export function formatInt(value: number): string {
  return value.toLocaleString("uk-UA");
}

export function formatPercent(value: number): string {
  return value.toLocaleString("uk-UA", { style: "percent", maximumFractionDigits: 0 });
}

/**
 * Dollars for the owner: cents on ordinary sums, four places under a dollar
 * so a fee of $0.0126 reads as itself rather than as nothing. A true zero is
 * `$0`; a sign is kept, a NaN is a dash.
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 4;
  const text = abs.toLocaleString("en-US", { minimumFractionDigits: digits === 4 ? 2 : digits, maximumFractionDigits: digits });
  return `${value < 0 ? "−" : ""}$${text}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleDateString("uk-UA", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleString("uk-UA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}

/** "3 хв тому", "2 год тому", "5 дн тому" — the age of a fact, never a fake precision. */
export function formatAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "—";
  const minutes = Math.max(0, Math.round((now.getTime() - at) / 60_000));
  if (minutes < 1) return "щойно";
  if (minutes < 60) return `${minutes} хв тому`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} год тому`;
  const days = Math.round(hours / 24);
  return `${days} дн тому`;
}

export function formatHours(hours: number): string {
  if (hours < 1) return "менше години";
  if (hours < 48) return `${formatInt(hours)} год`;
  return `${formatInt(Math.round(hours / 24))} дн`;
}

export function formatLatency(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} мс`;
  return `${(ms / 1000).toLocaleString("uk-UA", { maximumFractionDigits: 1 })} с`;
}
