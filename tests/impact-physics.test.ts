import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { createSimulation, RobotPhysics } from '../src/server/simulation';
import { hardLandingDamage, IMPACT_TUNING, rotorEnergy, solveWeaponImpact } from '../src/server/impact-physics';
import type { ImpactBody, ImpactVector, RotorImpact } from '../src/server/impact-physics';
import { BOTS, NEUTRAL_INPUT, TICK_RATE } from '../src/shared/protocol';
import { PHYSICS } from '../src/shared/physics';

type Body = InstanceType<typeof RAPIER.RigidBody>;
const ZERO = { x: 0, y: 0, z: 0 };
const DT = 1 / PHYSICS.simulationHz;

before(async () => {
  const initialization = await createSimulation('impact-initialization');
  initialization.dispose();
});

function state(body: Body, point: ImpactVector): ImpactBody {
  const inertia = body.effectiveWorldInvInertia();
  return { center: { ...body.worldCom() }, velocity: { ...body.velocityAtPoint(point) }, inverseMass: body.invMass(),
    inverseInertia: { xx: inertia.m11, xy: inertia.m12, xz: inertia.m13, yy: inertia.m22, yz: inertia.m23, zz: inertia.m33 } };
}

function box(world: InstanceType<typeof RAPIER.World>, mass: number, position: ImpactVector): Body {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z));
  world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.4, 1).setMass(mass), body);
  return body;
}

function verticalRotor(point: ImpactVector, angularSpeed = 4500 * Math.PI / 30): RotorImpact {
  const weapon = BOTS.witchdoctor.weapon;
  return { mount: { x: 0, y: point.y, z: point.z - weapon.radius }, axis: { x: -1, y: 0, z: 0 },
    radius: weapon.radius, angularSpeed, inertiaKgFt2: weapon.inertiaKgFt2, maximumEnergyLoss: weapon.energyLossOnHit };
}

function worldWithFloor() {
  const world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 });
  world.timestep = DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(50, 0.2, 50).setTranslation(0, -0.2, 0).setFriction(0.45));
  return world;
}

function kineticEnergy(body: Body): number {
  const velocity = body.linvel();
  const angular = body.angvel();
  const inertia = body.effectiveAngularInertia();
  const angularEnergy = angular.x * (inertia.m11 * angular.x + inertia.m12 * angular.y + inertia.m13 * angular.z) +
    angular.y * (inertia.m12 * angular.x + inertia.m22 * angular.y + inertia.m23 * angular.z) +
    angular.z * (inertia.m13 * angular.x + inertia.m23 * angular.y + inertia.m33 * angular.z);
  return 0.5 * (body.mass() * (velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2) + angularEnergy);
}

test('stored rotor energy, target mass, and off-centre inertia determine the transferred impulse', () => {
  const world = new RAPIER.World(ZERO);
  try {
    const point = { x: 0, y: 2, z: 0 };
    const source = box(world, 113.4, { x: 0, y: 2, z: -3 });
    const light = box(world, 60, point);
    const heavy = box(world, 180, point);
    const solve = (body: Body, hitPoint = point) => solveWeaponImpact({ attacker: state(source, hitPoint), target: state(body, hitPoint),
      point: hitPoint, normal: { x: 0, y: 0, z: 1 }, rotor: verticalRotor(hitPoint) });
    const lightHit = solve(light);
    const heavyHit = solve(heavy);
    light.applyImpulseAtPoint(lightHit.impulse, point, true);
    heavy.applyImpulseAtPoint(heavyHit.impulse, point, true);
    assert.ok(light.linvel().y > heavy.linvel().y, 'The lighter target should gain more upward velocity.');
    assert.ok(Math.hypot(light.angvel().x, light.angvel().y, light.angvel().z) < 0.00001);
    const edge = box(world, 113.4, point);
    const edgePoint = { ...point, x: 0.9 };
    const edgeHit = solve(edge, edgePoint);
    edge.applyImpulseAtPoint(edgeHit.impulse, edgePoint, true);
    assert.ok(Math.hypot(edge.angvel().x, edge.angvel().y, edge.angvel().z) > 0.5, 'An edge hit should produce torque.');
    const stored = rotorEnergy(BOTS.witchdoctor.weapon.inertiaKgFt2, 4500 * Math.PI / 30);
    assert.ok(lightHit.energyConsumed <= stored * BOTS.witchdoctor.weapon.energyLossOnHit + 0.00001);
    assert.ok(lightHit.dissipatedJoules > 0);
  } finally { world.free(); }
});

