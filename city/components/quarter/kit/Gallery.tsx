'use client';

import { CameraControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { BAR, SHARED } from '@/city/lib/city/shared';
import { useCity } from '@/city/lib/city/store';
import { BUNDLED_CITY } from '@/city/lib/market/bundled';
import { PALETTE } from '@/city/lib/palette';
import { LOT, planBuilding } from '@/city/lib/quarter/kit/blueprint';
import { BUILDING_KINDS, KIND_NAMES, LEVELS, moduleDef, normalizeModules, type BuildingKind, type Level, type ModuleSet } from '@/city/lib/quarter/kit/catalog';
import type { Lod } from '@/city/lib/quarter/kit/lod';
import type { Vec3 } from '@/city/lib/quarter/kit/parts';
import { Effects } from '../../city/Effects';
import { Embers } from '../../city/Embers';
import { Fillers } from '../../city/Fillers';
import { Ground } from '../../city/Ground';
import { Rails } from '../../city/Rails';
import { Sky } from '../../city/Sky';
import { Towers } from '../../city/Towers';
import { Traffic } from '../../city/Traffic';
import { Mark } from '../../hud/Mark';
import { KitBuilding, KitPlan, KitWorld } from './Kit';
import type { KitStats } from './instancer';
import { STAGE_TOP, stagePlan } from './stage';
import s from './gallery.module.css';

/**
 * The kit's gallery for development (`/city/kit`): every kind at every level on a pier south of the island, with the
 * live city behind it — the same sky, haze, skyline, bloom and grain — so the quarter is judged as part of the city.
 *
 *   ?kind=home            one kind, levels 1 → 5
 *   ?kind=home&level=5    one building close up
 *   &bare                 without the city behind (the kit's own cost)
 *   &stats                frame rate, draw calls, triangles, detail levels
 *   &lod=0|1|2 · &lod=debug   force a level of detail, or tint buildings by it
 *   &dpr=1.75             pixel ratio (default: the device's, at most 1.75 as in the city)
 */

const PIER: Vec3 = [0, 0, 100];
const COLUMN = 6.2;
const ROW = 6.6;

type Mode = { kind: BuildingKind | null; level: Level | null };
type Placed = { kind: BuildingKind; level: Level; at: Vec3; turn: number };

function readMode(): Mode & { bare: boolean; stats: boolean; lod: Lod | undefined; debug: boolean; dpr: number } {
  const q = new URLSearchParams(location.search);
  const kind = (BUILDING_KINDS as readonly string[]).includes(q.get('kind') ?? '') ? (q.get('kind') as BuildingKind) : null;
  const level = Number(q.get('level'));
  const lod = q.get('lod');
  return {
    kind,
    level: kind && LEVELS.includes(level as Level) ? (level as Level) : null,
    bare: q.has('bare'),
    stats: q.has('stats'),
    lod: lod === '0' || lod === '1' || lod === '2' ? (Number(lod) as Lod) : undefined,
    debug: lod === 'debug',
    dpr: Number(q.get('dpr')) || Math.min(1.75, window.devicePixelRatio || 1),
  };
}

/** Where each building stands in a mode. Portrait screens get the levels on a diagonal, so each stays large. */
function placeAll(mode: Mode, portrait: boolean): Placed[] {
  const [px, , pz] = PIER;
  if (mode.kind && mode.level) return [{ kind: mode.kind, level: mode.level, at: [px, STAGE_TOP, pz], turn: 0 }];
  if (mode.kind) {
    const kind = mode.kind;
    return LEVELS.map((level, i) => ({
      kind,
      level,
      at: portrait ? [px + (i - 2) * 3.4, STAGE_TOP, pz + (2 - i) * 5.6] : [px + (i - 2) * 6.4, STAGE_TOP, pz],
      turn: 0,
    }));
  }
  return BUILDING_KINDS.flatMap((kind, k) =>
    LEVELS.map((level, l) => ({ kind, level, at: [px + (k - 4.5) * COLUMN, STAGE_TOP, pz + (2 - l) * ROW] as Vec3, turn: 0 })),
  );
}

export function Gallery() {
  const [opts, setOpts] = useState(() => readMode());
  const mode: Mode = { kind: opts.kind, level: opts.level };
  const [portrait, setPortrait] = useState(() => window.innerWidth < window.innerHeight);
  useEffect(() => {
    const onResize = () => setPortrait(window.innerWidth < window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    useCity.getState().setSnapshot(BUNDLED_CITY);
    useCity.getState().enter();
  }, []);

  const go = useCallback((kind: BuildingKind | null, level: Level | null) => {
    const q = new URLSearchParams(location.search);
    q.delete('kind');
    q.delete('level');
    if (kind) q.set('kind', kind);
    if (kind && level) q.set('level', String(level));
    history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
    setOpts(readMode());
  }, []);

  const placed = useMemo(() => placeAll(mode, portrait), [mode.kind, mode.level, portrait]); // eslint-disable-line react-hooks/exhaustive-deps
  const statsRef = useRef<{ stats: () => KitStats } | null>(null);
  const keep = useCallback((kit: { stats: () => KitStats }) => {
    statsRef.current = kit;
  }, []);
  const [meter, setMeter] = useState<Meter | null>(null);

  const single = mode.kind && mode.level ? normalizeModules(mode.kind, mode.level, []) : null;
  const labels = useMemo(() => labelsFor(placed, mode, portrait), [placed, portrait]); // eslint-disable-line react-hooks/exhaustive-deps
  const labelNodes = useRef(new Map<string, HTMLElement>());
  return (
    <div className={s.page}>
      <Canvas
        dpr={opts.dpr}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false }}
        camera={{ fov: 40, near: 0.5, far: 2400, position: [0, 30, 170] }}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color(PALETTE.inkDeep));
          gl.info.autoReset = false;
          Object.assign(window, { __gl: gl });
        }}
        style={{ position: 'fixed', inset: 0, touchAction: 'none' }}
      >
        <Heartbeat />
        <Sky />
        <Ground />
        {!opts.bare && <City />}
        <KitWorld lod={opts.lod} debug={opts.debug} onReady={keep}>
          <Stage placed={placed} wide={!mode.kind} />
          {placed.map((b) => (
            <group key={`${b.kind}-${b.level}-${b.at.join(',')}`} position={b.at} rotation-y={b.turn}>
              <KitBuilding kind={b.kind} level={b.level} seed={0.37} />
            </group>
          ))}
        </KitWorld>
        <Projector labels={labels} nodes={labelNodes} />
        <Framing placed={placed} mode={mode} portrait={portrait} />
        <Effects quality="high" />
        <Meters kit={statsRef} onMeter={opts.stats ? setMeter : undefined} />
      </Canvas>

      {labels.map((label) => (
        <span
          key={label.key}
          className={s.tag}
          ref={(el) => {
            if (el) labelNodes.current.set(label.key, el);
            else labelNodes.current.delete(label.key);
          }}
        >
          {label.text}
        </span>
      ))}

      <header className={s.top}>
        <div className={s.brand}>
          <Mark size={28} />
          <span className={s.word}>Ryntra</span>
        </div>
        <span className={s.chip}>Quarter kit · dev</span>
      </header>

      <section className={s.caption} aria-live="polite">
        <h1 className={s.title}>{mode.kind ? KIND_NAMES[mode.kind] : 'Ten buildings, five levels'}</h1>
        <p className={s.line}>
          {opts.debug
            ? 'Detail by size on screen: amber up close · violet the street · ice the district'
            : single
            ? describe(single)
            : mode.kind
              ? 'Levels 1 → 5 · base, floors, roof, light, sign'
              : 'Every kind of the quarter at every level, on the pier south of the city'}
        </p>
      </section>

      <nav className={s.dock} aria-label="Kinds">
        <div className={s.row}>
          <button className={mode.kind === null ? `${s.pill} ${s.on}` : s.pill} onClick={() => go(null, null)}>
            All
          </button>
          {BUILDING_KINDS.map((kind) => (
            <button key={kind} className={mode.kind === kind ? `${s.pill} ${s.on}` : s.pill} onClick={() => go(kind, null)}>
              {KIND_NAMES[kind]}
            </button>
          ))}
        </div>
        {mode.kind && (
          <div className={s.row}>
            <button className={mode.level === null ? `${s.pill} ${s.on}` : s.pill} onClick={() => go(mode.kind, null)}>
              All levels
            </button>
            {LEVELS.map((level) => (
              <button key={level} className={mode.level === level ? `${s.pill} ${s.on}` : s.pill} onClick={() => go(mode.kind, level)}>
                L{level}
              </button>
            ))}
          </div>
        )}
      </nav>

      {opts.stats && meter && (
        <aside className={s.stats} aria-label="Frame">
          <b>{meter.fps.toFixed(0)} FPS</b> · {meter.ms.toFixed(1)} ms · CPU {meter.cpu.toFixed(1)} ms
          <br />
          {meter.calls} calls · {(meter.triangles / 1000).toFixed(0)}k tris · kit {meter.kit.drawn} calls, {meter.kit.instances} parts · LOD {meter.kit.lods.join('/')} · DPR {opts.dpr}
        </aside>
      )}
    </div>
  );
}

