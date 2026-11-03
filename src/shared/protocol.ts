import { z } from 'zod';

export const TICK_RATE = 30;
export const SNAPSHOT_RATE = 15;
export const MATCH_SECONDS = 120;
export const COUNTDOWN_SECONDS = 3;
export const RECONNECT_SECONDS = 15;
export const INPUT_TIMEOUT_MS = 350;
export const ARENA = { halfWidth: 13, halfDepth: 17, wallHeight: 2.5 };

export const botIdSchema = z.enum(['witchdoctor', 'tombstone']);
export type BotId = z.infer<typeof botIdSchema>;
export const paintIdSchema = z.enum(['signature', 'ember', 'glacier', 'ultraviolet']);
export type PaintId = z.infer<typeof paintIdSchema>;

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
}

export const BOTS: Record<BotId, BotDefinition> = {
  witchdoctor: {
    id: 'witchdoctor', name: 'Witch Doctor', category: 'VERTICAL SPINNER',
    tagline: 'A little magic. A lot of mayhem.', number: '01', speed: 8.2,
    turnSpeed: 2.5, damage: 16, weaponReach: 2.8, weaponCooldown: 0.65,
    accent: '#a5d549', stats: { power: 4, speed: 5, armor: 3 },
  },
  tombstone: {
    id: 'tombstone', name: 'Tombstone', category: 'HORIZONTAL SPINNER',
    tagline: 'One hit can change everything.', number: '02', speed: 6.7,
    turnSpeed: 2.1, damage: 22, weaponReach: 3.1, weaponCooldown: 0.9,
    accent: '#6caff4', stats: { power: 5, speed: 3, armor: 4 },
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
  position: vectorSchema, rotation: quaternionSchema, yaw: z.number(),
  velocity: vectorSchema, health: z.number(), weaponCharge: z.number(),
  weaponActive: z.boolean(), connected: z.boolean(), ready: z.boolean(),
  lastInputSeq: z.number(), damageDealt: z.number(), hits: z.number(),
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
  id: z.number(), kind: z.enum(['hit', 'recover']), sourceId: z.string(),
  targetId: z.string(), position: vectorSchema, strength: z.number(),
});
export type MatchEvent = z.infer<typeof matchEventSchema>;
export const matchSnapshotSchema = z.object({
  roomId: z.string(), tick: z.number(), phase: matchPhaseSchema,
  players: z.array(playerSnapshotSchema), events: z.array(matchEventSchema),
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
  setMuted(muted: boolean): void;
  dispose(): void;
}

/** Shared arcade drive model. Local rendering may predict it; the server remains authoritative. */
export function driveVelocity(yaw: number, throttle: number, speed: number): { x: number; z: number } {
  return { x: Math.sin(yaw) * throttle * speed, z: Math.cos(yaw) * throttle * speed };
}
