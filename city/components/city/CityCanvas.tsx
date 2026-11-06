'use client';

import { PerformanceMonitor } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { dprAt, LADDER, meanFps, move, rangeFor, startMoves, stepDown, stepUp, type Device } from '@/city/lib/city/quality';
import { watchContext } from '@/city/lib/city/context-loss';
import { useCity } from '@/city/lib/city/store';
import { leanIn } from '@/city/lib/window/layout';
import { settledLayout, useWindows } from '@/city/lib/window/store';
import { CityScene } from './CityScene';
import { useSkyline } from './skyline/store';
import { Pacer } from './Pacer';
import { Warmup } from './Warmup';

/**
 * The canvas is held out while the skyline kit loads and fades in once the city stands in its final form. A kit this late after
 * the first frame gives way to the procedural towers.
 */
const KIT_WAIT_MS = 12_000;
const REVEAL_MS = 900;

/** What this device says about itself; the canvas mounts on the client only, so the browser is there. */
/** The city is behind windows on a computer (CITY-84): drawn lean. */
const leanNow = () => useWindows.getState().desk && leanIn(settledLayout(useWindows.getState()));

function readDevice(): Device {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return {
    coarse: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    cores: nav.hardwareConcurrency || undefined,
    memory: nav.deviceMemory,
    dpr: window.devicePixelRatio || 1,
    saveData: nav.connection?.saveData,
  };
}

/**
 * The canvas and its budget (CITY-6a): one ladder of quality rungs (`city/lib/city/quality.ts`). A phone starts at
 * mid × 1.25, a desk at the top; the measured frame rate moves the city a rung at a time — the pixel ratio (the
 * composer renders at the canvas's size), then bloom, particles, traffic and the full-screen touches.
 * `?quality=high|mid|low` pins the start for a test. The frame loop starts once the shaders are compiled (`Warmup`) and
 * leaves the page's thread a breath after a heavy frame, so a tap is answered (`Pacer`).
 * WebGL2 for every phone in 2026; WebGPU later.
 *
 * Behind windows (CITY-84, helm §4) — both bays taken, or one window on the whole screen — the city is drawn lean: at
 * a pixel ratio of 1 and half as often (`Pacer`), and the frame rate it then shows moves no rung.
 */
export function CityCanvas() {
  const [device] = useState(() => {
    const d = readDevice();
    const range = rangeFor(d, new URLSearchParams(window.location.search).get('quality'));
    // The scene's first build already has this device's budget: no rebuild a moment after the first frame.
    useCity.setState({ quality: LADDER[range.start]!.quality });
    return { screen: d.dpr, range };
  });
  const [rung, setRung] = useState(device.range.start);
  // Every move of the rung goes through `move`: a climb at the top is no move, and rocking settles on the cheaper rung.
  const moves = useRef(startMoves(device.range.start));
  const lean = useWindows((st) => st.desk && leanIn(settledLayout(st)));
  const go = (next: (rung: number) => number) => {
    // Drawn lean on purpose behind windows: its frame rate says nothing about the device.
    if (leanNow()) return;
    moves.current = move(moves.current, next(moves.current.rung));
    setRung(moves.current.rung);
  };
  // The frame loop waits for the shaders: compiled in parallel, then the first frame draws without a long freeze.
  const [warm, setWarm] = useState(false);
  // A lost WebGL context (CITY-200): the night colour holds, and a fresh canvas comes back when the browser allows.
  const [generation, setGeneration] = useState(0);
  const unwatch = useRef<(() => void) | null>(null);
  useEffect(() => () => unwatch.current?.(), []);
  // The city appears once: with the kit's towers and their reflection, or with the fallback when the kit cannot come.
  const shown = useSkyline((s) => (s.ready && s.lit) || s.fallback);
  useEffect(() => {
    if (!warm) return;
    const timer = setTimeout(() => {
      if (!useSkyline.getState().ready) useSkyline.getState().setFallback(true);
    }, KIT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [warm]);
  const quality = LADDER[rung]!.quality;
  const dpr = lean ? Math.min(1, dprAt(rung, device.screen)) : dprAt(rung, device.screen);

  useEffect(() => {
    useCity.getState().setQuality(quality);
    // Readable on the page's root in the release too: the quality pass (scripts/city/quality.mjs) reports it.
    const root = document.documentElement.dataset;
    root.cityQuality = quality;
    root.cityDpr = String(dpr);
  }, [quality, dpr]);

  return (
    <Canvas
      key={generation}
      dpr={dpr}
      // The city drives its own frames (`Pacer`), once the shaders are ready (`Warmup`).
      frameloop="never"
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false }}
      camera={{ fov: 40, near: 0.5, far: 2400, position: [0, 44, 182] }}
      onCreated={({ gl }) => {
        gl.setClearColor(new THREE.Color('#06050C'));
        unwatch.current?.();
        unwatch.current = watchContext(gl.domElement, () => setWarm(false), () => setGeneration((g) => g + 1));
        // Checking every shader's log forces the browser to finish compiling at once; production skips it.
        gl.debug.checkShaderErrors = process.env.NODE_ENV !== 'production';
        // Development hook: lets the profiling scripts list compiled programs.
        if (process.env.NODE_ENV !== 'production') Object.assign(window, { __gl: gl });
      }}
      style={{ position: 'fixed', inset: 0, touchAction: 'none', background: '#06050C', opacity: shown ? 1 : 0, transition: `opacity ${REVEAL_MS}ms ease-out` }}
    >
      <PerformanceMonitor
        // A new monitor each time the city goes lean or comes back: frames drawn lean never weigh on a verdict after.
        key={lean ? 'lean' : 'full'}
        bounds={(refresh) => (refresh > 90 ? [50, 80] : [38, 56])}
        // The verdict's mean frame rate decides a collapse (two rungs), never its last sample alone.
        onDecline={({ averages }) => go((r) => stepDown(r, device.screen, meanFps(averages)))}
        onIncline={() => go((r) => stepUp(r, device.range.top, device.screen))}
      />
      <CityScene />
      <Warmup onReady={() => setWarm(true)} />
      <Pacer on={warm} lean={lean} />
    </Canvas>
  );
}
