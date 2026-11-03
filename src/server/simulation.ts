import RAPIER from '@dimforge/rapier3d-compat';
import {
  ARENA, BOTS, COUNTDOWN_SECONDS, INPUT_TIMEOUT_MS, MATCH_SECONDS, NEUTRAL_INPUT,
} from '../shared/protocol';
import type {
  BotDefinition, CosmeticSelection, MatchEvent, MatchPhase, MatchResult, MatchState,
  PlayerInput, PlayerSnapshot,
} from '../shared/protocol';

type Body = InstanceType<typeof RAPIER.RigidBody>;
type Collider = InstanceType<typeof RAPIER.Collider>;
type Vector = PlayerSnapshot['position'];
type Quaternion = PlayerSnapshot['rotation'];
interface Bounds { min: Vector; max: Vector }
type ArenaBoundary = 'floor' | 'west' | 'east' | 'north' | 'south';
const GRAVITY = 19.62;
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
}

interface PendingHit {
  attacker: Participant;
  target: Participant;
  contact: WeaponContact;
  energy: number;
  damage: number;
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

/** Physical robot assembly shared by matches and real-Rapier verification fixtures. */
export class RobotPhysics {
  readonly body: Body;
  readonly colliders: Collider[] = [];
  readonly wheelPositions: Vector[] = [];
  readonly boundingRadius: number;
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
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z)
        .setRotation(uprightRotation(yaw)).setLinearDamping(0.12).setAngularDamping(1.35)
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
        this.colliders.push(world.createCollider(
          RAPIER.ColliderDesc.cylinder(physical.wheelWidth / 2, physical.wheelRadius)
            .setRotation(AXLE_ROTATION).setTranslation(offset.x, offset.y, offset.z)
            .setMass(physical.mass * 0.15 / (physical.wheelZ.length * 2))
            .setFriction(0.025).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(0.03),
          this.body,
        ));
      }
    }
    if (definition.weapon.kind === 'vertical-disc') {
      for (const side of [-1, 1]) {
        this.colliders.push(world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.13, 0.10, 0.46).setTranslation(side * 1.33, -0.29, 1.30)
            .setMass(physical.mass * 0.015).setFriction(0.25), this.body,
        ));
        // Sloping rib/bunny-ear supports leave rear tires available when inverted.
        const vertices = new Float32Array([
          side * 0.38 - 0.08, 0.12, -0.82, side * 0.38 + 0.08, 0.12, -0.82,
          side * 0.38 - 0.08, 0.27, -0.82, side * 0.38 + 0.08, 0.27, -0.82,
          side * 0.38 - 0.08, 0.65, 0.28, side * 0.38 + 0.08, 0.65, 0.28,
          side * 0.38 - 0.08, 0.80, 0.28, side * 0.38 + 0.08, 0.80, 0.28,
        ]);
        const rib = RAPIER.ColliderDesc.convexHull(vertices);
        if (!rib) throw new Error('Could not construct Witch Doctor rib geometry.');
        this.colliders.push(world.createCollider(rib.setMass(physical.mass * 0.015).setFriction(0.25), this.body));
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
    this.previousPosition = { ...this.body.translation() };
    this.previousMount = this.weaponMount;
    this.previousRotation = this.weaponRotation;
    this.previousStep = dt;
    this.weaponCooldown = Math.max(0, this.weaponCooldown - dt);
    this.recoveryCooldown = Math.max(0, this.recoveryCooldown - dt);
    this.hitStun = Math.max(0, this.hitStun - dt);
    const weapon = this.definition.weapon;
    const previousCharge = this.weaponCharge;
    this.weaponCharge = clamp(this.weaponCharge + dt * (input.weapon ? 1 / weapon.spinUpSeconds : -1 / weapon.coastDownSeconds), 0, 1);
    this.weaponAngle = (this.weaponAngle + this.weaponRpm * Math.PI / 30 * dt * weapon.spinDirection) % (Math.PI * 2);
    if (weapon.kind === 'horizontal-bar') {
      this.weaponCollider.setSensor(this.weaponCharge > 0.1);
      this.weaponCollider.setRotationWrtParent({ x: 0, y: Math.sin(this.weaponAngle / 2), z: 0, w: Math.cos(this.weaponAngle / 2) });
    }

    let beganRecovery = false;
    if (input.recover && !this.recoverHeld && this.definition.physics.selfRight &&
      this.recoveryCooldown <= 0 && this.alignment < 0.6 && this.body.translation().y < 2) {
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
      if (this.alignment > 0.7 && this.recoveryProgress > 0.2) {
        this.recoveryRemaining = 0;
        const angular = this.body.angvel();
        this.body.setAngvel({ x: angular.x * 0.25, y: angular.y, z: angular.z * 0.25 }, true);
      } else {
        const torque = this.body.mass() * 22 * dt * Math.sin(Math.PI * clamp(this.recoveryProgress, 0.1, 0.9));
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
    return beganRecovery;
  }

  private applyTraction(dt: number, input: PlayerInput): void {
    const physical = this.definition.physics;
    const rotation = this.body.rotation();
    const position = this.body.translation();
    const contacts = this.wheelPositions.filter((wheel) => {
      const point = add(position, rotate(rotation, wheel));
      return point.y >= -0.05 && point.y - physical.wheelRadius < 0.14;
    }).length;
    const driveOrientation = this.alignment > 0.28 || (physical.invertible && this.alignment < -0.28);
    const fraction = driveOrientation ? contacts / this.wheelPositions.length : 0;
    const invertedFactor = this.inverted && physical.selfRight ? 0.58 : 1;
    const throttle = this.hitStun > 0 || this.recovering ? 0 : input.throttle;
    const steering = this.hitStun > 0 || this.recovering ? 0 : input.steer;
    const forward = normalize({ x: Math.sin(this.yaw), y: 0, z: Math.cos(this.yaw) });
    const right = { x: forward.z, y: 0, z: -forward.x };
    const gyroSteering = this.definition.weapon.kind === 'vertical-disc'
      ? 1 / (1 + this.definition.weapon.gyroStrength * this.weaponCharge * this.weaponCharge * 0.65)
      : 1;
    const targetYawRate = steering * this.definition.turnSpeed * invertedFactor * gyroSteering;
    const targetSpeed = throttle * this.definition.speed * invertedFactor;
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
    this.wheelSpeedLeft = -(targetSpeed + targetYawRate * physical.trackWidth / 2) / physical.wheelRadius * inversion;
    this.wheelSpeedRight = -(targetSpeed - targetYawRate * physical.trackWidth / 2) / physical.wheelRadius * inversion;
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
    };
  }

  spendWeaponEnergy(leverage: number): void {
    const energy = this.weaponCharge * this.weaponCharge;
    this.weaponCharge = Math.sqrt(Math.max(0, energy * (1 - this.definition.weapon.energyLossOnHit * leverage)));
    this.weaponCooldown = this.definition.weaponCooldown;
  }

  absorbHit(): void { this.hitStun = 0.16; }

  reset(position: Vector, yaw: number): void {
    this.body.setTranslation(position, true);
    this.body.setRotation(uprightRotation(yaw), true);
    this.body.setLinvel(ZERO, true);
    this.body.setAngvel(ZERO, true);
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
    const walls: { x: number; z: number; hx: number; hz: number; boundary: Exclude<ArenaBoundary, 'floor'> }[] = [
      { x: -ARENA.halfWidth - 0.3, z: 0, hx: 0.3, hz: ARENA.halfDepth + 1, boundary: 'west' },
      { x: ARENA.halfWidth + 0.3, z: 0, hx: 0.3, hz: ARENA.halfDepth + 1, boundary: 'east' },
      { x: 0, z: -ARENA.halfDepth - 0.3, hx: ARENA.halfWidth + 1, hz: 0.3, boundary: 'north' },
      { x: 0, z: ARENA.halfDepth + 0.3, hx: ARENA.halfWidth + 1, hz: 0.3, boundary: 'south' },
    ];
    for (const wall of walls) {
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(wall.x, 2, wall.z));
      this.arenaColliders.push({ collider: this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(wall.hx, 2, wall.hz).setRestitution(0.12).setFriction(0.3), body,
      ), boundary: wall.boundary });
    }
  }

  addPlayer(id: string, name: string, selection: CosmeticSelection): void {
    if (this.players.has(id)) return;
    if (this.players.size >= 2) throw new Error('The arena already has two players.');
    const slot = [...this.players.values()].some((player) => player.spawnSlot === 0) ? 1 : 0;
    const definition = BOTS[selection.botId];
    const physics = new RobotPhysics(this.world, definition,
      { x: 0, y: definition.physics.wheelRadius + 0.03, z: slot === 0 ? -7 : 7 }, slot === 0 ? 0 : Math.PI);
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

  step(dt: number, nowMs: number): void {
    if (this.disposed) return;
    this.tick += 1;
    if (this.phase.kind === 'finished') return;
    if (this.phase.kind === 'countdown') {
      const seconds = this.phase.seconds - dt;
      this.phase = seconds <= 0.00001 ? { kind: 'fighting', seconds: MATCH_SECONDS } : { kind: 'countdown', seconds };
      this.world.timestep = dt;
      this.world.step();
      return;
    }
    if (this.phase.kind === 'lobby') {
      this.world.timestep = dt;
      this.world.step();
      return;
    }

    // Two 60 Hz physics substeps keep wheel contact and fast swept weapons stable
    // while retaining the public 30 Hz authoritative input/network contract.
    this.world.timestep = dt / 2;
    for (let substep = 0; substep < 2; substep += 1) {
      for (const player of this.players.values()) {
        const input = player.connected && nowMs - player.inputAt <= INPUT_TIMEOUT_MS ? player.input : NEUTRAL_INPUT;
        if (player.physics.step(dt / 2, input)) {
          this.addEvent({ kind: 'recover', sourceId: player.id, targetId: player.id,
            position: { ...player.physics.body.translation() }, strength: 0.3 });
        }
      }
      this.world.step();
      for (const player of this.players.values()) this.containBody(player);
      // Capture every eligible attack before mutating health: mutual KOs are fair.
      for (const hit of this.findHits()) this.applyHit(hit);
      for (const player of this.players.values()) this.hitArena(player);
    }
    const survivors = [...this.players.values()].filter((player) => player.health > 0);
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
    const x = clamp(position.x, -ARENA.halfWidth + 0.85, ARENA.halfWidth - 0.85);
    const z = clamp(position.z, -ARENA.halfDepth + 0.85, ARENA.halfDepth - 0.85);
    // Escape containment is only a safety bound, never an automatic self-righter.
    if (x !== position.x || z !== position.z || position.y < -2 || position.y > 12) {
      body.setTranslation({ x, y: clamp(position.y, 0.65, 12), z }, true);
      const velocity = body.linvel();
      body.setLinvel({ x: x !== position.x ? 0 : velocity.x, y: position.y < -2 || position.y > 12 ? 0 : velocity.y,
        z: z !== position.z ? 0 : velocity.z }, true);
    }
    const angular = body.angvel();
    const angularSpeed = magnitude(angular);
    if (angularSpeed > 16) body.setAngvel(scale(angular, 16 / angularSpeed), true);
    const linear = body.linvel();
    const linearSpeed = magnitude(linear);
    if (linearSpeed > 22) body.setLinvel(scale(linear, 22 / linearSpeed), true);
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
        const energy = attacker.physics.weaponCharge ** 2;
        hits.push({ attacker, target, contact: best, energy,
          damage: BOTS[attacker.selection.botId].damage * energy * best.leverage });
        break;
      }
    }
    return hits;
  }

  private applyHit({ attacker, target, contact, energy, damage }: PendingHit): void {
    const delivered = Math.min(damage, target.health);
    target.health = Math.max(0, target.health - damage);
    target.physics.absorbHit();
    attacker.damageDealt += delivered;
    attacker.hits += 1;
    const outward = scale(contact.normal, -1);
    const vertical = attacker.physics.definition.weapon.kind === 'vertical-disc';
    const direction = normalize(add(scale(contact.tangent, vertical ? 1 : 0.9), scale(outward, vertical ? 0.45 : 0.50)));
    const strength = (vertical ? 5.4 : 6.2) * energy * contact.leverage;
    const impulse = scale(direction, target.physics.body.mass() * strength);
    target.physics.body.applyImpulseAtPoint(impulse, contact.point, true);
    // The spinner transfers momentum both ways, including its characteristic recoil.
    attacker.physics.body.applyImpulseAtPoint(scale(impulse, -0.48), attacker.physics.weaponMount, true);
    attacker.physics.spendWeaponEnergy(contact.leverage);
    this.addEvent({ kind: 'hit', sourceId: attacker.id, targetId: target.id,
      position: { ...contact.point }, strength: clamp(energy * contact.leverage, 0.1, 1) });
  }

  private hitArena(player: Participant): void {
    if (!player.physics.canStrike || player.physics.weaponCharge < 0.3) return;
    const bounds = player.physics.weaponSweepBounds;
    if (bounds.min.x > -ARENA.halfWidth && bounds.max.x < ARENA.halfWidth &&
      bounds.min.z > -ARENA.halfDepth && bounds.max.z < ARENA.halfDepth && bounds.min.y > 0) return;
    for (const arena of this.arenaColliders) {
      if (arena.boundary === 'floor' && (bounds.min.y > 0 || Math.abs(player.physics.alignment) > 0.65)) continue;
      if (arena.boundary === 'west' && bounds.min.x > -ARENA.halfWidth) continue;
      if (arena.boundary === 'east' && bounds.max.x < ARENA.halfWidth) continue;
      if (arena.boundary === 'north' && bounds.min.z > -ARENA.halfDepth) continue;
      if (arena.boundary === 'south' && bounds.max.z < ARENA.halfDepth) continue;
      const contact = player.physics.contactWith(arena.collider);
      if (!contact) continue;
      const energy = player.physics.weaponCharge ** 2;
      const impulse = scale(normalize(add(contact.normal, scale(contact.tangent, -0.25))),
        player.physics.body.mass() * Math.min(3.5, 3.2 * energy * contact.leverage));
      player.physics.body.applyImpulseAtPoint(impulse, player.physics.weaponMount, true);
      player.physics.spendWeaponEnergy(contact.leverage);
      this.addEvent({ kind: 'hit', sourceId: player.id, targetId: 'arena', position: contact.point,
        strength: clamp(energy * contact.leverage, 0.1, 1) });
      break;
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
    for (const player of this.players.values()) {
      player.input = { ...NEUTRAL_INPUT, seq: player.lastInputSeq };
      player.physics.weaponCharge = 0;
      player.physics.wheelSpeedLeft = 0;
      player.physics.wheelSpeedRight = 0;
      player.physics.body.setLinvel(ZERO, true);
      player.physics.body.setAngvel(ZERO, true);
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
    for (const player of this.players.values()) {
      const physical = player.physics.definition.physics;
      player.physics.reset({ x: 0, y: physical.wheelRadius + 0.03, z: player.spawnSlot === 0 ? -7 : 7 }, player.spawnSlot === 0 ? 0 : Math.PI);
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
        id: player.id, name: player.name, ...player.selection,
        position: { ...player.physics.body.translation() }, rotation: { ...player.physics.body.rotation() },
        yaw: player.physics.yaw, velocity: { ...player.physics.body.linvel() },
        angularVelocity: { ...player.physics.body.angvel() }, health: player.health,
        weaponCharge: player.physics.weaponCharge, weaponRpm: player.physics.weaponRpm,
        weaponAngle: player.physics.weaponAngle, weaponActive: player.physics.weaponCharge >= 0.12,
        inverted: player.physics.inverted, recovering: player.physics.recovering,
        recoveryProgress: player.physics.recoveryProgress, recoveryCooldown: player.physics.recoveryCooldown,
        wheelSpeedLeft: player.physics.wheelSpeedLeft, wheelSpeedRight: player.physics.wheelSpeedRight,
        connected: player.connected, ready: player.ready, lastInputSeq: player.lastInputSeq,
        damageDealt: player.damageDealt, hits: player.hits,
      })),
      events: this.events.map((event) => ({ ...event, position: { ...event.position } })),
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.players.clear();
    this.world.free();
  }
}

export async function createSimulation(roomId: string): Promise<Simulation> {
  await initializePhysics();
  return new Simulation(roomId);
}
