import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { createVR, VR_FEET_PER_METER } from '../src/client/game/vr';
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
    assert.deepEqual(drive, [[0, 0]]);
  } finally { rig.dispose(); scene.dispose(); engine.dispose(); }
});
