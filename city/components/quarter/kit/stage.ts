import { ALL, C, NEAR, MID, planOf, scaled, type BuildingPlan, type Part, type Rgb, type Shape, type Style, type Vec3 } from '@/city/lib/quarter/kit/parts';

/**
 * The gallery's stage: a stone pier on the water south of the island, one lit lot plate per building. Drawn through
 * the kit like any building, so it costs no extra draw calls. Gallery only; the quarter's real ground is the quarter's.
 */

const part = (shape: Shape, style: Style, at: Vec3, size: Vec3, tint: Rgb, o: Partial<Part> = {}): Part => ({
  shape,
  style,
  at,
  size,
  turn: [0, 0, 0],
  tint,
  glow: C.amber,
  accent: C.amber,
  power: 0.9,
  grain: 1,
  motion: 'none',
  speed: 1,
  phase: 0,
  door: false,
  kerb: false,
  lods: ALL,
  ...o,
});

export const STAGE_TOP = 0.3;

export function stagePlan(center: Vec3, width: number, depth: number, lots: readonly Vec3[], lot: number): BuildingPlan {
  const [cx, , cz] = center;
  const stone = scaled(C.stone, 1.1);
  const parts: Part[] = [part('chamfer', 'stone', [cx, -0.6, cz], [width, 0.6 + STAGE_TOP, depth], stone, { kerb: true, accent: C.amber, power: 1 })];
  // Lamps along the pier's edges.
  const lamps = Math.max(2, Math.round(width / 7));
  for (let i = 0; i <= lamps; i += 1) {
    const x = cx - width / 2 + 0.6 + (i / lamps) * (width - 1.2);
    for (const z of [cz + depth / 2 - 0.6, cz - depth / 2 + 0.6]) {
      parts.push(part('cyl', 'metal', [x, STAGE_TOP, z], [0.1, 0.5, 0.1], C.metal, { lods: NEAR | MID }));
      parts.push(part('sphere', 'light', [x, STAGE_TOP + 0.5, z], [0.16, 0.16, 0.16], C.amber, { glow: scaled(C.amber, 1.2), power: 3.4, lods: NEAR | MID }));
      parts.push(part('disc', 'pool', [x, STAGE_TOP + 0.01, z], [2.2, 1, 2.2], C.amber, { glow: C.amber, power: 0.45, lods: NEAR | MID }));
    }
  }
  // A plate for every lot, with a faint violet edge: the slots a quarter is built on.
  for (const [x, , z] of lots) {
    parts.push(part('box', 'stone', [x, STAGE_TOP, z], [lot - 0.12, 0.03, lot - 0.12], scaled(C.graphite, 0.9), { kerb: true, accent: scaled(C.violet, 1.2), power: 0.6 }));
  }
  return planOf(parts);
}
