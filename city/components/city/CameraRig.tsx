'use client';

import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { cityDrawn } from '@/city/lib/city/drawn';
import { Press, twist, TWIST_MIN_SPAN, type Point } from '@/city/lib/city/gesture';
import type { PlacedTower } from '@/city/lib/city/layout';
import { pickTower } from '@/city/lib/city/pick';
import { useAssistant } from '@/city/lib/assistant/store';
import { useCity } from '@/city/lib/city/store';
import { useGameMap } from '@/city/lib/game/map';
import { useRun } from '@/city/lib/run/store';

type Preset = { pos: [number, number, number]; target: [number, number, number]; fov: number };

/** Landscape: the whole skyline with the Sol Spire rising into the Eclipse. Portrait: low and close, looking up. */
const LANDSCAPE: Preset = { pos: [0, 38, 172], target: [0, 25, 0], fov: 40 };
const PORTRAIT: Preset = { pos: [0, 20, 128], target: [0, 31, 0], fov: 58 };
const IDLE_MS = 12_000;
const TOUCHES = {
  one: CameraControlsImpl.ACTION.TOUCH_ROTATE,
  two: CameraControlsImpl.ACTION.TOUCH_DOLLY_ROTATE,
  three: CameraControlsImpl.ACTION.NONE,
};
/** A tour through an answer's towers: how long each holds, and how much wider than a tower's own card shot. */
const TOUR_STEP_MS = 2400;
const TOUR_WIDE = 1.35;
/** On the landscape title screen the city sits right of centre, leaving the left third to the words. */
const INTRO_SHIFT = 0.17;
/** How far the city slides from under Ryntra's panel: left on a desk, up on a phone, where the sheet covers its lower half. */
const ASSISTANT_SHIFT = 0.12;
const ASSISTANT_LIFT = 0.16;
/** A tower framed for a window, on a phone: into the strip of city between the top bar and the sheet (CITY-168). */
const SHEET_LIFT = 0.25;
/** Up to this width a screen held upright shows Ryntra's panel as a sheet at the bottom (assistant.module.css). */
const SHEET_MAX_WIDTH = 560;

/**
 * The director: attract orbit when nobody touches the city, a flight to the tower you tap, a return to the
 * establishing shot when the card closes, and trauma shake (applied to the world group, never fighting the controls).
 */
