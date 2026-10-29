/**
 * The small amount of rotation maths a character needs, on plain typed arrays so a frame allocates nothing.
 *
 * A quaternion is four numbers (x, y, z, w) at an offset. A bone's placement is a 3×4 affine matrix in row-major order
 * at an offset: rows (r00 r01 r02 tx), (r10 r11 r12 ty), (r20 r21 r22 tz) — exactly the three `vec4` rows the body
 * shader reads per bone (`dot(row, vec4(p, 1))`). Angles are in radians unless a name says degrees.
 */

export type Vec3 = readonly [number, number, number];
export type Num = Float32Array | Float64Array | number[];

export const DEG = Math.PI / 180;

/** A quaternion from Euler angles in degrees, in three.js's 'XYZ' order (the same numbers three's Euler would take). */
export function quatFromEulerDeg(x: number, y: number, z: number, out: Num, o = 0): Num {
  const c1 = Math.cos((x * DEG) / 2);
  const c2 = Math.cos((y * DEG) / 2);
  const c3 = Math.cos((z * DEG) / 2);
  const s1 = Math.sin((x * DEG) / 2);
  const s2 = Math.sin((y * DEG) / 2);
  const s3 = Math.sin((z * DEG) / 2);
  out[o] = s1 * c2 * c3 + c1 * s2 * s3;
  out[o + 1] = c1 * s2 * c3 - s1 * c2 * s3;
  out[o + 2] = c1 * c2 * s3 + s1 * s2 * c3;
  out[o + 3] = c1 * c2 * c3 - s1 * s2 * s3;
  return out;
}

export function quatIdentity(out: Num, o = 0): Num {
  out[o] = 0;
  out[o + 1] = 0;
  out[o + 2] = 0;
  out[o + 3] = 1;
  return out;
}

