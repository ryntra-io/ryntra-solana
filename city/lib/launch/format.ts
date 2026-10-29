/** How the city says the engine's figures: short, never rounded into more than they are. */

/** A share in basis points: 5000 → 50%, 250 → 2.5%. */
export function pct(bps: number): string {
  const value = bps / 100;
  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}%`;
}

/** A dollar figure, short: 75000 → $75K, 3594.7 → $3.6K, 1250000 → $1.25M. */
export function usd(value: number): string {
  if (value >= 1e6) return `$${Number((value / 1e6).toFixed(2))}M`;
  if (value >= 1e3) return `$${Number((value / 1e3).toFixed(value >= 1e4 ? 0 : 1))}K`;
  return `$${Math.round(value)}`;
}

/** A span of time: 600 → 10 min, 45 → 45 s, 7200 → 2 h. */
export function span(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Number((seconds / 60).toFixed(1))} min`;
  return `${Number((seconds / 3600).toFixed(1))} h`;
}

/** Lamports as SOL with four decimals, rounded up, so a cost never reads as less than it is. */
export function sol(lamports: string): string {
  const unit = 100_000n;
  const up = (BigInt(lamports) + unit - 1n) / unit;
  return `${up / 10_000n}.${(up % 10_000n).toString().padStart(4, '0')}`;
}

/** The time since a launch as the docks count it: T+00:42 in its first day, then the day. */
export function sinceLaunch(launchedAt: string | null, now: number): string | null {
  const at = launchedAt ? Date.parse(launchedAt) : NaN;
  if (!Number.isFinite(at)) return null;
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds >= 86_400) return `Day ${Math.floor(seconds / 86_400)}`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `T+${hours}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `T+${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A wallet address, short: 7xKX…9fQa. */
export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
