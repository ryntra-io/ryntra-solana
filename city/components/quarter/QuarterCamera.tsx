'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { playRun, playTick } from '@/city/lib/audio/engine';
import { SHARED } from '@/city/lib/city/shared';
import { useCity } from '@/city/lib/city/store';
import { PALETTE } from '@/city/lib/palette';
import { aim, clampView, flightAt, flightSeconds, frontAzimuth, homeView, orbit, type Pose, type View } from '@/city/lib/quarter/camera';
import { FIRST_SLOT, SLOTS, slotAt, slotCentre, type Lot } from '@/city/lib/quarter/plot';
import { freeStore, useFree } from '@/city/lib/quarter/kit/free/store';
import { quarterStore, useQuarter } from '@/city/lib/quarter/store';
import { TERRACE_TOP } from './afar';
import { PAD_Y } from './MyQuarter';

/** The part of the city's camera controls the quarter borrows while it builds. */
type Controls = {
  enabled: boolean;
  getPosition: (out: THREE.Vector3, receiveEndValue?: boolean) => THREE.Vector3;
  getTarget: (out: THREE.Vector3, receiveEndValue?: boolean) => THREE.Vector3;
  setLookAt: (px: number, py: number, pz: number, tx: number, ty: number, tz: number, transition?: boolean) => Promise<void>;
};

/** How high the flight rises over the water between the city's view and the lot. */
const LIFT = 12;
/** A building's box for taps: a tap on a roof is a tap on its plot, not on the plot behind it. */
const BUILDING_HALF = 1.45;
const BUILDING_TOP = 3.2;

const v3 = (v: { x: number; y: number; z: number }) => ({ x: v.x, y: v.y, z: v.z });

/** The camera's pose for a view of a lot, the view's azimuth counted from the lot's front. */
function poseFor(lot: Lot, view: View, frame: { lead: number; side: number }): Pose {
  const azimuth = frontAzimuth(lot.facing) + view.azimuth;
  const target = aim(lot, azimuth, frame.lead, frame.side);
  return { position: orbit(target, { ...view, azimuth }), target };
}

/**
 * The camera of my quarter. On `arrive` it takes over from the city's controls and flies from wherever the city's
 * camera was to a view over the lot; in `build` it holds that view, turns and tilts with a drag, zooms with a
 * pinch or the wheel, and turns a tap into the plot under it. Back in the city it hands the camera back where it
 * found it. Taps on the canvas are the quarter's while it builds, so the city never picks a tower behind the lot.
 */
