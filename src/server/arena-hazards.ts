import RAPIER from '@dimforge/rapier3d-compat';
import {
  ARENA_LAYOUT, KILLSAWS, KILLSAW_UNLOCK_SECONDS, KILLSAW_WARNING_SECONDS,
  PULVERIZERS, PULVERIZER_COOLDOWN_SECONDS, PULVERIZER_PHASE_SECONDS, SCREWS, pulverizerAngle, pulverizerHead,
} from '../shared/arena';
import type {
  ArenaHazardState, ArenaState, KillsawDefinition, PulverizerDefinition, PulverizerState, ScrewDefinition,
} from '../shared/arena';
import type { PlayerSnapshot } from '../shared/protocol';
import type { RobotPhysics } from './simulation';

type Vector = PlayerSnapshot['position'];
type Rotation = PlayerSnapshot['rotation'];
type Collider = InstanceType<typeof RAPIER.Collider>;
type Body = InstanceType<typeof RAPIER.RigidBody>;
type Shape = InstanceType<typeof RAPIER.Cuboid> | InstanceType<typeof RAPIER.Cylinder>;
const AXLE: Rotation = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
const ZERO: Vector = { x: 0, y: 0, z: 0 };
const SAW_CUT_SECONDS = 1.35;
const SAW_REARM_SECONDS = 1.8;

export interface HazardRobot { id: string; slot: 0 | 1; physics: RobotPhysics }
export interface HazardHit {
  hazardId: string; robotId: string; ownerSlot: 0 | 1 | null;
  damage: number; position: Vector; strength: number;
}
interface Contact { point: Vector; normal: Vector }
interface Screw {
  definition: ScrewDefinition; collider: Collider;
  angle: number; direction: 1 | -1; jamSeconds: number; reverseUntil: number;
  damageAt: Map<string, number>;
}
interface Hammer {
  definition: PulverizerDefinition; body: Body; shape: InstanceType<typeof RAPIER.Cuboid>;
  state: PulverizerState; age: number; previous: Vector; previousRotation: Rotation;
  struck: Set<string>;
}
interface Saw {
  definition: KillsawDefinition; body: Body; shape: InstanceType<typeof RAPIER.Cylinder>;
  state: Extract<ArenaHazardState, { kind: 'killsaw' }>; age: number; rearmAt: number;
  rotation: Rotation; bladeOffsets: Vector[]; damageAt: Map<string, number>;
}

