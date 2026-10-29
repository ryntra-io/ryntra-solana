'use client';

import { CameraControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { REACTIONS, STATES, type CharacterState, type Reaction } from '@/city/lib/characters/animator';
import { GUARDIAN } from '@/city/lib/characters/guardian';
import { DETAILS, type Detail } from '@/city/lib/characters/lod';
import { BAR, SHARED } from '@/city/lib/city/shared';
import { useCity } from '@/city/lib/city/store';
import { BUNDLED_CITY } from '@/city/lib/market/bundled';
import { PALETTE } from '@/city/lib/palette';
import { Effects } from '../../city/Effects';
import { Embers } from '../../city/Embers';
import { Fillers } from '../../city/Fillers';
import { Ground } from '../../city/Ground';
import { Rails } from '../../city/Rails';
import { Sky } from '../../city/Sky';
import { Towers } from '../../city/Towers';
import { Traffic } from '../../city/Traffic';
import { Mark } from '../../hud/Mark';
import { KitPlan, KitWorld } from '../../quarter/kit/Kit';
import { STAGE_TOP, stagePlan } from '../../quarter/kit/stage';
import { Guardian, type GuardianHandle } from '../Guardian';
import { STUDIO_ENV_INTENSITY, STUDIO_LIGHT, StudioBackdrop, useStudioEnvironment } from './StudioSet';
import s from './studio.module.css';

/**
 * The characters' studio for development (`/city/characters`): the vault guardian in a dark studio — an HDR light
 * room in the city's colours, a contact shadow, a violet rim — or on a pier south of the island with the live city
 * behind it; every state, moment and movement a tap away, and its detail levels side by side.
 *
 *   ?set=studio|city                            the studio (default) or the city
 *   ?body=model|code                            the Blender model (default) or the body built in code (the prototype)
 *   ?play=ready|thinking|acting|done            a state, live
 *   ?play=attempt|laugh|alarm|defeat|celebrate|greet   a moment, replayed
 *   ?play=idleA|idleB|walk|look                 a movement
 *   &lod=auto|0|1|2|3|lineup                    detail: by size, forced, or all four side by side
 *   &t=1.2                                      hold the clip at this second (frames for review)
 *   &bare · &stats · &silhouette · &clean (no chrome) · &quiet (no caption) · &face (the play's face on a standing body)
 *   &dpr=1.75 · &turn=30 (camera, degrees round the front) · &dist=4 · &lift=0.6
 *   &quality=high|mid|low                       a rung of the city's ladder (CITY-6a): detail and contact shadow follow
 *
 * `window.__guardian` lets the capture script (`shots.mjs`) set any of these without reloading.
 */

const PIER: [number, number, number] = [0, STAGE_TOP, 100];
const MOVES = ['idleA', 'idleB', 'walk', 'look'] as const;
type Move = (typeof MOVES)[number];
type Play = CharacterState | Reaction | Move;
type Lod = 'auto' | Detail | 'lineup';

const NAMES: Record<Play, string> = {
  ready: 'Ready',
  thinking: 'Thinking',
  acting: 'Acting',
  done: 'Done',
  attempt: 'Attempt',
  laugh: 'Laugh',
  alarm: 'Alarm',
  defeat: 'Defeat',
  celebrate: 'Celebrate',
  greet: 'Greet',
  idleA: 'Idle A',
  idleB: 'Idle B',
  walk: 'Walk',
  look: 'Look',
};

const LINES: Record<Play, string> = {
  ready: 'Ready: amber visor, slow breath, a glance now and then',
  thinking: 'Thinking: reads a hologram over its palm, warm visor, a scan bar sweeping',
  acting: 'Acting: answers — an open hand, a fist brought down, the visor speaking',
  done: 'Done: a nod, then arms crossed, the core settling',
  attempt: 'Attempt: the head snaps round, a guard, the eyes narrow',
  laugh: 'Laugh: head back, shoulders shaking, the visor laughing',
  alarm: 'Alarm: fists high, the head sweeping, visor and beacon in flare',
  defeat: 'Defeat — the vault is broken: sparks, a stagger, down on one knee',
  celebrate: 'Celebrate — the vault held: both fists up, a burst of light',
  greet: 'Greet: a raised hand and a wave, a small bow',
  idleA: 'Idle A: the guard stance, weight shifting, breathing',
  idleB: 'Idle B: a roll of the shoulders, a fist punched into the palm',
  walk: 'Walk: heavy steps, dust where each foot lands, turns on the spot',
  look: 'Look: the head and eyes follow the light; behind the shoulder, the body turns',
};

/** The clip each play shows when held still (`&t`). */
const CLIP: Record<Play, string> = {
  ...GUARDIAN.states,
  ...GUARDIAN.reactions,
  idleA: 'idleA',
  idleB: 'idleB',
  walk: 'walk',
  look: 'idleA',
};

type Opts = {
  set: 'studio' | 'city';
  body: 'model' | 'code';
  play: Play;
  lod: Lod;
  t: number | null;
  bare: boolean;
  stats: boolean;
  silhouette: boolean;
  clean: boolean;
  quiet: boolean;
  /** Only the face of the play, on a standing body (the visor's sheet). */
  face: boolean;
  dpr: number;
  turn: number;
  dist: number | null;
  lift: number;
};

const PLAYS: readonly Play[] = [...STATES, ...REACTIONS, ...MOVES];

function readOpts(): Opts {
  const q = new URLSearchParams(location.search);
  const play = (PLAYS as readonly string[]).includes(q.get('play') ?? '') ? (q.get('play') as Play) : 'ready';
  const l = q.get('lod');
  const lod: Lod = l === 'lineup' ? 'lineup' : l === '0' || l === '1' || l === '2' || l === '3' ? (Number(l) as Detail) : 'auto';
  const t = q.get('t');
  return {
    set: q.get('set') === 'city' ? 'city' : 'studio',
    body: q.get('body') === 'code' ? 'code' : 'model',
    play,
    lod,
    t: t !== null && Number.isFinite(Number(t)) ? Number(t) : null,
    bare: q.has('bare'),
    stats: q.has('stats'),
    silhouette: q.has('silhouette'),
    clean: q.has('clean'),
    quiet: q.has('quiet'),
    face: q.has('face'),
    dpr: Number(q.get('dpr')) || Math.min(1.75, window.devicePixelRatio || 1),
    turn: Number(q.get('turn')) || 0,
    dist: Number(q.get('dist')) || null,
    lift: Number(q.get('lift')) || 0,
  };
}

/** Where the light the guardian watches is at time t (the Look movement): a slow loop round it, up and down. */
function orbAt(t: number): [number, number, number] {
  const a = t * 0.55;
  return [PIER[0] + Math.sin(a) * 2.4, PIER[1] + 1.6 + Math.sin(t * 0.9) * 0.7, PIER[2] + 0.9 + Math.cos(a) * 2];
}

export function Studio() {
  const [opts, setOpts] = useState(readOpts);
  const [portrait, setPortrait] = useState(() => window.innerWidth < window.innerHeight);
  useEffect(() => {
    const onResize = () => setPortrait(window.innerWidth < window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    useCity.getState().setSnapshot(BUNDLED_CITY);
    useCity.getState().enter();
    // `?quality=high|mid|low`: a rung of the city's ladder, to see what a character spends on it.
    const q = new URLSearchParams(location.search).get('quality');
    if (q === 'high' || q === 'mid' || q === 'low') useCity.getState().setQuality(q);
  }, []);

  const current = useRef(opts);
  current.current = opts;
  const go = useCallback((patch: Partial<Opts>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    setOpts(next);
    const q = new URLSearchParams(location.search);
    q.set('play', next.play);
    if (next.set === 'studio') q.delete('set');
    else q.set('set', next.set);
    if (next.body === 'model') q.delete('body');
    else q.set('body', next.body);
    if (next.lod === 'auto') q.delete('lod');
    else q.set('lod', String(next.lod));
    if (next.t === null) q.delete('t');
    else q.set('t', String(next.t));
    history.replaceState(null, '', `${location.pathname}?${q}`);
  }, []);

  const handle = useRef<GuardianHandle>(null);
  const [meter, setMeter] = useState<Meter | null>(null);
  useEffect(() => {
    Object.assign(window, {
      __guardian: {
        set: (patch: Partial<Opts>) => go(patch),
        handle: () => handle.current,
        clip: (play: Play) => CLIP[play],
        clips: () => Object.fromEntries(Object.entries(GUARDIAN.clips).map(([k, c]) => [k, c.duration])),
        triangles: () => handle.current?.triangles() ?? [],
        body: () => handle.current?.body() ?? 'loading',
      },
    });
  }, [go]);

  return (
    <div className={s.page}>
      <Canvas
        dpr={opts.dpr}
        gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false, preserveDrawingBuffer: true }}
        camera={{ fov: 40, near: 0.1, far: 2400, position: [0, 3, 110] }}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color(opts.silhouette ? PALETTE.pearl : PALETTE.inkDeep));
          gl.info.autoReset = false;
          Object.assign(window, { __gl: gl });
        }}
        style={{ position: 'fixed', inset: 0, touchAction: 'none' }}
      >
        <Heartbeat at={opts.t} />
        {!opts.silhouette && opts.set === 'city' && (
          <>
            <Sky />
            <Ground />
            {!opts.bare && <City />}
            <KitWorld>
              <Stage wide={opts.lod === 'lineup'} />
            </KitWorld>
          </>
        )}
        {!opts.silhouette && opts.set === 'studio' && <StudioBackdrop at={PIER} />}
        <Cast opts={opts} handle={handle} />
        <Framing opts={opts} portrait={portrait} />
        {opts.silhouette ? <Plain /> : <Effects quality="high" />}
        <Meters guardian={handle} onMeter={opts.stats ? setMeter : undefined} />
      </Canvas>

      {!opts.clean && (
        <header className={s.top}>
          <div className={s.brand}>
            <Mark size={28} />
            <span className={s.word}>Ryntra</span>
          </div>
          <span className={s.chip}>Characters · dev</span>
        </header>
      )}

      {!opts.quiet && (
        <section className={[s.caption, opts.clean ? s.captionClean : '', opts.silhouette ? s.captionInk : ''].join(' ')} aria-live="polite">
          <h1 className={s.title}>{opts.lod === 'lineup' ? 'Vault guardian · detail' : `Vault guardian · ${NAMES[opts.play]}`}</h1>
          {/* What the play shows, behind one quiet "i": open, read, close. */}
          <details className={s.more}>
            <summary className={s.info} aria-label="Details">
              i
            </summary>
            <p className={s.line}>{opts.lod === 'lineup' ? 'Hero · standard · crowd · far picture, side by side' : LINES[opts.play]}</p>
          </details>
        </section>
      )}

      {!opts.clean && (
        <nav className={s.dock} aria-label="Guardian">
          <Row label="State" items={STATES} on={opts.play} pick={(play) => go({ play, t: null })} />
          <Row label="Moment" items={REACTIONS} on={opts.play} pick={(play) => go({ play, t: null })} />
          <Row label="Move" items={MOVES} on={opts.play} pick={(play) => go({ play, t: null })} />
          <div className={s.row}>
            <span className={s.label}>Scene</span>
            {(['studio', 'city'] as const).map((set) => (
              <button key={set} className={opts.set === set ? `${s.pill} ${s.on}` : s.pill} onClick={() => go({ set })}>
                {set === 'studio' ? 'Studio' : 'City'}
              </button>
            ))}
            <span className={s.label}>Body</span>
            {(['model', 'code'] as const).map((body) => (
              <button key={body} className={opts.body === body ? `${s.pill} ${s.on}` : s.pill} onClick={() => go({ body })}>
                {body === 'model' ? 'Model' : 'Prototype'}
              </button>
            ))}
          </div>
          <div className={s.row}>
            <span className={s.label}>Detail</span>
            {(['auto', 0, 1, 2, 3, 'lineup'] as const).map((lod) => (
              <button key={String(lod)} className={opts.lod === lod ? `${s.pill} ${s.on}` : s.pill} onClick={() => go({ lod })}>
                {lod === 'auto' ? 'Auto' : lod === 'lineup' ? 'All four' : DETAILS[lod][0]!.toUpperCase() + DETAILS[lod].slice(1)}
              </button>
            ))}
          </div>
        </nav>
      )}

      {opts.stats && meter && (
        <aside className={s.stats} aria-label="Frame">
          <b>{meter.fps.toFixed(0)} FPS</b> · {meter.ms.toFixed(1)} ms · CPU {meter.cpu.toFixed(1)} ms · guardian {meter.animator.toFixed(0)} µs
          <br />
          {meter.calls} calls · {(meter.triangles / 1000).toFixed(1)}k tris · {DETAILS[meter.detail]} · {opts.body === 'code' ? 'prototype' : 'model'} · DPR {opts.dpr}
        </aside>
      )}
    </div>
  );
}

