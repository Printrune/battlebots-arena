import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { WebXRSessionManager } from '@babylonjs/core/XR/webXRSessionManager';
import { WebXRCamera } from '@babylonjs/core/XR/webXRCamera';
import { Scene } from '@babylonjs/core/scene';
import { alignVRStation, createVR, VR_FEET_PER_METER } from '../src/client/game/vr';
import type { VRStatus } from '../src/shared/vr';

test('non-XR runtimes retain the real desktop camera and release the dormant VR station', async () => {
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
    rig.setMatch(null, null); rig.recenter(); rig.pulse(1 / 90);
    assert.deepEqual(camera.position.asArray(), [2, 4, -5]);
    assert.deepEqual(drive, []);
    rig.dispose(); rig.dispose();
    assert.equal(scene.cameras.length, 1);
    assert.equal(scene.transformNodes.length, 0);
    assert.deepEqual(drive, [[0, 0]]);
  } finally { rig.dispose(); scene.dispose(); engine.dispose(); }
});

test('station origin places actual XR eyes in the arena while preserving local tracking poses', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const manager = new WebXRSessionManager(scene);
  const camera = new WebXRCamera('tracked-head', scene, manager);
  const origin = new TransformNode('station', scene);
  camera.parent = origin;
  camera.position.set(1.2, 4.8, -0.7);
  camera.rotationQuaternion.copyFrom(Quaternion.RotationYawPitchRoll(0.6, -0.15, 0.05));
  const head = camera.position.clone();
  const orientation = camera.rotationQuaternion.clone();
  try {
    for (const slot of [0, 1]) {
      const eye = camera.rigCameras[0]; assert.ok(eye);
      eye.parent = origin;
      eye.position.copyFrom(head).addInPlaceFromFloats(0.1, 0, 0);
      alignVRStation(camera, origin, slot);
      eye.getViewMatrix(true);
      const expected = new Vector3(slot === 0 ? -4 : 4, 5.3, slot === 0 ? -29 : 29);
      assert.ok(Vector3.Distance(camera.globalPosition, expected) < 0.0001);
      assert.ok(Vector3.Distance(eye.globalPosition, expected) > 0.09 && Vector3.Distance(eye.globalPosition, expected) < 0.11,
        'The rendered eye inherits the same station origin, retaining its stereo separation.');
      assert.deepEqual(camera.position.asArray(), head.asArray());
      assert.deepEqual(camera.rotationQuaternion.asArray(), orientation.asArray());
      camera.position.y -= 0.5;
      camera.getViewMatrix(true);
      assert.ok(Math.abs(camera.globalPosition.y - 4.8) < 0.0001, 'A physical head movement changes the rendered view after anchoring.');
      camera.position.copyFrom(head);
    }
  } finally { camera.dispose(); manager.dispose(); origin.dispose(); scene.dispose(); engine.dispose(); }
});
