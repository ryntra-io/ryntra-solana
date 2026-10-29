// The guardian's Blender model as shipped (public/city/characters/guardian/): budget, levels, bones, surfaces.
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GUARDIAN_RIG } from './rig.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../../../../public/city/characters/guardian');
const glbPath = path.join(dir, 'guardian.glb');

function readGlb(file) {
  const buf = readFileSync(file);
  assert.equal(buf.toString('ascii', 0, 4), 'glTF');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
  return { json, bin };
}

const { json, bin } = readGlb(glbPath);
const meshes = Object.fromEntries(json.meshes.map((m) => [m.name, m]));
const tris = (mesh) => json.accessors[mesh.primitives[0].indices].count / 3;

/** Decodes one accessor's bytes through EXT_meshopt_compression, as the browser does. */
async function accessorBytes(index) {
  await MeshoptDecoder.ready;
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const ext = view.extensions?.EXT_meshopt_compression;
  let data;
  if (ext) {
    const source = new Uint8Array(bin.buffer, bin.byteOffset + (ext.byteOffset ?? 0), ext.byteLength);
    data = new Uint8Array(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(data, ext.count, ext.byteStride, source, ext.mode, ext.filter);
  } else {
    data = new Uint8Array(bin.buffer, bin.byteOffset + (view.byteOffset ?? 0), view.byteLength);
  }
  const stride = view.byteStride ?? (ext ? ext.byteStride : 1);
  const offset = acc.byteOffset ?? 0;
  return Array.from({ length: acc.count }, (_, i) => data[i * stride + offset]);
}

test('the model ships within budget: one GLB and three WebP textures, 3 MB at most, Meshopt geometry', () => {
  const files = [glbPath, ...json.images.map((img) => path.join(dir, img.uri))];
  const total = files.reduce((sum, f) => sum + statSync(f).size, 0);
  assert.ok(total <= 3 * 1024 * 1024, `${(total / 1024 / 1024).toFixed(2)} MB`);
  assert.ok(json.extensionsUsed.includes('EXT_meshopt_compression'), 'meshopt');
  assert.ok(json.extensionsUsed.includes('EXT_texture_webp'), 'webp');
  // The site's CSP refuses eval, which the Basis transcoder of KTX2 needs: textures the browser decodes itself.
  assert.ok(!json.extensionsUsed.includes('KHR_texture_basisu'), 'no KTX2');
  assert.equal(json.images.length, 3);
  for (const img of json.images) assert.match(img.uri, /\.webp$/, 'textures beside the GLB, not embedded (the CSP refuses blob: URLs)');
  const mat = json.materials[0];
  assert.ok(mat.pbrMetallicRoughness.baseColorTexture && mat.pbrMetallicRoughness.metallicRoughnessTexture && mat.normalTexture && mat.occlusionTexture);
});

test('three detail levels: hero 30–60k triangles, standard and crowd far lighter', () => {
  const [hero, standard, crowd] = ['guardian.lod0', 'guardian.lod1', 'guardian.lod2'].map((n) => meshes[n]);
  assert.ok(hero && standard && crowd, Object.keys(meshes).join(', '));
  assert.ok(tris(hero) >= 30_000 && tris(hero) <= 60_000, `hero ${tris(hero)}`);
  assert.ok(tris(standard) < tris(hero) / 2, `standard ${tris(standard)}`);
  assert.ok(tris(crowd) < tris(standard) / 3, `crowd ${tris(crowd)}`);
  for (const mesh of [hero, standard, crowd]) {
    for (const key of ['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', '_BONE', '_MAT']) assert.ok(key in mesh.primitives[0].attributes, `${mesh.name} ${key}`);
  }
});

test("its bones are the rig's, by name, and every posed bone carries armour up close", async () => {
  const names = json.extras.bones;
  for (const n of names) assert.ok(n in GUARDIAN_RIG.index, n);
  const bones = new Set(await accessorBytes(meshes['guardian.lod0'].primitives[0].attributes._BONE));
  for (let i = 0; i < GUARDIAN_RIG.count; i += 1) {
    const name = GUARDIAN_RIG.names[i];
    assert.ok(bones.has(names.indexOf(name)), `${name} has a part`);
  }
});

test('a face at every level (the visor), the core and the seams up close', async () => {
  for (const name of ['guardian.lod0', 'guardian.lod1', 'guardian.lod2']) {
    const mats = new Set(await accessorBytes(meshes[name].primitives[0].attributes._MAT));
    assert.ok(mats.has(json.extras.surfaces.visor), `${name} visor`);
    assert.ok(mats.has(json.extras.surfaces.armor), `${name} armour`);
    if (name !== 'guardian.lod2') for (const s of ['core', 'seam']) assert.ok(mats.has(json.extras.surfaces[s]), `${name} ${s}`);
  }
  assert.ok(json.extras.visorAspect > 1.5 && json.extras.visorAspect < 5, `visor ${json.extras.visorAspect}`);
});
