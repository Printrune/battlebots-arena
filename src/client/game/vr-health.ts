export const XR_HEALTH_GRACE_MS = 6_000;
export function isFatalXRGlError(code: number): boolean { return code === 0x506 || code === 0x9242; }

export interface XRHealthEvidence {
  visible: boolean;
  visibleSince: number;
  lastFrameAt: number;
  lastPoseAt: number;
  lastDrawAt: number;
  glError: number;
  framebufferStatus: number | null;
  targetMatches: boolean | null;
}

/** A paused headset is allowed to stop frames. A visible blank session is not. */
export function xrHealthFailure(evidence: XRHealthEvidence, now: number): string | null {
  if (!evidence.visible) return null;
  if (isFatalXRGlError(evidence.glError)) return `WebGL error 0x${evidence.glError.toString(16)} during VR rendering.`;
  if (evidence.framebufferStatus !== null && evidence.framebufferStatus !== 0x8cd5) {
    return `The headset framebuffer is incomplete: 0x${evidence.framebufferStatus.toString(16)}.`;
  }
  if (evidence.targetMatches === false) return 'The XR draw did not target the headset framebuffer.';
  if (now - Math.max(evidence.visibleSince, evidence.lastFrameAt) >= XR_HEALTH_GRACE_MS) return 'The headset did not deliver XR animation frames.';
  if (now - Math.max(evidence.visibleSince, evidence.lastPoseAt) >= XR_HEALTH_GRACE_MS) return 'The headset did not provide a tracked viewer pose.';
  if (now - Math.max(evidence.visibleSince, evidence.lastDrawAt) >= XR_HEALTH_GRACE_MS) return 'No headset eye frames were drawn.';
  return null;
}
