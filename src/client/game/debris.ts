import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { DebrisSnapshot } from '../../shared/damage';
import type { BotModel } from './models';

interface Fragment {
  root: TransformNode;
  state: DebrisSnapshot;
}

/** Renders bounded server rigid bodies using the robot's actual detached geometry. */
export class DebrisRenderer {
  private readonly fragments = new Map<number, Fragment>();
  private readonly inverseOwner = Matrix.Identity();
  private readonly relative = Matrix.Identity();
  private readonly scaling = Vector3.One();
  private readonly position = Vector3.Zero();
  private readonly rotation = Quaternion.Identity();
  private readonly target = Vector3.Zero();
  private readonly targetRotation = Quaternion.Identity();

  constructor(private readonly scene: Scene, private readonly owner: (id: string) => BotModel | undefined) {}

  get size(): number { return this.fragments.size; }

  update(states: readonly DebrisSnapshot[]): void {
    const ids = new Set(states.map((state) => state.id));
    for (const [id, fragment] of this.fragments) {
      if (!ids.has(id)) { fragment.root.dispose(false, false); this.fragments.delete(id); }
    }
    for (const state of states) {
      const existing = this.fragments.get(state.id);
      if (existing) { existing.state = state; continue; }
      const model = this.owner(state.ownerId);
      if (!model) continue;
      const part = model.parts.get(state.partId);
      if (!part) throw new Error(`Detached part ${state.partId} has no model geometry.`);
      model.root.computeWorldMatrix(true); part.computeWorldMatrix(true);
      model.root.getWorldMatrix().invertToRef(this.inverseOwner);
      part.getWorldMatrix().multiplyToRef(this.inverseOwner, this.relative);
      this.relative.decompose(this.scaling, this.rotation, this.position);
      const root = new TransformNode(`debris-${state.id}`, this.scene);
      const copy = part.clone(`debris-${state.id}-${state.partId}`, root, false);
      if (!copy) { root.dispose(); throw new Error(`Could not clone detached ${state.partId} geometry.`); }
      copy.position.set(this.position.x - state.localOrigin.x, this.position.y - state.localOrigin.y, this.position.z - state.localOrigin.z);
      copy.rotationQuaternion = this.rotation.clone(); copy.scaling.copyFrom(this.scaling);
      copy.setEnabled(true);
      for (const child of copy.getChildMeshes()) {
        if (!(child instanceof Mesh)) continue;
        child.makeGeometryUnique(); child.isPickable = false; child.receiveShadows = true;
      }
      root.position.set(state.position.x, state.position.y, state.position.z);
      root.rotationQuaternion = new Quaternion(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w);
      this.fragments.set(state.id, { root, state });
    }
  }

  pulse(dt: number, snapshotAge: number): void {
    const age = Math.min(0.12, snapshotAge);
    const blend = 1 - Math.exp(-dt * 22);
    for (const fragment of this.fragments.values()) {
      const { state, root } = fragment;
      this.target.set(state.position.x + state.velocity.x * age, state.position.y + state.velocity.y * age, state.position.z + state.velocity.z * age);
      Vector3.LerpToRef(root.position, this.target, blend, root.position);
      this.targetRotation.set(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w);
      if (root.rotationQuaternion) Quaternion.SlerpToRef(root.rotationQuaternion, this.targetRotation, blend, root.rotationQuaternion);
    }
  }

  removeOwner(ownerId: string): void {
    for (const [id, fragment] of this.fragments) {
      if (fragment.state.ownerId !== ownerId) continue;
      fragment.root.dispose(false, false); this.fragments.delete(id);
    }
  }

  clear(): void {
    for (const fragment of this.fragments.values()) fragment.root.dispose(false, false);
    this.fragments.clear();
  }
}