function Row<T extends Play>({ label, items, on, pick }: { label: string; items: readonly T[]; on: Play; pick: (p: T) => void }) {
  return (
    <div className={s.row}>
      <span className={s.label}>{label}</span>
      {items.map((p) => (
        <button key={p} className={on === p ? `${s.pill} ${s.on}` : s.pill} onClick={() => pick(p)}>
          {NAMES[p]}
        </button>
      ))}
    </div>
  );
}

/** The guardian (or four of them, one per detail level) doing what the options say. */
function Cast({ opts, handle }: { opts: Opts; handle: React.RefObject<GuardianHandle | null> }) {
  const { play, t } = opts;
  const isState = (STATES as readonly string[]).includes(play);
  const isReaction = (REACTIONS as readonly string[]).includes(play);
  const clock = useRef(0);
  // Held still, or a movement shown as its clip on a loop: the page drives the clip's time through this one object,
  // which the guardian reads every frame — no re-render per frame.
  const driven = t !== null || play === 'idleA' || play === 'idleB';
  const still = useMemo(() => ({ clip: 'idleA', t: 0, look: null as [number, number, number] | null, face: null as { clip: string; t: number } | null }), []);
  const lookAt = useMemo(() => new THREE.Vector3(), []);
  const [walkTo, setWalkTo] = useState<[number, number] | null>(null);
  const [reaction, setReaction] = useState<{ kind: Reaction; key: number; hold?: boolean } | null>(null);
  const mover = useRef<THREE.Group>(null);
  const orb = useRef<THREE.Mesh>(null);
  const studioEnv = useStudioEnvironment();
  const studio = opts.set === 'studio' && !opts.silhouette;
  const look = studio ? { env: studioEnv, envIntensity: STUDIO_ENV_INTENSITY, light: STUDIO_LIGHT, contact: true } : {};

  // A moment replays a little after it ends, so the page keeps showing it.
  useEffect(() => {
    if (!isReaction || t !== null) {
      setReaction(null);
      return;
    }
    let key = 0;
    setReaction({ kind: play as Reaction, key });
    const every = (GUARDIAN.clips[CLIP[play]]!.duration + 1.6) * 1000;
    const timer = setInterval(() => setReaction({ kind: play as Reaction, key: ++key }), every);
    return () => clearInterval(timer);
  }, [play, isReaction, t]);
  // Walk: back and forth across the pier, turning at each end.
  useEffect(() => setWalkTo(play === 'walk' && t === null ? [1.6, 0.2] : null), [play, t]);

  useFrame((_, delta) => {
    clock.current += Math.min(delta, 0.1);
    const now = t ?? clock.current;
    const clip = CLIP[play];
    const duration = GUARDIAN.clips[clip]!.duration;
    const time = t !== null ? t : play === 'idleB' ? now % (duration + 1.2) : now % duration;
    // The visor's sheet: the play's face on a body standing still, so the face is always in view.
    still.clip = opts.face ? 'idleA' : clip;
    still.t = opts.face ? 0.5 : time;
    still.face = opts.face ? { clip, t: time } : null;
    still.look = play === 'look' && !opts.face ? localOrb(now) : null;
    // A held walk travels as it would, so the feet are not on a treadmill.
    if (mover.current) mover.current.position.z = play === 'walk' && t !== null ? ((t * GUARDIAN.walk.speed) % 3) - 1.5 : 0;
    if (play === 'look') {
      const at = orbAt(now);
      orb.current?.position.set(...at);
      lookAt.set(...at);
    }
  });

  const showState: CharacterState = isState ? (play as CharacterState) : 'ready';
  if (opts.lod === 'lineup') {
    return (
      <>
        {([0, 1, 2, 3] as const).map((d) => (
          <Guardian
            key={d}
            ref={d === 0 ? handle : undefined}
            position={[PIER[0] + (d - 1.5) * 1.5, PIER[1], PIER[2]]}
            detail={d}
            state={showState}
            reaction={reaction}
            still={driven ? still : null}
            seed={d + 1}
            body={opts.body}
            {...look}
            silhouette={opts.silhouette}
          />
        ))}
      </>
    );
  }
  return (
    <>
      <group ref={mover}>
        <Guardian
          ref={handle}
          position={PIER}
          detail={opts.lod === 'auto' ? 'auto' : opts.lod}
          state={showState}
          reaction={reaction}
          still={driven ? still : null}
          lookAt={play === 'look' && !driven ? lookAt : null}
          walkTo={walkTo}
          onArrive={() => setWalkTo((w) => (w ? [-w[0], -w[1]] : w))}
          body={opts.body}
          {...look}
          silhouette={opts.silhouette}
        />
      </group>
      {play === 'look' && !opts.silhouette && (
        <mesh ref={orb}>
          <sphereGeometry args={[0.09, 16, 12]} />
          <meshBasicMaterial color={new THREE.Color(PALETTE.warmWhite).multiplyScalar(4)} toneMapped={false} />
        </mesh>
      )}
    </>
  );
}

