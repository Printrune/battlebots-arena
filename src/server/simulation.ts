import RAPIER from '@dimforge/rapier3d-compat';
import {
  ARENA, BOTS, COUNTDOWN_SECONDS, INPUT_TIMEOUT_MS, MATCH_SECONDS, NEUTRAL_INPUT,
} from '../shared/protocol';
import type {
  BotDefinition, CosmeticSelection, MatchEvent, MatchPhase, MatchResult, MatchState,
  PlayerInput, PlayerSnapshot,
} from '../shared/protocol';
import { ArenaHazards } from './arena-hazards';
import type { HazardHit, HazardRobot } from './arena-hazards';
import { damagedDriveTuning, damageParts, driveCondition, partIntegrity, wheelPartId, IMMOBILIZATION_SECONDS } from '../shared/damage';
import type { DamagePartId } from '../shared/damage';
import { ComponentDamage, DebrisSystem } from './damage';
import type { DetachedFragment } from './damage';
import { PHYSICS } from '../shared/physics';
import { steeringForDrive } from '../shared/driving';
import { hardLandingDamage, IMPACT_TUNING, rotorEnergy, solveWeaponImpact } from './impact-physics';
import type { ImpactBody, ImpactSolution } from './impact-physics';

type Body = InstanceType<typeof RAPIER.RigidBody>;
type Collider = InstanceType<typeof RAPIER.Collider>;
type Vector = PlayerSnapshot['position'];
type Quaternion = PlayerSnapshot['rotation'];
interface Bounds { min: Vector; max: Vector }
type ArenaBoundary = 'floor' | 'ceiling' | 'west' | 'east' | 'north' | 'south';
const GRAVITY = PHYSICS.gravity;
const RECOVERY_SECONDS = 1.35;
const IDENTITY: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
const ZERO: Vector = { x: 0, y: 0, z: 0 };
const AXLE_ROTATION: Quaternion = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };

interface Participant {
  id: string;
  spawnSlot: 0 | 1;
  name: string;
  selection: CosmeticSelection;
  physics: RobotPhysics;
  health: number;
  ready: boolean;
  connected: boolean;
  input: PlayerInput;
  inputAt: number;
  lastInputSeq: number;
  damageDealt: number;
  hits: number;
}

export interface WeaponContact {
  point: Vector;
  normal: Vector;
  tangent: Vector;
  leverage: number;
  colliderHandle: number;
}

interface PendingHit {
  attacker: Participant;
  target: Participant;
  contact: WeaponContact;
}
interface ResolvedHit extends PendingHit {
  solution: ImpactSolution;
}

