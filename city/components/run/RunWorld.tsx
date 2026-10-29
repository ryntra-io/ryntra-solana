'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { playRun, setRunWind, type RunSound } from '@/city/lib/audio/engine';
import { SHARED } from '@/city/lib/city/shared';
import { useCity } from '@/city/lib/city/store';
import { PALETTE } from '@/city/lib/palette';
import { emitRunEvent, runLive } from '@/city/lib/run/bus';
import { DECK, DS, TUBE_H, frameAt, laneSpacing, pointAt, swayOf, widthAt, type Course, type Obstacle, type Tone, type Vec } from '@/city/lib/run/course';
import { flightPilot, roofsPilot } from '@/city/lib/run/autopilot';
import { attachControls, type RunControls } from '@/city/lib/run/input';
import { GhostRecorder, TICK, ghostRow, ghostTimeAt, newRun, step, type RunEvent, type RunState } from '@/city/lib/run/sim';
import { useRun } from '@/city/lib/run/store';
import { fxBurst } from '../city/Fx';
import { RUN_S, createBodyMaterial, createEdgeMaterial, createGlowMaterial, createRibbonMaterial } from './runMaterials';

/**
 * Skyline Run in the 3D city: the course's structures, the craft or the runner, your ghost, the ribbons of light
 * and the chase camera. The simulation steps at 60 Hz inside the frame loop (lib/run/sim), so the run plays the
 * same on every device; this file only draws it and turns its events into light and sound.
 */

const TONE: Record<Tone, string> = { amber: PALETTE.amber, warm: PALETTE.warmWhite, violet: PALETTE.violet, flare: PALETTE.flare, ice: PALETTE.ice };

export function RunWorld() {
  const course = useRun((s) => s.course);
  const phase = useRun((s) => s.phase);
  if (!course || phase === 'off') return null;
  return <RunScene key={course.id} course={course} />;
}

/* ------------------------------------------------------------------------------------------------ */
/* Pieces: every structure of the course as boxes and rings in course space                           */
/* ------------------------------------------------------------------------------------------------ */

type Piece = { o: Obstacle | null; s0: number; s1: number; u0: number; u1: number; h0: number; h1: number; color: THREE.Color; glow: number };

function toneColor(tone: Tone, scale = 1) {
  return new THREE.Color(TONE[tone]).multiplyScalar(scale);
}

/** Long boxes are cut into pieces of at most 3 m so they follow the curve. */
function split(o: Obstacle | null, s0: number, s1: number, u0: number, u1: number, h0: number, h1: number, color: THREE.Color, glow: number, out: Piece[]) {
  const n = Math.max(1, Math.ceil((s1 - s0) / 3));
  for (let k = 0; k < n; k += 1) {
    const a = s0 + ((s1 - s0) * k) / n;
    const b = s0 + ((s1 - s0) * (k + 1)) / n;
    out.push({ o, s0: a, s1: b, u0, u1, h0, h1, color, glow });
  }
}

