export type VRStatus =
  | { kind: 'checking' | 'available' | 'entering' | 'active' | 'paused' }
  | { kind: 'unavailable'; reason: string };

export type VRAction = 'weapon' | 'recover' | 'pulverize' | 'ready' | 'rematch' | 'leave' | 'exit' | 'recenter';

export interface VRCallbacks {
  onStatus(status: VRStatus): void;
  onDrive(throttle: number, steer: number): void;
  onAction(action: VRAction): void;
  onError?(message: string): void;
}