let initialization: Promise<void> | undefined;
function initializePhysics(): Promise<void> {
  initialization ??= RAPIER.init();
  return initialization;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
function add(a: Vector, b: Vector): Vector { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function subtract(a: Vector, b: Vector): Vector { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(vector: Vector, value: number): Vector { return { x: vector.x * value, y: vector.y * value, z: vector.z * value }; }
function dot(a: Vector, b: Vector): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function magnitude(vector: Vector): number { return Math.hypot(vector.x, vector.y, vector.z); }
function normalize(vector: Vector, fallback: Vector = { x: 0, y: 0, z: 1 }): Vector {
  const length = magnitude(vector);
  return length > 0.0001 ? scale(vector, 1 / length) : { ...fallback };
}
function cross(a: Vector, b: Vector): Vector {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function rotate(rotation: Quaternion, vector: Vector): Vector {
  const q = { x: rotation.x, y: rotation.y, z: rotation.z };
  const twice = scale(cross(q, vector), 2);
  return add(vector, add(scale(twice, rotation.w), cross(q, twice)));
}
function multiply(a: Quaternion, b: Quaternion): Quaternion {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
function uprightRotation(yaw: number): Quaternion {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function impactBody(body: Body, point: Vector): ImpactBody {
  const inertia = body.effectiveWorldInvInertia();
  return { center: { ...body.worldCom() }, velocity: { ...body.velocityAtPoint(point) }, inverseMass: body.invMass(),
    inverseInertia: { xx: inertia.m11, xy: inertia.m12, xz: inertia.m13, yy: inertia.m22, yz: inertia.m23, zz: inertia.m33 } };
}
const STATIC_IMPACT_BODY: ImpactBody = { center: ZERO, velocity: ZERO, inverseMass: 0,
  inverseInertia: { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 } };

/** Physical robot assembly shared by matches and real-Rapier verification fixtures. */
export class RobotPhysics {
  readonly body: Body;
  readonly colliders: Collider[] = [];
  readonly wheelPositions: Vector[] = [];
  readonly boundingRadius: number;
  readonly damage: ComponentDamage;
  private readonly componentColliders = new Map<number, DamagePartId>();
  private readonly allColliders: Collider[] = [];
  private readonly wheels: { id: DamagePartId; collider: Collider; position: Vector; supported: boolean }[] = [];
  private readonly physicsWorld: InstanceType<typeof RAPIER.World>;
  private supported = false;
  private previousVelocity: Vector = ZERO;
  private previousAngularVelocity: Vector = ZERO;
  private previousCom: Vector = ZERO;
  hardContactCooldown = 0;
  private readonly armorColliders = new Map<DamagePartId, Collider[]>();
  private readonly weaponCollider: Collider;
  private readonly sweepShape: InstanceType<typeof RAPIER.Cylinder>;
  private previousMount: Vector;
  private previousPosition: Vector;
  private previousRotation: Quaternion;
  private previousStep = 1 / 60;
  private recoverHeld = false;
  private recoveryRemaining = 0;
  private recoveryAxis: Vector = { x: 1, y: 0, z: 0 };
  private hitStun = 0;
  weaponCharge = 0;
  weaponAngle = 0;
  weaponCooldown = 0;
  recoveryCooldown = 0;
  recoveryProgress = 0;
  wheelSpeedLeft = 0;
  wheelSpeedRight = 0;

  constructor(
    world: InstanceType<typeof RAPIER.World>,
    readonly definition: BotDefinition,
    position: Vector,
    yaw: number,
  ) {
    const physical = definition.physics;
    this.physicsWorld = world;
    this.damage = new ComponentDamage(definition.id);
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z)
        .setRotation(uprightRotation(yaw)).setLinearDamping(0).setAngularDamping(1.35)
        .setCanSleep(false).setCcdEnabled(true),
    );
    const chassis = RAPIER.ColliderDesc.cuboid(physical.halfExtents.x, physical.halfExtents.y, physical.halfExtents.z)
      .setTranslation(physical.chassisOffset.x, physical.chassisOffset.y, physical.chassisOffset.z)
      .setMass(physical.mass * 0.65).setFriction(0.3).setRestitution(0.08);
    this.colliders.push(world.createCollider(chassis, this.body));
    for (const z of physical.wheelZ) {
      for (const side of [-1, 1]) {
        const offset = { x: side * physical.trackWidth / 2, y: 0, z };
        this.wheelPositions.push(offset);
        const collider = world.createCollider(
          RAPIER.ColliderDesc.cylinder(physical.wheelWidth / 2, physical.wheelRadius)
            .setRotation(AXLE_ROTATION).setTranslation(offset.x, offset.y, offset.z)
            .setMass(physical.mass * 0.15 / (physical.wheelZ.length * 2))
            .setFriction(0.025).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(0.03),
          this.body,
        );
        this.colliders.push(collider);
        const id = wheelPartId(definition.id, offset.x, offset.z);
        this.componentColliders.set(collider.handle, id);
        this.wheels.push({ id, collider, position: offset, supported: false });
      }
    }
    if (definition.weapon.kind === 'vertical-disc') {
      for (const side of [-1, 1]) {
        const plow = world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.13, 0.10, 0.46).setTranslation(side * 1.33, -0.29, 1.30)
            .setMass(physical.mass * 0.015).setFriction(0.25), this.body,
        );
        this.colliders.push(plow);
        const armor: DamagePartId = side < 0 ? 'armor-left' : 'armor-right';
        this.componentColliders.set(plow.handle, armor);
        this.armorColliders.set(armor, [plow]);
        // Sloping rib/bunny-ear supports leave rear tires available when inverted.
        const vertices = new Float32Array([
          side * 0.38 - 0.08, 0.12, -0.82, side * 0.38 + 0.08, 0.12, -0.82,
          side * 0.38 - 0.08, 0.27, -0.82, side * 0.38 + 0.08, 0.27, -0.82,
          side * 0.38 - 0.08, 0.65, 0.28, side * 0.38 + 0.08, 0.65, 0.28,
          side * 0.38 - 0.08, 0.80, 0.28, side * 0.38 + 0.08, 0.80, 0.28,
        ]);
        const rib = RAPIER.ColliderDesc.convexHull(vertices);
        if (!rib) throw new Error('Could not construct Witch Doctor rib geometry.');
        this.colliders.push(world.createCollider(rib.setMass(physical.mass * 0.015).setFriction(0.06)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min), this.body));
      }
    } else {
      const boom = RAPIER.ColliderDesc.convexHull(new Float32Array([
        -0.82, -0.39, -0.24, 0.82, -0.39, -0.24,
        -0.82, -0.06, -0.24, 0.82, -0.06, -0.24,
        -0.18, -0.39, 1.67, 0.18, -0.39, 1.67,
        -0.18, -0.06, 1.67, 0.18, -0.06, 1.67,
      ]));
      if (!boom) throw new Error('Could not construct Tombstone boom geometry.');
      this.colliders.push(world.createCollider(boom.setMass(physical.mass * 0.05).setFriction(0.2), this.body));
      this.colliders.push(world.createCollider(
        RAPIER.ColliderDesc.ball(0.12).setTranslation(0, -0.47, 1.67).setMass(physical.mass * 0.01)
          .setFriction(0.025).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
        this.body,
      ));
    }
    const weapon = definition.weapon;
    const weaponDesc = weapon.kind === 'vertical-disc'
      ? RAPIER.ColliderDesc.cylinder(weapon.halfWidth, weapon.radius).setRotation(AXLE_ROTATION)
      : RAPIER.ColliderDesc.cuboid(weapon.radius, weapon.halfWidth, 0.23);
    this.weaponCollider = world.createCollider(
      weaponDesc.setTranslation(weapon.mount.x, weapon.mount.y, weapon.mount.z)
        .setMass(physical.mass * 0.14).setFriction(0.12).setRestitution(0.1),
      this.body,
    );
    this.colliders.push(this.weaponCollider);
    this.componentColliders.set(this.weaponCollider.handle, 'weapon');
    this.allColliders.push(...this.colliders);
    for (const collider of this.allColliders) {
      collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      collider.setContactForceEventThreshold(physical.mass * GRAVITY * 2);
    }
    this.sweepShape = new RAPIER.Cylinder(weapon.halfWidth, weapon.radius);
    // A rotation-independent sphere includes the entire assembly, not just its
    // chassis. The support bounds use the same plow/rib/boom vertices above.
    this.boundingRadius = Math.max(
      magnitude(physical.chassisOffset) + magnitude(physical.halfExtents),
      ...this.wheelPositions.map((wheel) => magnitude(wheel) + Math.hypot(physical.wheelRadius, physical.wheelWidth / 2)),
      magnitude(weapon.mount) + (weapon.kind === 'horizontal-bar'
        ? Math.hypot(weapon.radius, weapon.halfWidth, 0.23)
        : Math.hypot(weapon.radius, weapon.halfWidth)),
      weapon.kind === 'vertical-disc' ? Math.hypot(1.46, 0.39, 1.76) : Math.hypot(0.82, 0.39, 1.67),
      weapon.kind === 'vertical-disc' ? Math.hypot(0.46, 0.80, 0.82) : Math.hypot(0, 0.59, 1.67),
    );
    this.previousPosition = { ...position };
    this.previousMount = this.weaponMount;
    this.previousRotation = this.weaponRotation;
  }

  get yaw(): number {
    const forward = rotate(this.body.rotation(), { x: 0, y: 0, z: 1 });
    return Math.atan2(forward.x, forward.z);
  }
  get alignment(): number { return rotate(this.body.rotation(), { x: 0, y: 1, z: 0 }).y; }
  get inverted(): boolean { return this.alignment < -0.35; }
  get recovering(): boolean { return this.recoveryRemaining > 0; }
  get weaponRpm(): number { return this.weaponCharge * this.definition.weapon.maxRpm; }
  get weaponMount(): Vector { return add(this.body.translation(), rotate(this.body.rotation(), this.definition.weapon.mount)); }
  get weaponRotation(): Quaternion {
    return multiply(this.body.rotation(), this.definition.weapon.kind === 'vertical-disc' ? AXLE_ROTATION : IDENTITY);
  }
  get canStrike(): boolean { return this.weaponCharge >= 0.18 && this.weaponCooldown <= 0; }
  get weaponColliderHandle(): number { return this.weaponCollider.handle; }
  get grounded(): boolean { return this.supported && Math.abs(this.body.linvel().y) < 1.5; }
  get storedRotorEnergy(): number { return rotorEnergy(this.definition.weapon.inertiaKgFt2, this.weaponRpm * Math.PI / 30); }

  refreshSupport(): void {
    this.supported = false;
    for (const wheel of this.wheels) wheel.supported = false;
    const center = this.body.translation();
    for (const collider of this.colliders) {
      this.physicsWorld.contactPairsWith(collider, (other) => {
        if (other.isSensor()) return;
        this.physicsWorld.contactPair(collider, other, (manifold, flipped) => {
          const normal = manifold.normal();
          if ((flipped ? normal.y : -normal.y) < 0.55 || manifold.numSolverContacts() === 0) return;
          const point = manifold.solverContactPoint(0);
          if (!point || magnitude(subtract(point, center)) > this.boundingRadius + 0.1 || manifold.solverContactDist(0) > 0.04) return;
          this.supported = true;
          const wheel = this.wheels.find((item) => item.collider === collider);
          if (wheel) wheel.supported = true;
        });
      });
    }
  }

  previousVelocityAtPoint(point: Vector): Vector {
    return add(this.previousVelocity, cross(this.previousAngularVelocity, subtract(point, this.previousCom)));
  }

  solveImpact(target: ImpactBody, contact: WeaponContact): ImpactSolution {
    const weapon = this.definition.weapon;
    const axis = rotate(this.body.rotation(), weapon.kind === 'vertical-disc'
      ? { x: weapon.spinDirection, y: 0, z: 0 } : { x: 0, y: weapon.spinDirection, z: 0 });
    return solveWeaponImpact({ attacker: impactBody(this.body, contact.point), target, point: contact.point,
      normal: scale(contact.normal, -1), rotor: { mount: this.weaponMount, axis, radius: weapon.radius,
        angularSpeed: this.weaponRpm * Math.PI / 30, inertiaKgFt2: weapon.inertiaKgFt2, maximumEnergyLoss: weapon.energyLossOnHit } });
  }

  couldContact(other: RobotPhysics): boolean {
    const position = this.body.translation();
    const otherPosition = other.body.translation();
    const margin = magnitude(subtract(position, this.previousPosition)) +
      magnitude(subtract(otherPosition, other.previousPosition)) + 0.05;
    const radius = this.boundingRadius + other.boundingRadius + margin;
    const separation = subtract(position, otherPosition);
    return dot(separation, separation) <= radius * radius;
  }

  get weaponSweepBounds(): Bounds {
    const weapon = this.definition.weapon;
    const currentMount = this.weaponMount;
    const currentRotation = this.weaponRotation;
    const cylinderExtents = (rotation: Quaternion): Vector => {
      const axis = normalize(rotate(rotation, { x: 0, y: 1, z: 0 }));
      const extent = (component: number) => Math.abs(component) * weapon.halfWidth +
        weapon.radius * Math.sqrt(Math.max(0, 1 - component * component));
      return { x: extent(axis.x), y: extent(axis.y), z: extent(axis.z) };
    };
    const currentExtent = cylinderExtents(currentRotation);
    const previousExtent = cylinderExtents(this.previousRotation);
    const quaternionDot = Math.abs(currentRotation.x * this.previousRotation.x +
      currentRotation.y * this.previousRotation.y + currentRotation.z * this.previousRotation.z +
      currentRotation.w * this.previousRotation.w);
    const angle = 2 * Math.acos(clamp(quaternionDot, 0, 1));
    // Include the curved mount/shape path between endpoint orientations as well
    // as translation. This only rejects impossible contacts; Rapier decides hits.
    const padding = (magnitude(weapon.mount) + Math.hypot(weapon.radius, weapon.halfWidth)) * Math.min(2, angle) + 0.025;
    return {
      min: {
        x: Math.min(currentMount.x - currentExtent.x, this.previousMount.x - previousExtent.x) - padding,
        y: Math.min(currentMount.y - currentExtent.y, this.previousMount.y - previousExtent.y) - padding,
        z: Math.min(currentMount.z - currentExtent.z, this.previousMount.z - previousExtent.z) - padding,
      },
      max: {
        x: Math.max(currentMount.x + currentExtent.x, this.previousMount.x + previousExtent.x) + padding,
        y: Math.max(currentMount.y + currentExtent.y, this.previousMount.y + previousExtent.y) + padding,
        z: Math.max(currentMount.z + currentExtent.z, this.previousMount.z + previousExtent.z) + padding,
      },
    };
  }

  step(dt: number, input: PlayerInput): boolean {
    this.refreshSupport();
    this.body.setAngularDamping(this.grounded ? 1.35 : 0);
    this.previousPosition = { ...this.body.translation() };
    this.previousMount = this.weaponMount;
    this.previousRotation = this.weaponRotation;
    this.previousStep = dt;
    this.weaponCooldown = Math.max(0, this.weaponCooldown - dt);
    this.recoveryCooldown = Math.max(0, this.recoveryCooldown - dt);
    this.hitStun = Math.max(0, this.hitStun - dt);
    this.hardContactCooldown = Math.max(0, this.hardContactCooldown - dt);
    const weapon = this.definition.weapon;
    const previousCharge = this.weaponCharge;
    const integrity = partIntegrity(this.damage.state, 'weapon');
    const motor = input.weapon && integrity > 0;
    const spinUp = weapon.spinUpSeconds * (1 + Math.max(0, 0.5 - integrity) * 3);
    const desiredCharge = motor ? integrity < 0.35 ? 0.65 + integrity : 1 : 0;
    const spinChange = this.weaponCharge < desiredCharge - 0.00001 ? 1 / spinUp
      : this.weaponCharge > desiredCharge + 0.00001 ? -1 / weapon.coastDownSeconds : 0;
    this.weaponCharge = clamp(this.weaponCharge + dt * spinChange, 0, Math.max(desiredCharge, this.weaponCharge));
    this.weaponAngle = (this.weaponAngle + this.weaponRpm * Math.PI / 30 * dt * weapon.spinDirection) % (Math.PI * 2);
    if (weapon.kind === 'horizontal-bar') {
      this.weaponCollider.setSensor(this.weaponCharge > 0.1);
      this.weaponCollider.setRotationWrtParent({ x: 0, y: Math.sin(this.weaponAngle / 2), z: 0, w: Math.cos(this.weaponAngle / 2) });
    }

    let beganRecovery = false;
    if (input.recover && !this.recoverHeld && this.definition.physics.selfRight &&
      this.recoveryCooldown <= 0 && this.grounded && this.alignment < 0.6 && this.body.translation().y < 2) {
      const right = rotate(this.body.rotation(), { x: 1, y: 0, z: 0 });
      const correction = cross(rotate(this.body.rotation(), { x: 0, y: 1, z: 0 }), { x: 0, y: 1, z: 0 });
      this.recoveryAxis = scale(right, dot(correction, right) < 0 ? -1 : 1);
      this.recoveryRemaining = RECOVERY_SECONDS;
      this.recoveryCooldown = 5;
      this.recoveryProgress = 0;
      this.body.applyImpulse({ x: 0, y: this.body.mass() * 0.8, z: 0 }, true);
      beganRecovery = true;
    }
    this.recoverHeld = input.recover;
    if (this.recoveryRemaining > 0) {
      this.recoveryRemaining = Math.max(0, this.recoveryRemaining - dt);
      this.recoveryProgress = 1 - this.recoveryRemaining / RECOVERY_SECONDS;
      if (this.supported && this.alignment > 0.7 && this.recoveryProgress > 0.2) {
        this.recoveryRemaining = 0;
        const angular = this.body.angvel();
        this.body.setAngvel({ x: angular.x * 0.25, y: angular.y, z: angular.z * 0.25 }, true);
      } else if (this.supported) {
        const torque = this.body.mass() * 40 * dt * Math.sin(Math.PI * clamp(this.recoveryProgress, 0.1, 0.9));
        this.body.applyTorqueImpulse(scale(this.recoveryAxis, torque), true);
      }
    } else {
      this.recoveryProgress = 0;
    }

    this.applyTraction(dt, input);
    const angular = this.body.angvel();
    const axis = rotate(this.body.rotation(), weapon.kind === 'vertical-disc' ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 });
    if (weapon.gyroStrength > 0 && this.weaponCharge > 0.05) {
      const momentum = scale(axis, weapon.spinDirection * this.body.mass() * 0.32 * weapon.gyroStrength * this.weaponCharge);
      const precession = scale(cross({ x: 0, y: angular.y, z: 0 }, momentum), -dt);
      this.body.applyTorqueImpulse(precession, true);
    }
    const spinReaction = scale(axis, -(this.weaponCharge - previousCharge) * weapon.spinDirection * this.body.mass() * 0.10);
    this.body.applyTorqueImpulse(spinReaction, true);
    this.previousVelocity = { ...this.body.linvel() };
    this.previousAngularVelocity = { ...this.body.angvel() };
    this.previousCom = { ...this.body.worldCom() };
    return beganRecovery;
  }

  private applyTraction(dt: number, input: PlayerInput): void {
    const physical = this.definition.physics;
    const position = this.body.translation();
    let contactTraction = 0;
    for (const wheel of this.wheels) {
      const integrity = partIntegrity(this.damage.state, wheel.id);
      if (integrity <= 0) continue;
      if (wheel.supported) {
        contactTraction += 0.62 + Math.min(1, integrity / 0.65) * 0.38;
      }
    }
    const driveOrientation = this.alignment > 0.28 || (physical.invertible && this.alignment < -0.28);
    const fraction = driveOrientation && this.grounded ? contactTraction / this.wheelPositions.length : 0;
    const condition = driveCondition(this.definition.id, this.damage.state);
    const handling = damagedDriveTuning(this.definition.id, this.damage.state);
    const invertedFactor = this.inverted && physical.selfRight ? 0.58 : 1;
    const throttle = this.hitStun > 0 || this.recovering ? 0 : input.throttle;
    const steering = this.hitStun > 0 || this.recovering ? 0 : input.steer;
    const forward = normalize({ x: Math.sin(this.yaw), y: 0, z: Math.cos(this.yaw) });
    const right = { x: forward.z, y: 0, z: -forward.x };
    const gyroSteering = this.definition.weapon.kind === 'vertical-disc'
      ? 1 / (1 + this.definition.weapon.gyroStrength * this.weaponCharge * this.weaponCharge * 0.65)
      : 1;
    const targetYawRate = steeringForDrive(throttle, steering) * this.definition.turnSpeed * invertedFactor * gyroSteering * handling.turnScale + throttle * handling.yawPull;
    const targetSpeed = throttle * this.definition.speed * invertedFactor * handling.speedScale;
    const velocity = this.body.linvel();
    const currentForward = dot(velocity, forward);
    const currentLateral = dot(velocity, right);
    const force = Math.abs(targetSpeed) < Math.abs(currentForward) ? physical.braking : physical.acceleration;
    const longitudinalChange = clamp(targetSpeed - currentForward, -force * dt, force * dt);
    const lateralChange = clamp(-currentLateral * physical.lateralGrip * dt, -GRAVITY * dt * 0.85, GRAVITY * dt * 0.85);
    let delta = add(scale(forward, longitudinalChange), scale(right, lateralChange));
    const gripLimit = GRAVITY * dt * 0.85;
    const requested = magnitude(delta);
    if (requested > gripLimit) delta = scale(delta, gripLimit / requested);
    if (fraction > 0) {
      // Apply bounded tire forces below the centre, retaining real pitch and recoil.
      const forcePoint = { x: position.x, y: Math.max(0.08, position.y - physical.wheelRadius * 0.65), z: position.z };
      this.body.applyImpulseAtPoint(scale(delta, this.body.mass() * fraction), forcePoint, true);
      const yawChange = clamp(targetYawRate - this.body.angvel().y, -physical.angularAcceleration * dt, physical.angularAcceleration * dt);
      const inertia = this.body.mass() * (physical.halfExtents.x ** 2 + physical.halfExtents.z ** 2) / 3;
      this.body.applyTorqueImpulse({ x: 0, y: yawChange * inertia * fraction, z: 0 }, true);
    }
    const inversion = this.inverted ? -1 : 1;
    this.wheelSpeedLeft = condition.left > 0 ? -(targetSpeed + targetYawRate * physical.trackWidth / 2) / physical.wheelRadius * inversion : 0;
    this.wheelSpeedRight = condition.right > 0 ? -(targetSpeed - targetYawRate * physical.trackWidth / 2) / physical.wheelRadius * inversion : 0;
  }

  contactWith(collider: Collider): WeaponContact | null {
    const mount = this.weaponMount;
    let point: Vector | null = null;
    let normal: Vector | null = null;
    const contact = collider.contactShape(this.sweepShape, mount, this.weaponRotation, 0.025);
    if (contact && contact.distance <= 0.025) {
      point = { ...contact.point1 };
      normal = { ...contact.normal1 };
    } else {
      const travel = subtract(mount, this.previousMount);
      if (magnitude(travel) > 0.025) {
        const swept = collider.castShape(ZERO, this.sweepShape, this.previousMount, this.previousRotation,
          scale(travel, 1 / this.previousStep), 0.01, this.previousStep, true);
        if (swept) {
          point = add(collider.translation(), rotate(collider.rotation(), swept.witness1));
          normal = rotate(collider.rotation(), swept.normal1);
        }
      }
    }
    if (!point || !normal) return null;
    const axis = rotate(this.body.rotation(), this.definition.weapon.kind === 'vertical-disc'
      ? { x: this.definition.weapon.spinDirection, y: 0, z: 0 }
      : { x: 0, y: this.definition.weapon.spinDirection, z: 0 });
    const radius = subtract(point, mount);
    const radial = subtract(radius, scale(axis, dot(radius, axis)));
    return {
      point, normal: normalize(normal), tangent: normalize(cross(axis, radial)),
      leverage: clamp(magnitude(radial) / this.definition.weapon.radius, 0.25, 1),
      colliderHandle: collider.handle,
    };
  }

  consumeImpactEnergy(energy: number): void {
    const maximum = rotorEnergy(this.definition.weapon.inertiaKgFt2, this.definition.weapon.maxRpm * Math.PI / 30);
    this.weaponCharge = Math.sqrt(Math.max(0, this.storedRotorEnergy - energy) / maximum);
    this.weaponCooldown = this.definition.weaponCooldown;
  }

  absorbHit(): void { this.hitStun = 0.16; }

  damageAtContact(amount: number, point: Vector, normal: Vector, colliderHandle?: number): DetachedFragment | null {
    const rotation = this.body.rotation();
    const inverse = { x: -rotation.x, y: -rotation.y, z: -rotation.z, w: rotation.w };
    const localPoint = rotate(inverse, subtract(point, this.body.translation()));
    const localNormal = normalize(rotate(inverse, normal), { x: 0, y: 1, z: 0 });
    const explicit = colliderHandle === undefined ? undefined : this.componentColliders.get(colliderHandle);
    const partId = explicit ?? this.partAt(localPoint);
    return this.damageComponent(partId, amount, localPoint, localNormal, normal);
  }

  /** The match result owns this one-time wreck conversion, not an area attack. */
  explode(): DetachedFragment[] {
    const fragments: DetachedFragment[] = [];
    const rotation = this.body.rotation();
    for (const part of damageParts(this.definition.id)) {
      if (partIntegrity(this.damage.state, part.id) <= 0) continue;
      const origin = this.partOrigin(part.id);
      const localNormal = normalize(subtract(origin, this.definition.physics.chassisOffset), { x: 0, y: 1, z: 0 });
      const normal = rotate(rotation, localNormal);
      const fragment = this.damageComponent(part.id, 1000, origin, localNormal, normal);
      if (!fragment) continue;
      // Fragments retain chassis motion, with a bounded outward blast velocity.
      fragment.velocity = add(fragment.velocity, add(scale(normal, 4), { x: 0, y: 4, z: 0 }));
      fragment.angularVelocity = add(fragment.angularVelocity, rotate(rotation, { x: 3, y: 5, z: -4 }));
      fragments.push(fragment);
    }
    this.weaponCharge = 0;
    this.recoveryRemaining = 0;
    this.recoveryProgress = 0;
    return fragments;
  }

  private partOrigin(partId: DamagePartId): Vector {
    const wheel = this.wheels.find((item) => item.id === partId);
    if (wheel) return { ...wheel.position };
    if (partId === 'weapon') return { ...this.definition.weapon.mount };
    const physical = this.definition.physics;
    return partId === 'armor-rear'
      ? { x: 0, y: physical.chassisOffset.y, z: physical.chassisOffset.z - physical.halfExtents.z }
      : partId === 'armor-top'
        ? { x: 0, y: physical.chassisOffset.y + physical.halfExtents.y, z: physical.chassisOffset.z }
        : this.definition.id === 'witchdoctor'
          ? { x: partId === 'armor-left' ? -1.33 : 1.33, y: -0.29, z: 1.30 }
          : { x: (partId === 'armor-left' ? -1 : 1) * physical.halfExtents.x, y: physical.chassisOffset.y, z: physical.chassisOffset.z };
  }

  private damageComponent(partId: DamagePartId, amount: number, localPoint: Vector, localNormal: Vector, normal: Vector): DetachedFragment | null {
    const rotation = this.body.rotation();
    const broke = this.damage.impact(partId, amount, localPoint, localNormal);
    const definition = damageParts(this.definition.id).find((part) => part.id === partId);
    if (!broke || !definition?.detachable) return null;
    let fragment: DetachedFragment;
    const wheel = this.wheels.find((item) => item.id === partId);
    let localOrigin: Vector;
    if (wheel) {
      this.disableCollider(wheel.collider);
      localOrigin = this.partOrigin(partId);
      fragment = { kind: 'wheel', partId, localOrigin, position: ZERO, rotation,
        velocity: ZERO, angularVelocity: ZERO, mass: Math.min(7.5, this.definition.physics.mass * 0.15 / this.wheels.length),
        radius: this.definition.physics.wheelRadius, width: this.definition.physics.wheelWidth };
    } else {
      for (const collider of this.armorColliders.get(partId) ?? []) this.disableCollider(collider);
      const physical = this.definition.physics;
      localOrigin = this.partOrigin(partId);
      const halfExtents = partId === 'armor-top' ? { x: physical.halfExtents.x * 0.85, y: 0.045, z: physical.halfExtents.z * 0.85 }
        : partId === 'armor-rear' ? { x: physical.halfExtents.x * 0.8, y: 0.19, z: 0.045 }
          : { x: 0.055, y: 0.20, z: this.definition.id === 'witchdoctor' ? 0.46 : 0.55 };
      fragment = { kind: 'panel', partId, localOrigin, halfExtents, position: ZERO, rotation,
        velocity: ZERO, angularVelocity: ZERO, mass: 2.4 };
    }
    const offset = rotate(rotation, localOrigin);
    fragment.position = add(add(this.body.translation(), offset), scale(normalize(normal), 0.10));
    fragment.rotation = { ...rotation };
    fragment.velocity = add(add(this.body.linvel(), cross(this.body.angvel(), offset)),
      add(scale(normalize(normal), 1.8), { x: 0, y: 1.1, z: 0 }));
    const spin = wheel ? (wheel.position.x < 0 ? this.wheelSpeedLeft : this.wheelSpeedRight) : localNormal.z * 4;
    fragment.angularVelocity = add(this.body.angvel(), rotate(rotation, { x: spin, y: wheel ? 0 : 2.5, z: wheel ? 0 : -localNormal.x * 4 }));
    return fragment;
  }

  private disableCollider(collider: Collider): void {
    collider.setEnabled(false);
    const index = this.colliders.indexOf(collider);
    if (index !== -1) this.colliders.splice(index, 1);
  }

  private partAt(point: Vector): DamagePartId {
    for (const wheel of this.wheels) {
      if (partIntegrity(this.damage.state, wheel.id) <= 0) continue;
      if (Math.abs(point.x - wheel.position.x) <= this.definition.physics.wheelWidth / 2 + 0.16 &&
        Math.hypot(point.y - wheel.position.y, point.z - wheel.position.z) <= this.definition.physics.wheelRadius + 0.12) return wheel.id;
    }
    const weapon = this.definition.weapon;
    const radial = subtract(point, weapon.mount);
    const onWeapon = weapon.kind === 'vertical-disc'
      ? Math.abs(radial.x) <= weapon.halfWidth + 0.10 && Math.hypot(radial.y, radial.z) <= weapon.radius + 0.1
      : Math.abs(radial.y) <= weapon.halfWidth + 0.10 && Math.hypot(radial.x, radial.z) <= weapon.radius + 0.1;
    if (onWeapon) return 'weapon';
    const physical = this.definition.physics;
    if (point.y > physical.chassisOffset.y + physical.halfExtents.y * 0.65 && Math.abs(point.x) < physical.halfExtents.x * 0.8) return 'armor-top';
    if (point.z < physical.chassisOffset.z - physical.halfExtents.z * 0.6) return 'armor-rear';
    return point.x < 0 ? 'armor-left' : 'armor-right';
  }

  updateImmobilization(dt: number): boolean {
    const condition = driveCondition(this.definition.id, this.damage.state);
    if (condition.wheels > 0) { this.damage.immobilization(0); return false; }
    this.refreshSupport();
    const velocity = this.body.linvel();
    const stationary = Math.hypot(velocity.x, velocity.z) < 0.7;
    if (condition.wheels === 0 && this.grounded && stationary && !this.recovering) {
      this.damage.immobilization(this.damage.state.immobilizedFor + dt);
    } else this.damage.immobilization(0);
    return this.damage.state.immobilizedFor >= IMMOBILIZATION_SECONDS - 0.00001;
  }

  reset(position: Vector, yaw: number): void {
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    this.damage.reset();
    for (const collider of this.allColliders) collider.setEnabled(true);
    this.colliders.splice(0, this.colliders.length, ...this.allColliders);
    if (this.definition.weapon.kind === 'horizontal-bar') {
      this.weaponCollider.setSensor(false);
      this.weaponCollider.setRotationWrtParent(IDENTITY);
    }
    this.body.setTranslation(position, true);
    this.body.setRotation(uprightRotation(yaw), true);
    this.body.setLinvel(ZERO, true);
    this.body.setAngvel(ZERO, true);
    this.hardContactCooldown = 0;
    this.supported = false;
    this.weaponCharge = 0;
    this.weaponAngle = 0;
    this.weaponCooldown = 0;
    this.recoveryCooldown = 0;
    this.recoveryProgress = 0;
    this.recoveryRemaining = 0;
    this.hitStun = 0;
    this.recoverHeld = false;
    this.wheelSpeedLeft = 0;
    this.wheelSpeedRight = 0;
    this.previousMount = this.weaponMount;
    this.previousRotation = this.weaponRotation;
    this.previousPosition = { ...position };
  }
}