/** A building's modules in one short line: floors of the same style counted together. */
function describe(set: ModuleSet): string {
  const name = (id: string | null) => (id ? (moduleDef(id)?.name ?? id) : null);
  const floors: string[] = [];
  set.floors.forEach((id, i) => {
    if (i > 0 && set.floors[i - 1] === id) return;
    let n = 1;
    while (set.floors[i + n] === id) n += 1;
    floors.push(`${name(id)} ×${n}`);
  });
  return [name(set.base), floors.join(', '), name(set.roof), name(set.light), set.sign === 'sign.none' ? null : name(set.sign)].filter(Boolean).join(' · ');
}

/** The city around the pier: towers, low-rise blocks, light rails, traffic and embers from the bundled market. */
function City() {
  const layout = useCity((st) => st.layout);
  return (
    <>
      <Fillers fillers={layout.fillers} />
      <Towers towers={layout.towers} />
      <Rails rails={layout.rails} />
      <Traffic drones={220} walkers={900} />
      <Embers count={900} />
    </>
  );
}

/** The shared clock and the Slot Pulse on every bar, as in the city. */
function Heartbeat() {
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    SHARED.uTime.value = t;
    const since = t - SHARED.uPulseTime.value;
    if (since > BAR && since > 2.4) {
      SHARED.uPulseTime.value = Math.floor(t / BAR) * BAR;
      SHARED.uPulseOrigin.value.set(0, 0);
      SHARED.uPulseStrength.value = 0.32;
      SHARED.uPulseColor.value.set(PALETTE.amber);
    }
  });
  return null;
}