export function CameraRig({ world }: { world: RefObject<THREE.Group | null> }) {
  const controls = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const portrait = size.width < size.height;
  const preset = portrait ? PORTRAIT : LANDSCAPE;
  const selectedId = useCity((s) => s.selectedId);
  const layout = useCity((s) => s.layout);
  const homeAt = useCity((s) => s.homeAt);
  const base = useRef({ azimuth: 0, polar: 0 });
  const running = useRun((s) => s.phase !== 'off');

  // Establishing shot for this aspect.
  useEffect(() => {
    camera.fov = preset.fov;
    camera.updateProjectionMatrix();
    const c = controls.current;
    if (!c) return;
    void c.setLookAt(...preset.pos, ...preset.target, false).then(() => {
      base.current = { azimuth: c.azimuthAngle, polar: c.polarAngle };
    });
    base.current = { azimuth: c.azimuthAngle, polar: c.polarAngle };
  }, [camera, preset]);

  // Fly to the selected tower; with none, through the towers Ryntra's answer is about (CITY-10) — each in turn, then
  // all of them in one frame; else back to the establishing shot (also when the logo asks for it with nothing picked).
  // A tour plays once per answer: the market's refresh every minute rebuilds the layout but never restarts it.
  const shown = useAssistant((s) => s.shown);
  const focusAt = useAssistant((s) => s.focusAt);
  // The Play layer's Map (CITY-81): a district or a mover framed, with nothing picked.
  const view = useGameMap((s) => s.view);
  const viewed = useRef(0);
  const toured = useRef(0);
  const tourTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(tourTimer.current), []);
  useEffect(() => {
    const c = controls.current;
    if (!c || useRun.getState().phase !== 'off') return;
    const t = layout.towers.find((p) => p.tower.id === selectedId);
    const answer = t ? [] : shown.map((s) => layout.towers.find((p) => p.tower.id === s.id)).filter((p): p is PlacedTower => !!p);
    if (answer.length && toured.current === focusAt) return;
    window.clearTimeout(tourTimer.current);
    if (t) {
      void c.setLookAt(...towerShot(t, layout.towers, camera.position, portrait), true);
      return;
    }
    const framed = answer.length || !view ? [] : view.ids.map((id) => layout.towers.find((p) => p.tower.id === id)).filter((p): p is PlacedTower => !!p);
    if (framed.length) {
      // Flown once per tap: the market's refresh every minute leaves the camera where the hand put it since.
      if (viewed.current === view!.at) return;
      viewed.current = view!.at;
      void c.setLookAt(...(framed.length === 1 ? towerShot(framed[0]!, layout.towers, camera.position, portrait, TOUR_WIDE) : groupShot(framed, camera.position, portrait)), true);
      return;
    }
    if (!answer.length) {
      void c.setLookAt(...preset.pos, ...preset.target, true);
      return;
    }
    toured.current = focusAt;
    const tour = answer.length === 1 ? [towerShot(answer[0]!, layout.towers, camera.position, portrait, TOUR_WIDE)] : [...answer.map((p) => towerShot(p, layout.towers, camera.position, portrait, TOUR_WIDE)), groupShot(answer, camera.position, portrait)];
    const touched = useCity.getState().touchedAt;
    let step = 0;
    const next = () => {
      // A hand on the camera, a picked tower or a run ends the tour where it is.
      const city = useCity.getState();
      if (city.touchedAt !== touched || city.selectedId || useRun.getState().phase !== 'off') return;
      void c.setLookAt(...tour[step]!, true);
      step++;
      if (step < tour.length) tourTimer.current = window.setTimeout(next, TOUR_STEP_MS);
    };
    next();
  }, [selectedId, layout, camera, preset, portrait, homeAt, shown, focusAt, view]);

  // A run owns the camera. When it ends, the controls pick up from wherever the run left the camera
  // and glide back to the establishing shot.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (running) {
      c.enabled = false;
      camera.clearViewOffset();
      return;
    }
    if (c.enabled) return;
    const ahead = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(40));
    camera.up.set(0, 1, 0);
    camera.fov = preset.fov;
    camera.updateProjectionMatrix();
    void c.setLookAt(camera.position.x, camera.position.y, camera.position.z, ahead.x, ahead.y, ahead.z, false).then(() => {
      void c.setLookAt(...preset.pos, ...preset.target, true);
    });
    c.enabled = true;
  }, [running, camera, preset]);

  // Tap to pick a tower: one short press that did not drag. Two fingers are a gesture, never a tap (CITY-6a): the
  // controls pinch to zoom and drag to rotate, and a twist of the two fingers turns the city like a map.
  useEffect(() => {
    const el = gl.domElement;
    const press = new Press();
    const fingers = new Map<number, Point>();
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const onDown = (e: PointerEvent) => {
      // The first finger of a new touch: a finger lifted off the canvas last time is never seen here, so forget it.
      if (e.isPrimary) {
        press.reset();
        fingers.clear();
      }
      press.down(e.pointerId, { x: e.clientX, y: e.clientY }, performance.now());
      if (e.pointerType === 'touch') fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      useCity.getState().touch();
    };
    const onMove = (e: PointerEvent) => {
      const before = fingers.get(e.pointerId);
      if (!before) return;
      const now = { x: e.clientX, y: e.clientY };
      const other = [...fingers].find(([id]) => id !== e.pointerId)?.[1];
      fingers.set(e.pointerId, now);
      const c = controls.current;
      if (fingers.size !== 2 || !other || !c?.enabled || Math.hypot(now.x - other.x, now.y - other.y) < TWIST_MIN_SPAN) return;
      // Clockwise on the screen turns the city clockwise under the fingers: the camera's azimuth grows.
      const turn = twist(other, before, other, now);
      if (Math.abs(turn) > 0.002) void c.rotate(turn, 0, false);
    };
    const onUp = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      const tap = press.up(e.pointerId, { x: e.clientX, y: e.clientY }, performance.now());
      // Nothing to pick before the city is on the screen.
      if (!tap || !cityDrawn() || useRun.getState().phase !== 'off') return;
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const state = useCity.getState();
      const hit = pickTower(raycaster.ray, state.layout.towers);
      state.select(hit ? hit.tower.id : null);
    };
    const onCancel = (e: PointerEvent) => {
      fingers.delete(e.pointerId);
      press.cancel(e.pointerId);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
    };
  }, [gl, camera]);

  const shakeSeed = useRef(Math.random() * 100);
  const shift = useRef(portrait ? 0 : INTRO_SHIFT);
  const lift = useRef(0);
  useFrame(({ clock }, dt) => {
    const c = controls.current;
    const state = useCity.getState();
    const g = world.current;
    if (useRun.getState().phase !== 'off') {
      // The run drives the camera; only the trauma shake stays here.
      if (g) shakeWorld(g, state.trauma, clock.elapsedTime, dt);
      return;
    }
    // Title-screen framing slides back to centre once the visitor enters.
    // On a desk Ryntra's panel stands on the right, so the city steps left of it while the panel is open (CITY-10).
    const open = useAssistant.getState().open;
    const sheet = portrait && size.width <= SHEET_MAX_WIDTH;
    const goal = !state.entered && !portrait ? INTRO_SHIFT : open && !sheet ? -ASSISTANT_SHIFT : 0;
    shift.current += (goal - shift.current) * Math.min(1, dt * 2.2);
    // A phone held upright with Ryntra's sheet open: the city slides up into the sky above the sheet (CITY-10).
    const liftGoal = !sheet ? 0 : open ? ASSISTANT_LIFT : useGameMap.getState().view?.aboveSheet ? SHEET_LIFT : 0;
    lift.current += (liftGoal - lift.current) * Math.min(1, dt * 2.2);
    if (Math.abs(shift.current) > 0.001 || Math.abs(lift.current) > 0.001) camera.setViewOffset(size.width, size.height, -size.width * shift.current, size.height * lift.current, size.width, size.height);
    else if (camera.view?.enabled) camera.clearViewOffset();
    // Attract orbit: a slow sway around the establishing shot while idle — never while an answer or the Map's view is on the screen.
    if (c && !state.selectedId && !useAssistant.getState().shown.length && !useGameMap.getState().view && Date.now() - state.touchedAt > IDLE_MS && !c.active) {
      const t = clock.elapsedTime;
      const az = base.current.azimuth + Math.sin(t * 0.055) * 0.22;
      const polar = base.current.polar + Math.sin(t * 0.037) * 0.04;
      void c.rotateTo(THREE.MathUtils.lerp(c.azimuthAngle, az, Math.min(1, dt * 0.6)), THREE.MathUtils.lerp(c.polarAngle, polar, Math.min(1, dt * 0.6)), false);
    }
    if (g) shakeWorld(g, state.trauma, clock.elapsedTime, dt);
  });

  // Trauma shake: offset the world, squared so small knocks stay small.
  function shakeWorld(g: THREE.Group, trauma: number, time: number, dt: number) {
    const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const shake = trauma * trauma * (calm ? 0.15 : 1);
    const t = time * 28 + shakeSeed.current;
    g.position.set(Math.sin(t * 1.1) * shake * 1.4, Math.sin(t * 1.7 + 2) * shake * 1.0, Math.sin(t * 1.3 + 5) * shake * 1.4);
    if (trauma > 0) useCity.setState({ trauma: Math.max(0, trauma - dt * 1.3) });
  }

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={16}
      maxDistance={300}
      minPolarAngle={0.25}
      maxPolarAngle={1.42}
      smoothTime={0.6}
      draggingSmoothTime={0.18}
      dollySpeed={0.6}
      // One finger orbits; two pinch to zoom and drag to rotate (the twist is ours, above); three do nothing.
      touches={TOUCHES}
      onStart={() => useCity.getState().touch()}
    />
  );
}