export class Simulation {
  private readonly world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
  private readonly players = new Map<string, Participant>();
  private readonly arenaColliders: { collider: Collider; boundary: ArenaBoundary }[] = [];
  private readonly hazards: ArenaHazards;
  private readonly debris: DebrisSystem;
  private readonly contactEvents = new RAPIER.EventQueue(true);
  private phase: MatchPhase = { kind: 'lobby' };
  private tick = 0;
  private eventId = 0;
  private events: MatchEvent[] = [];
  private disposed = false;

  constructor(private readonly roomId: string) {
    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.35, 0));
    this.arenaColliders.push({ collider: this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(ARENA.halfWidth + 1, 0.35, ARENA.halfDepth + 1).setFriction(0.45), ground,
    ), boundary: 'floor' });
    const ceiling = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, ARENA.wallHeight + 0.3, 0));
    this.arenaColliders.push({ collider: this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(ARENA.halfWidth + 1, 0.3, ARENA.halfDepth + 1).setRestitution(0.08), ceiling), boundary: 'ceiling' });
    const walls: { x: number; z: number; hx: number; hz: number; boundary: Exclude<ArenaBoundary, 'floor' | 'ceiling'> }[] = [
      { x: -ARENA.halfWidth - 0.3, z: 0, hx: 0.3, hz: ARENA.halfDepth + 1, boundary: 'west' },
      { x: ARENA.halfWidth + 0.3, z: 0, hx: 0.3, hz: ARENA.halfDepth + 1, boundary: 'east' },
      { x: 0, z: -ARENA.halfDepth - 0.3, hx: ARENA.halfWidth + 1, hz: 0.3, boundary: 'north' },
      { x: 0, z: ARENA.halfDepth + 0.3, hx: ARENA.halfWidth + 1, hz: 0.3, boundary: 'south' },
    ];
    for (const wall of walls) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(wall.x, ARENA.wallHeight / 2, wall.z));
      this.arenaColliders.push({ collider: this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(wall.hx, ARENA.wallHeight / 2, wall.hz).setRestitution(0.12).setFriction(0.3), body,
      ), boundary: wall.boundary });
    }
    this.hazards = new ArenaHazards(this.world);
    this.debris = new DebrisSystem(this.world);
  }

  addPlayer(id: string, name: string, selection: CosmeticSelection): void {
    if (this.players.has(id)) return;
    if (this.players.size >= 2) throw new Error('The arena already has two players.');
    const slot = [...this.players.values()].some((player) => player.spawnSlot === 0) ? 1 : 0;
    const definition = BOTS[selection.botId];
    const physics = new RobotPhysics(this.world, definition,
      { x: 0, y: definition.physics.wheelRadius + 0.03, z: slot === 0 ? -ARENA.spawnZ : ARENA.spawnZ }, slot === 0 ? 0 : Math.PI);
    this.players.set(id, {
      id, spawnSlot: slot, name, selection: { ...selection }, physics, health: 100,
      ready: false, connected: true, input: { ...NEUTRAL_INPUT }, inputAt: -Infinity,
      lastInputSeq: -1, damageDealt: 0, hits: 0,
    });
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (!player) return;
    if (this.phase.kind === 'fighting' || this.phase.kind === 'countdown') this.forfeit(id);
    this.world.removeRigidBody(player.physics.body);
    this.players.delete(id);
  }
  setConnected(id: string, connected: boolean): void {
    const player = this.players.get(id);
    if (!player) return;
    player.connected = connected;
    if (!connected) {
      player.input = { ...NEUTRAL_INPUT, seq: player.lastInputSeq };
      player.ready = false;
      if (this.phase.kind === 'countdown') this.phase = { kind: 'lobby' };
    }
  }
  setReady(id: string, ready: boolean): void {
    const player = this.players.get(id);
    if (!player || this.phase.kind !== 'lobby') return;
    player.ready = ready && player.connected;
    if (this.players.size === 2 && [...this.players.values()].every((item) => item.ready && item.connected)) {
      this.phase = { kind: 'countdown', seconds: COUNTDOWN_SECONDS };
    }
  }
  setInput(id: string, input: PlayerInput, nowMs: number): void {
    const player = this.players.get(id);
    if (!player || !player.connected || input.seq <= player.lastInputSeq) return;
    player.input = { ...input };
    player.inputAt = nowMs;
    player.lastInputSeq = input.seq;
  }

  /** In-process physics fixtures; this accessor is never exposed by the room transport. */
  robotPhysics(id: string): RobotPhysics | undefined { return this.players.get(id)?.physics; }

  pulverize(id: string): boolean {
    const player = this.players.get(id);
    return this.phase.kind === 'fighting' && !!player && player.connected && player.health > 0
      ? this.hazards.trigger(player.spawnSlot) : false;
  }

  step(dt: number, nowMs: number): void {
    if (this.disposed) return;
    this.tick += 1;
    if (this.phase.kind === 'finished') {
      const moving = [...this.players.values()].some((player) => !player.physics.grounded || magnitude(player.physics.body.linvel()) > 0.15 || magnitude(player.physics.body.angvel()) > 0.25);
      if (this.debris.size > 0 || moving) {
        this.world.timestep = dt / 2;
        for (let substep = 0; substep < 2; substep += 1) {
          for (const player of this.players.values()) player.physics.step(dt / 2, NEUTRAL_INPUT);
          this.world.step();
          for (const player of this.players.values()) { player.physics.refreshSupport(); this.containBody(player); }
        }
        this.debris.step(dt);
      }
      return;
    }
    if (this.phase.kind === 'countdown') {
      const seconds = this.phase.seconds - dt;
      this.phase = seconds <= 0.00001 ? { kind: 'fighting', seconds: MATCH_SECONDS } : { kind: 'countdown', seconds };
      this.world.timestep = dt;
      this.world.step();
      for (const player of this.players.values()) player.physics.refreshSupport();
      return;
    }
    if (this.phase.kind === 'lobby') {
      this.world.timestep = dt;
      this.world.step();
      for (const player of this.players.values()) player.physics.refreshSupport();
      return;
    }

    // Two 60 Hz physics substeps keep wheel contact and fast swept weapons stable
    // while retaining the public 30 Hz authoritative input/network contract.
    this.world.timestep = dt / 2;
    const elapsedBefore = MATCH_SECONDS - this.phase.seconds;
    for (let substep = 0; substep < 2; substep += 1) {
      for (const player of this.players.values()) {
        const input = player.connected && nowMs - player.inputAt <= INPUT_TIMEOUT_MS ? player.input : NEUTRAL_INPUT;
        if (player.physics.step(dt / 2, input)) {
          this.addEvent({ kind: 'recover', sourceId: player.id, targetId: player.id,
            position: { ...player.physics.body.translation() }, strength: 0.3 });
        }
      }
      this.world.step(this.contactEvents);
      for (const player of this.players.values()) { player.physics.refreshSupport(); this.containBody(player); }
      this.applyHardContacts(dt / 2);
      // Capture every eligible attack before mutating health: mutual KOs are fair.
      this.applyHits(this.findHits());
      for (const player of this.players.values()) this.hitArena(player);
      const robots: HazardRobot[] = [...this.players.values()].map((player) => ({
        id: player.id, slot: player.spawnSlot, physics: player.physics,
      }));
      for (const hit of this.hazards.step(dt / 2, elapsedBefore + (substep + 1) * dt / 2, robots)) this.applyHazardHit(hit);
      for (const player of this.players.values()) player.physics.updateImmobilization(dt / 2);
      this.debris.step(dt / 2);
    }
    const survivors = [...this.players.values()].filter((player) => player.health > 0 &&
      player.physics.damage.state.immobilizedFor < IMMOBILIZATION_SECONDS - 0.00001);
    if (survivors.length < this.players.size) {
      this.finish({ winnerId: survivors.length === 1 ? survivors[0]?.id ?? null : null, reason: survivors.length === 0 ? 'draw' : 'knockout' });
      return;
    }
    const seconds = this.phase.seconds - dt;
    if (seconds <= 0.00001) {
      const ordered = [...this.players.values()].sort((a, b) => b.health - a.health);
      const winner = ordered[0];
      const runnerUp = ordered[1];
      const draw = !winner || !runnerUp || Math.abs(winner.health - runnerUp.health) < 0.001;
      this.finish({ winnerId: draw ? null : winner.id, reason: draw ? 'draw' : 'timeout' });
    } else {
      this.phase = { kind: 'fighting', seconds };
    }
  }

  private containBody(player: Participant): void {
    const body = player.physics.body;
    const position = body.translation();
    // Normal flight and enclosure collisions are entirely Rapier-owned. This is
    // only an escape/non-finite fail-safe, not an invisible flight-height clamp.
    if (!Number.isFinite(position.x + position.y + position.z) || Math.abs(position.x) > ARENA.halfWidth + 5 ||
      Math.abs(position.z) > ARENA.halfDepth + 5 || position.y < -5 || position.y > 100) {
      body.setTranslation({ x: Number.isFinite(position.x) ? clamp(position.x, -ARENA.halfWidth + 2, ARENA.halfWidth - 2) : 0,
        y: Number.isFinite(position.y) ? clamp(position.y, 0.8, ARENA.wallHeight - 1) : 0.8,
        z: Number.isFinite(position.z) ? clamp(position.z, -ARENA.halfDepth + 2, ARENA.halfDepth - 2) : 0 }, true);
      body.setLinvel(ZERO, true);
    }
    const angular = body.angvel();
    const angularSpeed = magnitude(angular);
    if (angularSpeed > 70) body.setAngvel(scale(angular, 70 / angularSpeed), true);
    const linear = body.linvel();
    const linearSpeed = magnitude(linear);
    if (linearSpeed > 80) body.setLinvel(scale(linear, 80 / linearSpeed), true);
  }

  private findHits(): PendingHit[] {
    const hits: PendingHit[] = [];
    for (const attacker of this.players.values()) {
      // Power/input loss stops the motor command, not the stored spinner inertia.
      if (attacker.health <= 0 || !attacker.physics.canStrike) continue;
      for (const target of this.players.values()) {
        if (target.id === attacker.id || target.health <= 0) continue;
        if (!attacker.physics.couldContact(target.physics)) continue;
        let best: WeaponContact | null = null;
        for (const collider of target.physics.colliders) {
          const contact = attacker.physics.contactWith(collider);
          if (contact && (!best || contact.leverage > best.leverage)) best = contact;
        }
        if (!best) continue;
        hits.push({ attacker, target, contact: best });
        break;
      }
    }
    return hits;
  }

  private applyHits(contacts: PendingHit[]): void {
    const resolved: ResolvedHit[] = [];
    // Eligibility is captured together, but impulse resolution must see the
    // velocity produced by earlier contacts. Components detach only after every
    // reciprocal impulse, keeping each solve's mass and inertia authoritative.
    for (const hit of contacts) {
      const { attacker, target, contact } = hit;
      const solution = attacker.physics.solveImpact(impactBody(target.physics.body, contact.point), contact);
      if (solution.magnitude < 1 || solution.damage < 0.01) continue;
      target.physics.body.applyImpulseAtPoint(solution.impulse, contact.point, true);
      attacker.physics.body.applyImpulseAtPoint(solution.recoil, contact.point, true);
      attacker.physics.consumeImpactEnergy(solution.energyConsumed);
      resolved.push({ ...hit, solution });
    }
    for (const hit of resolved) this.applyHitDamage(hit);
  }

  private applyHitDamage({ attacker, target, contact, solution }: ResolvedHit): void {
    const damage = solution.damage;
    const delivered = Math.min(damage, target.health);
    target.health = Math.max(0, target.health - damage);
    target.physics.absorbHit();
    attacker.damageDealt += delivered;
    attacker.hits += 1;
    this.localizeDamage(target, damage, contact.point, contact.normal, contact.colliderHandle);
    this.addEvent({ kind: 'hit', sourceId: attacker.id, targetId: target.id,
      position: { ...contact.point }, strength: clamp(damage / IMPACT_TUNING.maximumWeaponDamage, 0.1, 1) });
  }

  private hitArena(player: Participant): void {
    if (!player.physics.canStrike || player.physics.weaponCharge < 0.3) return;
    const bounds = player.physics.weaponSweepBounds;
    const deck = ARENA.upperDeck;
    const touchesDeckBounds = bounds.min.x <= deck.x + deck.width / 2 && bounds.max.x >= deck.x - deck.width / 2 &&
      bounds.min.z <= deck.z + deck.depth / 2 && bounds.max.z >= deck.z - deck.depth / 2 && bounds.min.y <= deck.height && bounds.max.y >= 0;
    if (bounds.min.x > -ARENA.halfWidth && bounds.max.x < ARENA.halfWidth &&
      bounds.min.z > -ARENA.halfDepth && bounds.max.z < ARENA.halfDepth && bounds.min.y > 0 && bounds.max.y < ARENA.wallHeight && !touchesDeckBounds) return;
    let contact: WeaponContact | null = null;
    for (const arena of this.arenaColliders) {
      if (arena.boundary === 'floor' && (bounds.min.y > 0 || Math.abs(player.physics.alignment) > 0.65)) continue;
      if (arena.boundary === 'ceiling' && bounds.max.y < ARENA.wallHeight) continue;
      if (arena.boundary === 'west' && bounds.min.x > -ARENA.halfWidth) continue;
      if (arena.boundary === 'east' && bounds.max.x < ARENA.halfWidth) continue;
      if (arena.boundary === 'north' && bounds.min.z > -ARENA.halfDepth) continue;
      if (arena.boundary === 'south' && bounds.max.z < ARENA.halfDepth) continue;
      contact = player.physics.contactWith(arena.collider);
      if (contact) break;
    }
    if (!contact && touchesDeckBounds) contact = player.physics.contactWith(this.hazards.deckCollider);
    if (!contact) return;
    const solution = player.physics.solveImpact(STATIC_IMPACT_BODY, contact);
    if (solution.magnitude < 1) return;
    player.physics.body.applyImpulseAtPoint(solution.recoil, contact.point, true);
    player.physics.consumeImpactEnergy(solution.energyConsumed);
    const selfDamage = Math.min(5, solution.damage * 0.15);
    player.health = Math.max(0, player.health - selfDamage);
    this.localizeDamage(player, selfDamage, contact.point, scale(contact.normal, -1), player.physics.weaponColliderHandle);
    this.addEvent({ kind: 'hit', sourceId: player.id, targetId: 'arena', position: contact.point,
      strength: clamp(solution.damage / IMPACT_TUNING.maximumWeaponDamage, 0.1, 1) });
  }

  private applyHazardHit(hit: HazardHit): void {
    const player = this.players.get(hit.robotId);
    if (!player || player.health <= 0) return;
    const delivered = Math.min(hit.damage, player.health);
    player.health = Math.max(0, player.health - hit.damage);
    this.localizeDamage(player, hit.damage, hit.position, hit.normal, hit.colliderHandle);
    const owner = hit.ownerSlot === null ? undefined : [...this.players.values()].find((item) => item.spawnSlot === hit.ownerSlot);
    if (owner && owner.id !== player.id) owner.damageDealt += delivered;
    this.addEvent({ kind: 'hazard', sourceId: hit.hazardId, targetId: player.id, position: hit.position, strength: hit.strength });
  }

  private localizeDamage(player: Participant, amount: number, point: Vector, normal: Vector, colliderHandle?: number): void {
    const fragment = player.physics.damageAtContact(amount, point, normal, colliderHandle);
    if (!fragment) return;
    this.debris.spawn(player.id, player.selection.botId, fragment);
    this.addEvent({ kind: 'break', sourceId: player.id, targetId: player.id, position: fragment.position, strength: 0.8 });
  }

  private applyHardContacts(dt: number): void {
    const strongest = new Map<string, { player: Participant; damage: number; point: Vector; normal: Vector; handle: number; landing: boolean }>();
    this.contactEvents.drainContactForceEvents((event) => {
      const first = this.world.getCollider(event.collider1());
      const second = this.world.getCollider(event.collider2());
      if (!first || !second) return;
      for (const [collider, other] of [[first, second], [second, first]]) {
        if (!collider || !other) continue;
        const player = [...this.players.values()].find((item) => item.physics.colliders.some((part) => part.handle === collider.handle));
        if (!player || player.physics.hardContactCooldown > 0) continue;
        const opponent = [...this.players.values()].find((item) => item.id !== player.id && item.physics.colliders.some((part) => part.handle === other.handle));
        if (!opponent && !other.parent()?.isFixed()) continue;
        this.world.contactPair(collider, other, (manifold, flipped) => {
          const point = manifold.solverContactPoint(0);
          if (!point) return;
          const normal = scale(manifold.normal(), flipped ? 1 : -1);
          const relative = subtract(player.physics.previousVelocityAtPoint(point), opponent?.physics.previousVelocityAtPoint(point) ?? ZERO);
          const speed = Math.max(0, -dot(relative, normal));
          const landing = !opponent && normal.y > 0.55;
          const damage = landing ? hardLandingDamage({ normalSpeed: speed, normalImpulse: event.totalForceMagnitude() * dt, mass: player.physics.body.mass() })
            : speed > 6 ? Math.min(5, Math.sqrt(0.25 * player.physics.body.mass() * speed * speed * IMPACT_TUNING.joulesPerKgFtSquaredPerSecondSquared) * 0.10) : 0;
          if (damage <= 0 || damage <= (strongest.get(player.id)?.damage ?? 0)) return;
          strongest.set(player.id, { player, damage, point: { ...point }, normal, handle: collider.handle, landing });
        });
      }
    });
    for (const hit of strongest.values()) {
      hit.player.physics.hardContactCooldown = IMPACT_TUNING.landingCooldown;
      hit.player.health = Math.max(0, hit.player.health - hit.damage);
      this.localizeDamage(hit.player, hit.damage, hit.point, scale(hit.normal, -1), hit.handle);
      this.addEvent({ kind: hit.landing ? 'landing' : 'hit', sourceId: hit.landing ? hit.player.id : 'arena',
        targetId: hit.player.id, position: hit.point, strength: clamp(hit.damage / 16, 0.1, 1) });
    }
  }

  private addEvent(event: Omit<MatchEvent, 'id'>): void {
    this.eventId += 1;
    this.events.push({ id: this.eventId, ...event });
    if (this.events.length > 24) this.events = this.events.slice(-24);
  }
  private finish(result: MatchResult): void {
    if (this.phase.kind === 'finished') return;
    this.phase = { kind: 'finished', result };
    this.hazards.freeze();
    for (const player of this.players.values()) {
      const destroyed = player.health <= 0 || player.physics.damage.state.immobilizedFor >= IMMOBILIZATION_SECONDS - 0.00001;
      const lostCombat = result.winnerId !== null && player.id !== result.winnerId &&
        (result.reason === 'knockout' || result.reason === 'timeout');
      if (!lostCombat && !(result.reason === 'draw' && destroyed)) continue;
      player.health = 0;
      const position = { ...player.physics.body.translation() };
      for (const fragment of player.physics.explode()) this.debris.spawn(player.id, player.selection.botId, fragment);
      this.addEvent({ kind: 'explosion', sourceId: player.id, targetId: player.id, position, strength: 1 });
    }
    for (const player of this.players.values()) {
      player.input = { ...NEUTRAL_INPUT, seq: player.lastInputSeq };
      player.physics.wheelSpeedLeft = 0;
      player.physics.wheelSpeedRight = 0;
    }
  }
  forfeit(id: string): void {
    if (!this.players.has(id) || this.phase.kind === 'finished') return;
    const opponent = [...this.players.values()].find((player) => player.id !== id && player.connected);
    this.finish({ winnerId: opponent?.id ?? null, reason: opponent ? 'forfeit' : 'abandoned' });
  }
  rematch(): void {
    if (this.phase.kind !== 'finished') return;
    this.phase = { kind: 'lobby' };
    this.events = [];
    this.hazards.reset();
    this.debris.clear();
    for (const player of this.players.values()) {
      const physical = player.physics.definition.physics;
      player.physics.reset({ x: 0, y: physical.wheelRadius + 0.03, z: player.spawnSlot === 0 ? -ARENA.spawnZ : ARENA.spawnZ }, player.spawnSlot === 0 ? 0 : Math.PI);
      player.health = 100;
      player.ready = false;
      player.input = { ...NEUTRAL_INPUT, seq: player.lastInputSeq };
      player.inputAt = -Infinity;
      player.damageDealt = 0;
      player.hits = 0;
    }
  }
  snapshot(): MatchState {
    return {
      roomId: this.roomId, tick: this.tick,
      phase: this.phase.kind === 'finished' ? { kind: 'finished', result: { ...this.phase.result } } : { ...this.phase },
      players: [...this.players.values()].map((player) => ({
        id: player.id, spawnSlot: player.spawnSlot, name: player.name, ...player.selection,
        position: { ...player.physics.body.translation() }, rotation: { ...player.physics.body.rotation() },
        yaw: player.physics.yaw, velocity: { ...player.physics.body.linvel() },
        grounded: player.physics.grounded,
        angularVelocity: { ...player.physics.body.angvel() }, health: player.health,
        weaponCharge: player.physics.weaponCharge, weaponRpm: player.physics.weaponRpm,
        weaponAngle: player.physics.weaponAngle, weaponActive: player.physics.weaponCharge >= 0.12,
        inverted: player.physics.inverted, recovering: player.physics.recovering,
        recoveryProgress: player.physics.recoveryProgress, recoveryCooldown: player.physics.recoveryCooldown,
        wheelSpeedLeft: player.physics.wheelSpeedLeft, wheelSpeedRight: player.physics.wheelSpeedRight,
        connected: player.connected, ready: player.ready, lastInputSeq: player.lastInputSeq,
        damageDealt: player.damageDealt, hits: player.hits,
        damage: player.physics.damage.snapshot(),
      })),
      events: this.events.map((event) => ({ ...event, position: { ...event.position } })),
      arena: this.hazards.snapshot(),
      debris: this.debris.snapshot(),
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.debris.clear();
    this.contactEvents.free();
    this.players.clear();
    this.world.free();
  }
}

export async function createSimulation(roomId: string): Promise<Simulation> {
  await initializePhysics();
  return new Simulation(roomId);
}
