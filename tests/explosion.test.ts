import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulation } from '../src/server/simulation';
import type { RobotPhysics, Simulation } from '../src/server/simulation';
import { IMMOBILIZATION_SECONDS, MAX_DEBRIS, damageParts } from '../src/shared/damage';
import { BOTS, MATCH_SECONDS, TICK_RATE, matchSnapshotSchema } from '../src/shared/protocol';

const DT = 1 / TICK_RATE;

async function fixture() {
  const simulation = await createSimulation('explosion-fixture');
  simulation.addPlayer('a', 'Doctor', { botId: 'witchdoctor', paint: 'signature' });
  simulation.addPlayer('b', 'Tombstone', { botId: 'tombstone', paint: 'signature' });
  simulation.setReady('a', true); simulation.setReady('b', true);
  advance(simulation, 3);
  return simulation;
}

function advance(simulation: Simulation, seconds: number, from = 0): number {
  let now = from;
  for (let tick = 0; tick < Math.ceil(seconds * TICK_RATE); tick += 1) {
    now += DT * 1000; simulation.step(DT, now);
  }
  return now;
}

function detachWheels(robot: RobotPhysics): void {
  const center = robot.body.translation();
  for (const origin of robot.wheelPositions) {
    const point = { x: center.x + origin.x, y: center.y + origin.y, z: center.z + origin.z };
    const collider = [...robot.colliders].sort((a, b) => {
      const distance = (position: typeof point) => Math.hypot(position.x - point.x, position.y - point.y, position.z - point.z);
      return distance(a.translation()) - distance(b.translation());
    })[0];
    assert.ok(collider);
    const fragment = robot.damageAtContact(100, point, { x: Math.sign(origin.x), y: 0, z: 0 }, collider.handle);
    assert.equal(fragment?.kind, 'wheel');
  }
}

test('a counted-out loser explodes once into real debris while the winner and result remain intact', async () => {
  const simulation = await fixture();
  try {
    const robot = simulation.robotPhysics('b'); assert.ok(robot);
    detachWheels(robot);
    const winnerBefore = simulation.snapshot().players.find((player) => player.id === 'a'); assert.ok(winnerBefore);
    advance(simulation, 12);
    const exploded = matchSnapshotSchema.parse(simulation.snapshot());
    assert.deepEqual(exploded.phase, { kind: 'finished', result: { winnerId: 'a', reason: 'knockout' } });
    const events = exploded.events.filter((event) => event.kind === 'explosion');
    assert.equal(events.length, 1); assert.equal(events[0]?.targetId, 'b');
    const loser = exploded.players.find((player) => player.id === 'b'); assert.ok(loser);
    assert.equal(loser.health, 0);
    assert.ok(loser.damage.parts.every((part) => part.integrity === 0));
    assert.equal(loser.weaponRpm, 0);
    assert.ok(exploded.debris.length > 0 && exploded.debris.length <= MAX_DEBRIS);
    assert.ok(exploded.debris.every((part) => part.ownerId === 'b'));
    const winner = exploded.players.find((player) => player.id === 'a'); assert.ok(winner);
    assert.equal(winner.health, winnerBefore.health);
    assert.deepEqual(winner.damage, winnerBefore.damage);
    simulation.forfeit('a'); simulation.setConnected('b', false); simulation.setConnected('b', true);
    advance(simulation, 0.5);
    const settled = simulation.snapshot();
    assert.deepEqual(settled.phase, exploded.phase);
    assert.deepEqual(settled.events.filter((event) => event.kind === 'explosion'), events);
    assert.notDeepEqual(settled.debris.map((part) => part.position), exploded.debris.map((part) => part.position));
    assert.equal(settled.players.find((player) => player.id === 'a')?.health, winner.health);
    simulation.rematch();
    const repaired = simulation.snapshot();
    assert.equal(repaired.phase.kind, 'lobby');
    assert.deepEqual(repaired.events, []); assert.deepEqual(repaired.debris, []);
    assert.ok(repaired.players.every((player) => player.health === 100 && player.damage.parts.every((part) => part.integrity === 1)));
  } finally { simulation.dispose(); }
});

test('mutual grounded count-out explodes both robots once without exceeding the fragment cap', async () => {
  const simulation = await fixture();
  try {
    const first = simulation.robotPhysics('a'); const second = simulation.robotPhysics('b');
    assert.ok(first && second); detachWheels(first); detachWheels(second);
    advance(simulation, 2);
    assert.ok(first.grounded && second.grounded);
    first.damage.immobilization(IMMOBILIZATION_SECONDS); second.damage.immobilization(IMMOBILIZATION_SECONDS);
    advance(simulation, DT);
    const result = matchSnapshotSchema.parse(simulation.snapshot());
    assert.deepEqual(result.phase, { kind: 'finished', result: { winnerId: null, reason: 'draw' } });
    assert.deepEqual(result.events.filter((event) => event.kind === 'explosion').map((event) => event.targetId).sort(), ['a', 'b']);
    assert.ok(result.players.every((player) => player.health === 0 && player.damage.parts.every((part) => part.integrity === 0)));
    assert.ok(result.debris.length > 0 && result.debris.length <= MAX_DEBRIS);
    assert.deepEqual(new Set(result.debris.map((part) => part.ownerId)), new Set(['a', 'b']));
  } finally { simulation.dispose(); }
});

test('a timeout loser explodes after the higher-life winner has been selected', async () => {
  const simulation = await fixture();
  try {
    const robot = simulation.robotPhysics('b'); assert.ok(robot);
    robot.body.setTranslation({ x: 0, y: 4, z: 10 }, true);
    robot.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    advance(simulation, 2);
    const landed = simulation.snapshot().players.find((player) => player.id === 'b'); assert.ok(landed && landed.health < 100 && landed.health > 0);
    advance(simulation, MATCH_SECONDS);
    const result = matchSnapshotSchema.parse(simulation.snapshot());
    assert.deepEqual(result.phase, { kind: 'finished', result: { winnerId: 'a', reason: 'timeout' } });
    assert.equal(result.players.find((player) => player.id === 'a')?.health, 100);
    assert.equal(result.players.find((player) => player.id === 'b')?.health, 0);
    assert.equal(result.events.filter((event) => event.kind === 'explosion').length, 1);
    assert.equal(result.debris.length, damageParts('tombstone').filter((part) => part.detachable).length);
    assert.ok(result.debris.every((part) => part.botId === BOTS.tombstone.id));
  } finally { simulation.dispose(); }
});
