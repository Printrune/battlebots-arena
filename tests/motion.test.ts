import assert from 'node:assert/strict';
import test from 'node:test';
import { followHeading, predictMotionToRef } from '../src/client/game/motion';
import { PHYSICS } from '../src/shared/physics';

const position = () => ({ x: 0, y: 0, z: 0 });
const rotation = () => ({ x: 0, y: 0, z: 0, w: 1 });
const state = {
  position: { x: 1, y: 3, z: 2 }, velocity: { x: 4, y: 12, z: -2 },
  angularVelocity: { x: 2, y: 0, z: 0 }, rotation: rotation(), grounded: false,
};

test('render prediction follows the same ballistic trajectory between server snapshots', () => {
  const p = position(); const q = rotation();
  predictMotionToRef(state, .1, true, p, q);
  assert.equal(p.x, 1.4); assert.equal(p.z, 1.8);
  assert.ok(Math.abs(p.y - (3 + 1.2 - .5 * PHYSICS.gravity * .01)) < 1e-9);
  assert.ok(Math.abs(q.x - Math.sin(.1)) < 1e-9);
  assert.ok(Math.abs(q.w - Math.cos(.1)) < 1e-9);
});

test('grounded and frozen robots do not visually sink, and extrapolation is bounded', () => {
  const p = position(); const q = rotation();
  predictMotionToRef({ ...state, grounded: true }, .1, true, p, q);
  assert.equal(p.y, state.position.y);
  predictMotionToRef(state, 100, false, p, q);
  assert.deepEqual(p, state.position); assert.deepEqual(q, state.rotation);
  predictMotionToRef(state, 100, true, p, q);
  assert.ok(Math.abs(p.x - (state.position.x + state.velocity.x * PHYSICS.maxPredictionSeconds)) < 1e-9);
});

test('the chase camera holds through an airborne tumble and returns by the shortest angle', () => {
  assert.equal(followHeading(.4, 2.9, false, .1), .4);
  const heading = followHeading(Math.PI - .02, -Math.PI + .02, true, .1);
  assert.ok(heading > Math.PI - .02 && heading < Math.PI + .02);
});
