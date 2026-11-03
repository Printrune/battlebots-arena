import assert from 'node:assert/strict';
import { ARENA_HAZARDS, KILLSAWS, KILLSAW_UNLOCK_SECONDS, PULVERIZERS } from '../src/shared/arena';
import { BOTS, MATCH_SECONDS, matchSnapshotSchema } from '../src/shared/protocol';
import type { MatchState } from '../src/shared/protocol';
import { createHarness, report, waitFor } from './verify-multiplayer';

// Exercise the real three-minute clock and transport. No test-only clock shortcuts.
const harness = await createHarness();
let controls: ReturnType<typeof setInterval> | undefined;
let transportFailure: Error | undefined;
const pending = new Map<number, { first: MatchState['arena'][]; second: MatchState['arena'][] }>();
let identicalSnapshots = 0;
let sawLockedUntilDeadline = true;

try {
  const first = await harness.create({ name: 'Arena check A', botId: 'witchdoctor', paint: 'signature', practice: false });
  const second = await harness.join(first.room.roomId, { name: 'Arena check B', botId: 'tombstone', paint: 'signature', practice: false });
  for (const [client, driver] of [first, second].entries()) {
    driver.room.onMessage('snapshot', (raw: unknown) => {
      try {
        const state = matchSnapshotSchema.parse(raw);
        if (state.phase.kind !== 'fighting') return;
        assert.equal(state.arena.hazards.length, ARENA_HAZARDS.length);
        // Commands can publish more than once in a tick. Preserve broadcast order.
        const queue = pending.get(state.tick) ?? { first: [], second: [] };
        (client === 0 ? queue.first : queue.second).push(state.arena);
        pending.set(state.tick, queue);
        while (queue.first.length && queue.second.length) {
          assert.deepEqual(queue.first.shift(), queue.second.shift(), 'Both clients must receive identical hazard state.');
          identicalSnapshots += 1;
        }
        if (!queue.first.length && !queue.second.length) pending.delete(state.tick);
        for (const tick of pending.keys()) if (tick < state.tick - 30) pending.delete(tick);
        if (state.arena.elapsed < KILLSAW_UNLOCK_SECONDS - 0.001) {
          sawLockedUntilDeadline &&= state.arena.hazards.every((hazard) => hazard.kind !== 'killsaw' || hazard.phase === 'locked' && hazard.extension === 0);
        }
      } catch (error) { transportFailure = error instanceof Error ? error : new Error(String(error)); }
    });
  }
  first.room.send('ready'); second.room.send('ready');
  await waitFor('three-minute arena match', () => first.snapshot?.phase.kind === 'fighting');
  assert.ok(first.snapshot?.phase.kind === 'fighting' && first.snapshot.phase.seconds > MATCH_SECONDS - 1);
  first.room.send('pulverize');
  const ownedIds = PULVERIZERS.filter((hammer) => hammer.ownerSlot === 0).map((hammer) => hammer.id);
  await waitFor('owned hammer pair to move', () => first.snapshot?.arena.hazards.filter((hazard) => hazard.kind === 'pulverizer' && hazard.phase !== 'idle').length === 2);
  assert.ok(first.snapshot?.arena.hazards.every((hazard) => hazard.kind !== 'pulverizer' || ownedIds.includes(hazard.id) || hazard.phase === 'idle'));
  report('pulverizer-command', { ownPairActivated: true, opponentPairIdle: true });

  const saw = KILLSAWS[0];
  assert.ok(saw);
  controls = setInterval(() => {
    const self = first.snapshot?.players.find((player) => player.id === first.room.sessionId);
    if (!self || first.snapshot?.phase.kind !== 'fighting') return;
    const distance = Math.hypot(saw.position.x - self.position.x, saw.position.z - self.position.z);
    const desired = Math.atan2(saw.position.x - self.position.x, saw.position.z - self.position.z);
    const angle = Math.atan2(Math.sin(desired - self.yaw), Math.cos(desired - self.yaw));
    first.sequence += 1;
    first.room.send('input', {
      seq: first.sequence, throttle: distance > 0.4 && Math.abs(angle) < 0.4 ? Math.min(0.4, distance * 0.2) : 0,
      steer: distance > 0.4 ? Math.max(-1, Math.min(1, angle * 3 / BOTS[self.botId].turnSpeed)) : 0,
      weapon: false, recover: false,
    });
  }, 1000 / 30);
  await waitFor('robot to park over a locked killsaw slot', () => {
    const self = first.snapshot?.players.find((player) => player.id === first.room.sessionId);
    return Boolean(self && Math.hypot(saw.position.x - self.position.x, saw.position.z - self.position.z) < 0.7);
  }, 20_000);
  report('waiting-for-final-minute', { unlockAtElapsed: KILLSAW_UNLOCK_SECONDS, parkedOver: saw.id });
  await waitFor('killsaw to unlock on the real server clock', () => Boolean(first.snapshot && first.snapshot.arena.elapsed >= KILLSAW_UNLOCK_SECONDS), 125_000);
  assert.ok(sawLockedUntilDeadline, 'Killsaws must remain retracted until the final minute.');
  await waitFor('a real killsaw contact event', () => Boolean(first.snapshot?.events.some((event) => event.kind === 'hazard' && event.sourceId === saw.id && event.targetId === first.room.sessionId)), 12_000);
  const health = first.snapshot?.players.find((player) => player.id === first.room.sessionId)?.health;
  assert.ok(health !== undefined && health < 100, 'Raised blades must damage a robot over the slot.');
  assert.ok(identicalSnapshots > 1500, 'Both clients must sustain the synchronized hazard stream.');
  if (transportFailure) throw transportFailure;
  assert.deepEqual(first.errors, []); assert.deepEqual(second.errors, []);

  await first.room.leave();
  await waitFor('arena forfeit', () => second.snapshot?.phase.kind === 'finished');
  report('PASS: arena transport and timing', { identicalSnapshots, sawLockedUntilDeadline, elapsed: second.snapshot?.arena.elapsed, healthAfterSaw: health });
} catch (error) {
  process.stderr.write(`${JSON.stringify({ check: 'FAIL: arena transport', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
} finally {
  if (controls) clearInterval(controls);
  await harness.close();
}
