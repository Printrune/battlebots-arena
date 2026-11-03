import { z } from 'zod';

/** WCVII-era layout in game feet. Fine dimensions are photo-based approximations. */
export const ARENA_LAYOUT = {
  halfWidth: 24, halfDepth: 24, wallHeight: 8,
  railHeight: 1.15,
  upperDeck: { x: 0, z: 20, width: 16, depth: 8, height: 0.5 },
  spawnZ: 10,
};
export const ARENA_MATCH_SECONDS = 180;
export const KILLSAW_UNLOCK_SECONDS = ARENA_MATCH_SECONDS - 60;
export const KILLSAW_WARNING_SECONDS = 0.65;
export const PULVERIZER_COOLDOWN_SECONDS = 3.5;
export const PULVERIZER_PHASE_SECONDS = { windup: 0.35, strike: 0.22, recover: 0.85 };

type Point = { x: number; y: number; z: number };
export interface ScrewDefinition {
  id: string; kind: 'screw'; position: Point; yaw: number; length: number; radius: number;
}
export interface PulverizerDefinition {
  id: string; kind: 'pulverizer'; pivot: Point; yaw: number; armLength: number;
  headSize: number; ownerSlot: 0 | 1;
}
export interface KillsawDefinition {
  id: string; kind: 'killsaw'; position: Point; yaw: number; radius: number;
  bladeSpacing: number;
}
export type ArenaHazardDefinition = ScrewDefinition | PulverizerDefinition | KillsawDefinition;

export const SCREWS: ScrewDefinition[] = [
  { id: 'screw-south-left', kind: 'screw', position: { x: -13, y: 0.65, z: -22.85 }, yaw: 0, length: 8, radius: 0.55 },
  { id: 'screw-south-right', kind: 'screw', position: { x: 13, y: 0.65, z: -22.85 }, yaw: 0, length: 8, radius: 0.55 },
  { id: 'screw-north-left', kind: 'screw', position: { x: -16, y: 0.65, z: 22.85 }, yaw: 0, length: 6, radius: 0.55 },
  { id: 'screw-north-right', kind: 'screw', position: { x: 16, y: 0.65, z: 22.85 }, yaw: 0, length: 6, radius: 0.55 },
  { id: 'screw-west-south', kind: 'screw', position: { x: -22.85, y: 0.65, z: -13 }, yaw: Math.PI / 2, length: 8, radius: 0.55 },
  { id: 'screw-west-north', kind: 'screw', position: { x: -22.85, y: 0.65, z: 13 }, yaw: Math.PI / 2, length: 8, radius: 0.55 },
  { id: 'screw-east-south', kind: 'screw', position: { x: 22.85, y: 0.65, z: -13 }, yaw: Math.PI / 2, length: 8, radius: 0.55 },
  { id: 'screw-east-north', kind: 'screw', position: { x: 22.85, y: 0.65, z: 13 }, yaw: Math.PI / 2, length: 8, radius: 0.55 },
  { id: 'screw-deck-left', kind: 'screw', position: { x: -4, y: 0.72, z: 15.85 }, yaw: 0, length: 7.4, radius: 0.55 },
  { id: 'screw-deck-right', kind: 'screw', position: { x: 4, y: 0.72, z: 15.85 }, yaw: 0, length: 7.4, radius: 0.55 },
];

export const PULVERIZERS: PulverizerDefinition[] = [
  { id: 'pulverizer-sw', kind: 'pulverizer', pivot: { x: -21.8, y: 4.1, z: -21.8 }, yaw: Math.PI / 4, armLength: 3.65, headSize: 1.35, ownerSlot: 0 },
  { id: 'pulverizer-ne', kind: 'pulverizer', pivot: { x: 21.8, y: 4.1, z: 21.8 }, yaw: -3 * Math.PI / 4, armLength: 3.65, headSize: 1.35, ownerSlot: 0 },
  { id: 'pulverizer-se', kind: 'pulverizer', pivot: { x: 21.8, y: 4.1, z: -21.8 }, yaw: -Math.PI / 4, armLength: 3.65, headSize: 1.35, ownerSlot: 1 },
  { id: 'pulverizer-nw', kind: 'pulverizer', pivot: { x: -21.8, y: 4.1, z: 21.8 }, yaw: 3 * Math.PI / 4, armLength: 3.65, headSize: 1.35, ownerSlot: 1 },
];

export const KILLSAWS: KillsawDefinition[] = [-10, 0, 10].flatMap((z, row) => [-7, 7].map((x, column): KillsawDefinition => ({
  id: `killsaw-${row}-${column}`, kind: 'killsaw',
  position: { x, y: 0, z }, yaw: row === 1 ? Math.PI / 2 : 0, radius: 0.72, bladeSpacing: 0.38,
})));

export const ARENA_HAZARDS: ArenaHazardDefinition[] = [...SCREWS, ...PULVERIZERS, ...KILLSAWS];

export const screwStateSchema = z.object({
  id: z.string(), kind: z.literal('screw'), active: z.boolean(), angle: z.number(), direction: z.union([z.literal(1), z.literal(-1)]),
});
export const pulverizerStateSchema = z.object({
  id: z.string(), kind: z.literal('pulverizer'), phase: z.enum(['idle', 'windup', 'strike', 'recover']),
  progress: z.number(), cooldown: z.number(),
});
export const killsawStateSchema = z.object({
  id: z.string(), kind: z.literal('killsaw'), phase: z.enum(['locked', 'armed', 'warning', 'cutting']),
  extension: z.number(), angle: z.number(),
});
export const arenaHazardStateSchema = z.discriminatedUnion('kind', [screwStateSchema, pulverizerStateSchema, killsawStateSchema]);
export type ArenaHazardState = z.infer<typeof arenaHazardStateSchema>;
export type PulverizerState = z.infer<typeof pulverizerStateSchema>;
export const arenaStateSchema = z.object({ elapsed: z.number(), hazards: z.array(arenaHazardStateSchema) });
export type ArenaState = z.infer<typeof arenaStateSchema>;

/** Angle from the raised horizontal arm toward the floor. Shared by hit geometry and animation. */
export function pulverizerAngle(state: Pick<PulverizerState, 'phase' | 'progress'>): number {
  const progress = Math.max(0, Math.min(1, state.progress));
  switch (state.phase) {
    case 'idle': return -0.22;
    case 'windup': return -0.22 - Math.sin(progress * Math.PI / 2) * 0.28;
    case 'strike': return -0.5 + progress * 1.72;
    case 'recover': return 1.22 - progress * 1.44;
  }
}

export function pulverizerHead(definition: PulverizerDefinition, angle: number): Point {
  const reach = Math.cos(angle) * definition.armLength;
  return {
    x: definition.pivot.x + Math.sin(definition.yaw) * reach,
    y: definition.pivot.y - Math.sin(angle) * definition.armLength,
    z: definition.pivot.z + Math.cos(definition.yaw) * reach,
  };
}
