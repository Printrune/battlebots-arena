import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Material } from '@babylonjs/core/Materials/material';
import type { Scene } from '@babylonjs/core/scene';

export type Point = readonly [number, number, number];
interface Placement { parent?: TransformNode; moving?: boolean; keep?: boolean }
interface Part { mesh: Mesh; parent: TransformNode; moving: boolean; keep: boolean }
export interface StageStats { meshes: number; triangles: number; staticMeshes: number; movingMeshes: number }

/** Owns only BattleBox geometry. It never walks or batches unrelated scene meshes. */
export class StageGeometry {
  readonly root: TransformNode;
  private readonly parts: Part[] = [];
  private count = 0;

  constructor(readonly scene: Scene) { this.root = new TransformNode('battlebox-stage', scene); }

  node(name: string, position: Point = [0, 0, 0], parent = this.root): TransformNode {
    const result = new TransformNode(name, this.scene);
    result.parent = parent;
    result.position.set(...position);
    return result;
  }

  private own(mesh: Mesh, mat: Material, placement: Placement): Mesh {
    const parent = placement.parent ?? this.root;
    mesh.material = mat; mesh.parent = parent;
    mesh.isPickable = false;
    this.parts.push({ mesh, parent, moving: placement.moving ?? false, keep: placement.keep ?? false });
    return mesh;
  }

  box(name: string, size: Point, position: Point, mat: Material, placement: Placement = {}): Mesh {
    const result = MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, this.scene);
    result.position.set(...position);
    return this.own(result, mat, placement);
  }

  cylinder(name: string, diameter: number, height: number, position: Point, mat: Material, axis: 'x' | 'y' | 'z' = 'y', placement: Placement = {}, segments = 16): Mesh {
    const result = MeshBuilder.CreateCylinder(`${name}-${this.count++}`, { diameter, height, tessellation: segments }, this.scene);
    result.position.set(...position);
    if (axis === 'x') result.rotation.z = -Math.PI / 2;
    if (axis === 'z') result.rotation.x = Math.PI / 2;
    return this.own(result, mat, placement);
  }

  beam(name: string, a: Point, b: Point, width: number, height: number, mat: Material, placement: Placement = {}): Mesh {
    const start = new Vector3(...a); const end = new Vector3(...b); const delta = end.subtract(start);
    const result = this.box(name, [width, height, delta.length()], [0, 0, 0], mat, placement);
    result.position.copyFrom(start.add(end).scale(0.5));
    result.rotationQuaternion = Quaternion.FromLookDirectionLH(delta.normalize(), Vector3.Up());
    return result;
  }

  custom(name: string, positions: number[], indices: number[], mat: Material, placement: Placement = {}, uvs: number[] = []): Mesh {
    const result = new Mesh(name, this.scene);
    const data = new VertexData(); const normals: number[] = [];
    data.positions = positions; data.indices = indices;
    VertexData.ComputeNormals(positions, indices, normals);
    data.normals = normals;
    if (uvs.length) data.uvs = uvs;
    data.applyToMesh(result);
    return this.own(result, mat, placement);
  }

  ground(name: string, width: number, depth: number, position: Point, mat: Material, placement: Placement = {}): Mesh {
    const result = MeshBuilder.CreateGround(name, { width, height: depth }, this.scene);
    result.position.set(...position); result.receiveShadows = true;
    return this.own(result, mat, placement);
  }

  finish(): { meshes: Mesh[]; stats: StageStats } {
    const groups = new Map<string, { parent: TransformNode; moving: boolean; parts: Mesh[] }>();
    const output: Mesh[] = []; let movingMeshes = 0;
    for (const part of this.parts) {
      if (part.keep) {
        output.push(part.mesh);
        if (part.moving) movingMeshes += 1;
        else part.mesh.freezeWorldMatrix();
        continue;
      }
      const key = `${part.moving ? part.parent.uniqueId : 'fixed'}:${part.mesh.material?.uniqueId ?? -1}`;
      const group = groups.get(key) ?? { parent: part.moving ? part.parent : this.root, moving: part.moving, parts: [] };
      group.parts.push(part.mesh); groups.set(key, group);
    }
    for (const [key, group] of groups) {
      for (const mesh of group.parts) mesh.computeWorldMatrix(true);
      const merged = Mesh.MergeMeshes(group.parts, true, true);
      if (!merged) continue;
      merged.name = `${group.parent.name}-batch-${key}`;
      const inverse = Matrix.Invert(group.parent.computeWorldMatrix(true));
      merged.bakeTransformIntoVertices(inverse);
      merged.parent = group.parent;
      merged.position.setAll(0); merged.rotation.setAll(0); merged.rotationQuaternion = null; merged.scaling.setAll(1);
      merged.isPickable = false;
      if (group.moving) movingMeshes += 1;
      else merged.freezeWorldMatrix();
      output.push(merged);
    }
    let triangles = 0;
    for (const mesh of output) triangles += mesh.getTotalIndices() / 3;
    return { meshes: output, stats: { meshes: output.length, triangles, staticMeshes: output.length - movingMeshes, movingMeshes } };
  }
}
