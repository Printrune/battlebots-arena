import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { ComponentDamage, DebrisSystem } from '../src/server/damage';
import { createSimulation, RobotPhysics } from '../src/server/simulation';
import { ArenaHazards } from '../src/server/arena-hazards';
import { KILLSAWS } from '../src/shared/arena';
import { PHYSICS } from '../src/shared/physics';
import { BOTS, NEUTRAL_INPUT, matchSnapshotSchema } from '../src/shared/protocol';
import type { BotId, PlayerInput } from '../src/shared/protocol';
import { MAX_DAMAGE_MARKS, MAX_DEBRIS, damageParts, driveCondition, partIntegrity } from '../src/shared/damage';

const DT = 1 / 60;
before(async () => { const initialized = await createSimulation('damage-initialization'); initialized.dispose(); });

function fixture(botId: BotId = 'tombstone') {
  const world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
  world.timestep = DT;
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.2, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.2, 40).setFriction(0.45), floor);
  const robot = new RobotPhysics(world, BOTS[botId], { x: 0, y: BOTS[botId].physics.wheelRadius + 0.03, z: 0 }, 0);
  return { world, robot };
}
function advance(value: ReturnType<typeof fixture>, seconds: number, input: PlayerInput = NEUTRAL_INPUT, countOut = false) {
  let knockedOut = false;
  for (let tick = 0; tick < Math.ceil(seconds * 60); tick += 1) {
    value.robot.step(DT, input); value.world.step();
    if (countOut) knockedOut = value.robot.updateImmobilization(DT);
  }
  return knockedOut;
}
function wheelContact(value: ReturnType<typeof fixture>, x: number, z: number) {
  const root = value.robot.body.translation();
  const point = { x: root.x + x, y: root.y, z: root.z + z };
  const collider = [...value.robot.colliders].sort((a, b) => {
    const first = a.translation(); const second = b.translation();
    return Math.hypot(first.x - point.x, first.y - point.y, first.z - point.z) -
      Math.hypot(second.x - point.x, second.y - point.y, second.z - point.z);
  })[0];
  assert.ok(collider);
  return { point, collider, normal: { x: Math.sign(x), y: 0, z: 0 } };
}

test('real contacted wheels take local damage, detach physically, and retain inherited wheel spin', () => {
  const value = fixture();
  const debris = new DebrisSystem(value.world);
  try {
    advance(value, 0.5, { ...NEUTRAL_INPUT, throttle: 0.7 });
    const contact = wheelContact(value, -BOTS.tombstone.physics.trackWidth / 2, BOTS.tombstone.physics.wheelZ[0] ?? 0);
    assert.equal(value.robot.damageAtContact(5, contact.point, contact.normal, contact.collider.handle), null);
    assert.ok(partIntegrity(value.robot.damage.state, 'wheel-left') < 1);
    assert.equal(partIntegrity(value.robot.damage.state, 'wheel-right'), 1);
    assert.equal(partIntegrity(value.robot.damage.state, 'armor-top'), 1);
    const fragment = value.robot.damageAtContact(35, contact.point, contact.normal, contact.collider.handle);
    assert.ok(fragment?.kind === 'wheel');
    assert.equal(fragment.partId, 'wheel-left');
    assert.equal(contact.collider.isEnabled(), false);
    assert.equal(value.robot.colliders.includes(contact.collider), false);
    assert.equal(driveCondition('tombstone', value.robot.damage.state).wheels, 1);
    assert.ok(Math.abs(fragment.angularVelocity.x) > 1);
    assert.deepEqual(fragment.rotation, { ...value.robot.body.rotation() });
    const attachedMass = BOTS.tombstone.physics.mass;
    debris.spawn('owner', 'tombstone', fragment);
    const initial = debris.snapshot()[0];
    assert.ok(initial);
    for (let tick = 0; tick < 30; tick += 1) { value.world.step(); debris.step(DT); }
    const moved = debris.snapshot()[0];
    assert.ok(moved);
    assert.notDeepEqual(moved.position, initial.position);
    assert.notDeepEqual(moved.rotation, initial.rotation);
    assert.ok(value.robot.body.mass() < attachedMass, 'The released physical wheel must stop contributing to chassis mass.');
  } finally { debris.clear(); value.world.free(); }
});

