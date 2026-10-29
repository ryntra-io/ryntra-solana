'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY, FOG_FALLOFF, GLSL_COMMON, GLSL_FOG_PARS } from '@/city/lib/city/glsl';
import { ISLAND_RADIUS, PLAZA_RADIUS, RING_ROADS, rng, SPOKES, type CityLayout } from '@/city/lib/city/layout';
import { GLSL_SHARED, SHARED, share } from '@/city/lib/city/shared';
import { BUDGET } from '@/city/lib/city/quality';
import { useCity } from '@/city/lib/city/store';
import { PALETTE } from '@/city/lib/palette';
import { moduleGeometry, releaseModule, restoreModule, type Kit } from './kit';
import { GLSL_LIGHT, shareLight } from './light';
import { createSkylineMaterial } from './skylineMaterial';

/** Where the poles and the people stand from a road's centre line (the ground shader's kerb is at 1.55). */
const POLE = 1.9;
const WALK = 2.15;
const LAMP_STEP = 2.6;

/**
 * Life on the streets (CITY-56), all moved on the GPU: cars with headlights that throw light ahead on the asphalt
 * and amber tail lights, on four lanes of every ring road and spoke; street lights on both kerbs where the ground
 * shader lays their pools of light; and people — impostors from the Blender atlas, walking the pavements in four
 * frames — who fade out before they are smaller than a pixel. Counts follow the quality tier's BUDGET (people are its
 * walkers).
 */
export function Street({ kit }: { kit: Kit }) {
  const quality = useCity((s) => s.quality);
  const layout = useCity((s) => s.layout);
  const budget = BUDGET[quality];
  const cars = useMemo(() => createCars(kit, budget.cars), [kit, budget.cars]);
  const lamps = useMemo(() => createLamps(kit, layout, budget.lampStep), [kit, layout, budget.lampStep]);
  const people = useMemo(() => createPeople(kit, budget.walkers), [kit, budget.walkers]);
  useEffect(() => {
    cars.restore();
    return () => cars.dispose();
  }, [cars]);
  useEffect(() => {
    if (!lamps) return;
    restoreModule(lamps.mesh.geometry);
    return () => lamps.dispose();
  }, [lamps]);
  useEffect(() => () => people.dispose(), [people]);
  return (
    <>
      <primitive object={cars.group} />
      {lamps && <primitive object={lamps.mesh} />}
      <primitive object={people.mesh} />
    </>
  );
}

/** Where a lane runs: a spoke (0) or a ring (1), which one, the lane's offset from the centre line and a phase; dir
 * says which way along it. The same path code places a car, its light on the road and a walker. */
const GLSL_PATH = /* glsl */ `
const float TAU = 6.2831853;
const float ISLAND = ${ISLAND_RADIUS.toFixed(1)};
const float PLAZA = ${PLAZA_RADIUS.toFixed(1)};
const float SPOKE_COUNT = ${SPOKES.toFixed(1)};
const vec2 RINGS = vec2(${RING_ROADS[0].toFixed(1)}, ${RING_ROADS[1].toFixed(1)});
// pos (xz) and forward (xz) at time t for speed (units a second); ends fades to 0 at the ends of a spoke.
vec4 lanePath(vec4 path, float speed, float dir, float t, out float ends) {
  ends = 1.0;
  if (path.x < 0.5) {
    float a = path.y * TAU / SPOKE_COUNT;
    vec2 along = vec2(sin(a), -cos(a));
    vec2 side = vec2(cos(a), sin(a));
    float len = ISLAND - PLAZA - 3.5;
    float s = mod(path.w * len + t * speed * dir, len);
    ends = smoothstep(0.0, 2.5, min(s, len - s));
    return vec4(along * (PLAZA + 1.5 + s) + side * path.z, along * dir);
  }
  float R = (path.y < 0.5 ? RINGS.x : RINGS.y) + path.z;
  float th = path.w * TAU + t * speed * dir / R;
  vec2 radial = vec2(sin(th), -cos(th));
  return vec4(radial * R, vec2(cos(th), sin(th)) * dir);
}
`;

function lanes(count: number, seed: number, offsets: readonly number[]) {
  const random = rng(seed);
  const path = new Float32Array(count * 4);
  const speed = new Float32Array(count);
  const byLane = new Map<string, number[]>();
  for (let i = 0; i < count; i += 1) {
    const ring = random() < 0.45;
    const road = ring ? Math.floor(random() * RING_ROADS.length) : Math.floor(random() * SPOKES);
    const offset = offsets[Math.floor(random() * offsets.length)]!;
    path.set([ring ? 1 : 0, road, offset, 0], i * 4);
    const key = `${ring ? 1 : 0}:${road}:${offset}`;
    const lane = byLane.get(key);
    if (lane) lane.push(i);
    else byLane.set(key, [i]);
  }
  // A lane moves at one speed, 36–60 km/h (a city unit is about 8 m: a car is 0.56), and its cars keep their distance,
  // spread evenly along it with a little jitter, so no car drives through the one ahead.
  for (const cars of byLane.values()) {
    const v = 1.25 + random() * 0.85;
    const phase = random();
    cars.forEach((i, k) => {
      speed[i] = v;
      path[i * 4 + 3] = (phase + (k + (random() - 0.5) * 0.5) / cars.length + 1) % 1;
    });
  }
  return { path, speed };
}

