import assert from 'node:assert/strict';
import test from 'node:test';
import { createSimulation } from '../src/server/simulation';
import type { Simulation } from '../src/server/simulation';
import { ARENA, INPUT_TIMEOUT_MS, MATCH_SECONDS, TICK_RATE, matchSnapshotSchema } from '../src/shared/protocol';
import type { PlayerInput } from '../src/shared/protocol';

const DT = 1 / TICK_RATE;

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

test('recovery is edge-triggered and arena containment survives sustained driving', async () => {
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
    assert.ok(Math.abs(player.position.z) <= ARENA.halfDepth - 1.29);
    assert.ok(Math.abs(player.position.x) <= ARENA.halfWidth - 0.99);
    assert.equal(snapshot.events.filter((event) => event.kind === 'recover').length, 1);
  } finally {
    simulation.dispose();
  }
});
