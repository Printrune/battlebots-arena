import type { JoinOptions, PlayerInput } from '../shared/protocol';
import type { ConnectionOptions } from './network';
import { practiceResponseSchema } from './practice-messages';
import type { PracticeCommand } from './practice-messages';

const ONLINE_MESSAGE = 'Online matches need a game server. This free hosted build supports solo practice.';

/** Static hosting runs the existing authoritative simulation in one dedicated worker. */
export function createLocalPractice(options: ConnectionOptions) {
  let worker: Worker | null = null;
  let connected = false;
  let pending: { resolve(roomId: string): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;

  function post(command: PracticeCommand): void { worker?.postMessage(command); }
  function fail(message: string): void {
    connected = false;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(message)); pending = null; }
    worker?.terminate(); worker = null;
    options.onStatus('disconnected'); options.onError(message);
  }
  async function leave(): Promise<void> {
    const previous = worker;
    worker = null; connected = false;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error('Practice was cancelled.')); pending = null; }
    if (previous) await new Promise<void>((resolve) => {
      let completed = false;
      const timer = setTimeout(finish, 250);
      function finish(): void {
        if (completed) return;
        completed = true; clearTimeout(timer); previous?.terminate(); resolve();
      }
      previous.addEventListener('message', (event: MessageEvent<unknown>) => {
        const parsed = practiceResponseSchema.safeParse(event.data);
        if (parsed.success && parsed.data.kind === 'stopped') finish();
      });
      previous.postMessage({ kind: 'stop' } satisfies PracticeCommand);
    });
    options.onStatus('idle');
  }
  return {
    async create(selection: JoinOptions): Promise<string> {
      if (!selection.practice) throw new Error(ONLINE_MESSAGE);
      await leave(); options.onStatus('connecting');
      let created: Worker;
      try { created = new Worker(new URL('./practice.worker.ts', import.meta.url), { type: 'module' }); }
      catch { options.onStatus('disconnected'); throw new Error('This browser could not start practice physics. Try another current browser.'); }
      worker = created;
      return new Promise<string>((resolve, reject) => {
        pending = { resolve, reject, timer: setTimeout(() => fail('Practice took too long to start. Reload and try again.'), 30_000) };
        created.addEventListener('error', () => { if (worker === created) fail('Practice could not start. Reload the game and try again.'); });
        created.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (worker !== created) return;
          const parsed = practiceResponseSchema.safeParse(event.data);
          if (!parsed.success) { fail('The practice state could not be read. Reload the game.'); return; }
          const response = parsed.data;
          switch (response.kind) {
            case 'created':
              connected = true; options.onStatus('connected');
              if (pending) { clearTimeout(pending.timer); pending.resolve(response.roomId); pending = null; }
              break;
            case 'snapshot': options.onState(response.snapshot, response.localId); break;
            case 'error': fail(response.message); break;
            case 'stopped': break;
          }
        });
        post({ kind: 'init', selection });
      });
    },
    async join(_roomId: string, _selection: JoinOptions): Promise<void> { throw new Error(ONLINE_MESSAGE); },
    async reconnect(): Promise<boolean> { return connected; },
    sendInput(input: PlayerInput): void { if (connected) post({ kind: 'input', input }); },
    ready(): void { if (connected) post({ kind: 'ready' }); },
    pulverize(): void { if (connected) post({ kind: 'pulverize' }); },
    rematch(): void { if (connected) post({ kind: 'rematch' }); },
    ping(): void { if (connected) post({ kind: 'sync' }); },
    leave,
  };
}
