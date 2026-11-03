import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { paintColor, type BotId, type PaintId } from '../../shared/protocol';

export interface BotModel {
  root: TransformNode;
  wheels: TransformNode[];
  weapon: TransformNode;
  accent: StandardMaterial;
  glow: StandardMaterial;
  meshes: Mesh[];
  botId: BotId;
  paint: PaintId;
  dispose(): void;
}

export function material(scene: Scene, name: string, color: string, shine = 0.25): StandardMaterial {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = Color3.FromHexString(color);
  result.specularColor = new Color3(shine, shine, shine);
  result.specularPower = 80;
  return result;
}

export function makeBot(scene: Scene, botId: BotId, paint: PaintId, id: string): BotModel {
  const root = new TransformNode(`bot-${id}`, scene);
  const steel = material(scene, `${id}-steel`, '#777e84', 0.85);
  const darkSteel = material(scene, `${id}-dark-steel`, '#262b30', 0.65);
  const rubber = material(scene, `${id}-rubber`, '#101216', 0.08);
  const accent = material(scene, `${id}-paint`, paintColor(botId, paint), 0.5);
  const purple = material(scene, `${id}-purple`, '#584579', 0.5);
  const white = material(scene, `${id}-ivory`, '#d9ddc4', 0.5);
  const glow = material(scene, `${id}-light`, paintColor(botId, paint));
  glow.emissiveColor = Color3.FromHexString(paintColor(botId, paint)).scale(0.8);
  const meshes: Mesh[] = [];
  const wheels: TransformNode[] = [];

  function box(name: string, width: number, height: number, depth: number, position: Vector3, mat: StandardMaterial, parent: TransformNode = root): Mesh {
    const mesh = MeshBuilder.CreateBox(`${id}-${name}`, { width, height, depth }, scene);
    mesh.parent = parent;
    mesh.position.copyFrom(position);
    mesh.material = mat;
    meshes.push(mesh);
    return mesh;
  }

  function cylinder(name: string, diameter: number, height: number, position: Vector3, mat: StandardMaterial, parent: TransformNode = root, tessellation = 16): Mesh {
    const mesh = MeshBuilder.CreateCylinder(`${id}-${name}`, { diameter, height, tessellation }, scene);
    mesh.parent = parent;
    mesh.position.copyFrom(position);
    mesh.material = mat;
    meshes.push(mesh);
    return mesh;
  }

  function wheel(x: number, z: number, diameter: number): void {
    const pivot = new TransformNode(`${id}-wheel-pivot-${wheels.length}`, scene);
    pivot.parent = root;
    pivot.position.set(x, diameter / 2 - 0.43, z);
    const tire = cylinder('tire', diameter, 0.27, Vector3.Zero(), rubber, pivot);
    tire.rotation.z = Math.PI / 2;
    const hub = cylinder('hub', diameter * 0.6, 0.29, Vector3.Zero(), darkSteel, pivot);
    hub.rotation.z = Math.PI / 2;
    const cap = cylinder('cap', diameter * 0.22, 0.315, Vector3.Zero(), accent, pivot);
    cap.rotation.z = Math.PI / 2;
    for (let n = 0; n < 8; n += 1) {
      const angle = n * Math.PI / 4;
      const tread = box('tread', 0.285, 0.075, diameter * 0.18,
        new Vector3(0, Math.cos(angle) * diameter * 0.48, Math.sin(angle) * diameter * 0.48), darkSteel, pivot);
      tread.rotation.x = angle;
    }
    wheels.push(pivot);
  }

  const weapon = new TransformNode(`${id}-weapon`, scene);
  weapon.parent = root;

  if (botId === 'witchdoctor') {
    box('chassis', 1.72, 0.42, 1.95, new Vector3(0, 0, -0.1), darkSteel);
    box('armour-top', 1.63, 0.1, 1.55, new Vector3(0, 0.27, -0.29), accent);
    box('spine', 0.36, 0.14, 1.42, new Vector3(0, 0.36, -0.31), purple);
    for (const side of [-1, 1]) {
      wheel(side * 0.98, -0.72, 0.75);
      wheel(side * 0.98, 0.57, 0.75);
      box('fender', 0.35, 0.12, 1.83, new Vector3(side * 0.88, 0.4, -0.08), accent);
      const sidePlate = box('side-purple', 0.06, 0.25, 1.6, new Vector3(side * 0.9, 0.13, -0.15), purple);
      sidePlate.rotation.z = side * 0.12;
      const fork = box('fork', 0.16, 0.12, 0.84, new Vector3(side * 0.69, -0.28, 1.12), steel);
      fork.rotation.x = -0.14;
      box('fork-mount', 0.22, 0.3, 0.5, new Vector3(side * 0.69, -0.12, 0.78), purple);
      box('running-light', 0.06, 0.055, 1.42, new Vector3(side * 0.87, 0.37, -0.19), glow);
      for (let n = 0; n < 4; n += 1) {
        const bone = box('rib', 0.46, 0.045, 0.1, new Vector3(side * 0.42, 0.344, -0.8 + n * 0.3), white);
        bone.rotation.y = side * 0.28;
      }
    }
    // The pale skull and rib motif keeps the silhouette recognizable at mobile size.
    const skull = MeshBuilder.CreateSphere(`${id}-skull`, { diameter: 0.43, segments: 8 }, scene);
    skull.parent = root;
    skull.position.set(0, 0.46, 0.25);
    skull.scaling.set(1, 0.42, 1.1);
    skull.material = white;
    meshes.push(skull);
    for (const x of [-0.1, 0.1]) {
      const eye = box('eye', 0.09, 0.03, 0.12, new Vector3(x, 0.55, 0.3), darkSteel);
      eye.rotation.y = x * 2;
    }
    weapon.position.set(0, 0.2, 1.04);
    for (const x of [-0.31, 0.31]) {
      const disc = cylinder('vertical-disc', 1.09, 0.16, new Vector3(x, 0, 0), steel, weapon, 20);
      disc.rotation.z = Math.PI / 2;
      const hub = cylinder('disc-hub', 0.35, 0.2, new Vector3(x, 0, 0), purple, weapon);
      hub.rotation.z = Math.PI / 2;
      for (const sign of [-1, 1]) {
        box('disc-tooth', 0.22, 0.25, 0.29, new Vector3(x, sign * 0.49, 0), darkSteel, weapon);
      }
    }
    const axle = cylinder('weapon-axle', 0.15, 1.17, new Vector3(0, 0, 0), darkSteel, weapon);
    axle.rotation.z = Math.PI / 2;
    box('rear-self-righter', 1.0, 0.07, 0.12, new Vector3(0, 0.58, -0.86), steel);
  } else {
    box('chassis', 1.52, 0.35, 2.02, new Vector3(0, -0.04, -0.3), darkSteel);
    box('painted-deck', 1.4, 0.12, 1.6, new Vector3(0, 0.2, -0.38), accent);
    box('centre-cover', 0.69, 0.13, 1.35, new Vector3(0, 0.31, -0.45), darkSteel);
    for (const side of [-1, 1]) {
      wheel(side * 0.98, -0.43, 1.07);
      box('edge-rail', 0.13, 0.14, 1.64, new Vector3(side * 0.72, 0.23, -0.38), steel);
      box('blue-stripe', 0.16, 0.04, 1.4, new Vector3(side * 0.48, 0.3, -0.41), glow);
      box('weapon-arm', 0.16, 0.22, 1.0, new Vector3(side * 0.48, -0.08, 0.84), darkSteel);
    }
    for (let n = 0; n < 5; n += 1) {
      box('deck-vent', 0.48, 0.02, 0.045, new Vector3(0, 0.385, -0.91 + n * 0.14), steel);
    }
    const rear = box('rear-bumper', 1.43, 0.16, 0.18, new Vector3(0, 0.04, -1.36), steel);
    rear.rotation.x = -0.1;
    weapon.position.set(0, -0.13, 1.18);
    box('horizontal-blade', 2.65, 0.17, 0.27, Vector3.Zero(), steel, weapon);
    box('blade-cutting-edge', 2.7, 0.08, 0.075, new Vector3(0, -0.03, 0.16), white, weapon);
    cylinder('blade-hub', 0.34, 0.27, Vector3.Zero(), darkSteel, weapon);
    cylinder('blade-cap', 0.2, 0.29, Vector3.Zero(), accent, weapon);
    for (const x of [-1.21, 1.21]) {
      box('blade-tip', 0.24, 0.23, 0.35, new Vector3(x, 0, 0), darkSteel, weapon);
    }
  }

  // Merge rigid pieces by material within each moving part. A wheel still rotates as one
  // node, while its eight tread blocks share a draw call instead of eight individual ones.
  const optimized: Mesh[] = [];
  for (const parent of [root, weapon, ...wheels]) {
    const parts = meshes.filter((mesh) => mesh.parent === parent);
    const groups = new Map<number, Mesh[]>();
    for (const part of parts) {
      const key = part.material?.uniqueId ?? -1;
      const group = groups.get(key) ?? [];
      group.push(part);
      groups.set(key, group);
    }
    const translation = parent.position.clone();
    parent.position.setAll(0);
    parent.computeWorldMatrix(true);
    for (const group of groups.values()) {
      if (group.length === 1) {
        const single = group[0];
        if (single) optimized.push(single);
        continue;
      }
      for (const part of group) part.computeWorldMatrix(true);
      const merged = Mesh.MergeMeshes(group, true, true);
      if (merged) {
        merged.parent = parent;
        optimized.push(merged);
      }
    }
    parent.position.copyFrom(translation);
    parent.computeWorldMatrix(true);
  }

  for (const mesh of optimized) {
    mesh.receiveShadows = true;
    mesh.isPickable = false;
  }

  return {
    root, wheels, weapon, accent, glow, meshes: optimized, botId, paint,
    dispose() {
      root.dispose(false);
      for (const mat of [steel, darkSteel, rubber, accent, purple, white, glow]) mat.dispose();
    },
  };
}
