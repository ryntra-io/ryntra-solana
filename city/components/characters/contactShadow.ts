import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

/**
 * A contact shadow under a character: the body seen from just under the ground, each texel as dark as the surface
 * above it is low, blurred, laid on the ground. drei's ContactShadows cannot draw it — it overrides every material,
 * and the body's vertices are placed by its bones in the body shader — so the body's own material draws it here, in
 * its `shadow` mode, sharing the live bones. A studio and hero-scene effect: one extra draw of the body and two blurs.
 */

const SIZE = 256;
const EXTENT = 3.2;

export class ContactShadow {
  readonly ground: THREE.Mesh;
  private readonly targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private readonly camera: THREE.OrthographicCamera;
  private readonly scene = new THREE.Scene();
  private readonly proxy: THREE.Mesh;
  private readonly blur: { h: THREE.ShaderMaterial; v: THREE.ShaderMaterial; quad: THREE.Mesh; scene: THREE.Scene; camera: THREE.OrthographicCamera };

  constructor(shadowMaterial: THREE.ShaderMaterial, opacity = 0.95) {
    const opts = { type: THREE.HalfFloatType, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.targets = [new THREE.WebGLRenderTarget(SIZE, SIZE, opts), new THREE.WebGLRenderTarget(SIZE, SIZE, { ...opts, depthBuffer: false })];
    // From just under the ground looking up: the lowest surface over each texel is the nearest, so it wins the depth test.
    this.camera = new THREE.OrthographicCamera(-EXTENT / 2, EXTENT / 2, EXTENT / 2, -EXTENT / 2, 0.0, 3.0);
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(0, -0.01, 0);
    this.camera.lookAt(0, 1, 0);
    this.camera.updateMatrix();
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.proxy = new THREE.Mesh(new THREE.BufferGeometry(), shadowMaterial);
    this.proxy.frustumCulled = false;
    this.proxy.matrixAutoUpdate = false;
    this.scene.add(this.proxy);

    const h = new THREE.ShaderMaterial({ ...HorizontalBlurShader, uniforms: THREE.UniformsUtils.clone(HorizontalBlurShader.uniforms), depthTest: false });
    const v = new THREE.ShaderMaterial({ ...VerticalBlurShader, uniforms: THREE.UniformsUtils.clone(VerticalBlurShader.uniforms), depthTest: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), h);
    const scene = new THREE.Scene();
    scene.add(quad);
    this.blur = { h, v, quad, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };

    const plane = new THREE.PlaneGeometry(EXTENT, EXTENT);
    plane.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(
      plane,
      new THREE.ShaderMaterial({
        uniforms: { uShadow: { value: this.targets[0].texture }, uOpacity: { value: opacity } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uShadow;
          uniform float uOpacity;
          varying vec2 vUv;
          void main() {
            // The camera looked up, so the picture is mirrored across x.
            float d = texture2D(uShadow, vec2(1.0 - vUv.x, vUv.y)).a;
            float edge = 1.0 - smoothstep(0.42, 0.5, length(vUv - 0.5));
            gl_FragColor = vec4(vec3(0.0), min(1.0, d * 2.8) * uOpacity * edge);
          }
        `,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.ground.position.y = 0.003;

    this.ground.renderOrder = -1;
  }

  /** Renders the shadow of `body` (its geometry now, placed as it is in the world) under `home` (the character's space). */
  update(gl: THREE.WebGLRenderer, body: THREE.Mesh, home: THREE.Object3D) {
    this.proxy.geometry = body.geometry;
    this.proxy.matrix.copy(body.matrixWorld);
    this.proxy.matrixWorldNeedsUpdate = true;
    this.camera.matrixWorld.multiplyMatrices(home.matrixWorld, this.camera.matrix);
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    const before = gl.getRenderTarget();
    const clear = gl.getClearColor(new THREE.Color());
    const alpha = gl.getClearAlpha();
    const auto = gl.autoClear;
    gl.autoClear = true;
    gl.setClearColor(0x000000, 0);
    gl.setRenderTarget(this.targets[0]);
    gl.render(this.scene, this.camera);
    // Two blur passes each way, ping-ponging between the targets.
    const { h, v, quad, scene, camera } = this.blur;
    for (let i = 0; i < 2; i += 1) {
      quad.material = h;
      h.uniforms.tDiffuse!.value = this.targets[0].texture;
      h.uniforms.h!.value = (1.4 + i) / SIZE;
      gl.setRenderTarget(this.targets[1]);
      gl.render(scene, camera);
      quad.material = v;
      v.uniforms.tDiffuse!.value = this.targets[1].texture;
      v.uniforms.v!.value = (1.4 + i) / SIZE;
      gl.setRenderTarget(this.targets[0]);
      gl.render(scene, camera);
    }
    gl.setRenderTarget(before);
    gl.setClearColor(clear, alpha);
    gl.autoClear = auto;
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    this.blur.h.dispose();
    this.blur.v.dispose();
    this.blur.quad.geometry.dispose();
  }
}
