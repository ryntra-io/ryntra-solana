'use client';

import type { CameraControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { useCity } from '@/city/lib/city/store';

type V3 = [number, number, number];

/**
 * Development only: `window.__cityView(eye, target)` puts the camera exactly there (the graphics close-ups,
 * `skyline-shots.mjs`), lifting the controls' limits so a shot can stand on the street or over the water, and stops
 * the attract orbit. `window.__cityView(null)` gives the camera back. The visitor's controls never change.
 */
export function DevView() {
  const controls = useThree((s) => s.controls) as unknown as CameraControls | null;
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    Object.assign(window, { __scene: scene, __camera: camera });
  }, [scene, camera]);
  useEffect(() => {
    if (!controls) return;
    const limits = { minDistance: controls.minDistance, maxPolarAngle: controls.maxPolarAngle, minPolarAngle: controls.minPolarAngle };
    const view = (eye: V3 | null, target?: V3) => {
      if (!eye || !target) {
        Object.assign(controls, limits);
        useCity.setState({ touchedAt: 0 });
        return;
      }
      controls.minDistance = 0.5;
      controls.minPolarAngle = 0.05;
      controls.maxPolarAngle = Math.PI * 0.72;
      useCity.setState({ touchedAt: Date.now() + 1e9 });
      void controls.setLookAt(...eye, ...target, false);
    };
    Object.assign(window, { __cityView: view });
    return () => {
      delete (window as { __cityView?: unknown }).__cityView;
    };
  }, [controls]);
  return null;
}
