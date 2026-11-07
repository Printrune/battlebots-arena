import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Scene } from '@babylonjs/core/scene';
import { BOTS, MATCH_SECONDS } from '../../shared/protocol';
import type { MatchState } from '../../shared/protocol';

const WIDTH = 4.8;
const HEIGHT = 0.512;
const DISTANCE = 8;
const ELEVATION = 2.2;
const PIXELS_X = 1200;
const PIXELS_Y = 128;

export interface VRHud {
  readonly root: TransformNode;
  readonly stats: { meshes: number; textures: number; readonly redraws: number };
  setMatch(snapshot: MatchState | null, localId: string | null): void;
  setActive(active: boolean, camera?: Camera): void;
  pulse(dt: number): void;
  dispose(): void;
}

/** Read-only match strip above the driver's view. All input belongs to the controllers. */
export function createVRHud(scene: Scene): VRHud {
  const root = new TransformNode('vr-match-status', scene);
  const rotation = Quaternion.Identity();
  root.rotationQuaternion = rotation;
  root.setEnabled(false);
  const screenMaterial = new StandardMaterial('vr-status-material', scene);
  screenMaterial.disableLighting = true;
  screenMaterial.backFaceCulling = false;
  screenMaterial.diffuseColor = Color3.Black();
  screenMaterial.specularColor = Color3.Black();
  screenMaterial.emissiveColor = Color3.White();
  screenMaterial.useAlphaFromDiffuseTexture = true;
  screenMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
  screenMaterial.disableDepthWrite = true;
  const screen = MeshBuilder.CreatePlane('vr-status-screen', { width: WIDTH, height: HEIGHT }, scene);
  screen.parent = root;
  screen.material = screenMaterial;
  screen.isPickable = false;
  screen.receiveShadows = false;
  screen.renderingGroupId = 3;
  screen.alphaIndex = 100;
  scene.setRenderingAutoClearDepthStencil(3, true, true, false);
  let disposed = false;
  let active = false;
  let camera: Camera | null = null;
  let redraws = 0;
  let rendered = '';
  let status = 'NO MATCH';
  let timer = '03:00';
  let localLabel = 'YOUR ROBOT';
  let opponentLabel = 'OPPONENT';
  let localHealth = 100;
  let opponentHealth = 100;
  let context: CanvasRenderingContext2D | null = null;
  let texture: DynamicTexture | null = null;
  const forward = Vector3.Zero();
  const up = Vector3.Zero();
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = PIXELS_X; canvas.height = PIXELS_Y;
    context = canvas.getContext('2d');
    if (context) {
      texture = new DynamicTexture('vr-status-labels', canvas, scene, false);
      texture.hasAlpha = true;
      screenMaterial.diffuseTexture = texture;
      screenMaterial.emissiveTexture = texture;
    }
  }

  function draw(): void {
    const key = [status, timer, localLabel, opponentLabel, Math.ceil(localHealth), Math.ceil(opponentHealth)].join('|');
    if (key === rendered) return;
    rendered = key;
    redraws += 1;
    screen.metadata = { readOnly: true, status, timer, localLabel, opponentLabel, localHealth: Math.ceil(localHealth), opponentHealth: Math.ceil(opponentHealth) };
    if (!context || !texture) return;
    context.clearRect(0, 0, PIXELS_X, PIXELS_Y);
    context.textBaseline = 'middle';
    context.shadowColor = '#000'; context.shadowBlur = 8;
    context.fillStyle = '#f0f5e8'; context.font = 'bold 26px Arial';
    context.textAlign = 'left'; context.fillText(`${localLabel}  ${Math.ceil(localHealth)}%`, 24, 43, 420);
    context.textAlign = 'right'; context.fillText(`${opponentLabel}  ${Math.ceil(opponentHealth)}%`, 1176, 43, 420);
    context.textAlign = 'center'; context.font = 'bold 43px Arial'; context.fillText(timer, 600, 39, 190);
    context.font = 'bold 16px Arial'; context.fillStyle = '#d1dec6'; context.fillText(status, 600, 93, 240);
    context.shadowBlur = 0;
    function healthBar(health: number, x: number): void {
      if (!context) return;
      context.fillStyle = '#111b17cc'; context.fillRect(x, 78, 420, 13);
      context.fillStyle = health > 55 ? '#81e3a1' : health > 25 ? '#ffc65f' : '#ff6565';
      context.fillRect(x, 78, 420 * health / 100, 13);
    }
    healthBar(localHealth, 24); healthBar(opponentHealth, 756);
    texture.update(true);
  }

  function updatePose(): void {
    if (!active || !camera) return;
    camera.getViewMatrix(true);
    camera.getDirectionToRef(Vector3.Forward(), forward);
    camera.getDirectionToRef(Vector3.Up(), up);
    forward.normalize(); up.normalize();
    root.position.copyFrom(camera.globalPosition).addInPlaceFromFloats(
      forward.x * DISTANCE + up.x * ELEVATION,
      forward.y * DISTANCE + up.y * ELEVATION,
      forward.z * DISTANCE + up.z * ELEVATION,
    );
    camera.getWorldMatrix().decompose(undefined, rotation);
  }

  // Upload the atlas before XR shader prewarming so readiness never waits on its first draw.
  draw();
  return {
    root,
    stats: { meshes: 1, textures: texture ? 1 : 0, get redraws() { return redraws; } },
    setMatch(snapshot, localId) {
      if (disposed) return;
      const local = snapshot?.players.find((player) => player.id === localId);
      const opponent = snapshot?.players.find((player) => player.id !== localId);
      localLabel = local ? BOTS[local.botId].name.toUpperCase() : 'YOUR ROBOT';
      opponentLabel = opponent ? BOTS[opponent.botId].name.toUpperCase() : 'OPPONENT';
      localHealth = Math.max(0, Math.min(100, local?.health ?? 100));
      opponentHealth = Math.max(0, Math.min(100, opponent?.health ?? 100));
      const phase = snapshot?.phase;
      const seconds = phase?.kind === 'fighting' || phase?.kind === 'countdown' ? Math.ceil(Math.max(0, phase.seconds)) : MATCH_SECONDS;
      timer = phase?.kind === 'finished' ? 'FINAL' : `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
      status = phase?.kind === 'finished' ? phase.result.winnerId === null ? 'DRAW' : phase.result.winnerId === localId ? 'VICTORY' : 'DEFEAT'
        : phase?.kind === 'fighting' ? 'LIVE'
          : phase?.kind === 'countdown' ? 'COUNTDOWN'
            : phase?.kind === 'lobby' ? local?.ready ? 'WAITING FOR OPPONENT' : 'LOBBY' : 'NO MATCH';
      draw();
    },
    setActive(nextActive, activeCamera) {
      if (disposed) return;
      active = nextActive;
      if (activeCamera) camera = activeCamera;
      root.setEnabled(active);
      updatePose();
    },
    pulse(_dt) { if (!disposed) updatePose(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      camera = null;
      root.dispose(false, false); texture?.dispose(); screenMaterial.dispose(false, false);
    },
  };
}
