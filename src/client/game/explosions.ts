import { Constants } from '@babylonjs/core/Engines/constants';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { PHYSICS } from '../../shared/physics';

const CAPACITY = 2;
const DURATION = 2.8;
const SPARKS = 12;
const SMOKE = 5;
type Point = { x: number; y: number; z: number };

interface MovingMesh {
  mesh: Mesh;
  velocity: Vector3;
  offset: Vector3;
  size: number;
  delay: number;
}
interface Blast {
  root: TransformNode;
  core: Mesh;
  fire: Mesh[];
  smoke: MovingMesh[];
  sparks: MovingMesh[];
  ring: Mesh;
  scorch: Mesh;
  age: number;
}

export interface Explosions {
  readonly roots: readonly TransformNode[];
  readonly stats: { capacity: number; meshes: number; materials: number; readonly active: number };
  ready(): Promise<void>;
  trigger(position: Point, seed?: number): void;
  pulse(dt: number): void;
  clear(): void;
  dispose(): void;
}

/** A bounded, texture-free finishing effect. Rigid robot debris remains server-owned. */
export function createExplosions(scene: Scene): Explosions {
  const materials: StandardMaterial[] = [];
  const meshes: Mesh[] = [];
  const blasts: Blast[] = [];
  let disposed = false;
  let cursor = 0;
  let nextSeed = 1;

  function unlit(name: string, color: Color3, additive: boolean): StandardMaterial {
    const result = new StandardMaterial(`explosion-${name}`, scene);
    result.diffuseColor = Color3.Black(); result.specularColor = Color3.Black();
    result.emissiveColor.copyFrom(color); result.disableLighting = true;
    result.alpha = 0.99;
    result.transparencyMode = Material.MATERIAL_ALPHABLEND;
    result.alphaMode = additive ? Constants.ALPHA_ADD : Constants.ALPHA_COMBINE;
    result.disableDepthWrite = true;
    result.backFaceCulling = false;
    materials.push(result);
    return result;
  }
  const fireMaterial = unlit('fire', new Color3(1.0, 0.27, 0.015), true);
  const coreMaterial = unlit('core', new Color3(1.0, 0.87, 0.40), true);
  const sparkMaterial = unlit('spark', new Color3(1.0, 0.62, 0.10), true);
  const smokeMaterial = unlit('smoke', new Color3(0.22, 0.235, 0.25), false);
  const scorchMaterial = unlit('scorch', new Color3(0.025, 0.028, 0.03), false);

  function assign(mesh: Mesh, root: TransformNode, material: StandardMaterial): Mesh {
    mesh.parent = root; mesh.material = material; mesh.isPickable = false;
    mesh.receiveShadows = false;
    // Keep the effect in the arena depth group so walls can occlude it normally.
    mesh.renderingGroupId = 0; mesh.alphaIndex = material === smokeMaterial ? 1 : 2;
    meshes.push(mesh);
    return mesh;
  }
  function sphere(name: string, root: TransformNode, material: StandardMaterial): Mesh {
    return assign(MeshBuilder.CreateSphere(name, { diameter: 1, segments: 4 }, scene), root, material);
  }
  for (let index = 0; index < CAPACITY; index += 1) {
    const root = new TransformNode(`explosion-${index}`, scene);
    const core = sphere(`explosion-core-${index}`, root, coreMaterial);
    const fire: Mesh[] = [];
    for (let n = 0; n < 3; n += 1) fire.push(sphere(`explosion-fire-${index}-${n}`, root, fireMaterial));
    const smoke: MovingMesh[] = [];
    for (let n = 0; n < SMOKE; n += 1) smoke.push({
      mesh: sphere(`explosion-smoke-${index}-${n}`, root, smokeMaterial),
      velocity: Vector3.Zero(), offset: Vector3.Zero(), size: 1, delay: 0,
    });
    const sparks: MovingMesh[] = [];
    for (let n = 0; n < SPARKS; n += 1) sparks.push({
      mesh: assign(MeshBuilder.CreateBox(`explosion-spark-${index}-${n}`, { width: 0.045, height: 0.045, depth: 0.30 }, scene), root, sparkMaterial),
      velocity: Vector3.Zero(), offset: Vector3.Zero(), size: 1, delay: 0,
    });
    const ring = assign(MeshBuilder.CreateTorus(`explosion-ring-${index}`, { diameter: 1, thickness: 0.035, tessellation: 16 }, scene), root, fireMaterial);
    const scorch = assign(MeshBuilder.CreateDisc(`explosion-scorch-${index}`, { radius: 1.1, tessellation: 24 }, scene), root, scorchMaterial);
    scorch.rotation.x = Math.PI / 2;
    root.setEnabled(false);
    blasts.push({ root, core, fire, smoke, sparks, ring, scorch, age: DURATION });
  }

  function draw(blast: Blast): void {
    const age = blast.age;
    const flash = Math.max(0, 1 - age / 0.28);
    blast.core.isVisible = flash > 0;
    blast.core.scaling.setAll(0.6 + Math.min(age / 0.14, 1) * 2.7);
    blast.core.position.y = 0.3;
    blast.core.visibility = flash * 0.90;
    for (let index = 0; index < blast.fire.length; index += 1) {
      const fire = blast.fire[index];
      if (!fire) continue;
      const t = Math.max(0, age - index * 0.035);
      const envelope = Math.max(0, 1 - t / 0.46);
      const angle = index * Math.PI * 2 / 3;
      fire.isVisible = envelope > 0;
      fire.position.set(Math.sin(angle) * (0.35 + t), 0.35 + t * 1.8, Math.cos(angle) * (0.35 + t));
      fire.scaling.set(1.0 + t * 5.5, 1.2 + t * 4, 1.0 + t * 5.5);
      fire.visibility = envelope * 0.78;
    }
    blast.ring.isVisible = age < 0.42;
    blast.ring.scaling.setAll(1 + age * 16);
    blast.ring.position.y = -0.1;
    blast.ring.visibility = Math.max(0, 1 - age / 0.42) * 0.55;
    for (const spark of blast.sparks) {
      const t = age;
      spark.mesh.isVisible = t < spark.delay;
      spark.mesh.position.set(spark.velocity.x * t, Math.max(0.04 - blast.root.position.y, 0.2 + spark.velocity.y * t - PHYSICS.gravity * t * t / 2), spark.velocity.z * t);
      spark.mesh.rotation.x = spark.offset.x + t * 8;
      spark.mesh.visibility = Math.max(0, 1 - t / spark.delay);
    }
    for (const smoke of blast.smoke) {
      const t = Math.max(0, age - smoke.delay);
      const fadeIn = Math.min(1, t / 0.25);
      const fadeOut = Math.max(0, 1 - t / (DURATION - smoke.delay));
      smoke.mesh.isVisible = age > smoke.delay && fadeOut > 0;
      smoke.mesh.position.set(smoke.offset.x + smoke.velocity.x * t, smoke.offset.y + smoke.velocity.y * t, smoke.offset.z + smoke.velocity.z * t);
      smoke.mesh.scaling.setAll(smoke.size + t * 1.15);
      smoke.mesh.visibility = fadeIn * fadeOut * 0.34;
    }
    blast.scorch.position.y = 0.018 - blast.root.position.y;
    blast.scorch.isVisible = blast.root.position.y < 2;
    blast.scorch.visibility = Math.max(0, 1 - age / DURATION) * Math.min(1, age / 0.18) * 0.65;
  }

  const roots = blasts.map((blast) => blast.root);
  return {
    roots,
    stats: { capacity: CAPACITY, meshes: meshes.length, materials: materials.length,
      get active() { return blasts.filter((blast) => blast.age < DURATION).length; } },
    async ready() {
      if (disposed) return;
      await Promise.all(materials.map(async (material) => {
        const mesh = meshes.find((candidate) => candidate.material === material);
        if (mesh) await material.forceCompilationAsync(mesh);
      }));
    },
    trigger(position, seed = nextSeed++) {
      if (disposed) return;
      const blast = blasts[cursor];
      cursor = (cursor + 1) % CAPACITY;
      if (!blast) return;
      let randomState = seed | 0;
      const random = () => {
        randomState = Math.imul(randomState, 1664525) + 1013904223 | 0;
        return (randomState >>> 0) / 4294967296;
      };
      blast.age = 0;
      blast.root.position.set(position.x, position.y, position.z);
      blast.root.setEnabled(true);
      for (const spark of blast.sparks) {
        const angle = random() * Math.PI * 2;
        const speed = 3.5 + random() * 7;
        spark.velocity.set(Math.sin(angle) * speed, 4 + random() * 6, Math.cos(angle) * speed);
        spark.delay = 0.4 + random() * 0.45;
        spark.offset.set(random() * Math.PI, angle, random() * Math.PI);
        spark.mesh.rotation.copyFrom(spark.offset);
      }
      for (const smoke of blast.smoke) {
        const angle = random() * Math.PI * 2;
        smoke.offset.set(Math.sin(angle) * 0.7, 0.2 + random() * 0.3, Math.cos(angle) * 0.7);
        smoke.velocity.set(Math.sin(angle) * (0.2 + random() * 0.35), 0.8 + random() * 0.6, Math.cos(angle) * (0.2 + random() * 0.35));
        smoke.size = 0.7 + random() * 0.45;
        smoke.delay = 0.08 + random() * 0.25;
      }
      draw(blast);
    },
    pulse(dt) {
      if (disposed) return;
      for (const blast of blasts) {
        if (blast.age >= DURATION) continue;
        blast.age += Math.max(0, dt);
        if (blast.age >= DURATION) { blast.root.setEnabled(false); continue; }
        draw(blast);
      }
    },
    clear() {
      for (const blast of blasts) { blast.age = DURATION; blast.root.setEnabled(false); }
      cursor = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const blast of blasts) { blast.age = DURATION; blast.root.dispose(false, false); }
      for (const material of materials) material.dispose(false, false);
    },
  };
}
