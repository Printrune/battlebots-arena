import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { ArenaHazards } from '../src/server/arena-hazards';
import type { HazardRobot } from '../src/server/arena-hazards';
import { createSimulation, RobotPhysics } from '../src/server/simulation';
import { ARENA_LAYOUT, KILLSAWS, PULVERIZERS, SCREWS, arenaStateSchema, pulverizerHead } from '../src/shared/arena';
import { BOTS, NEUTRAL_INPUT } from '../src/shared/protocol';
import { PHYSICS } from '../src/shared/physics';

const DT = 1 / 60;

before(async () => { const initialized = await createSimulation('hazard-initialization'); initialized.dispose(); });

function fixture(position = { x: 0, y: 0.49, z: 0 }) {
  const world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
  world.timestep = DT;
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.2, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(25, 0.2, 25).setFriction(0.45), floor);
  const hazards = new ArenaHazards(world);
  const physics = new RobotPhysics(world, BOTS.witchdoctor, position, 0);
  const robot: HazardRobot = { id: 'fixture-robot', slot: 0, physics };
  world.propagateModifiedBodyPositionsToColliders();
  return { world, hazards, robot, robots: [robot] };
}

test('killsaws unlock at120seconds, warn before rising, and damage only actual raised-blade contacts', () => {
  const saw = KILLSAWS[0];
  assert.ok(saw);
  const value = fixture({ x: saw.position.x, y: 0.49, z: saw.position.z });
  try {
    assert.deepEqual(value.hazards.step(DT, 119.99, value.robots), []);
    assert.equal(value.hazards.snapshot().hazards.find((state) => state.id === saw.id)?.kind, 'killsaw');
    assert.ok(value.hazards.snapshot().hazards.every((state) => state.kind !== 'killsaw' || state.phase === 'locked'));
    assert.deepEqual(value.hazards.step(DT, 120, value.robots), []);
    let state = value.hazards.snapshot().hazards.find((item) => item.id === saw.id);
    assert.ok(state?.kind === 'killsaw' && state.phase === 'warning' && state.extension === 0);
    assert.deepEqual(value.hazards.step(0.64, 120.64, value.robots), []);
    assert.deepEqual(value.hazards.step(0.01, 120.65, value.robots), []);
    state = value.hazards.snapshot().hazards.find((item) => item.id === saw.id);
    assert.ok(state?.kind === 'killsaw' && state.phase === 'cutting' && state.extension === 0);
    const hits = value.hazards.step(0.14, 120.79, value.robots);
    assert.ok(hits.some((hit) => hit.hazardId === saw.id && hit.damage > 0));
    assert.ok(value.robot.physics.body.linvel().y > 0);
    assert.deepEqual(value.hazards.step(DT, 120.8, value.robots), []);
    arenaStateSchema.parse(value.hazards.snapshot());
  } finally { value.world.free(); }
});

test('a raised killsaw cannot damage a robot flying above its physical blade', () => {
  const saw = KILLSAWS[0];
  assert.ok(saw);
  const value = fixture({ x: saw.position.x, y: 0.49, z: saw.position.z });
  try {
    value.hazards.step(DT, 120, value.robots);
    value.robot.physics.body.setTranslation({ x: saw.position.x, y: 5, z: saw.position.z }, true);
    value.world.propagateModifiedBodyPositionsToColliders();
    value.hazards.step(0.65, 120.65, value.robots);
    assert.deepEqual(value.hazards.step(0.2, 120.85, value.robots), []);
  } finally { value.world.free(); }
});

test('pulverizers obey team ownership and remain on cooldown after their strike', () => {
  const value = fixture();
  try {
    assert.equal(value.hazards.trigger(0), true);
    assert.equal(value.hazards.trigger(0), false);
    for (const definition of PULVERIZERS) {
      const state = value.hazards.snapshot().hazards.find((item) => item.id === definition.id);
      assert.ok(state?.kind === 'pulverizer');
      assert.equal(state.phase, definition.ownerSlot === 0 ? 'windup' : 'idle');
    }
    value.hazards.step(1.5, 1.5, value.robots);
    assert.equal(value.hazards.trigger(0), false);
    value.hazards.step(2.1, 3.6, value.robots);
    assert.equal(value.hazards.trigger(0), true);
    assert.equal(value.hazards.trigger(1), true);
  } finally { value.world.free(); }
});

test('a pulverizer strike damages a touching robot once and misses an elevated robot', () => {
  const hammer = PULVERIZERS[0];
  assert.ok(hammer);
  const head = pulverizerHead(hammer, 1.22);
  const value = fixture({ x: head.x, y: 0.49, z: head.z });
  try {
    value.hazards.trigger(hammer.ownerSlot);
    const hits = [];
    for (let tick = 1; tick <= 50; tick += 1) hits.push(...value.hazards.step(DT, tick * DT, value.robots));
    assert.equal(hits.filter((hit) => hit.hazardId === hammer.id).length, 1);
    assert.ok(value.robot.physics.body.linvel().y < 0);
    value.hazards.reset();
    value.robot.physics.body.setTranslation({ x: head.x, y: 8, z: head.z }, true);
    value.world.propagateModifiedBodyPositionsToColliders();
    value.hazards.trigger(hammer.ownerSlot);
    for (let tick = 1; tick <= 50; tick += 1) assert.deepEqual(value.hazards.step(DT, tick * DT, value.robots), []);
  } finally { value.world.free(); }
});