function createCars(kit: Kit, count: number) {
  const source = kit.geometries.get('prop.car')!;
  const { path, speed } = lanes(count, 71, [-1.15, -0.5, 0.5, 1.15]);
  const material = shareLight(
    share(
      new THREE.ShaderMaterial({
        uniforms: { uFogColor: { value: new THREE.Color(FOG_COLOR) }, uFogDensity: { value: FOG_DENSITY }, uFogFalloff: { value: FOG_FALLOFF } },
        vertexShader: /* glsl */ `
          attribute vec4 aKit;
          attribute vec4 aPath;
          attribute float aSpeed;
          attribute float aPaint;
          uniform float uTime;
          varying vec3 vWorld;
          varying vec3 vNormalW;
          varying vec4 vKit;
          varying float vFront;
          varying float vPaint;
          ${GLSL_PATH}
          void main() {
            float ends;
            vec4 lp = lanePath(aPath, aSpeed, aPath.z > 0.0 ? 1.0 : -1.0, uTime, ends);
            vec3 f = vec3(lp.z, 0.0, lp.w);
            vec3 s = vec3(-lp.w, 0.0, lp.z);
            vec3 local = position * vec3(1.0, ends, 1.0);
            vec3 world = vec3(lp.x, 0.0, lp.y) + f * local.x + vec3(0.0, local.y, 0.0) + s * local.z;
            vWorld = world;
            vNormalW = normalize(f * normal.x + vec3(0.0, normal.y, 0.0) + s * normal.z);
            vKit = aKit;
            vFront = uv.x;
            vPaint = aPaint;
            gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
          }
        `,
        side: THREE.DoubleSide,
        fragmentShader: /* glsl */ `
          varying vec3 vWorld;
          varying vec3 vNormalW;
          varying vec4 vKit;
          varying float vFront;
          varying float vPaint;
          ${GLSL_SHARED}
          ${GLSL_COMMON}
          ${GLSL_FOG_PARS}
          ${GLSL_LIGHT}
          void main() {
            vec3 n = normalize(vNormalW) * (gl_FrontFacing ? 1.0 : -1.0);
            vec3 v = normalize(cameraPosition - vWorld);
            int surf = int(vKit.g * 16.0);
            float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
            vec3 r = reflect(-v, n);
            vec3 color;
            if (surf == 7) color = vFront > 0.5 ? uWarm * 6.0 : uAmber * 1.6;
            else if (surf == 2) color = uInk * 0.4 + cityMirror(vWorld, r, 0.05) * mix(0.1, 0.9, fres);
            else if (surf == 1) color = uInk * 0.5;
            else {
              // Paint from the palette (graphite, pale pearl, ink, violet haze) under a clear coat that mirrors the street.
              vec3 paint = vPaint < 0.5 ? uGraphite * 0.75 : vPaint < 1.5 ? uPearl * 0.3 : vPaint < 2.5 ? uInk * 0.9 : uHaze * 0.9;
              color = paint * nightLight(n, vWorld, mix(0.4, 1.0, vKit.r), 0.0) * 2.0 + cityMirror(vWorld, r, 0.1) * mix(0.05, 0.75, fres);
            }
            gl_FragColor = vec4(applyFog(color, vWorld, cameraPosition), 1.0);
          }
        `,
      }),
    ),
  );
  // Saloons and hatchbacks (the kit's two cars) in four paints, the same cars on every device.
  const paint = new Float32Array(count);
  for (let i = 0; i < count; i += 1) paint[i] = Math.floor((((i * 2654435761) >>> 0) / 4294967296) * 4);
  const split = Math.round(count * 0.6);
  const bodies = (
    [
      ['prop.car', 0, split],
      ['prop.car.1', split, count],
    ] as const
  ).map(([name, from, to]) => {
    const geometry = moduleGeometry(kit.geometries.get(name) ?? source, new THREE.InstancedBufferGeometry());
    geometry.setAttribute('aPath', new THREE.InstancedBufferAttribute(path.subarray(from * 4, to * 4), 4));
    geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speed.subarray(from, to), 1));
    geometry.setAttribute('aPaint', new THREE.InstancedBufferAttribute(paint.subarray(from, to), 1));
    geometry.instanceCount = to - from;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  });

  // The headlights' light on the road ahead of every car: an additive pool that never writes depth.
  const beamGeometry = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry(1.6, 0.7);
  plane.rotateX(-Math.PI / 2);
  plane.translate(1.05, 0.02, 0);
  beamGeometry.setAttribute('position', plane.getAttribute('position'));
  beamGeometry.setAttribute('uv', plane.getAttribute('uv'));
  beamGeometry.setIndex(plane.getIndex());
  beamGeometry.setAttribute('aPath', new THREE.InstancedBufferAttribute(path, 4));
  beamGeometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speed, 1));
  beamGeometry.instanceCount = count;
  const beamMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: SHARED.uTime, uWarm: { value: new THREE.Color(PALETTE.warmWhite) } },
    vertexShader: /* glsl */ `
      attribute vec4 aPath;
      attribute float aSpeed;
      uniform float uTime;
      varying vec2 vUv;
      varying float vFade;
      ${GLSL_PATH}
      void main() {
        float ends;
        vec4 lp = lanePath(aPath, aSpeed, aPath.z > 0.0 ? 1.0 : -1.0, uTime, ends);
        vec3 f = vec3(lp.z, 0.0, lp.w);
        vec3 s = vec3(-lp.w, 0.0, lp.z);
        vec3 world = vec3(lp.x, 0.0, lp.y) + f * position.x + vec3(0.0, position.y, 0.0) + s * position.z;
        vUv = uv;
        vFade = ends;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uWarm;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        float along = vUv.x;
        float across = abs(vUv.y - 0.5) * 2.0;
        float a = (1.0 - along) * smoothstep(0.0, 0.12, along) * (1.0 - smoothstep(0.35 + along * 0.6, 1.0, across));
        gl_FragColor = vec4(uWarm * a * 0.11 * vFade, 1.0);
      }
    `,
  });
  const beams = new THREE.Mesh(beamGeometry, beamMaterial);
  beams.frustumCulled = false;
  beams.renderOrder = 2;
  const group = new THREE.Group();
  group.add(...bodies, beams);
  return {
    group,
    restore: () => {
      for (const b of bodies) restoreModule(b.geometry);
    },
    dispose: () => {
      for (const b of bodies) releaseModule(b.geometry);
      beamGeometry.dispose();
      plane.dispose();
      material.dispose();
      beamMaterial.dispose();
    },
  };
}

