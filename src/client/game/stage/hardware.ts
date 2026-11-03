import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { SCREWS, PULVERIZERS, KILLSAWS, PULVERIZER_PHASE_SECONDS, pulverizerAngle, type ArenaHazardState, type ScrewDefinition, type PulverizerDefinition, type KillsawDefinition, type PulverizerState } from '../../../shared/arena';
import { StageGeometry } from './geometry';
import type { StageMaterials } from './materials';

interface ScrewVisual {
  kind: 'screw'; id: string; node: TransformNode; angle: number; active: boolean; direction: number;
}
interface HammerVisual {
  kind: 'pulverizer'; id: string; node: TransformNode; angle: number;
  motion: Pick<PulverizerState, 'phase' | 'progress'>; snapshotProgress: number;
}
interface SawVisual {
  kind: 'killsaw'; id: string; node: TransformNode; spin: TransformNode; warning: Mesh;
  radius: number; angle: number; phase: 'locked' | 'armed' | 'warning' | 'cutting'; extension: number;
}
export type HazardVisual = ScrewVisual | HammerVisual | SawVisual;

function screwFlight(geometry: StageGeometry, name: string, definition: ScrewDefinition, phase: number, parent: TransformNode, materials: StageMaterials): void {
  const count = Math.ceil(definition.length / 1.4 * 22);
  const positions: number[] = []; const indices: number[] = []; const uvs: number[] = [];
  for (let n = 0; n <= count; n += 1) {
    const fraction = n / count; const x = (fraction - 0.5) * definition.length;
    const angle = fraction * definition.length / 1.4 * Math.PI * 2 + phase;
    const outer = definition.radius * (n % 4 === 0 ? 0.90 : 1);
    for (const offset of [-0.024, 0.024]) {
      for (const radius of [0.15, outer]) {
        positions.push(x + offset, Math.sin(angle) * radius, Math.cos(angle) * radius);
        uvs.push(fraction * 5, radius / definition.radius);
      }
    }
  }
  for (let n = 0; n < count; n += 1) {
    const a = n * 4; const b = a + 4;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
    indices.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
    indices.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
  }
  geometry.custom(name, positions, indices, materials.bright, { parent, moving: true }, uvs);
}

function makeScrew(geometry: StageGeometry, materials: StageMaterials, definition: ScrewDefinition): ScrewVisual {
  const { position, length, radius } = definition;
  const mount = geometry.node(`${definition.id}-mount`, [position.x, position.y, position.z]);
  mount.rotation.y = definition.yaw;
  const rotor = geometry.node(`${definition.id}-motion`, [0, 0, 0], mount);
  geometry.cylinder('auger-central-shaft', 0.31, length + 0.35, [0, 0, 0], materials.steel, 'x', { parent: rotor, moving: true }, 20);
  screwFlight(geometry, 'serrated-helical-flight-a', definition, 0, rotor, materials);
  screwFlight(geometry, 'serrated-helical-flight-b', definition, Math.PI, rotor, materials);
  for (const side of [-1, 1]) {
    geometry.box('auger-bearing-stanchion', [0.28, position.y + 0.36, 0.72], [side * (length / 2 + 0.16), -(position.y + 0.36) / 2 + 0.13, 0], materials.black, { parent: mount });
    geometry.cylinder('auger-bearing-block', radius * 0.92, 0.32, [side * (length / 2 + 0.15), 0, 0], materials.steel, 'x', { parent: mount }, 16);
    geometry.cylinder('auger-bearing-cap', radius * 0.58, 0.35, [side * (length / 2 + 0.16), 0, 0], materials.bright, 'x', { parent: mount }, 12);
  }
  geometry.box('auger-rear-guard', [length + 0.6, 0.35, 0.14], [0, -position.y + 0.2, -0.56], materials.black, { parent: mount });
  return { kind: 'screw', id: definition.id, node: rotor, angle: 0, active: false, direction: 1 };
}

