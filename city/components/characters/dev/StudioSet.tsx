'use client';

import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { PALETTE } from '@/city/lib/palette';
import type { BodyLight } from '../bodyMaterial';

/**
 * The studio set for the characters: a dark cyclorama in the city's colours, a floor that catches the contact shadow,
 * and an HDR environment for reflections — a small light room (a warm softbox in front, violet and amber strips behind,
 * a soft top light) rendered once into a prefiltered cube (PMREM). No image files: it is the brand's light, in code.
 */

const hdr = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

/** The key, rim and fill a body takes in the studio (its reflections come from the environment). */
export const STUDIO_LIGHT: BodyLight = {
  key: { dir: new THREE.Vector3(0.7, 0.55, 0.45).normalize(), color: hdr(PALETTE.warmWhite, 6.5) },
  rim: { dir: new THREE.Vector3(-0.55, 0.38, -0.75).normalize(), color: new THREE.Color(PALETTE.violet).lerp(new THREE.Color(PALETTE.warmWhite), 0.45).multiplyScalar(6) },
  fill: { dir: new THREE.Vector3(-0.8, 0.12, 0.55).normalize(), color: hdr(PALETTE.ice, 0.28) },
};

/** How much of the light room reaches the body: enough for reflections, not so much it flattens the key. */
export const STUDIO_ENV_INTENSITY = 0.55;

/** The light room, prefiltered for the body shader; one per renderer. */
export function useStudioEnvironment(): THREE.Texture | null {
  const gl = useThree((s) => s.gl);
  const target = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = lightRoom();
    const rt = pmrem.fromScene(room, 0.03, 0.1, 60);
    room.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    pmrem.dispose();
    return rt;
  }, [gl]);
  useEffect(() => () => target.dispose(), [target]);
  return target.texture;
}

function lightRoom(): THREE.Scene {
  const scene = new THREE.Scene();
  const add = (geometry: THREE.BufferGeometry, color: THREE.Color, at: [number, number, number], look: [number, number, number] = [0, 0, 0]) => {
    const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false }));
    m.position.set(...at);
    m.lookAt(...look);
    scene.add(m);
  };
  // The room itself: near-black, a touch of violet haze.
  const walls = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 24), new THREE.MeshBasicMaterial({ color: hdr(PALETTE.graphite, 0.12), side: THREE.BackSide }));
  walls.position.y = 2;
  scene.add(walls);
  // A floor a little lighter than the walls, so the lower body picks up a faint bounce.
  add(new THREE.PlaneGeometry(24, 24), hdr(PALETTE.graphite, 0.18), [0, -1.3, 0], [0, 10, 0]);
  // Key softbox: front and to the right of the camera, high.
  add(new THREE.PlaneGeometry(4.5, 3.2), hdr(PALETTE.warmWhite, 7.5), [6, 5, 5.5]);
  // Top light: broad and soft.
  add(new THREE.PlaneGeometry(7, 7), hdr(PALETTE.ice, 1.6), [0, 9, 0]);
  // Rim strips behind: violet on the left, amber on the right — the city's afterglow and stored sun.
  add(new THREE.PlaneGeometry(0.9, 7), hdr(PALETTE.violet, 6), [-6.5, 2.5, -5.5]);
  add(new THREE.PlaneGeometry(0.9, 7), hdr(PALETTE.amber, 4.5), [6.5, 2.2, -6]);
  // A low cool fill card on the far side.
  add(new THREE.PlaneGeometry(3, 2.4), hdr(PALETTE.ice, 0.7), [-7.5, 0.8, 4]);
  // A thin amber line on the horizon in front, as the plaza's lights would be.
  add(new THREE.PlaneGeometry(14, 0.25), hdr(PALETTE.amber, 1.4), [0, -0.6, 9]);
  return scene;
}

/** The cyclorama and the floor under `at` (the guardian's feet). */
export function StudioBackdrop({ at }: { at: readonly [number, number, number] }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uInk: { value: new THREE.Color(PALETTE.inkDeep) },
          uHaze: { value: new THREE.Color(PALETTE.violetHaze) },
          uGraphite: { value: new THREE.Color(PALETTE.graphite) },
          uAmber: { value: new THREE.Color(PALETTE.amber) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uInk;
          uniform vec3 uHaze;
          uniform vec3 uGraphite;
          uniform vec3 uAmber;
          varying vec3 vPos;
          void main() {
            vec3 d = normalize(vPos);
            // Dark above, a violet haze low behind the figure, a faint amber line where the floor meets the wall.
            float haze = exp(-pow((d.y - 0.05) / 0.22, 2.0)) * (0.55 + 0.45 * smoothstep(0.3, -1.0, d.z));
            vec3 c = uInk * 0.9 + uHaze * haze * 0.55 + uAmber * exp(-pow(d.y / 0.012, 2.0)) * 0.05;
            gl_FragColor = vec4(c, 1.0);
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [],
  );
  const floor = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uInk: { value: new THREE.Color(PALETTE.inkDeep) }, uGraphite: { value: new THREE.Color(PALETTE.graphite) }, uHaze: { value: new THREE.Color(PALETTE.violetHaze) } },
        vertexShader: /* glsl */ `
          varying vec2 vXZ;
          void main() {
            vXZ = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uInk;
          uniform vec3 uGraphite;
          uniform vec3 uHaze;
          varying vec2 vXZ;
          void main() {
            // A pool of light where the figure stands, falling off into the dark.
            float r = length(vXZ);
            vec3 c = mix(uGraphite * 4.2 + uHaze * 0.35, uInk, smoothstep(0.4, 5.5, r));
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
    [],
  );
  useEffect(
    () => () => {
      material.dispose();
      floor.dispose();
    },
    [material, floor],
  );
  return (
    <group position={at as [number, number, number]}>
      <mesh material={material} renderOrder={-10}>
        <sphereGeometry args={[40, 48, 24]} />
      </mesh>
      <mesh material={floor} rotation-x={-Math.PI / 2} renderOrder={-5}>
        <circleGeometry args={[24, 96]} />
      </mesh>
    </group>
  );
}
