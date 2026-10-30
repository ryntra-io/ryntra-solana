import * as THREE from 'three';

/**
 * Every tower's state on the GPU (CITY-56): one small float texture the skyline's modules read by tower index, so a
 * moment (a pump's glow, a flare knocking the top off, a launch growing) reaches every module of a tower with one
 * write. Rows: 0 accent rgb + activity, 1 event glow rgb + level, 2 build + height + seed + kind, 3 x + z + width + the
 * Lens's level (CITY-86: 1 looked at, −1 sunk into the haze, 0 untouched).
 */
export class TowerState {
  readonly texture: THREE.DataTexture;
  private readonly data: Float32Array;
  private readonly width: number;
  private dirty = false;

  constructor(count: number) {
    this.width = Math.max(1, count);
    this.data = new Float32Array(this.width * 4 * 4);
    this.texture = new THREE.DataTexture(this.data, this.width, 4, THREE.RGBAFormat, THREE.FloatType);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.needsUpdate = true;
  }

  private set(row: number, i: number, a: number, b: number, c: number, d: number) {
    const o = (row * this.width + i) * 4;
    this.data[o] = a;
    this.data[o + 1] = b;
    this.data[o + 2] = c;
    this.data[o + 3] = d;
    this.dirty = true;
  }

  tower(i: number, accent: THREE.Color, activity: number, height: number, seed: number, kind: number, x: number, z: number, width: number) {
    this.set(0, i, accent.r, accent.g, accent.b, activity);
    this.set(1, i, 0, 0, 0, 0);
    this.set(2, i, 1, height, (seed % 100000) / 1000, kind);
    this.set(3, i, x, z, width, 0);
  }

  glow(i: number, r: number, g: number, b: number, level: number) {
    this.set(1, i, r, g, b, level);
  }

  build(i: number, value: number) {
    const o = (2 * this.width + i) * 4;
    if (this.data[o] === value) return;
    this.data[o] = value;
    this.dirty = true;
  }

  lens(i: number, value: number) {
    const o = (3 * this.width + i) * 4 + 3;
    if (this.data[o] === value) return;
    this.data[o] = value;
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  dispose() {
    this.texture.dispose();
  }
}
