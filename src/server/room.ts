import { performance } from 'node:perf_hooks';
import { Room, ServerError } from '@colyseus/core';
import type { AuthContext, Client } from '@colyseus/core';
import {
  BOTS, RECONNECT_SECONDS, SNAPSHOT_RATE, TICK_RATE,
  joinOptionsSchema, playerInputSchema,
} from '../shared/protocol';
import { sessionValid, SESSION_COOKIE } from './auth';
import type { AuthConfig } from './auth';
import { createSimulation } from './simulation';
import type { Simulation } from './simulation';
import { PULVERIZERS, pulverizerHead } from '../shared/arena';

interface RoomDependencies { auth: AuthConfig; maxRooms: number }
export const roomMetrics = {
  activeRooms: 0, totalMatches: 0, ticks: 0, maxTickMs: 0, totalTickMs: 0,
};

export function createArenaRoom(dependencies: RoomDependencies) {
  return class ArenaRoom extends Room {
    maxClients = 2;
    private simulation!: Simulation;
    private practice = false;
    private botSequence = 0;
    private snapshotTicks = 0;
    private rematchVotes = new Set<string>();
    private announcedFinished = false;
    private acquiredSlot = false;
    private accumulator = 0;
    private previousStepAt = performance.now();
    private messageWindows = new Map<string, { since: number; count: number }>();

    onAuth(_client: Client, _options: unknown, context: AuthContext): boolean {
      const cookie = context.headers.get('cookie') ?? '';
      const token = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) ?? '';
      if (!sessionValid(token, dependencies.auth)) throw new ServerError(401, 'Enter the arena password first.');
      return true;
    }

    async onCreate(rawOptions: unknown) {
      const options = joinOptionsSchema.safeParse(rawOptions);
      if (!options.success) throw new ServerError(400, 'Choose a valid robot and driver name.');
      if (roomMetrics.activeRooms >= dependencies.maxRooms) throw new ServerError(503, 'The arena is full. Try again after a match finishes.');
      roomMetrics.activeRooms += 1;
      this.acquiredSlot = true;
      try {
        this.simulation = await createSimulation(this.roomId);
      } catch (error) {
        roomMetrics.activeRooms -= 1;
        this.acquiredSlot = false;
        throw error;
      }
      this.practice = options.data.practice;
      if (this.practice) this.maxClients = 1;
      this.setPrivate(true);
      this.seatReservationTimeout = 20;
      this.onMessage('input', (client, message: unknown) => {
        if (!this.allowMessage(client.sessionId)) return;
        const input = playerInputSchema.safeParse(message);
        if (input.success) this.simulation.setInput(client.sessionId, input.data, Date.now());
      });
      this.onMessage('ready', (client) => {
        if (!this.allowMessage(client.sessionId)) return;
        this.simulation.setReady(client.sessionId, true);
        this.publish();
      });
      this.onMessage('pulverize', (client) => {
        if (!this.allowMessage(client.sessionId)) return;
        this.simulation.pulverize(client.sessionId);
        this.publish();
      });
      this.onMessage('rematch', (client) => {
        if (!this.allowMessage(client.sessionId) || this.simulation.snapshot().phase.kind !== 'finished') return;
        this.rematchVotes.add(client.sessionId);
        if (this.practice || this.clients.every((item) => this.rematchVotes.has(item.sessionId))) {
          this.simulation.rematch();
          for (const player of this.simulation.snapshot().players) {
            if (!player.connected) this.simulation.removePlayer(player.id);
          }
          this.rematchVotes.clear();
          this.announcedFinished = false;
          if (this.practice) {
            this.simulation.setReady('practice-bot', true);
            this.simulation.setReady(client.sessionId, true);
          }
        } else {
          client.send('notice', 'Rematch requested. Waiting for your opponent.');
        }
        this.publish();
      });
      this.onMessage('sync', (client) => {
        if (this.allowMessage(client.sessionId)) client.send('snapshot', this.simulation.snapshot());
      });
      this.previousStepAt = performance.now();
      this.setSimulationInterval(() => {
        const now = performance.now();
        this.accumulator += Math.min(0.25, (now - this.previousStepAt) / 1_000);
        this.previousStepAt = now;
        let steps = 0;
        while (this.accumulator >= 1 / TICK_RATE && steps < 5) {
          const start = performance.now();
          if (this.practice) this.drivePracticeBot();
          this.simulation.step(1 / TICK_RATE, Date.now());
          this.accumulator -= 1 / TICK_RATE;
          steps += 1;
          const elapsed = performance.now() - start;
          roomMetrics.ticks += 1;
          roomMetrics.totalTickMs += elapsed;
          roomMetrics.maxTickMs = Math.max(roomMetrics.maxTickMs, elapsed);
          const phase = this.simulation.snapshot().phase;
          if (phase.kind === 'finished' && !this.announcedFinished) {
            this.announcedFinished = true;
            roomMetrics.totalMatches += 1;
          }
          this.snapshotTicks += 1;
          if (this.snapshotTicks >= TICK_RATE / SNAPSHOT_RATE) {
            this.snapshotTicks = 0;
            this.publish();
          }
        }
      }, 1_000 / TICK_RATE);
      this.clock.setTimeout(() => {
        if (this.simulation.snapshot().players.length < 2) this.disconnect();
      }, 15 * 60 * 1_000);
    }

    onJoin(client: Client, rawOptions: unknown) {
      const options = joinOptionsSchema.safeParse(rawOptions);
      if (!options.success) throw new ServerError(400, 'Invalid robot selection.');
      if (this.simulation.snapshot().phase.kind !== 'lobby') throw new ServerError(409, 'This match has already started.');
      this.simulation.addPlayer(client.sessionId, options.data.name, options.data);
      if (this.practice) {
        this.simulation.addPlayer('practice-bot', 'House Robot', {
          botId: options.data.botId === 'witchdoctor' ? 'tombstone' : 'witchdoctor', paint: 'signature',
        });
        this.simulation.setReady('practice-bot', true);
      }
      this.publish();
    }

    onDrop(client: Client) {
      this.simulation.setConnected(client.sessionId, false);
      this.publish();
      // Colyseus invokes onLeave when this reservation expires.
      this.allowReconnection(client, RECONNECT_SECONDS).catch(() => undefined);
    }

    onReconnect(client: Client) {
      this.simulation.setConnected(client.sessionId, true);
      this.publish();
    }

    onLeave(client: Client) {
      this.rematchVotes.delete(client.sessionId);
      this.messageWindows.delete(client.sessionId);
      const phase = this.simulation.snapshot().phase.kind;
      if (phase === 'fighting' || phase === 'countdown') this.simulation.forfeit(client.sessionId);
      if (phase === 'lobby') this.simulation.removePlayer(client.sessionId);
      else this.simulation.setConnected(client.sessionId, false);
      this.publish();
    }

    onDispose() {
      this.simulation?.dispose();
      if (this.acquiredSlot) roomMetrics.activeRooms -= 1;
    }

    private publish() {
      this.broadcast('snapshot', this.simulation.snapshot());
    }

    private allowMessage(id: string): boolean {
      const now = Date.now();
      let window = this.messageWindows.get(id);
      if (!window || now - window.since >= 1_000) {
        window = { since: now, count: 0 };
        this.messageWindows.set(id, window);
      }
      window.count += 1;
      return window.count <= 90;
    }

    private drivePracticeBot() {
      const snapshot = this.simulation.snapshot();
      const bot = snapshot.players.find((player) => player.id === 'practice-bot');
      const human = snapshot.players.find((player) => player.id !== 'practice-bot');
      if (!bot || !human) return;
      if (PULVERIZERS.some((definition) => {
        if (definition.ownerSlot !== bot.spawnSlot) return false;
        const head = pulverizerHead(definition, 1.22);
        return Math.hypot(human.position.x - head.x, human.position.z - head.z) < 3 && human.position.y < 2;
      })) this.simulation.pulverize(bot.id);
      const desired = Math.atan2(human.position.x - bot.position.x, human.position.z - bot.position.z);
      const angle = Math.atan2(Math.sin(desired - bot.yaw), Math.cos(desired - bot.yaw));
      const distance = Math.hypot(human.position.x - bot.position.x, human.position.z - bot.position.z);
      this.botSequence += 1;
      this.simulation.setInput(bot.id, {
        seq: this.botSequence, throttle: Math.abs(angle) > 1.1 ? 0.15 : distance > 2 ? 0.8 : 0.4,
        steer: Math.max(-1, Math.min(1, angle / BOTS[bot.botId].turnSpeed * 3)),
        weapon: true, recover: this.botSequence % 120 === 0,
      }, Date.now());
    }
  };
}
