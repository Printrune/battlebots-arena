import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { createSimulation, RobotPhysics } from '../src/server/simulation';
import { BOTS, NEUTRAL_INPUT } from '../src/shared/protocol';
import type { BotId, PlayerInput } from '../src/shared/protocol';
import { PHYSICS } from '../src/shared/physics';

before(async () => {
  const initialization = await createSimulation('reverse-steering-initialization');
  initialization.dispose();
});

function drive(botId: BotId, throttle: number, steer: number) {
  const world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
  world.timestep = 1 / 60;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.2, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.2, 50).setFriction(0.45), ground);
  const robot = new RobotPhysics(world, BOTS[botId], { x: 0, y: BOTS[botId].physics.wheelRadius + 0.03, z: 0 }, 0);
  const advance = (seconds: number, input: PlayerInput) => {
    for (let tick = 0; tick < seconds * 60; tick += 1) {
      robot.step(1 / 60, input);
      world.step();
    }
  };
  try {
    advance(0.5, NEUTRAL_INPUT);
    advance(0.6, { ...NEUTRAL_INPUT, throttle, steer });
    return { yawRate: robot.body.angvel().y, position: { ...robot.body.translation() } };
  } finally {
    world.free();
  }
}

for (const botId of ['witchdoctor', 'tombstone'] satisfies BotId[]) {
  test(`${botId} reverses steering yaw while backing up, preserving forward steering and stationary pivots`, () => {
    for (const steer of [-0.55, 0.55]) {
      const forward = drive(botId, 0.65, steer);
      const reverse = drive(botId, -0.65, steer);
      const pivot = drive(botId, 0, steer);
      assert.ok(forward.yawRate * steer > 0.05, 'Forward steering follows the requested turn.');
      assert.ok(reverse.yawRate * steer < -0.05, 'Backing up reverses the chassis yaw for the same steering input.');
      assert.ok(pivot.yawRate * steer > 0.05, 'A released throttle keeps direct stationary pivot controls.');
      assert.ok(forward.position.z > 0.5 && reverse.position.z < -0.5, 'The robot really travels forward and backward.');
      assert.ok(forward.position.x * steer > 0 && reverse.position.x * steer > 0, 'Both travel arcs follow the steering side.');
    }
  });
}
