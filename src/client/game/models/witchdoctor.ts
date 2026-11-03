import { BOTS } from '../../../shared/protocol';
import { wheelPartId } from '../../../shared/damage';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { ModelBuilder, type Point2, type Point3 } from './geometry';
import type { ModelMaterials } from './materials';

function ribCover(builder: ModelBuilder, mats: ModelMaterials, side: number, parent: TransformNode): void {
  const rows = [-1.03, -0.70, -0.31, 0.12, 0.51];
  const widths = [0.88, 0.98, 0.93, 0.98, 0.76];
  const columns = [0.07, 0.30, 0.55, 0.79, 1];
  const positions: number[] = []; const indices: number[] = []; const uvs: number[] = [];
  for (const lower of [false, true]) {
    for (let r = 0; r < rows.length; r += 1) {
      const z = rows[r] ?? 0; const width = widths[r] ?? 1;
      for (const fraction of columns) {
        const x = fraction * width * side;
        const y = 0.22 + Math.cos(fraction * Math.PI / 2) * 0.18 + Math.sin((z + 1) * 1.5) * 0.035;
        // The pivot sits near the rear axle. At neutral, the curved lids cover the chassis.
        positions.push(x, y - 0.08 - (lower ? 0.035 : 0), z + 0.90);
        uvs.push((x + 1) / 2, (z + 1.03) / 1.54);
      }
    }
  }
  const length = rows.length * columns.length;
  for (let r = 0; r < rows.length - 1; r += 1) {
    for (let c = 0; c < columns.length - 1; c += 1) {
      const a = r * columns.length + c; const b = a + columns.length;
      const top = side > 0 ? [a, b, a + 1, a + 1, b, b + 1] : [a, a + 1, b, a + 1, b + 1, b];
      indices.push(...top);
      for (let p = 0; p < top.length; p += 3) {
        const i = top[p]; const j = top[p + 1]; const k = top[p + 2];
        if (i !== undefined && j !== undefined && k !== undefined) indices.push(i + length, k + length, j + length);
      }
    }
  }
  const outline: number[] = [];
  for (let c = 0; c < columns.length; c += 1) outline.push(c);
  for (let r = 1; r < rows.length; r += 1) outline.push(r * columns.length + columns.length - 1);
  for (let c = columns.length - 2; c >= 0; c -= 1) outline.push((rows.length - 1) * columns.length + c);
  for (let r = rows.length - 2; r > 0; r -= 1) outline.push(r * columns.length);
  for (let n = 0; n < outline.length; n += 1) {
    const a = outline[n]; const b = outline[(n + 1) % outline.length];
    if (a !== undefined && b !== undefined) indices.push(a, a + length, b, b, a + length, b + length);
  }
  builder.vertexMesh('curved-ribcage-panel', positions, indices, uvs, mats.cover, parent);
}

