'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { pickTower } from '@/city/lib/city/pick';
import { useCity } from '@/city/lib/city/store';
import { signUnder } from '@/city/lib/launch/hall-tap';
import { useMoments } from '@/city/lib/moments/stage';
import { lotOf, PLOT, slotCentre, type Lot } from '@/city/lib/quarter/plot';
import { quarterStore } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { TERRACE_TOP } from '../quarter/Arrivals';
import { heightOf } from '../quarter/QuarterBuilding';
import { liftedHeight } from '../quarter/afar';
import { moveHover, setHover, type HoverTarget } from './hover';

/** At most this often a moving mouse asks what is under it. */
const PICK_MS = 50;
/** While the mouse rests, the camera may still move (the attract orbit, a flight): asked again this often. */
const REST_MS = 300;
const HALF = (PLOT / 2) * 0.95;

/**
 * The name under the mouse (desktop, fine pointer only): the tower or the quarter building the cursor is on goes to
 * the hover store, and the cursor becomes a pointer over it. A ray is cast only when the mouse moves (throttled) or the
 * camera moved while it rests; the objects are made once. Touch screens never get here: a tap selects as before.
 */
export function HoverPick() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const box = new THREE.Box3();
    const hitPoint = new THREE.Vector3();
    const lastEye = new THREE.Vector3(Infinity, 0, 0);
    const lastLook = new THREE.Quaternion();
    let lot: { key: string; lot: Lot } | null = null;
    let inside = false;
    let pressed = false;
    let x = 0;
    let y = 0;
    let lastPick = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const quiet = () => useRun.getState().phase !== 'off' || quarterStore.getState().mode !== 'city' || useMoments.getState().filming !== null;
    const show = (target: HoverTarget) => {
      setHover(target);
      el.style.cursor = target ? 'pointer' : '';
    };

    const lotNow = (): Lot | null => {
      const me = quarterStore.getState().me;
      if (!me?.buildings.length) return null;
      const key = `${me.quarter.cell.x}:${me.quarter.cell.z}`;
      if (lot?.key !== key) lot = { key, lot: lotOf(me.quarter.cell) };
      return lot.lot;
    };

    const pick = () => {
      timer = null;
      lastPick = performance.now();
      if (!inside || pressed || quiet()) {
        show(null);
        return;
      }
      lastEye.copy(camera.position);
      lastLook.copy(camera.quaternion);
      const rect = el.getBoundingClientRect();
      ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const ray = raycaster.ray;
      const placed = pickTower(ray, useCity.getState().layout.towers);
      // A Hall of Fame sign nearer than the tower behind it: a tap there is its board's action, so the cursor says so.
      const sign = signUnder(ray);
      if (sign && (!placed || sign.distance < Math.hypot(placed.x - ray.origin.x, placed.z - ray.origin.z))) {
        setHover(null);
        el.style.cursor = 'pointer';
        return;
      }
      let target: HoverTarget = placed ? { kind: 'tower', id: placed.tower.id } : null;
      // A building of my quarter wins when it stands nearer than the tower behind it.
      const l = lotNow();
      if (l) {
        let near = placed ? Math.hypot(placed.x - ray.origin.x, placed.z - ray.origin.z) : Infinity;
        for (const b of quarterStore.getState().me?.buildings ?? []) {
          const c = slotCentre(l, b.slot);
          box.min.set(c.x - HALF, 0, c.z - HALF);
          box.max.set(c.x + HALF, TERRACE_TOP + liftedHeight(heightOf(b.kind, b.level, b.modules)), c.z + HALF);
          if (!ray.intersectBox(box, hitPoint)) continue;
          const d = Math.hypot(hitPoint.x - ray.origin.x, hitPoint.z - ray.origin.z);
          if (d < near) {
            near = d;
            target = { kind: 'building', slot: b.slot };
          }
        }
      }
      show(target);
    };

    const schedule = () => {
      if (timer) return;
      timer = setTimeout(pick, Math.max(0, PICK_MS - (performance.now() - lastPick)));
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      inside = true;
      x = e.clientX;
      y = e.clientY;
      pressed = e.buttons !== 0;
      moveHover(x, y);
      schedule();
    };
    const onLeave = () => {
      inside = false;
      show(null);
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      pressed = true;
      show(null);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      pressed = false;
      schedule();
    };
    // The camera moved under a resting mouse: what is under it may have changed.
    const rest = setInterval(() => {
      if (!inside || pressed || timer) return;
      if (camera.position.distanceToSquared(lastEye) > 0.01 || Math.abs(camera.quaternion.dot(lastLook)) < 0.99999) schedule();
    }, REST_MS);

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      clearInterval(rest);
      if (timer) clearTimeout(timer);
      show(null);
    };
  }, [gl, camera]);
  return null;
}
