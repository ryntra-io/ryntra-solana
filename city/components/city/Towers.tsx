'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createIconAtlas, slotUv, SLOTS_PER_ROW, MAX_SLOTS, type IconAtlas } from '@/city/lib/city/icons';
import type { PlacedTower } from '@/city/lib/city/layout';
import { share, SHARED } from '@/city/lib/city/shared';
import { useCity, useCityEvents, type CityEvent } from '@/city/lib/city/store';
import { lensY } from '@/city/lib/lens/uniforms';
import { isNamed, type District } from '@/city/lib/market/types';
import { PALETTE } from '@/city/lib/palette';
import { useTowerLens } from '../lens/useTowerLens';
import { createTowerMaterial } from './materials/towerMaterial';
import { Skyline } from './skyline/Skyline';
import { TowerState } from './skyline/state';
import { useSkyline } from './skyline/store';

const ACCENT: Record<District, string> = {
  core: '#C9A2FF',
  heights: PALETTE.violet,
  strip: PALETTE.amber,
  avenue: PALETTE.warmWhite,
  docks: PALETTE.mint,
};

/** Signs float only over the tallest towers, so the skyline reads as silhouettes, not a cloud of logos. */
const SIGNED = 12;

const color = (hex: string, scale = 1) => new THREE.Color(hex).multiplyScalar(scale);

function crownColor(t: PlacedTower): THREE.Color {
  const change = t.tower.change24h;
  if (change >= 5) return color(PALETTE.mint, 3.2);
  if (change <= -5) return color(PALETTE.flare, 3.2);
  return color(PALETTE.amber, 2.6);
}

/** What the scene does to a tower while an event plays. */
type Motion = { glow: THREE.Color; glowLevel: number; build: number; buildTarget: number; buildSpeed: number };

