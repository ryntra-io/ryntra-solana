'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { markDrawn } from '@/city/lib/city/drawn';

/** However the compile goes, the city starts drawing after this long. */
const WARMUP_MS = 4000;

/**
 * Compiles the city's shaders before its first frame (CITY-6a). With `KHR_parallel_shader_compile` (most phones and
 * desks) the browser compiles them in parallel off the page's thread, which stays free for the visitor's first taps,
 * instead of one long frozen first frame. The programs are built for a render target, as the post-processing composer
 * draws the scene, so the first real frame finds them ready. `onReady` starts the frame loop; after `WARMUP_MS` it
 * starts anyway, and a browser without the extension starts it at once.
 */
export function Warmup({ onReady }: { onReady: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let done = false;
    const ready = () => {
      if (done) return;
      done = true;
      onReady();
    };
    // Without the extension a compile blocks the page either way: the first frame compiles, as it always did.
    if (!gl.extensions.has('KHR_parallel_shader_compile')) {
      ready();
      return;
    }
    const timer = setTimeout(ready, WARMUP_MS);
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const before = gl.getRenderTarget();
    try {
      gl.setRenderTarget(target);
      // The programs are created now, for this target; the promise says when they are linked.
      void gl
        .compileAsync(scene, camera)
        .catch(() => {})
        .finally(ready);
    } catch {
      ready();
    } finally {
      gl.setRenderTarget(before);
    }
    return () => {
      clearTimeout(timer);
      target.dispose();
    };
    // Once, with the scene as it first mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // After the composer (priority 1) has drawn: the frame is on the screen.
  useFrame(markDrawn, 2);
  return null;
}
