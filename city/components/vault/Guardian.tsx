'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { PALETTE } from '@/city/lib/palette';
import type { GuardianState } from '@/city/lib/vault/store';
import { createArmourMaterial, glow } from './materials';

/**
 * The guard at the Vault's door: a simple stand-in until the characters line brings the hero guard (CITY-57) — a robot
 * of separate armoured parts with a light visor for a face. This is the point where that guard plugs in: the same
 * `<Guardian state=… />`, the same four states the characters line names.
 *
 *   ready    — the visor glows steady; the guard breathes
 *   thinking — the visor scans, the head tilts: a model is reading the attempt
 *   acting   — the visor flares and an arm comes up: the reply is out
 *   done     — the vault is cracked; the guard steps aside and lowers its head
 *
 * About 3.7 units tall — a head over the door — its feet at the origin, facing +z.
 */
export function Guardian({ state }: { state: GuardianState }) {
  const root = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const arm = useRef<THREE.Group>(null);
  const visor = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const parts = useMemo(() => {
    const plate = createArmourMaterial('#5A566B', 0);
    const dark = createArmourMaterial('#2B2936', 0);
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
    return {
      plate,
      dark,
      visorMaterial: glow(PALETTE.violet, 2.2),
      core: glow(PALETTE.amber, 2.6),
      leg: box(0.34, 1.05, 0.4),
      boot: box(0.42, 0.22, 0.6),
      hips: box(0.86, 0.3, 0.5),
      torso: box(1.1, 0.95, 0.62),
      chest: box(0.42, 0.34, 0.08),
      shoulder: box(0.42, 0.34, 0.56),
      armUpper: box(0.26, 0.62, 0.3),
      armLower: box(0.3, 0.6, 0.34),
      neck: box(0.26, 0.14, 0.26),
      skull: box(0.56, 0.5, 0.56),
      visor: box(0.5, 0.11, 0.06),
    };
  }, []);
  useEffect(
    () => () => {
      for (const value of Object.values(parts)) (value as { dispose: () => void }).dispose();
    },
    [parts],
  );

  const colours = useMemo(
    () => ({
      ready: new THREE.Color(PALETTE.violet).multiplyScalar(2.2),
      thinking: new THREE.Color(PALETTE.amber).multiplyScalar(2.8),
      acting: new THREE.Color(PALETTE.warmWhite).multiplyScalar(3.2),
      done: new THREE.Color(PALETTE.warmWhite).multiplyScalar(1.4),
    }),
    [],
  );
  const aside = useRef(0);

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    const dt = Math.min(delta, 0.1);
    const s = stateRef.current;
    const g = root.current;
    if (!g) return;
    // Breathing; a crack sends the guard a step aside from the door.
    aside.current += ((s === 'done' ? 1 : 0) - aside.current) * Math.min(1, dt * 2.5);
    g.position.y = Math.sin(t * 1.6) * 0.025;
    g.position.x = aside.current * 1.1;
    g.rotation.y = aside.current * -0.7;
    if (head.current) {
      const tilt = s === 'thinking' ? Math.sin(t * 2.4) * 0.35 : s === 'done' ? 0 : Math.sin(t * 0.5) * 0.08;
      head.current.rotation.y += (tilt - head.current.rotation.y) * Math.min(1, dt * 6);
      head.current.rotation.x += ((s === 'done' ? 0.35 : 0) - head.current.rotation.x) * Math.min(1, dt * 4);
    }
    if (arm.current) {
      const lift = s === 'acting' ? -1.25 + Math.sin(t * 9) * 0.06 : 0;
      arm.current.rotation.x += (lift - arm.current.rotation.x) * Math.min(1, dt * 8);
    }
    const v = visor.current;
    if (v) {
      v.material.color.lerp(colours[s], Math.min(1, dt * 8));
      v.scale.x = s === 'thinking' ? 0.55 + 0.45 * Math.abs(Math.sin(t * 5)) : 1;
    }
  });

  const { plate, dark } = parts;
  return (
    <group ref={root} scale={1.25}>
      {[-0.25, 0.25].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh geometry={parts.boot} material={dark} position={[0, 0.11, 0.06]} />
          <mesh geometry={parts.leg} material={plate} position={[0, 0.74, 0]} />
        </group>
      ))}
      <mesh geometry={parts.hips} material={dark} position={[0, 1.36, 0]} />
      <mesh geometry={parts.torso} material={plate} position={[0, 1.98, 0]} />
      <mesh geometry={parts.chest} material={parts.core} position={[0, 2.08, 0.32]} />
      {[-1, 1].map((side) => (
        <group key={side} position={[side * 0.74, 2.3, 0]}>
          <mesh geometry={parts.shoulder} material={dark} />
          <group ref={side === 1 ? arm : undefined} position={[0, -0.12, 0]}>
            <mesh geometry={parts.armUpper} material={plate} position={[0, -0.36, 0]} />
            <mesh geometry={parts.armLower} material={dark} position={[0, -0.96, 0.02]} />
          </group>
        </group>
      ))}
      <mesh geometry={parts.neck} material={dark} position={[0, 2.52, 0]} />
      <group ref={head} position={[0, 2.84, 0]}>
        <mesh geometry={parts.skull} material={plate} />
        <mesh ref={visor} geometry={parts.visor} material={parts.visorMaterial} position={[0, 0.03, 0.29]} />
      </group>
    </group>
  );
}
