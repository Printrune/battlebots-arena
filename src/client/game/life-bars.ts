import { Camera } from '@babylonjs/core/Cameras/camera';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

const CAPACITY = 2;
const WIDTH = 1.9;
const HEIGHT = 0.40;
const FILL_WIDTH = 1.70;
const PIXEL_HEIGHT = 26;
const GREEN = Color3.FromHexString('#81e3a1');
const AMBER = Color3.FromHexString('#ffc65f');
const RED = Color3.FromHexString('#ff6565');

interface Bar {
  id: string | null; root: TransformNode; fill: Mesh; trail: Mesh; label: Mesh;
  health: number; trailing: number; hold: number; displayed: number;
  fillMaterial: StandardMaterial; texture: DynamicTexture | null; context: CanvasRenderingContext2D | null;
}

export interface LifeBars {
  readonly nodes: ReadonlyMap<string, TransformNode>;
  readonly stats: { bars: number; meshes: number; textures: number };
  setHealth(id: string, health: number): void;
  setPosition(id: string, position: Vector3): void;
  setCamera(camera: Camera): void;
  pulse(dt: number): void;
  remove(id: string): void;
  clear(): void;
  dispose(): void;
}

/** Two reusable world-space HUDs. Health text uploads only when its integer changes. */
export function createLifeBars(scene: Scene, camera: Camera): LifeBars {
  const materials: StandardMaterial[] = [];
  const bars: Bar[] = [];
  const byId = new Map<string, Bar>();
  const nodes = new Map<string, TransformNode>();
  let disposed = false;
  // A separate depth group keeps the overhead HUD legible through the enclosure.
  // Its own depth buffer still resolves the track/fill/label stack correctly.
  scene.setRenderingAutoClearDepthStencil(3, true, true, true);

  function unlit(name: string, color: Color3): StandardMaterial {
    const result = new StandardMaterial(name, scene);
    result.disableLighting = true; result.diffuseColor = Color3.Black(); result.emissiveColor.copyFrom(color);
    result.specularColor = Color3.Black(); result.backFaceCulling = false;
    materials.push(result);
    return result;
  }

  function plane(name: string, width: number, height: number, parent: TransformNode, material: StandardMaterial, y: number, z: number): Mesh {
    const result = MeshBuilder.CreatePlane(name, { width, height }, scene);
    result.parent = parent; result.position.set(0, y, z); result.material = material;
    result.isPickable = false; result.receiveShadows = false; result.renderingGroupId = 3;
    return result;
  }

  for (let index = 0; index < CAPACITY; index += 1) {
    const root = new TransformNode(`bot-life-bar-${index}`, scene);
    root.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    const trackMaterial = unlit(`life-track-${index}`, Color3.FromHexString('#11191f'));
    const trailMaterial = unlit(`life-damage-trail-${index}`, Color3.FromHexString('#9a773b'));
    const fillMaterial = unlit(`life-fill-${index}`, GREEN);
    const labelMaterial = unlit(`life-label-${index}`, Color3.White());
    labelMaterial.disableDepthWrite = true;
    let context: CanvasRenderingContext2D | null = null;
    let texture: DynamicTexture | null = null;
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
      context = canvas.getContext('2d');
      if (context) {
        texture = new DynamicTexture(`life-label-atlas-${index}`, canvas, scene, false);
        texture.hasAlpha = true;
        labelMaterial.diffuseTexture = texture; labelMaterial.emissiveTexture = texture;
        labelMaterial.useAlphaFromDiffuseTexture = true;
      }
    }
    plane(`life-track-${index}`, WIDTH, HEIGHT, root, trackMaterial, 0, 0);
    const trail = plane(`life-trail-${index}`, FILL_WIDTH, 0.09, root, trailMaterial, -0.105, -0.002);
    const fill = plane(`life-fill-${index}`, FILL_WIDTH, 0.09, root, fillMaterial, -0.105, -0.004);
    const label = plane(`life-label-${index}`, 1.70, 0.22, root, labelMaterial, 0.067, -0.006);
    label.alphaIndex = index;
    root.setEnabled(false);
    bars.push({ id: null, root, fill, trail, label, health: 100, trailing: 100, hold: 0, displayed: -1, fillMaterial, texture, context });
  }

  function renderText(bar: Bar): void {
    const integer = Math.ceil(bar.health);
    if (bar.displayed === integer) return;
    bar.displayed = integer;
    bar.label.metadata = { health: integer, text: `${integer} HP` };
    const context = bar.context;
    if (!context || !bar.texture) return;
    context.clearRect(0, 0, 256, 64);
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.font = 'bold 45px Arial'; context.lineWidth = 3;
    context.strokeStyle = '#11191f'; context.strokeText(`${integer} HP`, 128, 33);
    context.fillStyle = '#f4f7f5'; context.fillText(`${integer} HP`, 128, 33);
    // Native plane UVs put V=0 at the bottom, unlike the box decals elsewhere.
    // Flip this atlas upload so the billboard text is upright.
    bar.texture.update(true);
  }

  function setAmount(mesh: Mesh, health: number): void {
    const fraction = Math.max(0, Math.min(1, health / 100));
    mesh.scaling.x = Math.max(0.0001, fraction);
    mesh.position.x = -FILL_WIDTH * (1 - fraction) / 2;
    mesh.isVisible = fraction > 0;
  }

  function release(bar: Bar): void {
    if (bar.id !== null) { byId.delete(bar.id); nodes.delete(bar.id); }
    bar.id = null; bar.root.setEnabled(false); bar.health = 100; bar.trailing = 100; bar.hold = 0; bar.displayed = -1;
    bar.root.position.setAll(0); bar.root.scaling.setAll(1);
    setAmount(bar.fill, 100); setAmount(bar.trail, 100);
  }

  return {
    nodes,
    setCamera(next) { camera = next; },
    stats: { bars: CAPACITY, meshes: CAPACITY * 4, textures: bars.filter((bar) => bar.texture !== null).length },
    setHealth(id, incoming) {
      if (disposed) return;
      let bar = byId.get(id);
      if (!bar) {
        bar = bars.find((candidate) => candidate.id === null);
        if (!bar) return;
        bar.id = id; byId.set(id, bar); nodes.set(id, bar.root);
        bar.health = incoming; bar.trailing = incoming; bar.hold = 0;
        bar.root.setEnabled(true);
      }
      const health = Math.max(0, Math.min(100, incoming));
      if (health < bar.health) bar.hold = 0.25;
      if (health > bar.health) { bar.trailing = health; bar.hold = 0; }
      bar.health = health;
      bar.fillMaterial.emissiveColor.copyFrom(health > 55 ? GREEN : health > 25 ? AMBER : RED);
      setAmount(bar.fill, health); setAmount(bar.trail, bar.trailing);
      renderText(bar);
    },
    setPosition(id, position) {
      if (disposed) return;
      byId.get(id)?.root.position.copyFrom(position);
    },
    pulse(dt) {
      if (disposed) return;
      const engine = scene.getEngine();
      const canvasHeight = engine.getRenderingCanvas()?.clientHeight || engine.getRenderHeight();
      const height = Math.max(1, canvasHeight * camera.viewport.height);
      const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
      const verticalFov = camera.fovMode === Camera.FOVMODE_HORIZONTAL_FIXED ? 2 * Math.atan(Math.tan(camera.fov / 2) / aspect) : camera.fov;
      for (const bar of bars) {
        if (bar.id === null) continue;
        if (bar.hold > 0) bar.hold = Math.max(0, bar.hold - dt);
        else if (bar.trailing > bar.health) { bar.trailing = Math.max(bar.health, bar.trailing - dt * 65); setAmount(bar.trail, bar.trailing); }
        const distance = Vector3.Distance(camera.globalPosition, bar.root.position);
        const viewHeight = camera.mode === Camera.ORTHOGRAPHIC_CAMERA
          ? Math.abs((camera.orthoTop ?? 1) - (camera.orthoBottom ?? -1))
          : 2 * distance * Math.tan(verticalFov / 2);
        const scale = Math.max(0.60, Math.min(3.2, PIXEL_HEIGHT * viewHeight / height / HEIGHT));
        bar.root.scaling.setAll(scale);
      }
    },
    remove(id) { const bar = byId.get(id); if (bar) release(bar); },
    clear() { for (const bar of bars) release(bar); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const bar of bars) { bar.root.dispose(false, false); bar.texture?.dispose(); }
      for (const material of materials) material.dispose(false, false);
      byId.clear(); nodes.clear();
    },
  };
}
