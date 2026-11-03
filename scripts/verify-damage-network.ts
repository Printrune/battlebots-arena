import assert from 'node:assert/strict';
import { BOTS } from '../src/shared/protocol';
import type { PlayerSnapshot } from '../src/shared/protocol';
import { partIntegrity } from '../src/shared/damage';
import { createHarness, report, waitFor } from './verify-multiplayer';

function wheelTarget(player: PlayerSnapshot): PlayerSnapshot['position'] {
  const rotation = player.rotation;
  const x = -BOTS.tombstone.physics.trackWidth / 2; const z = BOTS.tombstone.physics.wheelZ[0] ?? 0;
  const tx = 2 * rotation.y * z; const ty = 2 * (rotation.z * x - rotation.x * z); const tz = -2 * rotation.y * x;
  return { x: player.position.x + x + rotation.w * tx + rotation.y * tz - rotation.z * ty,
    y: player.position.y + rotation.w * ty + rotation.z * tx - rotation.x * tz,
    z: player.position.z + z + rotation.w * tz + rotation.x * ty - rotation.y * tx };
}

const harness = await createHarness();
let controls: ReturnType<typeof setInterval> | undefined;
try {
  const attacker = await harness.create({ name: 'Damage check A', botId: 'witchdoctor', paint: 'signature', practice: false });
  const defender = await harness.join(attacker.room.roomId, { name: 'Damage check B', botId: 'tombstone', paint: 'signature', practice: false });
  attacker.room.send('ready'); defender.room.send('ready');
  await waitFor('damage check fight', () => attacker.snapshot?.phase.kind === 'fighting');
  let approach = true;
  controls = setInterval(() => {
    const self = attacker.snapshot?.players.find((player) => player.id === attacker.room.sessionId);
    const target = attacker.snapshot?.players.find((player) => player.id === defender.room.sessionId);
    if (!self || !target || attacker.snapshot?.phase.kind !== 'fighting') return;
    if (approach && Math.hypot(self.position.x - 5, self.position.z - 12) < 0.9) approach = false;
    const point = approach ? { x: 5, z: 12 } : wheelTarget(target);
    const desired = Math.atan2(point.x - self.position.x, point.z - self.position.z);
    const angle = Math.atan2(Math.sin(desired - self.yaw), Math.cos(desired - self.yaw));
    const distance = Math.hypot(point.x - self.position.x, point.z - self.position.z);
    attacker.room.send('input', { seq: ++attacker.sequence,
      throttle: Math.abs(angle) > 0.7 ? 0 : approach ? 0.65 : distance > 2 ? 0.5 : 0.22,
      steer: Math.max(-1, Math.min(1, angle * 3 / BOTS.witchdoctor.turnSpeed)), weapon: !approach, recover: false });
  }, 1000 / 30);
  await waitFor('a real wheel strike and detachment', () => Boolean(attacker.snapshot?.players.some((player) => player.id === defender.room.sessionId && partIntegrity(player.damage, 'wheel-left') === 0)), 90_000);
  clearInterval(controls); controls = undefined;
  attacker.room.send('input', { seq: ++attacker.sequence, throttle: -0.5, steer: 0, weapon: false, recover: false });
  await waitFor('both clients to see the detached wheel', () => Boolean(defender.snapshot?.players.some((player) => player.id === defender.room.sessionId && partIntegrity(player.damage, 'wheel-left') === 0)));
  const detached = attacker.snapshot?.debris.find((part) => part.ownerId === defender.room.sessionId && part.partId === 'wheel-left');
  assert.ok(detached, 'A broken wheel must become authoritative rigid debris.');
  assert.ok(defender.snapshot?.debris.some((part) => part.id === detached.id));
  const damaged = defender.snapshot?.players.find((player) => player.id === defender.room.sessionId);
  assert.ok(damaged && damaged.health > 0 && damaged.damage.marks.length > 0, 'Wheel loss should be a playable damaged state before hull knockout.');
  report('wheel-detachment', { health: damaged.health, damageRevision: damaged.damage.revision, debrisId: detached.id, visibleMarks: damaged.damage.marks.length });

  const seat = defender.room.sessionId;
  defender.room.connection.close(1001, 'Damage reconnect verification');
  await waitFor('damaged robot reconnect', () => defender.drops > 0 && defender.reconnects > 0 && defender.connected);
  assert.equal(defender.room.sessionId, seat);
  await waitFor('persistent wheel loss after reconnect', () => Boolean(defender.snapshot?.players.some((player) => player.id === seat && partIntegrity(player.damage, 'wheel-left') === 0)));
  await attacker.room.leave();
  await waitFor('damage test forfeit', () => defender.snapshot?.phase.kind === 'finished');
  defender.room.send('rematch');
  await waitFor('rematch repaired robot', () => defender.snapshot?.phase.kind === 'lobby');
  assert.ok(defender.snapshot?.players.every((player) => player.health === 100 && player.damage.parts.every((part) => part.integrity === 1) && player.damage.marks.length === 0 && player.damage.immobilizedFor === 0));
  assert.equal(defender.snapshot?.debris.length, 0);
  assert.deepEqual(attacker.errors, []); assert.deepEqual(defender.errors, []);
  report('PASS: component damage transport', { sameSeatAfterReconnect: true, persistentDamage: true, rematchRepaired: true });
} catch (error) {
  process.stderr.write(`${JSON.stringify({ check: 'FAIL: component damage transport', error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
} finally {
  if (controls) clearInterval(controls);
  await harness.close();
}
