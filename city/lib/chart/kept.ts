/** A value this browser keeps for the chart; null where there is none, or no store (a denied one, or no window). */
export function kept(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
