import { BOTS } from '../../../shared/protocol';
import { wheelPartId } from '../../../shared/damage';
import { ModelBuilder, type Point2, type Point3 } from './geometry';
import type { ModelMaterials } from './materials';

/** A square section with a true round relief hole through the horizontal weapon bar. */
function perforatedBarSection(builder: ModelBuilder, mats: ModelMaterials, x: number): void {
  const positions: number[] = []; const indices: number[] = []; const uvs: number[] = [];
  const segments = 32; const half = 0.23; const hole = 0.145;
  for (const y of [-0.10, 0.10]) {
    for (const inner of [false, true]) {
      for (let n = 0; n <= segments; n += 1) {
        const angle = n / segments * Math.PI * 2;
        const radius = inner ? hole : half / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
        positions.push(x + Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        uvs.push((x + Math.cos(angle) * radius + 1.65) / 3.3, (Math.sin(angle) * radius + half) / (half * 2));
      }
    }
  }
  const stride = segments + 1;
  for (let n = 0; n < segments; n += 1) {
    const a = n; const b = n + stride; const c = n + stride * 2; const d = n + stride * 3;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
    indices.push(c, d, c + 1, c + 1, d, d + 1);
    indices.push(a, c, a + 1, a + 1, c, c + 1);
    indices.push(b, b + 1, d, d, b + 1, d + 1);
  }
  builder.vertexMesh('weapon-round-relief-hole', positions, indices, uvs, mats.black, builder.weapon);
}

/** Classic 2021 triangular open-frame configuration, including the full-width bar. */
export function buildTombstone(builder: ModelBuilder, mats: ModelMaterials): void {
  const { physics, weapon: definition } = BOTS.tombstone;
  const { weapon } = builder;
  weapon.position.set(definition.mount.x, definition.mount.y, definition.mount.z);

  // Open rear casing exposes the drive pack when the independent roof tears off.
  builder.box('rear-drive-floor', [1.94, 0.065, 1.27], [0, -0.365, -0.71], mats.paint);
  builder.box('rear-drive-front-bulkhead', [1.86, 0.38, 0.055], [0, -0.17, -0.10], mats.black);
  const topStart = builder.checkpoint();
  builder.box('rear-deck-reaper-livery', [1.91, 0.045, 1.25], [0, 0.064, -0.71], mats.deck);
  for (const side of [-1, 1]) for (const z of [-1.25, -0.89, -0.50, -0.18]) builder.bolt([side * 0.87, 0.108, z], 0.06, mats.steel);
  builder.capturePart('armor-top', [0, 0.064, -0.71], topStart);
  const rearStart = builder.checkpoint();
  builder.box('rear-armour-wall', [1.94, 0.40, 0.065], [0, -0.18, -1.33], mats.paint);
  builder.box('rear-sponsor-panel', [1.87, 0.38, 0.025], [0, -0.18, -1.36], mats.rear);
  builder.capturePart('armor-rear', [0, -0.18, -1.36], rearStart);
  for (const side of [-1, 1]) {
    const wheel = builder.tire(side * physics.trackWidth / 2, physics.wheelZ[0] ?? -0.65, physics.wheelRadius, physics.wheelWidth, mats.rubber, mats.paint, mats.steel, mats.black);
    builder.registerPart(wheelPartId('tombstone', side, 0), wheel);
    const sideStart = builder.checkpoint();
    builder.box('drive-casing-side-wall', [0.065, 0.40, 1.24], [side * 0.95, -0.18, -0.71], mats.paint);
    builder.box('side-drive-panel', [0.025, 0.36, 1.19], [side * 0.98, -0.17, -0.71], mats.side);
    builder.capturePart(side < 0 ? 'armor-left' : 'armor-right', [side * 0.98, -0.17, -0.71], sideStart);
    builder.box('drive-bearing-carrier', [0.10, 0.31, 0.46], [side * 0.99, -0.03, -0.65], mats.bright);
    builder.cylinder('wheel-bearing', 0.29, 0.13, [side * 1.02, 0, -0.65], mats.black, 'x');
  }
  for (const side of [-1, 1]) {
    builder.cylinder('exposed-rear-drive-motor', 0.30, 0.68, [side * 0.55, -0.14, -0.69], mats.steel, 'z');
    builder.cylinder('rear-motor-end-cap', 0.32, 0.08, [side * 0.55, -0.14, -1.04], mats.black, 'z');
    builder.tube('rear-battery-cable', [[side * 0.25, -0.09, -0.95], [side * 0.31, -0.06, -0.64], [side * 0.5, -0.08, -0.40]], 0.018, mats.red);
  }
  builder.box('exposed-battery-pack', [0.46, 0.25, 0.68], [0, -0.19, -0.73], mats.black);
  for (const z of [-0.91, -0.57]) builder.box('battery-retaining-strap', [0.49, 0.035, 0.075], [0, -0.045, z], mats.steel);

  // The chassis converges continuously into a shaft at the nose. Roof and floor
  // rails have real triangular spaces through which the motor and drive chain show.
  const rearLeft: Point3 = [-0.95, 0.07, -0.15]; const rearRight: Point3 = [0.95, 0.07, -0.15];
  const frontLeft: Point3 = [-0.17, -0.10, 1.63]; const frontRight: Point3 = [0.17, -0.10, 1.63];
  for (const layer of [0, -0.38]) {
    const move = (p: Point3): Point3 => [p[0], p[1] + layer, p[2]];
    builder.beam('triangular-frame-edge', move(rearLeft), move(frontLeft), 0.12, 0.075, mats.paint);
    builder.beam('triangular-frame-edge', move(rearRight), move(frontRight), 0.12, 0.075, mats.paint);
    const stations = [
      { z: -0.12, x: 0.93, y: 0.065 }, { z: 0.42, x: 0.69, y: 0.01 },
      { z: 0.97, x: 0.45, y: -0.043 }, { z: 1.48, x: 0.22, y: -0.09 },
    ];
    for (let n = 0; n < stations.length - 1; n += 1) {
      const a = stations[n]; const b = stations[n + 1];
      if (!a || !b) continue;
      for (const side of [-1, 1]) {
        builder.beam('triangular-lattice-web', [side * a.x, a.y + layer, a.z], [-side * b.x, b.y + layer, b.z], 0.11, 0.06, mats.black);
      }
    }
  }
  for (const side of [-1, 1]) {
    for (const [x, z] of [[0.85, 0.05], [0.58, 0.64], [0.31, 1.24]]) {
      if (x === undefined || z === undefined) continue;
      const y = 0.05 - z * 0.09;
      builder.box('frame-upright-web', [0.065, 0.38, 0.10], [side * x, y - 0.18, z], mats.black);
      builder.bolt([side * x, y + 0.05, z], 0.057, mats.steel);
    }
    // Rounded edge tubes and rows of fasteners are prominent in the official photo.
    builder.tube('outer-frame-welded-rail', [[side * 0.97, 0.13, -1.34], [side * 0.97, 0.13, -0.10], [side * 0.20, -0.04, 1.65]], 0.025, mats.steel);
  }
  builder.box('weapon-shaft-platform', [0.49, 0.11, 0.46], [0, -0.11, 1.57], mats.black);
  builder.cylinder('weapon-shaft-bearing', 0.35, 0.28, [0, -0.22, 1.67], mats.steel);
  builder.cylinder('weapon-shaft-top-washer', 0.31, 0.045, [0, -0.01, 1.67], mats.bright);
  builder.bolt([0, 0.028, 1.67], 0.20, mats.bright);

  // Exposed chain drive and motor, visible through the open triangular frame.
  builder.cylinder('weapon-drive-motor', 0.48, 0.53, [0.01, -0.20, 0.10], mats.steel, 'y', builder.root, 32);
  builder.cylinder('motor-black-endcap', 0.50, 0.05, [0.01, 0.075, 0.10], mats.black);
  for (const z of [0.18, 1.51]) {
    builder.cylinder('weapon-chain-sprocket', z > 1 ? 0.30 : 0.25, 0.05, [0, -0.18, z], mats.steel, 'y', builder.root, 24);
    builder.cylinder('sprocket-hub', 0.10, 0.08, [0, -0.14, z], mats.black);
  }
  const chainPath: Point3[] = [[-0.13, -0.15, 0.18], [-0.13, -0.15, 1.51], [0, -0.15, 1.65], [0.13, -0.15, 1.51], [0.13, -0.15, 0.18], [0, -0.15, 0.05], [-0.13, -0.15, 0.18]];
  builder.tube('steel-roller-chain', chainPath, 0.024, mats.black, builder.root, 6);
  for (let n = 0; n < 17; n += 1) {
    for (const side of [-1, 1]) builder.box('chain-link', [0.055, 0.035, 0.032], [side * 0.13, -0.135, 0.2 + n * 0.075], mats.steel);
  }
  builder.tube('motor-power-cable', [[0.29, -0.18, -0.20], [0.35, -0.13, 0.1], [0.28, -0.12, 0.35]], 0.016, mats.red);

  // Broad, heavy rectangular steel bar with two genuine circular lightening holes.
  builder.box('weapon-center-solid', [0.90, 0.20, 0.46], [0, 0, 0], mats.black, weapon);
  for (const side of [-1, 1]) {
    perforatedBarSection(builder, mats, side * 0.68);
    builder.box('weapon-end-solid', [0.74, 0.20, 0.46], [side * 1.28, 0, 0], mats.black, weapon);
    const cutter: Point2[] = [[-0.22, -0.23], [0.18, -0.23], [0.21, 0.30], [-0.22, 0.30]];
    builder.polygon('bright-machined-cutting-end', cutter, 0.21, [side * 1.43, 0, 0.015], mats.bright, 'y', weapon);
    builder.bolt([side * 1.42, 0.12, 0.02], 0.075, mats.steel, 'y', weapon);
  }
  builder.cylinder('weapon-center-boss', 0.35, 0.225, [0, 0, 0], mats.bright, 'y', weapon, 32);
  builder.cylinder('weapon-center-hex', 0.21, 0.245, [0, 0, 0], mats.black, 'y', weapon, 6);
}
