/**
 * A move as the city writes it — «+4.2%», «−3.1%» — rounded first, so a move that rounds to nothing reads «0.0%» and not
 * «−0.0%» (CITY-200: the hover card of SOL read «−0.0% 1H» in red). `flat` says the rounded move is nothing.
 */
export function signedMove(v: number): Readonly<{ text: string; flat: boolean; up: boolean }> {
  const r = Math.round(v * 10) / 10;
  if (r === 0) return { text: '0.0%', flat: true, up: true };
  return { text: `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(1)}%`, flat: false, up: r > 0 };
}