function headMesh(geometry: StageGeometry, definition: PulverizerDefinition, parent: TransformNode, materials: StageMaterials): void {
  const half = definition.headSize / 2; const bevel = 0.15; const z = definition.armLength;
  const profile: readonly (readonly [number, number])[] = [
    [-half + bevel, -half], [half - bevel, -half], [half, -half + bevel], [half, half - bevel],
    [half - bevel, half], [-half + bevel, half], [-half, half - bevel], [-half, -half + bevel],
  ];
  const positions: number[] = []; const indices: number[] = []; const uvs: number[] = [];
  for (const depth of [-0.58, 0.58]) {
    for (const point of profile) { positions.push(point[0], point[1], z + depth); uvs.push((point[0] + half) / definition.headSize, (point[1] + half) / definition.headSize); }
  }
  for (let n = 1; n < profile.length - 1; n += 1) indices.push(0, n + 1, n, 8, n + 8, n + 9);
  for (let n = 0; n < profile.length; n += 1) {
    const next = (n + 1) % profile.length;
    indices.push(n, next, next + 8, n, next + 8, n + 8);
  }
  geometry.custom('pulverizer-bevelled-aluminium-head', positions, indices, materials.bright, { parent, moving: true }, uvs);
  geometry.box('pulverizer-owner-cap', [definition.headSize - 0.12, 0.05, 1.1], [0, half + 0.025, z], definition.ownerSlot === 0 ? materials.red : materials.blue, { parent, moving: true });
  geometry.box('pulverizer-striking-face', [definition.headSize - 0.08, 0.09, 1.1], [0, -half, z], materials.steel, { parent, moving: true });
}

function makeHammer(geometry: StageGeometry, materials: StageMaterials, definition: PulverizerDefinition): HammerVisual {
  const { pivot } = definition;
  const mount = geometry.node(`${definition.id}-mount`, [pivot.x, pivot.y, pivot.z]);
  mount.rotation.y = definition.yaw;
  const arm = geometry.node(`${definition.id}-motion`, [0, 0, 0], mount);
  geometry.box('pulverizer-support-tower', [1.45, pivot.y - 0.7, 1.1], [0, -pivot.y / 2 - 0.35, -0.45], materials.black, { parent: mount });
  geometry.box('pulverizer-owner-base', [1.5, 0.18, 1.15], [0, -0.7, -0.45], definition.ownerSlot === 0 ? materials.red : materials.blue, { parent: mount });
  for (const side of [-1, 1]) geometry.box('pulverizer-pivot-bracket', [0.17, 1.03, 1.1], [side * 0.46, -0.1, -0.17], materials.steel, { parent: mount });
  geometry.cylinder('pulverizer-axle', 0.4, 1.4, [0, 0, 0], materials.bright, 'x', { parent: mount }, 20);
  geometry.box('pulverizer-sledge-arm', [0.39, 0.36, definition.armLength - 0.3], [0, 0, definition.armLength / 2 - 0.1], materials.steel, { parent: arm, moving: true });
  geometry.box('pulverizer-arm-weld-top', [0.43, 0.04, definition.armLength - 0.5], [0, 0.2, definition.armLength / 2 - 0.1], materials.black, { parent: arm, moving: true });
  geometry.cylinder('pulverizer-arm-bearing', 0.72, 0.80, [0, 0, 0], materials.black, 'x', { parent: arm, moving: true }, 20);
  // Pneumatic cylinder, exposed piston and clevis are visible below the striking arm.
  const actuator = geometry.cylinder('pulverizer-pneumatic-cylinder', 0.36, 1.28, [0, -0.91, -0.39], materials.black, 'z', { parent: mount });
  actuator.rotation.x = -0.58;
  const piston = geometry.cylinder('pulverizer-piston-rod', 0.14, 1.22, [0, -0.52, 0.25], materials.bright, 'z', { parent: mount });
  piston.rotation.x = -0.58;
  geometry.cylinder('pulverizer-head-bolt', 0.16, 0.59, [0, 0, definition.armLength - 0.65], materials.bright, 'x', { parent: arm, moving: true }, 6);
  headMesh(geometry, definition, arm, materials);
  const angle = pulverizerAngle({ phase: 'idle', progress: 0 }); arm.rotation.x = angle;
  return { kind: 'pulverizer', id: definition.id, node: arm, angle, motion: { phase: 'idle', progress: 0 }, snapshotProgress: 0 };
}

function sawBlade(geometry: StageGeometry, definition: KillsawDefinition, x: number, parent: TransformNode, materials: StageMaterials): void {
  const count = 96; const positions: number[] = []; const indices: number[] = []; const uvs: number[] = [];
  for (const offset of [-0.025, 0.025]) {
    positions.push(x + offset, 0, 0); uvs.push(0.5, 0.5);
    for (let n = 0; n <= count; n += 1) {
      const angle = n / count * Math.PI * 2; const radius = definition.radius * (n % 3 === 0 ? 1 : n % 3 === 1 ? 0.96 : 0.86);
      positions.push(x + offset, Math.sin(angle) * radius, Math.cos(angle) * radius);
      uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
    }
  }
  const cap = count + 2;
  for (let n = 1; n <= count; n += 1) {
    indices.push(0, n + 1, n, cap, cap + n, cap + n + 1);
    indices.push(n, n + 1, cap + n, n + 1, cap + n + 1, cap + n);
  }
  geometry.custom('titanium-toothed-killsaw', positions, indices, materials.bright, { parent, moving: true }, uvs);
  geometry.cylinder('killsaw-blade-hub', 0.23, 0.07, [x, 0, 0], materials.black, 'x', { parent, moving: true }, 12);
}

