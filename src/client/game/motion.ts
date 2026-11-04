import { PHYSICS } from '../../shared/physics';
import type { PlayerSnapshot } from '../../shared/protocol';

type Vector = PlayerSnapshot['position'];
type Rotation = PlayerSnapshot['rotation'];
type Motion = Pick<PlayerSnapshot, 'position' | 'velocity' | 'rotation' | 'angularVelocity' | 'grounded'>;

/** Continue server motion between snapshots without inventing mid-air drive forces. */
export function predictMotionToRef(state: Motion, age: number, advancing: boolean, position: Vector, rotation: Rotation): void {
  const time = advancing ? Math.max(0, Math.min(PHYSICS.maxPredictionSeconds, age)) : 0;
  position.x = state.position.x + state.velocity.x * time;
  position.z = state.position.z + state.velocity.z * time;
  position.y = state.position.y + (state.grounded ? 0 : state.velocity.y * time - 0.5 * PHYSICS.gravity * time * time);
  const omega = state.angularVelocity;
  const speed = Math.hypot(omega.x, omega.y, omega.z);
  const factor = speed > 0.00001 ? Math.sin(speed * time / 2) / speed : 0;
  const x = omega.x * factor; const y = omega.y * factor; const z = omega.z * factor;
  const w = Math.cos(speed * time / 2); const q = state.rotation;
  rotation.x = w * q.x + x * q.w + y * q.z - z * q.y;
  rotation.y = w * q.y - x * q.z + y * q.w + z * q.x;
  rotation.z = w * q.z + x * q.y - y * q.x + z * q.w;
  rotation.w = w * q.w - x * q.x - y * q.y - z * q.z;
}

/** Keep a chase camera's heading through tumbles, then return by the shortest turn. */
export function followHeading(current: number, target: number, grounded: boolean, dt: number): number {
  if (!grounded) return current;
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * (1 - Math.exp(-Math.max(0, dt) * 8));
}
