'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useMandate } from '@/city/lib/bots/mandate';
import { useCity } from '@/city/lib/city/store';
import { PALETTE } from '@/city/lib/palette';
import { lotOf } from '@/city/lib/quarter/plot';
import { quarterStore } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { AUTOPILOT_NET } from '@/city/lib/autopilot/flag';
import { useAutopilot } from '@/city/lib/autopilot/store';
import { HOVER, planWalk, stopAt, type Point, type WalkPlan } from '@/city/lib/autopilot/walk';
import { useWallet } from '@/city/lib/trade/wallet';

/** How fast it walks, city units a second, and how often it looks at its plan again, s. */
const SPEED = 22;
const REPLAN_S = 0.5;
const BRAND = new THREE.Color('#FF681C');

/**
 * CITY-70 — the person's agent in the city's sky: it walks from her quarter to the towers of the coins it trades for her
 * and back, hangs over a tower with a beam while a trade is made or confirmed, and stays home, its light cold, while she
 * has it frozen (`city/lib/autopilot/walk.ts`). Light: a few meshes, one shared glow, no shadows, no new assets; with
 * «reduce motion» it stands still at its stop. Nothing shows without an agent at work.
 */
export function AgentWalker() {
  const owner = useWallet((st) => st.connection?.address ?? null);
  const record = useMandate((st) => (owner ? (st.records[owner] ?? null) : null));
  const running = useRun((st) => st.phase !== 'off');
  if (!AUTOPILOT_NET || !record || running) return null;
  return <Walker policy={record.policy} />;
}

function Walker({ policy }: Readonly<{ policy: string }>) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const halo = useRef<THREE.Sprite>(null);
  const plan = useRef<WalkPlan>(null);
  const since = useRef(0);
  const replanned = useRef(-1);
  const placed = useRef(false);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const step = useMemo(() => new THREE.Vector3(), []);
  const still = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, []);
  const glow = useMemo(haloTexture, []);
  useEffect(() => () => glow.dispose(), [glow]);
  const colors = useMemo(() => ({ brand: BRAND.clone().multiplyScalar(2.6), warm: new THREE.Color(PALETTE.warmWhite).multiplyScalar(2.2), cold: new THREE.Color('#9fd8ff').multiplyScalar(1.8) }), []);

  useFrame(({ clock }, delta) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    if (t - replanned.current >= REPLAN_S) {
      replanned.current = t;
      const next = currentPlan(policy);
      if (JSON.stringify(next) !== JSON.stringify(plan.current)) since.current = t;
      plan.current = next;
      /* For the city's own shots and checks: where the agent is going (never in production). */
      if (process.env.NODE_ENV !== 'production') Object.assign(window, { __agentWalk: { plan: next, at: g.position.toArray() } });
    }
    const walk = plan.current;
    g.visible = walk !== null;
    if (!walk) return;
    const at = walk.stops[still ? 0 : stopAt(walk.stops, (t - since.current) * 1000)]!;
    goal.set(at.x, at.y + Math.sin(t * 1.4) * (still ? 0 : 0.4), at.z);
    if (!placed.current || still) {
      g.position.copy(goal);
      placed.current = true;
    }
    step.copy(goal).sub(g.position);
    const distance = step.length();
    if (distance > 0.001) {
      const dt = Math.min(delta, 0.1);
      const move = Math.min(distance, SPEED * dt * (distance < 10 ? Math.max(0.25, distance / 10) : 1));
      g.position.addScaledVector(step.normalize(), move);
      if (distance > 2) g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, Math.atan2(step.x, step.z), 0.1);
    }
    const trading = walk.mood === 'trade';
    const cold = walk.mood === 'frozen';
    if (body.current) body.current.rotation.y = still ? 0 : t * (cold ? 0.3 : trading ? 0.9 : 1.8);
    if (beam.current) {
      /* Over the tower it trades: a beam down to the roof, one unit tall, stretched each frame. */
      const drop = Math.max(1, goal.y - (at.y - HOVER));
      beam.current.visible = trading && distance < 6;
      beam.current.scale.set(1, drop, 1);
      beam.current.position.y = -drop / 2;
      beam.current.material.opacity = 0.3 + (still ? 0 : 0.12 * Math.sin(t * 5));
    }
    if (halo.current) {
      halo.current.material.color.copy(cold ? colors.cold : colors.brand).multiplyScalar(0.5);
      halo.current.scale.setScalar(12 + (still ? 0 : 2 * Math.sin(t * (trading ? 4 : 2))));
    }
  });

  return (
    <group ref={group} visible={false}>
      <sprite ref={halo} scale={12}>
        <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <group ref={body} scale={1.8}>
        <mesh scale={[1, 1.5, 1]}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={colors.brand} toneMapped={false} />
        </mesh>
        <mesh scale={[1.25, 1.85, 1.25]}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={colors.warm} wireframe transparent opacity={0.45} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      <mesh ref={beam} visible={false}>
        <cylinderGeometry args={[0.5, 1.1, 1, 16, 1, true]} />
        <meshBasicMaterial color={colors.brand} transparent opacity={0.3} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** Where the agent goes now, from the card's own read of the book and the city's towers. */
function currentPlan(policy: string): WalkPlan {
  const view = useAutopilot.getState().views[policy];
  if (!view) return null;
  const towers = useCity.getState().layout.towers;
  const placed = towers.find((p) => p.tower.id === view.receiveMint);
  const tower: Point | null = placed ? { x: placed.x, y: placed.height, z: placed.z } : null;
  const me = quarterStore.getState().me;
  const lot = me ? lotOf(me.quarter.cell) : null;
  const home: Point | null = lot ? { x: lot.x, y: 4, z: lot.z } : null;
  const mission = view.mission?.state ?? (view.frozen ? 'frozen' : view.status === 'working' ? 'working' : view.status === 'stopped' ? 'stopped' : view.status === 'paused' ? 'paused' : 'done');
  const lastTradeAt = view.last.find((trade) => trade.ok)?.at ?? null;
  return planWalk([{ tower, mission: view.frozen && mission !== 'confirming' ? 'frozen' : mission, lastTradeAt }], home, Date.now());
}

/** A soft round glow, drawn once on a small canvas. */
function haloTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
