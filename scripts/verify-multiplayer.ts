import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { Room } from '@colyseus/sdk';
import { BOTS, TICK_RATE, matchSnapshotSchema } from '../src/shared/protocol';
import type { JoinOptions, MatchState, PlayerInput } from '../src/shared/protocol';

try { process.loadEnvFile(); } catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}

// Node's built-in WebSocket cannot supply Cookie headers. Let the SDK use its
// bundled ws implementation instead; this change is isolated to this test process.
Reflect.deleteProperty(globalThis, 'WebSocket');
const { Client } = await import('@colyseus/sdk');

export const metricsSchema = z.object({
  activeRooms: z.number(), maxRooms: z.number(), totalMatches: z.number(),
  ticks: z.number(), totalTickMs: z.number(), maxTickMs: z.number(),
  averageTickMs: z.number(), memory: z.number(),
});

export interface TrackedRoom {
  room: Room<unknown>;
  snapshot: MatchState | null;
  snapshots: number;
  connected: boolean;
  drops: number;
  reconnects: number;
  lastSnapshotAt: number;
  maxSnapshotGapMs: number;
  errors: string[];
  sequence: number;
}

export async function waitFor(
  description: string,
  predicate: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}.`);
    await delay(50);
  }
}

export function report(check: string, detail: unknown): void {
  process.stdout.write(`${JSON.stringify({ check, detail })}\n`);
}

export async function createHarness() {
  const baseUrl = new URL(process.env.VERIFY_BASE_URL ?? 'http://localhost:3000').origin;
  const password = process.env.DEMO_PASSWORD ?? 'let-the-bots-battle';
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ password }), signal: AbortSignal.timeout(70_000),
  });
  assert.equal(response.status, 200, `Login failed: ${await response.text()}`);
  const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.ok(cookie, 'Login must issue a session cookie.');
  const tracked: TrackedRoom[] = [];

  function sdk() {
    return new Client(baseUrl, {
      headers: { Cookie: cookie, Origin: baseUrl },
      fetchFn: (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Cookie', cookie);
        headers.set('Origin', baseUrl);
        return fetch(url, { ...init, headers, signal: AbortSignal.timeout(15_000) });
      },
    });
  }

  function track(room: Room<unknown>): TrackedRoom {
    const state: TrackedRoom = {
      room, snapshot: null, snapshots: 0, connected: true,
      drops: 0, reconnects: 0, lastSnapshotAt: 0, maxSnapshotGapMs: 0, errors: [], sequence: 0,
    };
    room.reconnection.minUptime = 0;
    room.reconnection.minDelay = 100;
    room.reconnection.maxDelay = 1_000;
    room.reconnection.maxRetries = 8;
    room.reconnection.maxEnqueuedMessages = 0;
    room.onMessage('snapshot', (raw: unknown) => {
      const snapshot = matchSnapshotSchema.safeParse(raw);
      if (!snapshot.success) { state.errors.push(snapshot.error.message); return; }
      const now = Date.now();
      if (state.lastSnapshotAt > 0) state.maxSnapshotGapMs = Math.max(state.maxSnapshotGapMs, now - state.lastSnapshotAt);
      state.lastSnapshotAt = now;
      state.snapshot = snapshot.data;
      state.snapshots += 1;
    });
    room.onMessage('notice', () => undefined);
    room.onDrop(() => { state.connected = false; state.drops += 1; });
    room.onReconnect(() => {
      state.connected = true;
      state.reconnects += 1;
      room.send('sync');
    });
    room.onError((code, message) => { state.errors.push(`${code}: ${message ?? 'Connection error'}`); });
    room.onLeave(() => { state.connected = false; });
    tracked.push(state);
    room.send('sync');
    return state;
  }

  return {
    baseUrl, cookie,
    async create(selection: JoinOptions): Promise<TrackedRoom> {
      return track(await sdk().create<unknown>('arena', selection));
    },
    async join(roomId: string, selection: JoinOptions): Promise<TrackedRoom> {
      return track(await sdk().joinById<unknown>(roomId, selection));
    },
    async metrics() {
      const result = await fetch(`${baseUrl}/api/metrics`, {
        headers: { Cookie: cookie }, signal: AbortSignal.timeout(5_000),
      });
      assert.equal(result.status, 200);
      return metricsSchema.parse(await result.json());
    },
    async close() {
      await Promise.allSettled(tracked.map(async ({ room }) => {
        await Promise.race([room.leave(), delay(2_000)]);
      }));
    },
  };
}

export function autopilot(driver: TrackedRoom): void {
  if (!driver.connected || !driver.snapshot || driver.snapshot.phase.kind !== 'fighting') return;
  const self = driver.snapshot.players.find((player) => player.id === driver.room.sessionId);
  const opponent = driver.snapshot.players.find((player) => player.id !== driver.room.sessionId);
  if (!self || !opponent) return;
  const dx = opponent.position.x - self.position.x;
  const dz = opponent.position.z - self.position.z;
  const desired = Math.atan2(dx, dz);
  const angle = Math.atan2(Math.sin(desired - self.yaw), Math.cos(desired - self.yaw));
  driver.sequence = Math.max(driver.sequence, self.lastInputSeq) + 1;
  const input: PlayerInput = {
    seq: driver.sequence,
    throttle: Math.abs(angle) > 1.2 ? 0 : Math.hypot(dx, dz) > 2.7 ? 0.85 : 0.25,
    steer: Math.max(-1, Math.min(1, angle * 3 / BOTS[self.botId].turnSpeed)),
    weapon: true, recover: driver.sequence % 100 === 0,
  };
  driver.room.send('input', input);
}

async function rejectUnauthenticatedSocket(baseUrl: string): Promise<void> {
  const endpoint = new URL('/verification/unauthenticated', baseUrl);
  await new Promise<void>((resolve, reject) => {
    const request = (endpoint.protocol === 'https:' ? httpsRequest : httpRequest)(endpoint, {
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': Buffer.alloc(16, 7).toString('base64'),
      },
    });
    request.setTimeout(5_000, () => request.destroy(new Error('Unauthorized WebSocket did not reject.')));
    request.once('response', (response) => {
      response.resume();
      try { assert.equal(response.statusCode, 401); resolve(); } catch (error) { reject(error); }
    });
    request.once('upgrade', (_response, socket) => {
      socket.destroy();
      reject(new Error('Unauthorized WebSocket handshake was accepted.'));
    });
    request.once('error', reject);
    request.end();
  });
}

async function main(): Promise<void> {
  const baseUrl = new URL(process.env.VERIFY_BASE_URL ?? 'http://localhost:3000').origin;
  const unauthorized = await fetch(`${baseUrl}/matchmake/create/arena`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botId: 'witchdoctor', paint: 'signature', name: 'Unauthorized' }),
    signal: AbortSignal.timeout(70_000),
  });
  assert.equal(unauthorized.status, 401);
  const wrongLogin = await fetch(`${baseUrl}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: `incorrect-${Date.now()}` }), signal: AbortSignal.timeout(5_000),
  });
  assert.equal(wrongLogin.status, 401);
  await rejectUnauthenticatedSocket(baseUrl);
  report('access', 'Unauthenticated matchmaking, wrong passwords, and direct WebSockets are rejected.');

  const harness = await createHarness();
  let driving: ReturnType<typeof setInterval> | undefined;
  try {
    const first = await harness.create({ name: 'Verify One', botId: 'witchdoctor', paint: 'signature', practice: false });
    const second = await harness.join(first.room.roomId, { name: 'Verify Two', botId: 'tombstone', paint: 'ember', practice: false });
    assert.notEqual(first.room.sessionId, second.room.sessionId);
    await waitFor('two players in both snapshots', () => first.snapshot?.players.length === 2 && second.snapshot?.players.length === 2);
    first.room.send('ready');
    second.room.send('ready');
    await waitFor('countdown on both clients', () => first.snapshot?.phase.kind === 'countdown' && second.snapshot?.phase.kind === 'countdown');
    await waitFor('fight on both clients', () => first.snapshot?.phase.kind === 'fighting' && second.snapshot?.phase.kind === 'fighting');
    report('join-and-start', { roomId: first.room.roomId, distinctSeats: true, countdown: true });

    driving = setInterval(() => { autopilot(first); autopilot(second); }, 1_000 / TICK_RATE);
    await waitFor('server-authoritative combat hit', () => (first.snapshot?.events.some((event) => event.kind === 'hit')) === true, 15_000);
    const originalSeat = first.room.sessionId;
    first.room.connection.close(1001, 'Verification interruption');
    await waitFor('automatic reconnect', () => first.drops >= 1 && first.reconnects >= 1 && first.connected, 10_000);
    assert.equal(first.room.sessionId, originalSeat);
    await waitFor('restored connected seat', () => first.snapshot?.players.find((player) => player.id === originalSeat)?.connected === true);
    report('reconnect', { sameSeat: true, drops: first.drops, reconnects: first.reconnects });

    await waitFor('completed fight', () => first.snapshot?.phase.kind === 'finished' && second.snapshot?.phase.kind === 'finished', 130_000);
    clearInterval(driving);
    driving = undefined;
    const firstPhase = first.snapshot?.phase;
    const secondPhase = second.snapshot?.phase;
    assert.ok(firstPhase?.kind === 'finished' && secondPhase?.kind === 'finished');
    assert.deepEqual(firstPhase.result, secondPhase.result);
    assert.ok(first.snapshot?.players.some((player) => player.damageDealt > 0));
    report('combat-result', { ...firstPhase.result, players: first.snapshot?.players.map(({ name, health, hits }) => ({ name, health, hits })) });

    first.room.send('rematch');
    second.room.send('rematch');
    await waitFor('rematch lobby', () => first.snapshot?.phase.kind === 'lobby' && second.snapshot?.phase.kind === 'lobby');
    assert.ok(first.snapshot?.players.every((player) => player.health === 100 && player.damageDealt === 0));
    first.room.send('ready');
    second.room.send('ready');
    await waitFor('second fight', () => first.snapshot?.phase.kind === 'fighting' && second.snapshot?.phase.kind === 'fighting');
    await first.room.leave();
    await waitFor('single forfeit result', () => second.snapshot?.phase.kind === 'finished');
    const forfeit = second.snapshot?.phase;
    assert.ok(forfeit?.kind === 'finished');
    assert.deepEqual(forfeit.result, { winnerId: second.room.sessionId, reason: 'forfeit' });
    assert.deepEqual(first.errors, []);
    assert.deepEqual(second.errors, []);
    report('rematch-and-forfeit', { resetHealth: true, winnerId: forfeit.result.winnerId });
    report('PASS', { snapshots: first.snapshots + second.snapshots, metrics: await harness.metrics() });
  } finally {
    if (driving) clearInterval(driving);
    await harness.close();
  }
}

const invokedFile = process.argv[1];
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  await main().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify({ check: 'FAIL', error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  });
}
