import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { BOTS, MATCH_SECONDS } from '../../shared/protocol';
import type { MatchState } from '../../shared/protocol';
import { partIntegrity } from '../../shared/damage';
import { PULVERIZERS } from '../../shared/arena';
import type { VRAction } from '../../shared/vr';

const WIDTH = 5.5;
const HEIGHT = 3.1;
const PIXELS_X = 1100;
const PIXELS_Y = 620;
type DriveDirection = 'drive-forward' | 'drive-reverse' | 'drive-left' | 'drive-right' | 'drive-stop'
  | 'drive-forward-left' | 'drive-forward-right' | 'drive-reverse-left' | 'drive-reverse-right';
const DRIVE: Record<DriveDirection, { throttle: number; steer: number }> = {
  'drive-forward': { throttle: 1, steer: 0 }, 'drive-reverse': { throttle: -1, steer: 0 },
  'drive-left': { throttle: 0, steer: -1 }, 'drive-right': { throttle: 0, steer: 1 }, 'drive-stop': { throttle: 0, steer: 0 },
  'drive-forward-left': { throttle: 1, steer: -1 }, 'drive-forward-right': { throttle: 1, steer: 1 },
  'drive-reverse-left': { throttle: -1, steer: -1 }, 'drive-reverse-right': { throttle: -1, steer: 1 },
};
type ControlAction = VRAction | DriveDirection;
interface Control {
  mesh: Mesh; action: ControlAction; label: string; enabled: boolean;
  x: number; y: number; width: number; height: number;
}
interface Callbacks {
  onAction(action: VRAction): void;
  onDrive(throttle: number, steer: number): void;
}
export interface VRHud {
  readonly root: TransformNode;
  readonly stats: { meshes: number; textures: number; readonly redraws: number };
  setMatch(snapshot: MatchState | null, localId: string | null): void;
  setActive(active: boolean, camera?: Camera): void;
  releaseDrive(): void;
  pulse(dt: number): void;
  dispose(): void;
}

