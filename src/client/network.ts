import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import { matchSnapshotSchema } from '../shared/protocol';
import type { JoinOptions, MatchState, PlayerInput } from '../shared/protocol';
import { STATIC_HOSTING } from './config';
import { createLocalPractice } from './local-practice';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export interface ConnectionOptions {
  onState(snapshot: MatchState, localId: string): void;
  onStatus(status: ConnectionStatus): void;
  onError(message: string): void;
}
const SESSION_KEY = 'battlebots:reconnection';

export function createConnection(options: ConnectionOptions) {
  if (STATIC_HOSTING) return createLocalPractice(options);
  const client = new Client(window.location.origin);
  let room: Room<unknown> | null = null;
  let connected = false;
  let generation = 0;

  function saveToken(token: string | null) {
    try { if (token) sessionStorage.setItem(SESSION_KEY, token); else sessionStorage.removeItem(SESSION_KEY); } catch { /* Storage is optional. */ }
  }

  function attach(joined: Room<unknown>) {
    room = joined;
    connected = true;
    joined.reconnection.maxRetries = 8;
    joined.reconnection.minDelay = 250;
    joined.reconnection.minUptime = 0;
    joined.reconnection.maxDelay = 2_000;
    joined.reconnection.maxEnqueuedMessages = 0;
    saveToken(joined.reconnectionToken);
    joined.onMessage('snapshot', (raw: unknown) => {
      const snapshot = matchSnapshotSchema.safeParse(raw);
      if (snapshot.success) options.onState(snapshot.data, joined.sessionId);
      else options.onError('The game state could not be read. Please rejoin the arena.');
    });
    joined.onMessage('notice', (message: unknown) => { if (typeof message === 'string') options.onError(message); });
    joined.onError((_code, message) => options.onError(message ?? 'The connection encountered a problem.'));
    joined.onDrop(() => { connected = false; options.onStatus('reconnecting'); });
    joined.onReconnect(() => {
      connected = true;
      saveToken(joined.reconnectionToken);
      options.onStatus('connected');
      joined.send('sync');
    });
    joined.onLeave(() => {
      if (room !== joined) return;
      room = null;
      connected = false;
      saveToken(null);
      options.onStatus('disconnected');
    });
    options.onStatus('connected');
    joined.send('sync');
  }

  async function connect(operation: () => Promise<Room<unknown>>) {
    generation += 1;
    const current = generation;
    options.onStatus('connecting');
    try {
      const joined = await operation();
      if (current !== generation) { await joined.leave(); throw new Error('Connection cancelled.'); }
      attach(joined);
      return joined.roomId;
    } catch (error) {
      options.onStatus('disconnected');
      throw error instanceof Error ? error : new Error('Could not connect to the arena.');
    }
  }

  return {
    create(selection: JoinOptions): Promise<string> {
      return connect(() => client.create<unknown>('arena', selection));
    },
    async join(roomId: string, selection: JoinOptions): Promise<void> {
      await connect(() => client.joinById<unknown>(roomId, selection));
    },
    async reconnect(): Promise<boolean> {
      if (room) return connected;
      let token: string | null = null;
      try { token = sessionStorage.getItem(SESSION_KEY); } catch { return false; }
      if (!token) return false;
      try { await connect(() => client.reconnect<unknown>(token)); return true; }
      catch { saveToken(null); options.onStatus('idle'); return false; }
    },
    sendInput(input: PlayerInput) { if (connected) room?.send('input', input); },
    ready() { if (connected) room?.send('ready'); },
    pulverize() { if (connected) room?.send('pulverize'); },
    rematch() { if (connected) room?.send('rematch'); },
    ping() { if (connected) room?.ping(() => undefined); },
    async leave() {
      generation += 1;
      const previous = room;
      room = null;
      connected = false;
      saveToken(null);
      options.onStatus('idle');
      if (previous) await previous.leave();
    },
  };
}