type Shot = [number, number, number, number, number, number];

/** One tower filling the frame from where the camera stands, risen above any roof between them. */
function towerShot(t: PlacedTower, towers: readonly PlacedTower[], from3: THREE.Vector3, portrait: boolean, wide = 1): Shot {
  const from = new THREE.Vector3(from3.x - t.x, 0, from3.z - t.z);
  if (from.lengthSq() < 1) from.set(0, 0, 1);
  from.normalize();
  const distance = Math.max(30, t.height * 0.95 + 22) * (portrait ? 1.15 : 1) * wide;
  const eye = new THREE.Vector3(t.x, 0, t.z).addScaledVector(from, distance);
  const lookY = t.height * 0.62;
  // A short tower in a dense district hides behind its neighbours: rise until the line of sight clears every roof
  // between the camera and the tower, never steeper than a look down from above.
  let eyeY = t.height * 0.45 + 12;
  for (const o of towers) {
    if (o === t) continue;
    const dx = o.x - t.x;
    const dz = o.z - t.z;
    const along = dx * from.x + dz * from.z;
    if (along <= 0 || along >= distance) continue;
    if (Math.abs(dx * from.z - dz * from.x) > o.width * 0.75 + t.width * 0.5) continue;
    eyeY = Math.max(eyeY, lookY + ((o.height + 4 - lookY) * distance) / along);
  }
  eye.y = Math.min(eyeY, t.height + distance * 1.4);
  return [eye.x, eye.y, eye.z, t.x, lookY, t.z];
}

/** Several towers in one frame: from the camera's side, far enough that every one of them and its light stands in it. */
function groupShot(towers: readonly PlacedTower[], from3: THREE.Vector3, portrait: boolean): Shot {
  const cx = towers.reduce((sum, t) => sum + t.x, 0) / towers.length;
  const cz = towers.reduce((sum, t) => sum + t.z, 0) / towers.length;
  const spread = Math.max(...towers.map((t) => Math.hypot(t.x - cx, t.z - cz) + t.width));
  const top = Math.max(...towers.map((t) => t.height));
  const from = new THREE.Vector3(from3.x - cx, 0, from3.z - cz);
  if (from.lengthSq() < 1) from.set(0, 0, 1);
  from.normalize();
  const distance = Math.max(64, spread * 2.5 + top * 0.8) * (portrait ? 1.4 : 1);
  const eye = new THREE.Vector3(cx, 0, cz).addScaledVector(from, distance);
  // Low enough that the light columns stand up out of the skyline, high enough to see over the nearer roofs.
  eye.y = top * 0.55 + distance * 0.24;
  return [eye.x, eye.y, eye.z, cx, top * 0.55, cz];
}
