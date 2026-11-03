import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import type { Scene } from '@babylonjs/core/scene';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { BOTS, type BotId } from '../../../shared/protocol';
import { damageParts, MAX_DAMAGE_MARKS, type DamagePartDefinition, type DamagePartId, type RobotDamage, type DamageMark } from '../../../shared/damage';

interface DeformableMesh {
  mesh: Mesh; original: number[]; working: number[]; normals: number[];
  indices: number[]; rubber: boolean;
}
interface PartPaint { material: PBRMaterial; color: Color3; roughness: number }
interface PartVisual {
  definition: DamagePartDefinition; node: TransformNode; position: Vector3;
  meshes: DeformableMesh[]; pickMeshes: Set<Mesh>; paints: PartPaint[];
  integrity: number; markKey: string; reaction: number; phase: number; seed: number;
}

function scarTexture(scene: Scene, name: string): DynamicTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, 256, 256);
  const shade = context.createRadialGradient(128, 128, 6, 128, 128, 119);
  shade.addColorStop(0, 'rgba(12,10,8,.9)'); shade.addColorStop(0.48, 'rgba(25,22,16,.70)'); shade.addColorStop(1, 'rgba(35,29,20,0)');
  context.fillStyle = shade; context.fillRect(0, 0, 256, 256);
  let seed = 8123;
  for (let n = 0; n < 28; n += 1) {
    seed = seed * 16807 % 2147483647; const y = 62 + seed % 140;
    seed = seed * 16807 % 2147483647; const x = 24 + seed % 100;
    context.lineWidth = n % 5 === 0 ? 3.2 : 1.2;
    context.strokeStyle = n % 3 ? 'rgba(199,204,194,.83)' : 'rgba(71,61,42,.85)';
    context.beginPath(); context.moveTo(x, y); context.lineTo(Math.min(244, x + 44 + seed % 76), y - 7 - seed % 16); context.stroke();
  }
  const texture = new DynamicTexture(name, canvas, scene, false);
  texture.hasAlpha = true; texture.update(false);
  return texture;
}

export class DamageVisuals {
  readonly artifacts: Mesh[] = [];
  private readonly visuals: PartVisual[] = [];
  private readonly byId = new Map<DamagePartId, PartVisual>();
  private readonly bodyMeshes = new Set<Mesh>();
  private readonly material: StandardMaterial;
  private readonly texture: DynamicTexture | null;
  private previousMarks = new Set<number>();
  private revision = -1;
  private hullDamage = -1;
  private readonly point = new Vector3();
  private readonly normal = new Vector3();
  private readonly up = new Vector3(0, 1, 0);

