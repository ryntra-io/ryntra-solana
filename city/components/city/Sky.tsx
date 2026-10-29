'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SHARED } from '@/city/lib/city/shared';
import { useCity, useCityEvents } from '@/city/lib/city/store';
import { flashingOn } from '@/city/lib/feed/motion';
import { PALETTE } from '@/city/lib/palette';
import { createEclipseMaterial, createSkyMaterial } from './materials/skyMaterials';

/** Where the Eclipse hangs: due north, 12° above the horizon, so the Sol Spire rises into it from the default view. */
const ECLIPSE_DIR = new THREE.Vector3(0, Math.sin((12 * Math.PI) / 180), -Math.cos((12 * Math.PI) / 180)).normalize();
const ECLIPSE_DISTANCE = 700;
const ECLIPSE_SIZE = 250;

export function Sky() {
  const skyRef = useRef<THREE.Mesh>(null);
  const eclipseRef = useRef<THREE.Group>(null);
  const sky = useMemo(() => {
    const material = createSkyMaterial();
    material.uniforms.uTime = SHARED.uTime;
    return { geometry: new THREE.SphereGeometry(900, 48, 24), material };
  }, []);
  const eclipse = useMemo(() => {
    const corona = createEclipseMaterial();
    corona.uniforms.uTime = SHARED.uTime;
    const disc = new THREE.MeshBasicMaterial({ color: PALETTE.inkDeep, fog: false, depthWrite: false, toneMapped: false });
    return { plane: new THREE.PlaneGeometry(2, 2), circle: new THREE.CircleGeometry(0.335, 96), corona, disc };
  }, []);

  useFrame(({ camera }) => {
    skyRef.current?.position.copy(camera.position);
    const group = eclipseRef.current;
    if (group) {
      group.position.copy(camera.position).addScaledVector(ECLIPSE_DIR, ECLIPSE_DISTANCE);
      group.quaternion.copy(camera.quaternion);
    }
    // The corona breathes on the Slot Pulse and the diamond ring fades after a flare.
    const since = SHARED.uTime.value - SHARED.uPulseTime.value;
    eclipse.corona.uniforms.uBeat!.value = Math.exp(-Math.max(0, since) * 3) * SHARED.uPulseStrength.value;
    const diamond = eclipse.corona.uniforms.uDiamond!;
    diamond.value = Math.max(0, diamond.value - 0.008);
    // Market mood: the average 24h move of the skyline tints the horizon.
    const towers = useCity.getState().snapshot.towers;
    if (towers.length) {
      const mood = towers.reduce((sum, t) => sum + t.change24h, 0) / towers.length;
      sky.material.uniforms.uMood!.value = THREE.MathUtils.clamp(mood / 8, -1, 1);
    }
  });

  // Every flare and launch lights the diamond ring.
  useCityEvents((event) => {
    // «Flashing effects» off (CITY-66): the eclipse's diamond ring does not flash.
    if (event.kind !== 'pump' && flashingOn()) eclipse.corona.uniforms.uDiamond!.value = 1;
  });

  return (
    <>
      <mesh ref={skyRef} geometry={sky.geometry} material={sky.material} renderOrder={-10} frustumCulled={false} />
      <group ref={eclipseRef} renderOrder={-9} frustumCulled={false}>
        <mesh geometry={eclipse.circle} material={eclipse.disc} scale={ECLIPSE_SIZE} renderOrder={-9} frustumCulled={false} />
        <mesh geometry={eclipse.plane} material={eclipse.corona} scale={ECLIPSE_SIZE} renderOrder={-8} frustumCulled={false} />
      </group>
    </>
  );
}