/** out = a · b (b applied first). `out` may alias either input. */
export function quatMultiply(a: Num, ao: number, b: Num, bo: number, out: Num, oo = 0): Num {
  const ax = a[ao]!, ay = a[ao + 1]!, az = a[ao + 2]!, aw = a[ao + 3]!;
  const bx = b[bo]!, by = b[bo + 1]!, bz = b[bo + 2]!, bw = b[bo + 3]!;
  out[oo] = ax * bw + aw * bx + ay * bz - az * by;
  out[oo + 1] = ay * bw + aw * by + az * bx - ax * bz;
  out[oo + 2] = az * bw + aw * bz + ax * by - ay * bx;
  out[oo + 3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

export function quatNormalize(q: Num, o = 0): Num {
  const len = Math.hypot(q[o]!, q[o + 1]!, q[o + 2]!, q[o + 3]!) || 1;
  q[o] = q[o]! / len;
  q[o + 1] = q[o + 1]! / len;
  q[o + 2] = q[o + 2]! / len;
  q[o + 3] = q[o + 3]! / len;
  return q;
}

/** Spherical interpolation from a to b. `out` may alias a. */
export function quatSlerp(a: Num, ao: number, b: Num, bo: number, t: number, out: Num, oo = 0): Num {
  const ax = a[ao]!, ay = a[ao + 1]!, az = a[ao + 2]!, aw = a[ao + 3]!;
  let bx = b[bo]!, by = b[bo + 1]!, bz = b[bo + 2]!, bw = b[bo + 3]!;
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0: number;
  let k1: number;
  if (cos > 0.9995) {
    k0 = 1 - t;
    k1 = t;
  } else {
    const angle = Math.acos(cos);
    const sin = Math.sin(angle);
    k0 = Math.sin((1 - t) * angle) / sin;
    k1 = Math.sin(t * angle) / sin;
  }
  out[oo] = ax * k0 + bx * k1;
  out[oo + 1] = ay * k0 + by * k1;
  out[oo + 2] = az * k0 + bz * k1;
  out[oo + 3] = aw * k0 + bw * k1;
  return quatNormalize(out, oo);
}

/** The angle between two rotations, in radians (0 when equal). */
export function quatAngle(a: Num, ao: number, b: Num, bo: number): number {
  const dot = Math.abs(a[ao]! * b[bo]! + a[ao + 1]! * b[bo + 1]! + a[ao + 2]! * b[bo + 2]! + a[ao + 3]! * b[bo + 3]!);
  return 2 * Math.acos(Math.min(1, dot));
}

/** Writes a rotation and a translation as an affine matrix. */
export function affineCompose(q: Num, qo: number, tx: number, ty: number, tz: number, out: Num, oo = 0): Num {
  const x = q[qo]!, y = q[qo + 1]!, z = q[qo + 2]!, w = q[qo + 3]!;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  out[oo] = 1 - (yy + zz);
  out[oo + 1] = xy - wz;
  out[oo + 2] = xz + wy;
  out[oo + 3] = tx;
  out[oo + 4] = xy + wz;
  out[oo + 5] = 1 - (xx + zz);
  out[oo + 6] = yz - wx;
  out[oo + 7] = ty;
  out[oo + 8] = xz - wy;
  out[oo + 9] = yz + wx;
  out[oo + 10] = 1 - (xx + yy);
  out[oo + 11] = tz;
  return out;
}

/** out = a · b for affine matrices (b applied first). `out` must not alias a or b. */
export function affineMultiply(a: Num, ao: number, b: Num, bo: number, out: Num, oo = 0): Num {
  for (let r = 0; r < 3; r += 1) {
    const a0 = a[ao + r * 4]!, a1 = a[ao + r * 4 + 1]!, a2 = a[ao + r * 4 + 2]!, a3 = a[ao + r * 4 + 3]!;
    out[oo + r * 4] = a0 * b[bo]! + a1 * b[bo + 4]! + a2 * b[bo + 8]!;
    out[oo + r * 4 + 1] = a0 * b[bo + 1]! + a1 * b[bo + 5]! + a2 * b[bo + 9]!;
    out[oo + r * 4 + 2] = a0 * b[bo + 2]! + a1 * b[bo + 6]! + a2 * b[bo + 10]!;
    out[oo + r * 4 + 3] = a0 * b[bo + 3]! + a1 * b[bo + 7]! + a2 * b[bo + 11]! + a3;
  }
  return out;
}

/** A point through an affine matrix. */
export function affinePoint(m: Num, o: number, x: number, y: number, z: number, out: Num, oo = 0): Num {
  out[oo] = m[o]! * x + m[o + 1]! * y + m[o + 2]! * z + m[o + 3]!;
  out[oo + 1] = m[o + 4]! * x + m[o + 5]! * y + m[o + 6]! * z + m[o + 7]!;
  out[oo + 2] = m[o + 8]! * x + m[o + 9]! * y + m[o + 10]! * z + m[o + 11]!;
  return out;
}

/** A direction through an affine matrix (rotation only). */
export function affineDir(m: Num, o: number, x: number, y: number, z: number, out: Num, oo = 0): Num {
  out[oo] = m[o]! * x + m[o + 1]! * y + m[o + 2]! * z;
  out[oo + 1] = m[o + 4]! * x + m[o + 5]! * y + m[o + 6]! * z;
  out[oo + 2] = m[o + 8]! * x + m[o + 9]! * y + m[o + 10]! * z;
  return out;
}

/** A direction through the inverse of an affine matrix's rotation (its transpose). */
export function affineDirInverse(m: Num, o: number, x: number, y: number, z: number, out: Num, oo = 0): Num {
  out[oo] = m[o]! * x + m[o + 4]! * y + m[o + 8]! * z;
  out[oo + 1] = m[o + 1]! * x + m[o + 5]! * y + m[o + 9]! * z;
  out[oo + 2] = m[o + 2]! * x + m[o + 6]! * y + m[o + 10]! * z;
  return out;
}

/** The rotation part of an affine matrix as a quaternion. */
export function quatFromAffine(m: Num, o: number, out: Num, oo = 0): Num {
  return quatFromColumns(m[o]!, m[o + 4]!, m[o + 8]!, m[o + 1]!, m[o + 5]!, m[o + 9]!, m[o + 2]!, m[o + 6]!, m[o + 10]!, out, oo);
}

/**
 * The rotation whose local x, y and z axes land on the given orthonormal columns.
 * (ax, ay, az) is where local x goes, (bx, by, bz) local y, (cx, cy, cz) local z.
 */
export function quatFromColumns(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  out: Num,
  oo = 0,
): Num {
  // Matrix with columns a, b, c: m00 = ax, m01 = bx, m02 = cx; m10 = ay, m11 = by, m12 = cy; m20 = az, m21 = bz, m22 = cz.
  const trace = ax + by + cz;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out[oo + 3] = 0.25 / s;
    out[oo] = (bz - cy) * s;
    out[oo + 1] = (cx - az) * s;
    out[oo + 2] = (ay - bx) * s;
  } else if (ax > by && ax > cz) {
    const s = 2 * Math.sqrt(1 + ax - by - cz);
    out[oo + 3] = (bz - cy) / s;
    out[oo] = 0.25 * s;
    out[oo + 1] = (bx + ay) / s;
    out[oo + 2] = (cx + az) / s;
  } else if (by > cz) {
    const s = 2 * Math.sqrt(1 + by - ax - cz);
    out[oo + 3] = (cx - az) / s;
    out[oo] = (bx + ay) / s;
    out[oo + 1] = 0.25 * s;
    out[oo + 2] = (cy + bz) / s;
  } else {
    const s = 2 * Math.sqrt(1 + cz - ax - by);
    out[oo + 3] = (ay - bx) / s;
    out[oo] = (cx + az) / s;
    out[oo + 1] = (cy + bz) / s;
    out[oo + 2] = 0.25 * s;
  }
  return quatNormalize(out, oo);
}

/** The inverse of a unit quaternion. */
export function quatInvert(q: Num, qo: number, out: Num, oo = 0): Num {
  out[oo] = -q[qo]!;
  out[oo + 1] = -q[qo + 1]!;
  out[oo + 2] = -q[qo + 2]!;
  out[oo + 3] = q[qo + 3]!;
  return out;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** A deterministic pseudo-random number in [0, 1) from any number (the city's hash11). */
export function hash(p: number): number {
  let x = (p * 0.1031) % 1;
  if (x < 0) x += 1;
  x *= x + 33.33;
  x *= x + x;
  return x - Math.floor(x);
}