export function QuarterCamera({ lot }: { lot: Lot | null }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const mode = useQuarter((s) => s.mode);
  const building = mode !== 'city';

  const active = useRef(false);
  const fly = useRef<{ from: Pose; to: Pose; t0: number; ms: number } | null>(null);
  const view = useRef<View>({ azimuth: 0, pitch: 0.9, distance: 30 });
  const goal = useRef<View>({ azimuth: 0, pitch: 0.9, distance: 30 });
  const frame = useRef({ lead: 0, side: 0 });
  const back = useRef<Pose | null>(null);
  const look = useRef(new THREE.Vector3());
  const lotRef = useRef(lot);
  lotRef.current = lot;

  // Take the camera, or give it back.
  useEffect(() => {
    if (building && lot && !active.current) {
      active.current = true;
      const from: Pose = { position: v3(camera.position), target: v3(camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(40))) };
      if (controls) {
        from.target = v3(controls.getTarget(new THREE.Vector3(), false));
        back.current = { position: v3(controls.getPosition(new THREE.Vector3(), true)), target: v3(controls.getTarget(new THREE.Vector3(), true)) };
        controls.enabled = false;
      } else {
        back.current = from;
      }
      camera.up.set(0, 1, 0);
      const home = homeView(size.width, size.height);
      frame.current = { lead: home.lead, side: home.side };
      view.current = { azimuth: home.azimuth, pitch: home.pitch, distance: home.distance };
      goal.current = { ...view.current };
      const to = poseFor(lot, view.current, frame.current);
      fly.current = mode === 'arrive' ? { from, to, t0: performance.now(), ms: flightSeconds(from, to) * 1000 } : null;
      look.current.set(from.target.x, from.target.y, from.target.z);
    }
    if (!building && active.current) {
      active.current = false;
      fly.current = null;
      if (controls) {
        const l = look.current;
        void controls.setLookAt(camera.position.x, camera.position.y, camera.position.z, l.x, l.y, l.z, false);
        const b = back.current;
        if (b) void controls.setLookAt(b.position.x, b.position.y, b.position.z, b.target.x, b.target.y, b.target.z, true);
        controls.enabled = true;
      }
      useCity.getState().touch();
    }
  }, [building, mode, lot, camera, controls, size.width, size.height]);

  // Free building comes closer, a little more from above: the pieces are a third of a plot. Done steps back again.
  const free = useFree((s) => s.on);
  const before = useRef<View | null>(null);
  useEffect(() => {
    if (!active.current) return;
    if (free) {
      before.current = { ...goal.current };
      const close = size.width < size.height ? 25 : 23;
      goal.current = clampView({ ...goal.current, distance: Math.min(goal.current.distance, close), pitch: Math.max(goal.current.pitch, 0.84) });
    } else if (before.current) {
      goal.current = clampView(before.current);
      before.current = null;
    }
  }, [free, size.width, size.height]);

  // A turned phone keeps the view the person chose and frames the lot for the new shape.
  useEffect(() => {
    const home = homeView(size.width, size.height);
    frame.current = { lead: home.lead, side: home.side };
  }, [size.width, size.height]);

  useFrame((_, dt) => {
    const l = lotRef.current;
    if (!active.current || !l) return;
    // The city's controls stay down for as long as the quarter holds the camera, whatever else wakes them.
    if (controls?.enabled) controls.enabled = false;
    let pose: Pose;
    const f = fly.current;
    if (f) {
      const t = (performance.now() - f.t0) / f.ms;
      pose = flightAt(f.from, f.to, t, LIFT);
      if (t >= 1) {
        fly.current = null;
        welcome(l);
        quarterStore.getState().arrived();
      }
    } else {
      const k = 1 - Math.exp(-dt * 9);
      const v = view.current;
      const g = goal.current;
      view.current = { azimuth: v.azimuth + (g.azimuth - v.azimuth) * k, pitch: v.pitch + (g.pitch - v.pitch) * k, distance: v.distance + (g.distance - v.distance) * k };
      pose = poseFor(l, view.current, frame.current);
    }
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    look.current.set(pose.target.x, pose.target.y, pose.target.z);
    camera.lookAt(look.current);
  });

  // Gestures and taps on the canvas belong to the quarter while it builds.
  useEffect(() => {
    if (!building) return;
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pointers = new Map<number, { x: number; y: number }>();
    let tap: { x: number; y: number; t: number; moved: boolean } | null = null;
    let pinch: { d: number; distance: number } | null = null;

    const rayAt = (clientX: number, clientY: number): THREE.Ray => {
      const rect = el.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray;
    };

    /** Free building: where the piece in hand would go under this point of the screen, snapped to the grid. */
    const freeUnder = (clientX: number, clientY: number) => {
      const ray = rayAt(clientX, clientY);
      return freeStore.getState().aim(ray.origin, ray.direction, TERRACE_TOP);
    };

    const plotUnder = (clientX: number, clientY: number): number | null => {
      const l = lotRef.current;
      if (!l) return null;
      const ray = rayAt(clientX, clientY);
      // A building first: the nearest one the ray passes through.
      let best: { slot: number; t: number } | null = null;
      const hit = new THREE.Vector3();
      for (const b of quarterStore.getState().me?.buildings ?? []) {
        const c = slotCentre(l, b.slot);
        const box = new THREE.Box3(new THREE.Vector3(c.x - BUILDING_HALF, 0, c.z - BUILDING_HALF), new THREE.Vector3(c.x + BUILDING_HALF, BUILDING_TOP, c.z + BUILDING_HALF));
        if (ray.intersectBox(box, hit)) {
          const t = hit.distanceTo(ray.origin);
          if (!best || t < best.t) best = { slot: b.slot, t };
        }
      }
      if (best) return best.slot;
      if (Math.abs(ray.direction.y) < 1e-6) return null;
      const t = (PAD_Y - ray.origin.y) / ray.direction.y;
      if (t <= 0) return null;
      return slotAt(l, ray.origin.x + ray.direction.x * t, ray.origin.z + ray.direction.z * t);
    };

    const mine = (e: Event) => e.target === el;
    const down = (e: PointerEvent) => {
      if (!mine(e)) return;
      e.stopPropagation();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) tap = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), distance: goal.current.distance };
        if (tap) tap.moved = true;
      }
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers refuse capture on synthetic events.
      }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) {
        // A mouse over the lot while building freely: the piece in hand shows where it would land.
        if (e.pointerType === 'mouse' && pointers.size === 0 && freeStore.getState().on) freeStore.getState().setHover(mine(e) ? freeUnder(e.clientX, e.clientY) : null);
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y));
        goal.current = clampView({ ...goal.current, distance: (pinch.distance * pinch.d) / d });
        return;
      }
      if (tap && !tap.moved && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) tap.moved = true;
      if (!tap?.moved || fly.current) return;
      const k = 3.4 / Math.min(window.innerWidth, window.innerHeight);
      goal.current = clampView({ ...goal.current, azimuth: goal.current.azimuth - dx * k, pitch: goal.current.pitch + dy * k });
    };
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      e.stopPropagation();
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      const t = tap;
      if (pointers.size > 0) return;
      tap = null;
      if (e.type === 'pointercancel' || !t || t.moved || performance.now() - t.t > 450) return;
      const quarter = quarterStore.getState();
      if (quarter.mode !== 'build') return;
      const free = freeStore.getState();
      if (free.on) {
        const target = freeUnder(e.clientX, e.clientY);
        if (target && (target.place || target.hit) && useCity.getState().sound) playTick();
        free.tap(target);
        if (e.pointerType === 'mouse') free.setHover(freeUnder(e.clientX, e.clientY));
        return;
      }
      const slot = plotUnder(e.clientX, e.clientY);
      if (slot !== null && useCity.getState().sound) playTick();
      quarter.pick(slot);
    };
    const wheel = (e: WheelEvent) => {
      if (!mine(e)) return;
      e.preventDefault();
      e.stopPropagation();
      goal.current = clampView({ ...goal.current, distance: goal.current.distance * Math.exp(e.deltaY * 0.0012) });
    };
    // Keys: Escape goes back; with nothing else focused, Enter opens the picker and the arrows walk the plots.
    const STEP: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const key = (e: KeyboardEvent) => {
      const quarter = quarterStore.getState();
      const free = freeStore.getState();
      const focus = document.activeElement;
      const typing = !!focus && (focus.tagName === 'INPUT' || focus.tagName === 'TEXTAREA');
      if (free.on) {
        // Free building: Escape ends it, R turns the piece, Ctrl/⌘ + Z takes a step back.
        if (e.key === 'Escape') free.close();
        else if (typing) return;
        else if (e.key === 'r' || e.key === 'R') free.turn();
        else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          free.undo();
        }
        return;
      }
      if (e.key === 'Escape') {
        quarter.leave();
        return;
      }
      if (quarter.mode !== 'build' || (focus && focus !== document.body && focus !== el)) return;
      const from = quarter.slot ?? FIRST_SLOT;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        quarter.pick(from);
        return;
      }
      const step = STEP[e.key];
      const l = lotRef.current;
      if (!step || !l) return;
      e.preventDefault();
      // The neighbour as the screen shows it, whichever way the lot faces and the view is turned.
      const screen = (slot: number) => {
        const c = slotCentre(l, slot);
        return new THREE.Vector3(c.x, PAD_Y, c.z).project(camera);
      };
      const here = screen(from);
      let best: { slot: number; score: number } | null = null;
      for (let slot = 0; slot < SLOTS; slot += 1) {
        if (slot === from) continue;
        const p = screen(slot);
        const dx = p.x - here.x;
        const dy = here.y - p.y;
        const along = dx * step[0] + dy * step[1];
        if (along <= 0.01) continue;
        const score = along + Math.abs(dx * step[1] + dy * step[0]) * 2;
        if (!best || score < best.score) best = { slot, score };
      }
      if (best) quarter.pick(best.slot);
    };

    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('wheel', wheel, { capture: true, passive: false });
    window.addEventListener('keydown', key);
    // Development hook: where a plot is on the screen, for the screenshot scripts.
    if (process.env.NODE_ENV !== 'production') {
      Object.assign(window, {
        __quarterPlot: (slot: number) => {
          const l = lotRef.current;
          if (!l || slot < 0 || slot >= SLOTS) return null;
          const c = slotCentre(l, slot);
          const p = new THREE.Vector3(c.x, PAD_Y, c.z).project(camera);
          const rect = el.getBoundingClientRect();
          return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
        },
      });
    }
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('wheel', wheel, true);
      window.removeEventListener('keydown', key);
    };
  }, [building, gl, camera]);

  return null;
}

/** Arriving on the lot: a soft pulse of amber from it across the city, and two notes. */
function welcome(lot: Lot) {
  SHARED.uPulseOrigin.value.set(lot.x, lot.z);
  SHARED.uPulseTime.value = SHARED.uTime.value;
  SHARED.uPulseStrength.value = 0.6;
  SHARED.uPulseColor.value.set(PALETTE.amber);
  if (useCity.getState().sound) playRun('shield');
}
