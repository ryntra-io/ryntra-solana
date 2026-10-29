'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { share } from '@/city/lib/city/shared';
import { createGroundMaterial } from './materials/groundMaterial';
import { useKit } from './skyline/Skyline';
import { Quay } from './skyline/Quay';
import { Street } from './skyline/Street';
import { useSkyline } from './skyline/store';
import { Water } from './skyline/Water';

/**
 * The island, the water round it (CITY-56: its own surface, mirroring the city) and, once the skyline kit is on the
 * screen, the embankment and the life on its streets: cars, street lights and people.
 */
export function Ground() {
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1600, 1600, 1, 1);
    geometry.rotateX(-Math.PI / 2);
    return { geometry, material: share(createGroundMaterial()) };
  }, []);
  const kit = useKit();
  const ready = useSkyline((s) => s.ready);
  return (
    <>
      <mesh geometry={geometry} material={material} />
      <Water />
      {ready && kit && <Quay kit={kit} />}
      {ready && kit && <Street kit={kit} />}
    </>
  );
}
