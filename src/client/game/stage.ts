import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/instancedMesh';
import type { Scene } from '@babylonjs/core/scene';
import { ARENA } from '../../shared/protocol';
import { material } from './models';

export interface ArenaStage {
  walls: { mesh: Mesh; side: 'north' | 'south' | 'east' | 'west' }[];
  pulse(time: number): void;
}

export function makeStage(scene: Scene): ArenaStage {
  const graphite = material(scene, 'stage-graphite', '#171c20', 0.55);
  const metal = material(scene, 'stage-steel', '#30383e', 0.8);
  const dark = material(scene, 'stage-black', '#080b0e', 0.12);
  const amber = material(scene, 'stage-amber', '#e6ad40');
  amber.emissiveColor = Color3.FromHexString('#ef9f2d').scale(0.8);
  const white = material(scene, 'stage-white-light', '#d6e1df');
  white.emissiveColor = Color3.FromHexString('#b2cfcb').scale(0.85);
  const green = material(scene, 'stage-green-light', '#a5d549');
  green.emissiveColor = Color3.FromHexString('#a5d549').scale(0.75);

  function box(name: string, width: number, height: number, depth: number, x: number, y: number, z: number, mat = graphite): Mesh {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    return mesh;
  }

  const texture = new DynamicTexture('arena-floor-atlas', { width: 1024, height: 1344 }, scene, false);
  const ctx = texture.getContext();
  ctx.fillStyle = '#30363a';
  ctx.fillRect(0, 0, 1024, 1344);
  // A deterministic steel grain avoids downloading any environment textures.
  let random = 7331;
  for (let n = 0; n < 14000; n += 1) {
    random = (random * 16807) % 2147483647;
    const x = random % 1024;
    random = (random * 16807) % 2147483647;
    const y = random % 1344;
    ctx.fillStyle = n % 2 ? 'rgba(190,200,205,0.045)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(x, y, 1 + n % 4, 1);
  }
  ctx.strokeStyle = '#434c50';
  ctx.lineWidth = 2;
  for (let x = 0; x <= 1024; x += 128) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1344); ctx.stroke();
  }
  for (let y = 0; y <= 1344; y += 112) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(194,203,199,.13)';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(512, 672, 232, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(512, 672, 240, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(204,211,202,.16)';
  ctx.font = '900 80px Arial';
  ctx.fillText('BATTLEBOTS', 512 - ctx.measureText('BATTLEBOTS').width / 2, 692);
  ctx.font = '600 19px Arial';
  ctx.fillText('ROBOT FIGHTING TIME', 512 - ctx.measureText('ROBOT FIGHTING TIME').width / 2, 732);
  for (const y of [170, 1174]) {
    ctx.strokeStyle = y < 500 ? '#7d912e' : '#3b698d';
    ctx.lineWidth = 7;
    ctx.strokeRect(358, y - 75, 308, 150);
    ctx.fillStyle = 'rgba(230,230,215,.38)';
    ctx.font = '700 24px Arial';
    const label = y < 500 ? 'RED SQUARE' : 'BLUE SQUARE';
    ctx.fillText(label, 512 - ctx.measureText(label).width / 2, y + 9);
  }
  texture.update(false);
  const floorMaterial = material(scene, 'stage-floor', '#ffffff', 0.25);
  floorMaterial.diffuseTexture = texture;
  const floor = MeshBuilder.CreateGround('battlebox-floor', { width: ARENA.halfWidth * 2, height: ARENA.halfDepth * 2 }, scene);
  floor.material = floorMaterial;
  floor.receiveShadows = true;
  floor.isPickable = false;
  floor.freezeWorldMatrix();
  box('arena-foundation', ARENA.halfWidth * 2 + 1.8, 0.65, ARENA.halfDepth * 2 + 1.8, 0, -0.36, 0, dark);
  const perimeter: ArenaStage['walls'] = [];

  for (const sign of [-1, 1]) {
    const sideZ = sign * (ARENA.halfDepth + 0.12);
    const sideX = sign * (ARENA.halfWidth + 0.12);
    const northSouth = box(`wall-${sign}-z`, ARENA.halfWidth * 2 + 0.8, 0.72, 0.4, 0, 0.36, sideZ, metal);
    const eastWest = box(`wall-${sign}-x`, 0.4, 0.72, ARENA.halfDepth * 2, sideX, 0.36, 0, metal);
    perimeter.push({ mesh: northSouth, side: sign > 0 ? 'north' : 'south' });
    perimeter.push({ mesh: eastWest, side: sign > 0 ? 'east' : 'west' });
    box('edge-light-z', ARENA.halfWidth * 2 - 0.5, 0.06, 0.08, 0, 0.76, sideZ - sign * 0.2, amber);
    box('edge-light-x', 0.08, 0.06, ARENA.halfDepth * 2 - 0.5, sideX - sign * 0.2, 0.76, 0, amber);
    // Broad yellow-black diagonal strips along the floor mark the safe arena boundary.
    for (let n = -11; n <= 11; n += 2) {
      const stripe = MeshBuilder.CreateBox(`hazard-z-${sign}-${n}`, { width: 0.42, height: 0.015, depth: 0.86 }, scene);
      stripe.position.set(n, 0.012, sign * (ARENA.halfDepth - 0.54));
      stripe.rotation.y = -Math.PI / 4;
      stripe.material = amber;
      stripe.isPickable = false;
      stripe.freezeWorldMatrix();
    }
    for (let n = -15; n <= 15; n += 2) {
      const stripe = MeshBuilder.CreateBox(`hazard-x-${sign}-${n}`, { width: 0.86, height: 0.015, depth: 0.42 }, scene);
      stripe.position.set(sign * (ARENA.halfWidth - 0.54), 0.012, n);
      stripe.rotation.y = -Math.PI / 4;
      stripe.material = amber;
      stripe.isPickable = false;
      stripe.freezeWorldMatrix();
    }
    for (let n = -12; n <= 12; n += 6) {
      box('cage-post-z', 0.16, 4.5, 0.16, n, 2.25, sideZ, metal);
    }
    for (let n = -12; n <= 12; n += 6) {
      box('cage-post-x', 0.16, 4.5, 0.16, sideX, 2.25, n, metal);
    }
    box('cage-top-z', ARENA.halfWidth * 2 + 0.9, 0.15, 0.15, 0, 4.45, sideZ, metal);
    box('cage-top-x', 0.15, 0.15, ARENA.halfDepth * 2 + 0.5, sideX, 4.45, 0, metal);
    box('truss-z', ARENA.halfWidth * 2 + 3, 0.36, 0.34, 0, 8.5, sign * 11, dark);
    box('light-panel-z', 8.5, 0.07, 0.38, 0, 8.3, sign * 11, white);
    box('audience-riser-z', 32, 1.0, 5, 0, 0.1, sign * 21, dark);
    box('audience-riser-x', 4, 1.0, 38, sign * 17.5, 0.1, 0, dark);
  }

  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      box('corner-column', 0.8, 5, 0.8, x * 13.5, 2.5, z * 17.5, dark);
      box('corner-led', 0.1, 3.9, 0.84, x * 13.0, 2.7, z * 17.5, amber);
      const hazard = box('corner-hazard', 2.4, 0.4, 2.4, x * 11.3, 0.2, z * 15.4, metal);
      hazard.receiveShadows = true;
      for (let n = 0; n < 3; n += 1) {
        box('hazard-grille', 0.11, 0.03, 1.65, x * 11.3 + (n - 1) * 0.42, 0.42, z * 15.4, dark);
      }
    }
  }

  // Cheap instanced crowd silhouettes make the arena feel occupied without animated characters.
  const crowdSource = MeshBuilder.CreateBox('audience-silhouette', { width: 0.4, height: 0.8, depth: 0.45 }, scene);
  crowdSource.material = metal;
  crowdSource.isVisible = false;
  crowdSource.isPickable = false;
  for (let index = 0; index < 72; index += 1) {
    const figure = crowdSource.createInstance(`spectator-${index}`);
    const side = index % 4;
    const offset = Math.floor(index / 4) * 1.45 - 12.3;
    figure.position.set(side < 2 ? offset : (side === 2 ? -17 : 17), 1.4 + (index % 3) * 0.08, side < 2 ? (side === 0 ? -21 : 21) : offset);
    figure.scaling.y = 0.75 + (index % 5) * 0.1;
    figure.isPickable = false;
    figure.freezeWorldMatrix();
  }

  const stageRing = MeshBuilder.CreateTorus('preview-ring', { diameter: 5.7, thickness: 0.035, tessellation: 64 }, scene);
  stageRing.position.set(0, 0.025, 0);
  stageRing.material = green;
  stageRing.isPickable = false;
  const innerRing = MeshBuilder.CreateTorus('preview-ring-inner', { diameter: 5.4, thickness: 0.015, tessellation: 64 }, scene);
  innerRing.position.set(0, 0.026, 0);
  innerRing.material = metal;
  innerRing.isPickable = false;

  const staticGroups = new Map<number, Mesh[]>();
  for (const mesh of [...scene.meshes]) {
    if (!(mesh instanceof Mesh) || mesh === floor || mesh === crowdSource || perimeter.some((wall) => wall.mesh === mesh)) continue;
    const key = mesh.material?.uniqueId ?? -1;
    const group = staticGroups.get(key) ?? [];
    group.push(mesh);
    staticGroups.set(key, group);
  }
  for (const group of staticGroups.values()) {
    if (group.length < 2) continue;
    const merged = Mesh.MergeMeshes(group, true, true);
    if (merged) {
      merged.isPickable = false;
      merged.receiveShadows = false;
      merged.freezeWorldMatrix();
    }
  }

  return {
    walls: perimeter,
    pulse(time) {
      green.emissiveColor = Color3.FromHexString('#a5d549').scale(0.55 + Math.sin(time * 1.3) * 0.12);
    },
  };
}
