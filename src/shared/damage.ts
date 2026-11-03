import { z } from 'zod';
import type { BotId } from './protocol';

export const damagePartIdSchema = z.enum([
  'wheel-front-left', 'wheel-front-right', 'wheel-rear-left', 'wheel-rear-right', 'wheel-left', 'wheel-right',
  'armor-left', 'armor-right', 'armor-top', 'armor-rear', 'weapon',
]);
export type DamagePartId = z.infer<typeof damagePartIdSchema>;
export const IMMOBILIZATION_SECONDS = 10;
export const MAX_DAMAGE_MARKS = 12;
export const MAX_DEBRIS = 16;
export const DEBRIS_LIFETIME_SECONDS = 16;

export interface DamagePartDefinition {
  id: DamagePartId;
  kind: 'wheel' | 'armor' | 'weapon';
  label: string;
  side: 'left' | 'right' | 'center';
  durability: number;
  detachable: boolean;
}

const ARMOR: DamagePartDefinition[] = [
  { id: 'armor-left', kind: 'armor', label: 'Left armor', side: 'left', durability: 36, detachable: true },
  { id: 'armor-right', kind: 'armor', label: 'Right armor', side: 'right', durability: 36, detachable: true },
  { id: 'armor-rear', kind: 'armor', label: 'Rear armor', side: 'center', durability: 42, detachable: true },
];
function wheel(id: DamagePartId, label: string, side: 'left' | 'right', durability: number): DamagePartDefinition {
  return { id, kind: 'wheel', label, side, durability, detachable: true };
}
const PARTS: Record<BotId, DamagePartDefinition[]> = {
  witchdoctor: [
    wheel('wheel-rear-left', 'Left rear wheel', 'left', 44), wheel('wheel-rear-right', 'Right rear wheel', 'right', 44),
    wheel('wheel-front-left', 'Left front wheel', 'left', 44), wheel('wheel-front-right', 'Right front wheel', 'right', 44),
    ...ARMOR,
    { id: 'armor-top', kind: 'armor', label: 'Ribcage armor', side: 'center', durability: 58, detachable: false },
    { id: 'weapon', kind: 'weapon', label: 'Vertical weapon', side: 'center', durability: 72, detachable: false },
  ],
  tombstone: [
    wheel('wheel-left', 'Left wheel', 'left', 60), wheel('wheel-right', 'Right wheel', 'right', 60),
    ...ARMOR,
    { id: 'armor-top', kind: 'armor', label: 'Top armor', side: 'center', durability: 48, detachable: true },
    { id: 'weapon', kind: 'weapon', label: 'Horizontal weapon', side: 'center', durability: 72, detachable: false },
  ],
};

export function damageParts(botId: BotId): readonly DamagePartDefinition[] { return PARTS[botId]; }
export function wheelPartId(botId: BotId, x: number, z: number): DamagePartId {
  if (botId === 'tombstone') return x < 0 ? 'wheel-left' : 'wheel-right';
  return z > 0 ? x < 0 ? 'wheel-front-left' : 'wheel-front-right' : x < 0 ? 'wheel-rear-left' : 'wheel-rear-right';
}

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite() });
const rotationSchema = pointSchema.extend({ w: z.number().finite() });
export const damageMarkSchema = z.object({
  id: z.number().int().nonnegative(), partId: damagePartIdSchema,
  point: pointSchema, normal: pointSchema, severity: z.number().min(0).max(1),
});
export type DamageMark = z.infer<typeof damageMarkSchema>;
export const robotDamageSchema = z.object({
  revision: z.number().int().nonnegative(),
  parts: z.array(z.object({ id: damagePartIdSchema, integrity: z.number().min(0).max(1) })).min(1).max(9),
  marks: z.array(damageMarkSchema).max(MAX_DAMAGE_MARKS),
  immobilizedFor: z.number().min(0).max(IMMOBILIZATION_SECONDS),
});
export type RobotDamage = z.infer<typeof robotDamageSchema>;

export function pristineDamage(botId: BotId): RobotDamage {
  return { revision: 0, parts: damageParts(botId).map((part) => ({ id: part.id, integrity: 1 })), marks: [], immobilizedFor: 0 };
}
export function partIntegrity(damage: RobotDamage, id: DamagePartId): number {
  return damage.parts.find((part) => part.id === id)?.integrity ?? 0;
}
/** Shared drive condition keeps visual prediction and authoritative handling aligned. */
export function driveCondition(botId: BotId, damage: RobotDamage): { left: number; right: number; wheels: number; total: number } {
  let left = 0; let right = 0; let wheels = 0; let leftCount = 0; let rightCount = 0;
  for (const part of damageParts(botId)) {
    if (part.kind !== 'wheel') continue;
    const integrity = partIntegrity(damage, part.id);
    const traction = integrity <= 0 ? 0 : 0.62 + Math.min(1, integrity / 0.65) * 0.38;
    if (integrity > 0) wheels += 1;
    if (part.side === 'left') { left += traction; leftCount += 1; }
    else { right += traction; rightCount += 1; }
  }
  return { left: left / leftCount, right: right / rightCount, wheels, total: leftCount + rightCount };
}

export function damagedDriveTuning(botId: BotId, damage: RobotDamage): { speedScale: number; turnScale: number; yawPull: number } {
  const condition = driveCondition(botId, damage);
  const average = (condition.left + condition.right) / 2;
  const onePoweredSide = condition.left === 0 || condition.right === 0;
  return {
    speedScale: condition.wheels === 0 ? 0 : onePoweredSide ? 0.38 * Math.max(condition.left, condition.right) : average,
    turnScale: condition.wheels === 0 ? 0 : onePoweredSide ? 0.65 : 0.55 + 0.45 * average,
    yawPull: (condition.left - condition.right) * 0.5,
  };
}

export const debrisSnapshotSchema = z.object({
  id: z.number().int().nonnegative(), ownerId: z.string(), botId: z.enum(['witchdoctor', 'tombstone']),
  partId: damagePartIdSchema, position: pointSchema, rotation: rotationSchema,
  localOrigin: pointSchema,
  velocity: pointSchema, angularVelocity: pointSchema, remaining: z.number().nonnegative(),
});
export type DebrisSnapshot = z.infer<typeof debrisSnapshotSchema>;
