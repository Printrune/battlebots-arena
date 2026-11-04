import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { WebXRFeaturesManager } from '@babylonjs/core/XR/webXRFeaturesManager';
import { WebXRSessionManager } from '@babylonjs/core/XR/webXRSessionManager';
import { WebXRLayers } from '@babylonjs/core/XR/features/WebXRLayers';
import { attachVRLayers, prepareVRLayers } from '../src/client/game/vr-layers';

function setup(negotiated: string[], nativeApi: boolean) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'XRWebGLBinding');
  // Native XR objects are the browser boundary. The real Babylon feature
  // manager, optional negotiation and attach/cleanup behavior run below.
  class Binding {
    createProjectionLayer() { throw new Error('Unexpected projection creation without a WebGL context.'); }
    getViewSubImage() { throw new Error('No XR frame is being rendered in this lifecycle test.'); }
  }
  Object.defineProperty(globalThis, 'XRWebGLBinding', { configurable: true, value: nativeApi ? Binding : undefined });
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const session = new WebXRSessionManager(scene);
  Object.defineProperty(session, 'isNative', { configurable: true, get: () => false });
  Object.defineProperty(session, 'enabledFeatures', { configurable: true, get: () => negotiated });
  const features = new WebXRFeaturesManager(session);
  return {
    features,
    dispose() {
      features.dispose(); session.dispose(); scene.dispose(); engine.dispose();
      if (previous) Object.defineProperty(globalThis, 'XRWebGLBinding', previous);
      else Reflect.deleteProperty(globalThis, 'XRWebGLBinding');
    },
  };
}

test('browsers without the native projection API retain the legacy renderer', () => {
  const context = setup([], false);
  try {
    prepareVRLayers(context.features, { depthFormat: 0x81a6 });
    attachVRLayers(context.features);
    assert.equal(context.features.getEnabledFeature(WebXRLayers.Name), undefined);
  } finally { context.dispose(); }
});

test('declined optional layers are removed before the helper chooses its legacy branch', async () => {
  const context = setup([], true);
  try {
    prepareVRLayers(context.features, { depthFormat: 0x81a6 });
    const feature = context.features.getEnabledFeature(WebXRLayers.Name);
    assert.ok(feature);
    assert.equal(feature.disableAutoAttach, true);
    assert.equal(feature.attached, false);
    const request = await context.features._extendXRSessionInitObject({});
    assert.ok(request.optionalFeatures?.includes('layers'));
    assert.ok(!request.requiredFeatures?.includes('layers'));
    attachVRLayers(context.features);
    assert.equal(context.features.getEnabledFeature(WebXRLayers.Name), undefined);
  } finally { context.dispose(); }
});

test('projection attachment errors remove the feature and produce a clear setup failure', () => {
  const context = setup(['layers'], true);
  try {
    prepareVRLayers(context.features, { depthFormat: 0x81a6 });
    assert.throws(() => attachVRLayers(context.features), /VR projection rendering could not initialize:.*XR graphics binding/);
    assert.equal(context.features.getEnabledFeature(WebXRLayers.Name), undefined);
  } finally { context.dispose(); }
});
