'use client';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Filler } from '@/city/lib/city/layout';
import { share } from '@/city/lib/city/shared';
import { createFillerMaterial } from './materials/fillerMaterial';
import { useKit } from './skyline/Skyline';
import { createSkylineMaterial } from './skyline/skylineMaterial';
import { useSkyline } from './skyline/store';
import { moduleGeometry, releaseModule, restoreModule, type Kit } from './skyline/kit';

/**
 * The low-rise city between the towers: one instanced box per block, one draw call for all of them. Once the skyline
 * kit is on the screen (CITY-56) the blocks are drawn from it instead: walls with rooms behind every window and shop
 * fronts on the ground floor, and one of three Blender roofs (parapet and plant, a water tank, a penthouse) on each.
 */
export function Fillers({ fillers }: { fillers: Filler[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const { geometry, material } = useMemo(() => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0);
    const seed = new Float32Array(fillers.length);
    fillers.forEach((f, i) => (seed[i] = f.seed % 100000));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    return { geometry, material: share(createFillerMaterial()) };
  }, [fillers]);
  const kit = useKit();
  const ready = useSkyline((s) => s.ready);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    fillers.forEach((f, i) => {
      m.makeScale(f.width, f.height, f.depth).setPosition(f.x, 0, f.z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [fillers]);

  if (!fillers.length) return null;
  return (
    <>
      <instancedMesh ref={ref} args={[geometry, material, fillers.length]} visible={!(ready && kit)} />
      {ready && kit && <LowRise kit={kit} fillers={fillers} />}
    </>
  );
}

function LowRise({ kit, fillers }: { kit: Kit; fillers: Filler[] }) {
  const built = useMemo(() => buildLowRise(kit, fillers), [kit, fillers]);
  useEffect(() => {
    built.restore();
    return () => built.dispose();
  }, [built]);
  return <primitive object={built.group} />;
}

/**
 * What kind of block a filler is (CITY-56), the same on every device: brick walk-ups are the short ones (up to ten
 * storeys), glass offices the tall ones, concrete blocks in between and here and there.
 * 0 glass office · 1 brick walk-up · 2 concrete block.
 */
function blockType(f: Filler): number {
  const r = (f.seed % 1000) / 1000;
  if (f.height < 4.2) return r < 0.6 ? 1 : r < 0.85 ? 2 : 0;
  if (f.height < 8) return r < 0.25 ? 1 : r < 0.65 ? 2 : 0;
  return r < 0.3 ? 2 : 0;
}

/** The walls and the roofs as instanced kit modules, all with the skyline's material in its low-rise mode. */
function buildLowRise(kit: Kit, fillers: readonly Filler[]) {
  const material = createSkylineMaterial({ lowrise: true });
  material.uniforms.uRooms!.value = kit.rooms;
  const group = new THREE.Group();
  group.name = 'lowrise';
  const meshes: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4();
  const make = (name: string, items: { matrix: THREE.Matrix4; seed: number; type: number }[]) => {
    const source = kit.geometries.get(name);
    if (!source || !items.length) return;
    const geometry = moduleGeometry(source);
    const seeds = new Float32Array(items.length);
    const floors = new Float32Array(items.length * 3);
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    items.forEach((it, i) => {
      mesh.setMatrixAt(i, it.matrix);
      seeds[i] = (it.seed % 100000) / 1000;
      floors.set([it.type, 1, 1], i * 3);
    });
    geometry.setAttribute('aTower', new THREE.InstancedBufferAttribute(seeds, 1));
    geometry.setAttribute('aFloor', new THREE.InstancedBufferAttribute(floors, 3));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = name;
    group.add(mesh);
    meshes.push(mesh);
  };
  const typed = fillers.map((f) => ({ f, type: blockType(f) }));
  make(
    'low.body',
    typed.map(({ f, type }) => ({ matrix: m.clone().makeScale(f.width, f.height, f.depth).setPosition(f.x, 0, f.z), seed: f.seed, type })),
  );
  // Each type wears its own top: a cornice and parapet on brick, a thin coping on concrete, plant on the glass offices.
  const roofOf = (type: number, seed: number) => (type === 1 ? 'low.roof.brick' : type === 2 ? 'low.roof.slab' : `low.roof.${seed % 3}`);
  const roofs = new Map<string, { matrix: THREE.Matrix4; seed: number; type: number }[]>();
  for (const { f, type } of typed) {
    const name = roofOf(type, f.seed);
    const list = roofs.get(name) ?? [];
    list.push({ matrix: m.clone().makeScale(f.width, 1, f.depth).setPosition(f.x, f.height, f.z), seed: f.seed, type });
    roofs.set(name, list);
  }
  for (const [name, items] of roofs) make(name, items);
  return {
    group,
    restore: () => {
      for (const mesh of meshes) restoreModule(mesh.geometry);
    },
    dispose: () => {
      for (const mesh of meshes) {
        mesh.dispose();
        releaseModule(mesh.geometry);
      }
      material.dispose();
    },
  };
}
