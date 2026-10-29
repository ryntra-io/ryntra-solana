'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { SHARED } from '@/city/lib/city/shared';
import { useCity } from '@/city/lib/city/store';
import { PALETTE } from '@/city/lib/palette';
import { quarterStore } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { VAULT_OPEN } from '@/city/lib/vault/flag';
import { FACING, GUARD_LOCAL, ISLET_RADIUS, PLINTH_TOP, TOWER, VAULT_SPOT, flightAt, flightMs, roomView, type Point, type View } from '@/city/lib/vault/place';
import { guardianOf, useVault, vaultStore } from '@/city/lib/vault/store';
import { Guardian } from './Guardian';
import { createArmourMaterial, createCoreMaterial, glow } from './materials';

/** The armoured base the door is cut into, and where the glass of the core starts above it. */
const BASE_H = 4.2;
/** The door: a ring of stored sun around a steel disc, its centre this high. */
const DOOR = { radius: 1.55, y: PLINTH_TOP + 1.85 } as const;
const PILLARS = 8;
/** The top of what a tap can hit: the tower, its cap and its lamp. */
const TOWER_TOP = PLINTH_TOP + TOWER.height + 4;

/**
 * The Vault in the city, once its flag is open: an armoured octagonal tower on its own islet, a core of stored sun
 * showing between the plates, the door turned to the city and the guard beside it. A tap on it opens the room; the
 * camera flies to the door and gives the city its view back when the room closes. Each attempt sends a pulse of light
 * from the vault across the city; a crack throws a beam into the sky.
 */
export function VaultTower() {
  if (!VAULT_OPEN) return null;
  return <Vault />;
}

function Vault() {
  const phase = useVault((st) => st.phase);
  const [, tick] = useState(0);
  // An answer's "acting" ends by itself: look again once it has played.
  useEffect(() => {
    if (phase.step !== 'answered') return;
    const timer = setTimeout(() => tick((n) => n + 1), 2700);
    return () => clearTimeout(timer);
  }, [phase]);
  const guard = guardianOf(phase, Date.now());

  return (
    <group position={[VAULT_SPOT.x, 0, VAULT_SPOT.z]} rotation-y={FACING}>
      <Tower />
      <group position={[GUARD_LOCAL.side, PLINTH_TOP, GUARD_LOCAL.ahead]}>
        <Guardian state={guard} />
      </group>
      <VaultTap />
      <VaultCamera />
    </group>
  );
}