test('high RPM delivers more energy than a stationary ram and recoil preserves linear momentum', () => {
  const world = new RAPIER.World(ZERO);
  try {
    const point = { x: 0, y: 2, z: 0 };
    const source = box(world, 113.4, { x: 0, y: 2, z: -3 });
    const target = box(world, 113.4, point);
    source.setLinvel({ x: 0, y: 0, z: 4 }, true);
    const input = { attacker: state(source, point), target: state(target, point), point, normal: { x: 0, y: 0, z: 1 } };
    const ram = solveWeaponImpact({ ...input, rotor: verticalRotor(point, 0) });
    const spinning = solveWeaponImpact({ ...input, rotor: verticalRotor(point) });
    assert.equal(ram.energyConsumed, 0);
    assert.ok(ram.damage < spinning.damage / 5);
    assert.ok(spinning.magnitude > ram.magnitude * 3);
    const before = { x: source.mass() * source.linvel().x, y: 0, z: source.mass() * source.linvel().z };
    source.applyImpulseAtPoint(spinning.recoil, point, true);
    target.applyImpulseAtPoint(spinning.impulse, point, true);
    const after = { x: source.mass() * source.linvel().x + target.mass() * target.linvel().x,
      y: source.mass() * source.linvel().y + target.mass() * target.linvel().y,
      z: source.mass() * source.linvel().z + target.mass() * target.linvel().z };
    for (const axis of ['x', 'y', 'z'] as const) assert.ok(Math.abs(before[axis] - after[axis]) < 0.001);
  } finally { world.free(); }
});

test('negative angular speed is equivalent to reversing the rotor axis', () => {
  const world = new RAPIER.World(ZERO);
  try {
    const point = { x: 0, y: 2, z: 0 };
    const source = box(world, 113.4, { x: 0, y: 2, z: -3 });
    const target = box(world, 113.4, point);
    const rotor = verticalRotor(point);
    const input = { attacker: state(source, point), target: state(target, point), point, normal: { x: 0, y: 0, z: 1 } };
    const signed = solveWeaponImpact({ ...input, rotor: { ...rotor, angularSpeed: -rotor.angularSpeed } });
    const reversed = solveWeaponImpact({ ...input, rotor: { ...rotor, axis: { x: 1, y: 0, z: 0 } } });
    assert.deepEqual(signed, reversed);
    assert.ok(signed.energyConsumed > 0 && signed.magnitude > 0);
    assert.ok(signed.impulse.y < 0);
  } finally { world.free(); }
});

