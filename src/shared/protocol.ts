import { z } from 'zod';
import { ARENA_LAYOUT, ARENA_MATCH_SECONDS, arenaStateSchema } from './arena';
import { damageParts, debrisSnapshotSchema, MAX_DEBRIS, robotDamageSchema } from './damage';

export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 15;
export const MATCH_SECONDS = ARENA_MATCH_SECONDS;
export const COUNTDOWN_SECONDS = 3;
export const RECONNECT_SECONDS = 15;
export const INPUT_TIMEOUT_MS = 350;
export const ARENA = ARENA_LAYOUT;

export const botIdSchema = z.enum(['witchdoctor', 'tombstone']);
export type BotId = z.infer<typeof botIdSchema>;
export const paintIdSchema = z.enum(['signature', 'ember', 'glacier', 'ultraviolet']);
export type PaintId = z.infer<typeof paintIdSchema>;

export interface BotPhysics {
  mass: number;
  halfExtents: { x: number; y: number; z: number };
  chassisOffset: { x: number; y: number; z: number };
  wheelRadius: number;
  wheelWidth: number;
  wheelZ: number[];
  trackWidth: number;
  acceleration: number;
  braking: number;
  lateralGrip: number;
  angularAcceleration: number;
  invertible: boolean;
  selfRight: boolean;
}

export interface BotWeapon {
  kind: 'vertical-disc' | 'horizontal-bar';
  mount: { x: number; y: number; z: number };
  radius: number;
  halfWidth: number;
  spinUpSeconds: number;
  coastDownSeconds: number;
  maxRpm: number;
  spinDirection: 1 | -1;
  energyLossOnHit: number;
  gyroStrength: number;
  rotorMassKg: number;
  inertiaKgFt2: number;
}

export interface BotDefinition {
  id: BotId;
  name: string;
  category: string;
  tagline: string;
  number: string;
  speed: number;
  turnSpeed: number;
  damage: number;
  weaponReach: number;
  weaponCooldown: number;
  accent: string;
  stats: { power: number; speed: number; armor: number };
  physics: BotPhysics;
  weapon: BotWeapon;
}

export const BOTS: Record<BotId, BotDefinition> = {
  witchdoctor: {
    id: 'witchdoctor', name: 'Witch Doctor', category: 'VERTICAL SPINNER',
    tagline: 'Four-wheel drive. A devastating vertical drisc.', number: '01', speed: 7.8,
    turnSpeed: 2.35, damage: 23, weaponReach: 2.8, weaponCooldown: 0.32,
    accent: '#75bf35', stats: { power: 4, speed: 5, armor: 3 },
    // Game-space proportions reconstructed from the WCVII reference photographs.
    // Drive/weapon tuning is an approximation, not unpublished team CAD or telemetry.
    physics: {
      mass: 113.4, halfExtents: { x: 0.95, y: 0.22, z: 0.95 },
      chassisOffset: { x: 0, y: -0.12, z: -0.14 }, wheelRadius: 0.46,
      wheelWidth: 0.36, wheelZ: [-0.63, 0.63], trackWidth: 2,
      acceleration: 11, braking: 15, lateralGrip: 7.5, angularAcceleration: 6,
      invertible: true, selfRight: true,
    },
    weapon: {
      kind: 'vertical-disc', mount: { x: 0, y: 0.22, z: 1.08 }, radius: 0.62,
      halfWidth: 0.39, spinUpSeconds: 2.1, coastDownSeconds: 5.5,
      maxRpm: 4_500, spinDirection: -1, energyLossOnHit: 0.45, gyroStrength: 0.8,
      rotorMassKg: 20.4, inertiaKgFt2: 4.7,
    },
  },
  tombstone: {
    id: 'tombstone', name: 'Tombstone', category: 'HORIZONTAL SPINNER',
    tagline: 'Two wheels. One massive horizontal bar.', number: '02', speed: 6.4,
    turnSpeed: 2.65, damage: 31, weaponReach: 3.4, weaponCooldown: 0.45,
    accent: '#89928e', stats: { power: 5, speed: 3, armor: 4 },
    physics: {
      mass: 113.4, halfExtents: { x: 0.97, y: 0.22, z: 0.65 },
      chassisOffset: { x: 0, y: -0.18, z: -0.70 }, wheelRadius: 0.62,
      wheelWidth: 0.4, wheelZ: [-0.65], trackWidth: 2.34,
      acceleration: 7.5, braking: 10, lateralGrip: 4.5, angularAcceleration: 5,
      invertible: true, selfRight: false,
    },
    weapon: {
      kind: 'horizontal-bar', mount: { x: 0, y: -0.30, z: 1.67 }, radius: 1.65,
      halfWidth: 0.1, spinUpSeconds: 3.2, coastDownSeconds: 8,
      maxRpm: 2_000, spinDirection: 1, energyLossOnHit: 0.55, gyroStrength: 0.2,
      rotorMassKg: 31.8, inertiaKgFt2: 28.9,
    },
  },
};