test('one lost powered side produces slower controllable limp handling', () => {
  const pristine = fixture(); const damaged = fixture();
  try {
    advance(pristine, 0.5); advance(damaged, 0.5);
    const contact = wheelContact(damaged, -BOTS.tombstone.physics.trackWidth / 2, -0.65);
    damaged.robot.damageAtContact(60, contact.point, contact.normal, contact.collider.handle);
    const damagedStart = damaged.robot.body.translation().z;
    advance(pristine, 1.5, { ...NEUTRAL_INPUT, throttle: 1 });
    advance(damaged, 1.5, { ...NEUTRAL_INPUT, throttle: 1, steer: 0.2 });
    assert.ok(damaged.robot.body.translation().z - damagedStart > 0.1, 'The surviving wheel must still move the robot.');
    assert.ok(Math.hypot(damaged.robot.body.linvel().x, damaged.robot.body.linvel().z) < Math.hypot(pristine.robot.body.linvel().x, pristine.robot.body.linvel().z));
    assert.ok(Math.abs(damaged.robot.yaw) < Math.PI, 'Limp steering must remain bounded and controllable.');
  } finally { pristine.world.free(); damaged.world.free(); }
});

test('weapon damage slows spin-up, then disables its motor while allowing stored inertia to coast', () => {
  const healthy = fixture('witchdoctor'); const damaged = fixture('witchdoctor');
  try {
    const mount = BOTS.witchdoctor.weapon.mount;
    const point = { x: mount.x, y: mount.y + damaged.robot.body.translation().y, z: mount.z };
    assert.equal(damaged.robot.damageAtContact(30, point, { x: 0, y: 0, z: 1 }, damaged.robot.weaponColliderHandle), null);
    advance(healthy, 1, { ...NEUTRAL_INPUT, weapon: true });
    advance(damaged, 1, { ...NEUTRAL_INPUT, weapon: true });
    assert.ok(damaged.robot.weaponCharge < healthy.robot.weaponCharge);
    damaged.robot.damageAtContact(30, point, { x: 0, y: 0, z: 1 }, damaged.robot.weaponColliderHandle);
    assert.equal(partIntegrity(damaged.robot.damage.state, 'weapon'), 0);
    const before = damaged.robot.weaponCharge;
    advance(damaged, 0.2, { ...NEUTRAL_INPUT, weapon: true });
    assert.ok(damaged.robot.weaponCharge > 0 && damaged.robot.weaponCharge < before);
    advance(damaged, 6, { ...NEUTRAL_INPUT, weapon: true });
    assert.equal(damaged.robot.weaponCharge, 0);
  } finally { healthy.world.free(); damaged.world.free(); }
});

test('damage marks are robot-local, bounded, persistent, and snapshot copies cannot change authority', () => {
  const damage = new ComponentDamage('witchdoctor');
  for (let index = 0; index < 50; index += 1) damage.impact('armor-left', 0.1, { x: -0.95, y: 0, z: index / 100 }, { x: -1, y: 0, z: 0 });
  assert.equal(damage.state.revision, 50);
  assert.equal(damage.state.marks.length, MAX_DAMAGE_MARKS);
  assert.equal(damage.state.marks[0]?.id, 50 - MAX_DAMAGE_MARKS + 1);
  const copy = damage.snapshot();
  const mark = copy.marks[0]; assert.ok(mark); mark.point.x = 999;
  assert.equal(damage.state.marks[0]?.point.x, -0.95);
  assert.ok(damage.state.marks.every((item) => item.partId === 'armor-left'));
});