function length(vector: Vector): number { return Math.hypot(vector.x, vector.y, vector.z); }
function subtract(a: Vector, b: Vector): Vector { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function scale(vector: Vector, amount: number): Vector { return { x: vector.x * amount, y: vector.y * amount, z: vector.z * amount }; }
function yaw(value: number): Rotation { return { x: 0, y: Math.sin(value / 2), z: 0, w: Math.cos(value / 2) }; }
function multiply(a: Rotation, b: Rotation): Rotation {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
function rotate(rotation: Rotation, vector: Vector): Vector {
  const tx = 2 * (rotation.y * vector.z - rotation.z * vector.y);
  const ty = 2 * (rotation.z * vector.x - rotation.x * vector.z);
  const tz = 2 * (rotation.x * vector.y - rotation.y * vector.x);
  return { x: vector.x + rotation.w * tx + rotation.y * tz - rotation.z * ty,
    y: vector.y + rotation.w * ty + rotation.z * tx - rotation.x * tz,
    z: vector.z + rotation.w * tz + rotation.x * ty - rotation.y * tx };
}
function hammerRotation(definition: PulverizerDefinition, angle: number): Rotation {
  return multiply(yaw(definition.yaw), { x: Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) });
}
function near(robot: HazardRobot, position: Vector, radius: number): boolean {
  return length(subtract(robot.physics.body.translation(), position)) <= robot.physics.boundingRadius + radius;
}

/** Narrow-phase tests use the moving hazard's real volume, not floor proximity. */
function contactRobot(robot: HazardRobot, shape: Shape, position: Vector, rotation: Rotation,
  radius: number, previous = position, previousRotation = rotation, dt = 1 / 60): Contact | null {
  const travel = subtract(position, previous);
  if (!near(robot, position, radius + length(travel) + 0.03)) return null;
  for (const collider of robot.physics.colliders) {
    const contact = collider.contactShape(shape, position, rotation, 0.015);
    if (contact && contact.distance <= 0.015) return { point: { ...contact.point1 }, normal: scale(contact.normal1, -1) };
    if (length(travel) > 0.025) {
      const cast = collider.castShape(ZERO, shape, previous, previousRotation, scale(travel, 1 / dt), 0.01, dt, true);
      if (cast) {
        const local = rotate(collider.rotation(), cast.witness1);
        const origin = collider.translation();
        return { point: { x: origin.x + local.x, y: origin.y + local.y, z: origin.z + local.z },
          normal: scale(rotate(collider.rotation(), cast.normal1), -1) };
      }
    }
  }
  return null;
}

export class ArenaHazards {
  readonly deckCollider: Collider;
  private readonly screws: Screw[] = [];
  private readonly hammers: Hammer[] = [];
  private readonly saws: Saw[] = [];
  private elapsed = 0;
  private running = false;

  constructor(world: InstanceType<typeof RAPIER.World>) {
    const deck = ARENA_LAYOUT.upperDeck;
    const deckBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(deck.x, deck.height / 2, deck.z));
    this.deckCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(deck.width / 2, deck.height / 2, deck.depth / 2)
      .setFriction(0.45).setRestitution(0.03), deckBody);
    for (const definition of SCREWS) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed()
        .setTranslation(definition.position.x, definition.position.y, definition.position.z)
        .setRotation(multiply(yaw(definition.yaw), AXLE)));
      this.screws.push({ definition, collider: world.createCollider(
        RAPIER.ColliderDesc.cylinder(definition.length / 2, definition.radius).setFriction(0.5).setRestitution(0.05), body),
        angle: 0, direction: 1, jamSeconds: 0, reverseUntil: 0, damageAt: new Map() });
    }
    for (const definition of PULVERIZERS) {
      const state: PulverizerState = { id: definition.id, kind: 'pulverizer', phase: 'idle', progress: 0, cooldown: 0 };
      const position = pulverizerHead(definition, pulverizerAngle(state));
      const rotation = hammerRotation(definition, pulverizerAngle(state));
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(position.x, position.y, position.z).setRotation(rotation));
      const half = definition.headSize / 2;
      world.createCollider(RAPIER.ColliderDesc.cuboid(half, half, half).setSensor(true), body);
      this.hammers.push({ definition, body, shape: new RAPIER.Cuboid(half, half, half), state, age: 0,
        previous: position, previousRotation: rotation, struck: new Set() });
    }
    for (const definition of KILLSAWS) {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(definition.position.x, -definition.radius - 0.1, definition.position.z).setRotation(yaw(definition.yaw)));
      const bladeOffsets: Vector[] = [];
      for (const side of [-1, 1]) {
        const local = { x: side * definition.bladeSpacing / 2, y: 0, z: 0 };
        const offset = rotate(yaw(definition.yaw), local);
        bladeOffsets.push(offset);
        world.createCollider(RAPIER.ColliderDesc.cylinder(0.045, definition.radius).setRotation(AXLE)
          .setTranslation(local.x, 0, 0).setSensor(true), body);
      }
      this.saws.push({ definition, body, shape: new RAPIER.Cylinder(0.045, definition.radius),
        state: { id: definition.id, kind: 'killsaw', phase: 'locked', extension: 0, angle: 0 },
        age: 0, rearmAt: 0, rotation: multiply(yaw(definition.yaw), AXLE), bladeOffsets, damageAt: new Map() });
    }
  }

  trigger(ownerSlot: 0 | 1): boolean {
    let triggered = false;
    for (const hammer of this.hammers) {
      if (hammer.definition.ownerSlot !== ownerSlot || hammer.state.phase !== 'idle' || hammer.state.cooldown > 0) continue;
      hammer.state.phase = 'windup';
      hammer.state.progress = 0;
      hammer.state.cooldown = PULVERIZER_COOLDOWN_SECONDS;
      hammer.age = 0;
      hammer.struck.clear();
      triggered = true;
    }
    return triggered;
  }

  step(dt: number, elapsed: number, robots: readonly HazardRobot[]): HazardHit[] {
    this.running = true;
    this.elapsed = elapsed;
    const hits: HazardHit[] = [];
    for (const screw of this.screws) this.stepScrew(screw, dt, robots, hits);
    for (const hammer of this.hammers) this.stepHammer(hammer, dt, robots, hits);
    for (const saw of this.saws) this.stepSaw(saw, dt, robots, hits);
    return hits;
  }

  private stepScrew(screw: Screw, dt: number, robots: readonly HazardRobot[], hits: HazardHit[]) {
    screw.direction = this.elapsed < screw.reverseUntil ? -1 : 1;
    screw.angle = (screw.angle + screw.direction * dt * 6) % (Math.PI * 2);
    let jammed = false;
    for (const robot of robots) {
      if (!near(robot, screw.definition.position, screw.definition.length / 2 + screw.definition.radius)) continue;
      let contact: Contact | null = null;
      for (const collider of robot.physics.colliders) {
        const actual = screw.collider.contactCollider(collider, 0.025);
        if (actual && actual.distance <= 0.025) { contact = { point: { ...actual.point2 }, normal: { ...actual.normal1 } }; break; }
      }
      if (!contact) continue;
      const velocity = robot.physics.body.linvel();
      if (Math.hypot(velocity.x, velocity.z) < 0.55) jammed = true;
      const mass = robot.physics.body.mass();
      const deckScrew = screw.definition.id.startsWith('screw-deck-');
      if (deckScrew) {
        // A powered screw keeps conveying a contacting chassis around its barrel;
        // the damage cooldown must not turn that surface motion into one tiny hop.
        const lift = screw.direction === 1 ? 4.8 : 3.2;
        const verticalChange = Math.max(0, Math.min(40 * dt, lift - velocity.y));
        const forwardChange = Math.max(-24 * dt, Math.min(24 * dt, screw.direction * 3.6 - velocity.z));
        robot.physics.body.applyImpulse({ x: 0, y: mass * verticalChange, z: mass * forwardChange }, true);
      }
      if (this.elapsed < (screw.damageAt.get(robot.id) ?? -Infinity)) continue;
      screw.damageAt.set(robot.id, this.elapsed + 0.85);
      const axis = { x: Math.cos(screw.definition.yaw), z: -Math.sin(screw.definition.yaw) };
      if (deckScrew) {
        robot.physics.body.applyImpulse({ x: mass * axis.x * screw.direction * 0.2,
          y: mass * Math.max(0, (screw.direction === 1 ? 5 : 3.2) - robot.physics.body.linvel().y),
          z: mass * Math.max(-4, Math.min(4, screw.direction * 4 - robot.physics.body.linvel().z)) }, true);
      } else {
        robot.physics.body.applyImpulseAtPoint({ x: mass * (contact.normal.x * 0.5 + axis.x * screw.direction * 0.35),
          y: mass * 1.7, z: mass * (contact.normal.z * 0.5 + axis.z * screw.direction * 0.35) }, contact.point, true);
      }
      robot.physics.body.applyTorqueImpulse({ x: axis.x * mass * 0.13 * screw.direction, y: 0,
        z: axis.z * mass * 0.13 * screw.direction }, true);
      robot.physics.absorbHit();
      hits.push({ hazardId: screw.definition.id, robotId: robot.id, ownerSlot: null, damage: 1.5,
        position: contact.point, strength: 0.25 });
    }
    screw.jamSeconds = jammed && this.elapsed >= screw.reverseUntil ? screw.jamSeconds + dt : 0;
    if (screw.jamSeconds >= 1.15) {
      screw.reverseUntil = this.elapsed + 1.2;
      screw.direction = -1;
      screw.jamSeconds = 0;
    }
  }

  private stepHammer(hammer: Hammer, dt: number, robots: readonly HazardRobot[], hits: HazardHit[]) {
    hammer.state.cooldown = Math.max(0, hammer.state.cooldown - dt);
    if (hammer.state.phase === 'idle') return;
    hammer.age += dt;
    while (hammer.state.phase !== 'idle') {
      const duration = PULVERIZER_PHASE_SECONDS[hammer.state.phase];
      if (hammer.age < duration - 0.000001) break;
      hammer.age -= duration;
      hammer.state.phase = hammer.state.phase === 'windup' ? 'strike' : hammer.state.phase === 'strike' ? 'recover' : 'idle';
    }
    hammer.state.progress = hammer.state.phase === 'idle' ? 0 : Math.max(0, Math.min(1, hammer.age / PULVERIZER_PHASE_SECONDS[hammer.state.phase]));
    const angle = pulverizerAngle(hammer.state);
    const position = pulverizerHead(hammer.definition, angle);
    const rotation = hammerRotation(hammer.definition, angle);
    hammer.body.setNextKinematicTranslation(position);
    hammer.body.setNextKinematicRotation(rotation);
    if (hammer.state.phase === 'strike') {
      for (const robot of robots) {
        if (hammer.struck.has(robot.id)) continue;
        const contact = contactRobot(robot, hammer.shape, position, rotation, hammer.definition.headSize,
          hammer.previous, hammer.previousRotation, dt);
        if (!contact) continue;
        hammer.struck.add(robot.id);
        const mass = robot.physics.body.mass();
        robot.physics.body.applyImpulseAtPoint({ x: Math.sin(hammer.definition.yaw) * mass * 0.45,
          y: -mass * 2.0, z: Math.cos(hammer.definition.yaw) * mass * 0.45 }, contact.point, true);
        robot.physics.absorbHit();
        hits.push({ hazardId: hammer.definition.id, robotId: robot.id, ownerSlot: hammer.definition.ownerSlot,
          damage: 7, position: contact.point, strength: 0.6 });
      }
    }
    hammer.previous = position;
    hammer.previousRotation = rotation;
  }

  private stepSaw(saw: Saw, dt: number, robots: readonly HazardRobot[], hits: HazardHit[]) {
    if (this.elapsed + 0.000001 < KILLSAW_UNLOCK_SECONDS) return;
    if (saw.state.phase === 'locked') saw.state.phase = 'armed';
    const proximity = robots.some((robot) => {
      const position = robot.physics.body.translation();
      return position.y < 2.2 && Math.hypot(position.x - saw.definition.position.x, position.z - saw.definition.position.z) < robot.physics.boundingRadius + 0.8;
    });
    if (saw.state.phase === 'armed' && this.elapsed >= saw.rearmAt && proximity) {
      saw.state.phase = 'warning'; saw.age = 0;
    } else if (saw.state.phase === 'warning') {
      saw.age += dt;
      if (saw.age >= KILLSAW_WARNING_SECONDS - 0.000001) { saw.state.phase = 'cutting'; saw.age = 0; }
    } else if (saw.state.phase === 'cutting') {
      saw.age += dt;
      if (saw.age >= SAW_CUT_SECONDS - 0.000001) {
        saw.state.phase = 'armed'; saw.state.extension = 0; saw.rearmAt = this.elapsed + SAW_REARM_SECONDS;
      }
    }
    saw.state.extension = saw.state.phase === 'cutting'
      ? Math.max(0, Math.min(1, saw.age / 0.14, (SAW_CUT_SECONDS - saw.age) / 0.25)) : 0;
    if (saw.state.phase === 'warning' || saw.state.phase === 'cutting') saw.state.angle = (saw.state.angle + dt * 40) % (Math.PI * 2);
    const height = -saw.definition.radius - 0.1 + saw.state.extension * (saw.definition.radius - 0.08);
    saw.body.setNextKinematicTranslation({ x: saw.definition.position.x, y: height, z: saw.definition.position.z });
    if (saw.state.phase !== 'cutting' || saw.state.extension < 0.2) return;
    for (const robot of robots) {
      if (this.elapsed < (saw.damageAt.get(robot.id) ?? -Infinity)) continue;
      let contact: Contact | null = null;
      for (const offset of saw.bladeOffsets) {
        contact = contactRobot(robot, saw.shape, { x: saw.definition.position.x + offset.x, y: height,
          z: saw.definition.position.z + offset.z }, saw.rotation, saw.definition.radius);
        if (contact) break;
      }
      if (!contact) continue;
      saw.damageAt.set(robot.id, this.elapsed + 0.5);
      const mass = robot.physics.body.mass();
      robot.physics.body.applyImpulseAtPoint({ x: contact.normal.x * mass * 0.25, y: mass * 0.9,
        z: contact.normal.z * mass * 0.25 }, contact.point, true);
      robot.physics.absorbHit();
      hits.push({ hazardId: saw.definition.id, robotId: robot.id, ownerSlot: null,
        damage: 3.5, position: contact.point, strength: 0.35 });
    }
  }

  snapshot(): ArenaState {
    return { elapsed: this.elapsed, hazards: [
      ...this.screws.map<Extract<ArenaHazardState, { kind: 'screw' }>>((screw) => ({ id: screw.definition.id, kind: 'screw',
        active: this.running, angle: screw.angle, direction: screw.direction })),
      ...this.hammers.map((hammer) => ({ ...hammer.state })),
      ...this.saws.map((saw) => ({ ...saw.state })),
    ] };
  }

  freeze(): void { this.running = false; }

  reset(): void {
    this.elapsed = 0; this.running = false;
    for (const screw of this.screws) {
      screw.angle = 0; screw.direction = 1; screw.jamSeconds = 0; screw.reverseUntil = 0; screw.damageAt.clear();
    }
    for (const hammer of this.hammers) {
      hammer.state = { id: hammer.definition.id, kind: 'pulverizer', phase: 'idle', progress: 0, cooldown: 0 };
      hammer.age = 0; hammer.struck.clear();
      hammer.previous = pulverizerHead(hammer.definition, pulverizerAngle(hammer.state));
      hammer.previousRotation = hammerRotation(hammer.definition, pulverizerAngle(hammer.state));
      hammer.body.setTranslation(hammer.previous, false); hammer.body.setRotation(hammer.previousRotation, false);
      hammer.body.setNextKinematicTranslation(hammer.previous); hammer.body.setNextKinematicRotation(hammer.previousRotation);
    }
    for (const saw of this.saws) {
      saw.state = { id: saw.definition.id, kind: 'killsaw', phase: 'locked', extension: 0, angle: 0 };
      saw.age = 0; saw.rearmAt = 0; saw.damageAt.clear();
      const position = { x: saw.definition.position.x, y: -saw.definition.radius - 0.1, z: saw.definition.position.z };
      saw.body.setTranslation(position, false); saw.body.setNextKinematicTranslation(position);
    }
  }
}
