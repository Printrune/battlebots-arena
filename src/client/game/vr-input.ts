import type { VRAction } from '../../shared/vr';

export interface VRControllerSample {
  id: string;
  handedness: 'left' | 'right' | 'none';
  stick: { x: number; y: number };
  trigger: boolean;
  primary: boolean;
  secondary: boolean;
}

export interface VRInputFrame {
  throttle: number;
  steer: number;
  actions: VRAction[];
  held: Set<string>;
}

/** Radial dead zone avoids drift while retaining full diagonal stick travel. */
export function vrStick(x: number, y: number): { throttle: number; steer: number } {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { throttle: 0, steer: 0 };
  const length = Math.hypot(x, y);
  if (length <= 0.16) return { throttle: 0, steer: 0 };
  const magnitude = Math.min(1, (length - 0.16) / 0.84);
  return { throttle: -y / length * magnitude, steer: x / length * magnitude };
}

/** Profile-independent semantic samples; each action fires on its rising edge. */
export function readVRInput(samples: readonly VRControllerSample[], previous: ReadonlySet<string>, enabled: boolean): VRInputFrame {
  const held = new Set<string>();
  const actions: VRAction[] = [];
  const action = (sample: VRControllerSample, button: string, pressed: boolean, value: VRAction) => {
    if (!pressed) return;
    const key = `${sample.id}:${button}`;
    held.add(key);
    if (enabled && !previous.has(key) && !actions.includes(value)) actions.push(value);
  };
  for (const sample of samples) {
    if (sample.handedness === 'left') {
      action(sample, 'primary', sample.primary, 'pulverize');
      action(sample, 'secondary', sample.secondary, 'recenter');
    } else {
      action(sample, 'primary', sample.primary, 'weapon');
      action(sample, 'secondary', sample.secondary, 'recover');
      action(sample, 'trigger', sample.trigger, 'weapon');
    }
  }
  const driver = samples.find((sample) => sample.handedness === 'left')
    ?? samples.find((sample) => sample.handedness === 'none')
    ?? samples.find((sample) => sample.handedness === 'right');
  const drive = enabled && driver ? vrStick(driver.stick.x, driver.stick.y) : { throttle: 0, steer: 0 };
  return { ...drive, actions, held };
}
