'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { rng } from '@/city/lib/city/layout';
import { SHARED } from '@/city/lib/city/shared';
import { useCity, useCityEvents, type CityEvent } from '@/city/lib/city/store';
import { flashingOn } from '@/city/lib/feed/motion';
import { PALETTE } from '@/city/lib/palette';

/**
 * The city's moments, all from fixed pools so nothing compiles mid-show:
 *  - bursts: 8 slots of GPU particles (fireworks for pumps, Solar Flare sparks for drops, sparkle for launches);
 *  - flashes: 4 billboards with the white-hot core and the expanding shockwave ring;
 *  - beams: 3 light columns that stand where a new tower grows.
 * Each event also fires the shared flash light (facades nearby light up) and a coloured Slot Pulse from the tower.
 */
const BURSTS = 8;
const PER_BURST = 640;
const FLASHES = 4;
const BEAMS = 3;

const KIND = { pump: 0, flare: 1, launch: 2 } as const;

type BurstKind = keyof typeof KIND;
let fire: ((at: THREE.Vector3, kind: BurstKind, color: THREE.Color, flash: number) => void) | null = null;

/**
 * A burst from the same pools at any point: the run's crash, break, save and finish use it.
 * `flash` > 0 also fires the white-hot core and shockwave at that size and lights the facades around it.
 */
export function fxBurst(at: THREE.Vector3, kind: BurstKind, color: THREE.Color, flash = 0) {
  fire?.(at, kind, color, flash);
}

export function Fx() {
  const layout = useCity((s) => s.layout);
  const bursts = useMemo(createBursts, []);
  const flashes = useMemo(createFlashes, []);
  const beams = useMemo(createBeams, []);
  const nextBurst = useRef(0);
  const nextFlash = useRef(0);
  const nextBeam = useRef(0);
  const clock = useRef(0);

  useCityEvents((event: CityEvent) => {
    const tower = layout.towers.find((t) => t.tower.id === event.towerId);
    if (!tower) return;
    const now = clock.current;
    const top = new THREE.Vector3(tower.x, tower.height + 1, tower.z);
    const tint = new THREE.Color(event.kind === 'flare' ? PALETTE.amber : PALETTE.mint);

    // Particles.
    const b = nextBurst.current++ % BURSTS;
    const u = bursts.material.uniforms;
    (u.uOrigin!.value as THREE.Vector3[])[b]!.copy(event.kind === 'launch' ? top.clone().setY(tower.height * 0.5) : top);
    (u.uStart!.value as number[])[b] = now + (event.kind === 'pump' ? 0.25 : 0);
    (u.uKind!.value as number[])[b] = KIND[event.kind];
    (u.uColor!.value as THREE.Color[])[b]!.copy(tint).multiplyScalar(event.kind === 'flare' ? 4 : 3.2);
    (u.uScale!.value as number[])[b] = 1;
    (u.uSpread!.value as number[])[b] = 1;
    // A pump throws a second, higher volley a beat later.
    if (event.kind === 'pump') {
      const b2 = nextBurst.current++ % BURSTS;
      (u.uOrigin!.value as THREE.Vector3[])[b2]!.copy(top).setY(top.y + 6);
      (u.uStart!.value as number[])[b2] = now + 0.65;
      (u.uKind!.value as number[])[b2] = KIND.pump;
      (u.uScale!.value as number[])[b2] = 1;
      (u.uSpread!.value as number[])[b2] = 1;
      (u.uColor!.value as THREE.Color[])[b2]!.set(PALETTE.amber).multiplyScalar(3.6);
    }

    // «Flashing effects» off (the feed's «Show on home», CITY-66): the sparks still fly, nothing flashes or pulses.
    // The camera's shake is held in the city's store for every caller.
    const flash = flashingOn();

    // Flash and shockwave for drops and launches.
    if (event.kind !== 'pump' && flash) {
      const f = nextFlash.current++ % FLASHES;
      const mesh = flashes.meshes[f]!;
      mesh.position.copy(event.kind === 'launch' ? top.clone().setY(2) : top);
      mesh.scale.setScalar(event.kind === 'flare' ? 70 : 40);
      const mu = (mesh.material as THREE.ShaderMaterial).uniforms;
      mu.uStart!.value = now;
      (mu.uColor!.value as THREE.Color).set(event.kind === 'flare' ? PALETTE.warmWhite : PALETTE.mint);
    }

    // Light column where a new tower grows.
    if (event.kind === 'launch') {
      const k = nextBeam.current++ % BEAMS;
      const beam = beams.meshes[k]!;
      beam.position.set(tower.x, 0, tower.z);
      (beam.material as THREE.ShaderMaterial).uniforms.uStart!.value = now;
    }

    // The whole city reacts.
    if (flash) {
      SHARED.uFlashPos.value.copy(top);
      SHARED.uFlashTime.value = now;
      SHARED.uFlashColor.value.set(event.kind === 'flare' ? PALETTE.amber : PALETTE.mint).multiplyScalar(event.kind === 'flare' ? 1.4 : 0.8);
      SHARED.uPulseOrigin.value.set(tower.x, tower.z);
      SHARED.uPulseTime.value = now;
      SHARED.uPulseStrength.value = event.kind === 'flare' ? 1.3 : 1.0;
      SHARED.uPulseColor.value.set(event.kind === 'flare' ? PALETTE.flare : PALETTE.mint);
    }
    useCity.getState().shake(event.kind === 'flare' ? 0.85 : event.kind === 'launch' ? 0.35 : 0.25);
  });

  useEffect(() => {
    fire = (at, kind, color, flash) => {
      const now = clock.current;
      const u = bursts.material.uniforms;
      const b = nextBurst.current++ % BURSTS;
      (u.uOrigin!.value as THREE.Vector3[])[b]!.copy(at);
      (u.uStart!.value as number[])[b] = now;
      (u.uKind!.value as number[])[b] = KIND[kind];
      (u.uColor!.value as THREE.Color[])[b]!.copy(color).multiplyScalar(3.4);
      (u.uScale!.value as number[])[b] = 0.2;
      (u.uSpread!.value as number[])[b] = 0.22;
      // Every caller's white flash (the run, the quarter) waits for «Flashing effects» (CITY-66).
      if (flash > 0 && flashingOn()) {
        const f = nextFlash.current++ % FLASHES;
        const mesh = flashes.meshes[f]!;
        mesh.position.copy(at);
        mesh.scale.setScalar(flash);
        const mu = (mesh.material as THREE.ShaderMaterial).uniforms;
        mu.uStart!.value = now;
        (mu.uColor!.value as THREE.Color).copy(color);
        SHARED.uFlashPos.value.copy(at);
        SHARED.uFlashTime.value = now;
        SHARED.uFlashColor.value.copy(color).multiplyScalar(0.9);
      }
    };
    return () => {
      fire = null;
    };
  }, [bursts, flashes]);

  useFrame(({ clock: c, viewport }) => {
    clock.current = c.elapsedTime;
    bursts.material.uniforms.uPixel!.value = viewport.dpr;
  });

  return (
    <>
      <points geometry={bursts.geometry} material={bursts.material} frustumCulled={false} renderOrder={5} />
      {flashes.meshes.map((m, i) => (
        <primitive key={`f${i}`} object={m} />
      ))}
      {beams.meshes.map((m, i) => (
        <primitive key={`b${i}`} object={m} />
      ))}
    </>
  );
}

