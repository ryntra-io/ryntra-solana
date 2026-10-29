'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { AGENTS_OPEN } from '@/city/lib/agent/flag';
import { useAgent } from '@/city/lib/agent/store';
import { isStale } from '@/city/lib/city/events';
import { useCity } from '@/city/lib/city/store';
import { PALETTE } from '@/city/lib/palette';
import { useRun } from '@/city/lib/run/store';
import { useScout } from './useScout';

/** How fast the drone flies, in city units a second, and how high above a roof it hangs. */
const SPEED = 30;
const HOVER = 13;

/** The scout, when its flag is open: a drone in the city's sky, and its clock. */
export function ScoutDrone() {
  if (!AGENTS_OPEN) return null;
  return <Scout />;
}

function Scout() {
  useScout();
  const on = useAgent((st) => st.on);
  const running = useRun((st) => st.phase !== 'off');
  // A run owns the whole sky.
  if (!on || running) return null;
  return <Drone />;
}

/** A point on the patrol: a slow loop over the districts, high enough to clear the tallest towers. */
function patrol(t: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.sin(t * 0.09) * 46, 62 + Math.sin(t * 0.5) * 3, Math.sin(t * 0.06 + 1.3) * 40);
}

/**
 * The drone: an amber diamond with violet wings and a turning ring, the Agents glyph in the sky. On patrol it sweeps
 * a soft scan cone over the roofs; on a find it flies to the tower, hangs over it and drops a mint beam to the roof.
 * When it gets there, the find's card opens.
 */
function Drone() {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const scan = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>(null);
  const halo = useRef<THREE.Sprite>(null);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const step = useMemo(() => new THREE.Vector3(), []);
  const started = useRef(false);
  const scanMaterial = useMemo(() => fadingCone(new THREE.Color(PALETTE.amber).multiplyScalar(1.6)), []);
  const glow = useMemo(haloTexture, []);
  useEffect(
    () => () => {
      scanMaterial.dispose();
      glow.dispose();
    },
    [scanMaterial, glow],
  );
  const colors = useMemo(
    () => ({
      amber: new THREE.Color(PALETTE.amber).multiplyScalar(3.4),
      warm: new THREE.Color(PALETTE.warmWhite).multiplyScalar(2.6),
      violet: new THREE.Color(PALETTE.violet).multiplyScalar(2.2),
      mint: new THREE.Color(PALETTE.mint).multiplyScalar(2.4),
    }),
    [],
  );

  useFrame(({ clock }, delta) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    const dt = Math.min(delta, 0.1);
    const agent = useAgent.getState();
    const city = useCity.getState();
    // Where to be: over the find; over the tower it brought while that tower's card is open; else on patrol.
    const id = agent.find?.tower.id ?? (agent.brought && city.selectedId === agent.brought.mint ? agent.brought.mint : null);
    const placed = id ? city.layout.towers.find((p) => p.tower.id === id) : undefined;
    const hovering = Boolean(placed);
    if (placed) goal.set(placed.x, placed.height + HOVER + Math.sin(t * 1.6) * 0.5, placed.z);
    else patrol(t, goal);

    if (!started.current) {
      // The first frame starts it on its patrol, not at the island's centre.
      g.position.copy(patrol(t, step));
      started.current = true;
    }
    step.copy(goal).sub(g.position);
    const distance = step.length();
    if (distance > 0.001) {
      const move = Math.min(distance, SPEED * dt * (distance < 12 ? Math.max(0.25, distance / 12) : 1));
      g.position.addScaledVector(step.normalize(), move);
      // Turn toward where it flies, and bank a little into the turn.
      if (distance > 2) g.rotation.y = THREE.MathUtils.lerp(g.rotation.y, Math.atan2(step.x, step.z), 0.08);
    }
    if (agent.find && !agent.arrived) {
      // The found tower left the city's read: the goal fell back to the patrol, so there is nothing to open a card over.
      if (!placed) agent.drop();
      else if (distance < 1.5) agent.arrive(placed.tower, city.snapshot.source === 'live' && !isStale(city.snapshot.fetchedAt));
    }

    if (body.current) body.current.rotation.y = t * (hovering ? 0.8 : 2.2);
    if (ring.current) ring.current.rotation.z = t * 1.4;
    if (scan.current) {
      scan.current.visible = !hovering;
      scanMaterial.uniforms.uOpacity!.value = 0.16 + 0.06 * Math.sin(t * 3);
    }
    if (beam.current) {
      const drop = placed ? Math.max(1, g.position.y - placed.height) : 1;
      beam.current.visible = hovering && distance < 6;
      beam.current.scale.set(1, drop, 1);
      beam.current.position.y = -drop / 2;
      beam.current.material.opacity = 0.32 + 0.12 * Math.sin(t * 5);
    }
    if (halo.current) {
      // A halo so the drone reads from across the island: amber while it looks, mint over a find.
      halo.current.material.color.copy(hovering ? colors.mint : colors.amber).multiplyScalar(0.55);
      halo.current.scale.setScalar(16 + 2.5 * Math.sin(t * (hovering ? 4 : 2)));
    }
  });

  return (
    <group ref={group}>
      <sprite ref={halo} scale={16}>
        <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <group ref={body} scale={2.4}>
        <mesh scale={[1, 1.5, 1]}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={colors.amber} toneMapped={false} />
        </mesh>
        <mesh scale={[1.25, 1.85, 1.25]}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={colors.warm} wireframe transparent opacity={0.5} toneMapped={false} depthWrite={false} />
        </mesh>
        <mesh position={[1.9, 0.15, 0]}>
          <boxGeometry args={[1.6, 0.14, 0.5]} />
          <meshBasicMaterial color={colors.violet} toneMapped={false} />
        </mesh>
        <mesh position={[-1.9, 0.15, 0]}>
          <boxGeometry args={[1.6, 0.14, 0.5]} />
          <meshBasicMaterial color={colors.violet} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={-0.6}>
        <torusGeometry args={[4.4, 0.16, 6, 48]} />
        <meshBasicMaterial color={colors.amber} transparent opacity={0.75} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* The scan: a soft searchlight under the drone while it looks, fading before it reaches the roofs. */}
      <mesh ref={scan} position-y={-9} material={scanMaterial}>
        <coneGeometry args={[6, 16, 32, 1, true]} />
      </mesh>
      {/* The find: a beam from the drone to the roof; one unit tall, stretched each frame to the roof. */}
      <mesh ref={beam} visible={false}>
        <cylinderGeometry args={[0.6, 1.2, 1, 16, 1, true]} />
        <meshBasicMaterial color={colors.mint} transparent opacity={0.35} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** The scan's light: brightest at the drone, gone at the cone's mouth, so it reads as a beam, not a solid. */
function fadingCone(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uOpacity: { value: 0.16 } },
    vertexShader: /* glsl */ `
      varying float vUp;
      void main() {
        vUp = uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vUp;
      void main() {
        gl_FragColor = vec4(uColor, uOpacity * vUp * vUp);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
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
