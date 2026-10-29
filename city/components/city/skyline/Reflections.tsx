'use client';

import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CityLayout } from '@/city/lib/city/layout';
import { useCity } from '@/city/lib/city/store';
import type { Skyline } from './build';
import { LIGHT } from './light';
import { useSkyline } from './store';

/** The capture waits for a quiet moment this long after the city changes shape. */
const CAPTURE_AFTER_MS = 2500;
/**
 * The first capture comes almost at once: the canvas is still held out (`store.ts`), and the city fades in with its
 * reflection already in the glass and the water, so nothing changes a moment after it appears.
 */
const FIRST_CAPTURE_MS = 150;
/** However often the market redraws the city, the cube is drawn again at most this often. */
const RECAPTURE_MS = 5 * 60_000;

/** The city's shape: which towers stand where, coarsely, so a live read that moves nothing draws nothing again. */
const shapeOf = (layout: CityLayout) =>
  layout.towers.map((t) => `${t.tower.id}:${Math.round(t.x)}:${Math.round(t.z)}:${Math.round(t.height / 4)}`).join('|');

/**
 * The city's reflection (CITY-56): a cube drawn from inside the skyline once it stands, and again when the city
 * changes shape (at most every five minutes), which every glass, metal and water surface samples through a sphere
 * round the island (`light.ts`), so a facade reflects the sky, the moon and its neighbours' lit windows. While the
 * cube is drawn the materials reflect the analytic sky (no surface samples the cube it is drawn into) and every tower
 * stands at its far level. size 0 (the Lite tier) keeps the analytic sky only. Half-float, so a lit window stays
 * brighter than white in it.
 */
export function Reflections({ skyline, size }: { skyline: Skyline; size: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const shape = useCity((s) => shapeOf(s.layout));
  const current = useRef(skyline);
  current.current = skyline;
  const last = useRef({ at: 0, shape: '' });

  // One cube per tier size; the city keeps reflecting it until the tier changes or the skyline leaves.
  const target = useMemo(
    () => (size ? new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter }) : null),
    [size],
  );
  useEffect(() => {
    last.current = { at: 0, shape: '' };
    if (!target) {
      LIGHT.uEnvOn.value = 0;
      // No reflection on this tier: the city is lit as it will stay.
      useSkyline.getState().setLit(true);
    }
    return () => {
      if (target && LIGHT.uEnv.value === target.texture) {
        LIGHT.uEnv.value = null;
        LIGHT.uEnvOn.value = 0;
      }
      target?.dispose();
    };
  }, [target]);

  useEffect(() => {
    if (!target || last.current.shape === shape) return;
    const camera = new THREE.CubeCamera(1, 1600, target);
    camera.position.copy(LIGHT.uEnvPos.value);
    const capture = () => {
      const sk = current.current;
      LIGHT.uEnvOn.value = 0;
      LIGHT.uEnv.value = null;
      sk.force(2);
      camera.update(gl, scene);
      sk.force(null);
      LIGHT.uEnv.value = target.texture;
      LIGHT.uEnvTexels.value = target.width / (Math.PI / 2);
      LIGHT.uEnvOn.value = 1;
      last.current = { at: Date.now(), shape };
      useSkyline.getState().setLit(true);
    };
    const idle = (cb: () => void) =>
      typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 2000 }) : window.setTimeout(cb, 0);
    let handle = 0;
    const wait = last.current.at
      ? Math.max(CAPTURE_AFTER_MS, last.current.at + RECAPTURE_MS - Date.now())
      : useSkyline.getState().lit
        ? CAPTURE_AFTER_MS
        : FIRST_CAPTURE_MS;
    const timer = window.setTimeout(() => {
      handle = idle(capture) as number;
    }, wait);
    return () => {
      window.clearTimeout(timer);
      if (handle && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
    };
  }, [gl, scene, target, shape]);
  return null;
}
