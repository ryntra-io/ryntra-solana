'use client';

import type { CameraControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useAssistant } from '@/city/lib/assistant/store';
import { useCity } from '@/city/lib/city/store';
import { useFlashing } from '@/city/lib/feed/motion';
import { newRings } from '@/city/lib/lens/lens';
import { lensShot } from '@/city/lib/lens/shot';
import { useNewLaunches } from '@/city/lib/lens/new-store';
import { useLens } from '@/city/lib/lens/store';
import { easeLens, LENS_MS, lensY } from '@/city/lib/lens/uniforms';
import { PALETTE } from '@/city/lib/palette';
import { quarterStore } from '@/city/lib/quarter/store';
import { useRun } from '@/city/lib/run/store';
import { useLensSet } from './useLensSet';

/**
 * «New» on the ground (CITY-86): three rings of violet light round the island — the fresh launches at the edge, the ones
 * near graduation a step in, the graduated where the skyline begins — with a slow light drifting inward along them, the
 * way a launch travels. Brighter where a stage has towers today. Still, without the drift, when motion is off.
 */
export function LensRings() {
  const lens = useLens((st) => st.lens);
  const { towers, ctx } = useLensSet();
  const still = !useFlashing();
  const rings = useMemo(() => newRings(towers, ctx), [towers, ctx]);
  const mesh = useMemo(() => {
    const size = 160;
    const geometry = new THREE.PlaneGeometry(size, size);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uOn: { value: 0 },
        uTime: { value: 0 },
        uDrift: { value: 1 },
        uRadii: { value: new THREE.Vector3(62, 50, 34) },
        uLevels: { value: new THREE.Vector3(1, 1, 1) },
        uColor: { value: new THREE.Color(PALETTE.violet).multiplyScalar(1.5) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vXZ;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vXZ = world.xz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOn;
        uniform float uTime;
        uniform float uDrift;
        uniform vec3 uRadii;
        uniform vec3 uLevels;
        uniform vec3 uColor;
        varying vec2 vXZ;
        float ring(float r, float radius, float level, float phase) {
          float line = exp(-pow((r - radius) / 0.45, 2.0)) * 1.6;
          float halo = exp(-pow((r - radius) / 2.4, 2.0)) * 0.3;
          // Dashes of light drifting round each ring, slower toward the skyline.
          float a = atan(vXZ.x, -vXZ.y);
          float dash = 0.55 + 0.45 * smoothstep(0.35, 0.9, sin(a * radius * 0.5 - uTime * uDrift * 1.2 + phase));
          return (line * dash + halo) * level;
        }
        void main() {
          float r = length(vXZ);
          // A soft wave travelling inward: the way from the edge to the skyline.
          float wave = 0.75 + 0.25 * sin(r * 0.18 + uTime * uDrift * 1.4);
          float light = ring(r, uRadii.x, uLevels.x, 0.0) + ring(r, uRadii.y, uLevels.y, 2.1) + ring(r, uRadii.z, uLevels.z, 4.2);
          gl_FragColor = vec4(uColor * light * wave * uOn, 1.0);
        }
      `,
    });
    return { geometry, material };
  }, []);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
    [mesh],
  );
  useEffect(() => {
    const u = mesh.material.uniforms;
    u.uRadii!.value.set(rings.fresh.radius, rings.near.radius, rings.graduated.radius);
    u.uLevels!.value.set(rings.fresh.count ? 1 : 0.35, rings.near.count ? 1 : 0.35, rings.graduated.count ? 1 : 0.35);
    u.uDrift!.value = still ? 0 : 1;
  }, [mesh, rings, still]);
  const on = lens === 'new';
  const fade = useRef({ from: 0, at: 0 });
  useEffect(() => {
    fade.current = { from: mesh.material.uniforms.uOn!.value as number, at: performance.now() };
  }, [on, mesh]);
  useFrame(({ clock }) => {
    const u = mesh.material.uniforms;
    u.uTime!.value = clock.elapsedTime;
    const k = easeLens((performance.now() - fade.current.at) / LENS_MS);
    u.uOn!.value = fade.current.from + ((on ? 1 : 0) - fade.current.from) * k;
  });
  return (
    <>
      <mesh geometry={mesh.geometry} material={mesh.material} position={[0, 0.08, 0]} renderOrder={2} frustumCulled={false} />
      <LensLighthouse />
    </>
  );
}

/** How tall the beacon's shaft of light stands over its tower, and how far its sweep reaches. */
const SHAFT = 34;
const SWEEP = 22;
/** A turn of the sweep, in seconds: slow, a harbour's lighthouse, not a siren. */
const TURN_S = 9;

/**
 * «Маяк» in the city (CITY-142): over the one coin the most different wallets bought, a shaft of the stored sun's light
 * and a slow beam sweeping round from its crown, while «New» is looked at. Three small draws, shared by nothing else. Without
 * motion the beam stands still and the shaft is all there is to see.
 */
function LensLighthouse() {
  const lens = useLens((st) => st.lens);
  const mint = useNewLaunches((st) => st.lighthouse?.mint ?? null);
  const layout = useCity((st) => st.layout);
  const still = !useFlashing();
  const placed = useMemo(() => (mint ? (layout.towers.find((t) => t.tower.id === mint) ?? null) : null), [mint, layout]);
  const group = useRef<THREE.Group>(null);
  const sweep = useRef<THREE.Group>(null);
  const parts = useMemo(() => {
    const uniforms = { uOn: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(PALETTE.amber).multiplyScalar(1.8) }, uCore: { value: new THREE.Color(PALETTE.warmWhite).multiplyScalar(2.2) } };
    const shaftGeometry = new THREE.CylinderGeometry(0.42, 0.42, SHAFT, 18, 1, true);
    shaftGeometry.translate(0, SHAFT / 2, 0);
    const shaft = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vUv = uv;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - world.xyz);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOn;
        uniform float uTime;
        uniform vec3 uColor;
        uniform vec3 uCore;
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          // Brightest at the crown, gone at the top; a soft core where the shaft faces the eye.
          float rise = pow(1.0 - vUv.y, 1.6);
          float core = pow(abs(dot(vNormal, vView)), 2.0);
          float shimmer = 0.88 + 0.12 * sin(vUv.y * 40.0 - uTime * 2.0);
          vec3 color = mix(uColor, uCore, core * 0.6) * (0.25 + core * 0.9) * rise * shimmer;
          gl_FragColor = vec4(color * uOn, 1.0);
        }
      `,
    });
    // The sweep: two blades of light, a lamp's two lenses, fading out from the crown.
    const bladeGeometry = new THREE.PlaneGeometry(SWEEP, 3.2, 1, 1);
    bladeGeometry.translate(SWEEP / 2, 0, 0);
    bladeGeometry.rotateX(-Math.PI / 2);
    const blade = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOn;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
          float out_ = pow(1.0 - vUv.x, 1.8);
          float edge = pow(1.0 - abs(vUv.y - 0.5) * 2.0, 1.5) * smoothstep(0.0, 0.08, vUv.x + 0.02);
          gl_FragColor = vec4(uColor * 0.55 * out_ * edge * uOn, 1.0);
        }
      `,
    });
    return { uniforms, shaftGeometry, shaft, bladeGeometry, blade };
  }, []);
  useEffect(
    () => () => {
      parts.shaftGeometry.dispose();
      parts.shaft.dispose();
      parts.bladeGeometry.dispose();
      parts.blade.dispose();
    },
    [parts],
  );
  const on = lens === 'new' && placed !== null;
  const fade = useRef({ from: 0, at: 0 });
  useEffect(() => {
    fade.current = { from: parts.uniforms.uOn.value, at: performance.now() };
  }, [on, parts]);
  useFrame(({ clock }, delta) => {
    const u = parts.uniforms;
    const k = easeLens((performance.now() - fade.current.at) / LENS_MS);
    u.uOn.value = fade.current.from + ((on ? 1 : 0) - fade.current.from) * k;
    u.uTime.value = clock.elapsedTime;
    if (group.current) group.current.visible = u.uOn.value > 0.002 && placed !== null;
    if (sweep.current && !still) sweep.current.rotation.y -= (delta * Math.PI * 2) / TURN_S;
  });
  // The crown of the tower as the lens raised it: the beacon's tower is one of the looked-at.
  const top = placed ? lensY(placed.height, placed.height, 1, still ? 0 : 1) + 0.4 : 0;
  return (
    <group ref={group} position={[placed?.x ?? 0, top, placed?.z ?? 0]} visible={false}>
      <mesh geometry={parts.shaftGeometry} material={parts.shaft} renderOrder={3} frustumCulled={false} />
      <group ref={sweep} rotation={[0, 0.6, 0]}>
        <mesh geometry={parts.bladeGeometry} material={parts.blade} renderOrder={3} frustumCulled={false} />
        <mesh geometry={parts.bladeGeometry} material={parts.blade} rotation={[0, Math.PI, 0]} renderOrder={3} frustumCulled={false} />
      </group>
    </group>
  );
}

/**
 * The camera under the lens: a picked chip eases the camera to frame its towers; «All» flies back to the establishing
 * shot. Framed again after a picked tower closes and after the market redraws the city (the director flies home then).
 * With motion off the camera stays where it is: only the light changes.
 */
export function LensCamera() {
  const controls = useThree((s) => s.controls) as unknown as CameraControls | null;
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const lens = useLens((st) => st.lens);
  const at = useLens((st) => st.at);
  const selectedId = useCity((st) => st.selectedId);
  const entered = useCity((st) => st.entered);
  const { towers, set } = useLensSet();
  const still = !useFlashing();
  const framed = useRef(false);
  const key = set.map((t) => t.tower.id).join(',');
  const setRef = useRef(set);
  setRef.current = set;
  const lastAt = useRef(at);
  useEffect(() => {
    if (!controls || still || selectedId || useRun.getState().phase !== 'off' || quarterStore.getState().mode !== 'city') return;
    // Ryntra's answer holds the camera on its towers: only a new tap on a chip takes it over, not the market's refresh.
    const tapped = lastAt.current !== at;
    lastAt.current = at;
    if (!tapped && useAssistant.getState().shown.length) return;
    if (lens === 'all' || !setRef.current.length) {
      // Back to the skyline once, when a chip is let go; the director owns the camera otherwise.
      if (framed.current) useCity.setState({ homeAt: Date.now() });
      framed.current = false;
      return;
    }
    const portrait = size.width < size.height;
    const shot = lensShot(setRef.current, [camera.position.x, camera.position.y, camera.position.z], portrait);
    if (!shot) return;
    framed.current = true;
    // The attract orbit waits after a framing as after a touch.
    useCity.getState().touch();
    void controls.setLookAt(...shot, true);
    // Re-framed on a new set, a new chip (`at`), a redrawn city (the director has just flown home), a closed tower card,
    // the city entered, the screen turned.
  }, [controls, camera, lens, at, key, towers, selectedId, entered, still, size.width, size.height]);
  return null;
}