function makeSaw(geometry: StageGeometry, materials: StageMaterials, definition: KillsawDefinition): SawVisual {
  const mount = geometry.node(`${definition.id}-mount`, [definition.position.x, 0, definition.position.z]); mount.rotation.y = definition.yaw;
  const lift = geometry.node(`${definition.id}-lift`, [0, -definition.radius - 0.1, 0], mount);
  const spin = geometry.node(`${definition.id}-spin`, [0, 0, 0], lift);
  for (const side of [-1, 1]) {
    const x = side * definition.bladeSpacing / 2;
    sawBlade(geometry, definition, x, spin, materials);
    geometry.box('killsaw-dark-floor-slot', [0.12, 0.008, 1.65], [x, 0.008, 0], materials.black, { parent: mount });
    for (const edge of [-1, 1]) geometry.box('killsaw-slot-lip', [0.025, 0.022, 1.70], [x + edge * 0.09, 0.018, 0], materials.steel, { parent: mount });
    for (const end of [-1, 1]) geometry.box('killsaw-slot-end', [0.23, 0.022, 0.12], [x, 0.018, end * 0.85], materials.steel, { parent: mount });
  }
  geometry.box('killsaw-warning-bezel', [0.42, 0.055, 0.18], [0, 0.03, -1.14], materials.black, { parent: mount });
  const warning = geometry.box(`${definition.id}-warning-light`, [0.29, 0.02, 0.11], [0, 0.068, -1.14], materials.amberLight, { parent: mount, keep: true, moving: true });
  warning.isVisible = false;
  spin.setEnabled(false);
  return { kind: 'killsaw', id: definition.id, node: lift, spin, warning, radius: definition.radius, angle: 0, phase: 'locked', extension: 0 };
}

export function makeHardware(geometry: StageGeometry, materials: StageMaterials): HazardVisual[] {
  return [
    ...SCREWS.map((definition) => makeScrew(geometry, materials, definition)),
    ...PULVERIZERS.map((definition) => makeHammer(geometry, materials, definition)),
    ...KILLSAWS.map((definition) => makeSaw(geometry, materials, definition)),
  ];
}

/** A server snapshot alone decides whether any mechanism is enabled or raised. */
export function setHardwareState(visual: HazardVisual, state: ArenaHazardState | undefined): void {
  if (visual.kind === 'screw') {
    const current = state?.kind === 'screw' ? state : null;
    visual.angle = current?.angle ?? 0; visual.active = current?.active ?? false; visual.direction = current?.direction ?? 1;
    visual.node.rotation.x = visual.angle;
  } else if (visual.kind === 'pulverizer') {
    visual.motion.phase = state?.kind === 'pulverizer' ? state.phase : 'idle';
    visual.motion.progress = state?.kind === 'pulverizer' ? state.progress : 0;
    visual.snapshotProgress = visual.motion.progress;
    visual.angle = pulverizerAngle(visual.motion);
    visual.node.rotation.x = visual.angle;
  } else {
    const current = state?.kind === 'killsaw' ? state : null;
    visual.phase = current?.phase ?? 'locked'; visual.angle = current?.angle ?? 0;
    visual.extension = current?.phase === 'cutting' ? Math.max(0, Math.min(1, current.extension)) : 0;
    visual.node.position.y = -visual.radius - 0.1 + visual.extension * (visual.radius - 0.08);
    visual.spin.rotation.x = visual.angle;
    visual.spin.setEnabled(visual.phase === 'cutting');
    visual.warning.isVisible = visual.phase === 'warning' || visual.phase === 'cutting';
  }
}

export function pulseHardware(visuals: readonly HazardVisual[], time: number, age: number): void {
  for (const visual of visuals) {
    if (visual.kind === 'screw') visual.node.rotation.x = visual.angle + (visual.active ? age * 6 * visual.direction : 0);
    else if (visual.kind === 'pulverizer') {
      if (visual.motion.phase !== 'idle') {
        visual.motion.progress = Math.min(1, visual.snapshotProgress + age / PULVERIZER_PHASE_SECONDS[visual.motion.phase]);
        visual.node.rotation.x = pulverizerAngle(visual.motion);
      }
    } else if (visual.kind === 'killsaw') {
      visual.spin.rotation.x = visual.angle + (visual.phase === 'cutting' ? age * 40 : 0);
      visual.warning.visibility = visual.phase === 'warning' ? (Math.sin(time * 18) > 0 ? 1 : 0.12) : 1;
    }
  }
}
