import { createPracticeRuntime, LOCAL_PLAYER_ID } from './practice-runtime';
import { practiceCommandSchema } from './practice-messages';
import type { PracticeResponse } from './practice-messages';

let runtime: Awaited<ReturnType<typeof createPracticeRuntime>> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let generation = 0;
let initializing = false;
function send(response: PracticeResponse): void { postMessage(response); }
function stop(): void {
  generation += 1;
  if (interval !== null) clearInterval(interval);
  interval = null;
  runtime?.dispose(); runtime = null;
}
addEventListener('message', (event: MessageEvent<unknown>) => {
  const parsed = practiceCommandSchema.safeParse(event.data);
  if (!parsed.success) { send({ kind: 'error', message: 'The practice command could not be read.' }); return; }
  const command = parsed.data;
  if (command.kind === 'stop') { stop(); send({ kind: 'stopped' }); close(); return; }
  if (command.kind !== 'init') { runtime?.command(command, performance.now()); return; }
  if (initializing || runtime) { send({ kind: 'error', message: 'A practice match is already running.' }); return; }
  if (!command.selection.practice) { send({ kind: 'error', message: 'This free hosted build supports solo practice.' }); return; }
  initializing = true;
  const current = ++generation;
  const roomId = `practice-${crypto.randomUUID()}`;
  void createPracticeRuntime(command.selection, roomId, performance.now(), (snapshot) => {
    send({ kind: 'snapshot', snapshot, localId: LOCAL_PLAYER_ID });
  }).then((created) => {
    initializing = false;
    if (current !== generation) { created.dispose(); return; }
    runtime = created;
    send({ kind: 'created', roomId, localId: LOCAL_PLAYER_ID });
    created.publish();
    interval = setInterval(() => created.advance(performance.now()), 1000 / 30);
  }).catch(() => {
    initializing = false;
    if (current !== generation) return;
    stop(); send({ kind: 'error', message: 'Practice physics could not start. Reload the game and try again.' });
  });
});