export function Towers({ towers }: { towers: PlacedTower[] }) {
  const count = towers.length;
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const crownRef = useRef<THREE.InstancedMesh>(null);
  const motions = useRef<Map<string, Motion>>(new Map());
  const indexOf = useMemo(() => new Map(towers.map((t, i) => [t.tower.id, i])), [towers]);

  // Bodies: a unit octagonal prism with enough rings for the taper and setbacks.
  const body = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 8, 14, false);
    geometry.translate(0, 0.5, 0);
    const size = new Float32Array(count * 2);
    const seed = new Float32Array(count);
    const kind = new Float32Array(count);
    const accent = new Float32Array(count * 3);
    const glow = new Float32Array(count * 4);
    const activity = new Float32Array(count);
    const build = new Float32Array(count);
    const lens = new Float32Array(count);
    towers.forEach((t, i) => {
      size.set([t.width, t.height], i * 2);
      seed[i] = t.seed % 100000;
      kind[i] = t.kind;
      color(ACCENT[t.tower.district], t.tower.district === 'core' ? 1.3 : 1.15).toArray(accent, i * 3);
      activity[i] = Math.min(1, Math.max(0.15, Math.log10(t.tower.traders1h + 1) / 3.6));
      build[i] = 1;
    });
    geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    geometry.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 1));
    geometry.setAttribute('aAccent', new THREE.InstancedBufferAttribute(accent, 3));
    geometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(glow, 4));
    geometry.setAttribute('aActivity', new THREE.InstancedBufferAttribute(activity, 1));
    geometry.setAttribute('aBuild', new THREE.InstancedBufferAttribute(build, 1));
    geometry.setAttribute('aLens', new THREE.InstancedBufferAttribute(lens, 1));
    return { geometry, material: share(createTowerMaterial()) };
  }, [towers, count]);

  // The same towers for the Blender skyline (CITY-56): what each one is and what a moment does to it, on the GPU.
  const state = useMemo(() => {
    const st = new TowerState(count);
    towers.forEach((t, i) => {
      const activity = Math.min(1, Math.max(0.15, Math.log10(t.tower.traders1h + 1) / 3.6));
      st.tower(i, color(ACCENT[t.tower.district], t.tower.district === 'core' ? 1.3 : 1.15), activity, t.height, t.seed, t.kind, t.x, t.z, t.width);
    });
    return st;
  }, [towers, count]);
  useEffect(() => () => state.dispose(), [state]);
  const skylineReady = useSkyline((st) => st.ready);

  // Crowns: the 24h move as a light on each roof, coloured mint, red or amber (CITY-56: an aviation light, a bright point
  // in a faint halo that breathes slowly, instead of a big glowing ball). A camera-facing quad sized in pixels, not in
  // world units: a few pixels at the skyline's distances, a little more when the eye is at the mast, the same on any
  // window. The colour is the move's hue at a capped brightness, so it never washes out to white and the bloom gives
  // it a glint, not a disc.
  const crown = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: SHARED.uTime, uViewportH: { value: 900 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aPhase;
        varying vec3 vColor;
        varying vec2 vUv;
        varying float vBlink;
        uniform float uTime;
        uniform float uViewportH;
        void main() {
          vec3 centre = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
          float dist = length(cameraPosition - centre);
          // Pixels per world unit at this distance (projectionMatrix[1][1] is 1 / tan of half the field of view).
          float pxPerUnit = projectionMatrix[1][1] * uViewportH * 0.5 / max(dist, 0.001);
          float radius = clamp(0.3 * pxPerUnit, 8.0, 20.0) / pxPerUnit;
          vec3 toCam = normalize(cameraPosition - centre);
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          vec3 up = cross(toCam, right);
          vec3 world = centre + (right * position.x + up * position.y) * radius;
          vUv = uv;
          vColor = aColor;
          vBlink = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(uTime * 1.5 + aPhase), 3.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying vec2 vUv;
        varying float vBlink;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          vec3 hue = vColor / max(max(vColor.r, vColor.g), max(vColor.b, 1e-3));
          float point = exp(-r * r * 34.0) * 1.25;
          float halo = exp(-r * r * 5.0) * 0.05;
          float a = (point * mix(0.75, 1.0, vBlink) + halo * vBlink) * (1.0 - smoothstep(0.8, 1.0, r));
          gl_FragColor = vec4(hue * a, 1.0);
        }
      `,
    });
    const colors = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    towers.forEach((t, i) => {
      crownColor(t).toArray(colors, i * 3);
      phase[i] = (t.seed % 1000) / 160;
    });
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    return { geometry, material };
  }, [towers, count]);

  // Signs: each token's logo floating over its crown, turned toward the viewer.
  const signed = useMemo(() => {
    const tallest = towers.filter((t) => isNamed(t.tower)).sort((a, b) => b.height - a.height).slice(0, SIGNED);
    return new Set(tallest.map((t) => t.tower.id));
  }, [towers]);
  // The atlas lives in an effect, so Strict Mode's mount–unmount–mount cannot leave a disposed atlas in use.
  const [atlas, setAtlas] = useState<IconAtlas | null>(null);
  useEffect(() => {
    const next = createIconAtlas(
      towers.map((t) => (isNamed(t.tower) ? { id: t.tower.id, symbol: t.tower.symbol, icon: t.tower.icon } : { id: t.tower.id, symbol: '', icon: null })),
      signed,
    );
    setAtlas(next);
    return () => next.dispose();
  }, [towers, signed]);
  const signs = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const center = new Float32Array(count * 3);
    const scale = new Float32Array(count);
    const uv = new Float32Array(count * 2);
    const ring = new Float32Array(count * 3);
    const lens = new Float32Array(count * 2);
    towers.forEach((t, i) => {
      const lift = t.kind === 3 ? 2.2 : t.width * 1.2 + 2.6;
      center.set([t.x, t.height + lift, t.z], i * 3);
      const sol = t.x === 0 && t.z === 0;
      scale[i] = signed.has(t.tower.id) ? Math.max(3.4, t.width * 1.3) * (sol ? 1.5 : 1) : 0;
      uv.set(slotUv(Math.min(i, MAX_SLOTS - 1)), i * 2);
      crownColor(t).multiplyScalar(0.8).toArray(ring, i * 3);
    });
    geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 3));
    geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(scale, 1));
    geometry.setAttribute('aSlot', new THREE.InstancedBufferAttribute(uv, 2));
    geometry.setAttribute('aRing', new THREE.InstancedBufferAttribute(ring, 3));
    // The Lens (CITY-86): x the tower's level (a sunk tower's sign goes), y how far its roof moved.
    geometry.setAttribute('aLens', new THREE.InstancedBufferAttribute(lens, 2));
    const material = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: null as THREE.Texture | null }, uSlot: { value: 1 / SLOTS_PER_ROW }, uTime: SHARED.uTime },
      vertexShader: /* glsl */ `
        attribute vec3 aCenter;
        attribute float aScale;
        attribute vec2 aSlot;
        attribute vec3 aRing;
        attribute vec2 aLens;
        varying vec2 vUv;
        varying vec2 vSlot;
        varying vec3 vRing;
        uniform float uTime;
        void main() {
          vec3 centre = aCenter + vec3(0.0, aLens.y, 0.0);
          float scale = aScale * (1.0 - clamp(-aLens.x, 0.0, 1.0));
          vec3 toCam = cameraPosition - centre;
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          float bob = sin(uTime * 1.3 + aCenter.x) * 0.25;
          vec3 world = centre + right * position.x * scale + vec3(0.0, position.y * scale + bob, 0.0);
          vUv = uv;
          vSlot = aSlot;
          vRing = aRing;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        uniform float uSlot;
        varying vec2 vUv;
        varying vec2 vSlot;
        varying vec3 vRing;
        void main() {
          vec2 c = vUv - 0.5;
          float r = length(c) * 2.0;
          if (r > 1.0) discard;
          vec3 logo = texture2D(uAtlas, vSlot + vUv * uSlot).rgb;
          float ring = smoothstep(0.8, 0.88, r);
          vec3 col = mix(logo * 1.15, vRing * 1.6, ring);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    return { geometry, material };
  }, [towers, count, signed]);
  useEffect(() => {
    signs.material.uniforms.uAtlas!.value = atlas?.texture ?? null;
  }, [atlas, signs]);

  // A tower in the middle of an event, or the one you tapped, shows its sign even when it is not among the tallest.
  const selectedId = useCity((st) => st.selectedId);
  const shown = useRef<Set<string>>(new Set());
  useEffect(() => {
    const attr = signs.geometry.getAttribute('aScale') as THREE.InstancedBufferAttribute;
    const reveal = (id: string | null, on: boolean) => {
      if (!id || signed.has(id)) return;
      const i = indexOf.get(id);
      const t = i === undefined ? undefined : towers[i];
      if (i === undefined || !t || !isNamed(t.tower)) return;
      attr.setX(i, on ? Math.max(3.4, t.width * 1.3) : 0);
      attr.needsUpdate = true;
    };
    for (const id of shown.current) reveal(id, false);
    shown.current = new Set(selectedId ? [selectedId] : []);
    reveal(selectedId, true);
  }, [selectedId, signs, signed, indexOf, towers]);

  // Halo rings around the tallest spires, echoing the Eclipse: a thin band of light whose glow falls off softly above
  // and below (CITY-56), not a thick tube.
  const halos = useMemo(() => towers.filter((t) => t.kind === 0 && t.height > 36), [towers]);
  const halo = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: color(PALETTE.violet, 1.3) } },
      vertexShader: /* glsl */ `
        varying float vV;
        void main() { vV = uv.y; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vV;
        void main() {
          float d = abs(vV - 0.5) * 2.0;
          float a = exp(-d * d * 90.0) * 0.85 + exp(-d * 4.0) * 0.12;
          gl_FragColor = vec4(uColor * a, 1.0);
        }
      `,
    });
    return { geometry, material };
  }, []);

  // Light pools on the ground at each tower's feet.
  const pools = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const tint = new Float32Array(count * 3);
    towers.forEach((t, i) => color(ACCENT[t.tower.district], 0.9).lerp(color(PALETTE.amber), 0.5).toArray(tint, i * 3));
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec3 aTint;
        varying vec2 vUv;
        varying vec3 vTint;
        void main() { vUv = uv; vTint = aTint; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vTint;
        void main() { float r = length(vUv - 0.5) * 2.0; float a = pow(max(0.0, 1.0 - r), 2.2); gl_FragColor = vec4(vTint * a * 0.55, 1.0); }
      `,
    });
    return { geometry, material };
  }, [towers, count]);

  // Place everything once per layout.
  useEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const bodies = bodyRef.current;
    const crowns = crownRef.current;
    towers.forEach((t, i) => {
      q.setFromAxisAngle(up, ((t.seed % 360) * Math.PI) / 180);
      m.compose(p.set(t.x, 0, t.z), q, s.set(1, 1, 1));
      bodies?.setMatrixAt(i, m);
      const crownSize = t.kind === 3 ? 0.35 : Math.max(0.55, t.width * 0.34);
      m.compose(p.set(t.x, t.height + 0.15, t.z), q.identity(), s.setScalar(crownSize));
      crowns?.setMatrixAt(i, m);
    });
    if (bodies) {
      bodies.instanceMatrix.needsUpdate = true;
      bodies.computeBoundingSphere();
    }
    if (crowns) {
      crowns.instanceMatrix.needsUpdate = true;
      crowns.computeBoundingSphere();
    }
    motions.current = new Map();
  }, [towers]);

  const haloRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = haloRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    halos.forEach((t, i) => {
      const r = t.width * 1.45;
      m.makeScale(r, 0.5, r).setPosition(t.x, t.height * 0.7, t.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [halos]);

  const poolRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = poolRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    towers.forEach((t, i) => {
      const r = t.width * 4.2;
      m.makeScale(r, 1, r).setPosition(t.x, 0.03, t.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [towers]);

  // Events: pumps glow mint and climb, flares knock the top off and burn, launches grow from the ground.
  useCityEvents((event: CityEvent) => {
    const index = indexOf.get(event.towerId);
    if (index === undefined) return;
    const motion: Motion = motions.current.get(event.towerId) ?? { glow: new THREE.Color(), glowLevel: 0, build: 1, buildTarget: 1, buildSpeed: 1 };
    if (event.kind === 'pump') {
      motion.glow.set(PALETTE.mint).multiplyScalar(1.6);
      motion.glowLevel = 1.4;
    } else if (event.kind === 'flare') {
      motion.glow.set(PALETTE.flare).multiplyScalar(1.4);
      motion.glowLevel = 1.6;
      motion.buildTarget = 0.78;
      motion.buildSpeed = 4;
    } else {
      motion.glow.set(PALETTE.mint).multiplyScalar(1.2);
      motion.glowLevel = 1.2;
      motion.build = 0.02;
      motion.buildTarget = 1;
      motion.buildSpeed = 0.55;
    }
    motions.current.set(event.towerId, motion);
    // The tower in the spotlight shows its logo while the moment plays.
    const t = towers[index];
    if (t && !signed.has(t.tower.id) && isNamed(t.tower)) {
      const attr = signs.geometry.getAttribute('aScale') as THREE.InstancedBufferAttribute;
      attr.setX(index, Math.max(3.4, t.width * 1.3));
      attr.needsUpdate = true;
      setTimeout(() => {
        if (useCity.getState().selectedId === t.tower.id) return;
        attr.setX(index, 0);
        attr.needsUpdate = true;
      }, 9000);
    }
  });

  // The Lens (CITY-86): the towers of the picked chip rise in violet light, the rest sink into the haze — the bodies and
  // modules in their shaders, the crowns, signs and halos here.
  const lens = useTowerLens(towers, (levels, move) => {
    const bodyLens = body.geometry.getAttribute('aLens') as THREE.InstancedBufferAttribute;
    const signLens = signs.geometry.getAttribute('aLens') as THREE.InstancedBufferAttribute;
    const crowns = crownRef.current;
    const m = new THREE.Matrix4();
    towers.forEach((t, i) => {
      const level = levels[i] ?? 0;
      bodyLens.setX(i, level);
      state.lens(i, level);
      signLens.setXY(i, level, lensY(t.height, t.height, level, move) - t.height);
      if (!crowns) return;
      const build = motions.current.get(t.tower.id)?.build ?? 1;
      const crownSize = t.kind === 3 ? 0.35 : Math.max(0.55, t.width * 0.34);
      crowns.setMatrixAt(i, m.makeScale(crownSize, crownSize, crownSize).setPosition(t.x, lensY(t.height * build, t.height, level, move) + 0.15, t.z));
    });
    bodyLens.needsUpdate = true;
    signLens.needsUpdate = true;
    if (crowns) crowns.instanceMatrix.needsUpdate = true;
    const rings = haloRef.current;
    if (rings) {
      halos.forEach((t, i) => {
        const r = t.width * 1.45;
        rings.setMatrixAt(i, m.makeScale(r, 0.5, r).setPosition(t.x, lensY(t.height * 0.7, t.height, levels[indexOf.get(t.tower.id) ?? -1] ?? 0, move), t.z));
      });
      rings.instanceMatrix.needsUpdate = true;
    }
  });

  const buffer = useMemo(() => new THREE.Vector2(), []);
  useFrame(({ gl }) => {
    crown.material.uniforms.uViewportH!.value = gl.getDrawingBufferSize(buffer).y;
  });

  useFrame((_, dt) => {
    const geometry = body.geometry;
    if (!motions.current.size) return;
    const glowAttr = geometry.getAttribute('aGlow') as THREE.InstancedBufferAttribute;
    const buildAttr = geometry.getAttribute('aBuild') as THREE.InstancedBufferAttribute;
    for (const [id, motion] of motions.current) {
      const i = indexOf.get(id);
      if (i === undefined) continue;
      motion.glowLevel = Math.max(0, motion.glowLevel - dt * 0.16);
      const diff = motion.buildTarget - motion.build;
      motion.build += diff * Math.min(1, dt * motion.buildSpeed);
      // After a flare the tower slowly rebuilds: the city heals, the scar stays in the feed.
      if (motion.buildTarget < 1 && Math.abs(diff) < 0.01) {
        motion.buildTarget = 1;
        motion.buildSpeed = 0.08;
      }
      glowAttr.setXYZW(i, motion.glow.r, motion.glow.g, motion.glow.b, motion.glowLevel);
      buildAttr.setX(i, motion.build);
      state.glow(i, motion.glow.r, motion.glow.g, motion.glow.b, motion.glowLevel);
      state.build(i, motion.build);
      const crowns = crownRef.current;
      if (crowns) {
        const t = towers[i]!;
        const m = new THREE.Matrix4();
        const crownSize = t.kind === 3 ? 0.35 : Math.max(0.55, t.width * 0.34);
        m.makeScale(crownSize, crownSize, crownSize).setPosition(t.x, lensY(t.height * motion.build, t.height, lens.current[i] ?? 0, lens.move) + 0.15, t.z);
        crowns.setMatrixAt(i, m);
        crowns.instanceMatrix.needsUpdate = true;
      }
      if (motion.glowLevel <= 0 && Math.abs(motion.buildTarget - motion.build) < 0.002) motions.current.delete(id);
    }
    glowAttr.needsUpdate = true;
    buildAttr.needsUpdate = true;
  });

  // Signs face the camera in the shader; keep their bounds generous so culling never drops them.
  useEffect(() => {
    signs.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 400);
  }, [signs]);

  if (!count) return null;
  return (
    <group>
      <instancedMesh ref={bodyRef} args={[body.geometry, body.material, count]} frustumCulled={false} visible={!skylineReady} />
      <Skyline towers={towers} state={state} />
      <instancedMesh ref={crownRef} args={[crown.geometry, crown.material, count]} frustumCulled={false} />
      <instancedMesh args={[signs.geometry, signs.material, count]} frustumCulled={false} />
      {halos.length > 0 && <instancedMesh ref={haloRef} args={[halo.geometry, halo.material, halos.length]} frustumCulled={false} />}
      <instancedMesh ref={poolRef} args={[pools.geometry, pools.material, count]} frustumCulled={false} renderOrder={1} />
    </group>
  );
}
