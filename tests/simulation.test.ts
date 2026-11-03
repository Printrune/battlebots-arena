import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { createSimulation, RobotPhysics } from '../src/server/simulation';
import type { Simulation } from '../src/server/simulation';
import { ARENA, BOTS, INPUT_TIMEOUT_MS, MATCH_SECONDS, NEUTRAL_INPUT, TICK_RATE, matchSnapshotSchema } from '../src/shared/protocol';
import type { BotId, PlayerInput } from '../src/shared/protocol';

const DT = 1 / TICK_RATE;

before(async () => {
  const initialization = await createSimulation('physics-initialization');
  initialization.dispose();
});

function fixture(botId: BotId) {
  const world = new RAPIER.World({ x: 0, y: -19.62, z: 0 });
  world.timestep = 1 / 60;
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.2, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.2, 50).setFriction(0.45), ground);
  const robot = new RobotPhysics(world, BOTS[botId], { x: 0, y: BOTS[botId].physics.wheelRadius + 0.03, z: 0 }, 0);
  return { world, robot };
}

function driveFixture(value: ReturnType<typeof fixture>, seconds: number, input: PlayerInput = NEUTRAL_INPUT) {
  for (let tick = 0; tick < Math.ceil(seconds * 60); tick += 1) {
    value.robot.step(1 / 60, input);
    value.world.step();
  }
}

async function twoPlayers(): Promise<Simulation> {
  const simulation = await createSimulation('test-arena');
  simulation.addPlayer('a', 'Driver A', { botId: 'witchdoctor', paint: 'signature' });
  simulation.addPlayer('b', 'Driver B', { botId: 'tombstone', paint: 'ember' });
  return simulation;
}

function advance(simulation: Simulation, seconds: number, startMs = 0): number {
  let now = startMs;
  for (let tick = 0; tick < Math.ceil(seconds * TICK_RATE); tick += 1) {
    now += DT * 1000;
    simulation.step(DT, now);
  }
  return now;
}

function startFight(simulation: Simulation): number {
  simulation.setReady('a', true);
  simulation.setReady('b', true);
  return advance(simulation, 3);
}

test('two connected ready players trigger the countdown and a valid fighting snapshot', async () => {
  const simulation = await twoPlayers();
  try {
    simulation.setReady('a', true);
    assert.equal(simulation.snapshot().phase.kind, 'lobby');
    simulation.setReady('b', true);
    assert.equal(simulation.snapshot().phase.kind, 'countdown');
    advance(simulation, 3);
    const snapshot = matchSnapshotSchema.parse(simulation.snapshot());
    assert.deepEqual(snapshot.phase, { kind: 'fighting', seconds: MATCH_SECONDS });
    assert.equal(snapshot.players.length, 2);
    assert.ok(snapshot.players.every((player) => Number.isFinite(player.position.y) && player.health === 100));
  } finally {
    simulation.dispose();
  }
});

test('out-of-order inputs cannot replace newer inputs and stale controls stop driving', async () => {
  const simulation = await twoPlayers();
  try {
    const now = startFight(simulation);
    simulation.setInput('a', { seq: 2, throttle: 1, steer: 0, weapon: false, recover: false }, now);
    simulation.setInput('a', { seq: 1, throttle: -1, steer: 0, weapon: true, recover: false }, now + 1);
    advance(simulation, 0.2, now);
    const moving = simulation.snapshot().players.find((player) => player.id === 'a');
    assert.ok(moving);
    assert.equal(moving.lastInputSeq, 2);
    assert.ok(moving.velocity.z > 1);
    advance(simulation, 1.5, now + INPUT_TIMEOUT_MS + 1);
    const stopped = simulation.snapshot().players.find((player) => player.id === 'a');
    assert.ok(stopped);
    assert.ok(Math.abs(stopped.velocity.z) < 0.05);
    assert.equal(stopped.weaponActive, false);
  } finally {
    simulation.dispose();
  }
});

test('driving into the opponent with charged weapons applies authoritative hits and impulses', async () => {
  const simulation = await twoPlayers();
  try {
    let now = startFight(simulation);
    for (let tick = 1; tick <= TICK_RATE * 3; tick += 1) {
      now += DT * 1000;
      const input: PlayerInput = { seq: tick, throttle: 1, steer: 0, weapon: true, recover: false };
      simulation.setInput('a', input, now);
      simulation.setInput('b', input, now);
      simulation.step(DT, now);
    }
    const snapshot = simulation.snapshot();
    assert.ok(snapshot.events.some((event) => event.kind === 'hit'));
    assert.ok(snapshot.players.some((player) => player.health < 100));
    assert.ok(snapshot.players.some((player) => player.damageDealt > 0 && player.hits > 0));
    matchSnapshotSchema.parse(snapshot);
  } finally {
    simulation.dispose();
  }
});

