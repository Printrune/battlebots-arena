/** Reverse the steering arc when backing up; a neutral throttle still pivots. */
export function steeringForDrive(throttle: number, steer: number): number {
  return throttle < 0 ? -steer : steer;
}
