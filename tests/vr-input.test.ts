import assert from 'node:assert/strict';
import test from 'node:test';
import { readVRInput, vrStick } from '../src/client/game/vr-input';
import type { VRControllerSample } from '../src/client/game/vr-input';

function controller(changes: Partial<VRControllerSample> = {}): VRControllerSample {
  return { id: 'right', handedness: 'right', stick: { x: 0, y: 0 }, trigger: false, primary: false,
    secondary: false, onHud: false, ...changes };
}

test('VR sticks remove drift, preserve full travel and neutralize non-finite axes', () => {
  assert.deepEqual(vrStick(0.09, -0.08), { throttle: 0, steer: 0 });
  assert.deepEqual(vrStick(0, -1), { throttle: 1, steer: 0 });
  assert.deepEqual(vrStick(0, 1), { throttle: -1, steer: 0 });
  const diagonal = vrStick(1, -1);
  assert.ok(Math.abs(Math.hypot(diagonal.throttle, diagonal.steer) - 1) < 0.00001);
  assert.deepEqual(vrStick(NaN, 1), { throttle: 0, steer: 0 });
});

test('left stick owns driving, with single-controller fallback and disconnect neutral', () => {
  const right = controller({ stick: { x: 1, y: -1 } });
  const left = controller({ id: 'left', handedness: 'left', stick: { x: 0, y: 1 } });
  assert.deepEqual(readVRInput([right, left], new Set(), true).throttle, -1);
  assert.ok(readVRInput([right], new Set(), true).steer > 0);
  assert.equal(readVRInput([], new Set(), true).throttle, 0);
});

test('controller actions fire once per press and map both hands without branding', () => {
  const samples = [controller({ primary: true, secondary: true }),
    controller({ id: 'left', handedness: 'left', primary: true, secondary: true })];
  const first = readVRInput(samples, new Set(), true);
  assert.deepEqual(first.actions, ['weapon', 'recover', 'pulverize', 'recenter']);
  assert.deepEqual(readVRInput(samples, first.held, true).actions, []);
  const released = readVRInput([], first.held, true);
  assert.deepEqual(readVRInput(samples, released.held, true).actions, first.actions);
});

test('dashboard selection consumes a trigger press until it is released', () => {
  const selected = readVRInput([controller({ trigger: true, onHud: true })], new Set(), true);
  assert.deepEqual(selected.actions, []);
  assert.deepEqual(readVRInput([controller({ trigger: true })], selected.held, true).actions, []);
  assert.deepEqual(readVRInput([controller({ trigger: true })], new Set(), true).actions, ['weapon']);
});

test('paused XR input has no drive/actions and baselines held buttons for resume', () => {
  const samples = [controller({ trigger: true, stick: { x: 1, y: -1 } })];
  const paused = readVRInput(samples, new Set(), false);
  assert.equal(paused.throttle, 0); assert.equal(paused.steer, 0); assert.deepEqual(paused.actions, []);
  assert.deepEqual(readVRInput(samples, paused.held, true).actions, []);
});
