import { createSimulation } from '../server/simulation';
import { SNAPSHOT_RATE, TICK_RATE } from '../shared/protocol';
import type { JoinOptions, MatchState } from '../shared/protocol';
import { practiceBotControls } from '../shared/practice-ai';
import type { PracticeCommand } from './practice-messages';

export const LOCAL_PLAYER_ID = 'local-driver';
const STEP = 1 / TICK_RATE;
const MAX_CATCHUP_STEPS = 5;
type RuntimeCommand = Exclude<PracticeCommand, { kind: 'init' }>;

/** Owns one real Rapier match. Timer and XR-input wakes share one wall-clock budget. */
export async function createPracticeRuntime(selection: JoinOptions, roomId: string, now: number,
  emit: (snapshot: MatchState) => void) {
  const simulation = await createSimulation(roomId);
  simulation.addPlayer(LOCAL_PLAYER_ID, selection.name, selection);
  simulation.addPlayer('practice-bot', 'House Robot', {
    botId: selection.botId === 'witchdoctor' ? 'tombstone' : 'witchdoctor', paint: 'signature',
  });
  simulation.setReady('practice-bot', true);
  let previousTime = now;
  let accumulator = 0;
  let simulationTime = 0;
  let botSequence = 0;
  let snapshotTicks = 0;
  let disposed = false;

  function publish(): void { if (!disposed) emit(simulation.snapshot()); }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    simulation.dispose();
  }
  function advance(at: number): void {
    if (disposed) return;
    const elapsed = Math.max(0, (at - previousTime) / 1000);
    previousTime = Math.max(previousTime, at);
    accumulator = Math.min(accumulator + elapsed, STEP * MAX_CATCHUP_STEPS);
    while (accumulator + 1e-9 >= STEP) {
      accumulator = Math.max(0, accumulator - STEP);
      simulationTime += STEP * 1000;
      const bot = practiceBotControls(simulation.snapshot(), ++botSequence);
      if (bot) {
        simulation.setInput('practice-bot', bot.input, simulationTime);
        if (bot.pulverize) simulation.pulverize('practice-bot');
      }
      simulation.step(STEP, simulationTime);
      snapshotTicks += 1;
      if (snapshotTicks >= TICK_RATE / SNAPSHOT_RATE) { snapshotTicks = 0; publish(); }
    }
  }
  return {
    advance, publish, dispose,
    snapshot(): MatchState { return simulation.snapshot(); },
    command(command: RuntimeCommand, at: number): void {
      if (disposed) return;
      if (command.kind === 'stop') { dispose(); return; }
      advance(at);
      switch (command.kind) {
        case 'input': simulation.setInput(LOCAL_PLAYER_ID, command.input, simulationTime); return;
        case 'ready': simulation.setReady(LOCAL_PLAYER_ID, true); break;
        case 'rematch':
          if (simulation.snapshot().phase.kind !== 'finished') return;
          simulation.rematch();
          simulation.setReady('practice-bot', true); simulation.setReady(LOCAL_PLAYER_ID, true);
          break;
        case 'pulverize': simulation.pulverize(LOCAL_PLAYER_ID); break;
        case 'sync': break;
      }
      publish();
    },
  };
}