test('mutual rotor contacts must solve against updated point velocities to preserve the combined energy budget', () => {
  const world = new RAPIER.World(ZERO);
  try {
    const first = box(world, 1, ZERO);
    const second = box(world, 1, ZERO);
    const point = ZERO;
    const rotor: RotorImpact = { mount: { x: 0, y: 0, z: -1 }, axis: { x: -1, y: 0, z: 0 },
      radius: 1, angularSpeed: 1, inertiaKgFt2: 100, maximumEnergyLoss: 1 };
    const solveFirst = () => solveWeaponImpact({ attacker: state(first, point), target: state(second, point), point,
      normal: { x: 0, y: 1, z: 0 }, rotor });
    const solveSecond = () => solveWeaponImpact({ attacker: state(second, point), target: state(first, point), point,
      normal: { x: 0, y: -1, z: 0 }, rotor: { ...rotor, mount: { x: 0, y: 0, z: 1 } } });
    const firstHit = solveFirst();
    const staleSecond = solveSecond();
    // This real-body fixture deliberately reproduces the old stale-snapshot
    // counterexample, where two independently valid impulses together add energy.
    const staleEnergy = (firstHit.magnitude + staleSecond.magnitude) ** 2;
    assert.ok(staleEnergy > firstHit.energyConsumed + staleSecond.energyConsumed);
    first.applyImpulseAtPoint(firstHit.recoil, point, true);
    second.applyImpulseAtPoint(firstHit.impulse, point, true);
    const updatedSecond = solveSecond();
    second.applyImpulseAtPoint(updatedSecond.recoil, point, true);
    first.applyImpulseAtPoint(updatedSecond.impulse, point, true);
    assert.ok(kineticEnergy(first) + kineticEnergy(second) <= firstHit.energyConsumed + updatedSecond.energyConsumed + 0.00001);
    assert.ok(updatedSecond.magnitude < staleSecond.magnitude);
  } finally { world.free(); }
});

test('the actual match resolves both captured spinner contacts before part damage without adding energy', async () => {
  const simulation = await createSimulation('mutual-energy');
  try {
    simulation.addPlayer('a', 'Doctor', { botId: 'witchdoctor', paint: 'signature' });
    simulation.addPlayer('b', 'Tombstone', { botId: 'tombstone', paint: 'signature' });
    simulation.setReady('a', true); simulation.setReady('b', true);
    for (let tick = 0; tick < 3 * TICK_RATE; tick += 1) simulation.step(1 / TICK_RATE, tick * 1000 / TICK_RATE);
    const first = simulation.robotPhysics('a');
    const second = simulation.robotPhysics('b');
    assert.ok(first && second);
    first.reset({ x: 0, y: 3, z: -1.5 }, 0);
    second.reset({ x: 0, y: 3, z: 1.5 }, Math.PI);
    first.weaponCharge = 0.3; second.weaponCharge = 0.3;
    const totalEnergy = () => [first, second].reduce((total, robot) => total + kineticEnergy(robot.body) + robot.storedRotorEnergy +
      robot.body.mass() * PHYSICS.gravity * robot.body.worldCom().y, 0);
    const before = totalEnergy();
    simulation.step(0.0001, 3000);
    const snapshot = simulation.snapshot();
    assert.ok(snapshot.players.every((player) => player.hits === 1 && player.health < 100));
    assert.ok(totalEnergy() <= before + 1, 'Combined body and rotor energy must not increase during mutual contact.');
    assert.equal(snapshot.debris.length, 0, 'This energy fixture must retain the same physical masses.');
  } finally { simulation.dispose(); }
});

test('the weapon solver includes existing chassis angular velocity at the actual contact point', () => {
  const world = new RAPIER.World(ZERO);
  try {
    const source = new RobotPhysics(world, BOTS.witchdoctor, { x: 0, y: 3, z: 0 }, 0);
    const target = box(world, 113.4, { x: 0, y: 3, z: 3 });
    const point = { x: 0, y: 3.2, z: 1.6 };
    const contact = { point, normal: { x: 0, y: 0, z: -1 }, tangent: { x: 0, y: 1, z: 0 }, leverage: 1, colliderHandle: 0 };
    source.weaponCharge = 0.025;
    const resting = source.solveImpact(state(target, point), contact);
    source.body.setAngvel({ x: 5, y: 0, z: 0 }, true);
    const movingPoint = source.body.velocityAtPoint(point);
    assert.ok(movingPoint.y < source.body.linvel().y - 5);
    const rotating = source.solveImpact(state(target, point), contact);
    assert.ok(rotating.magnitude < resting.magnitude);
    source.body.setAngvel(ZERO, true);
    target.setAngvel({ x: 5, y: 0, z: 0 }, true);
    const targetRotating = source.solveImpact(state(target, point), contact);
    assert.ok(targetRotating.magnitude < resting.magnitude);
  } finally { world.free(); }
});