  constructor(private readonly scene: Scene, private readonly root: TransformNode, botId: BotId,
    parts: ReadonlyMap<DamagePartId, TransformNode>, id: string) {
    for (const [index, definition] of damageParts(botId).entries()) {
      const node = parts.get(definition.id);
      if (!node) continue;
      const meshes: DeformableMesh[] = []; const paints: PartPaint[] = [];
      for (const child of node.getChildMeshes()) {
        if (!(child instanceof Mesh)) continue;
        // Armor needs vertices through the middle of a panel to take a visible dent.
        if (definition.kind === 'armor' && child.getTotalIndices() < 1800) child.increaseVertices(1);
        const positions = child.getVerticesData(VertexBuffer.PositionKind);
        const rawIndices = child.getIndices();
        if (!positions || !rawIndices) continue;
        child.markVerticesDataAsUpdatable(VertexBuffer.PositionKind, true);
        child.markVerticesDataAsUpdatable(VertexBuffer.NormalKind, true);
        // Recreating an updatable GPU buffer can quantize the source to Float32.
        // Capture that final pristine buffer so rematches restore it byte-for-byte.
        const original = Array.from(child.getVerticesData(VertexBuffer.PositionKind) ?? positions);
        const rubber = child.material?.name.includes('solid-rubber') ?? false;
        meshes.push({ mesh: child, original, working: original.slice(), normals: new Array<number>(original.length).fill(0), indices: Array.from(rawIndices), rubber });
        if (child.material instanceof PBRMaterial) {
          const originalMaterial = child.material;
          // PBRMaterial.clone also clones DynamicTextures. Component-local uniforms
          // need their own material, while all parts should share immutable liveries.
          const coating = new PBRMaterial(`${id}-${definition.id}-${originalMaterial.name}`, scene);
          coating.albedoColor.copyFrom(originalMaterial.albedoColor);
          coating.albedoTexture = originalMaterial.albedoTexture;
          coating.metallic = originalMaterial.metallic; coating.roughness = originalMaterial.roughness;
          coating.environmentIntensity = originalMaterial.environmentIntensity;
          coating.backFaceCulling = originalMaterial.backFaceCulling;
          coating.emissiveColor.copyFrom(originalMaterial.emissiveColor);
          child.material = coating;
          paints.push({ material: coating, color: coating.albedoColor.clone(), roughness: coating.roughness ?? 0.5 });
        }
      }
      const visual: PartVisual = { definition, node, position: node.position.clone(), meshes,
        pickMeshes: new Set(meshes.map((entry) => entry.mesh)), paints, integrity: 1, markKey: '', reaction: 0, phase: 0, seed: index * 1.71 };
      this.visuals.push(visual); this.byId.set(definition.id, visual);
    }
    for (const child of root.getChildMeshes()) if (child instanceof Mesh) this.bodyMeshes.add(child);
    this.texture = scarTexture(scene, `${id}-scraped-paint-atlas`);
    this.material = new StandardMaterial(`${id}-impact-scar`, scene);
    this.material.diffuseColor = new Color3(0.88, 0.88, 0.82); this.material.specularColor = new Color3(0.16, 0.16, 0.13);
    this.material.backFaceCulling = false; this.material.zOffset = -2;
    if (this.texture) { this.material.diffuseTexture = this.texture; this.material.useAlphaFromDiffuseTexture = true; }
    for (let index = 0; index < MAX_DAMAGE_MARKS; index += 1) {
      const mesh = MeshBuilder.CreatePlane(`${id}-damage-scar-${index}`, { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene);
      mesh.parent = root; mesh.material = this.material; mesh.isPickable = false;
      mesh.rotationQuaternion = Quaternion.Identity(); mesh.metadata = { damageMark: true };
      mesh.scaling.setAll(0);
      mesh.setEnabled(false); this.artifacts.push(mesh);
    }
  }

  setDamage(damage: RobotDamage, hullDamage: number): void {
    if (damage.revision === this.revision && hullDamage === this.hullDamage) return;
    if (damage.revision < this.revision) {
      this.previousMarks.clear();
      for (const visual of this.visuals) { visual.reaction = 0; visual.phase = 0; }
    }
    this.revision = damage.revision; this.hullDamage = hullDamage;
    for (const visual of this.visuals) {
      const integrity = damage.parts.find((part) => part.id === visual.definition.id)?.integrity ?? 1;
      const marks = damage.marks.filter((mark) => mark.partId === visual.definition.id);
      const key = marks.map((mark) => mark.id).join(',');
      const changed = integrity !== visual.integrity || key !== visual.markKey;
      visual.node.setEnabled(!visual.definition.detachable || integrity > 0);
      if (marks.some((mark) => !this.previousMarks.has(mark.id))) visual.reaction = 1;
      if (changed) this.deform(visual, integrity, marks);
      visual.integrity = integrity; visual.markKey = key;
      const wear = 1 - integrity;
      for (const paint of visual.paints) {
        const darkness = 1 - wear * 0.35 - Math.min(1, hullDamage) * 0.045;
        paint.material.albedoColor.set(paint.color.r * darkness, paint.color.g * darkness, paint.color.b * darkness);
        paint.material.roughness = Math.min(0.97, paint.roughness + wear * 0.34);
      }
    }
    for (let index = 0; index < this.artifacts.length; index += 1) {
      const artifact = this.artifacts[index]; const mark = damage.marks[index];
      if (!artifact) continue;
      if (!mark) {
        artifact.setEnabled(false); artifact.scaling.setAll(0);
        artifact.parent = this.root; artifact.position.setAll(0);
        artifact.rotationQuaternion?.set(0, 0, 0, 1);
        continue;
      }
      this.placeScar(artifact, mark);
    }
    this.previousMarks = new Set(damage.marks.map((mark) => mark.id));
  }

  private deform(visual: PartVisual, integrity: number, marks: readonly DamageMark[]): void {
    const wear = 1 - integrity;
    visual.node.position.copyFrom(visual.position);
    visual.node.rotation.y = 0; visual.node.rotation.z = 0;
    this.root.computeWorldMatrix(true);
    const rootMatrix = this.root.getWorldMatrix();
    for (const entry of visual.meshes) {
      const mesh = entry.mesh;
      mesh.computeWorldMatrix(true);
      const transform = rootMatrix.multiply(Matrix.Invert(mesh.getWorldMatrix()));
      const localMarks = marks.map((mark) => ({
        point: Vector3.TransformCoordinates(new Vector3(mark.point.x, mark.point.y, mark.point.z), transform),
        normal: Vector3.TransformNormal(new Vector3(mark.normal.x, mark.normal.y, mark.normal.z), transform).normalize(),
        radius: 0.40 + mark.severity * 0.58, depth: 0.04 + mark.severity * 0.19,
      }));
      const source = entry.original; const output = entry.working;
      for (let index = 0; index < source.length; index += 3) {
        let x = source[index] ?? 0; let y = source[index + 1] ?? 0; let z = source[index + 2] ?? 0;
        if (visual.definition.kind === 'armor') {
          const bend = Math.max(0, wear - 0.1);
          y += Math.sin(z * 4.5 + visual.seed) * bend * 0.075;
          const side = visual.definition.side === 'left' ? -1 : visual.definition.side === 'right' ? 1 : 0;
          x += side * bend * Math.min(0.18, Math.abs(z) * 0.13);
          z += Math.sin(x * 3 + visual.seed) * bend * 0.06;
        } else if (visual.definition.kind === 'weapon') {
          y += wear * 0.10 * Math.sign(x) * x * x;
          x += Math.sin(Math.atan2(z, y) * 3) * wear * 0.035;
        } else if (entry.rubber && wear > 0.1) {
          const angle = Math.atan2(z, y); const delta = Math.atan2(Math.sin(angle - visual.seed), Math.cos(angle - visual.seed));
          const bite = Math.max(0, 1 - Math.abs(delta) / (0.15 + wear * 0.7));
          const reduction = wear * bite * 0.45;
          y *= 1 - reduction; z *= 1 - reduction;
          x += Math.sin(angle * 8) * wear * 0.018;
        }
        for (const mark of localMarks) {
          const dx = x - mark.point.x; const dy = y - mark.point.y; const dz = z - mark.point.z;
          const squared = (dx * dx + dy * dy + dz * dz) / (mark.radius * mark.radius);
          if (squared >= 1) continue;
          const dent = (1 - squared) * (1 - squared) * mark.depth;
          x -= mark.normal.x * dent; y -= mark.normal.y * dent; z -= mark.normal.z * dent;
        }
        output[index] = x; output[index + 1] = y; output[index + 2] = z;
      }
      let indices = entry.indices;
      if (entry.rubber && wear > 0.25) {
        const cut: number[] = [];
        const radius = BOTS[this.rootBot()].physics.wheelRadius;
        for (let index = 0; index < entry.indices.length; index += 3) {
          const a = entry.indices[index]; const b = entry.indices[index + 1]; const c = entry.indices[index + 2];
          if (a === undefined || b === undefined || c === undefined) continue;
          let removed = 0;
          for (const vertex of [a, b, c]) {
            const y = source[vertex * 3 + 1] ?? 0; const z = source[vertex * 3 + 2] ?? 0;
            const delta = Math.atan2(Math.sin(Math.atan2(z, y) - visual.seed), Math.cos(Math.atan2(z, y) - visual.seed));
            if (Math.hypot(y, z) > radius * 0.7 && Math.abs(delta) < (wear - 0.2) * 0.65) removed += 1;
          }
          if (removed < 3) cut.push(a, b, c);
        }
        indices = cut;
      }
      mesh.setIndices(indices);
      VertexData.ComputeNormals(output, indices, entry.normals);
      mesh.updateVerticesData(VertexBuffer.PositionKind, output, true, false);
      mesh.updateVerticesData(VertexBuffer.NormalKind, entry.normals, false, false);
    }
  }

  private rootBot(): BotId { return this.visuals.some((visual) => visual.definition.id === 'wheel-left') ? 'tombstone' : 'witchdoctor'; }

  private placeScar(artifact: Mesh, mark: DamageMark): void {
    const visual = this.byId.get(mark.partId);
    if (!visual) { artifact.setEnabled(false); return; }
    this.root.computeWorldMatrix(true);
    const rootWorld = this.root.getWorldMatrix();
    const inverseRoot = Matrix.Invert(rootWorld);
    const localNormal = new Vector3(mark.normal.x, mark.normal.y, mark.normal.z).normalize();
    const worldNormal = Vector3.TransformNormal(localNormal, rootWorld).normalize();
    const localPoint = new Vector3(mark.point.x, mark.point.y, mark.point.z);
    const worldPoint = Vector3.TransformCoordinates(localPoint, rootWorld);
    const origin = worldPoint.add(worldNormal.scale(0.8));
    const ray = new Ray(origin, worldNormal.negate(), 1.8);
    let picked = this.scene.pickWithRay(ray, (mesh) => mesh instanceof Mesh && visual.pickMeshes.has(mesh) && mesh.isEnabled() && mesh.isVisible);
    if (!picked?.hit) {
      // Mechanical hit classifications can be broader than a detachable panel.
      // Project onto the visible frame rather than leaving a decal in empty air.
      picked = this.scene.pickWithRay(ray, (mesh) => mesh instanceof Mesh && this.bodyMeshes.has(mesh) && mesh.isEnabled() && mesh.isVisible);
    }
    const surfaceMesh = picked?.pickedMesh;
    if (!picked?.hit || !picked.pickedPoint || !(surfaceMesh instanceof Mesh)) {
      artifact.setEnabled(false); artifact.scaling.setAll(0);
      return;
    }
    const surface = Vector3.TransformCoordinates(picked.pickedPoint, inverseRoot);
    const normal = picked.getNormal(true, true);
    if (normal) Vector3.TransformNormalToRef(normal, inverseRoot, localNormal).normalize();
    surfaceMesh.computeWorldMatrix(true);
    const toPart = rootWorld.multiply(Matrix.Invert(surfaceMesh.getWorldMatrix()));
    Vector3.TransformCoordinatesToRef(surface.add(localNormal.scale(0.009)), toPart, this.point);
    Vector3.TransformNormalToRef(localNormal, toPart, this.normal).normalize();
    artifact.parent = surfaceMesh; artifact.position.copyFrom(this.point);
    this.normal.negateInPlace(); this.up.set(0, Math.abs(this.normal.y) > 0.95 ? 0 : 1, Math.abs(this.normal.y) > 0.95 ? 1 : 0);
    artifact.rotationQuaternion = Quaternion.FromLookDirectionLH(this.normal, this.up);
    const size = 0.38 + mark.severity * 0.77;
    artifact.scaling.set(size * 1.35, size, 1); artifact.visibility = 0.88; artifact.setEnabled(true);
  }

  pulseDamage(_time: number, dt: number): void {
    for (const visual of this.visuals) {
      const damage = 1 - visual.integrity;
      visual.phase += dt * 82; visual.reaction = Math.max(0, visual.reaction - dt / 0.14);
      const shake = Math.sin(visual.phase + visual.seed) * visual.reaction;
      if (visual.definition.kind === 'wheel') {
        visual.node.rotation.y = Math.sin(visual.node.rotation.x * 1.7 + visual.seed) * damage * 0.13 + shake * 0.025;
        visual.node.rotation.z = Math.cos(visual.node.rotation.x + visual.seed) * damage * 0.09;
      } else if (visual.definition.kind === 'armor') {
        const side = visual.definition.side === 'left' ? -1 : visual.definition.side === 'right' ? 1 : 0.5;
        visual.node.rotation.z = side * damage * 0.075 + shake * 0.018;
        visual.node.position.y = visual.position.y + shake * 0.012;
      }
      for (const paint of visual.paints) paint.material.emissiveColor.set(visual.reaction * 0.12, visual.reaction * 0.055, visual.reaction * 0.012);
    }
  }

  dispose(): void {
    for (const artifact of this.artifacts) artifact.dispose();
    for (const visual of this.visuals) for (const paint of visual.paints) paint.material.dispose(false, false);
    this.material.dispose(false, false); this.texture?.dispose();
  }
}
