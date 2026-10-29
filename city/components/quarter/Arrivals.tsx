'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ArrivalStreets } from '@/city/lib/quarter/district';
import { ARRIVALS, terraceBounds, type Lot } from '@/city/lib/quarter/plot';
import type { Cell } from '@/city/lib/quarter/types';
import { TERRACE_TOP } from './afar';
import { createTerraceMaterial } from './materials';

export { TERRACE_TOP };
const DEPTH = 1.4;
/** Lots a street, as the world numbers them: the claimed-lot texture's width. */
const LOTS = ARRIVALS.perSide * 4;

/**
 * Arrivals, the newcomers' district: a terrace on the water south of the island, the bridge that brings the south
 * spoke down to it, and only the streets that live — those with a claimed quarter and the one free street after them.
 * A claimed lot reads as a paved block its buildings stand on; a free lot is a faint pad; this visitor's lot has an
 * amber kerb that brightens as it is claimed. One mesh, one material and a small texture of which lots are claimed.
 */
export function Arrivals({ mine, streets, claimed }: { mine: Lot | null; streets: ArrivalStreets; claimed: readonly Cell[] }) {
  const count = streets.count;
  const texture = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array(LOTS * count * 4), LOTS, count, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  }, [count]);

  const { geometry, material } = useMemo(() => {
    const b = terraceBounds(mine, count - 1);
    const terrace = new THREE.BoxGeometry(b.maxX - b.minX, DEPTH, b.maxZ - b.minZ);
    terrace.translate((b.minX + b.maxX) / 2, TERRACE_TOP - DEPTH / 2, (b.minZ + b.maxZ) / 2);
    const start = ARRIVALS.shore - 2;
    const length = b.minZ - start;
    const bridge = new THREE.BoxGeometry(2 * ARRIVALS.lane - 1.4, DEPTH * 0.6, length);
    bridge.translate(0, TERRACE_TOP - 0.02 - DEPTH * 0.3, start + length / 2);
    const merged = mergeGeometries([terrace, bridge]) ?? terrace;
    if (merged !== terrace) {
      terrace.dispose();
      bridge.dispose();
    }
    return { geometry: merged, material: createTerraceMaterial(b, count, streets.free, mine, texture) };
  }, [mine, count, streets.free, texture]);

  // Which lots are claimed, written into the texture only when the district changes.
  useEffect(() => {
    const data = texture.image.data as Uint8Array;
    data.fill(0);
    for (const c of claimed) {
      const x = Math.floor(c.x);
      const z = Math.floor(c.z);
      if (x >= 0 && x < LOTS && z >= 0 && z < count) data[(z * LOTS + x) * 4] = 255;
    }
    texture.needsUpdate = true;
  }, [claimed, texture, count]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  useEffect(() => () => texture.dispose(), [texture]);

  // The visitor's lot lights up over a second when it appears: when it is claimed, and when the city first reads it.
  const claim = useRef(0);
  useEffect(() => {
    claim.current = 0;
  }, [mine]);
  useFrame((_, dt) => {
    if (mine && claim.current < 1) claim.current = Math.min(1, claim.current + dt * 0.8);
    material.uniforms.uClaim!.value = mine ? claim.current : 0;
  });

  return <mesh geometry={geometry} material={material} />;
}