test('screws require real contact, lift the robot, and reverse to release a persistent jam', () => {
  const screw = SCREWS[0];
  assert.ok(screw);
  const value = fixture({ x: screw.position.x, y: 0.49, z: screw.position.z + 0.45 });
  try {
    const hits = value.hazards.step(DT, DT, value.robots);
    assert.ok(hits.some((hit) => hit.hazardId === screw.id));
    assert.ok(value.robot.physics.body.linvel().y > 0.5);
    value.robot.physics.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    value.robot.physics.body.setEnabledTranslations(false, false, false, true);
    value.robot.physics.body.setEnabledRotations(false, false, false, true);
    for (let tick = 2; tick <= 80; tick += 1) value.hazards.step(DT, tick * DT, value.robots);
    let state = value.hazards.snapshot().hazards.find((item) => item.id === screw.id);
    assert.ok(state?.kind === 'screw' && state.direction === -1);
    value.robot.physics.body.setTranslation({ x: 0, y: 5, z: 0 }, true);
    value.world.propagateModifiedBodyPositionsToColliders();
    assert.deepEqual(value.hazards.step(DT, 3, value.robots), []);
    state = value.hazards.snapshot().hazards.find((item) => item.id === screw.id);
    assert.ok(state?.kind === 'screw' && state.direction === 1);
  } finally { value.world.free(); }
});

test('the Upper Deck is a real half-unit platform with usable tire traction', () => {
  const value = fixture({ x: ARENA_LAYOUT.upperDeck.x, y: 3, z: ARENA_LAYOUT.upperDeck.z });
  try {
    for (let tick = 1; tick <= 120; tick += 1) {
      value.robot.physics.step(DT, NEUTRAL_INPUT);
      value.world.step();
    }
    const supported = value.robot.physics.body.translation();
    assert.ok(Math.abs(supported.y - (ARENA_LAYOUT.upperDeck.height + BOTS.witchdoctor.physics.wheelRadius)) < 0.06);
    for (let tick = 0; tick < 20; tick += 1) {
      value.robot.physics.step(DT, { ...NEUTRAL_INPUT, throttle: 1 });
      value.world.step();
    }
    assert.ok(value.robot.physics.body.linvel().z > 0.5);
  } finally { value.world.free(); }
});

test('deck screws physically launch a contacting robot up toward the Upper Deck', () => {
  const value = fixture({ x: -4, y: 0.49, z: 14.25 });
  try {
    let highest = value.robot.physics.body.translation().y;
    let deckHits = 0;
    for (let tick = 1; tick <= 100; tick += 1) {
      value.robot.physics.step(DT, { ...NEUTRAL_INPUT, throttle: 0.6 });
      value.world.step();
      deckHits += value.hazards.step(DT, tick * DT, value.robots).filter((hit) => hit.hazardId.startsWith('screw-deck-')).length;
      highest = Math.max(highest, value.robot.physics.body.translation().y);
    }
    assert.ok(deckHits > 0);
    assert.ok(highest > ARENA_LAYOUT.upperDeck.height + BOTS.witchdoctor.physics.wheelRadius, `Maximum axle height was ${highest}.`);
    assert.ok(value.robot.physics.body.translation().z > 16, JSON.stringify(value.robot.physics.body.translation()));
  } finally { value.world.free(); }
});

test('match hazard clocks freeze outside combat and rematch restores every hazard', async () => {
  const simulation = await createSimulation('hazard-lifecycle');
  try {
    simulation.addPlayer('a', 'One', { botId: 'witchdoctor', paint: 'signature' });
    simulation.addPlayer('b', 'Two', { botId: 'tombstone', paint: 'signature' });
    assert.equal(simulation.pulverize('a'), false);
    simulation.setReady('a', true); simulation.setReady('b', true);
    for (let tick = 0; tick < 90; tick += 1) simulation.step(1 / 30, tick * 1_000 / 30);
    assert.equal(simulation.snapshot().arena.elapsed, 0);
    assert.equal(simulation.pulverize('unknown'), false);
    assert.equal(simulation.pulverize('a'), true);
    for (let tick = 90; tick < 105; tick += 1) simulation.step(1 / 30, tick * 1_000 / 30);
    assert.ok(simulation.snapshot().arena.elapsed > 0);
    simulation.forfeit('a');
    const frozen = simulation.snapshot().arena;
    for (let tick = 105; tick < 180; tick += 1) simulation.step(1 / 30, tick * 1_000 / 30);
    assert.deepEqual(simulation.snapshot().arena, frozen);
    assert.equal(simulation.pulverize('b'), false);
    simulation.rematch();
    const reset = simulation.snapshot();
    assert.equal(reset.arena.elapsed, 0);
    assert.ok(reset.arena.hazards.every((state) => state.kind === 'screw' ? !state.active && state.angle === 0
      : state.kind === 'pulverizer' ? state.phase === 'idle' && state.cooldown === 0 : state.phase === 'locked' && state.extension === 0));
    assert.equal(reset.players[0]?.position.z, -ARENA_LAYOUT.spawnZ);
  } finally { simulation.dispose(); }
});