function buildPieces(c: Course) {
  const boxes: Piece[] = [];
  const movers: Piece[] = [];
  const rings: Piece[] = [];
  const guides: Piece[] = [];
  const flight = c.form === 'flight';
  for (const o of c.obstacles) {
    const color = toneColor(o.tone);
    const list = o.move ? movers : boxes;
    switch (o.kind) {
      case 'block':
        split(o, o.s0, o.s1, o.u0, o.u1, o.h0, o.h1, color, o.tone === 'flare' ? 1.5 : 1.15, list);
        break;
      case 'divider':
        split(o, o.s0, o.s1, o.u0, o.u1, o.h0, o.h1, color, 0.9, list);
        break;
      case 'glass':
        split(o, o.s0, o.s1, o.u0, o.u1, o.h0, o.h1, color, 1.5, list);
        break;
      case 'break':
        split(o, o.s0, o.s1, o.u0, o.u1, o.h0, o.h1, color, 1.8, list);
        break;
      case 'mark':
        split(o, o.s0, o.s1, o.u0, o.u1, o.h0, o.h1, color, 0.9, list);
        break;
      case 'ring':
        if (flight) rings.push({ o, s0: o.s0, s1: o.s1, u0: o.u0, u1: o.u1, h0: o.h0, h1: o.h1, color, glow: 2.2 });
        else split(o, o.s0, o.s1, o.u0, o.u1, o.h0, o.h1, color, 2.4, list);
        break;
      case 'save':
        if (flight) rings.push({ o, s0: o.s0, s1: o.s1, u0: o.u0 + 0.3, u1: o.u1 - 0.3, h0: o.h0 + 0.2, h1: o.h1 - 0.2, color, glow: 2.4 });
        else rings.push({ o, s0: o.s0, s1: o.s1, u0: o.u0 + 0.2, u1: o.u1 - 0.2, h0: 0.1, h1: 2.4, color, glow: 2.4 });
        break;
      case 'finish':
        rings.push({ o, s0: o.s0, s1: o.s1, u0: o.u0, u1: o.u1, h0: o.h0, h1: o.h1, color: toneColor('amber'), glow: 3 });
        rings.push({ o, s0: o.s0 + 2, s1: o.s1 + 2, u0: o.u0 * 0.8, u1: o.u1 * 0.8, h0: o.h0 * 0.8 + (flight ? 0 : 0.3), h1: o.h1 * 0.8, color: toneColor('warm'), glow: 2 });
        break;
    }
  }
  if (flight) {
    // The corridor as sparse rings of light: violet, amber at a fork, red at the node.
    for (let s = 24; s < c.finishS - 6; s += 12) {
      const w = widthAt(c, s);
      const fork = c.forks.some((f) => s > f.s0 - 30 && s < f.s1);
      const node = s > c.nodeS - 30 && s < c.nodeS + 2;
      const tone: Tone = node ? 'flare' : fork ? 'amber' : 'violet';
      guides.push({ o: null, s0: s, s1: s + 0.2, u0: -w, u1: w, h0: -TUBE_H, h1: TUBE_H, color: toneColor(tone), glow: node || fork ? 0.9 : 0.55 });
    }
  } else if (c.ground) {
    // The deck: three lanes of dark glass, in 2 m tiles whose lit edges count the speed.
    const step = Math.round(6 / DS);
    for (let lane = -1; lane <= 1; lane += 1) {
      for (let i = 0; i < c.count - 1; i += step) {
        const mid = Math.min(c.count - 1, i + (step >> 1));
        const g = c.ground[(lane + 1) * c.count + mid]!;
        if (Number.isNaN(g)) continue;
        const s0 = i * DS;
        const s1 = Math.min(c.length, (i + step) * DS);
        const spacing = laneSpacing(c, (s0 + s1) / 2);
        const u = lane * spacing;
        const fork = c.forks.some((f) => s0 > f.s0 && s0 < f.s1);
        split(null, s0, s1 - 0.12, u - spacing / 2 + 0.08, u + spacing / 2 - 0.08, Math.min(g, 0) - DECK * 0.45, g, toneColor(fork ? 'amber' : 'violet'), g > 0 ? 0.9 : 0.5, boxes);
      }
    }
  }
  return { boxes, movers, rings, guides };
}

const T = { x: 0, y: 0, z: 0 };
const N = { x: 0, y: 0, z: 0 };
const B = { x: 0, y: 0, z: 0 };
const P = { x: 0, y: 0, z: 0 };

/** A box's matrix: X across (right), Y up, Z along the course. */
function boxMatrix(c: Course, p: Piece, t: number, out: THREE.Matrix4) {
  const sway = p.o ? swayOf(p.o, t) : 0;
  const su = p.o?.move?.axis === 'u' ? sway : 0;
  const sh = p.o?.move?.axis === 'h' ? sway : 0;
  const sc = (p.s0 + p.s1) / 2;
  frameAt(c, sc, T, N, B);
  pointAt(c, sc, (p.u0 + p.u1) / 2 + su, (p.h0 + p.h1) / 2 + sh, P);
  const sx = p.u1 - p.u0;
  const sy = p.h1 - p.h0;
  const sz = p.s1 - p.s0;
  out.set(N.x * sx, B.x * sy, T.x * sz, P.x, N.y * sx, B.y * sy, T.y * sz, P.y, N.z * sx, B.z * sy, T.z * sz, P.z, 0, 0, 0, 1);
}