function Stage({ placed, wide }: { placed: Placed[]; wide: boolean }) {
  const plan = useMemo(() => {
    const xs = placed.map((p) => p.at[0]);
    const zs = placed.map((p) => p.at[2]);
    const pad = wide ? 3.2 : 4.2;
    const minX = Math.min(...xs) - LOT / 2 - pad;
    const maxX = Math.max(...xs) + LOT / 2 + pad;
    const minZ = Math.min(...zs) - LOT / 2 - pad;
    const maxZ = Math.max(...zs) + LOT / 2 + pad;
    return stagePlan([(minX + maxX) / 2, 0, (minZ + maxZ) / 2], maxX - minX, maxZ - minZ, placed.map((p) => p.at), LOT);
  }, [placed, wide]);
  return <KitPlan plan={plan} />;
}

/** Screen margins kept free for the caption above and the pills below, as shares of the screen. */
type Margins = { top: number; bottom: number; side: number };

/**
 * Where the camera stands to show `box` from a direction (azimuth and polar angle, as camera-controls counts them)
 * inside the free part of the screen: a few rounds of project the corners, scale the distance, re-centre.
 */
function frameBox(camera: THREE.PerspectiveCamera, box: THREE.Box3, azimuth: number, polar: number, free: Margins) {
  const cam = camera.clone();
  const dir = new THREE.Vector3().setFromSphericalCoords(1, polar, azimuth);
  const target = box.getCenter(new THREE.Vector3());
  let distance = box.getSize(new THREE.Vector3()).length();
  const corners = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  const p = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const [x0, x1, y0, y1] = [-1 + 2 * free.side, 1 - 2 * free.side, -1 + 2 * free.bottom, 1 - 2 * free.top];
  for (let round = 0; round < 40; round += 1) {
    cam.position.copy(target).addScaledVector(dir, distance);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const c of corners) {
      p.copy(c).project(cam);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const scale = Math.max((maxX - minX) / (x1 - x0), (maxY - minY) / (y1 - y0));
    const tanY = Math.tan((cam.fov * Math.PI) / 360);
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    up.setFromMatrixColumn(cam.matrixWorld, 1);
    target.addScaledVector(right, (((minX + maxX) / 2 - (x0 + x1) / 2) * distance * tanY * cam.aspect) / 2);
    target.addScaledVector(up, (((minY + maxY) / 2 - (y0 + y1) / 2) * distance * tanY) / 2);
    distance *= Math.pow(scale, 0.6);
  }
  return { eye: cam.position.clone(), target };
}