/** The orb in the guardian's own space (it stands at the pier, unturned). */
function localOrb(t: number): [number, number, number] {
  const [x, y, z] = orbAt(t);
  return [x - PIER[0], y - PIER[1], z - PIER[2]];
}

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

function Stage({ wide }: { wide: boolean }) {
  const plan = useMemo(() => {
    const width = wide ? 12 : 7;
    return stagePlan([PIER[0], 0, PIER[2] + 0.5], width, 6, [], 5);
  }, [wide]);
  return <KitPlan plan={plan} />;
}

/** Renders the frame without the composer (the silhouette): a callback with a priority takes rendering over. */
function Plain() {
  useFrame(({ gl, scene, camera }) => gl.render(scene, camera), 1);
  return null;
}

/** The city's clock and its Slot Pulse; held at the clip's time when the page shows a still (`&t`), so a video is exact. */
function Heartbeat({ at }: { at: number | null }) {
  useFrame(({ clock }) => {
    const t = at ?? clock.elapsedTime;
    SHARED.uTime.value = t;
    const since = t - SHARED.uPulseTime.value;
    if (since < 0 || (since > BAR && since > 2.4)) {
      SHARED.uPulseTime.value = Math.floor(t / BAR) * BAR;
      SHARED.uPulseOrigin.value.set(0, 0);
      SHARED.uPulseStrength.value = 0.32;
      SHARED.uPulseColor.value.set(PALETTE.amber);
    }
  });
  return null;
}

