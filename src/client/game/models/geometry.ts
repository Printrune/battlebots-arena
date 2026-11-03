import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';
import type { DamagePartId } from '../../../shared/damage';

export type Point2 = readonly [number, number];
export type Point3 = readonly [number, number, number];

function cross(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Ear clipping gives solid armor plates scalloped outlines without extra dependencies. */
function triangulate(points: readonly Point2[]): number[] {
  const remaining = points.map((_, index) => index);
  const triangles: number[] = [];
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return next ? sum + point[0] * next[1] - next[0] * point[1] : sum;
  }, 0);
  if (area < 0) remaining.reverse();
  while (remaining.length > 3) {
    let clipped = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const before = remaining[(index + remaining.length - 1) % remaining.length];
      const current = remaining[index];
      const after = remaining[(index + 1) % remaining.length];
      if (before === undefined || current === undefined || after === undefined) continue;
      const a = points[before]; const b = points[current]; const c = points[after];
      if (!a || !b || !c || cross(a, b, c) <= 0.000001) continue;
      const occupied = remaining.some((candidate) => {
        if (candidate === before || candidate === current || candidate === after) return false;
        const p = points[candidate];
        return p ? cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0 : false;
      });
      if (occupied) continue;
      triangles.push(before, current, after);
      remaining.splice(index, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (remaining.length === 3) {
    const [a, b, c] = remaining;
    if (a !== undefined && b !== undefined && c !== undefined) triangles.push(a, b, c);
  }
  return triangles;
}

export class ModelBuilder {
  readonly root: TransformNode;
  readonly weapon: TransformNode;
  readonly wheels: TransformNode[] = [];
  readonly parts = new Map<DamagePartId, TransformNode>();
  private readonly meshes: Mesh[] = [];
  private readonly parents: TransformNode[] = [];
  private count = 0;

  constructor(readonly scene: Scene, readonly id: string) {
    this.root = new TransformNode(`bot-${id}`, scene);
    this.parents.push(this.root);
    this.weapon = this.pivot('weapon');
    this.parts.set('weapon', this.weapon);
  }

  pivot(name: string, position: Point3 = [0, 0, 0]): TransformNode {
    const node = new TransformNode(`${this.id}-${name}`, this.scene);
    node.parent = this.root;
    node.position.set(...position);
    this.parents.push(node);
    return node;
  }

  checkpoint(): number { return this.meshes.length; }

  registerPart(id: DamagePartId, node: TransformNode): void { this.parts.set(id, node); }

  /** Preserve a physical panel's seam and local origin before material batching. */
  capturePart(id: DamagePartId, position: Point3, from: number): TransformNode {
    const node = this.pivot(id, position);
    for (let index = from; index < this.meshes.length; index += 1) {
      const mesh = this.meshes[index];
      if (!mesh || mesh.parent !== this.root) continue;
      mesh.position.subtractInPlace(node.position);
      mesh.parent = node;
    }
    this.parts.set(id, node);
    return node;
  }

  private add(mesh: Mesh, mat: Material, parent: TransformNode): Mesh {
    mesh.material = mat;
    mesh.parent = parent;
    this.meshes.push(mesh);
    return mesh;
  }

  box(name: string, size: Point3, position: Point3, mat: Material, parent = this.root): Mesh {
    const mesh = MeshBuilder.CreateBox(`${this.id}-${name}-${this.count++}`, { width: size[0], height: size[1], depth: size[2] }, this.scene);
    mesh.position.set(...position);
    return this.add(mesh, mat, parent);
  }

  cylinder(name: string, diameter: number, depth: number, position: Point3, mat: Material, axis: 'x' | 'y' | 'z' = 'y', parent = this.root, tessellation = 32): Mesh {
    const mesh = MeshBuilder.CreateCylinder(`${this.id}-${name}-${this.count++}`, { diameter, height: depth, tessellation }, this.scene);
    mesh.position.set(...position);
    if (axis === 'x') mesh.rotation.z = -Math.PI / 2;
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    return this.add(mesh, mat, parent);
  }

  tube(name: string, points: readonly Point3[], radius: number, mat: Material, parent = this.root, tessellation = 8): Mesh {
    const mesh = MeshBuilder.CreateTube(`${this.id}-${name}-${this.count++}`, {
      path: points.map((point) => new Vector3(...point)), radius, tessellation, cap: Mesh.CAP_ALL,
    }, this.scene);
    return this.add(mesh, mat, parent);
  }

  beam(name: string, a: Point3, b: Point3, width: number, height: number, mat: Material, parent = this.root): Mesh {
    const start = new Vector3(...a); const end = new Vector3(...b);
    const delta = end.subtract(start);
    const mesh = this.box(name, [width, height, delta.length()], [0, 0, 0], mat, parent);
    mesh.position.copyFrom(start.add(end).scale(0.5));
    mesh.rotationQuaternion = Quaternion.FromLookDirectionLH(delta.normalize(), Vector3.Up());
    return mesh;
  }

  polygon(name: string, outline: readonly Point2[], thickness: number, position: Point3, mat: Material, axis: 'x' | 'y' | 'z' = 'y', parent = this.root): Mesh {
    const positions: number[] = []; const uvs: number[] = []; const indices: number[] = [];
    const minU = Math.min(...outline.map((p) => p[0])); const maxU = Math.max(...outline.map((p) => p[0]));
    const minV = Math.min(...outline.map((p) => p[1])); const maxV = Math.max(...outline.map((p) => p[1]));
    const convert = (u: number, v: number, depth: number): Point3 => axis === 'x' ? [depth, u, v] : axis === 'z' ? [u, v, depth] : [u, depth, v];
    for (const depth of [-thickness / 2, thickness / 2]) {
      for (const p of outline) {
        positions.push(...convert(p[0], p[1], depth));
        const u = (p[0] - minU) / Math.max(0.001, maxU - minU);
        const v = (p[1] - minV) / Math.max(0.001, maxV - minV);
        // Upright decal plates follow Babylon's box convention: image-top V=0
        // belongs at the highest Y. Horizontal deck/rib UVs retain their layout.
        // A viewer outside the +Z cap sees increasing world X from right to left.
        // Mirror that cap's U only, so the printed front cheek reads naturally.
        uvs.push(axis === 'z' && depth > 0 ? 1 - u : u, axis === 'z' ? 1 - v : v);
      }
    }
    const cap = triangulate(outline);
    for (let n = 0; n < cap.length; n += 3) {
      const a = cap[n]; const b = cap[n + 1]; const c = cap[n + 2];
      if (a === undefined || b === undefined || c === undefined) continue;
      const flip = axis === 'y';
      indices.push(a, flip ? b : c, flip ? c : b);
      indices.push(a + outline.length, (flip ? c : b) + outline.length, (flip ? b : c) + outline.length);
    }
    for (let n = 0; n < outline.length; n += 1) {
      const next = (n + 1) % outline.length;
      indices.push(n, next, next + outline.length, n, next + outline.length, n + outline.length);
    }
    const mesh = this.vertexMesh(name, positions, indices, uvs, mat, parent);
    mesh.position.set(...position);
    return mesh;
  }

  vertexMesh(name: string, positions: number[], indices: number[], uvs: number[], mat: Material, parent = this.root): Mesh {
    const mesh = new Mesh(`${this.id}-${name}-${this.count++}`, this.scene);
    const data = new VertexData();
    data.positions = positions; data.indices = indices; data.uvs = uvs;
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    data.normals = normals;
    data.applyToMesh(mesh);
    return this.add(mesh, mat, parent);
  }

  bolt(position: Point3, diameter: number, mat: Material, axis: 'x' | 'y' | 'z' = 'y', parent = this.root): Mesh[] {
    return [
      this.cylinder('washer', diameter * 1.42, diameter * 0.12, position, mat, axis, parent, 12),
      this.cylinder('hex-fastener', diameter, diameter * 0.55, position, mat, axis, parent, 6),
    ];
  }

  /** Closed rubber cross-section, recessed hub, and interlocking solid tread blocks. */
  tire(x: number, z: number, radius: number, width: number, rubber: Material, hub: Material, steel: Material, dark: Material): TransformNode {
    const pivot = this.pivot(`wheel-${this.wheels.length}`, [x, 0, z]);
    this.wheels.push(pivot);
    const positions: number[] = []; const indices: number[] = []; const uvs: number[] = [];
    const profile: Point2[] = [[-0.5, 0.52], [-0.5, 0.87], [-0.4, 0.97], [0, 1], [0.4, 0.97], [0.5, 0.87], [0.5, 0.52]];
    const slices = 48;
    for (const [axial, radial] of profile) {
      for (let n = 0; n <= slices; n += 1) {
        const angle = n / slices * Math.PI * 2;
        positions.push(axial * width, Math.cos(angle) * radial * radius, Math.sin(angle) * radial * radius);
        uvs.push(n / slices * 3, (radial - 0.5) * 2);
      }
    }
    for (let p = 0; p < profile.length; p += 1) {
      for (let n = 0; n < slices; n += 1) {
        const a = p * (slices + 1) + n; const b = ((p + 1) % profile.length) * (slices + 1) + n;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    this.vertexMesh('solid-rubber-tire', positions, indices, uvs, rubber, pivot);
    for (let n = 0; n < 28; n += 1) {
      for (const row of [-1, 1]) {
        const angle = (n + row * 0.25) / 28 * Math.PI * 2;
        const tread = this.box('tread-block', [width * 0.43, radius * 0.075, radius * 0.17],
          [row * width * 0.24, Math.cos(angle) * radius * 0.975, Math.sin(angle) * radius * 0.975], rubber, pivot);
        tread.rotation.x = angle;
        tread.rotation.y = row * 0.18;
      }
    }
    const outward = x < 0 ? -1 : 1;
    this.cylinder('rim-core', radius * 1.08, width * 0.9, [0, 0, 0], hub, 'x', pivot, 32);
    this.cylinder('rim-recess', radius * 0.88, width * 0.93, [0, 0, 0], dark, 'x', pivot, 32);
    for (let n = 0; n < 5; n += 1) {
      const angle = n / 5 * Math.PI * 2;
      const spoke = this.box('rim-spoke', [0.04, radius * 0.39, radius * 0.12],
        [outward * width * 0.48, Math.cos(angle) * radius * 0.23, Math.sin(angle) * radius * 0.23], hub, pivot);
      spoke.rotation.x = angle;
      this.bolt([outward * width * 0.51, Math.cos(angle) * radius * 0.19, Math.sin(angle) * radius * 0.19], radius * 0.075, steel, 'x', pivot);
    }
    this.cylinder('axle-cap', radius * 0.37, width * 1.08, [0, 0, 0], steel, 'x', pivot, 24);
    this.cylinder('axle-hole', radius * 0.12, width * 1.11, [0, 0, 0], dark, 'x', pivot, 16);
    return pivot;
  }

  /** Batch by material inside each moving pivot, preserving wheel/weapon animation. */
  finish(): Mesh[] {
    const optimized: Mesh[] = [];
    for (const parent of this.parents) {
      const groups = new Map<number, Mesh[]>();
      for (const part of this.meshes.filter((mesh) => mesh.parent === parent)) {
        const key = part.material?.uniqueId ?? -1;
        const group = groups.get(key) ?? [];
        group.push(part); groups.set(key, group);
      }
      const translation = parent.position.clone();
      parent.position.setAll(0); parent.computeWorldMatrix(true);
      for (const group of groups.values()) {
        if (group.length === 1) {
          const mesh = group[0]; if (mesh) optimized.push(mesh);
        } else {
          for (const part of group) part.computeWorldMatrix(true);
          const merged = Mesh.MergeMeshes(group, true, true);
          if (merged) { merged.parent = parent; optimized.push(merged); }
        }
      }
      parent.position.copyFrom(translation); parent.computeWorldMatrix(true);
    }
    for (const mesh of optimized) { mesh.receiveShadows = true; mesh.isPickable = false; }
    return optimized;
  }
}
