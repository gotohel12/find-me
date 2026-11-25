/**
 * Merge a static level's many small meshes into one mesh per material: hundreds of
 * draw calls become a few dozen (the main cost of the first build on phones).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const ATTRS = ['position', 'normal', 'uv'] as const;

function toPlain(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry | null {
  const pos = g.getAttribute('position');
  if (!pos) return null;
  const out = new THREE.BufferGeometry();
  const n = pos.count;
  for (const name of ATTRS) {
    const a = g.getAttribute(name);
    if (!a) {
      if (name === 'uv') out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      else if (name === 'normal') continue;
      continue;
    }
    const size = a.itemSize;
    const arr = new Float32Array(n * size);
    for (let i = 0; i < n; i++) {
      arr[i * size] = a.getX(i);
      if (size > 1) arr[i * size + 1] = a.getY(i);
      if (size > 2) arr[i * size + 2] = a.getZ(i);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  if (g.index) out.setIndex(Array.from(g.index.array as ArrayLike<number>));
  out.applyMatrix4(m);
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

export function mergeStatic(root: THREE.Object3D): { before: number; after: number; merged: THREE.Group } {
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  let before = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(mesh.material)) return;
    before++;
    const g = toPlain(mesh.geometry, mesh.matrixWorld);
    if (!g) return;
    const list = groups.get(mesh.material) ?? [];
    list.push(g);
    groups.set(mesh.material, list);
  });
  const merged = new THREE.Group();
  merged.name = 'level_merged';
  for (const [mat, geoms] of groups) {
    const indexed = geoms.every((g) => g.index);
    const geo = mergeGeometries(indexed ? geoms : geoms.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    if (!geo) continue;
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    merged.add(m);
    geoms.forEach((g) => g.dispose());
  }
  return { before, after: merged.children.length, merged };
}
