import assert from 'node:assert/strict';
import test from 'node:test';
import { createPracticeRuntime, LOCAL_PLAYER_ID } from '../src/client/practice-runtime';
import { practiceCommandSchema, practiceResponseSchema } from '../src/client/practice-messages';
import { NEUTRAL_INPUT, TICK_RATE } from '../src/shared/protocol';
import type { MatchState } from '../src/shared/protocol';

test('worker timer and XR-input wakes consume one bounded physics clock', async () => {
  const updates: MatchState[] = [];
  const runtime = await createPracticeRuntime({ name: 'Local', botId: 'witchdoctor', paint: 'signature', practice: true }, 'clock-proof', 1000,
    (snapshot) => updates.push(snapshot));
  try {
    runtime.publish();
    assert.equal(updates.length, 1);
    const initial = runtime.snapshot().tick;
    runtime.advance(1100);
    assert.equal(runtime.snapshot().tick, initial + 3);
    runtime.command({ kind: 'input', input: { ...NEUTRAL_INPUT, seq: 1, throttle: 1 } }, 1100);
    runtime.advance(1100);
    assert.equal(runtime.snapshot().tick, initial + 3, 'The same timestamp cannot be simulated twice by input and timer wakes.');
    runtime.advance(11_000);
    assert.equal(runtime.snapshot().tick, initial + 8, 'A background pause has at most five catch-up steps.');
    runtime.advance(11_000);
    assert.equal(runtime.snapshot().tick, initial + 8);
    assert.ok(updates.every((snapshot) => practiceResponseSchema.safeParse({ kind: 'snapshot', snapshot, localId: LOCAL_PLAYER_ID }).success));
    runtime.dispose(); runtime.advance(12_000); runtime.publish();
    assert.equal(updates.length, 5, 'Disposed physics stops publishing.');
  } finally { runtime.dispose(); }
});

test('static practice runs real countdown, combat, defeat explosion and repaired rematch without a server', async () => {
  let latest: MatchState | null = null;
  const runtime = await createPracticeRuntime({ name: 'Local', botId: 'witchdoctor', paint: 'glacier', practice: true }, 'combat-proof', 0,
    (snapshot) => { latest = snapshot; });
  let now = 0;
  const tick = () => { now += 1000 / TICK_RATE; runtime.advance(now); };
  try {
    runtime.command({ kind: 'ready' }, now);
    assert.equal(runtime.snapshot().phase.kind, 'countdown');
    for (let index = 0; index < 91; index += 1) tick();
    assert.equal(runtime.snapshot().phase.kind, 'fighting');
    const beginning = runtime.snapshot().players.find((player) => player.id === 'practice-bot');
    assert.ok(beginning);
    for (let index = 0; index < 60 * TICK_RATE && runtime.snapshot().phase.kind !== 'finished'; index += 1) tick();
    const finished = runtime.snapshot();
    assert.equal(finished.phase.kind, 'finished');
    assert.ok(finished.events.some((event) => event.kind === 'explosion'));
    assert.ok(finished.players.some((player) => player.damageDealt > 0));
    assert.ok(finished.players.find((player) => player.id === 'practice-bot')?.weaponRpm !== beginning.weaponRpm);
    assert.ok(latest);
    runtime.command({ kind: 'rematch' }, now);
    const repaired = runtime.snapshot();
    assert.equal(repaired.phase.kind, 'countdown');
    assert.equal(repaired.debris.length, 0);
    assert.equal(repaired.events.length, 0);
    assert.ok(repaired.players.every((player) => player.health === 100 && player.damage.parts.every((part) => part.integrity === 1)));
    runtime.command({ kind: 'stop' }, now);
  } finally { runtime.dispose(); }
});

test('practice worker commands reject invalid controls at the message boundary', () => {
  assert.equal(practiceCommandSchema.safeParse({ kind: 'input', input: { ...NEUTRAL_INPUT, throttle: 2 } }).success, false);
  assert.equal(practiceCommandSchema.safeParse({ kind: 'input', input: { ...NEUTRAL_INPUT, steer: NaN } }).success, false);
  assert.equal(practiceCommandSchema.safeParse({ kind: 'unknown' }).success, false);
  assert.equal(practiceCommandSchema.safeParse({ kind: 'ready' }).success, true);
});