/** Fits the camera to what is shown, from the south, the city's skyline and the Eclipse behind. */
function Framing({ placed, mode, portrait }: { placed: Placed[]; mode: Mode; portrait: boolean }) {
  const controls = useRef<CameraControls>(null);
  const camera = useThree((st) => st.camera) as THREE.PerspectiveCamera;
  const size = useThree((st) => st.size);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    camera.fov = portrait ? 52 : 40;
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    const box = new THREE.Box3();
    for (const p of placed) {
      const plan = planBuilding(p.kind, p.level);
      box.expandByPoint(new THREE.Vector3(p.at[0] + plan.min[0], p.at[1] + plan.min[1], p.at[2] + plan.min[2]));
      box.expandByPoint(new THREE.Vector3(p.at[0] + plan.max[0], p.at[1] + plan.max[1], p.at[2] + plan.max[2]));
    }
    const single = !!(mode.kind && mode.level);
    const azimuth = single ? -0.55 : mode.kind && portrait ? 0.62 : 0;
    const polar = single ? 1.12 : mode.kind ? (portrait ? 1.16 : 1.24) : portrait ? 0.6 : 0.98;
    const rows = mode.kind ? 2 : 1;
    const free: Margins = portrait
      ? { top: mode.kind ? 0.2 : 0.4, bottom: 0.06 + rows * 0.075, side: 0.05 }
      : { top: 0.17, bottom: 0.05 + rows * 0.07, side: 0.04 };
    const { eye, target } = frameBox(camera, box, azimuth, polar, free);
    void c.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, false);
  }, [placed, mode.kind, mode.level, portrait, camera, size.width, size.height]);
  return <CameraControls ref={controls} makeDefault minDistance={4} maxDistance={320} minPolarAngle={0.3} maxPolarAngle={1.45} smoothTime={0.5} />;
}

type Label = { key: string; text: string; at: Vec3 };

/** Level numbers under each building, kind names along the front of the overview. */
function labelsFor(placed: Placed[], mode: Mode, portrait: boolean): Label[] {
  // A phone's overview has no room for ten names; the pills below name the kinds.
  if ((mode.kind && mode.level) || (!mode.kind && portrait)) return [];
  if (mode.kind) return placed.map((p) => ({ key: `L${p.level}`, text: `L${p.level}`, at: [p.at[0], STAGE_TOP, p.at[2] + LOT / 2] }));
  return placed.filter((p) => p.level === 1).map((p) => ({ key: p.kind, text: KIND_NAMES[p.kind], at: [p.at[0], STAGE_TOP, p.at[2] + LOT / 2 + 0.8] }));
}

/** Moves the label elements to their points on screen every frame; the labels themselves are plain page elements. */
function Projector({ labels, nodes }: { labels: Label[]; nodes: React.RefObject<Map<string, HTMLElement>> }) {
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const label of labels) {
      const el = nodes.current.get(label.key);
      if (!el) continue;
      v.set(...label.at).project(camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.opacity = visible ? '1' : '0';
      el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

type Meter = { fps: number; ms: number; cpu: number; calls: number; triangles: number; kit: KitStats };

/**
 * Measures every frame: wall time between frames, CPU time from the first callback to the end of the composer's
 * render, and the renderer's draw calls and triangles. `window.__kit.meter()` returns the last two seconds, for the
 * measuring script.
 */
function Meters({ kit, onMeter }: { kit: React.RefObject<{ stats: () => KitStats } | null>; onMeter?: (m: Meter) => void }) {
  const gl = useThree((st) => st.gl);
  const start = useRef(0);
  const frames = useRef<{ at: number; cpu: number }[]>([]);
  const last = useRef<Meter | null>(null);
  useFrame(() => {
    start.current = performance.now();
    gl.info.reset();
  }, -10);
  useFrame(() => {
    const now = performance.now();
    const list = frames.current;
    list.push({ at: now, cpu: now - start.current });
    while (list.length && now - list[0]!.at > 2000) list.shift();
    if (list.length < 2) return;
    const span = (list[list.length - 1]!.at - list[0]!.at) / (list.length - 1);
    last.current = {
      fps: 1000 / span,
      ms: span,
      cpu: list.reduce((sum, f) => sum + f.cpu, 0) / list.length,
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      kit: kit.current?.stats() ?? { buildings: 0, instances: 0, pools: 0, drawn: 0, lods: [0, 0, 0] },
    };
  }, 3);
  useEffect(() => {
    Object.assign(window, { __kit: { meter: () => last.current } });
    if (!onMeter) return;
    const timer = setInterval(() => last.current && onMeter({ ...last.current }), 500);
    return () => clearInterval(timer);
  }, [onMeter]);
  return null;
}
