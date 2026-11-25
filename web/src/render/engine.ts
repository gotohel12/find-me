/** Renderer, scene, lighting, quality tiers and asset loading. */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { isTouchDevice } from '../input/input.ts';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITY: Record<Quality, { pixelRatio: number; shadows: boolean; shadowMap: number; paintSize: number; undo: number }> = {
  low: { pixelRatio: 0.75, shadows: false, shadowMap: 512, paintSize: 512, undo: 10 },
  medium: { pixelRatio: 1, shadows: true, shadowMap: 1024, paintSize: 1024, undo: 15 },
  high: { pixelRatio: 1.5, shadows: true, shadowMap: 2048, paintSize: 2048, undo: 25 },
  ultra: { pixelRatio: 2, shadows: true, shadowMap: 4096, paintSize: 4096, undo: 30 },
};

export function pickQuality(): Quality {
  try {
    const saved = localStorage.getItem('findme.quality') as Quality | null;
    if (saved && saved in QUALITY) return saved;
  } catch {
    /* ignore */
  }
  if (isTouchDevice()) return 'medium';
  return (navigator.hardwareConcurrency ?? 4) >= 8 ? 'high' : 'medium';
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(65, 1, 0.03, 120);
  readonly loader = new GLTFLoader();
  readonly clock = new THREE.Clock();
  sun!: THREE.DirectionalLight;
  quality: Quality;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.quality = pickQuality();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.background = new THREE.Color(0x1b1440);
    this.applyQuality();
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  applyQuality() {
    const q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (this.sun) {
      this.sun.castShadow = q.shadows;
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.sun.shadow.map?.dispose();
      (this.sun.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    this.resize();
  }

  setQuality(q: Quality) {
    this.quality = q;
    try {
      localStorage.setItem('findme.quality', q);
    } catch {
      /* ignore */
    }
    this.applyQuality();
  }

  resize = () => {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  async load(url: string, onProgress?: (f: number) => void): Promise<GLTF> {
    return this.loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
  }

  /** Map lighting: warm key light matching the Blender sun + soft fill. */
  setupLights(
    sunDirWorld: [number, number, number] | null,
    size: [number, number, number],
    points: { pos: number[]; color: number[]; intensity: number; distance: number }[] = [],
  ) {
    const hemi = new THREE.HemisphereLight(0xfff4e6, 0x6b5a48, 0.55);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff0dd, 2.2);
    // Blender is Z-up; the glTF exporter makes it Y-up: (x, y, z) -> (x, z, -y)
    const d = sunDirWorld ? new THREE.Vector3(sunDirWorld[0], sunDirWorld[2], -sunDirWorld[1]) : new THREE.Vector3(0.4, 1, 0.3);
    const [W, D] = size;
    const centre = new THREE.Vector3(0, 0, -D / 2);
    this.sun.position.copy(centre).addScaledVector(d.normalize(), 8);
    this.sun.target.position.copy(centre);
    const cam = this.sun.shadow.camera;
    const r = Math.max(W, D) * 0.7;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = 30;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    // lamps and window sky light from the map (no shadows: cheap on phones)
    if (points.length) {
      for (const p of points) {
        const l = new THREE.PointLight(new THREE.Color(p.color[0], p.color[1], p.color[2]), p.intensity, p.distance, 1.6);
        l.position.set(p.pos[0], p.pos[2], -p.pos[1]);
        this.scene.add(l);
      }
    } else {
      // ceiling bounce so a closed room isn't dark
      const bounce = new THREE.PointLight(0xffe8cc, 6, 12, 1.6);
      bounce.position.set(0, 2.4, -D / 2);
      this.scene.add(bounce);
    }
    this.applyQuality();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Exact on-screen colour at a CSS pixel (what the player sees), for the eyedropper. */
  pickScreenColor(cssX: number, cssY: number): [number, number, number] {
    this.render();
    const gl = this.renderer.getContext();
    const pr = this.renderer.getPixelRatio();
    const px = new Uint8Array(4);
    gl.readPixels(Math.floor(cssX * pr), Math.floor(gl.drawingBufferHeight - cssY * pr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2]];
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }
}