test('translated and rotated wheel impacts store marks in owner-local coordinates', () => {
  const value = fixture();
  try {
    value.robot.body.setTranslation({ x: 5, y: 0.65, z: -3 }, true);
    value.robot.body.setRotation({ x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }, true);
    value.world.propagateModifiedBodyPositionsToColliders();
    const point = { x: 4.35, y: 0.65, z: -1.83 };
    const collider = [...value.robot.colliders].sort((a, b) => {
      const first = a.translation(); const second = b.translation();
      return Math.hypot(first.x - point.x, first.y - point.y, first.z - point.z) -
        Math.hypot(second.x - point.x, second.y - point.y, second.z - point.z);
    })[0];
    assert.ok(collider);
    value.robot.damageAtContact(5, point, { x: 0, y: 0, z: 1 }, collider.handle);
    const mark = value.robot.damage.snapshot().marks[0]; assert.ok(mark);
    assert.equal(mark.partId, 'wheel-left');
    assert.ok(Math.abs(mark.point.x + 1.17) < 0.001);
    assert.ok(Math.abs(mark.point.z + 0.65) < 0.001);
    assert.ok(mark.normal.x < -0.99);
  } finally { value.world.free(); }
});

test('real raised-saw contacts carry exact collider metadata into persistent component damage', () => {
  const value = fixture('witchdoctor');
  try {
    const saw = KILLSAWS[0]; assert.ok(saw);
    const hazards = new ArenaHazards(value.world);
    value.robot.body.setTranslation({ x: saw.position.x, y: 0.49, z: saw.position.z }, true);
    value.world.propagateModifiedBodyPositionsToColliders();
    const robots = [{ id: 'driver', slot: 0, physics: value.robot } satisfies Parameters<ArenaHazards['step']>[2][number]];
    hazards.step(DT, 120, robots); hazards.step(0.65, 120.65, robots);
    const hits = hazards.step(0.2, 120.85, robots);
    assert.ok(hits.length > 0);
    for (const hit of hits) value.robot.damageAtContact(hit.damage, hit.position, hit.normal, hit.colliderHandle);
    assert.ok(value.robot.damage.state.revision > 0);
    assert.ok(value.robot.damage.state.marks.length > 0);
    assert.ok(value.robot.damage.state.parts.some((part) => part.integrity < 1));
  } finally { value.world.free(); }
});

test('detachable armor becomes a panel while Witch Doctor ribcage stays attached', () => {
  const doctor = fixture('witchdoctor'); const tombstone = fixture();
  try {
    const root = doctor.robot.body.translation();
    assert.equal(doctor.robot.damageAtContact(60, { x: root.x, y: root.y + 0.65, z: root.z }, { x: 0, y: 1, z: 0 }), null);
    assert.equal(partIntegrity(doctor.robot.damage.state, 'armor-top'), 0);
    const other = tombstone.robot.body.translation();
    const panel = tombstone.robot.damageAtContact(50, { x: other.x, y: other.y + 0.10, z: other.z - 0.7 }, { x: 0, y: 1, z: 0 });
    assert.ok(panel?.kind === 'panel' && panel.partId === 'armor-top');
  } finally { doctor.world.free(); tombstone.world.free(); }
});

test('rigid debris capacity and lifetime are bounded and rematch restores broken wheel colliders', () => {
  const value = fixture(); const debris = new DebrisSystem(value.world);
  try {
    const contact = wheelContact(value, -BOTS.tombstone.physics.trackWidth / 2, -0.65);
    const wheel = value.robot.damageAtContact(60, contact.point, contact.normal, contact.collider.handle);
    assert.ok(wheel);
    for (let index = 0; index < MAX_DEBRIS + 4; index += 1) debris.spawn('owner', 'tombstone', wheel);
    assert.equal(debris.size, MAX_DEBRIS);
    debris.step(16.01);
    assert.equal(debris.size, 0);
    value.robot.reset({ x: 0, y: 0.65, z: 0 }, 0);
    assert.equal(contact.collider.isEnabled(), true);
    assert.equal(value.robot.colliders.includes(contact.collider), true);
    assert.ok(value.robot.damage.snapshot().parts.every((part) => part.integrity === 1));
    assert.deepEqual(value.robot.damage.snapshot().marks, []);
    assert.equal(value.robot.damage.snapshot().immobilizedFor, 0);
  } finally { debris.clear(); value.world.free(); }
});

