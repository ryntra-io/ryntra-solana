/**
 * A launch's market-cap line in a box: time across, the cap up, the
 * creator's trades and the graduation pinned to the line where they happened.
 * Pure: the chart draws what this returns.
 */

export type CapPoint = Readonly<{ t: number; marketCapPair: number }>
export type CapMarker = Readonly<{ t: number; kind: 'creator-buy' | 'creator-sell' | 'graduated'; signature: string }>

export type CapGeometry = Readonly<{
  path: string
  markers: readonly Readonly<{ x: number; y: number; kind: CapMarker['kind'] }>[]
  high: number
  low: number
  first: number
  last: number
}>

/** Null when there is nothing to draw: no point, or no room. */
export function capGeometry(
  points: readonly CapPoint[],
  markers: readonly CapMarker[],
  width: number,
  height: number,
  pad = 12,
): CapGeometry | null {
  if (points.length === 0 || width <= pad * 2 || height <= pad * 2) return null
  const t0 = points[0]!.t
  const t1 = points[points.length - 1]!.t
  const values = points.map((point) => point.marketCapPair)
  const high = Math.max(...values)
  const low = Math.min(...values)
  // A flat line stands in the middle, not on the floor: a sliver of range around it.
  const top = high === low ? high * 1.05 || 1 : high
  const bottom = high === low ? low * 0.95 : low
  const x = (t: number) => (t1 === t0 ? width / 2 : pad + ((t - t0) / (t1 - t0)) * (width - pad * 2))
  const y = (v: number) => pad + (1 - (v - bottom) / (top - bottom)) * (height - pad * 2)
  const coords = points.map((point) => [x(point.t), y(point.marketCapPair)] as const)
  const drawn = coords.length === 1 ? [[pad, coords[0]![1]] as const, [width - pad, coords[0]![1]] as const] : coords
  const path = drawn.map(([px, py], index) => `${index === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const at = (t: number) => {
    let nearest = points[0]!
    for (const point of points) if (Math.abs(point.t - t) < Math.abs(nearest.t - t)) nearest = point
    return nearest
  }
  return {
    path,
    markers: markers
      .filter((marker) => marker.t >= t0 && marker.t <= t1)
      .map((marker) => ({ x: x(marker.t), y: y(at(marker.t).marketCapPair), kind: marker.kind })),
    high,
    low,
    first: values[0]!,
    last: values[values.length - 1]!,
  }
}
