/**
 * Paint your own 3D body. Everything runs on the GPU:
 *  - The body's paint texture is a render target. A stroke draws the body's mesh
 *    "flattened" into UV space; each texel knows its bind-pose 3D position, so the
 *    brush is a true 3D sphere on the body: no seams, no distortion.
 *  - Bucket fills one body part (from the skin weights), patterns are projected in
 *    3D, spray/blur/erase/mirror/line are modes of the same pass.
 *  - Snapshot projects what the camera sees onto the body (limited charges).
 *  - Undo keeps GPU copies; a dilation pass hides texel gaps at UV borders.
 */
import * as THREE from 'three';

export type Tool = 'brush' | 'spray' | 'bucket' | 'eyedrop' | 'eraser' | 'blur' | 'line' | 'pattern' | 'snapshot';
export type Pattern = 'stripes' | 'dots' | 'checker' | 'grain' | 'bricks' | 'tiles' | 'noise' | 'gradient';
export const PATTERNS: Pattern[] = ['stripes', 'dots', 'checker', 'grain', 'bricks', 'tiles', 'noise', 'gradient'];
export const PARTS = ['head', 'torso', 'armL', 'armR', 'legL', 'legR', 'antenna'] as const;
const BASE_WHITE = new THREE.Vector3(0.92, 0.92, 0.91);

const MODE = { brush: 0, eraser: 1, bucket: 2, spray: 3, pattern: 4, blur: 5, fill: 6 } as const;

/** Bone name -> body part id (1-based, matches PARTS order). */
const PART_OF_BONE: Record<string, number> = {
  head: 1, neck: 1, antenna: 7, root: 2, spine: 2,
  'upper_arm.L': 3, 'forearm.L': 3, 'upper_arm.R': 4, 'forearm.R': 4,
  'thigh.L': 5, 'shin.L': 5, 'thigh.R': 6, 'shin.R': 6,
  // glTF exporter may rename "." to "_"
  upper_armL: 3, forearmL: 3, upper_armR: 4, forearmR: 4, thighL: 5, shinL: 5, thighR: 6, shinR: 6,
};

const UV_VERT = /* glsl */ `
in vec3 position;
in vec2 uv;
in float aPart;
out vec3 vPos;
out float vPart;
out vec2 vUv;
void main() {
  vPos = position;
  vPart = aPart;
  vUv = uv;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const STAMP_FRAG = /* glsl */ `
precision highp float;
in vec3 vPos;
in float vPart;
in vec2 vUv;
out vec4 outColor;
uniform int uMode;
uniform vec3 uA;        // stroke segment start (bind space)
uniform vec3 uB;        // stroke segment end (line tool / interpolated strokes)
uniform bool uMirror;
uniform float uRadius;
uniform float uHard;
uniform float uOpacity;
uniform vec3 uColor;
uniform float uPart;
uniform int uPattern;
uniform float uPatScale;
uniform float uPatAngle;
uniform float uSeed;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform vec3 uWhite;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

