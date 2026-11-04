import { z } from 'zod';
import { joinOptionsSchema, matchSnapshotSchema, playerInputSchema } from '../shared/protocol';

export const practiceCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('init'), selection: joinOptionsSchema }),
  z.object({ kind: z.literal('input'), input: playerInputSchema }),
  z.object({ kind: z.literal('ready') }),
  z.object({ kind: z.literal('rematch') }),
  z.object({ kind: z.literal('pulverize') }),
  z.object({ kind: z.literal('sync') }),
  z.object({ kind: z.literal('stop') }),
]);
export type PracticeCommand = z.infer<typeof practiceCommandSchema>;
export const practiceResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('created'), roomId: z.string(), localId: z.string() }),
  z.object({ kind: z.literal('snapshot'), snapshot: matchSnapshotSchema, localId: z.string() }),
  z.object({ kind: z.literal('error'), message: z.string() }),
  z.object({ kind: z.literal('stopped') }),
]);
export type PracticeResponse = z.infer<typeof practiceResponseSchema>;