test('an untouched timed match ends as one draw and stays finished', async () => {
  const simulation = await twoPlayers();
  try {
    const now = startFight(simulation);
    advance(simulation, MATCH_SECONDS, now);
    assert.deepEqual(simulation.snapshot().phase, { kind: 'finished', result: { winnerId: null, reason: 'draw' } });
    simulation.forfeit('a');
    advance(simulation, 1, now + MATCH_SECONDS * 1000);
    assert.deepEqual(simulation.snapshot().phase, { kind: 'finished', result: { winnerId: null, reason: 'draw' } });
  } finally {
    simulation.dispose();
  }
});

test('forfeit has one winner and rematch restores the arena without stale input', async () => {
  const simulation = await twoPlayers();
  try {
    const now = startFight(simulation);
    simulation.setInput('a', { seq: 7, throttle: 1, steer: 1, weapon: true, recover: false }, now);
    advance(simulation, 0.2, now);
    simulation.setConnected('a', false);
    simulation.forfeit('a');
    assert.deepEqual(simulation.snapshot().phase, { kind: 'finished', result: { winnerId: 'b', reason: 'forfeit' } });
    simulation.setConnected('a', true);
    simulation.rematch();
    const snapshot = simulation.snapshot();
    assert.equal(snapshot.phase.kind, 'lobby');
    assert.ok(snapshot.players.every((player) => player.health === 100 && !player.ready && player.damageDealt === 0));
    assert.deepEqual(snapshot.events, []);
    const playerA = snapshot.players.find((player) => player.id === 'a');
    assert.ok(playerA);
    assert.equal(playerA.position.z, -7);
    assert.equal(playerA.lastInputSeq, 7);
    assert.equal(playerA.velocity.z, 0);
  } finally {
    simulation.dispose();
    simulation.dispose();
  }
});

test('a disconnect cancels countdown and disconnected inputs are ignored', async () => {
  const simulation = await twoPlayers();
  try {
    simulation.setReady('a', true);
    simulation.setReady('b', true);
    simulation.setConnected('b', false);
    simulation.setInput('b', { seq: 99, throttle: 1, steer: 1, weapon: true, recover: true }, 1);
    advance(simulation, 4);
    assert.equal(simulation.snapshot().phase.kind, 'lobby');
    assert.equal(simulation.snapshot().players.find((player) => player.id === 'b')?.lastInputSeq, -1);
  } finally {
    simulation.dispose();
  }
});

test('replacing the first lobby player uses the empty spawn instead of overlapping the remaining bot', async () => {
  const simulation = await twoPlayers();
  try {
    simulation.removePlayer('a');
    simulation.addPlayer('c', 'New Driver', { botId: 'witchdoctor', paint: 'glacier' });
    const snapshot = simulation.snapshot();
    assert.equal(snapshot.players.find((player) => player.id === 'b')?.position.z, 7);
    assert.equal(snapshot.players.find((player) => player.id === 'c')?.position.z, -7);
  } finally {
    simulation.dispose();
  }
});

test('upright recovery does not launch the robot and the arena contains sustained driving', async () => {
  const simulation = await twoPlayers();
  try {
    let now = startFight(simulation);
    for (let tick = 1; tick <= TICK_RATE * 10; tick += 1) {
      now += DT * 1000;
      simulation.setInput('a', { seq: tick, throttle: -1, steer: 0, weapon: false, recover: true }, now);
      simulation.step(DT, now);
    }
    const snapshot = simulation.snapshot();
    const player = snapshot.players.find((item) => item.id === 'a');
    assert.ok(player);
    assert.ok(Math.abs(player.position.z) <= ARENA.halfDepth - 0.84);
    assert.ok(Math.abs(player.position.x) <= ARENA.halfWidth - 0.84);
    assert.equal(snapshot.events.filter((event) => event.kind === 'recover').length, 0);
  } finally {
    simulation.dispose();
  }
});

test('four-wheel Witch Doctor and two-wheel Tombstone have distinct bounded acceleration and spin-up', () => {
  const doctor = fixture('witchdoctor');
  const tombstone = fixture('tombstone');
  try {
    driveFixture(doctor, 0.5);
    driveFixture(tombstone, 0.5);
    const input = { ...NEUTRAL_INPUT, throttle: 1, weapon: true };
    doctor.robot.step(1 / 60, input);
    tombstone.robot.step(1 / 60, input);
    assert.ok(doctor.robot.body.linvel().z <= BOTS.witchdoctor.physics.acceleration / 60 + 0.01);
    assert.ok(tombstone.robot.body.linvel().z <= BOTS.tombstone.physics.acceleration / 60 + 0.01);
    doctor.world.step();
    tombstone.world.step();
    driveFixture(doctor, 0.5, input);
    driveFixture(tombstone, 0.5, input);
    assert.equal(doctor.robot.wheelPositions.length, 4);
    assert.equal(tombstone.robot.wheelPositions.length, 2);
    assert.ok(doctor.robot.body.linvel().z > tombstone.robot.body.linvel().z);
    assert.ok(doctor.robot.weaponCharge > tombstone.robot.weaponCharge);
    assert.ok(doctor.robot.weaponCharge < 0.5);
  } finally { doctor.world.free(); tombstone.world.free(); }
});

