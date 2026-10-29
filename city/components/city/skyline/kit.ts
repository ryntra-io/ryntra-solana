import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { KIT_FLOOR, type ModuleFloors } from './plan';

/**
 * The skyline kit, built from assets-source/city (Blender → Meshopt geometry, WebP atlases beside it: the page's CSP
 * forbids the blob: URLs a texture inside a GLB would load through). No Basis/KTX2: its transcoder builds functions
 * with `new Function`, which the production CSP (no 'unsafe-eval') refuses.
 */
export const KIT_URL = '/city/models/city-kit.glb';
const ROOMS_URL = '/city/models/rooms.webp';
const PEOPLE_URL = '/city/models/people.webp';
/** Seamless PBR tiles baked in Blender: R albedo variation, G roughness, B and A a tangent-space normal. */
export const DETAILS = ['concrete', 'metal', 'asphalt', 'glass'] as const;
export type DetailName = (typeof DETAILS)[number];

export type Kit = {
  /** Every module by its name in the kit, in float attributes with the node's dequantisation applied. */
  geometries: Map<string, THREE.BufferGeometry>;
  /** Every module's height in floors: as built for crowns (mast and beacon included), nominal for the rest. */
  floors: ModuleFloors;
  rooms: THREE.Texture;
  people: THREE.Texture;
  detail: Record<DetailName, THREE.Texture>;
  /** What the kit holds in GPU memory once drawn: geometry bytes and texture bytes. */
  bytes: { geometry: number; textures: number };
};

let pending: Promise<Kit> | null = null;

/**
 * Loads the kit once per page. Meshopt decodes on the page (a few milliseconds for the whole kit, WebAssembly the CSP
 * allows); the atlases decode off the main thread and the GPU builds their mipmaps on upload.
 */
export function loadKit(): Promise<Kit> {
  if (pending) return pending;
  pending = (async () => {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const [gltf, rooms, people, ...tiles] = await Promise.all([
      loader.loadAsync(KIT_URL),
      loadAtlas(ROOMS_URL),
      loadAtlas(PEOPLE_URL),
      ...DETAILS.map((name) => loadAtlas(`/city/models/detail-${name}.webp`)),
    ]);
    const detail = Object.fromEntries(DETAILS.map((name, i) => [name, tiles[i]!])) as Record<DetailName, THREE.Texture>;
    for (const t of tiles) {
      t.colorSpace = THREE.NoColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
    }
    for (const t of [rooms, people]) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
    }
    gltf.scene.updateMatrixWorld(true);
    const json = gltf.parser.json as { nodes: { name?: string }[] };
    const geometries = new Map<string, THREE.BufferGeometry>();
    const floors: Record<string, number> = {};
    let geometryBytes = 0;
    gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const index = gltf.parser.associations.get(mesh)?.nodes ?? gltf.parser.associations.get(mesh.parent as THREE.Object3D)?.nodes;
      const name = (index !== undefined ? json.nodes[index]?.name : undefined) ?? mesh.name;
      const geometry = toFloat(mesh.geometry, mesh.matrixWorld);
      geometry.computeBoundingBox();
      const extras = (mesh.userData ?? {}) as { floors?: number; mast?: number };
      const built = (geometry.boundingBox?.max.y ?? KIT_FLOOR) / KIT_FLOOR;
      floors[name] = name.startsWith('crown.') || name.startsWith('crane') ? built : extras.floors || built;
      geometries.set(name, geometry);
      for (const a of Object.values(geometry.attributes)) geometryBytes += (a as THREE.BufferAttribute).array.byteLength;
      if (geometry.index) geometryBytes += geometry.index.array.byteLength;
      mesh.geometry.dispose();
    });
    const textureBytes = [rooms, people, ...tiles].reduce((sum, t) => sum + gpuBytes(t), 0);
    return { geometries, floors, rooms, people, detail, bytes: { geometry: geometryBytes, textures: textureBytes } };
  })();
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