test('count-out requires all powered wheels lost, stable ground contact, and ten seconds', () => {
  const value = fixture('witchdoctor');
  try {
    advance(value, 1, NEUTRAL_INPUT, true);
    assert.equal(value.robot.damage.state.immobilizedFor, 0);
    for (const wheel of damageParts('witchdoctor').filter((part) => part.kind === 'wheel')) {
      const left = wheel.side === 'left'; const front = wheel.id.includes('front');
      const contact = wheelContact(value, left ? -1 : 1, front ? 0.63 : -0.63);
      value.robot.damageAtContact(50, contact.point, contact.normal, contact.collider.handle);
    }
    assert.equal(driveCondition('witchdoctor', value.robot.damage.state).wheels, 0);
    value.robot.body.setTranslation({ x: 0, y: 5, z: 0 }, true);
    value.robot.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    assert.equal(value.robot.updateImmobilization(3), false);
    assert.equal(value.robot.damage.state.immobilizedFor, 0);
    advance(value, 1.5);
    value.robot.damage.immobilization(0);
    assert.equal(advance(value, 9, { ...NEUTRAL_INPUT, weapon: true }, true), false);
    assert.ok(value.robot.weaponCharge > 0.9, 'The weapon remains usable during the count-out.');
    assert.equal(advance(value, 1.1, { ...NEUTRAL_INPUT, weapon: true }, true), true);
  } finally { value.world.free(); }
});

test('combat snapshots preserve component breakage and KO wreckage settles while arena time freezes', async () => {
  const simulation = await createSimulation('persistent-damage');
  try {
    simulation.addPlayer('a', 'One', { botId: 'witchdoctor', paint: 'signature' });
    simulation.addPlayer('b', 'Two', { botId: 'tombstone', paint: 'signature' });
    simulation.setReady('a', true); simulation.setReady('b', true);
    let now = 0;
    for (let tick = 0; tick < 90; tick += 1) { now += 1_000 / 30; simulation.step(1 / 30, now); }
    for (let tick = 1; tick <= 900; tick += 1) {
      const snapshot = simulation.snapshot();
      if (snapshot.phase.kind === 'finished' || snapshot.debris.length > 0) break;
      for (const player of snapshot.players) {
        const other = snapshot.players.find((item) => item.id !== player.id); assert.ok(other);
        const desired = Math.atan2(other.position.x - player.position.x, other.position.z - player.position.z);
        const angle = Math.atan2(Math.sin(desired - player.yaw), Math.cos(desired - player.yaw));
        simulation.setInput(player.id, { seq: tick, throttle: Math.abs(angle) < 1.2 ? 0.8 : 0,
          steer: Math.max(-1, Math.min(1, angle * 2)), weapon: true, recover: tick % 120 === 0 }, now);
      }
      now += 1_000 / 30; simulation.step(1 / 30, now);
    }
    const damaged = matchSnapshotSchema.parse(simulation.snapshot());
    assert.equal(damaged.phase.kind, 'fighting', 'Component breakage should happen before hull knockout.');
    assert.ok(damaged.players.some((player) => player.damage.parts.some((part) => part.integrity === 0)), 'A meaningful component must break before hull KO.');
    assert.ok(damaged.debris.length > 0);
    simulation.forfeit('a');
    const frozen = simulation.snapshot();
    for (let tick = 0; tick < 15; tick += 1) { now += 1_000 / 30; simulation.step(1 / 30, now); }
    const settled = simulation.snapshot();
    assert.deepEqual(settled.arena, frozen.arena);
    assert.deepEqual(settled.phase, frozen.phase);
    assert.notDeepEqual(settled.debris.map((item) => item.position), frozen.debris.map((item) => item.position));
    simulation.rematch();
    assert.deepEqual(simulation.snapshot().debris, []);
    assert.ok(simulation.snapshot().players.every((player) => player.damage.parts.every((part) => part.integrity === 1) && player.damage.marks.length === 0));
  } finally { simulation.dispose(); }
});