/** The camera on the guardian: a three-quarter view from a little below the chest, so it looms; the lineup from the front. */
function Framing({ opts, portrait }: { opts: Opts; portrait: boolean }) {
  const controls = useRef<CameraControls>(null);
  const camera = useThree((st) => st.camera) as THREE.PerspectiveCamera;
  const size = useThree((st) => st.size);
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    camera.fov = portrait ? 50 : 34;
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    const lineup = opts.lod === 'lineup';
    const target = new THREE.Vector3(PIER[0], PIER[1] + (lineup ? 0.95 : 1.05) + opts.lift, PIER[2]);
    const distance = opts.dist ?? (lineup ? (portrait ? 14 : 7.5) : portrait ? 5.8 : 4.9);
    const azimuth = ((lineup ? 0 : -24 + opts.turn) * Math.PI) / 180;
    const polar = ((lineup ? 84 : 86) * Math.PI) / 180;
    const eye = new THREE.Vector3().setFromSphericalCoords(distance, polar, azimuth).add(target);
    void c.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, false);
  }, [opts.lod, opts.turn, opts.dist, opts.lift, portrait, camera, size.width, size.height]);
  return <CameraControls ref={controls} makeDefault minDistance={2} maxDistance={400} minPolarAngle={0.3} maxPolarAngle={1.62} smoothTime={0.4} />;
}

type Meter = { fps: number; ms: number; cpu: number; calls: number; triangles: number; detail: Detail; animator: number };

/** Frame measurements, as the kit's gallery takes them; `window.__guardianMeter()` returns the last two seconds. */
function Meters({ guardian, onMeter }: { guardian: React.RefObject<GuardianHandle | null>; onMeter?: (m: Meter) => void }) {
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
      detail: guardian.current?.detail() ?? 1,
      animator: guardian.current?.cost() ?? 0,
    };
  }, 3);
  useEffect(() => {
    Object.assign(window, { __guardianMeter: () => last.current });
    if (!onMeter) return;
    const timer = setInterval(() => last.current && onMeter({ ...last.current }), 500);
    return () => clearInterval(timer);
  }, [onMeter]);
  return null;
}

