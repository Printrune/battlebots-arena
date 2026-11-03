import RAPIER from '@dimforge/rapier3d-compat';
import {
  DEBRIS_LIFETIME_SECONDS, IMMOBILIZATION_SECONDS, MAX_DAMAGE_MARKS, MAX_DEBRIS,
  damageParts, pristineDamage,
} from '../shared/damage';
import type { DamagePartId, DebrisSnapshot, RobotDamage } from '../shared/damage';
import { ARENA } from '../shared/protocol';
import type { BotId, PlayerSnapshot } from '../shared/protocol';

type Vector = PlayerSnapshot['position'];
type Rotation = PlayerSnapshot['rotation'];
type Body = InstanceType<typeof RAPIER.RigidBody>;
const AXLE: Rotation = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };

export class ComponentDamage {
  state: RobotDamage;
  private markId = 0;
  constructor(readonly botId: BotId) { this.state = pristineDamage(botId); }

  impact(partId: DamagePartId, amount: number, point: Vector, normal: Vector): boolean {
    const definition = damageParts(this.botId).find((part) => part.id === partId);
    const part = this.state.parts.find((part) => part.id === partId);
    if (!definition || !part) throw new Error(`Invalid ${this.botId} component: ${partId}`);
    const before = part.integrity;
    // Local components fail before hull exhaustion, provided repeated hits actually
    // land on that component. A glancing hit cannot randomly remove another part.
    part.integrity = Math.max(0, part.integrity - Math.max(0, amount) * 1.55 / definition.durability);
    this.markId += 1;
    this.state.revision += 1;
    this.state.marks.push({ id: this.markId, partId, point: { ...point }, normal: { ...normal },
      severity: Math.max(0.04, Math.min(1, amount / 32)) });
    if (this.state.marks.length > MAX_DAMAGE_MARKS) this.state.marks.splice(0, this.state.marks.length - MAX_DAMAGE_MARKS);
    return before > 0 && part.integrity === 0;
  }

  immobilization(seconds: number): void {
    this.state.immobilizedFor = Math.max(0, Math.min(IMMOBILIZATION_SECONDS, seconds));
  }

  snapshot(): RobotDamage {
    return { revision: this.state.revision, parts: this.state.parts.map((part) => ({ ...part })),
      marks: this.state.marks.map((mark) => ({ ...mark, point: { ...mark.point }, normal: { ...mark.normal } })),
      immobilizedFor: this.state.immobilizedFor };
  }

  reset(): void { this.state = pristineDamage(this.botId); this.markId = 0; }
}

interface FragmentPose {
  partId: DamagePartId; localOrigin: Vector; position: Vector; rotation: Rotation;
  velocity: Vector; angularVelocity: Vector; mass: number;
}
export type DetachedFragment = FragmentPose & (
  { kind: 'wheel'; radius: number; width: number } |
  { kind: 'panel'; halfExtents: Vector }
);
interface Debris {
  id: number; ownerId: string; botId: BotId; partId: DamagePartId; localOrigin: Vector;
  body: Body; remaining: number;
}

/** Small rigid fragments, never a second client-side physics simulation. */
export class DebrisSystem {
  private readonly fragments = new Map<number, Debris>();
  private nextId = 0;
  constructor(private readonly world: InstanceType<typeof RAPIER.World>) {}
  get size(): number { return this.fragments.size; }

  spawn(ownerId: string, botId: BotId, fragment: DetachedFragment): void {
    if (this.fragments.size >= MAX_DEBRIS) {
      const oldest = this.fragments.values().next().value;
      if (oldest) this.remove(oldest);
    }
    const position = fragment.position;
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z).setRotation(fragment.rotation)
      .setLinearDamping(0.18).setAngularDamping(0.30).setCcdEnabled(true));
    const shape = fragment.kind === 'wheel'
      ? RAPIER.ColliderDesc.cylinder(fragment.width / 2, fragment.radius).setRotation(AXLE)
      : RAPIER.ColliderDesc.cuboid(fragment.halfExtents.x, fragment.halfExtents.y, fragment.halfExtents.z);
    this.world.createCollider(shape.setMass(fragment.mass).setFriction(0.45).setRestitution(0.25)
      // Fragments interact with the arena and bots, but skip fragment/fragment pairs.
      .setCollisionGroups((0x0002 << 16) | 0x0001), body);
    body.setLinvel(this.limit(fragment.velocity, 14), true);
    body.setAngvel(this.limit(fragment.angularVelocity, 35), true);
    const id = this.nextId++;
    this.fragments.set(id, { id, ownerId, botId, partId: fragment.partId,
      localOrigin: { ...fragment.localOrigin }, body, remaining: DEBRIS_LIFETIME_SECONDS });
  }

  step(dt: number): void {
    for (const fragment of this.fragments.values()) {
      fragment.remaining = Math.max(0, fragment.remaining - dt);
      if (fragment.remaining <= 0) { this.remove(fragment); continue; }
      const position = fragment.body.translation();
      const x = Math.max(-ARENA.halfWidth + 0.1, Math.min(ARENA.halfWidth - 0.1, position.x));
      const z = Math.max(-ARENA.halfDepth + 0.1, Math.min(ARENA.halfDepth - 0.1, position.z));
      if (x !== position.x || z !== position.z || position.y < -2 || position.y > 12) {
        fragment.body.setTranslation({ x, y: Math.max(0.4, Math.min(12, position.y)), z }, true);
      }
      const velocity = fragment.body.linvel();
      if (Math.hypot(velocity.x, velocity.y, velocity.z) > 14) fragment.body.setLinvel(this.limit(velocity, 14), true);
      const angular = fragment.body.angvel();
      if (Math.hypot(angular.x, angular.y, angular.z) > 35) fragment.body.setAngvel(this.limit(angular, 35), true);
    }
  }

  snapshot(): DebrisSnapshot[] {
    return [...this.fragments.values()].map((fragment) => ({
      id: fragment.id, ownerId: fragment.ownerId, botId: fragment.botId, partId: fragment.partId,
      localOrigin: { ...fragment.localOrigin }, position: { ...fragment.body.translation() },
      rotation: { ...fragment.body.rotation() }, velocity: { ...fragment.body.linvel() },
      angularVelocity: { ...fragment.body.angvel() }, remaining: fragment.remaining,
    }));
  }

  clear(): void { for (const fragment of this.fragments.values()) this.remove(fragment); }

  private remove(fragment: Debris): void {
    this.world.removeRigidBody(fragment.body);
    this.fragments.delete(fragment.id);
  }

  private limit(vector: Vector, maximum: number): Vector {
    const magnitude = Math.hypot(vector.x, vector.y, vector.z);
    const ratio = magnitude > maximum ? maximum / magnitude : 1;
    return { x: vector.x * ratio, y: vector.y * ratio, z: vector.z * ratio };
  }
}
