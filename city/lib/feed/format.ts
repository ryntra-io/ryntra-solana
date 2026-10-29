/** How the feed writes its figures and times: short, the way the city writes every move. */

/** A signed move with its window: «+12.4% · 1h». */
export function move(change: number, window: string): string {
  return `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}% · ${window}`;
}

/** Dollars, short: $2.4M, $810K, $1.20B. */
export function money(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '$0';
  // Each step starts where the one below would round up to a thousand: $999.6K reads $1.0M, never $1000K.
  if (v >= 999_995_000) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 999_500) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 999.5) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

/** How long ago, as the feed's corner says it: now, 4m, 2h, 3d. A time in the future (a clock ahead) is now. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** The time of day, for the event's full line: 12:03. */
export function clock(at: number): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** A ticker as the feed shows it: no leading $, at most twelve characters. */
export function ticker(symbol: string): string {
  return symbol.replace(/^\$/, '').slice(0, 12);
}
