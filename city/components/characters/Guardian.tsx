'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Animator, type CharacterState, type Reaction } from '@/city/lib/characters/animator';
import { CROWD, HERO, STANDARD } from '@/city/lib/characters/body';
import type { ClipEventKind } from '@/city/lib/characters/clip';
import { SHARED } from '@/city/lib/city/shared';
import { eventsBetween } from '@/city/lib/characters/clip';
import { CH } from '@/city/lib/characters/expression';
import { GUARDIAN, GUARDIAN_BODY, GUARDIAN_BOUNDS } from '@/city/lib/characters/guardian';
import { CHARACTER_BUDGET, chooseDetail, projectedHeight, type Detail } from '@/city/lib/characters/lod';
import { useCity } from '@/city/lib/city/store';
import { createBodyMaterial, writeBody, type BodyLight } from './bodyMaterial';
import { groundGeometry, groundMaterial, holoGeometry, holoMaterial, sparkGeometry, sparkMaterial } from './fx';
import { bodyGeometry } from './geometry';
import { atlasFor, impostorGeometry, impostorMaterial, renderAtlas, type Frame } from './impostor';
import { ContactShadow } from './contactShadow';
import { loadModelBody, type BodySkin, type ModelBody } from './model';

/**
 * The vault guardian in the scene. A heavy robot of separate armoured pieces with a visor for a face; it shows what
 * it is doing with its body and its light, never with text:
 *
 *   <Guardian state="thinking" />                                    ready · thinking · acting · done
 *   <Guardian state="ready" reaction={{ kind: 'attempt', key: id }} />  attempt · laugh · alarm · defeat · celebrate · greet
 *   <Guardian lookAt={[x, y, z]} walkTo={[2, 0]} />                    head and eyes follow a point; walks to a spot
 *
 * A reaction plays once when its `key` changes and hands back to the state; with `hold: true` it stays in its last
 * section (defeat stays down) until the next reaction or `reaction={null}`. `walkTo` is a point on the ground in the
 * guardian's own space (x, z), in its units; `heading` is the way it faces while standing (radians, 0 = +z).
 *
 * The guardian is about 1.97 units tall; `height` sets its height in the scene. Its detail follows its size on screen
 * (hero, standard, crowd, and a picture of itself on the far plane); `detail` forces one. It costs one draw call for
 * the body and one for the ground under it, plus the hologram while it thinks and sparks after a defeat.
 *
 * Its body is the model built in Blender (`assets-source/characters/guardian/`, `public/city/characters/guardian/`):
 * hard-surface armour with baked PBR textures at three detail levels, fixed to the same bones. Until the file arrives
 * nothing is drawn; if it cannot be read, the body built in code (`city/lib/characters/guardian/body.ts`) stands in.
 * `body="code"` asks for that one directly (the development page compares the two).
 */

/** The guardian's model: GLB with WebP textures and Meshopt geometry. */
export const GUARDIAN_MODEL_URL = '/city/characters/guardian/guardian.glb';

export type GuardianProps = {
  state?: CharacterState;
  reaction?: { kind: Reaction; key: string | number; hold?: boolean } | null;
  lookAt?: THREE.Vector3 | readonly [number, number, number] | null;
  walkTo?: readonly [number, number] | null;
  heading?: number;
  height?: number;
  detail?: 'auto' | Detail;
  position?: readonly [number, number, number];
  /** Turn of the guardian's own space about y (radians). */
  rotation?: number;
  seed?: number;
  /** The Blender model (default) or the body built in code. */
  body?: 'model' | 'code';
  /** A prefiltered HDR environment and its light, for a studio; in the city the body keeps the city's light. */
  env?: THREE.Texture | null;
  envIntensity?: number;
  light?: BodyLight;
  /** A soft contact shadow under the body (a studio or a hero room; one more draw of the body and two blurs). */
  contact?: boolean;
  /** Development: black against the background, to judge the silhouette. */
  silhouette?: boolean;
  /** Development: show one clip at its own time instead of playing (frames for review). */
  still?: { clip: string; t: number; look?: readonly [number, number, number] | null; stride?: number; face?: { clip: string; t: number } | null } | null;
  onArrive?: () => void;
  onEvent?: (kind: ClipEventKind) => void;
};

