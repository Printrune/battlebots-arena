import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { WebXRMotionControllerManager } from '@babylonjs/core/XR/motionController/webXRMotionControllerManager';
import { VR_CONTROLLER_PROFILE } from '../src/client/game/vr';

test('offline Quest controller profiles bind the generic trigger used by dashboard selection', async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const online = WebXRMotionControllerManager.UseOnlineRepository;
  WebXRMotionControllerManager.UseOnlineRepository = false;
  const source: XRInputSource = {
    handedness: 'right', targetRayMode: 'tracked-pointer', targetRaySpace: new EventTarget(),
    profiles: ['meta-quest-touch-plus', 'oculus-touch-v3', 'oculus-touch', 'generic-trigger-squeeze-thumbstick'],
  };
  try {
    await assert.rejects(WebXRMotionControllerManager.GetMotionControllerWithXRInput(source, scene), /no controller requested/);
    const controller = await WebXRMotionControllerManager.GetMotionControllerWithXRInput(source, scene, VR_CONTROLLER_PROFILE);
    try {
      assert.equal(controller.profileId, VR_CONTROLLER_PROFILE);
      assert.equal(controller.getMainComponent().type, 'trigger');
      assert.equal(scene.meshes.length, 0, 'Offline binding must not download or create a controller model.');
    } finally { controller.dispose(); }
  } finally {
    WebXRMotionControllerManager.UseOnlineRepository = online;
    scene.dispose(); engine.dispose();
  }
});