/** Street lights on both kerbs of every ring road and spoke, where the ground shader lays their pools, never inside a block. */
function createLamps(kit: Kit, layout: CityLayout, step: number) {
  const source = kit.geometries.get('prop.lamp');
  if (!source) return null;
  const spots: { x: number; z: number; ax: number; az: number }[] = [];
  const add = (x: number, z: number, ax: number, az: number) => spots.push({ x, z, ax, az });
  for (let k = 0; k < SPOKES; k += 1) {
    const a = (k * Math.PI * 2) / SPOKES;
    const along = [Math.sin(a), -Math.cos(a)];
    const side = [Math.cos(a), Math.sin(a)];
    for (let i = 0, r = LAMP_STEP * 0.5; r < ISLAND_RADIUS - 2; i += 1, r += LAMP_STEP) {
      if (r < PLAZA_RADIUS + 1 || i % step || RING_ROADS.some((R) => Math.abs(r - R) < 3)) continue;
      for (const sgn of [-1, 1]) add(along[0]! * r + side[0]! * sgn * POLE, along[1]! * r + side[1]! * sgn * POLE, -side[0]! * sgn, -side[1]! * sgn);
    }
  }
  for (const R of RING_ROADS) {
    const n = Math.floor((Math.PI * 2 * R) / LAMP_STEP);
    for (let i = 0; i < n; i += step) {
      const th = ((i + 0.5) * LAMP_STEP) / R;
      const radial = [Math.sin(th), -Math.cos(th)];
      // Not across a spoke's mouth.
      const spoke = ((th / (Math.PI * 2)) * SPOKES) % 1;
      if (Math.min(spoke, 1 - spoke) * ((Math.PI * 2 * R) / SPOKES) < 2.6) continue;
      for (const sgn of [-1, 1]) add(radial[0]! * (R + sgn * POLE), radial[1]! * (R + sgn * POLE), -radial[0]! * sgn, -radial[1]! * sgn);
    }
  }
  // A pole never stands inside a block or a tower.
  const free = spots.filter(
    (s) =>
      layout.fillers.every((f) => Math.abs(s.x - f.x) > f.width / 2 + 0.12 || Math.abs(s.z - f.z) > f.depth / 2 + 0.12) &&
      layout.towers.every((t) => Math.hypot(s.x - t.x, s.z - t.z) > t.width * 1.05 + 0.15),
  );
  const material = createSkylineMaterial({ lowrise: true });
  const geometry = moduleGeometry(source);
  const seeds = new Float32Array(free.length);
  const floors = new Float32Array(free.length * 3).fill(0);
  geometry.setAttribute('aTower', new THREE.InstancedBufferAttribute(seeds, 1));
  geometry.setAttribute('aFloor', new THREE.InstancedBufferAttribute(floors, 3));
  const mesh = new THREE.InstancedMesh(geometry, material, free.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  free.forEach((s, i) => {
    // The model's arm points along +X; turn it over the road.
    q.setFromAxisAngle(up, Math.atan2(-s.az, s.ax));
    m.compose(new THREE.Vector3(s.x, 0, s.z), q, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return {
    mesh,
    dispose: () => {
      mesh.dispose();
      releaseModule(geometry);
      material.dispose();
    },
  };
}

/** People on the pavements: camera-facing impostors from the Blender atlas (two builds, four frames of a walk). */
function createPeople(kit: Kit, count: number) {
  const random = rng(97);
  const path = new Float32Array(count * 4);
  const speed = new Float32Array(count);
  const look = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const ring = random() < 0.42;
    const side = random() < 0.5 ? -1 : 1;
    path.set([ring ? 1 : 0, ring ? Math.floor(random() * RING_ROADS.length) : Math.floor(random() * SPOKES), side * (WALK + (random() - 0.5) * 0.4), random()], i * 4);
    // A walk: 4.3–5.8 km/h.
    speed[i] = (0.15 + random() * 0.05) * (random() < 0.5 ? -1 : 1);
    look[i] = random() < 0.5 ? 0 : 1;
  }
  const plane = new THREE.PlaneGeometry(0.13, 0.26);
  plane.translate(0, 0.13, 0);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', plane.getAttribute('position'));
  geometry.setAttribute('uv', plane.getAttribute('uv'));
  geometry.setIndex(plane.getIndex());
  geometry.setAttribute('aPath', new THREE.InstancedBufferAttribute(path, 4));
  geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speed, 1));
  geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(look, 1));
  geometry.instanceCount = count;
  const material = shareLight(
    share(
      new THREE.ShaderMaterial({
        uniforms: {
          uPeople: { value: kit.people },
          uFogColor: { value: new THREE.Color(FOG_COLOR) },
          uFogDensity: { value: FOG_DENSITY },
          uFogFalloff: { value: FOG_FALLOFF },
        },
        vertexShader: /* glsl */ `
          attribute vec4 aPath;
          attribute float aSpeed;
          attribute float aLook;
          uniform float uTime;
          varying vec2 vUv;
          varying vec3 vWorld;
          ${GLSL_PATH}
          void main() {
            float ends;
            // A walker goes its own way (aSpeed's sign) on either pavement.
            vec4 lp = lanePath(aPath, abs(aSpeed), sign(aSpeed), uTime, ends);
            vec3 base = vec3(lp.x, 0.0, lp.y);
            vec3 toCam = cameraPosition - base;
            float dist = length(toCam);
            // The quad's front faces the eye (right × up points at the camera).
            vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
            float fade = ends * (1.0 - smoothstep(70.0, 95.0, dist));
            vec3 world = base + right * position.x + vec3(0.0, position.y * fade, 0.0);
            // Four frames of a walk (one stride, two steps, about 1.5 m: 0.19 units), mirrored when the walker crosses
            // the view the other way.
            float frame = floor(fract(uTime * abs(aSpeed) * 5.3 + aPath.w * 17.0) * 4.0);
            float flip = dot(vec3(lp.z, 0.0, lp.w), right) < 0.0 ? 1.0 : 0.0;
            vec2 u = vec2(flip > 0.5 ? 1.0 - uv.x : uv.x, uv.y);
            vUv = vec2((aLook * 4.0 + frame + u.x) / 8.0, 1.0 - u.y);
            vWorld = world;
            gl_Position = fade < 0.01 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(world, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uPeople;
          varying vec2 vUv;
          varying vec3 vWorld;
          ${GLSL_SHARED}
          ${GLSL_COMMON}
          ${GLSL_FOG_PARS}
          ${GLSL_LIGHT}
          void main() {
            vec4 t = texture2D(uPeople, vUv);
            if (t.a < 0.5) discard;
            // Dark figures against the lit street, a warm rim from the lamps behind them at their soft edges.
            float rim = 1.0 - smoothstep(0.5, 0.8, t.a);
            vec3 color = uInk * 0.6 + t.rgb * 0.5 + uAmber * (0.04 + rim * 0.45);
            gl_FragColor = vec4(applyFog(color, vWorld, cameraPosition), 1.0);
          }
        `,
      }),
    ),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    dispose: () => {
      geometry.dispose();
      plane.dispose();
      material.dispose();
    },
  };
}