function createBursts() {
  const random = rng(97);
  const count = BURSTS * PER_BURST;
  const geometry = new THREE.BufferGeometry();
  const slot = new Float32Array(count);
  const dir = new Float32Array(count * 3);
  const rand = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    slot[i] = Math.floor(i / PER_BURST);
    // Uniform direction on the sphere.
    const z = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    dir.set([Math.cos(a) * r, z, Math.sin(a) * r], i * 3);
    rand.set([random(), random(), random()], i * 3);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute('aSlot', new THREE.BufferAttribute(slot, 1));
  geometry.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: SHARED.uTime,
      uOrigin: { value: Array.from({ length: BURSTS }, () => new THREE.Vector3(0, -999, 0)) },
      uStart: { value: Array.from({ length: BURSTS }, () => -100) },
      uKind: { value: Array.from({ length: BURSTS }, () => 0) },
      uColor: { value: Array.from({ length: BURSTS }, () => new THREE.Color()) },
      uScale: { value: Array.from({ length: BURSTS }, () => 1) },
      uSpread: { value: Array.from({ length: BURSTS }, () => 1) },
      uViolet: { value: new THREE.Color(PALETTE.violet).multiplyScalar(2.5) },
      uWhite: { value: new THREE.Color(PALETTE.warmWhite).multiplyScalar(6) },
      uPixel: { value: 1 },
    },
    vertexShader: /* glsl */ `
      #define BURSTS ${BURSTS}
      attribute float aSlot;
      attribute vec3 aDir;
      attribute vec3 aRand;
      uniform float uTime;
      uniform vec3 uOrigin[BURSTS];
      uniform float uStart[BURSTS];
      uniform float uKind[BURSTS];
      uniform vec3 uColor[BURSTS];
      uniform float uScale[BURSTS];
      uniform float uSpread[BURSTS];
      uniform vec3 uViolet;
      uniform vec3 uWhite;
      uniform float uPixel;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        int k = int(aSlot);
        float age = uTime - uStart[k];
        float kind = uKind[k];
        float life = kind > 0.5 && kind < 1.5 ? 1.1 + aRand.y * 1.0 : 1.5 + aRand.y * 1.2;
        if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
        float t = age / life;
        vec3 dir = aDir;
        float speed;
        float gravity;
        if (kind < 0.5) {            // firework: a sphere that blooms then falls
          speed = 26.0 + aRand.x * 14.0; gravity = 8.0;
        } else if (kind < 1.5) {     // Solar Flare sparks: fast, flattened into a ring, then hanging embers
          dir = normalize(vec3(dir.x, dir.y * 0.45 + 0.15, dir.z));
          speed = 34.0 + aRand.x * 40.0; gravity = 10.0;
        } else {                      // launch sparkle: a fountain up the beam
          dir = normalize(vec3(dir.x * 0.35, abs(dir.y) + 0.8, dir.z * 0.35));
          speed = 22.0 + aRand.x * 28.0; gravity = 6.0;
        }
        float drag = (1.0 - exp(-age * 2.6)) / 2.6;
        vec3 pos = uOrigin[k] + (dir * speed * drag - vec3(0.0, gravity * age * age * 0.5, 0.0)) * uSpread[k];
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mv;
        float size = (kind > 0.5 && kind < 1.5) ? mix(5.5, 2.0, t) : mix(4.6, 1.8, t);
        // Close to the camera (a run's burst) sparks stay sparks, never blobs.
        gl_PointSize = min(size * uPixel * (300.0 / -mv.z) * (0.7 + aRand.z * 0.6) * uScale[k], 26.0 * uPixel);
        // Colour over life: flare sparks go white → amber → violet; fireworks keep their colour and twinkle.
        if (kind > 0.5 && kind < 1.5) {
          vColor = t < 0.25 ? mix(uWhite, uColor[k], t / 0.25) : mix(uColor[k], uViolet, (t - 0.25) / 0.75);
        } else {
          vColor = uColor[k] * (0.75 + 0.5 * step(0.5, fract(age * 14.0 + aRand.z * 7.0)));
        }
        vAlpha = 1.0 - smoothstep(0.65, 1.0, t);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        if (d > 1.0) discard;
        float core = pow(1.0 - d, 2.4);
        gl_FragColor = vec4(vColor * core * vAlpha, 1.0);
      }
    `,
  });
  return { geometry, material };
}

