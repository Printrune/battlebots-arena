import { WebXRLayers } from '@babylonjs/core/XR/features/WebXRLayers';
import type { WebXRFeaturesManager } from '@babylonjs/core/XR/webXRFeaturesManager';

/** Request projection layers only when the browser exposes their native API. */
export function prepareVRLayers(features: WebXRFeaturesManager, depth: Pick<XRProjectionLayerInit, 'depthFormat'>): void {
  if (typeof XRWebGLBinding !== 'function' ||
      typeof XRWebGLBinding.prototype.createProjectionLayer !== 'function' ||
      typeof XRWebGLBinding.prototype.getViewSubImage !== 'function') return;
  // Attach manually after native feature negotiation, before the helper chooses
  // between projection rendering and its legacy XRWebGLLayer fallback.
  features.enableFeature(WebXRLayers.Name, 'latest', {
    preferMultiviewOnInit: false,
    projectionLayerInit: { textureType: 'texture', scaleFactor: 0.85, ...depth },
  }, false, false);
}

/** Runs synchronously in session initialization, after the manager's observer. */
export function attachVRLayers(features: WebXRFeaturesManager): void {
  const layers = features.getEnabledFeature(WebXRLayers.Name);
  if (!layers) return;
  try {
    features.attachFeature(WebXRLayers.Name);
    // The helper tests whether the feature is enabled, rather than attached.
    // Remove a declined optional feature so its legacy branch can initialize.
    if (!layers.attached) features.disableFeature(WebXRLayers.Name);
  } catch (cause: unknown) {
    features.disableFeature(WebXRLayers.Name);
    const reason = cause instanceof Error ? cause.message : 'the browser rejected its projection layer';
    // The helper ends the created session when this initialization observer
    // throws. Never continue with a partially installed projection layer.
    throw new Error(`VR projection rendering could not initialize: ${reason}`, { cause });
  }
}