test('unsupported robots follow Earth-gravity parabolas without airborne steering, traction, or braking', () => {
  const world = worldWithFloor();
  try {
    const neutral = new RobotPhysics(world, BOTS.witchdoctor, { x: -5, y: 4, z: 0 }, 0);
    const controlled = new RobotPhysics(world, BOTS.witchdoctor, { x: 5, y: 4, z: 0 }, 0);
    for (const robot of [neutral, controlled]) {
      robot.body.setLinvel({ x: 5, y: 10, z: -3 }, true);
      robot.body.setAngvel({ x: 0.2, y: 0.3, z: 0.4 }, true);
    }
    const initialY = neutral.body.worldCom().y;
    for (let tick = 0; tick < 30; tick += 1) {
      neutral.step(DT, NEUTRAL_INPUT);
      controlled.step(DT, { ...NEUTRAL_INPUT, throttle: -1, steer: 1 });
      world.step();
    }
    assert.equal(neutral.grounded, false);
    assert.equal(controlled.grounded, false);
    assert.ok(Math.abs(neutral.body.linvel().y - (10 - PHYSICS.gravity * 0.5)) < 0.001);
    assert.ok(Math.abs(neutral.body.worldCom().y - (initialY + 10 * 0.5 - PHYSICS.gravity * 0.5 ** 2 / 2)) < 0.05);
    assert.ok(Math.abs(neutral.body.linvel().x - 5) < 0.0001);
    assert.deepEqual({ ...controlled.body.linvel() }, { ...neutral.body.linvel() });
    assert.deepEqual({ ...controlled.body.angvel() }, { ...neutral.body.angvel() });
  } finally { world.free(); }
});

test('a full-speed real disc contact launches and tips the opponent while spending bounded stored energy', () => {
  const world = worldWithFloor();
  try {
    const source = new RobotPhysics(world, BOTS.witchdoctor, { x: 0, y: 0.49, z: 0 }, 0);
    const target = new RobotPhysics(world, BOTS.tombstone, { x: 0, y: 0.65, z: 3 }, 0);
    for (let tick = 0; tick < 60; tick += 1) { source.step(DT, NEUTRAL_INPUT); target.step(DT, NEUTRAL_INPUT); world.step(); }
    source.weaponCharge = 1;
    const contact = target.colliders.map((collider) => source.contactWith(collider)).find((value) => value !== null);
    assert.ok(contact, 'The actual disc must intersect the actual target collider.');
    const solution = source.solveImpact(state(target.body, contact.point), contact);
    const stored = source.storedRotorEnergy;
    target.body.applyImpulseAtPoint(solution.impulse, contact.point, true);
    source.body.applyImpulseAtPoint(solution.recoil, contact.point, true);
    source.consumeImpactEnergy(solution.energyConsumed);
    assert.ok(target.body.linvel().y > 6);
    assert.ok(source.weaponRpm < 4000 && source.weaponRpm > 3000);
    assert.ok(solution.energyConsumed <= stored * BOTS.witchdoctor.weapon.energyLossOnHit + 0.0001);
    const start = target.body.worldCom().y;
    let apex = start;
    let mostTipped = 1;
    for (let tick = 0; tick < 90; tick += 1) {
      source.step(DT, NEUTRAL_INPUT); target.step(DT, NEUTRAL_INPUT); world.step();
      apex = Math.max(apex, target.body.worldCom().y);
      mostTipped = Math.min(mostTipped, target.alignment);
    }
    assert.ok(apex - start > 1, `The actual launch rose only ${apex - start} feet.`);
    assert.ok(apex - start < 5, 'The cage-scale energy transfer must remain bounded.');
    assert.ok(mostTipped < 0.8, `The off-centre disc contact must tip the opponent; minimum alignment was ${mostTipped}.`);
  } finally { world.free(); }
});

