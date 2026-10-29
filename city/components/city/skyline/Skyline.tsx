'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PlacedTower } from '@/city/lib/city/layout';
import { cityDrawn } from '@/city/lib/city/drawn';
import { BUDGET } from '@/city/lib/city/quality';
import { useCity } from '@/city/lib/city/store';
import { buildSkyline, type Skyline as SkylineBuild } from './build';
import { loadKit, type Kit } from './kit';
import { LIGHT } from './light';
import { Reflections } from './Reflections';
import type { TowerState } from './state';
import { useSkyline } from './store';

/**
 * The kit waits for the city's first frame on the screen (`cityDrawn`, CITY-6a), then this long and an idle moment.
 * Since 28.10 the canvas is held out until the kit stands (`store.ts`), so nothing waits for it: it loads at once.
 */
const LOAD_AFTER_MS = 0;
const DRAWN_POLL_MS = 250;

/** The kit, once per page (the street and the low-rise blocks use it too). */
export function useKit(): Kit | null {
  const gl = useThree((s) => s.gl);
  const [kit, setKit] = useState<Kit | null>(null);
  useEffect(() => {
    let alive = true;
    let idle = 0;
    const load = () =>
      loadKit()
        .then((k) => {
          // The atlases go to the GPU (and grow their mipmaps) now, not in the frame the kit's towers first stand.
          for (const t of [k.rooms, k.people, ...Object.values(k.detail)]) gl.initTexture(t);
          // The Blender detail tiles, shared by every material that reads the city's light.
          LIGHT.uConcrete.value = k.detail.concrete;
          LIGHT.uMetal.value = k.detail.metal;
          LIGHT.uAsphalt.value = k.detail.asphalt;
          LIGHT.uSmudge.value = k.detail.glass;
          LIGHT.uDetailOn.value = 1;
          if (alive) setKit(k);
        })
        .catch((error) => {
          console.warn('city kit: not loaded, the procedural towers stay', error);
          useSkyline.getState().setFallback(true);
        });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      timer = setTimeout(() => {
        if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(load, { timeout: 2000 });
        else load();
      }, LOAD_AFTER_MS);
    };
    const poll = setInterval(() => {
      if (!cityDrawn()) return;
      clearInterval(poll);
      later();
    }, DRAWN_POLL_MS);
    return () => {
      alive = false;
      clearInterval(poll);
      clearTimeout(timer);
      if (idle && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
    };
  }, [gl]);
  return kit;
}

/**
 * The skyline of Ryntra City built from the Blender kit (CITY-56). Until the kit arrives the procedural towers stand;
 * once its shaders are compiled (in parallel, off the page's thread where the browser can) the kit's towers take
 * their place. When the market redraws the city (every live read) the new skyline is built and compiled behind the
 * one on the screen and replaces it in one frame, so nothing flickers. Taps, signs, crowns and moments are untouched:
 * they live on the layout, not on this geometry.
 */
export function Skyline({ towers, state }: { towers: PlacedTower[]; state: TowerState }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const quality = useCity((s) => s.quality);
  const budget = BUDGET[quality];
  const kit = useKit();
  const built = useMemo(() => {
    if (!kit || !towers.length) return null;
    const next = buildSkyline(kit, towers);
    next.material.uniforms.uTowers!.value = state.texture;
    next.material.uniforms.uRooms!.value = kit.rooms;
    return next;
  }, [kit, towers, state]);
  // The skyline on the screen: the last one whose shaders are ready.
  const [shown, setShown] = useState<SkylineBuild | null>(null);
  const shownRef = useRef<SkylineBuild | null>(null);
  shownRef.current = shown;
  const setReady = useSkyline((s) => s.setReady);

  // Compile for the composer's target (a half-float buffer), then show; the old towers step aside in the same frame.
  useEffect(() => {
    if (!built) return;
    let alive = true;
    built.update(camera, size.height, budget);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const before = gl.getRenderTarget();
    gl.setRenderTarget(target);
    const done = () => {
      if (alive) setShown(built);
    };
    try {
      void gl.compileAsync(built.group, camera, scene).then(done, done);
    } catch {
      done();
    } finally {
      gl.setRenderTarget(before);
    }
    return () => {
      alive = false;
      target.dispose();
      // Replaced before it was ever shown: nothing else will free it.
      if (shownRef.current !== built) built.dispose();
    };
    // The camera and budget at the moment of building; later frames follow them in useFrame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, gl, scene]);
  // A replaced skyline is freed once its successor is on the screen.
  useEffect(() => {
    if (!shown) return;
    shown.restore();
    return () => shown.dispose();
  }, [shown]);
  useEffect(() => setReady(!!shown), [shown, setReady]);
  useEffect(() => () => setReady(false), [setReady]);

  useFrame(() => {
    if (!shown) return;
    shown.update(camera, size.height, budget);
    shown.material.uniforms.uInterior!.value = budget.rooms ? 1 : 0;
    state.flush();
  });

  // Development hook: the graphics pass reads what the skyline spends.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || !shown || !kit) return;
    Object.assign(window, { __skyline: { ready: true, quality, stats: shown.stats, kit: kit.bytes, plans: shown.plans } });
    return () => {
      delete (window as { __skyline?: unknown }).__skyline;
    };
  }, [shown, kit, quality]);

  if (!shown) return null;
  return (
    <>
      <primitive object={shown.group} />
      <Reflections skyline={shown} size={budget.reflections} />
    </>
  );
}