/** A ring's matrix: the torus lies across the corridor, its radii the half-width and half-height of the piece. */
function ringMatrix(c: Course, p: Piece, out: THREE.Matrix4) {
  const sc = (p.s0 + p.s1) / 2;
  frameAt(c, sc, T, N, B);
  pointAt(c, sc, (p.u0 + p.u1) / 2, (p.h0 + p.h1) / 2, P);
  const rx = (p.u1 - p.u0) / 2;
  const ry = (p.h1 - p.h0) / 2;
  out.set(N.x * rx, B.x * ry, T.x, P.x, N.y * rx, B.y * ry, T.y, P.y, N.z * rx, B.z * ry, T.z, P.z, 0, 0, 0, 1);
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, pieces: Piece[]) {
  const count = Math.max(1, pieces.length);
  const color = new Float32Array(count * 3);
  const glow = new Float32Array(count);
  const along = new Float32Array(count);
  pieces.forEach((p, i) => {
    p.color.toArray(color, i * 3);
    glow[i] = p.glow;
    along[i] = (p.s0 + p.s1) / 2;
  });
  const geo = geometry.clone();
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(color, 3));
  geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(glow, 1));
  geo.setAttribute('aS', new THREE.InstancedBufferAttribute(along, 1));
  const mesh = new THREE.InstancedMesh(geo, material, count);
  mesh.frustumCulled = false;
  mesh.count = pieces.length;
  return mesh;
}

/* ------------------------------------------------------------------------------------------------ */
/* Bodies: the craft, the runner and their ribbons                                                    */
/* ------------------------------------------------------------------------------------------------ */

function craftGeometry() {
  const v = {
    nose: [0, 0, 1.05],
    l: [-0.85, -0.05, -0.5],
    r: [0.85, -0.05, -0.5],
    top: [0, 0.26, -0.4],
    bot: [0, -0.17, -0.48],
    tail: [0, 0.03, -0.64],
  } as const;
  const tris: (keyof typeof v)[][] = [
    ['nose', 'l', 'top'],
    ['nose', 'top', 'r'],
    ['nose', 'bot', 'l'],
    ['nose', 'r', 'bot'],
    ['l', 'tail', 'top'],
    ['top', 'tail', 'r'],
    ['l', 'bot', 'tail'],
    ['tail', 'bot', 'r'],
  ];
  const pos = new Float32Array(tris.length * 9);
  tris.forEach((tri, i) => tri.forEach((k, j) => pos.set(v[k], i * 9 + j * 3)));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

type Runner = { group: THREE.Group; body: THREE.Group; legs: THREE.Group[]; arms: THREE.Group[] };

function makeRunner(material: THREE.Material): Runner {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.26), material);
  torso.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), material);
  head.position.y = 1.62;
  body.add(torso, head);
  const limb = (w: number, h: number, x: number, y: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), material);
    mesh.position.y = -h / 2;
    pivot.add(mesh);
    body.add(pivot);
    return pivot;
  };
  const legs = [limb(0.14, 0.84, -0.12, 0.86), limb(0.14, 0.84, 0.12, 0.86)];
  const arms = [limb(0.11, 0.52, -0.29, 1.42), limb(0.11, 0.52, 0.29, 1.42)];
  return { group, body, legs, arms };
}