function Tower() {
  const core = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>>(null);
  const beam = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const ring = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const sent = useRef(0);
  const amber = useMemo(() => new THREE.Color(PALETTE.amber), []);

  const parts = useMemo(() => {
    const height = TOWER.height - BASE_H;
    // An octagon with a flat face to the front, where the door is cut.
    const octagon = (r: number, h: number, open = false) => new THREE.CylinderGeometry(r, r, h, PILLARS, 1, open, Math.PI / PILLARS);
    const pillar = new THREE.BoxGeometry(0.95, height, 0.8);
    return {
      armour: createArmourMaterial('#2A2834'),
      dark: createArmourMaterial('#16151E', 0.6),
      core: createCoreMaterial(),
      amber: glow(PALETTE.amber, 2.4),
      ringGlow: glow(PALETTE.amber, 2.4),
      warm: glow(PALETTE.warmWhite, 2.2),
      violet: glow(PALETTE.violet, 1.8, { transparent: true, opacity: 0.9 }),
      beam: glow(PALETTE.warmWhite, 2.4, { transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      plinth: new THREE.CylinderGeometry(ISLET_RADIUS, ISLET_RADIUS + 0.5, PLINTH_TOP, 16),
      edge: new THREE.TorusGeometry(ISLET_RADIUS - 0.25, 0.06, 4, 64).rotateX(Math.PI / 2),
      base: octagon(TOWER.radius + 0.35, BASE_H),
      pillar,
      pillarAt: Array.from({ length: PILLARS }, (_, i) => {
        const a = ((i + 0.5) / PILLARS) * Math.PI * 2;
        return { x: Math.sin(a) * TOWER.radius, z: Math.cos(a) * TOWER.radius, a };
      }),
      height,
      crown: octagon(TOWER.radius + 0.45, 1.1),
      cap: new THREE.ConeGeometry(TOWER.radius * 0.8, 2.4, PILLARS, 1, false, Math.PI / PILLARS),
      glass: new THREE.CylinderGeometry(TOWER.core, TOWER.core, height, 20, 1, true),
      door: new THREE.CircleGeometry(DOOR.radius - 0.1, 32),
      doorRing: new THREE.TorusGeometry(DOOR.radius, 0.13, 6, 40),
      lock: new THREE.CircleGeometry(0.32, 20),
      lamp: new THREE.SphereGeometry(0.32, 10, 8),
      beamGeo: new THREE.CylinderGeometry(0.5, 1.4, 120, 16, 1, true).translate(0, 60, 0),
    };
  }, []);
  useEffect(
    () => () => {
      for (const value of Object.values(parts)) if (value && typeof (value as { dispose?: () => void }).dispose === 'function') (value as { dispose: () => void }).dispose();
    },
    [parts],
  );

  useFrame(({ clock }) => {
    const { pulseAt, crackedAt } = vaultStore.getState();
    const now = Date.now();
    // Each attempt: the core flares and a pulse of light runs from the vault across the city.
    if (pulseAt !== sent.current) {
      sent.current = pulseAt;
      SHARED.uPulseTime.value = clock.elapsedTime;
      SHARED.uPulseOrigin.value.set(VAULT_SPOT.x, VAULT_SPOT.z);
      SHARED.uPulseStrength.value = 0.45;
      SHARED.uPulseColor.value.set(PALETTE.amber);
    }
    const heat = Math.max(0, 1 - (now - pulseAt) / 1800);
    const c = core.current;
    if (c) c.material.uniforms.uHeat!.value = heat * 0.9 + 0.08 * Math.sin(clock.elapsedTime * 1.7);
    const b = beam.current;
    if (b) {
      const since = (now - crackedAt) / 1000;
      const on = crackedAt > 0 && since < 6 ? Math.min(1, since * 4) * Math.max(0, 1 - since / 6) : 0;
      b.visible = on > 0.001;
      b.material.opacity = on * 0.55;
    }
    const r = ring.current;
    if (r) r.material.color.copy(amber).multiplyScalar(2.4 + heat * 2.4);
  });

  const { height } = parts;
  return (
    <group>
      <mesh geometry={parts.plinth} material={parts.dark} position={[0, PLINTH_TOP / 2, 0]} />
      <mesh geometry={parts.edge} material={parts.violet} position={[0, PLINTH_TOP + 0.01, 0]} />
      <mesh geometry={parts.base} material={parts.armour} position={[0, PLINTH_TOP + BASE_H / 2, 0]} />
      {parts.pillarAt.map((p) => (
        <mesh key={p.a} geometry={parts.pillar} material={parts.armour} position={[p.x, PLINTH_TOP + BASE_H + height / 2, p.z]} rotation-y={p.a} />
      ))}
      <mesh ref={core} geometry={parts.glass} material={parts.core} position={[0, PLINTH_TOP + BASE_H + height / 2, 0]} />
      <mesh geometry={parts.crown} material={parts.dark} position={[0, PLINTH_TOP + TOWER.height + 0.55, 0]} />
      <mesh geometry={parts.cap} material={parts.armour} position={[0, PLINTH_TOP + TOWER.height + 2.3, 0]} />
      <mesh geometry={parts.lamp} material={parts.amber} position={[0, PLINTH_TOP + TOWER.height + 3.65, 0]} />
      {/* The door, cut into the front face. */}
      <group position={[0, DOOR.y, (TOWER.radius + 0.35) * Math.cos(Math.PI / PILLARS) + 0.03]}>
        <mesh geometry={parts.door} material={parts.dark} />
        <mesh ref={ring} geometry={parts.doorRing} material={parts.ringGlow} />
        <mesh geometry={parts.lock} material={parts.warm} position={[0, 0, 0.02]} />
      </group>
      <mesh ref={beam} geometry={parts.beamGeo} material={parts.beam} position={[0, PLINTH_TOP + TOWER.height, 0]} visible={false} />
    </group>
  );
}

/**
 * A tap on the vault opens its room. The vault listens before the city's own tap (it is mounted first), and a tap it
 * takes is not passed on, so no tower behind it gets picked.
 */
function VaultTap() {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    let down: { x: number; y: number; t: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    };
    const onUp = (e: PointerEvent) => {
      const d = down;
      down = null;
      if (!d || useRun.getState().phase !== 'off' || quarterStore.getState().mode !== 'city') return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 350) return;
      const rect = el.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const r = ISLET_RADIUS;
      box.set(new THREE.Vector3(VAULT_SPOT.x - r, 0, VAULT_SPOT.z - r), new THREE.Vector3(VAULT_SPOT.x + r, TOWER_TOP, VAULT_SPOT.z + r));
      if (!raycaster.ray.intersectBox(box, hit)) return;
      e.stopImmediatePropagation();
      // Already inside: a tap on the vault keeps the room as it is.
      if (vaultStore.getState().open) return;
      useCity.getState().select(null);
      void vaultStore.getState().enter();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
    };
  }, [gl, camera]);
  return null;
}

