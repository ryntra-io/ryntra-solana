'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { arrivalStreets, arrivalsStore, useArrivals } from '@/city/lib/quarter/district';
import { KitWorld } from '@/city/lib/quarter/kit';
import { lotOf } from '@/city/lib/quarter/plot';
import { quarterStore, useQuarter } from '@/city/lib/quarter/store';
import type { Cell } from '@/city/lib/quarter/types';
import { AFAR } from './afar';
import { Arrivals } from './Arrivals';
import { FreeLayout } from './kit/free/FreeLayout';
import { AwayCamera } from './AwayCamera';
import { MyQuarter } from './MyQuarter';
import { QuarterCamera } from './QuarterCamera';
import { QuarterMoment } from './QuarterMoment';
import { MyMark, NeighbourHover, Neighbours, TerraceLamps } from './Terrace';

/** The district is read again this often while the tab is in sight; the world changes slowly. */
const REREAD_MS = 5 * 60_000;

/**
 * The living world inside the city's canvas: the newcomers' terrace with only the streets that live, the neighbours'
 * quarters and this visitor's own on it under one kit, its camera, the camera of «While you were away», and the subject
 * of a trade's moment filmed there.
 */
export function QuarterScene() {
  const me = useQuarter((s) => s.me);
  const x = me?.quarter.cell.x;
  const z = me?.quarter.cell.z;
  const myId = me?.quarter.id ?? null;
  const lot = useMemo(() => (x === undefined || z === undefined ? null : lotOf({ x, z })), [x, z]);
  const read = useArrivals((s) => s.quarters);

  // The district, read once the city is on screen and again rarely, and when the tab comes back after a while.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === 'visible') void arrivalsStore.getState().read();
    };
    again();
    const timer = setInterval(again, REREAD_MS);
    document.addEventListener('visibilitychange', again);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', again);
    };
  }, []);

  // My quarter as I have it now, the rest as the district says; a claim shows at once, before the district is read.
  const others = useMemo(() => read.filter((q) => q.id !== myId), [read, myId]);
  const claimed = useMemo<Cell[]>(() => [...others.map((q) => q.cell), ...(x === undefined || z === undefined ? [] : [{ x, z }])], [others, x, z]);
  const streets = useMemo(() => arrivalStreets(claimed), [claimed]);

  // The terrace is seen from afar in the city's view, true to size while a quarter is built.
  const mode = useQuarter((s) => s.mode);
  useFrame((_, dt) => {
    const goal = mode === 'city' ? 1 : 0;
    const a = AFAR.afar.value;
    AFAR.afar.value = Math.abs(goal - a) < 0.002 ? goal : a + (goal - a) * Math.min(1, dt * 3);
  });

  return (
    <>
      <Arrivals mine={lot} streets={streets} claimed={claimed} />
      <TerraceLamps occupied={streets.occupied} />
      <KitWorld afar={AFAR}>
        <Neighbours quarters={others} />
        {lot && <MyQuarter lot={lot} />}
        {lot && <FreeLayout lot={lot} />}
      </KitWorld>
      {lot && <MyMark lot={lot} />}
      <NeighbourHover quarters={others} streets={streets.count} mine={myId} />
      <QuarterCamera lot={lot} />
      <AwayCamera />
      <QuarterMoment lot={lot} />
      {process.env.NODE_ENV !== 'production' && <TerraceDevHook />}
    </>
  );
}

/** Development only: lets the screenshot scripts point the city's camera at the terrace. */
function TerraceDevHook() {
  const controls = useThree((s) => s.controls) as unknown as { setLookAt: (...a: [number, number, number, number, number, number, boolean]) => Promise<void> } | null;
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    Object.assign(window, {
      __terrace: {
        look: (px: number, py: number, pz: number, tx: number, ty: number, tz: number) => controls?.setLookAt(px, py, pz, tx, ty, tz, false),
        /** A point of the world on the screen, in CSS pixels. */
        project: (x: number, y: number, z: number) => {
          const v = new THREE.Vector3(x, y, z).project(camera);
          const r = gl.domElement.getBoundingClientRect();
          return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
        },
        lotOf,
        quarter: quarterStore,
        afar: AFAR,
      },
    });
  }, [controls, camera, gl]);
  return null;
}
