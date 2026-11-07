import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { WebXRCamera } from '@babylonjs/core/XR/webXRCamera';

/** Moves the virtual chase view while preserving native head and stereo poses. */
export class VRChaseOrigin {
  private readonly position = Vector3.Zero();
  private readonly rotation = Quaternion.Identity();
  private readonly offset = Vector3.Zero();
  private baseline: { position: Vector3; inverseRotation: Quaternion } | null = null;
  private hasView = false;

  constructor(private readonly origin: TransformNode) {
    origin.rotationQuaternion = Quaternion.Identity();
  }

  setView(position: Readonly<Vector3>, target: Readonly<Vector3>): void {
    this.position.copyFrom(position);
    const x = target.x - position.x;
    const y = target.y - position.y;
    const z = target.z - position.z;
    const horizontal = Math.hypot(x, z);
    if (horizontal > 0.0001 || Math.abs(y) > 0.0001) {
      // A level chase heading supplies yaw/pitch only, never the robot's roll.
      Quaternion.RotationYawPitchRollToRef(Math.atan2(x, z), -Math.atan2(y, horizontal), 0, this.rotation);
    }
    this.hasView = true;
  }

  reset(): void { this.baseline = null; }

  recenter(camera: WebXRCamera): boolean {
    if (!this.hasView) return false;
    this.baseline = {
      position: camera.position.clone(),
      inverseRotation: camera.rotationQuaternion.conjugate().normalize(),
    };
    this.update(camera);
    return true;
  }

  update(camera: WebXRCamera): void {
    if (!this.baseline || !this.hasView || !this.origin.rotationQuaternion) return;
    this.rotation.multiplyToRef(this.baseline.inverseRotation, this.origin.rotationQuaternion);
    this.baseline.position.rotateByQuaternionToRef(this.origin.rotationQuaternion, this.offset);
    this.position.subtractToRef(this.offset, this.origin.position);
    this.origin.computeWorldMatrix(true);
    camera.getViewMatrix(true);
  }
}
