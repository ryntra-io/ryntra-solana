import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MATS } from '@/city/lib/characters/body';
import type { Rig } from '@/city/lib/characters/rig';
import { restRotations, solveAims, solveBones } from '@/city/lib/characters/rig';

/**
 * A character's body modelled in Blender (`assets-source/characters/<name>/`) instead of built from code. The GLB holds
 * three meshes — hero, standard, crowd — in the character's space at rest, each vertex tagged with its bone (`_bone`,
 * by the bone names in the file's extras) and its surface (`_mat`: 0 the textured armour, else one of the body's
 * lights), and one PBR material baked in Blender: base colour, ORM, a tangent-space normal map, all WebP (the browser
 * decodes them itself: KTX2's Basis transcoder needs eval, which the site's CSP refuses; Meshopt is plain WebAssembly).
 *
 * Here each mesh is moved from the character's space into its bones' own spaces — the body shader places every vertex
 * with its bone's matrix, as it does the body built in code — so the clips move the model unchanged, in one draw call.
 */

export type BodySkin = {
  base: THREE.Texture;
  orm: THREE.Texture;
  normal: THREE.Texture;
  /** Width over height of the visor glass, so the face keeps its proportions. */
  visorAspect: number;
};

export type ModelBody = { geometries: THREE.BufferGeometry[]; skin: BodySkin; triangles: number[] };

const VISOR = MATS.visor;
const loads = new Map<string, Promise<ModelBody>>();

/** Loads a character's model once per page; every character of that kind shares its geometry and textures. */
export function loadModelBody(url: string, rig: Rig, bounds: THREE.Sphere, gl: THREE.WebGLRenderer): Promise<ModelBody> {
  let load = loads.get(url);
  if (!load) {
    load = read(url, rig, bounds, gl);
    loads.set(url, load);
    load.catch(() => loads.delete(url));
  }
  return load;
}

async function read(url: string, rig: Rig, bounds: THREE.Sphere, gl: THREE.WebGLRenderer): Promise<ModelBody> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const extras = (gltf.parser.json.extras ?? {}) as { bones?: string[]; visorAspect?: number; triangles?: number[] };
  const names = extras.bones ?? [];
  const remap = names.map((n) => {
    const i = rig.index[n];
    if (i === undefined) throw new Error(`${url}: bone ${n} is not in the rig`);
    return i;
  });
  const inverse = restInverses(rig);
  const meshes: THREE.Mesh[] = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  meshes.sort((a, b) => a.name.localeCompare(b.name));
  if (meshes.length < 3) throw new Error(`${url}: expected three detail levels, found ${meshes.length}`);
  const geometries = meshes.slice(0, 3).map((m) => toBoneSpace(m, remap, inverse, bounds));
  const material = meshes[0]!.material as THREE.MeshStandardMaterial;
  const skin: BodySkin = {
    base: material.map!,
    orm: material.metalnessMap ?? material.roughnessMap!,
    normal: material.normalMap!,
    visorAspect: extras.visorAspect ?? 2.67,
  };
  const aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
  for (const t of [skin.base, skin.orm, skin.normal]) {
    t.anisotropy = aniso;
    t.needsUpdate = true;
  }
  skin.base.colorSpace = THREE.SRGBColorSpace;
  skin.orm.colorSpace = THREE.NoColorSpace;
  skin.normal.colorSpace = THREE.NoColorSpace;
  for (const m of meshes) {
    m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) mat.dispose();
  }
  return { geometries, skin, triangles: geometries.map((g) => g.index!.count / 3) };
}