export const PAINTS: { id: PaintId; name: string; color: string }[] = [
  { id: 'signature', name: 'Signature', color: '#a5d549' },
  { id: 'ember', name: 'Ember', color: '#ee7548' },
  { id: 'glacier', name: 'Glacier', color: '#77d8df' },
  { id: 'ultraviolet', name: 'Ultraviolet', color: '#a58af5' },
];

export function paintColor(botId: BotId, paint: PaintId): string {
  return paint === 'signature' ? BOTS[botId].accent : PAINTS.find((item) => item.id === paint)?.color ?? BOTS[botId].accent;
}

export const selectionSchema = z.object({ botId: botIdSchema, paint: paintIdSchema });
export type CosmeticSelection = z.infer<typeof selectionSchema>;
export const playerInputSchema = z.object({
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  throttle: z.number().finite().min(-1).max(1),
  steer: z.number().finite().min(-1).max(1),
  weapon: z.boolean(),
  recover: z.boolean(),
});
export type PlayerInput = z.infer<typeof playerInputSchema>;
export const NEUTRAL_INPUT: PlayerInput = { seq: 0, throttle: 0, steer: 0, weapon: false, recover: false };

export const vectorSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });
export const quaternionSchema = vectorSchema.extend({ w: z.number() });
export const playerSnapshotSchema = z.object({
  id: z.string(), name: z.string(), botId: botIdSchema, paint: paintIdSchema,
  spawnSlot: z.union([z.literal(0), z.literal(1)]),
  position: vectorSchema, rotation: quaternionSchema, yaw: z.number(),
  velocity: vectorSchema, health: z.number(), weaponCharge: z.number(),
  angularVelocity: vectorSchema, weaponRpm: z.number(), weaponAngle: z.number(),
  grounded: z.boolean(),
  inverted: z.boolean(), recovering: z.boolean(), recoveryProgress: z.number(),
  recoveryCooldown: z.number(), wheelSpeedLeft: z.number(), wheelSpeedRight: z.number(),
  weaponActive: z.boolean(), connected: z.boolean(), ready: z.boolean(),
  lastInputSeq: z.number(), damageDealt: z.number(), hits: z.number(),
  damage: robotDamageSchema,
}).superRefine((player, context) => {
  const expected = damageParts(player.botId);
  const ids = new Set(player.damage.parts.map((part) => part.id));
  if (ids.size !== expected.length || player.damage.parts.length !== expected.length || expected.some((part) => !ids.has(part.id))) {
    context.addIssue({ code: 'custom', path: ['damage', 'parts'], message: 'Damage parts must match the selected robot.' });
  }
});
export type PlayerSnapshot = z.infer<typeof playerSnapshotSchema>;
export const matchResultSchema = z.object({
  winnerId: z.string().nullable(), reason: z.enum(['knockout', 'timeout', 'draw', 'forfeit', 'abandoned']),
});
export type MatchResult = z.infer<typeof matchResultSchema>;
export const matchPhaseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('lobby') }),
  z.object({ kind: z.literal('countdown'), seconds: z.number() }),
  z.object({ kind: z.literal('fighting'), seconds: z.number() }),
  z.object({ kind: z.literal('finished'), result: matchResultSchema }),
]);
export type MatchPhase = z.infer<typeof matchPhaseSchema>;
export const matchEventSchema = z.object({
  id: z.number(), kind: z.enum(['hit', 'recover', 'hazard', 'break', 'landing', 'explosion']), sourceId: z.string(),
  targetId: z.string(), position: vectorSchema, strength: z.number(),
});
export type MatchEvent = z.infer<typeof matchEventSchema>;
export const matchSnapshotSchema = z.object({
  roomId: z.string(), tick: z.number(), phase: matchPhaseSchema,
  players: z.array(playerSnapshotSchema), events: z.array(matchEventSchema),
  arena: arenaStateSchema,
  debris: z.array(debrisSnapshotSchema).max(MAX_DEBRIS),
});
export type MatchState = z.infer<typeof matchSnapshotSchema>;

export const joinOptionsSchema = selectionSchema.extend({
  name: z.string().trim().min(1).max(20),
  practice: z.boolean().default(false),
});
export type JoinOptions = z.infer<typeof joinOptionsSchema>;

export interface ArenaRenderer {
  update(snapshot: MatchState, localId: string | null): void;
  setInput(input: PlayerInput): void;
  setPreview(botId: BotId, paint: PaintId): void;
  setOverview(enabled: boolean): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

/** Shared arcade drive model. Local rendering may predict it; the server remains authoritative. */
export function driveVelocity(yaw: number, throttle: number, speed: number): { x: number; z: number } {
  return { x: Math.sin(yaw) * throttle * speed, z: Math.cos(yaw) * throttle * speed };
}