test('steering applies torque without snapping away existing roll or pitch', () => {
  const value = fixture('witchdoctor');
  try {
    value.robot.body.setTranslation({ x: 0, y: 1, z: 0 }, true);
    value.robot.body.setRotation({ x: 0, y: 0, z: Math.sin(0.3), w: Math.cos(0.3) }, true);
    const rotation = { ...value.robot.body.rotation() };
    value.robot.step(1 / 60, { ...NEUTRAL_INPUT, steer: 1 });
    assert.deepEqual({ ...value.robot.body.rotation() }, rotation);
    value.world.step();
    assert.ok(Math.abs(value.robot.body.rotation().z) > 0.15);
  } finally { value.world.free(); }
});

test('Tombstone drives inverted and has no invented active self-righter', () => {
  const value = fixture('tombstone');
  try {
    value.robot.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    driveFixture(value, 0.7);
    assert.equal(value.robot.inverted, true);
    assert.equal(value.robot.step(1 / 60, { ...NEUTRAL_INPUT, recover: true }), false);
    assert.equal(value.robot.recovering, false);
    driveFixture(value, 0.8, { ...NEUTRAL_INPUT, throttle: 1 });
    assert.ok(value.robot.body.linvel().z > 0.5);
    assert.equal(value.robot.inverted, true);
  } finally { value.world.free(); }
});

test('Witch Doctor self-rights through torque over time rather than teleporting upright', () => {
  const value = fixture('witchdoctor');
  try {
    value.robot.body.setTranslation({ x: 0, y: 1.05, z: 0 }, true);
    value.robot.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    driveFixture(value, 1.2);
    assert.equal(value.robot.inverted, true);
    const rotation = { ...value.robot.body.rotation() };
    const position = { ...value.robot.body.translation() };
    assert.equal(value.robot.step(1 / 60, { ...NEUTRAL_INPUT, recover: true }), true);
    assert.deepEqual({ ...value.robot.body.rotation() }, rotation);
    assert.deepEqual({ ...value.robot.body.translation() }, position);
    assert.equal(value.robot.recovering, true);
    assert.ok(value.robot.recoveryCooldown > 4);
    driveFixture(value, 1.6, { ...NEUTRAL_INPUT, recover: true });
    assert.ok(value.robot.alignment > 0.5, `Self-righting finished at alignment ${value.robot.alignment}.`);
    assert.equal(value.robot.step(1 / 60, { ...NEUTRAL_INPUT, recover: true }), false);
  } finally { value.world.free(); }
});

test('Witch Doctor retains limited upside-down driving on its rear tires and ears', () => {
  const value = fixture('witchdoctor');
  try {
    value.robot.body.setTranslation({ x: 0, y: 1.05, z: 0 }, true);
    value.robot.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    driveFixture(value, 1.2);
    const start = value.robot.body.translation().z;
    driveFixture(value, 1, { ...NEUTRAL_INPUT, throttle: 1 });
    assert.equal(value.robot.inverted, true);
    assert.ok(value.robot.body.translation().z - start > 0.15, 'Rear tires should provide limited inverted motion.');
    assert.ok(value.robot.body.linvel().z < BOTS.witchdoctor.speed * 0.7);
  } finally { value.world.free(); }
});

test('spinner inertia coasts after power is cut and full-speed Witch Doctor turns more slowly', () => {
  const stopped = fixture('witchdoctor');
  const spinning = fixture('witchdoctor');
  try {
    driveFixture(stopped, 0.5);
    driveFixture(spinning, 2.2, { ...NEUTRAL_INPUT, weapon: true });
    assert.ok(spinning.robot.weaponCharge > 0.99);
    driveFixture(stopped, 0.7, { ...NEUTRAL_INPUT, steer: 1 });
    driveFixture(spinning, 0.7, { ...NEUTRAL_INPUT, steer: 1, weapon: true });
    assert.ok(Math.abs(spinning.robot.yaw) < Math.abs(stopped.robot.yaw));
    driveFixture(spinning, 1);
    assert.ok(spinning.robot.weaponRpm > 0, 'A heavy unpowered spinner must coast instead of stopping instantly.');
    driveFixture(spinning, 6);
    assert.equal(spinning.robot.weaponRpm, 0);
  } finally { stopped.world.free(); spinning.world.free(); }
});

