'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useCity } from '@/city/lib/city/store';
import { PALETTE } from '@/city/lib/palette';
import { poseOf } from '@/city/lib/quarter/away';
import { awayStore, useAway } from '@/city/lib/quarter/away-store';
import { flightAt, type Pose } from '@/city/lib/quarter/camera';
import { useQuarter } from '@/city/lib/quarter/store';

/** The part of the city's camera controls the reel borrows. */
type Controls = {
  enabled: boolean;
  getPosition: (out: THREE.Vector3, receiveEndValue?: boolean) => THREE.Vector3;
  getTarget: (out: THREE.Vector3, receiveEndValue?: boolean) => THREE.Vector3;
  setLookAt: (px: number, py: number, pz: number, tx: number, ty: number, tz: number, transition?: boolean) => Promise<void>;
};

/** How high a flight rises between two changes, and how long it may take. */
const LIFT = 10;
const FLIGHT_MAX_MS = 1_800;
/** How fast the camera turns around a change while its line is read, in radians a second. */
const DRIFT = 0.035;

const v3 = (v: { x: number; y: number; z: number }) => ({ x: v.x, y: v.y, z: v.z });

/**
 * The camera of «While you were away»: while the reel plays over the city, it takes the city's camera and flies over
 * each change in turn — the quarter, a tower, the street — and turns slowly around it while its line is read. When the
 * reel ends it hands the camera back where it found it. A tap or a drag on the city ends the reel: the person takes
 * the camera. With reduced motion it cuts instead of flying and holds still.
 */
export function AwayCamera() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const controls = useThree((s) => s.controls) as unknown as Controls | null;
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const playing = useAway((s) => s.status === 'playing');
  const index = useAway((s) => s.index);
  const lines = useAway((s) => s.lines);
  const city = useQuarter((s) => s.mode === 'city');
  const layout = useCity((s) => s.layout);
  const on = playing && city;
  const portrait = size.width < size.height;

  const active = useRef(false);
  const back = useRef<Pose | null>(null);
  const pose = useRef<Pose | null>(null);
  const fly = useRef<{ from: Pose; to: Pose; t0: number; ms: number } | null>(null);
  const held = useRef<{ at: Pose; t0: number } | null>(null);
  const calm = useRef(false);

  useEffect(() => {
    calm.current = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Take the camera, or give it back.
  useEffect(() => {
    if (on && !active.current) {
      active.current = true;
      const ahead = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(40));
      pose.current = { position: v3(camera.position), target: v3(ahead) };
      if (controls) {
        pose.current.target = v3(controls.getTarget(new THREE.Vector3(), false));
        back.current = { position: v3(controls.getPosition(new THREE.Vector3(), true)), target: v3(controls.getTarget(new THREE.Vector3(), true)) };
        // Stop whatever the city's camera was gliding to, then hold it still.
        const p = pose.current;
        void controls.setLookAt(p.position.x, p.position.y, p.position.z, p.target.x, p.target.y, p.target.z, false);
        controls.enabled = false;
      } else {
        back.current = pose.current;
      }
      camera.up.set(0, 1, 0);
    }
    if (!on && active.current) {
      active.current = false;
      fly.current = null;
      held.current = null;
      const p = pose.current;
      const b = back.current;
      if (controls && p) {
        void controls.setLookAt(p.position.x, p.position.y, p.position.z, p.target.x, p.target.y, p.target.z, false);
        if (b) void controls.setLookAt(b.position.x, b.position.y, b.position.z, b.target.x, b.target.y, b.target.z, true);
        controls.enabled = true;
      }
      useCity.getState().touch();
    }
  }, [on, camera, controls]);

  // Every line: a flight from wherever the camera is to the change it tells of.
  useEffect(() => {
    if (!on || !active.current) return;
    const line = lines[index];
    if (!line || !pose.current) return;
    const to = poseOf(line.focus, layout.towers, portrait);
    const ms = calm.current ? 0 : Math.min(FLIGHT_MAX_MS, line.ms * 0.45);
    fly.current = { from: pose.current, to, t0: performance.now(), ms };
    held.current = null;
  }, [on, index, lines, layout, portrait]);

  // The city is the person's again the moment they touch it.
  useEffect(() => {
    if (!on) return;
    const el = gl.domElement;
    const take = () => awayStore.getState().finish();
    el.addEventListener('pointerdown', take);
    el.addEventListener('wheel', take, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', take);
      el.removeEventListener('wheel', take);
    };
  }, [on, gl]);

  const look = useRef(new THREE.Vector3());
  useFrame(() => {
    if (!active.current) return;
    // The city's idle orbit sleeps while the reel holds the camera.
    useCity.getState().touch();
    if (controls?.enabled) controls.enabled = false;
    const now = performance.now();
    let p: Pose | null = pose.current;
    const f = fly.current;
    if (f) {
      const t = f.ms <= 0 ? 1 : (now - f.t0) / f.ms;
      p = flightAt(f.from, f.to, Math.min(1, t), LIFT);
      if (t >= 1) {
        fly.current = null;
        held.current = { at: f.to, t0: now };
      }
    } else if (held.current && !calm.current) {
      // A slow turn around the change, so the frame never freezes.
      const { at, t0 } = held.current;
      const angle = ((now - t0) / 1000) * DRIFT;
      const dx = at.position.x - at.target.x;
      const dz = at.position.z - at.target.z;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      p = { position: { x: at.target.x + dx * c - dz * s, y: at.position.y, z: at.target.z + dx * s + dz * c }, target: at.target };
    }
    if (!p) return;
    pose.current = p;
    camera.position.set(p.position.x, p.position.y, p.position.z);
    look.current.set(p.target.x, p.target.y, p.target.z);
    camera.lookAt(look.current);
  });

  const line = on ? lines[index] : undefined;
  const tower = line?.focus.kind === 'tower' ? layout.towers.find((t) => t.tower.id === (line.focus as { mint: string }).mint) : undefined;
  return tower ? <Marker key={line!.id} x={tower.x} z={tower.z} top={tower.height} width={tower.width} /> : null;
}

/** An amber crown and a beam on the tower a line tells of, so it stands out of the skyline while its line is read. */
function Marker({ x, z, top, width }: { x: number; z: number; top: number; width: number }) {
  const crown = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const born = useRef(performance.now());
  const { ring, column, material } = useMemo(() => {
    const ring = new THREE.RingGeometry(width * 1.1, width * 1.1 + 1.2, 48).rotateX(-Math.PI / 2);
    const column = new THREE.CylinderGeometry(0.28, 0.28, 60, 8, 1, true).translate(0, 30, 0);
    const material = new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    return { ring, column, material };
  }, [width]);
  useEffect(
    () => () => {
      ring.dispose();
      column.dispose();
      material.dispose();
    },
    [ring, column, material],
  );
  useFrame(() => {
    const t = (performance.now() - born.current) / 1000;
    material.opacity = Math.min(1, t * 1.5) * (0.75 + Math.sin(t * 4) * 0.2);
    crown.current?.scale.setScalar(1 + Math.sin(t * 2.4) * 0.06);
  });
  return (
    <group position={[x, 0, z]}>
      <mesh ref={crown} geometry={ring} material={material} position={[0, top + 1.2, 0]} renderOrder={5} />
      <mesh ref={beam} geometry={column} material={material} position={[0, top + 1.2, 0]} renderOrder={5} />
    </group>
  );
}
