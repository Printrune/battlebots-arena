import assert from 'node:assert/strict';
import test from 'node:test';
import { XR_HEALTH_GRACE_MS, xrHealthFailure } from '../src/client/game/vr-health';
import type { XRHealthEvidence } from '../src/client/game/vr-health';

function evidence(changes: Partial<XRHealthEvidence> = {}): XRHealthEvidence {
  return { visible: true, visibleSince: 100, lastFrameAt: 0, lastPoseAt: 0, lastDrawAt: 0,
    glError: 0, framebufferStatus: null, targetMatches: null, ...changes };
}

test('a visible startup distinguishes missing XR frames, tracking and eye draws after its grace period', () => {
  const deadline = 100 + XR_HEALTH_GRACE_MS;
  assert.equal(xrHealthFailure(evidence(), deadline - 1), null);
  assert.match(xrHealthFailure(evidence(), deadline) ?? '', /animation frames/);
  assert.match(xrHealthFailure(evidence({ lastFrameAt: deadline }), deadline) ?? '', /viewer pose/);
  assert.match(xrHealthFailure(evidence({ lastFrameAt: deadline, lastPoseAt: deadline }), deadline) ?? '', /eye frames/);
  assert.equal(xrHealthFailure(evidence({ lastFrameAt: deadline, lastPoseAt: deadline, lastDrawAt: deadline,
    framebufferStatus: 0x8cd5, targetMatches: true }), deadline), null);
});

test('paused sessions may stop frames and a resumed session gets a fresh grace period', () => {
  assert.equal(xrHealthFailure(evidence({ visible: false }), 60_000), null);
  assert.equal(xrHealthFailure(evidence({ visibleSince: 60_000 }), 60_000 + XR_HEALTH_GRACE_MS - 1), null);
  assert.match(xrHealthFailure(evidence({ visibleSince: 60_000 }), 60_000 + XR_HEALTH_GRACE_MS) ?? '', /animation frames/);
});

test('native WebGL errors and wrong headset targets are reported without waiting for a timeout', () => {
  assert.match(xrHealthFailure(evidence({ glError: 0x506 }), 200) ?? '', /0x506/);
  assert.match(xrHealthFailure(evidence({ framebufferStatus: 0x8cdd }), 200) ?? '', /0x8cdd/);
  assert.match(xrHealthFailure(evidence({ targetMatches: false }), 200) ?? '', /headset framebuffer/);
});

test('historical non-framebuffer WebGL errors do not terminate a healthy session', () => {
  for (const glError of [0x500, 0x501, 0x502]) {
    assert.equal(xrHealthFailure(evidence({ glError, framebufferStatus: 0x8cd5, targetMatches: true,
      lastFrameAt: 10_000, lastPoseAt: 10_000, lastDrawAt: 10_000 }), 10_000), null);
  }
  assert.match(xrHealthFailure(evidence({ glError: 0x9242 }), 200) ?? '', /0x9242.*during VR rendering/);
});

test('an established visible session detects a later stalled render loop', () => {
  const last = 20_000;
  const healthy = evidence({ lastFrameAt: last, lastPoseAt: last, lastDrawAt: last });
  assert.equal(xrHealthFailure(healthy, last + XR_HEALTH_GRACE_MS - 1), null);
  assert.match(xrHealthFailure(healthy, last + XR_HEALTH_GRACE_MS) ?? '', /animation frames/);
});