float segDist(vec3 p, vec3 a, vec3 b) {
  vec3 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
  return distance(p, a + ab * t);
}
float falloff(float d) {
  float x = d / uRadius;
  if (x > 1.0) return 0.0;
  float h = clamp(uHard, 0.0, 0.98);
  return x < h ? 1.0 : 1.0 - smoothstep(h, 1.0, x);
}
float brushMask(vec3 p) {
  float m = falloff(segDist(p, uA, uB));
  if (uMirror) {
    vec3 q = vec3(-p.x, p.y, p.z);
    m = max(m, falloff(segDist(q, uA, uB)));
  }
  return m;
}
// pattern value 1 = tinted, 0 = keep; projected in 3D (dominant axis) so it wraps the body naturally
float pattern(vec3 p) {
  vec3 n = abs(p);
  vec2 q = (n.x > n.z) ? p.zy : p.xy;
  float c = cos(uPatAngle), s = sin(uPatAngle);
  q = mat2(c, -s, s, c) * q / max(uPatScale, 0.002);
  if (uPattern == 0) return step(0.5, fract(q.x));
  if (uPattern == 1) return 1.0 - step(0.28, distance(fract(q), vec2(0.5)));
  if (uPattern == 2) return mod(floor(q.x) + floor(q.y), 2.0);
  if (uPattern == 3) return step(0.35, sin((q.x + sin(q.y * 2.3) * 0.25) * 6.2832 * 1.5));
  if (uPattern == 4) { float row = floor(q.y * 2.0); vec2 b = fract(vec2(q.x + mod(row, 2.0) * 0.5, q.y * 2.0)); return step(0.07, b.x) * step(0.1, b.y); }
  if (uPattern == 5) { vec2 b = fract(q); return step(0.06, b.x) * step(0.06, b.y); }
  if (uPattern == 6) return step(0.5, hash(floor(q * 6.0)));
  return clamp(fract(q.y * 0.25), 0.0, 1.0);
}
vec3 blurSample(vec2 uv) {
  vec3 acc = vec3(0.0);
  for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) acc += texture(uSrc, uv + vec2(i, j) * uTexel * 1.5).rgb;
  return acc / 25.0;
}
void main() {
  float a = 0.0;
  vec3 col = uColor;
  if (uMode == 6) { outColor = vec4(uWhite, 1.0); return; }
  if (uMode == 2) {
    a = abs(vPart - uPart) < 0.5 ? uOpacity : 0.0;
    if (uPattern >= 0) a *= pattern(vPos);
  } else {
    a = brushMask(vPos) * uOpacity;
    if (uMode == 1) col = uWhite;
    if (uMode == 3) a *= step(0.8, hash(gl_FragCoord.xy + uSeed)) * 1.0;
    if (uMode == 4) a *= pattern(vPos);
    if (uMode == 5) col = blurSample(vUv);
  }
  if (a <= 0.001) discard;
  outColor = vec4(col, a);
}`;

const FS_VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COPY_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 outColor; uniform sampler2D uSrc;
void main() { outColor = texture(uSrc, vUv); }`;