/** Fixed driver desk. Controller rays and transient hand/gaze pointers share its controls. */
export function createVRHud(scene: Scene, callbacks: Callbacks): VRHud {
  const root = new TransformNode('vr-driver-desk', scene);
  const materials: StandardMaterial[] = [];
  const controls: Control[] = [];
  const held = new Map<number, DriveDirection>();
  const pressed = new Set<number>();
  let active = false;
  let disposed = false;
  let fighting = false;
  let redraws = 0;
  let rendered = '';
  let status = 'OPEN A MATCH ON THE BROWSER SCREEN';
  let timer = '03:00';
  let localLabel = 'YOUR ROBOT';
  let opponentLabel = 'OPPONENT';
  let localHealth = 100;
  let opponentHealth = 100;
  let weaponStatus = 'Controller stick or hold the direction buttons';
  let context: CanvasRenderingContext2D | null = null;
  let texture: DynamicTexture | null = null;
  const forward = Vector3.Zero();
  const offset = Vector3.Zero();
  root.rotationQuaternion = Quaternion.Identity();
  root.scaling.setAll(4.2 / WIDTH);
  root.setEnabled(false);
  scene.setRenderingAutoClearDepthStencil(3, true, true, true);

  function unlit(name: string, color: Color3): StandardMaterial {
    const result = new StandardMaterial(name, scene);
    result.disableLighting = true; result.backFaceCulling = false;
    result.diffuseColor = Color3.Black(); result.specularColor = Color3.Black(); result.emissiveColor.copyFrom(color);
    materials.push(result);
    return result;
  }
  const screenMaterial = unlit('vr-desk-atlas', Color3.White());
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = PIXELS_X; canvas.height = PIXELS_Y;
    context = canvas.getContext('2d');
    if (context) {
      texture = new DynamicTexture('vr-desk-labels', canvas, scene, false);
      screenMaterial.diffuseTexture = texture; screenMaterial.emissiveTexture = texture;
    }
  }
  function plane(name: string, width: number, height: number, x: number, y: number, z: number, material: StandardMaterial): Mesh {
    const result = MeshBuilder.CreatePlane(name, { width, height }, scene);
    result.parent = root; result.position.set(x, y, z); result.material = material;
    result.receiveShadows = false; result.isPickable = false; result.renderingGroupId = 3;
    result.alphaIndex = 100;
    return result;
  }
  const screen = plane('vr-desk-screen', WIDTH, HEIGHT, 0, 0, 0, screenMaterial);
  const localMaterial = unlit('vr-desk-your-life', Color3.FromHexString('#81e3a1'));
  const opponentMaterial = unlit('vr-desk-opponent-life', Color3.FromHexString('#81e3a1'));
  const localFill = plane('vr-desk-your-life-fill', 2.45, 0.065, -1.385, HEIGHT / 2 - 155 / PIXELS_Y * HEIGHT, -0.006, localMaterial);
  const opponentFill = plane('vr-desk-opponent-life-fill', 2.45, 0.065, 1.385, HEIGHT / 2 - 155 / PIXELS_Y * HEIGHT, -0.006, opponentMaterial);

  function control(action: ControlAction, label: string, x: number, y: number, width: number, height: number): void {
    const mesh = plane(`vr-control-${action}`, width / PIXELS_X * WIDTH, height / PIXELS_Y * HEIGHT,
      (x + width / 2) / PIXELS_X * WIDTH - WIDTH / 2,
      HEIGHT / 2 - (y + height / 2) / PIXELS_Y * HEIGHT, -0.003, screenMaterial);
    const left = x / PIXELS_X; const right = (x + width) / PIXELS_X;
    const bottom = 1 - (y + height) / PIXELS_Y; const top = 1 - y / PIXELS_Y;
    mesh.setVerticesData(VertexBuffer.UVKind, [left, bottom, right, bottom, right, top, left, top]);
    mesh.metadata = { vrControl: true, action, enabled: false, label };
    controls.push({ mesh, action, label, enabled: false, x, y, width, height });
  }
  control('weapon', 'WEAPON', 24, 220, 248, 72);
  control('recover', 'SELF RIGHT', 288, 220, 248, 72);
  control('pulverize', 'PULVERIZERS', 552, 220, 248, 72);
  control('ready', 'READY', 816, 220, 260, 72);
  control('drive-forward', 'FORWARD', 180, 312, 140, 70);
  control('drive-forward-left', 'FWD LEFT', 24, 312, 140, 70);
  control('drive-forward-right', 'FWD RIGHT', 336, 312, 140, 70);
  control('drive-left', 'LEFT', 24, 396, 140, 70);
  control('drive-stop', 'STOP', 180, 396, 140, 70);
  control('drive-right', 'RIGHT', 336, 396, 140, 70);
  control('drive-reverse', 'REVERSE', 180, 480, 140, 70);
  control('drive-reverse-left', 'BACK LEFT', 24, 480, 140, 70);
  control('drive-reverse-right', 'BACK RIGHT', 336, 480, 140, 70);
  control('recenter', 'RECENTER', 552, 336, 248, 76);
  control('exit', 'EXIT VR', 816, 336, 260, 76);
  control('leave', 'LEAVE MATCH', 552, 444, 524, 76);

  function updateControl(action: ControlAction, enabled: boolean, label?: string): void {
    const button = controls.find((item) => item.action === action);
    if (!button) return;
    button.enabled = enabled;
    if (label !== undefined) button.label = label;
    button.mesh.isPickable = active && enabled;
    button.mesh.metadata = { vrControl: true, action: button.action, enabled, label: button.label };
  }
  function draw(): void {
    const key = [status, timer, localLabel, opponentLabel, Math.ceil(localHealth), Math.ceil(opponentHealth), weaponStatus,
      ...controls.map((button) => `${button.action}:${button.label}:${button.enabled}`)].join('|');
    if (key === rendered) return;
    rendered = key; redraws += 1;
    screen.metadata = { status, timer, localLabel, opponentLabel, localHealth: Math.ceil(localHealth), opponentHealth: Math.ceil(opponentHealth), weaponStatus };
    if (!context || !texture) return;
    context.fillStyle = '#111a1c'; context.fillRect(0, 0, PIXELS_X, PIXELS_Y);
    context.strokeStyle = '#637850'; context.lineWidth = 4; context.strokeRect(2, 2, PIXELS_X - 4, PIXELS_Y - 4);
    context.textBaseline = 'middle'; context.textAlign = 'left';
    context.font = 'bold 22px Arial'; context.fillStyle = '#adca82'; context.fillText('BATTLEBOTS / DRIVER STATION', 28, 27);
    context.textAlign = 'right'; context.font = 'bold 40px Arial'; context.fillStyle = '#f2f4ea'; context.fillText(timer, PIXELS_X - 28, 48);
    context.textAlign = 'left'; context.font = 'bold 26px Arial'; context.fillText(status, 28, 77, 850);
    context.font = 'bold 25px Arial'; context.fillStyle = '#e3e8df';
    context.fillText(`${localLabel}  ${Math.ceil(localHealth)}/100`, 28, 120, 490);
    context.fillText(`${opponentLabel}  ${Math.ceil(opponentHealth)}/100`, 582, 120, 490);
    context.fillStyle = '#293335'; context.fillRect(28, 148, 490, 14); context.fillRect(582, 148, 490, 14);
    context.font = '22px Arial'; context.fillStyle = '#b9c4bd'; context.fillText(weaponStatus, 28, 189, 1044);
    for (const button of controls) {
      context.fillStyle = button.enabled ? '#283b2d' : '#1c2425'; context.fillRect(button.x, button.y, button.width, button.height);
      context.strokeStyle = button.enabled ? '#8da66a' : '#3b4844'; context.lineWidth = 2;
      context.strokeRect(button.x, button.y, button.width, button.height);
      context.textAlign = 'center'; context.font = 'bold 24px Arial'; context.fillStyle = button.enabled ? '#edf2dc' : '#77847e';
      context.fillText(button.label, button.x + button.width / 2, button.y + button.height / 2, button.width - 16);
    }
    context.textAlign = 'left'; context.fillStyle = '#a8b4aa'; context.font = '19px Arial';
    context.fillText('STICK: DRIVE   A / TRIGGER: WEAPON', 552, 556, 520);
    context.fillText('B: SELF RIGHT   X: PULVERIZERS', 552, 584, 520);
    texture.update(true);
  }
  function releaseDrive(): void {
    const moving = held.size > 0;
    held.clear(); pressed.clear();
    if (moving) callbacks.onDrive(0, 0);
  }
  function drive(): void {
    let throttle = 0; let steer = 0;
    for (const direction of held.values()) {
      throttle += DRIVE[direction].throttle; steer += DRIVE[direction].steer;
    }
    callbacks.onDrive(Math.max(-1, Math.min(1, throttle)), Math.max(-1, Math.min(1, steer)));
  }
  const observer = scene.onPointerObservable.add((info) => {
    if (!active || disposed) return;
    const pointer = 'pointerId' in info.event && typeof info.event.pointerId === 'number' ? info.event.pointerId : 0;
    if (info.type === PointerEventTypes.POINTERUP || info.event.type === 'pointercancel' || info.event.type === 'lostpointercapture') {
      pressed.delete(pointer);
      if (held.delete(pointer)) drive();
      return;
    }
    if (info.type !== PointerEventTypes.POINTERDOWN || pressed.has(pointer)) return;
    const button = controls.find((item) => item.mesh === info.pickInfo?.pickedMesh && item.enabled);
    if (!button) return;
    pressed.add(pointer);
    switch (button.action) {
      case 'drive-forward': case 'drive-reverse': case 'drive-left': case 'drive-right':
      case 'drive-forward-left': case 'drive-forward-right': case 'drive-reverse-left': case 'drive-reverse-right':
        held.set(pointer, button.action); drive(); break;
      case 'drive-stop': releaseDrive(); callbacks.onDrive(0, 0); break;
      default: callbacks.onAction(button.action);
    }
  });
  const cancel = () => releaseDrive();
  const hidden = () => { if (document.visibilityState !== 'visible') releaseDrive(); };
  if (typeof window !== 'undefined') {
    window.addEventListener('blur', cancel); window.addEventListener('pointercancel', cancel);
    document.addEventListener('visibilitychange', hidden);
  }

  return {
    root,
    stats: { meshes: controls.length + 3, textures: texture ? 1 : 0, get redraws() { return redraws; } },
    setMatch(snapshot, localId) {
      if (disposed) return;
      const local = snapshot?.players.find((player) => player.id === localId);
      const opponent = snapshot?.players.find((player) => player.id !== localId);
      fighting = snapshot?.phase.kind === 'fighting' && !!local && local.connected;
      if (!fighting) releaseDrive();
      localLabel = local ? `YOU / ${BOTS[local.botId].name.toUpperCase()}` : 'YOUR ROBOT';
      opponentLabel = opponent ? BOTS[opponent.botId].name.toUpperCase() : 'AWAITING OPPONENT';
      localHealth = Math.max(0, Math.min(100, local?.health ?? 100));
      opponentHealth = Math.max(0, Math.min(100, opponent?.health ?? 100));
      const phase = snapshot?.phase;
      const seconds = phase?.kind === 'fighting' || phase?.kind === 'countdown' ? Math.ceil(Math.max(0, phase.seconds)) : MATCH_SECONDS;
      timer = phase?.kind === 'finished' ? 'FINAL' : `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
      status = phase?.kind === 'finished' ? phase.result.winnerId === null ? 'DRAW' : phase.result.winnerId === localId ? 'VICTORY' : 'BACK TO THE WORKSHOP'
        : phase?.kind === 'fighting' ? 'LIVE / KEEP YOUR BOT IN SIGHT'
          : phase?.kind === 'countdown' ? 'GET READY'
            : phase?.kind === 'lobby' ? local?.ready ? 'WAITING FOR OPPONENT' : 'READY TO RUMBLE?' : 'OPEN A MATCH ON THE BROWSER SCREEN';
      const integrity = local ? partIntegrity(local.damage, 'weapon') : 0;
      weaponStatus = local ? `~${Math.round(local.weaponRpm / 250) * 250} RPM / ${integrity <= 0 ? 'WEAPON DESTROYED' : local.weaponActive ? 'WEAPON SPINNING' : 'WEAPON STANDBY'}` : 'Controller stick or hold the direction buttons';
      updateControl('weapon', fighting && integrity > 0, local?.weaponActive ? 'WEAPON ON' : 'SPIN UP');
      updateControl('recover', fighting && !!local && BOTS[local.botId].physics.selfRight && !local.recovering && local.recoveryCooldown <= 0,
        local?.recovering ? 'RIGHTING' : local && !BOTS[local.botId].physics.selfRight ? 'INVERTIBLE' : local && local.recoveryCooldown > 0 ? `RIGHT IN ${Math.ceil(local.recoveryCooldown)}s` : 'SELF RIGHT');
      const hammers = snapshot?.arena.hazards.filter((hazard) => hazard.kind === 'pulverizer' &&
        PULVERIZERS.some((definition) => definition.id === hazard.id && definition.ownerSlot === local?.spawnSlot)) ?? [];
      const hammerWait = hammers.reduce((maximum, hammer) => hammer.kind === 'pulverizer' ? Math.max(maximum, hammer.cooldown) : maximum, 0);
      const swinging = hammers.some((hammer) => hammer.kind === 'pulverizer' && hammer.phase !== 'idle');
      updateControl('pulverize', fighting && hammers.length === 2 && !swinging && hammerWait <= 0,
        swinging ? 'SWINGING' : hammerWait > 0 ? `HAMMERS ${Math.ceil(hammerWait)}s` : 'PULVERIZERS');
      const primary = controls.find((button) => button.action === 'ready' || button.action === 'rematch');
      if (primary) {
        primary.action = phase?.kind === 'finished' ? 'rematch' : 'ready';
        updateControl(primary.action, !!local?.connected && (phase?.kind === 'finished' || phase?.kind === 'lobby' && !local.ready), phase?.kind === 'finished' ? 'REMATCH' : local?.ready ? 'READY' : 'I AM READY');
      }
      for (const button of controls) if (button.action.startsWith('drive-')) updateControl(button.action, fighting);
      updateControl('recenter', true); updateControl('exit', true); updateControl('leave', !!snapshot);
      function fill(mesh: Mesh, material: StandardMaterial, health: number, center: number): void {
        const fraction = health / 100;
        mesh.scaling.x = Math.max(0.0001, fraction); mesh.isVisible = fraction > 0;
        mesh.position.x = center - 2.45 * (1 - fraction) / 2;
        material.emissiveColor.copyFromFloats(health > 55 ? 0.506 : health > 25 ? 1 : 1, health > 55 ? 0.89 : health > 25 ? 0.776 : 0.396, health > 55 ? 0.631 : health > 25 ? 0.373 : 0.396);
      }
      fill(localFill, localMaterial, localHealth, -1.385); fill(opponentFill, opponentMaterial, opponentHealth, 1.385);
      draw();
    },
    setActive(nextActive, camera) {
      if (disposed) return;
      active = nextActive;
      root.setEnabled(active);
      if (!active) releaseDrive();
      for (const button of controls) button.mesh.isPickable = active && button.enabled;
      if (active && camera) {
        camera.getViewMatrix(true);
        camera.getDirectionToRef(Vector3.Forward(), forward);
        forward.y = 0;
        if (forward.lengthSquared() < 0.001) forward.set(0, 0, 1);
        else forward.normalize();
        offset.set(forward.x * 4.5 + forward.z * 3.3, 0, forward.z * 4.5 - forward.x * 3.3);
        root.position.copyFrom(camera.globalPosition).addInPlace(offset); root.position.y -= 1.4;
        Quaternion.RotationYawPitchRollToRef(Math.atan2(offset.x, offset.z), 0, 0, root.rotationQuaternion ?? Quaternion.Identity());
      }
    },
    releaseDrive,
    pulse(_dt) { if (active && fighting && held.size > 0) drive(); },
    dispose() {
      if (disposed) return;
      releaseDrive(); disposed = true;
      scene.onPointerObservable.remove(observer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', cancel); window.removeEventListener('pointercancel', cancel);
        document.removeEventListener('visibilitychange', hidden);
      }
      root.dispose(false, false); texture?.dispose();
      for (const material of materials) material.dispose(false, false);
    },
  };
}
