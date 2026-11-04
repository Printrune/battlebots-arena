import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PointerInfo, PointerEventTypes } from '@babylonjs/core/Events/pointerEvents';
import type { IPointerEvent } from '@babylonjs/core/Events/deviceInputEvents';
import { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { createVRHud } from '../src/client/game/vr-hud';
import { createSimulation } from '../src/server/simulation';
import type { VRAction } from '../src/shared/vr';

const engine = new NullEngine({ renderWidth: 960, renderHeight: 540, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 4 });
const scene = new Scene(engine);
const camera = new FreeCamera('vr-hud-proof-camera', new Vector3(0, 5.3, -29), scene);
camera.setTarget(new Vector3(0, 5.3, 0)); camera.getViewMatrix(true);
const actions: VRAction[] = [];
const drives: { throttle: number; steer: number }[] = [];
const hud = createVRHud(scene, { onAction: (action) => actions.push(action), onDrive: (throttle, steer) => drives.push({ throttle, steer }) });
const simulation = await createSimulation('vr-hud-proof');
simulation.addPlayer('a', 'Doctor', { botId: 'witchdoctor', paint: 'signature' });
simulation.addPlayer('b', 'Tombstone', { botId: 'tombstone', paint: 'signature' });

function pointer(type: number, meshName: string | null, pointerId = 1): void {
  const pick = new PickingInfo();
  pick.hit = meshName !== null;
  pick.pickedMesh = meshName ? scene.getMeshByName(meshName) : null;
  const event: IPointerEvent = {
    type: type === PointerEventTypes.POINTERUP ? 'pointerup' : 'pointerdown', pointerId, pointerType: 'xr',
    inputIndex: 2, button: 0, buttons: type === PointerEventTypes.POINTERUP ? 0 : 1,
    clientX: 0, clientY: 0, offsetX: 0, offsetY: 0, pageX: 0, pageY: 0, x: 0, y: 0,
    movementX: 0, movementY: 0, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false,
    target: null, preventDefault() {},
  };
  scene.onPointerObservable.notifyObservers(new PointerInfo(type, event, pick));
}
function click(name: string, pointerId = 1): void {
  pointer(PointerEventTypes.POINTERDOWN, name, pointerId);
  pointer(PointerEventTypes.POINTERUP, null, pointerId);
}

try {
  assert.equal(hud.stats.meshes, 19); assert.equal(scene.meshes.length, 19);
  assert.equal(hud.stats.textures, 0, 'NullEngine proof uses no DOM texture allocation.');
  hud.setMatch(simulation.snapshot(), 'a');
  click('vr-control-ready'); assert.deepEqual(actions, [], 'Inactive panels cannot dispatch a click.');
  hud.setActive(true, camera);
  assert.ok(hud.root.isEnabled());
  assert.ok(Math.abs(hud.root.position.z + 24.5) < 0.01);
  assert.ok(Math.abs(hud.root.position.x - 3.3) < 0.01, 'The tablet sits to the right, leaving the arena center open.');
  assert.ok(Math.abs(hud.root.position.y - 3.9) < 0.01, 'The desk is below eye level.');
  assert.ok(Math.abs(hud.root.scaling.x - 4.2 / 5.5) < 0.001, 'The tablet width is 4.2 feet.');
  const anchored = hud.root.position.clone();
  camera.position.x = 3; camera.getViewMatrix(true); hud.pulse(1 / 90);
  assert.ok(hud.root.position.equals(anchored), 'Looking or moving the head does not drag the desk.');
  pointer(PointerEventTypes.POINTERDOWN, 'vr-control-ready');
  pointer(PointerEventTypes.POINTERDOWN, 'vr-control-ready');
  assert.deepEqual(actions, ['ready'], 'Repeated down events do not issue repeated lifecycle commands.');
  pointer(PointerEventTypes.POINTERUP, null);
  simulation.setReady('a', true); simulation.setReady('b', true);
  for (let tick = 0; tick < 90; tick += 1) simulation.step(1 / 30, tick * 1000 / 30);
  const fighting = simulation.snapshot();
  assert.equal(fighting.phase.kind, 'fighting');
  hud.setMatch(fighting, 'a');
  const yourLife = scene.getMeshByName('vr-desk-your-life-fill'); const screen = scene.getMeshByName('vr-desk-screen');
  assert.ok(yourLife && screen);
  const redraws = hud.stats.redraws;
  hud.setMatch(fighting, 'a');
  assert.equal(hud.stats.redraws, redraws, 'Identical snapshots do not redraw the atlas.');
  click('vr-control-weapon'); click('vr-control-recover'); click('vr-control-pulverize');
  assert.deepEqual(actions, ['ready', 'weapon', 'recover', 'pulverize']);
  const beforeHeld = drives.length;
  hud.pulse(1 / 90);
  assert.equal(drives.length, beforeHeld, 'The desk does not overwrite controller input when no pad is held.');
  pointer(PointerEventTypes.POINTERDOWN, 'vr-control-drive-forward', 7);
  pointer(PointerEventTypes.POINTERDOWN, 'vr-control-drive-left', 8);
  hud.pulse(1 / 90);
  assert.deepEqual(drives.at(-1), { throttle: 1, steer: -1 });
  pointer(PointerEventTypes.POINTERUP, null, 7);
  assert.deepEqual(drives.at(-1), { throttle: 0, steer: -1 }, 'Releasing outside the mesh stops that direction.');
  pointer(PointerEventTypes.POINTERUP, null, 8);
  assert.deepEqual(drives.at(-1), { throttle: 0, steer: 0 });
  pointer(PointerEventTypes.POINTERDOWN, 'vr-control-drive-reverse-right', 10);
  assert.deepEqual(drives.at(-1), { throttle: -1, steer: 1 }, 'A single hand/gaze pointer can reverse and steer together.');
  pointer(PointerEventTypes.POINTERUP, null, 10);
  const local = fighting.players.find((player) => player.id === 'a'); assert.ok(local);
  local.health = 0.2;
  hud.setMatch(fighting, 'a');
  assert.equal(screen.metadata.localHealth, 1, 'Alive fractional hull is never labeled zero.');
  assert.equal(yourLife.scaling.x, 0.002);
  pointer(PointerEventTypes.POINTERDOWN, 'vr-control-drive-reverse', 9);
  hud.setActive(false);
  assert.deepEqual(drives.at(-1), { throttle: 0, steer: 0 }, 'Leaving or pausing VR neutralizes held driving.');
  const afterPause = drives.length; hud.pulse(1 / 90); assert.equal(drives.length, afterPause);
  hud.setActive(true, camera);
  fighting.phase = { kind: 'finished', result: { winnerId: 'b', reason: 'knockout' } };
  local.health = 0; hud.setMatch(fighting, 'a');
  assert.equal(yourLife.isVisible, false); assert.equal(screen.metadata.status, 'BACK TO THE WORKSHOP');
  click('vr-control-ready');
  assert.equal(actions.at(-1), 'rematch', 'The lifecycle button becomes rematch without allocating a new mesh.');
  const actionCount = actions.length;
  click('vr-control-weapon'); pointer(PointerEventTypes.POINTERDOWN, 'vr-control-drive-forward');
  assert.equal(actions.length, actionCount, 'Finished matches disable combat buttons.');
  click('vr-control-recenter', 2); click('vr-control-exit', 3); click('vr-control-leave', 4);
  assert.deepEqual(actions.slice(-3), ['recenter', 'exit', 'leave']);
  scene.render();
  assert.equal(scene.meshes.length, 19);
  process.stdout.write(`${JSON.stringify({ check: 'PASS: VR driver desk, life bars, lifecycle, ray controls, held drive and cleanup', ...hud.stats })}\n`);
} finally {
  simulation.dispose(); hud.dispose();
  assert.equal(scene.meshes.length, 0); assert.equal(scene.materials.length, 0);
  scene.dispose(); engine.dispose();
}