/** WCVII configuration, reconstructed from the official studio and pit photographs. */
export function buildWitchDoctor(builder: ModelBuilder, mats: ModelMaterials): TransformNode {
  const { physics, weapon: definition } = BOTS.witchdoctor;
  const { root, weapon } = builder;
  weapon.position.set(definition.mount.x, definition.mount.y, definition.mount.z);

  builder.polygon('purple-monocoque', [[-0.95, -1.08], [0.95, -1.08], [0.95, 0.63], [0.67, 0.90], [-0.67, 0.90], [-0.95, 0.63]],
    0.40, [0, -0.12, 0], mats.purple);
  builder.box('lower-armour-skid', [1.84, 0.055, 1.89], [0, -0.34, -0.13], mats.black);
  for (const side of [-1, 1]) {
    for (const z of physics.wheelZ) {
      const wheel = builder.tire(side * physics.trackWidth / 2, z, physics.wheelRadius, physics.wheelWidth, mats.rubber, mats.paint, mats.steel, mats.black);
      builder.registerPart(wheelPartId('witchdoctor', side, z), wheel);
      builder.cylinder('drive-axle', 0.15, 0.46, [side * 0.85, 0, z], mats.steel, 'x');
    }
    const armorStart = builder.checkpoint();
    // Flat center side panels sit in the gap between the four exposed tires.
    builder.box('side-sponsor-panel', [0.018, 0.33, 0.67], [side * 0.965, -0.12, 0], mats.side);
    builder.beam('side-frame-top', [side * 0.94, 0.14, -1.0], [side * 0.94, 0.14, 0.77], 0.055, 0.055, mats.purple);
    for (const z of [-0.92, -0.25, 0.34, 0.74]) builder.bolt([side * 0.96, 0.17, z], 0.065, mats.gold);

    // The lime plow cheeks sweep outwards in front of the front tires, not flat forks.
    const cheek: Point2[] = [[-0.53, -0.38], [0.53, -0.37], [0.49, 0.11], [0.21, 0.23], [-0.46, 0.20]];
    const plow = builder.polygon('green-hand-plow', cheek, 0.06, [side * 0.94, 0, 1.23], mats.cheek, 'z');
    plow.rotation.y = side * 0.72;
    for (let n = 0; n < 3; n += 1) {
      const offset = side * (-0.33 + n * 0.33);
      const angle = side * 0.72;
      const x = side * 0.94 + offset * Math.cos(angle) + Math.sin(angle) * 0.05;
      const z = 1.23 - offset * Math.sin(angle) + Math.cos(angle) * 0.05;
      for (const fastener of builder.bolt([x, 0.07 - n * 0.05, z], 0.09, mats.gold, 'z')) fastener.rotation.y = angle;
    }
    builder.beam('front-armour-brace', [side * 0.69, -0.20, 0.56], [side * 1.22, -0.32, 0.99], 0.09, 0.08, mats.purple);
    builder.capturePart(side < 0 ? 'armor-left' : 'armor-right', [side * 0.94, 0, 0.75], armorStart);

    // Tall bearing uprights surround a single broad drisc. Their open center remains visible.
    const bearingOutline: Point2[] = [[-0.22, 0.58], [0.78, 0.77], [0.99, 0.87], [1.00, 0.96], [0.86, 1.04], [-0.18, 1.43]];
    const rail = (a: Point2, b: Point2, width: number): Point2[] => {
      const dy = b[0] - a[0]; const dz = b[1] - a[1];
      const length = Math.hypot(dy, dz); const ny = -dz / length * width / 2; const nz = dy / length * width / 2;
      return [[a[0] + ny, a[1] + nz], [b[0] + ny, b[1] + nz], [b[0] - ny, b[1] - nz], [a[0] - ny, a[1] - nz]];
    };
    // Open triangular lightening windows are actual gaps in the metal uprights.
    const armSegments: [Point2, Point2][] = [];
    for (let n = 0; n < bearingOutline.length; n += 1) {
      const a = bearingOutline[n]; const b = bearingOutline[(n + 1) % bearingOutline.length];
      if (a && b) armSegments.push([a, b]);
    }
    armSegments.push([[0.10, 0.66], [0.53, 1.17]], [[0.44, 0.72], [0.67, 1.07]]);
    for (const [a, b] of armSegments) {
      builder.polygon('magenta-weapon-upright', rail(a, b, 0.13), 0.145, [side * 0.51, 0, 0], mats.purple, 'x');
      builder.polygon('lime-weapon-upright-face', rail(a, b, 0.10), 0.027, [side * 0.60, 0, 0], mats.cover, 'x');
    }
    builder.cylinder('anodized-bearing-housing', 0.53, 0.22, [side * 0.5, definition.mount.y, definition.mount.z], mats.purple, 'x');
    builder.cylinder('bearing-cap', 0.32, 0.252, [side * 0.51, definition.mount.y, definition.mount.z], mats.bright, 'x');
    builder.bolt([side * 0.65, definition.mount.y, definition.mount.z], 0.16, mats.gold, 'x');
    for (const [y, z] of [[0.89, 0.93], [0.62, 0.86], [-0.12, 0.67], [-0.11, 1.29]]) {
      if (y !== undefined && z !== undefined) builder.bolt([side * 0.63, y, z], 0.085, mats.gold, 'x');
    }
  }

  const rearStart = builder.checkpoint();
  builder.box('rear-green-sponsor-plate', [1.78, 0.33, 0.045], [0, -0.13, -1.10], mats.rear);
  for (const x of [-0.77, -0.4, 0.4, 0.77]) builder.bolt([x, -0.11, -1.13], 0.07, mats.gold, 'z');
  builder.capturePart('armor-rear', [0, -0.13, -1.10], rearStart);
  // Glimpses of actual mechanical internals through the center split and wheel gaps.
  for (const x of [-0.45, 0.45]) {
    builder.cylinder('drive-motor', 0.27, 0.53, [x, 0.05, -0.21], mats.steel, 'z', root, 24);
    builder.tube('power-cable', [[x, 0.13, -0.62], [x * 0.8, 0.2, -0.35], [x * 0.6, 0.17, 0.24]], 0.018, mats.red);
  }
  builder.cylinder('weapon-motor', 0.4, 0.49, [0.04, 0.10, 0.35], mats.black, 'x');
  builder.cylinder('drive-sprocket', 0.38, 0.065, [-0.13, 0.18, -0.12], mats.steel, 'x', root, 20);
  builder.tube('drive-chain', [[-0.18, 0.35, -0.57], [-0.18, 0.40, -0.10], [-0.18, 0.35, 0.43], [-0.18, 0.12, 0.44], [-0.18, 0.06, -0.10], [-0.18, 0.14, -0.57]], 0.022, mats.black);

  // A wide cylinder with two projecting cutting teeth, not a stack of circular saw blades.
  builder.cylinder('broad-black-drisc', definition.radius * 1.83, definition.halfWidth * 1.88, [0, 0, 0], mats.rotor, 'x', weapon, 48);
  for (const side of [-1, 1]) {
    builder.cylinder('drisc-machined-face', definition.radius * 1.44, 0.045, [side * 0.37, 0, 0], mats.bright, 'x', weapon, 48);
    builder.cylinder('drisc-hub-recess', 0.51, 0.06, [side * 0.40, 0, 0], mats.purple, 'x', weapon, 32);
    for (let n = 0; n < 5; n += 1) {
      const angle = n / 5 * Math.PI * 2;
      builder.cylinder('drisc-relief-pocket', 0.16, 0.047,
        [side * 0.40, Math.cos(angle) * 0.31, Math.sin(angle) * 0.31], mats.black, 'x', weapon, 16);
      builder.bolt([side * 0.43, Math.cos(angle) * 0.19, Math.sin(angle) * 0.19], 0.055, mats.gold, 'x', weapon);
    }
  }
  builder.cylinder('drisc-axle', 0.15, 0.89, [0, 0, 0], mats.bright, 'x', weapon, 24);
  for (const sign of [-1, 1]) {
    const tooth: Point2[] = [[-0.14, -0.10], [0.12, -0.10], [0.17, 0.06], [-0.10, 0.14]];
    const cuttingTooth = builder.polygon('drisc-cutting-tooth', tooth, 0.78, [0, sign * 0.44, 0], mats.bright, 'x', weapon);
    cuttingTooth.rotation.x = sign < 0 ? Math.PI : 0;
  }

  const selfRighter = builder.pivot('ribcage-self-righter', [0, 0.08, -0.90]);
  builder.registerPart('armor-top', selfRighter);
  ribCover(builder, mats, -1, selfRighter);
  ribCover(builder, mats, 1, selfRighter);
  // The center spine is a separate scalloped plate bridging the two curved lids.
  const spine: Point2[] = [[-0.11, -0.04], [0.11, -0.04], [0.17, 0.26], [0.11, 0.48], [0.18, 0.78], [0.11, 1.16], [-0.11, 1.16], [-0.18, 0.78], [-0.11, 0.48], [-0.17, 0.26]];
  builder.polygon('self-righter-spine', spine, 0.04, [0, 0.37, 0], mats.cover, 'y', selfRighter);
  for (const x of [-0.62, 0.62]) {
    for (const z of [0.08, 0.54, 1.13]) builder.bolt([x, 0.24, z], 0.065, mats.gold, 'y', selfRighter);
  }
  // Hinge and actuator stay on the chassis while the ribcage panel rotates about X.
  builder.cylinder('self-righter-hinge', 0.15, 1.0, [0, 0.08, -0.90], mats.steel, 'x');
  const actuator: Point3[] = [[0, 0.13, -0.79], [0, 0.30, -0.20], [0, 0.29, 0.22]];
  builder.tube('self-righter-actuator', actuator, 0.047, mats.purple);
  return selfRighter;
}
