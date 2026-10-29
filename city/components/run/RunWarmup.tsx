'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createBodyMaterial, createEdgeMaterial, createGlowMaterial, createRibbonMaterial } from './runMaterials';

/**
 * Compiles the run's shaders on the title screen, so pressing PLAY never stutters. The pieces are drawn for a
 * moment inside the real frame (through the post-processing target, which is what decides the compiled variant),
 * collapsed to nothing so nobody sees them, then removed. three.js keeps the programs for the run's own materials.
 */
export function RunWarmup() {
  const [on, setOn] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const start = setTimeout(() => setOn(true), 1200);
    return () => clearTimeout(start);
  }, []);
  if (!on || done) return null;
  return <WarmupPieces onDone={() => setDone(true)} />;
}

function WarmupPieces({ onDone }: { onDone: () => void }) {
  const group = useMemo(() => {
    const g = new THREE.Group();
    const collapsed = new THREE.Matrix4().makeScale(0, 0, 0);
    const instanced = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const geo = geometry.clone();
      geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(3), 3));
      geo.setAttribute('aGlow', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
      geo.setAttribute('aS', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
      const mesh = new THREE.InstancedMesh(geo, material, 1);
      mesh.setMatrixAt(0, collapsed);
      return mesh;
    };
    const box = new THREE.BoxGeometry(1, 1, 1);
    const ribbon = new THREE.BufferGeometry();
    ribbon.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    ribbon.setAttribute('aAlong', new THREE.BufferAttribute(new Float32Array(3), 1));
    ribbon.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(3), 1));
    const white = new THREE.Color(1, 1, 1);
    const tiny = (mesh: THREE.Mesh) => {
      mesh.scale.setScalar(0);
      return mesh;
    };
    g.add(
      instanced(box, createEdgeMaterial()),
      instanced(new THREE.TorusGeometry(1, 0.05, 8, 72), createGlowMaterial()),
      tiny(new THREE.Mesh(box, createBodyMaterial(white, white))),
      tiny(new THREE.Mesh(box, createBodyMaterial(white, white, 0.5))),
      new THREE.Mesh(ribbon, createRibbonMaterial(white)),
    );
    g.traverse((o) => (o.frustumCulled = false));
    return g;
  }, []);

  useEffect(
    () => () =>
      group.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      }),
    [group],
  );

  // A few frames are enough for every program to compile, in parallel where the browser can.
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 20) onDone();
  });

  return <primitive object={group} />;
}
