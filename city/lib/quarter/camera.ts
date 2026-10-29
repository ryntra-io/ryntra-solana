/**
 * The camera of the build mode, as plain numbers so it can be tested without a browser: where it stands over a
 * quarter, how it frames the lot around the sheet at the bottom of a phone or at the right of a desk, and the
 * flight in from wherever the city's camera was.
 */

export type Vec3 = { x: number; y: number; z: number };
export type Pose = { position: Vec3; target: Vec3 };

/** How the camera sits over the lot: azimuth 0 looks north from the south, pitch is the angle below the horizon. */
export type View = { azimuth: number; pitch: number; distance: number };

/** The azimuth that looks at a lot's front from its street: north for a lot facing south, south for one facing north. */
export const frontAzimuth = (facing: 1 | -1): number => (facing === 1 ? 0 : Math.PI);

export const PITCH_MIN = 0.55;
export const PITCH_MAX = 1.3;
export const DISTANCE_MIN = 16;
export const DISTANCE_MAX = 46;
/** How far the view may turn from looking north, either way. */
export const AZIMUTH_RANGE = 1.1;

/** The camera position for a view of a target. */
export function orbit(target: Vec3, view: View): Vec3 {
  const h = Math.cos(view.pitch) * view.distance;
  return { x: target.x - Math.sin(view.azimuth) * h, y: target.y + Math.sin(view.pitch) * view.distance, z: target.z + Math.cos(view.azimuth) * h };
}

/**
 * The first view of a lot for a screen, its azimuth counted from the lot's front: a little to one side, so the
 * homes show two faces. On a phone the sheet covers the lower part, so the camera aims a little in front of the
 * lot and the lot sits high; on a desk the sheet stands at the right, so the lot sits left.
 */
export function homeView(width: number, height: number): View & { lead: number; side: number } {
  if (width < height) return { azimuth: 0.32, pitch: 0.74, distance: 39, lead: 5, side: 0 };
  return { azimuth: 0.32, pitch: 0.64, distance: 40, lead: 2.5, side: 7.5 };
}

/** The look target for a lot: moved toward the camera by `lead` and to its right by `side`. */
export function aim(lot: { x: number; z: number }, azimuth: number, lead: number, side: number): Vec3 {
  const fx = Math.sin(azimuth);
  const fz = -Math.cos(azimuth);
  const rx = Math.cos(azimuth);
  const rz = Math.sin(azimuth);
  return { x: lot.x - fx * lead + rx * side, y: 0, z: lot.z - fz * lead + rz * side };
}

export const clampView = (v: View): View => ({
  azimuth: Math.max(-AZIMUTH_RANGE, Math.min(AZIMUTH_RANGE, v.azimuth)),
  pitch: Math.max(PITCH_MIN, Math.min(PITCH_MAX, v.pitch)),
  distance: Math.max(DISTANCE_MIN, Math.min(DISTANCE_MAX, v.distance)),
});

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Smootherstep: no jolt at either end. */
export const ease = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** How long the flight takes for the distance it covers: never a jump, never a wait. */
export function flightSeconds(from: Pose, to: Pose): number {
  const d = Math.hypot(to.position.x - from.position.x, to.position.y - from.position.y, to.position.z - from.position.z);
  return Math.max(1.5, Math.min(2.6, 1.2 + d / 60));
}

/**
 * A point of the flight from one pose to another at t in 0…1: eased at both ends, and lifted in the middle by
 * `lift` so it reads as a flight over the water rather than a slide.
 */
export function flightAt(from: Pose, to: Pose, t: number, lift: number): Pose {
  const e = ease(t);
  const rise = Math.sin(Math.PI * e) * lift;
  return {
    position: { x: lerp(from.position.x, to.position.x, e), y: lerp(from.position.y, to.position.y, e) + rise, z: lerp(from.position.z, to.position.z, e) },
    target: { x: lerp(from.target.x, to.target.x, e), y: lerp(from.target.y, to.target.y, e), z: lerp(from.target.z, to.target.z, e) },
  };
}