// Grow painted islands outward by one texel per pass so bilinear sampling never shows the base colour at seams.
const DILATE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uSrc; uniform sampler2D uMask; uniform vec2 uTexel;
void main() {
  if (texture(uMask, vUv).r > 0.5) { outColor = texture(uSrc, vUv); return; }
  vec4 acc = vec4(0.0);
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
    vec2 o = vUv + vec2(i, j) * uTexel;
    float m = texture(uMask, o).r;
    acc += vec4(texture(uSrc, o).rgb * m, m);
  }
  outColor = acc.a > 0.0 ? vec4(acc.rgb / acc.a, 1.0) : texture(uSrc, vUv);
}`;

const MASK_FRAG = /* glsl */ `
precision highp float; out vec4 outColor; void main() { outColor = vec4(1.0); }`;

export interface BrushSettings {
  color: [number, number, number]; // sRGB 0..255
  size: number; // metres (bind space)
  hardness: number; // 0..1
  opacity: number; // 0..1
  mirror: boolean;
  pattern: Pattern;
  patternScale: number; // metres per tile
  patternAngle: number; // radians
}

export class PaintSystem {
  readonly rt: THREE.WebGLRenderTarget;
  private tmp: THREE.WebGLRenderTarget;
  private mask: THREE.WebGLRenderTarget;
  private undoStack: THREE.WebGLRenderTarget[] = [];
  private redoStack: THREE.WebGLRenderTarget[] = [];
  private uvScene = new THREE.Scene();
  private fsScene = new THREE.Scene();
  private cam = new THREE.Camera();
  private stampMat: THREE.RawShaderMaterial;
  private copyMat: THREE.RawShaderMaterial;
  private dilateMat: THREE.RawShaderMaterial;
  private maskMat: THREE.RawShaderMaterial;
  private uvMesh: THREE.Mesh;
  private fsQuad: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  snapshotsLeft = 2;
  private dirty = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    readonly mesh: THREE.SkinnedMesh,
    readonly size: number,
    private undoLimit: number,
  ) {
    const opts = {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    } as const;
    this.rt = new THREE.WebGLRenderTarget(size, size, opts);
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.tmp = new THREE.WebGLRenderTarget(size, size, opts);
    this.mask = new THREE.WebGLRenderTarget(size, size, opts);

    const geom = mesh.geometry as THREE.BufferGeometry;
    addPartAttribute(geom, mesh.skeleton);
    const texel = new THREE.Vector2(1 / size, 1 / size);
    this.stampMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: UV_VERT,
      fragmentShader: STAMP_FRAG,
      uniforms: {
        uMode: { value: 0 }, uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uMirror: { value: false },
        uRadius: { value: 0.02 }, uHard: { value: 0.5 }, uOpacity: { value: 1 }, uColor: { value: new THREE.Vector3(1, 1, 1) },
        uPart: { value: 1 }, uPattern: { value: -1 }, uPatScale: { value: 0.03 }, uPatAngle: { value: 0 }, uSeed: { value: 0 },
        uSrc: { value: this.tmp.texture }, uTexel: { value: texel }, uWhite: { value: BASE_WHITE },
      },
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.maskMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: UV_VERT, fragmentShader: MASK_FRAG, side: THREE.DoubleSide, depthTest: false });
    this.uvMesh = new THREE.Mesh(geom, this.stampMat);
    this.uvMesh.frustumCulled = false;
    this.uvScene.add(this.uvMesh);

    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.copyMat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FS_VERT, fragmentShader: COPY_FRAG, uniforms: { uSrc: { value: null } }, depthTest: false });
    this.dilateMat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FS_VERT,
      fragmentShader: DILATE_FRAG,
      uniforms: { uSrc: { value: null }, uMask: { value: this.mask.texture }, uTexel: { value: texel } },
      depthTest: false,
    });
    this.fsQuad = new THREE.Mesh(quad, this.copyMat);
    this.fsQuad.frustumCulled = false;
    this.fsScene.add(this.fsQuad);

    // island mask (once) and a white body
    this.drawUV(this.maskMat, this.mask, true);
    this.stampMat.uniforms.uMode.value = MODE.fill;
    this.drawUV(this.stampMat, this.rt, true);
    this.dilate(3);

    this.material = new THREE.MeshStandardMaterial({ map: this.rt.texture, roughness: 0.6, metalness: 0 });
    mesh.material = this.material;
  }

  // ------------------------------------------------------------------ low level passes
  private drawUV(mat: THREE.Material, target: THREE.WebGLRenderTarget, clear = false) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = clear;
    this.uvMesh.material = mat;
    r.setRenderTarget(target);
    if (clear) r.clear();
    r.render(this.uvScene, this.cam);
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
  }

  private fullscreen(mat: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget) {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    this.fsQuad.material = mat;
    r.setRenderTarget(target);
    r.render(this.fsScene, this.cam);
    r.setRenderTarget(prev);
  }

  private copy(src: THREE.WebGLRenderTarget, dst: THREE.WebGLRenderTarget) {
    this.copyMat.uniforms.uSrc.value = src.texture;
    this.fullscreen(this.copyMat, dst);
  }

  private dilate(passes = 2) {
    for (let i = 0; i < passes; i++) {
      this.dilateMat.uniforms.uSrc.value = this.rt.texture;
      this.fullscreen(this.dilateMat, this.tmp);
      this.copy(this.tmp, this.rt);
    }
  }

  // ------------------------------------------------------------------ history
  /** Call once at the start of every user action (a stroke, a fill...). */
  checkpoint() {
    let snap: THREE.WebGLRenderTarget | null = null;
    if (this.undoStack.length >= this.undoLimit) snap = this.undoStack.shift() ?? null;
    snap ??= new THREE.WebGLRenderTarget(this.size, this.size, { generateMipmaps: false, depthBuffer: false });
    this.copy(this.rt, snap);
    this.undoStack.push(snap);
    for (const r of this.redoStack) r.dispose();
    this.redoStack = [];
  }
  undo() {
    const s = this.undoStack.pop();
    if (!s) return false;
    const cur = new THREE.WebGLRenderTarget(this.size, this.size, { generateMipmaps: false, depthBuffer: false });
    this.copy(this.rt, cur);
    this.redoStack.push(cur);
    this.copy(s, this.rt);
    s.dispose();
    return true;
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return false;
    const cur = new THREE.WebGLRenderTarget(this.size, this.size, { generateMipmaps: false, depthBuffer: false });
    this.copy(this.rt, cur);
    this.undoStack.push(cur);
    this.copy(s, this.rt);
    s.dispose();
    return true;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  clearAll() {
    this.checkpoint();
    this.stampMat.uniforms.uMode.value = MODE.fill;
    this.drawUV(this.stampMat, this.rt, true);
    this.dilate(3);
  }

  // ------------------------------------------------------------------ painting
  private setBrush(b: BrushSettings) {
    const u = this.stampMat.uniforms;
    u.uColor.value.set(b.color[0] / 255, b.color[1] / 255, b.color[2] / 255);
    u.uRadius.value = b.size;
    u.uHard.value = b.hardness;
    u.uOpacity.value = b.opacity;
    u.uMirror.value = b.mirror;
    u.uPatScale.value = b.patternScale;
    u.uPatAngle.value = b.patternAngle;
  }

  /** Stamp a stroke segment between two bind-space points (a == b for a dab). */
  stroke(tool: Tool, a: THREE.Vector3, b: THREE.Vector3, brush: BrushSettings) {
    this.setBrush(brush);
    const u = this.stampMat.uniforms;
    u.uA.value.copy(a);
    u.uB.value.copy(b);
    u.uPattern.value = PATTERNS.indexOf(brush.pattern);
    u.uSeed.value = Math.random() * 1000;
    u.uMode.value =
      tool === 'eraser' ? MODE.eraser : tool === 'spray' ? MODE.spray : tool === 'pattern' ? MODE.pattern : tool === 'blur' ? MODE.blur : MODE.brush;
    if (tool === 'blur') this.copy(this.rt, this.tmp);
    this.drawUV(this.stampMat, this.rt);
    if (++this.dirty % 3 === 0) this.dilate(1);
  }

  /** Bucket-fill one body part (optionally with the current pattern). */
  fillPart(part: number, brush: BrushSettings, withPattern = false) {
    this.setBrush({ ...brush, mirror: false });
    const u = this.stampMat.uniforms;
    u.uMode.value = MODE.bucket;
    u.uPart.value = part;
    u.uPattern.value = withPattern ? PATTERNS.indexOf(brush.pattern) : -1;
    this.drawUV(this.stampMat, this.rt);
    this.dilate(2);
  }

  endStroke() {
    this.dilate(2);
  }

  /** Which body part a bind-space point belongs to (nearest vertex). */
  partAt(face: THREE.Face): number {
    const p = this.mesh.geometry.getAttribute('aPart') as THREE.BufferAttribute;
    return p.getX(face.a);
  }

  /**
   * Snapshot: projects what the camera sees (scene without the body) onto the body
   * from the current view. Low-res on purpose; limited charges per round.
   */
  snapshot(scene: THREE.Scene, camera: THREE.PerspectiveCamera): boolean {
    if (this.snapshotsLeft <= 0) return false;
    this.snapshotsLeft--;
    this.checkpoint();
    const r = this.renderer;
    const snap = new THREE.WebGLRenderTarget(256, 256, { generateMipmaps: false });
    snap.texture.colorSpace = THREE.SRGBColorSpace;
    const vis = this.mesh.visible;
    this.mesh.visible = false;
    const prev = r.getRenderTarget();
    r.setRenderTarget(snap);
    r.render(scene, camera);
    r.setRenderTarget(prev);
    this.mesh.visible = vis;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSnap: { value: snap.texture },
        uViewProj: { value: new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse) },
        uCamPos: { value: camera.position.clone() },
      },
      vertexShader: /* glsl */ `
        #include <common>
        #include <skinning_pars_vertex>
        uniform mat4 uViewProj;
        uniform vec3 uCamPos;
        varying vec4 vClip;
        varying float vFacing;
        void main() {
          #include <skinbase_vertex>
          #include <begin_vertex>
          #include <beginnormal_vertex>
          #include <skinnormal_vertex>
          #include <skinning_vertex>
          vec4 world = modelMatrix * vec4(transformed, 1.0);
          vec3 n = normalize(mat3(modelMatrix) * objectNormal);
          vFacing = dot(n, normalize(uCamPos - world.xyz));
          vClip = uViewProj * world;
          gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uSnap;
        varying vec4 vClip;
        varying float vFacing;
        void main() {
          vec2 ndc = vClip.xy / vClip.w;
          if (vFacing < 0.05 || abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0) discard;
          gl_FragColor = vec4(texture2D(uSnap, ndc * 0.5 + 0.5).rgb, smoothstep(0.05, 0.35, vFacing));
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // a skinned twin of the body so the projection follows the current pose
    const twin = new THREE.SkinnedMesh(this.mesh.geometry, mat);
    twin.bind(this.mesh.skeleton, this.mesh.bindMatrix);
    twin.matrixWorld.copy(this.mesh.matrixWorld);
    twin.matrixAutoUpdate = false;
    twin.frustumCulled = false;
    const s = new THREE.Scene();
    s.add(twin);
    const prevAuto = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(this.rt);
    r.render(s, this.cam);
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
    this.dilate(2);
    mat.dispose();
    snap.dispose();
    return true;
  }

  /** Small PNG of the paint (for sharing / late joiners). */
  toPixels(): Uint8Array {
    const px = new Uint8Array(this.size * this.size * 4);
    this.renderer.readRenderTargetPixels(this.rt, 0, 0, this.size, this.size, px);
    return px;
  }

  setFinish(roughness: number, metalness: number) {
    this.material.roughness = roughness;
    this.material.metalness = metalness;
  }

  dispose() {
    [this.rt, this.tmp, this.mask, ...this.undoStack, ...this.redoStack].forEach((t) => t.dispose());
    this.stampMat.dispose();
    this.copyMat.dispose();
    this.dilateMat.dispose();
    this.maskMat.dispose();
  }
}