/** Each bone's rest matrix inverted, row-major 3×4 (rotation transposed, translation brought back). */
function restInverses(rig: Rig): Float32Array {
  const mats = new Float32Array(rig.total * 12);
  solveBones(rig, restRotations(rig), [0, 0, 0], mats);
  solveAims(rig, mats);
  const inv = new Float32Array(rig.total * 12);
  for (let b = 0; b < rig.total; b += 1) {
    const o = b * 12;
    const r = (i: number, j: number) => mats[o + i * 4 + j]!;
    const t = [mats[o + 3]!, mats[o + 7]!, mats[o + 11]!];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) inv[o + i * 4 + j] = r(j, i);
      inv[o + i * 4 + 3] = -(r(0, i) * t[0]! + r(1, i) * t[1]! + r(2, i) * t[2]!);
    }
  }
  return inv;
}

const v = new THREE.Vector3();
const n = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();

/** The mesh's vertices in its bones' spaces, with the `aPart` (bone, surface) attribute the body shader reads. */
function toBoneSpace(mesh: THREE.Mesh, remap: number[], inverse: Float32Array, bounds: THREE.Sphere): THREE.BufferGeometry {
  const src = mesh.geometry;
  const pos = src.attributes.position!;
  const nor = src.attributes.normal!;
  const tan = src.attributes.tangent;
  const uv = src.attributes.uv!;
  const bone = src.attributes._bone!;
  const mat = src.attributes._mat!;
  const count = pos.count;
  normalMatrix.getNormalMatrix(mesh.matrixWorld);
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const tangent = new Float32Array(count * 4);
  const uvs = new Float32Array(count * 2);
  const part = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const b = remap[Math.round(bone.getX(i))]!;
    const o = b * 12;
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    position[i * 3] = inverse[o]! * v.x + inverse[o + 1]! * v.y + inverse[o + 2]! * v.z + inverse[o + 3]!;
    position[i * 3 + 1] = inverse[o + 4]! * v.x + inverse[o + 5]! * v.y + inverse[o + 6]! * v.z + inverse[o + 7]!;
    position[i * 3 + 2] = inverse[o + 8]! * v.x + inverse[o + 9]! * v.y + inverse[o + 10]! * v.z + inverse[o + 11]!;
    n.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
    normal[i * 3] = inverse[o]! * n.x + inverse[o + 1]! * n.y + inverse[o + 2]! * n.z;
    normal[i * 3 + 1] = inverse[o + 4]! * n.x + inverse[o + 5]! * n.y + inverse[o + 6]! * n.z;
    normal[i * 3 + 2] = inverse[o + 8]! * n.x + inverse[o + 9]! * n.y + inverse[o + 10]! * n.z;
    if (tan) {
      n.set(tan.getX(i), tan.getY(i), tan.getZ(i)).transformDirection(mesh.matrixWorld);
      tangent[i * 4] = inverse[o]! * n.x + inverse[o + 1]! * n.y + inverse[o + 2]! * n.z;
      tangent[i * 4 + 1] = inverse[o + 4]! * n.x + inverse[o + 5]! * n.y + inverse[o + 6]! * n.z;
      tangent[i * 4 + 2] = inverse[o + 8]! * n.x + inverse[o + 9]! * n.y + inverse[o + 10]! * n.z;
      tangent[i * 4 + 3] = tan.getW(i);
    }
    const surface = Math.round(mat.getX(i));
    uvs[i * 2] = uv.getX(i);
    // glTF's v runs down the image; the face on the visor is drawn with v up, as on the body built in code.
    uvs[i * 2 + 1] = surface === VISOR ? 1 - uv.getY(i) : uv.getY(i);
    part[i * 2] = b;
    part[i * 2 + 1] = surface;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(tangent, 4));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('aPart', new THREE.BufferAttribute(part, 2));
  const index = src.index!;
  g.setIndex(new THREE.BufferAttribute(index.array instanceof Uint32Array || count > 65535 ? new Uint32Array(index.array) : new Uint16Array(index.array), 1));
  g.boundingSphere = bounds.clone();
  g.boundingBox = new THREE.Box3().setFromCenterAndSize(bounds.center, new THREE.Vector3().setScalar(bounds.radius * 2));
  return g;
}
