import { PULVERIZERS, pulverizerHead } from './arena';
import { BOTS } from './protocol';
import type { MatchState, PlayerInput } from './protocol';

/** The same opponent drives both server practice and static-hosted practice. */
export function practiceBotControls(snapshot: MatchState, sequence: number): { input: PlayerInput; pulverize: boolean } | null {
  const bot = snapshot.players.find((player) => player.id === 'practice-bot');
  const human = snapshot.players.find((player) => player.id !== 'practice-bot');
  if (!bot || !human) return null;
  const desired = Math.atan2(human.position.x - bot.position.x, human.position.z - bot.position.z);
  const angle = Math.atan2(Math.sin(desired - bot.yaw), Math.cos(desired - bot.yaw));
  const distance = Math.hypot(human.position.x - bot.position.x, human.position.z - bot.position.z);
  return {
    input: {
      seq: sequence, throttle: Math.abs(angle) > 1.1 ? 0.15 : distance > 2 ? 0.8 : 0.4,
      steer: Math.max(-1, Math.min(1, angle / BOTS[bot.botId].turnSpeed * 3)),
      weapon: true, recover: sequence % 120 === 0,
    },
    pulverize: PULVERIZERS.some((definition) => {
      if (definition.ownerSlot !== bot.spawnSlot) return false;
      const head = pulverizerHead(definition, 1.22);
      return Math.hypot(human.position.x - head.x, human.position.z - head.z) < 3 && human.position.y < 2;
    }),
  };
}
