import * as THREE from 'three';
import type { Shape } from '@/city/lib/quarter/kit/parts';

/**
 * The kit's unit shapes, built once in code (no model files). Each stands on y = 0 inside the unit box, flat-shaded so
 * edges catch the haze. Every vertex carries aFace: x is how far the face reaches either side of its centre line
 * (in unit widths; -1 for faces without windows), y says what the face is — 0 a flat wall, 1 a chamfered edge,
 * 2 a roof or cap, 3 a curved surface, 4 a panel. Round shapes come in two tiers: `hi` up close, `lo` from afar.
 */

export type Tier = 'hi' | 'lo';

const WALL = 0;
const SEAM = 1;
const CAP = 2;
const CURVED = 3;
const PANEL = 4;

/** Flat faces from triangles: each triangle gets its own normal and its face info. */
class Mesher {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly faces: number[] = [];

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, reach: number, kind: number): void {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const v of [a, b, c]) {
      this.positions.push(v.x, v.y, v.z);
      this.normals.push(n.x, n.y, n.z);
      this.faces.push(reach, kind);
    }
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, reach: number, kind: number): void {
    this.tri(a, b, c, reach, kind);
    this.tri(a, c, d, reach, kind);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('aFace', new THREE.Float32BufferAttribute(this.faces, 2));
    return g;
  }
}

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * A prism from a convex footprint (counter-clockwise seen from above), walls and caps. `reach(i)` and `kind(i)`
 * describe wall i (from corner i to corner i + 1).
 */
function prism(footprint: [number, number][], reach: (i: number) => number, kind: (i: number) => number): THREE.BufferGeometry {
  const m = new Mesher();
  const count = footprint.length;
  for (let i = 0; i < count; i += 1) {
    const [x0, z0] = footprint[i]!;
    const [x1, z1] = footprint[(i + 1) % count]!;
    m.quad(v(x0, 0, z0), v(x1, 0, z1), v(x1, 1, z1), v(x0, 1, z0), reach(i), kind(i));
  }
  for (let i = 1; i < count - 1; i += 1) {
    const [ax, az] = footprint[0]!;
    const [bx, bz] = footprint[i]!;
    const [cx, cz] = footprint[i + 1]!;
    m.tri(v(ax, 1, az), v(bx, 1, bz), v(cx, 1, cz), -1, CAP);
    m.tri(v(ax, 0, az), v(cx, 0, cz), v(bx, 0, bz), -1, CAP);
  }
  return m.build();
}

/** Reverses a footprint listed so its walls would face inward. */
const ccw = (points: [number, number][]) => points.slice().reverse();

function box(): THREE.BufferGeometry {
  return prism(ccw([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]), () => 0.5, () => WALL);
}

/** A box with its vertical edges cut at 45°: the cut faces carry a light seam. */
const CUT = 0.1;
function chamfer(): THREE.BufferGeometry {
  const h = 0.5;
  const c = CUT;
  const points: [number, number][] = [[-h + c, -h], [h - c, -h], [h, -h + c], [h, h - c], [h - c, h], [-h + c, h], [-h, h - c], [-h, -h + c]];
  const walls = ccw(points);
  return prism(walls, (i) => (i % 2 === 0 ? h - c : (c * Math.SQRT2) / 2), (i) => (i % 2 === 0 ? WALL : SEAM));
}

/** The city's octagonal tower prism, flats facing the axes. */
function octagon(): THREE.BufferGeometry {
  const points: [number, number][] = [];
  for (let i = 0; i < 8; i += 1) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    points.push([Math.sin(a) * 0.5, Math.cos(a) * 0.5]);
  }
  // Increasing angle already runs the way the walls face outward.
  return prism(points, () => 0.5 * Math.sin(Math.PI / 8), () => WALL);
}

/** Copies a three.js geometry into flat-shaded triangles with one face kind. */
function flat(source: THREE.BufferGeometry, kind: number, smooth = false): THREE.BufferGeometry {
  const g = source.index ? source.toNonIndexed() : source;
  if (!smooth) g.computeVertexNormals();
  const count = g.getAttribute('position').count;
  const faces = new Float32Array(count * 2);
  const normal = g.getAttribute('normal');
  for (let i = 0; i < count; i += 1) {
    faces[i * 2] = -1;
    faces[i * 2 + 1] = normal.getY(i) > 0.98 ? CAP : kind;
  }
  g.setAttribute('aFace', new THREE.BufferAttribute(faces, 2));
  for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'aFace'].includes(name)) g.deleteAttribute(name);
  if (g !== source) source.dispose();
  return g;
}