/** A ribbon of light: the last positions of a body, drawn facing the camera and fading behind. */
class Ribbon {
  readonly n = 34;
  readonly history = new Float32Array(this.n * 3);
  readonly mesh: THREE.Mesh;
  private primed = false;
  constructor(material: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.n * 2 * 3), 3));
    const along = new Float32Array(this.n * 2);
    const side = new Float32Array(this.n * 2);
    for (let i = 0; i < this.n; i += 1) {
      along[i * 2] = along[i * 2 + 1] = i / (this.n - 1);
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
    }
    g.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    const index: number[] = [];
    for (let i = 0; i < this.n - 1; i += 1) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    g.setIndex(index);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
  }
  reset() {
    this.primed = false;
  }
  update(p: Vec, camera: THREE.Camera, width: number) {
    const h = this.history;
    if (!this.primed) {
      for (let i = 0; i < this.n; i += 1) h.set([p.x, p.y, p.z], i * 3);
      this.primed = true;
    }
    h.copyWithin(3, 0, (this.n - 1) * 3);
    h.set([p.x, p.y, p.z], 0);
    const pos = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cam = camera.position;
    for (let i = 0; i < this.n; i += 1) {
      const a = Math.max(0, i - 1);
      const b = Math.min(this.n - 1, i + 1);
      const dx = h[a * 3]! - h[b * 3]!;
      const dy = h[a * 3 + 1]! - h[b * 3 + 1]!;
      const dz = h[a * 3 + 2]! - h[b * 3 + 2]!;
      const vx = cam.x - h[i * 3]!;
      const vy = cam.y - h[i * 3 + 1]!;
      const vz = cam.z - h[i * 3 + 2]!;
      let sx = dy * vz - dz * vy;
      let sy = dz * vx - dx * vz;
      let sz = dx * vy - dy * vx;
      const l = Math.hypot(sx, sy, sz) || 1;
      const w = width * (1 - i / this.n);
      sx = (sx / l) * w;
      sy = (sy / l) * w;
      sz = (sz / l) * w;
      pos.setXYZ(i * 2, h[i * 3]! - sx, h[i * 3 + 1]! - sy, h[i * 3 + 2]! - sz);
      pos.setXYZ(i * 2 + 1, h[i * 3]! + sx, h[i * 3 + 1]! + sy, h[i * 3 + 2]! + sz);
    }
    pos.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* The scene                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

const smooth = (t: number) => t * t * (3 - 2 * t);
/** The establishing shots of the city (CameraRig), where a finished run comes to rest. */
const VICTORY_LANDSCAPE = { pos: new THREE.Vector3(0, 38, 172), look: new THREE.Vector3(0, 25, 0), fov: 40 };
const VICTORY_PORTRAIT = { pos: new THREE.Vector3(0, 20, 128), look: new THREE.Vector3(0, 31, 0), fov: 58 };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function RunScene({ course }: { course: Course }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const flight = course.form === 'flight';

  const scene = useMemo(() => {
    const pieces = buildPieces(course);
    const edge = createEdgeMaterial();
    const glowMat = createGlowMaterial();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const boxes = instanced(box, edge, pieces.boxes);
    const movers = instanced(box, edge, pieces.movers);
    const rings = instanced(new THREE.TorusGeometry(1, 0.05, 8, 72), glowMat, pieces.rings);
    const guides = instanced(new THREE.TorusGeometry(1, 0.018, 4, 72), glowMat, pieces.guides);
    const m = new THREE.Matrix4();
    pieces.boxes.forEach((p, i) => (boxMatrix(course, p, 0, m), boxes.setMatrixAt(i, m)));
    pieces.rings.forEach((p, i) => (ringMatrix(course, p, m), rings.setMatrixAt(i, m)));
    pieces.guides.forEach((p, i) => (ringMatrix(course, p, m), guides.setMatrixAt(i, m)));
    // Which instances belong to each obstacle, so a taken one (a ring collected, a piece you hit) can vanish.
    const byId = new Map<number, { mesh: THREE.InstancedMesh; index: number; piece: Piece }[]>();
    const note = (mesh: THREE.InstancedMesh, list: Piece[]) =>
      list.forEach((p, index) => {
        if (!p.o || p.o.kind === 'mark' || p.o.kind === 'finish') return;
        const entry = byId.get(p.o.id) ?? [];
        entry.push({ mesh, index, piece: p });
        byId.set(p.o.id, entry);
      });
    note(boxes, pieces.boxes);
    note(rings, pieces.rings);
    note(movers, pieces.movers);

    const bodyMat = flight
      ? createBodyMaterial(new THREE.Color(PALETTE.warmWhite).multiplyScalar(0.95), new THREE.Color(PALETTE.amber).multiplyScalar(2.4))
      : createBodyMaterial(new THREE.Color(PALETTE.violetHaze).multiplyScalar(1.6), new THREE.Color(PALETTE.amber).multiplyScalar(2.8));
    const ghostMat = createBodyMaterial(new THREE.Color(PALETTE.violet).multiplyScalar(0.9), new THREE.Color(PALETTE.violet).multiplyScalar(1.6), 0.5);
    const craft = new THREE.Mesh(craftGeometry().scale(0.82, 0.82, 0.82), bodyMat);
    const ghostCraft = new THREE.Mesh(craft.geometry, ghostMat);
    const runner = makeRunner(bodyMat);
    const ghostRunner = makeRunner(ghostMat);
    const trail = new Ribbon(createRibbonMaterial(new THREE.Color(PALETTE.amber).multiplyScalar(2.2)));
    const ghostTrail = new Ribbon(createRibbonMaterial(new THREE.Color(PALETTE.violet).multiplyScalar(1.4)));
    for (const o of [craft, ghostCraft, runner.group, ghostRunner.group]) o.matrixAutoUpdate = false;
    return { pieces, boxes, movers, rings, guides, byId, craft, ghostCraft, runner, ghostRunner, trail, ghostTrail };
  }, [course, flight]);

  useEffect(
    () => () => {
      for (const mesh of [scene.boxes, scene.movers, scene.rings, scene.guides]) mesh.geometry.dispose();
      setRunWind(0);
    },
    [scene],
  );

  // Input on the canvas; the city's own camera controls stand down during a run (CameraRig).
  const controls = useRef<RunControls | null>(null);
  useEffect(() => {
    const c = attachControls(gl.domElement, course.form);
    controls.current = c;
    return () => c.dispose();
  }, [gl, course.form]);

  // One run per attempt: a fresh simulation, the taken pieces back in place, the camera flying in from where it is.
  const attempt = useRun((s) => s.attempt);
  const sim = useRef({ st: newRun(), rec: new GhostRecorder(), acc: 0, endAt: 0, count: -1, wind: 0 });
  const cam = useRef({ start: new THREE.Vector3(), startLook: new THREE.Vector3(), pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: camera.fov, roll: 0 });
  // Development only: `window.__runAutopilot = true` lets the screenshot scripts fly real runs.
  const pilots = useRef({ flight: flightPilot(), roofs: roofsPilot() });
  useEffect(() => {
    pilots.current = { flight: flightPilot(), roofs: roofsPilot() };
    sim.current = { st: newRun(), rec: new GhostRecorder(), acc: 0, endAt: 0, count: -1, wind: 0 };
    const c = controls.current;
    if (c) {
      c.tx = 0;
      c.ty = 0;
      c.actions = 0;
    }
    const m = new THREE.Matrix4();
    for (const entries of scene.byId.values()) {
      for (const { mesh, index, piece } of entries) {
        if (mesh === scene.rings) ringMatrix(course, piece, m);
        else boxMatrix(course, piece, 0, m);
        mesh.setMatrixAt(index, m);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    scene.trail.reset();
    scene.ghostTrail.reset();
    cam.current.start.copy(camera.position);
    cam.current.startLook.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(30));
    cam.current.pos.copy(camera.position);
    cam.current.look.copy(cam.current.startLook);
  }, [attempt, scene, course, camera]);

  const hide = (id: number) => {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const { mesh, index } of scene.byId.get(id) ?? []) {
      mesh.setMatrixAt(index, zero);
      mesh.instanceMatrix.needsUpdate = true;
    }
  };

  const tmp = useMemo(
    () => ({
      p: { x: 0, y: 0, z: 0 },
      q: { x: 0, y: 0, z: 0 },
      t: { x: 0, y: 0, z: 0 },
      n: { x: 0, y: 0, z: 0 },
      b: { x: 0, y: 0, z: 0 },
      m: new THREE.Matrix4(),
      r: new THREE.Matrix4(),
      e: new THREE.Euler(0, 0, 0, 'ZXY'),
      v: new THREE.Vector3(),
      look: new THREE.Vector3(),
      axis: new THREE.Vector3(),
      worldUp: new THREE.Vector3(0, 1, 0),
      at: new THREE.Vector3(),
      c: new THREE.Color(),
    }),
    [],
  );

  const sound = (kind: RunSound) => {
    if (useCity.getState().sound) playRun(kind);
  };

  const onEvent = (ev: RunEvent) => {
    emitRunEvent(ev);
    const at = tmp.at;
    pointAt(course, ev.s, ev.u, flight ? ev.h : ev.h + 0.9, at);
    switch (ev.kind) {
      case 'boost':
        if (ev.id !== undefined) hide(ev.id);
        fxBurst(at, 'launch', tmp.c.set(PALETTE.ice), 0);
        sound('boost');
        break;
      case 'shatter':
        if (ev.id !== undefined) hide(ev.id);
        fxBurst(at, 'flare', tmp.c.set(PALETTE.ice), 10);
        sound('shatter');
        break;
      case 'break':
        if (ev.id !== undefined) hide(ev.id);
        fxBurst(at, 'flare', tmp.c.set(PALETTE.flare), 28);
        useCity.getState().shake(0.45);
        sound('break');
        break;
      case 'save':
        fxBurst(at, 'pump', tmp.c.set(PALETTE.ice), 16);
        sound('save');
        break;
      case 'hit':
        // Smaller than a crash and with no white-hot core, so the next obstacle stays in sight.
        if (ev.id !== undefined) hide(ev.id);
        fxBurst(at, 'launch', tmp.c.set(PALETTE.flare), 0);
        useCity.getState().shake(0.5);
        sound('hit');
        break;
      case 'shield':
        fxBurst(at, 'launch', tmp.c.set(PALETTE.ice), 0);
        sound('shield');
        break;
      case 'crash':
        fxBurst(at, 'flare', tmp.c.set(PALETTE.flare), 34);
        useCity.getState().shake(0.95);
        sound('crash');
        break;
      case 'finish':
        fxBurst(at, 'pump', tmp.c.set(PALETTE.amber), 26);
        fxBurst(at.clone().addScaledVector(camera.up, 4), 'pump', tmp.c.set(PALETTE.warmWhite), 0);
        sound('finish');
        break;
      case 'near':
        sound('near');
        break;
      case 'jump':
      case 'land':
      case 'dash':
        sound(ev.kind);
        break;
      case 'fork':
        break;
    }
  };

  /** Where the body is drawn: the course point, plus a little bank and pitch for the craft. */
  const placeBody = (target: THREE.Object3D, s: number, u: number, h: number, vu: number, vh: number) => {
    frameAt(course, s, tmp.t, tmp.n, tmp.b);
    pointAt(course, s, u, h, tmp.p);
    tmp.m.set(tmp.n.x, tmp.b.x, tmp.t.x, tmp.p.x, tmp.n.y, tmp.b.y, tmp.t.y, tmp.p.y, tmp.n.z, tmp.b.z, tmp.t.z, tmp.p.z, 0, 0, 0, 1);
    if (flight) {
      const roll = THREE.MathUtils.clamp(-vu * 0.045, -0.75, 0.75);
      const pitch = THREE.MathUtils.clamp(-vh * 0.04, -0.5, 0.5);
      tmp.r.makeRotationFromEuler(tmp.e.set(pitch, 0, roll, 'ZXY'));
      tmp.m.multiply(tmp.r);
    }
    target.matrix.copy(tmp.m);
    target.matrixWorldNeedsUpdate = true;
  };

  const poseRunner = (r: typeof scene.runner, speed: number, grounded: boolean, dashing: boolean, time: number) => {
    const phase = time * speed * 0.62;
    const swing = Math.sin(phase);
    r.legs[0]!.rotation.x = grounded ? swing * 0.95 : -0.7;
    r.legs[1]!.rotation.x = grounded ? -swing * 0.95 : 0.45;
    r.arms[0]!.rotation.x = -swing * 0.8;
    r.arms[1]!.rotation.x = swing * 0.8;
    r.body.position.y = dashing ? -0.55 : grounded ? Math.abs(Math.cos(phase)) * 0.06 : 0;
    r.body.rotation.x = dashing ? 1.05 : grounded ? 0.12 : 0.2;
    r.body.position.z = dashing ? -0.3 : 0;
  };

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const run = useRun.getState();
    const s = sim.current;
    const st: RunState = s.st;
    const input = controls.current;
    input?.tick(dt);
    const now = performance.now();

    // Countdown: three beats, then GO.
    if (run.phase === 'countdown') {
      const left = run.countdownLen - (now - run.countdownAt) / 1000;
      const beat = Math.ceil(left / (run.countdownLen / 3));
      if (beat !== s.count && beat > 0) {
        s.count = beat;
        sound('count');
      }
      if (left <= 0) {
        run.go();
        sound('go');
      }
    }

    // The simulation.
    if (run.phase === 'running' && st.status === 'running' && input) {
      s.acc += dt;
      while (s.acc >= TICK) {
        s.acc -= TICK;
        if (process.env.NODE_ENV !== 'production' && (window as { __runAutopilot?: boolean }).__runAutopilot) {
          if (flight) Object.assign(input, pilots.current.flight(course, st));
          else input.actions |= pilots.current.roofs(course, st);
          input.touched = true;
        }
        step(course, st, { tx: input.tx, ty: input.ty, actions: input.actions });
        input.actions = 0;
        s.rec.record(st);
        for (const ev of st.events) onEvent(ev);
        if (st.status !== 'running') break;
      }
      if (st.status !== 'running') {
        run.complete(st, s.rec.take());
        s.endAt = now;
      }
    }
    if (run.phase === 'ending' && now - s.endAt > (st.status === 'crashed' ? 1300 : 1900)) run.showResult();

    RUN_S.value = st.s;

    // Live numbers for the HUD.
    const best = run.best;
    runLive.t = st.t;
    runLive.progress = Math.min(1, st.s / course.finishS);
    runLive.speed = st.speed;
    if (best && run.showGhost) {
      const row = ghostRow(best.ghost, st.tick);
      runLive.ghostProgress = Math.min(1, row[0] / course.finishS);
      const gt = ghostTimeAt(best.ghost, st.s);
      runLive.delta = gt === null ? Number.NaN : st.t - gt;
    } else {
      runLive.ghostProgress = -1;
      runLive.delta = Number.NaN;
    }
    const touched = input?.touched ?? false;
    runLive.shields = st.shields;
    let hint: typeof runLive.hint = '';
    // The first runs teach each new obstacle once, just before it arrives; it wins over a fork further away.
    const cue = run.attempt <= 3 ? course.cues.find((k) => k.s - st.s > -3 && k.s - st.s < 44) : undefined;
    const fork = course.forks.find((f) => st.s > f.s0 - 52 && st.s < f.s0 + 2);
    if (!touched && run.attempt <= 2 && (run.phase === 'countdown' || st.t < 8)) hint = flight ? 'steer' : 'swipe';
    else if (cue && (!fork || cue.s < fork.s0)) {
      hint = 'cue';
      runLive.cue = cue.text;
    } else if (fork) hint = 'fork';
    else if (st.s > course.nodeS - 46 && st.s < course.nodeS + 1) hint = 'node';
    runLive.hint = run.phase === 'running' || run.phase === 'countdown' ? hint : '';

    // Moving pieces sway with the run's clock.
    const t = st.t;
    scene.pieces.movers.forEach((p, i) => {
      if (p.o && st.taken.has(p.o.id)) return;
      boxMatrix(course, p, t, tmp.m);
      scene.movers.setMatrixAt(i, tmp.m);
    });
    if (scene.pieces.movers.length) scene.movers.instanceMatrix.needsUpdate = true;

    // The body.
    const body = flight ? scene.craft : scene.runner.group;
    placeBody(body, st.s, st.u, st.h, st.vu, st.vh);
    if (!flight) poseRunner(scene.runner, st.speed || 18, st.grounded, st.dash > 0, st.t);
    // After a hit the body flickers while it passes through.
    const blink = st.guard > 0 && Math.floor(st.guard * 16) % 2 === 1;
    body.visible = st.status !== 'crashed' && !blink;
    pointAt(course, st.s, st.u, flight ? st.h : st.h + 1.0, tmp.q);
    runLive.x = tmp.q.x;
    runLive.y = tmp.q.y;
    runLive.z = tmp.q.z;
    scene.trail.update(tmp.q, camera, flight ? 0.24 : 0.18);
    scene.trail.mesh.visible = st.status !== 'crashed';

    // The ghost: your best run of the day, replayed tick by tick.
    const ghostOn = !!best && run.showGhost;
    const ghost = flight ? scene.ghostCraft : scene.ghostRunner.group;
    ghost.visible = ghostOn;
    scene.ghostTrail.mesh.visible = ghostOn;
    if (ghostOn && best) {
      const [gs, gu, gh, gdash] = ghostRow(best.ghost, st.tick);
      placeBody(ghost, gs, gu, gh, 0, 0);
      if (!flight) poseRunner(scene.ghostRunner, 19, gh <= 0.05, gdash > 0, st.t);
      pointAt(course, gs, gu, flight ? gh : gh + 1.0, tmp.p);
      scene.ghostTrail.update(tmp.p, camera, flight ? 0.24 : 0.16);
    }

    // The craft lights the facades it passes.
    if (run.phase === 'running' && st.status === 'running') {
      SHARED.uFlashPos.value.set(tmp.q.x, tmp.q.y, tmp.q.z);
      SHARED.uFlashTime.value = SHARED.uTime.value - 0.12;
      SHARED.uFlashColor.value.set(PALETTE.amber).multiplyScalar(0.075);
    }

    // Wind by speed, a few times a second.
    s.wind += dt;
    if (s.wind > 0.1) {
      s.wind = 0;
      if (useCity.getState().sound) setRunWind(run.phase === 'running' && st.status === 'running' ? 0.25 + (st.speed - 16) / 12 : 0);
    }

    // The chase camera: behind and a little above, looking ahead, rolling with the turn.
    const back = flight ? 6.8 : 7.6;
    const lift = flight ? 2.1 : 3.4;
    const ahead = flight ? 11 : 10;
    const crashed = st.status === 'crashed';
    const goalPos = tmp.v;
    if (crashed) {
      // Hold the spot and look at the wreck.
      goalPos.copy(cam.current.pos);
      cam.current.look.lerp(tmp.look.set(tmp.q.x, tmp.q.y, tmp.q.z), 1 - Math.exp(-dt * 4));
    } else {
      // After the finish the camera glides on and turns to the victory view: the city below, the Eclipse ahead.
      const since = st.status === 'finished' ? (now - s.endAt) / 1000 : 0;
      const sCam = st.s + since * 7;
      pointAt(course, Math.max(0, sCam - back), st.u * 0.5, (flight ? st.h * 0.55 : st.h * 0.6) + lift, tmp.p);
      goalPos.set(tmp.p.x, tmp.p.y + since * 2.5, tmp.p.z);
      pointAt(course, sCam + ahead, st.u * 0.75, (flight ? st.h * 0.8 : st.h * 0.6) + (flight ? 0.5 : 1.3), tmp.p);
      const lookGoal = tmp.look.set(tmp.p.x, tmp.p.y, tmp.p.z);
      if (since > 0) {
        // The victory shot: pull back to the skyline with the Sol Spire rising into the Eclipse.
        const k = smooth(clamp01((since - 0.35) / 2.4));
        const portraitView = size.width < size.height;
        goalPos.lerp(portraitView ? VICTORY_PORTRAIT.pos : VICTORY_LANDSCAPE.pos, k);
        lookGoal.lerp(portraitView ? VICTORY_PORTRAIT.look : VICTORY_LANDSCAPE.look, k);
      }
      if (run.phase === 'countdown') {
        const k = smooth(clamp01((now - run.countdownAt) / 1000 / Math.max(0.6, run.countdownLen - 0.2)));
        cam.current.pos.copy(cam.current.start).lerp(goalPos, k);
        cam.current.look.copy(cam.current.startLook).lerp(lookGoal, k);
      } else {
        cam.current.pos.lerp(goalPos, 1 - Math.exp(-dt * 8));
        cam.current.look.lerp(lookGoal, 1 - Math.exp(-dt * 10));
      }
    }
    frameAt(course, st.s, tmp.t, tmp.n, tmp.b);
    cam.current.roll += (THREE.MathUtils.clamp(-st.vu * 0.012, -0.22, 0.22) - cam.current.roll) * (1 - Math.exp(-dt * 6));
    camera.position.copy(cam.current.pos);
    const victory = st.status === 'finished' ? smooth(clamp01(((now - s.endAt) / 1000 - 0.35) / 2.4)) : 0;
    camera.up.set(tmp.b.x, tmp.b.y, tmp.b.z).applyAxisAngle(tmp.axis.set(tmp.t.x, tmp.t.y, tmp.t.z), cam.current.roll).lerp(tmp.worldUp, victory).normalize();
    camera.lookAt(cam.current.look);
    const portrait = size.width < size.height;
    const runFov = (portrait ? 74 : 58) + (st.boost > 0 ? 7 : 0) + (st.dash > 0 ? 5 : 0);
    const fovGoal = runFov + ((portrait ? VICTORY_PORTRAIT.fov : VICTORY_LANDSCAPE.fov) - runFov) * victory;
    if (Math.abs(camera.fov - fovGoal) > 0.05) {
      camera.fov += (fovGoal - camera.fov) * (1 - Math.exp(-dt * 5));
      camera.updateProjectionMatrix();
    }
  }, 0.5);

  return (
    <>
      <primitive object={scene.boxes} />
      <primitive object={scene.movers} />
      <primitive object={scene.rings} />
      <primitive object={scene.guides} />
      <primitive object={scene.craft} visible={flight} />
      <primitive object={scene.ghostCraft} visible={false} />
      <primitive object={scene.runner.group} visible={!flight} />
      <primitive object={scene.ghostRunner.group} visible={false} />
      <primitive object={scene.trail.mesh} />
      <primitive object={scene.ghostTrail.mesh} visible={false} />
    </>
  );
}