function createFlashes() {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const meshes = Array.from({ length: FLASHES }, () => {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: SHARED.uTime, uStart: { value: -100 }, uColor: { value: new THREE.Color(PALETTE.warmWhite) }, uViolet: { value: new THREE.Color(PALETTE.violet) }, uMint: { value: new THREE.Color(PALETTE.mint) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          // Billboard: keep the quad facing the camera.
          vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
          gl_Position = projectionMatrix * (center + vec4(position.xy * scale * 0.5, 0.0, 0.0));
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uStart;
        uniform vec3 uColor;
        uniform vec3 uViolet;
        uniform vec3 uMint;
        varying vec2 vUv;
        void main() {
          float age = uTime - uStart;
          if (age < 0.0 || age > 1.6) discard;
          float r = length(vUv);
          // 0–70 ms: white-hot core; then the corona afterglow.
          float core = exp(-r * 9.0) * (exp(-age * 9.0) * 14.0 + exp(-age * 2.2) * 1.4);
          // 0–600 ms: the shockwave ring, violet at the edge.
          float front = age * 1.7;
          float ring = exp(-pow((r - front) / 0.035, 2.0)) * exp(-age * 2.8);
          vec3 col = uColor * core + mix(uViolet, uMint, 0.25) * ring * 4.0;
          // Anamorphic streak through the flash.
          float streak = exp(-abs(vUv.y) * 60.0) * exp(-abs(vUv.x) * 1.6) * exp(-age * 3.5) * 3.0;
          col += uColor * streak;
          col *= smoothstep(1.0, 0.85, r);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.position.set(0, -999, 0);
    return mesh;
  });
  return { meshes };
}

function createBeams() {
  const geometry = new THREE.CylinderGeometry(0.7, 1.6, 140, 24, 1, true);
  geometry.translate(0, 70, 0);
  const meshes = Array.from({ length: BEAMS }, () => {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: SHARED.uTime, uStart: { value: -100 }, uMint: { value: new THREE.Color(PALETTE.mint) }, uWarm: { value: new THREE.Color(PALETTE.warmWhite) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vFres;
        void main() {
          vUv = uv;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vec3 n = normalize(mat3(modelMatrix) * normal);
          vFres = abs(dot(n, normalize(cameraPosition - world.xyz)));
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uStart;
        uniform vec3 uMint;
        uniform vec3 uWarm;
        varying vec2 vUv;
        varying float vFres;
        void main() {
          float age = uTime - uStart;
          if (age < 0.0 || age > 5.0) discard;
          float env = smoothstep(0.0, 0.25, age) * (1.0 - smoothstep(2.5, 5.0, age));
          float bands = 0.6 + 0.4 * sin(vUv.y * 60.0 - uTime * 18.0);
          float fadeUp = pow(1.0 - vUv.y, 1.6);
          float core = pow(vFres, 2.0);
          vec3 col = mix(uMint, uWarm, core * 0.6) * (core * 2.5 + 0.3) * bands * fadeUp * env * 2.4;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.position.set(0, -999, 0);
    return mesh;
  });
  return { meshes };
}