test('hard-landing damage requires both a hard approach and a meaningful real contact impulse', () => {
  assert.equal(hardLandingDamage({ normalSpeed: 4, normalImpulse: 2000, mass: 113.4 }), 0);
  assert.equal(hardLandingDamage({ normalSpeed: 15, normalImpulse: 0, mass: 113.4 }), 0);
  const hard = hardLandingDamage({ normalSpeed: 15, normalImpulse: 1800, mass: 113.4 });
  assert.ok(hard > 0 && hard <= IMPACT_TUNING.maximumLandingDamage);
  assert.ok(hardLandingDamage({ normalSpeed: 20, normalImpulse: 2400, mass: 113.4 }) > hard);
});

test('actual hard floor contacts damage once, while resting support does not repeatedly damage a robot', async () => {
  const simulation = await createSimulation('landing');
  try {
    simulation.addPlayer('a', 'Doctor', { botId: 'witchdoctor', paint: 'signature' });
    simulation.addPlayer('b', 'Tombstone', { botId: 'tombstone', paint: 'signature' });
    simulation.setReady('a', true); simulation.setReady('b', true);
    let now = 0;
    const advance = (seconds: number) => {
      for (let tick = 0; tick < seconds * TICK_RATE; tick += 1) { now += 1000 / TICK_RATE; simulation.step(1 / TICK_RATE, now); }
    };
    advance(3);
    const robot = simulation.robotPhysics('a');
    assert.ok(robot);
    robot.body.setTranslation({ x: 0, y: 4, z: -10 }, true);
    robot.body.setLinvel(ZERO, true);
    advance(1.5);
    const landed = simulation.snapshot();
    assert.ok(landed.players.find((player) => player.id === 'a')?.grounded);
    const landings = landed.events.filter((event) => event.kind === 'landing' && event.targetId === 'a');
    assert.equal(landings.length, 1);
    const health = landed.players.find((player) => player.id === 'a')?.health;
    assert.ok(health !== undefined && health < 100);
    advance(2);
    assert.equal(simulation.snapshot().players.find((player) => player.id === 'a')?.health, health);
    assert.equal(simulation.snapshot().events.filter((event) => event.kind === 'landing' && event.targetId === 'a').length, 1);
  } finally { simulation.dispose(); }
});

test('a match result preserves an airborne robot’s motion until it lands while clock, hazards, and damage stay frozen', async () => {
  const simulation = await createSimulation('finished-flight');
  try {
    simulation.addPlayer('a', 'Doctor', { botId: 'witchdoctor', paint: 'signature' });
    simulation.addPlayer('b', 'Tombstone', { botId: 'tombstone', paint: 'signature' });
    simulation.setReady('a', true); simulation.setReady('b', true);
    let now = 0;
    for (let tick = 0; tick < 3 * TICK_RATE; tick += 1) { now += 1000 / TICK_RATE; simulation.step(1 / TICK_RATE, now); }
    const robot = simulation.robotPhysics('a');
    assert.ok(robot);
    robot.body.setTranslation({ x: 0, y: 4, z: -10 }, true);
    robot.body.setLinvel({ x: 2, y: 4, z: 0 }, true);
    robot.refreshSupport();
    simulation.forfeit('a');
    const result = simulation.snapshot();
    for (let tick = 0; tick < 2 * TICK_RATE; tick += 1) { now += 1000 / TICK_RATE; simulation.step(1 / TICK_RATE, now); }
    const settled = simulation.snapshot();
    assert.deepEqual(settled.phase, result.phase);
    assert.deepEqual(settled.arena, result.arena);
    assert.equal(settled.players[0]?.health, result.players[0]?.health);
    assert.ok((settled.players[0]?.position.y ?? 5) < 1);
    assert.ok(settled.players[0]?.grounded);
    assert.ok((settled.players[0]?.position.x ?? 0) > 0.5);
    assert.equal(settled.events.filter((event) => event.kind === 'landing').length, 0, 'Post-result settling cannot alter damage or events.');
  } finally { simulation.dispose(); }
});