test('weapon contacts use the actual swept disc and bar volumes instead of a distance cone', () => {
  const value = fixture('witchdoctor');
  try {
    const target = new RobotPhysics(value.world, BOTS.tombstone, { x: 2.5, y: 0.65, z: 1 }, 0);
    value.world.step();
    assert.ok(target.colliders.every((collider) => value.robot.contactWith(collider) === null));
    target.body.setTranslation({ x: 0, y: 0.65, z: -3 }, true);
    value.world.step();
    assert.ok(target.colliders.every((collider) => value.robot.contactWith(collider) === null));
    target.body.setTranslation({ x: 0, y: 0.65, z: 3 }, true);
    value.world.step();
    const contact = target.colliders.map((collider) => value.robot.contactWith(collider)).find((item) => item !== null);
    assert.ok(contact);
    assert.ok(contact.tangent.y > 0, 'The upright vertical drisc should bite upward at its front.');
    value.robot.weaponCharge = 1;
    const before = value.robot.weaponRpm;
    value.robot.spendWeaponEnergy(contact.leverage);
    assert.ok(value.robot.weaponRpm < before);
    assert.ok(value.robot.weaponCharge > 0);
    assert.ok(value.robot.weaponCooldown > 0);
  } finally { value.world.free(); }
});

test('Tombstone horizontal spinner transfers a sideways cutting direction', () => {
  const value = fixture('tombstone');
  try {
    const target = new RobotPhysics(value.world, BOTS.witchdoctor, { x: 0, y: 0.49, z: 4 }, 0);
    value.world.step();
    const contact = target.colliders.map((collider) => value.robot.contactWith(collider)).find((item) => item !== null);
    assert.ok(contact);
    assert.ok(Math.abs(contact.tangent.x) > 0.5);
    assert.ok(Math.abs(contact.tangent.y) < 0.1);
  } finally { value.world.free(); }
});

test('broadphase rejects distant robots while retaining the full long-bar contact range', () => {
  const value = fixture('tombstone');
  try {
    const target = new RobotPhysics(value.world, BOTS.witchdoctor, { x: 20, y: 0.49, z: 0 }, 0);
    assert.equal(value.robot.couldContact(target), false);
    target.reset({ x: 0, y: 0.49, z: 4.3 }, 0);
    value.world.propagateModifiedBodyPositionsToColliders();
    assert.equal(value.robot.couldContact(target), true);
    assert.ok(target.colliders.some((collider) => value.robot.contactWith(collider) !== null));
    assert.ok(value.robot.boundingRadius > BOTS.tombstone.weapon.radius + BOTS.tombstone.weapon.mount.z);
  } finally { value.world.free(); }
});

test('swept weapon bounds include prior travel and a tilted rotor while clearing the normal floor', () => {
  const value = fixture('tombstone');
  try {
    const standing = value.robot.weaponSweepBounds;
    assert.ok(standing.min.y > 0);
    assert.ok(standing.max.z >= BOTS.tombstone.weapon.mount.z + BOTS.tombstone.weapon.radius);
    value.robot.step(1 / 60, NEUTRAL_INPUT);
    value.robot.body.setTranslation({ x: 12, y: 0.65, z: 0 }, true);
    value.robot.body.setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }, true);
    const moved = value.robot.weaponSweepBounds;
    assert.ok(moved.min.x <= -BOTS.tombstone.weapon.radius);
    assert.ok(moved.max.x > ARENA.halfWidth);
    assert.ok(moved.min.y < 0);
  } finally { value.world.free(); }
});

test('a spinning weapon hitting an arena wall spends energy and emits an arena contact', async () => {
  const simulation = await twoPlayers();
  try {
    let now = startFight(simulation);
    for (let tick = 1; tick <= TICK_RATE * 14; tick += 1) {
      now += DT * 1000;
      const player = simulation.snapshot().players.find((item) => item.id === 'b');
      assert.ok(player);
      const angle = Math.atan2(Math.sin(Math.PI / 2 - player.yaw), Math.cos(Math.PI / 2 - player.yaw));
      simulation.setInput('b', { seq: tick, throttle: Math.abs(angle) < 0.3 ? 0.85 : 0,
        steer: Math.max(-1, Math.min(1, angle * 2)), weapon: true, recover: false }, now);
      simulation.step(DT, now);
    }
    assert.ok(simulation.snapshot().events.some((event) => event.targetId === 'arena'), JSON.stringify(simulation.snapshot()));
  } finally { simulation.dispose(); }
});