/** The part of the city's camera controls the room borrows. */
type Controls = {
  enabled: boolean;
  getPosition: (out: THREE.Vector3, receiveEndValue?: boolean) => THREE.Vector3;
  getTarget: (out: THREE.Vector3, receiveEndValue?: boolean) => THREE.Vector3;
  setLookAt: (px: number, py: number, pz: number, tx: number, ty: number, tz: number, transition?: boolean) => Promise<void>;
};

const v3 = (v: THREE.Vector3): Point => ({ x: v.x, y: v.y, z: v.z });

/**
 * While the room is open the camera is the room's: it flies from wherever the city's camera was to the door and holds
 * the view there, whatever else the city's director would do, the way my quarter holds it while it builds. When the
 * room closes the city's controls get the camera back where they left it, unless the city has since flown somewhere of
 * its own (a tower picked, a run).
 */
function VaultCamera() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const size = useThree((s) => s.size);
  const open = useVault((st) => st.open);
  const active = useRef(false);
  const fly = useRef<{ from: View; to: View; t0: number; ms: number } | null>(null);
  const hold = useRef<View | null>(null);
  const back = useRef<View | null>(null);
  const look = useRef(new THREE.Vector3());

  useEffect(() => {
    if (open && !active.current) {
      active.current = true;
      const ahead = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(40));
      const from: View = { eye: v3(camera.position), target: v3(controls ? controls.getTarget(new THREE.Vector3(), false) : ahead) };
      back.current = controls ? { eye: v3(controls.getPosition(new THREE.Vector3(), true)), target: v3(controls.getTarget(new THREE.Vector3(), true)) } : from;
      if (controls) controls.enabled = false;
      camera.up.set(0, 1, 0);
      const to = roomView(size.width, size.height);
      fly.current = { from, to, t0: performance.now(), ms: flightMs(from, to) };
      hold.current = to;
      look.current.set(from.target.x, from.target.y, from.target.z);
      useCity.getState().touch();
    }
    if (!open && active.current) {
      active.current = false;
      fly.current = null;
      if (controls) {
        const l = look.current;
        void controls.setLookAt(camera.position.x, camera.position.y, camera.position.z, l.x, l.y, l.z, false);
        const b = back.current;
        if (b && !useCity.getState().selectedId && useRun.getState().phase === 'off') void controls.setLookAt(b.eye.x, b.eye.y, b.eye.z, b.target.x, b.target.y, b.target.z, true);
        controls.enabled = true;
      }
      useCity.getState().touch();
    }
  }, [open, camera, controls, size.width, size.height]);

  // A turned phone: the room frames the vault again for the new shape.
  useEffect(() => {
    if (!active.current) return;
    const to = roomView(size.width, size.height);
    const from: View = { eye: v3(camera.position), target: v3(look.current) };
    fly.current = { from, to, t0: performance.now(), ms: 600 };
    hold.current = to;
  }, [size.width, size.height, camera]);

  useFrame(() => {
    if (!active.current || !hold.current) return;
    // The city's controls stay down for as long as the room holds the camera, whatever else wakes them.
    if (controls?.enabled) controls.enabled = false;
    let pose = hold.current;
    const f = fly.current;
    if (f) {
      const t = (performance.now() - f.t0) / f.ms;
      pose = flightAt(f.from, f.to, t);
      if (t >= 1) fly.current = null;
    }
    camera.position.set(pose.eye.x, pose.eye.y, pose.eye.z);
    look.current.set(pose.target.x, pose.target.y, pose.target.z);
    camera.lookAt(look.current);
  });
  return null;
}