/** Float position, normal and uv with the node's transform baked in; the kit's COLOR_0 kept as aKit (normalised bytes). */
function toFloat(source: THREE.BufferGeometry, matrix: THREE.Matrix4): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const pos = source.getAttribute('position');
  const nor = source.getAttribute('normal');
  const uv = source.getAttribute('uv');
  const color = source.getAttribute('color');
  const count = pos.count;
  const p = new Float32Array(count * 3);
  const n = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  for (let i = 0; i < count; i += 1) {
    v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    p[i * 3] = v.x;
    p[i * 3 + 1] = v.y;
    p[i * 3 + 2] = v.z;
    if (nor) {
      v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize();
      n[i * 3] = v.x;
      n[i * 3 + 1] = v.y;
      n[i * 3 + 2] = v.z;
    }
  }
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  if (uv) {
    const u = new Float32Array(count * 2);
    for (let i = 0; i < count; i += 1) {
      u[i * 2] = uv.getX(i);
      u[i * 2 + 1] = uv.getY(i);
    }
    out.setAttribute('uv', new THREE.BufferAttribute(u, 2));
  } else out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  if (color && color.itemSize === 4 && color.array instanceof Uint8Array) out.setAttribute('aKit', new THREE.BufferAttribute(color.array, 4, true));
  else {
    const c = new Uint8Array(count * 4);
    for (let i = 0; i < count; i += 1) {
      c[i * 4] = Math.round((color ? color.getX(i) : 1) * 255);
      c[i * 4 + 1] = Math.round((color ? color.getY(i) : 2.5 / 16) * 255);
      c[i * 4 + 2] = Math.round((color ? color.getZ(i) : 0) * 255);
      c[i * 4 + 3] = 255;
    }
    out.setAttribute('aKit', new THREE.BufferAttribute(c, 4, true));
  }
  if (source.index) out.setIndex(new THREE.BufferAttribute(source.index.array.slice(), 1));
  return out;
}

/**
 * A geometry that draws the kit's module: it shares the kit's attributes and index (nothing is copied), and adds its
 * own per-instance ones. Free it with releaseModule, which leaves the kit's buffers on the GPU for the next skyline;
 * restoreModule undoes that, so a release in an effect's cleanup survives React running the effect twice.
 */
export function moduleGeometry<G extends THREE.BufferGeometry = THREE.BufferGeometry>(source: THREE.BufferGeometry, into: G = new THREE.BufferGeometry() as G): G {
  for (const [key, attr] of Object.entries(source.attributes)) into.setAttribute(key, attr);
  if (source.index) into.setIndex(source.index);
  into.userData.shared = Object.keys(source.attributes);
  into.userData.source = source;
  return into;
}

export function restoreModule(geometry: THREE.BufferGeometry) {
  const source = geometry.userData.source as THREE.BufferGeometry | undefined;
  if (!source) return;
  for (const [key, attr] of Object.entries(source.attributes)) if (!geometry.getAttribute(key)) geometry.setAttribute(key, attr);
  if (source.index && !geometry.index) geometry.setIndex(source.index);
}

export function releaseModule(geometry: THREE.BufferGeometry) {
  for (const key of (geometry.userData.shared as string[] | undefined) ?? []) geometry.deleteAttribute(key);
  geometry.setIndex(null);
  geometry.dispose();
}

/**
 * An atlas as the GPU takes it: decoded off the main thread, neither premultiplied nor colour-converted (the detail
 * tiles carry data in every channel, alpha included), rows top first as the kit's glTF uvs expect. Where
 * createImageBitmap ignores its options (Safari before 17, Firefox before 98), the image element takes the same flags
 * at upload instead.
 */
async function loadAtlas(url: string): Promise<THREE.Texture> {
  const image = bitmapsKeepData()
    ? await new THREE.ImageBitmapLoader().setOptions({ premultiplyAlpha: 'none', colorSpaceConversion: 'none' }).loadAsync(url)
    : await new THREE.ImageLoader().loadAsync(url);
  const texture = new THREE.Texture(image);
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

function bitmapsKeepData(): boolean {
  if (typeof createImageBitmap === 'undefined') return false;
  const ua = navigator.userAgent;
  const safari = /^((?!chrome|android).)*safari/i.test(ua) ? Number(ua.match(/Version\/(\d+)/)?.[1] ?? 0) : Infinity;
  const firefox = Number(ua.match(/Firefox\/(\d+)\./)?.[1] ?? Infinity);
  return safari >= 17 && firefox >= 98;
}

/** RGBA8 with the full mip chain the GPU builds: a third more than the top level. */
function gpuBytes(t: THREE.Texture): number {
  const img = t.image as { width?: number; height?: number } | undefined;
  return Math.round(((img?.width ?? 0) * (img?.height ?? 0) * 4 * 4) / 3);
}