/** What a guardian reports about itself (for the development page and tests). */
export type GuardianHandle = {
  animator: Animator;
  detail: () => Detail;
  atlas: () => THREE.Texture | null;
  cost: () => number;
  /** Which body is drawn: the Blender model, the code one, or none yet (loading). */
  body: () => 'model' | 'code' | 'loading';
  /** Triangles of the body drawn at hero, standard and crowd detail, and of the impostor. */
  triangles: () => number[];
};

/** Natural height, the box the impostor frames, and bounds wide enough for any pose. */
export const GUARDIAN_HEIGHT = GUARDIAN_BOUNDS.max[1];
const FRAME: Frame = { center: 1.02, width: 1.5, height: 2.3 };
const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 1.05, 0), 1.4);
const LEVELS = [HERO, STANDARD, CROWD] as const;

export const Guardian = forwardRef<GuardianHandle, GuardianProps>(function Guardian(
  {
    state = 'ready', reaction = null, lookAt = null, walkTo = null, heading, height, detail = 'auto', position = [0, 0, 0], rotation = 0, seed = 1,
    body: kind = 'model', env = null, envIntensity = 1, light, contact = false, silhouette = false, still = null, onArrive, onEvent,
  },
  ref,
) {
  const gl = useThree((s) => s.gl);
  // The city's quality tier (its frame-rate ladder) caps the detail and decides the contact shadow.
  const quality = useCity((s) => s.quality);
  const budget = CHARACTER_BUDGET[quality];
  const shadowed = contact && budget.contact;
  const animator = useMemo(() => new Animator(GUARDIAN, seed), [seed]);
  const model = useGuardianModel(kind === 'model', gl);
  const drawn = kind === 'code' || model === 'failed' ? 'code' : model === null ? 'loading' : 'model';
  const skin = drawn === 'model' ? (model as ModelBody).skin : null;
  const geometries = useMemo(
    () => (drawn === 'model' ? (model as ModelBody).geometries : LEVELS.map((level) => bodyGeometry(GUARDIAN.name, GUARDIAN_BODY, level, BOUNDS))),
    [drawn, model],
  );
  const material = useMemo(
    () => createBodyMaterial(GUARDIAN.rig.total, silhouette ? 'silhouette' : 'scene', { skin, env, envIntensity, light }),
    [silhouette, skin, env, envIntensity, light],
  );
  const far = useMemo(() => ({ geometry: impostorGeometry(FRAME), material: impostorMaterial(FRAME) }), []);
  const fx = useMemo(
    () => ({
      holo: { geometry: holoGeometry(), material: holoMaterial() },
      sparks: { geometry: sparkGeometry(seed), material: sparkMaterial() },
      ground: { geometry: groundGeometry(), material: groundMaterial() },
    }),
    [seed],
  );
  useEffect(() => () => material.dispose(), [material]);
  // One contact shadow for the guardian's life (its ground stays in the scene as the body changes); the bones it draws
  // with are the body material's, taken each frame.
  const shadow = useMemo(() => {
    if (!shadowed) return null;
    const caster = createBodyMaterial(GUARDIAN.rig.total, 'shadow');
    return { caster, contact: new ContactShadow(caster) };
  }, [shadowed]);
  useEffect(
    () => () => {
      shadow?.caster.dispose();
      shadow?.contact.dispose();
    },
    [shadow],
  );
  useEffect(
    () => () => {
      far.geometry.dispose();
      far.material.dispose();
      for (const f of Object.values(fx)) {
        f.geometry.dispose();
        f.material.dispose();
      }
    },
    [far, fx],
  );

  const home = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const impostor = useRef<THREE.Mesh>(null);
  const holo = useRef<THREE.Mesh>(null);
  const sparks = useRef<THREE.Points>(null);
  const ground = useRef<THREE.Mesh>(null);
  const live = useRef({ x: 0, z: 0, yaw: 0, speed: 0, arrived: true, detail: null as Detail | null, atlas: null as THREE.Texture | null, cost: 0, held: { clip: '', t: 0 } });
  const props = useRef({ lookAt, walkTo, heading, onArrive, onEvent, still, detail, budget });
  props.current = { lookAt, walkTo, heading, onArrive, onEvent, still, detail, budget };

  useImperativeHandle(
    ref,
    () => ({
      animator,
      detail: () => live.current.detail ?? 1,
      atlas: () => live.current.atlas,
      cost: () => live.current.cost,
      body: () => drawn,
      triangles: () => [...geometries.map((g) => g.index!.count / 3), 2],
    }),
    [animator, drawn, geometries],
  );
  // A new body (the model arrived) needs a new picture for the far plane.
  useEffect(() => {
    live.current.atlas = null;
  }, [skin]);

  useEffect(() => animator.setState(state), [animator, state]);
  const reactionKey = reaction ? `${reaction.kind}:${reaction.key}:${reaction.hold ? 1 : 0}` : null;
  useEffect(() => {
    if (reaction) animator.react(reaction.kind, reaction.hold ?? false);
    else animator.release();
    // The key alone decides when a reaction plays again.
  }, [animator, reactionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (walkTo) live.current.arrived = false;
  }, [walkTo?.[0], walkTo?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const look = useMemo(() => new THREE.Vector3(), []);
  const inverse = useMemo(() => new THREE.Matrix4(), []);
  const scratch = useMemo(() => ({ v: new THREE.Vector3(), c: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion() }), []);
  const hand = GUARDIAN.rig.index['hand.L']!;
  const core = GUARDIAN.rig.index.chest!;
  const feet = [GUARDIAN.rig.index['foot.L']!, GUARDIAN.rig.index['foot.R']!];
  const pelvis = GUARDIAN.rig.index.pelvis!;

  useFrame(({ camera, size }, delta) => {
    const g = body.current;
    if (!g || !home.current) return;
    const p = props.current;
    const L = live.current;
    const dt = Math.min(delta, 0.1);
    const began = performance.now();

    // Effects keep the city's clock (`SHARED.uTime`), which the development page can hold at a clip's time.
    const now = SHARED.uTime.value;
    if (p.still) {
      animator.seek(p.still.clip, p.still.t, p.still.look ?? null, p.still.stride ?? 1);
      if (p.still.face) animator.faceOf(p.still.face.clip, p.still.face.t);
      // Stepping a held clip forward still lands its feet and throws its sparks (frames for a video).
      const dt0 = p.still.t - L.held.t;
      if (L.held.clip === p.still.clip && dt0 > 0 && dt0 < 0.5) {
        const clip = GUARDIAN.clips[p.still.clip];
        if (clip) for (const e of eventsBetween(clip, L.held.t, p.still.t)) fire(e, now);
      }
      L.held = { clip: p.still.clip, t: p.still.t };
    } else {
      // Where to go and which way to face.
      let speed = 0;
      let turning = false;
      let want = p.heading ?? L.yaw;
      if (p.walkTo && !L.arrived) {
        const dx = p.walkTo[0] - L.x;
        const dz = p.walkTo[1] - L.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.05) {
          L.arrived = true;
          p.onArrive?.();
        } else {
          want = Math.atan2(dx, dz);
          // Turn first, then walk; slow down for the last steps.
          const off = Math.abs(wrap(want - L.yaw));
          const cruise = GUARDIAN.walk.speed * (off < 0.5 ? 1 : 0) * Math.min(1, dist / 0.6);
          speed = cruise;
        }
      }
      // A target behind the shoulder turns the whole body.
      if (!p.walkTo || L.arrived) {
        if (p.lookAt) {
          home.current.updateWorldMatrix(true, false);
          inverse.copy(home.current.matrixWorld).invert();
          const t = toVector(p.lookAt, look).applyMatrix4(inverse);
          const toward = Math.atan2(t.x - L.x, t.z - L.z);
          if (Math.abs(wrap(toward - L.yaw)) > 1.2) want = toward;
        }
      }
      if (animator.busy) speed = 0;
      L.speed += (speed - L.speed) * Math.min(1, dt * (speed > L.speed ? 1.6 : 3));
      const err = wrap(want - L.yaw);
      if (Math.abs(err) > 0.06 && !animator.busy) {
        const step = Math.sign(err) * Math.min(Math.abs(err), GUARDIAN.walk.turnRate * dt);
        L.yaw += step;
        turning = L.speed < 0.15;
      }
      L.x += Math.sin(L.yaw) * L.speed * dt;
      L.z += Math.cos(L.yaw) * L.speed * dt;
      g.position.set(L.x, 0, L.z);
      g.rotation.y = L.yaw;
      g.updateWorldMatrix(true, false);
      let target: THREE.Vector3 | null = null;
      if (p.lookAt) {
        inverse.copy(g.matrixWorld).invert();
        target = toVector(p.lookAt, look).applyMatrix4(inverse);
      }
      animator.update(dt, { speed: L.speed, turning, look: target ? [target.x, target.y, target.z] : null });
      for (const e of animator.events) {
        p.onEvent?.(e);
        fire(e, now);
      }
    }

    // What one update costs, in microseconds, smoothed.
    L.cost += ((performance.now() - began) * 1000 - L.cost) * 0.1;

    // Detail by size on screen, measured from the middle of the body.
    g.matrixWorld.decompose(scratch.c, scratch.q, scratch.s);
    scratch.v.set(0, GUARDIAN_HEIGHT / 2, 0).applyMatrix4(g.matrixWorld);
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 40;
    const px = projectedHeight(GUARDIAN_HEIGHT * scratch.s.y, scratch.v.distanceTo(camera.position), fov, size.height);
    L.detail = p.detail === 'auto' ? (Math.max(p.budget.best, chooseDetail(px, L.detail, p.budget.pixels)) as Detail) : p.detail;
    const d = L.detail;
    const ready = drawn !== 'loading';
    meshes.current.forEach((m, i) => m && (m.visible = ready && d === i));
    if (impostor.current) {
      impostor.current.visible = ready && d === 3;
      if (ready && d === 3) {
        if (!L.atlas) L.atlas = atlasFor(gl, `${GUARDIAN.name}:${drawn}`, () => pictureOf(gl, geometries[1]!, skin)).texture;
        far.material.uniforms.uAtlas.value = L.atlas;
        far.material.uniforms.uFaceColor.value.setRGB(animator.face[CH.r]!, animator.face[CH.g]!, animator.face[CH.b]!, THREE.LinearSRGBColorSpace);
        far.material.uniforms.uGlow.value = animator.face[CH.glow]!;
      }
    }
    writeBody(material.uniforms, animator.mats, animator.face);
    material.uniforms.uTexBias.value = d === 2 ? 3.5 : 0;
    if (shadow && ready && d < 2 && meshes.current[d] && home.current) {
      home.current.getWorldPosition(scratch.v);
      shadow.caster.uniforms.uGround.value = scratch.v.y;
      shadow.caster.uniforms.uBones.value = material.uniforms.uBones.value;
      shadow.contact.update(gl, meshes.current[d]!, home.current);
    }
    if (shadow) shadow.contact.ground.visible = ready && d < 2;

    // The hologram rides above the left palm, upright.
    const holoOn = animator.face[CH.holo]!;
    if (holo.current) {
      holo.current.visible = ready && holoOn > 0.01 && d < 2;
      if (holo.current.visible) {
        const m = animator.mats;
        const o = hand * 12;
        // On the palm's face (−x of the left hand), a little above it.
        holo.current.position.set(
          m[o]! * -0.04 + m[o + 1]! * -0.05 + m[o + 3]!,
          m[o + 4]! * -0.04 + m[o + 5]! * -0.05 + m[o + 7]! + 0.02,
          m[o + 8]! * -0.04 + m[o + 9]! * -0.05 + m[o + 11]!,
        );
        fx.holo.material.uniforms.uHolo.value = holoOn;
      }
    }
    // The ground: shadow under the body and feet, the guardian's own light ahead of it.
    if (ground.current) {
      ground.current.visible = ready && d < 2 && !silhouette;
      const m = animator.mats;
      const u = fx.ground.material.uniforms;
      u.uFeet.value.set(m[feet[0]! * 12 + 3]!, m[feet[0]! * 12 + 11]!, m[feet[1]! * 12 + 3]!, m[feet[1]! * 12 + 11]!);
      u.uLift.value.set(m[feet[0]! * 12 + 7]! - 0.1, m[feet[1]! * 12 + 7]! - 0.1);
      u.uBody.value.set(m[pelvis * 12 + 3]!, m[pelvis * 12 + 11]!);
      u.uLight.value.set(m[core * 12 + 3]!, m[core * 12 + 11]!, m[core * 12 + 2]!, m[core * 12 + 10]!);
      u.uLight.value.w = animator.face[CH.core]! + animator.face[CH.glow]! * 0.5;
      u.uLightColor.value.setRGB(animator.face[CH.r]!, animator.face[CH.g]!, animator.face[CH.b]!, THREE.LinearSRGBColorSpace);
    }
    if (sparks.current) {
      const age = now - fx.sparks.material.uniforms.uStart.value;
      sparks.current.visible = age >= 0 && age < 2 && d < 2;
    }
  });

  /** Dust where a foot lands, sparks from the chest, a ring of light at the feet. */
  function fire(kind: ClipEventKind, now: number) {
    const m = animator.mats;
    const u = fx.ground.material.uniforms;
    if (kind === 'stomp.L' || kind === 'stomp.R') {
      const f = feet[kind === 'stomp.L' ? 0 : 1]! * 12;
      (kind === 'stomp.L' ? u.uStompL : u.uStompR).value.set(m[f + 3]!, m[f + 11]! + 0.06, now, 1);
    } else if (kind === 'sparks') {
      const o = core * 12;
      fx.sparks.material.uniforms.uOrigin.value.set(m[o + 1]! * 0.15 + m[o + 2]! * 0.12 + m[o + 3]!, m[o + 5]! * 0.15 + m[o + 6]! * 0.12 + m[o + 7]!, m[o + 9]! * 0.15 + m[o + 10]! * 0.12 + m[o + 11]!);
      fx.sparks.material.uniforms.uStart.value = now;
    } else if (kind === 'burst') {
      u.uBurst.value = now;
    }
  }

  const scale = height ? height / GUARDIAN_HEIGHT : 1;
  return (
    <group ref={home} position={position as [number, number, number]} rotation-y={rotation} scale={scale}>
      {shadow && <primitive object={shadow.contact.ground} />}
      <group ref={body}>
        {geometries.map((geometry, i) => (
          <mesh key={i} ref={(m) => void (meshes.current[i] = m)} geometry={geometry} material={material} visible={i === 1} />
        ))}
        <mesh ref={impostor} geometry={far.geometry} material={far.material} visible={false} />
        <mesh ref={ground} geometry={fx.ground.geometry} material={fx.ground.material} renderOrder={-1} />
        <mesh ref={holo} geometry={fx.holo.geometry} material={fx.holo.material} visible={false} frustumCulled={false} scale={0.85} />
        <points ref={sparks} geometry={fx.sparks.geometry} material={fx.sparks.material} visible={false} frustumCulled={false} />
      </group>
    </group>
  );
});

/** Triangles of the body built in code at each detail level (hero, standard, crowd), and of the impostor's quad. */
export function guardianTriangles(): number[] {
  return [...LEVELS.map((level) => bodyGeometry(GUARDIAN.name, GUARDIAN_BODY, level, BOUNDS).index!.count / 3), 2];
}

/** The model once it has loaded, 'failed' if it cannot be, null while it loads (or when not wanted). */
function useGuardianModel(wanted: boolean, gl: THREE.WebGLRenderer): ModelBody | 'failed' | null {
  const [model, setModel] = useState<ModelBody | 'failed' | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    loadModelBody(GUARDIAN_MODEL_URL, GUARDIAN.rig, BOUNDS, gl).then(
      (m) => live && setModel(m),
      (e: unknown) => {
        console.warn('guardian model:', e);
        if (live) setModel('failed');
      },
    );
    return () => {
      live = false;
    };
  }, [wanted, gl]);
  return wanted ? model : null;
}

/** The standing guardian rendered into the impostor atlas. */
function pictureOf(gl: THREE.WebGLRenderer, geometry: THREE.BufferGeometry, skin: BodySkin | null) {
  const sitter = new Animator(GUARDIAN, 1);
  sitter.seek('idleA', 0);
  return renderAtlas(gl, geometry, sitter, FRAME, { skin });
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function toVector(v: THREE.Vector3 | readonly [number, number, number], out: THREE.Vector3): THREE.Vector3 {
  return v instanceof THREE.Vector3 ? out.copy(v) : out.set(v[0], v[1], v[2]);
}