/** Per-vertex body-part id from the strongest skin weight. */
function addPartAttribute(geom: THREE.BufferGeometry, skeleton: THREE.Skeleton) {
  if (geom.getAttribute('aPart')) return;
  const si = geom.getAttribute('skinIndex');
  const sw = geom.getAttribute('skinWeight');
  const n = geom.getAttribute('position').count;
  const part = new Float32Array(n);
  const names = skeleton.bones.map((b) => b.name.replace(/[^A-Za-z0-9_.]/g, ''));
  for (let i = 0; i < n; i++) {
    let best = 0;
    let w = -1;
    for (let k = 0; k < 4; k++) {
      const wk = sw.getComponent(i, k);
      if (wk > w) {
        w = wk;
        best = si.getComponent(i, k);
      }
    }
    part[i] = PART_OF_BONE[names[best]] ?? 2;
  }
  geom.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
}

/** Convert a raycast hit on the (posed) body to its bind-pose position in mesh space. */
export function hitToBind(mesh: THREE.SkinnedMesh, hit: THREE.Intersection, out: THREE.Vector3): THREE.Vector3 | null {
  const f = hit.face;
  if (!f) return null;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  mesh.getVertexPosition(f.a, a);
  mesh.getVertexPosition(f.b, b);
  mesh.getVertexPosition(f.c, c);
  const local = mesh.worldToLocal(hit.point.clone());
  const bary = new THREE.Vector3();
  THREE.Triangle.getBarycoord(local, a, b, c, bary);
  if (!bary) return null;
  const pos = mesh.geometry.getAttribute('position');
  const pa = new THREE.Vector3().fromBufferAttribute(pos, f.a);
  const pb = new THREE.Vector3().fromBufferAttribute(pos, f.b);
  const pc = new THREE.Vector3().fromBufferAttribute(pos, f.c);
  return out.set(0, 0, 0).addScaledVector(pa, bary.x).addScaledVector(pb, bary.y).addScaledVector(pc, bary.z);
}
