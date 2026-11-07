import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { WebXRSessionManager } from '@babylonjs/core/XR/webXRSessionManager';
import { WebXRCamera } from '@babylonjs/core/XR/webXRCamera';
import { Scene } from '@babylonjs/core/scene';
import { createVR, VR_FEET_PER_METER } from '../src/client/game/vr';
import { VRChaseOrigin } from '../src/client/game/vr-chase';
import type { VRStatus } from '../src/shared/vr';

test('non-XR runtimes retain the real desktop camera and release the dormant tracking origin', async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new FreeCamera('desktop', new Vector3(2, 4, -5), scene);
  const statuses: VRStatus[] = [];
  const drive: [number, number][] = [];
  const rig = createVR(scene, camera, {
    onStatus: (status) => statuses.push(status),
    onDrive: (throttle, steer) => drive.push([throttle, steer]),
    onAction: () => { throw new Error('An unsupported runtime cannot dispatch controller actions.'); },
  });
  try {
    assert.equal(rig.active, false); assert.equal(rig.focused, false);
    assert.equal(rig.camera, camera); assert.equal(scene.activeCamera, camera);
    assert.equal(VR_FEET_PER_METER, 3.28084);
    await assert.rejects(rig.enter(), /WebXR|VR|browser/);
    assert.equal(statuses.at(-1)?.kind, 'unavailable');
    rig.setMatch(null); rig.recenter(); rig.pulse(1 / 90);
    rig.updateView(new Vector3(0, 5.4, -7.6), new Vector3(0, 0.2, 1.7));
    assert.deepEqual(camera.position.asArray(), [2, 4, -5]);
    assert.deepEqual(drive, []);
    rig.dispose(); rig.dispose();
    assert.equal(scene.cameras.length, 1);
    assert.equal(scene.transformNodes.length, 0);
    assert.deepEqual(drive, [[0, 0]]);
  } finally { rig.dispose(); scene.dispose(); engine.dispose(); }
});

test('mobile chase moves actual XR eyes while preserving native head movement and stereo separation', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const manager = new WebXRSessionManager(scene);
  const camera = new WebXRCamera('tracked-head', scene, manager);
  const origin = new TransformNode('chase-origin', scene);
  const chase = new VRChaseOrigin(origin);
  camera.parent = origin;
  camera.position.set(1.2, 4.8, -0.7);
  camera.rotationQuaternion.copyFrom(Quaternion.RotationYawPitchRoll(0.6, -0.15, 0.05));
  const head = camera.position.clone();
  const orientation = camera.rotationQuaternion.clone();
  try {
    let firstView = true;
    for (const position of [new Vector3(0, 5.4, -7.6), new Vector3(3, 5.4, 11.6)]) {
      const target = new Vector3(1, 0.2, 2);
      const eye = camera.rigCameras[0]; assert.ok(eye instanceof TargetCamera);
      eye.parent = origin;
      eye.position.copyFrom(head).addInPlaceFromFloats(0.1, 0, 0);
      eye.rotationQuaternion?.copyFrom(orientation);
      chase.setView(position, target);
      if (firstView) { assert.equal(chase.recenter(camera), true); firstView = false; }
      else chase.update(camera);
      eye.getViewMatrix(true);
      assert.ok(Vector3.Distance(camera.globalPosition, position) < 0.0001);
      const desiredForward = target.subtract(position).normalize();
      assert.ok(Vector3.Dot(camera.getDirection(Vector3.Forward()), desiredForward) > 0.9999,
        'The neutral view matches the mobile chase yaw and pitch.');
      assert.ok(Vector3.Distance(eye.globalPosition, position) > 0.09 && Vector3.Distance(eye.globalPosition, position) < 0.11,
        'Rendered eyes retain their physical stereo separation.');
      assert.deepEqual(camera.position.asArray(), head.asArray());
      assert.deepEqual(camera.rotationQuaternion.asArray(), orientation.asArray());
      assert.deepEqual(eye.position.asArray(), head.add(new Vector3(0.1, 0, 0)).asArray());
      assert.deepEqual(eye.rotationQuaternion?.asArray(), orientation.asArray());
      camera.position.y -= 0.5;
      camera.rotationQuaternion.copyFrom(Quaternion.RotationYawPitchRoll(0.9, -0.15, 0.05));
      chase.update(camera);
      camera.getViewMatrix(true);
      assert.ok(Math.abs(Vector3.Distance(camera.globalPosition, position) - 0.5) < 0.0001,
        'A physical lean changes the rendered view while the bot is followed.');
      assert.ok(Vector3.Dot(camera.getDirection(Vector3.Forward()), desiredForward) < 0.99,
        'Physical free look is retained between recenter presses.');
      assert.equal(chase.recenter(camera), true);
      assert.ok(Vector3.Distance(camera.globalPosition, position) < 0.0001);
      assert.ok(Vector3.Dot(camera.getDirection(Vector3.Forward()), desiredForward) > 0.9999);
      camera.position.copyFrom(head);
      camera.rotationQuaternion.copyFrom(orientation);
      assert.equal(chase.recenter(camera), true);
    }
  } finally { camera.dispose(); manager.dispose(); origin.dispose(); scene.dispose(); engine.dispose(); }
});