function gable(): THREE.BufferGeometry {
  const m = new Mesher();
  const [l, r, t, f, b] = [-0.5, 0.5, 1, 0.5, -0.5];
  m.tri(v(l, 0, f), v(r, 0, f), v(0, t, f), -1, WALL);
  m.tri(v(r, 0, b), v(l, 0, b), v(0, t, b), -1, WALL);
  m.quad(v(r, 0, f), v(r, 0, b), v(0, t, b), v(0, t, f), -1, CAP);
  m.quad(v(l, 0, b), v(l, 0, f), v(0, t, f), v(0, t, b), -1, CAP);
  m.quad(v(l, 0, b), v(r, 0, b), v(r, 0, f), v(l, 0, f), -1, CAP);
  return m.build();
}

/** A sawtooth tooth: upright glazed face to the front (+z), the slope down to the back. */
function wedge(): THREE.BufferGeometry {
  const m = new Mesher();
  const [l, r] = [-0.5, 0.5];
  m.quad(v(l, 0, 0.5), v(r, 0, 0.5), v(r, 1, 0.5), v(l, 1, 0.5), -1, WALL);
  m.quad(v(r, 0, -0.5), v(l, 0, -0.5), v(l, 1, 0.5), v(r, 1, 0.5), -1, CAP);
  m.tri(v(r, 0, 0.5), v(r, 0, -0.5), v(r, 1, 0.5), -1, WALL);
  m.tri(v(l, 0, -0.5), v(l, 0, 0.5), v(l, 1, 0.5), -1, WALL);
  m.quad(v(l, 0, -0.5), v(r, 0, -0.5), v(r, 0, 0.5), v(l, 0, 0.5), -1, CAP);
  return m.build();
}

function make(shape: Shape, tier: Tier): THREE.BufferGeometry {
  const hi = tier === 'hi';
  switch (shape) {
    case 'box':
      return box();
    case 'chamfer':
      return hi ? chamfer() : box();
    case 'prism':
      return octagon();
    case 'cyl':
      return flat(new THREE.CylinderGeometry(0.5, 0.5, 1, hi ? 20 : 8, 1).translate(0, 0.5, 0), CURVED);
    case 'cone':
      return flat(new THREE.CylinderGeometry(0, 0.5, 1, hi ? 20 : 6, 1).translate(0, 0.5, 0), CURVED);
    case 'pyramid':
      return flat(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0), CURVED);
    case 'dome':
      return flat(new THREE.SphereGeometry(0.5, hi ? 20 : 8, hi ? 8 : 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1), CURVED);
    case 'gable':
      return gable();
    case 'wedge':
      return wedge();
    case 'torus':
      return flat(new THREE.TorusGeometry(0.45, 0.05, hi ? 6 : 3, hi ? 48 : 18).rotateX(Math.PI / 2), CURVED, true);
    case 'sphere':
      return flat(new THREE.IcosahedronGeometry(0.5, hi ? 2 : 1).translate(0, 0.5, 0), CURVED, true);
    case 'quad': {
      const g = flat(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), PANEL, true);
      g.getAttribute('aFace').array.fill(0.5, 0);
      for (let i = 1; i < g.getAttribute('aFace').array.length; i += 2) (g.getAttribute('aFace').array as Float32Array)[i] = PANEL;
      return g;
    }
    case 'disc':
      return flat(new THREE.CircleGeometry(0.5, hi ? 32 : 16).rotateX(-Math.PI / 2), PANEL, true);
  }
}

/** The tier a shape is drawn with at a level of detail; shapes with one form share it. */
export function tierOf(shape: Shape, lod: 0 | 1 | 2): Tier {
  if (lod === 0) return 'hi';
  return shape === 'box' || shape === 'prism' || shape === 'gable' || shape === 'wedge' || shape === 'quad' || shape === 'pyramid' ? 'hi' : 'lo';
}

const cache = new Map<string, THREE.BufferGeometry>();

/** One shared unit geometry per shape and tier, for the life of the page. */
export function unitGeometry(shape: Shape, tier: Tier): THREE.BufferGeometry {
  const key = `${shape}:${tier}`;
  let g = cache.get(key);
  if (!g) {
    g = make(shape, tier);
    g.computeBoundingSphere();
    cache.set(key, g);
  }
  return g;
}
