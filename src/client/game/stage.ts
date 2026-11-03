import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { ARENA_LAYOUT, type ArenaState, type ArenaHazardState } from '../../shared/arena';
import { StageGeometry, type Point, type StageStats } from './stage/geometry';
import { makeStageMaterials, type StageMaterials } from './stage/materials';
import { makeHardware, setHardwareState, pulseHardware } from './stage/hardware';

export interface ArenaStage {
  walls: { mesh: Mesh; side: 'north' | 'south' | 'east' | 'west' }[];
  hazardNodes: ReadonlyMap<string, TransformNode>;
  stats: StageStats;
  setState(state: ArenaState | null): void;
  pulse(time: number, dt?: number): void;
  dispose(): void;
}

function perimeterBumper(geometry: StageGeometry, materials: StageMaterials, position: Point, yaw: number): void {
  const parent = geometry.node(`yellow-spike-strip-${position[0]}-${position[2]}`, position);
  parent.rotation.y = yaw;
  const positions: number[] = []; const indices: number[] = [];
  for (let n = 0; n < 48; n += 1) {
    const start = n - 24; const base = positions.length / 3;
    // Folded, staggered yellow steel teeth match the guide's corrugated spike strip.
    positions.push(start, 0.42, -0.1, start + 0.5, 0.42, 0.07, start + 1, 0.42, -0.1,
      start, 1.02, -0.1, start + 0.5, 1.16, 0.07, start + 1, 1.02, -0.1);
    indices.push(base, base + 1, base + 3, base + 1, base + 4, base + 3,
      base + 1, base + 2, base + 4, base + 2, base + 5, base + 4);
  }
  geometry.custom('folded-yellow-spike-strip', positions, indices, materials.yellow, { parent });
}

function wallSign(geometry: StageGeometry, materials: StageMaterials, position: Point, yaw: number): void {
  const width = 13; const half = width / 2; const height = 1.4;
  const sign = geometry.custom('battlebox-wall-wordmark', [-half, 0, 0, half, 0, 0, half, height, 0, -half, height, 0],
    [0, 2, 1, 0, 3, 2], materials.logo, {}, [0, 1, 1, 1, 1, 0, 0, 0]);
  sign.position.set(...position); sign.rotation.y = yaw;
}

function buildEnclosure(geometry: StageGeometry, materials: StageMaterials): ArenaStage['walls'] {
  const { halfWidth, halfDepth, wallHeight, railHeight } = ARENA_LAYOUT;
  const walls: ArenaStage['walls'] = [];
  geometry.box('battlebox-base-foundation', [50, 0.65, 50], [0, -0.36, 0], materials.black);
  for (const side of [-1, 1]) {
    geometry.box('wall-base-z', [48.7, railHeight, 0.42], [0, railHeight / 2, side * (halfDepth + 0.12)], materials.black);
    geometry.box('wall-base-x', [0.42, railHeight, 48], [side * (halfWidth + 0.12), railHeight / 2, 0], materials.black);
    const glassZ = geometry.box(`polycarbonate-${side > 0 ? 'north' : 'south'}`, [48, wallHeight - railHeight, 0.035], [0, (wallHeight + railHeight) / 2, side * halfDepth], materials.glass, { keep: true });
    const glassX = geometry.box(`polycarbonate-${side > 0 ? 'east' : 'west'}`, [0.035, wallHeight - railHeight, 48], [side * halfWidth, (wallHeight + railHeight) / 2, 0], materials.glass, { keep: true });
    walls.push({ mesh: glassZ, side: side > 0 ? 'north' : 'south' }, { mesh: glassX, side: side > 0 ? 'east' : 'west' });
    for (let n = -24; n <= 24; n += 6) {
      geometry.box('cage-panel-upright-z', [0.13, wallHeight, 0.18], [n, wallHeight / 2, side * 24.05], materials.steel);
      geometry.box('cage-panel-upright-x', [0.18, wallHeight, 0.13], [side * 24.05, wallHeight / 2, n], materials.steel);
      if (n > -24 && n < 24) {
        geometry.box('glass-panel-clamp-z', [0.35, 0.12, 0.22], [n, 2.8, side * 24.05], materials.bright);
        geometry.box('glass-panel-clamp-x', [0.22, 0.12, 0.35], [side * 24.05, 2.8, n], materials.bright);
      }
    }
    for (const y of [railHeight, 4.4, wallHeight]) {
      geometry.box('cage-horizontal-z', [48.9, 0.14, 0.16], [0, y, side * 24.05], materials.steel);
      geometry.box('cage-horizontal-x', [0.16, 0.14, 48.9], [side * 24.05, y, 0], materials.steel);
    }
    // Wide robot-access doors, visible hinge barrels, latches and perimeter seals.
    for (const z of [-4, 4]) {
      geometry.box('access-door-jamb', [0.22, 7, 0.21], [side * 24.12, 4.15, z], materials.black);
      for (const y of [1.9, 4.0, 6.3]) geometry.cylinder('access-door-hinge', 0.18, 0.50, [side * 24.19, y, z], materials.bright, 'y');
    }
    geometry.box('access-door-head', [0.22, 0.20, 8.15], [side * 24.12, 7.65, 0], materials.black);
    geometry.box('access-door-handle', [0.28, 0.16, 0.92], [side * 23.91, 3.6, 3.1], materials.bright);
    geometry.box('access-door-latch', [0.26, 0.42, 0.2], [side * 23.89, 3.6, 3.65], materials.black);
    perimeterBumper(geometry, materials, [0, 0, side * 23.67], 0);
    perimeterBumper(geometry, materials, [side * 23.67, 0, 0], Math.PI / 2);
    wallSign(geometry, materials, [0, 1.8, side * 23.88], side > 0 ? 0 : Math.PI);
    wallSign(geometry, materials, [side * 23.88, 1.8, 12], side > 0 ? Math.PI / 2 : -Math.PI / 2);
  }
  for (const x of [-24, 24]) for (const z of [-24, 24]) {
    geometry.box('corner-cage-column', [0.55, 8.6, 0.55], [x, 4.3, z], materials.black);
    geometry.box('corner-column-owner-mark', [0.58, 0.8, 0.58], [x, 1.8, z], x * z > 0 ? materials.red : materials.blue);
  }
  return walls;
}

function buildUpperDeck(geometry: StageGeometry, materials: StageMaterials): void {
  const deck = ARENA_LAYOUT.upperDeck;
  geometry.box('upper-deck-platform', [deck.width, deck.height, deck.depth], [deck.x, deck.height / 2, deck.z], materials.deck, { keep: true });
  // Red return lips surround the shelf, with gaps for its two exposed screw banks.
  for (const x of [-8, 8]) {
    geometry.box('upper-deck-red-side-return', [0.18, 0.50, 8], [x, 0.30, 20], materials.red);
    for (let n = 0; n < 8; n += 1) geometry.box('upper-deck-side-corrugation', [0.26, 0.45, 0.18], [x, 0.28, 16.25 + n], materials.red);
    geometry.box('upper-deck-end-corner', [0.95, 0.58, 1.0], [x * 0.94, 0.31, 15.95], materials.red);
    geometry.box('upper-deck-end-metal-cap', [1.03, 0.09, 1.09], [x * 0.94, 0.63, 15.95], materials.steel);
  }
  geometry.box('upper-deck-central-drive-housing', [1.24, 0.73, 1.40], [0, 0.40, 15.93], materials.red);
  geometry.box('upper-deck-central-drive-lid', [1.38, 0.10, 1.52], [0, 0.81, 15.93], materials.bright);
  for (const x of [-0.47, 0.47]) for (const z of [15.45, 16.35]) geometry.cylinder('upper-deck-cover-bolt', 0.09, 0.07, [x, 0.88, z], materials.steel, 'y', {}, 6);
  geometry.box('upper-deck-rear-lip', [16, 0.3, 0.15], [0, 0.55, 23.85], materials.red);
}

function buildProductionSurround(geometry: StageGeometry, materials: StageMaterials): void {
  for (const sign of [-1, 1]) {
    for (const y of [10.8, 11.5]) {
      geometry.box('lighting-truss-z-chord', [51, 0.10, 0.1], [0, y, sign * 25.8], materials.steel);
      geometry.box('lighting-truss-x-chord', [0.10, 0.10, 51], [sign * 25.8, y, 0], materials.steel);
    }
    for (let n = -24; n < 24; n += 4) {
      geometry.beam('lighting-truss-z-diagonal', [n, 10.8, sign * 25.8], [n + 4, 11.5, sign * 25.8], 0.065, 0.065, materials.steel);
      geometry.beam('lighting-truss-x-diagonal', [sign * 25.8, 10.8, n], [sign * 25.8, 11.5, n + 4], 0.065, 0.065, materials.steel);
    }
    for (const x of [-16, -8, 0, 8, 16]) {
      geometry.box('broadcast-light-housing', [1.8, 0.28, 0.55], [x, 10.6, sign * 25.8], materials.black);
      const emitter = geometry.box('broadcast-light-emitter', [1.45, 0.05, 0.45], [x, 10.42, sign * 25.8], materials.whiteLight);
      emitter.rotation.x = sign * 0.30;
    }
    for (let row = 0; row < 3; row += 1) {
      geometry.box('audience-bleacher-z', [51, 0.8, 2.0], [0, 0.2 + row * 0.8, sign * (28 + row * 2)], materials.black);
      geometry.box('audience-bleacher-x', [2.0, 0.8, 51], [sign * (28 + row * 2), 0.2 + row * 0.8, 0], materials.black);
      for (let seat = -10; seat <= 10; seat += 1) {
        const offset = seat * 2.25;
        geometry.box('audience-silhouette-z', [0.54, 0.95, 0.38], [offset, 1.2 + row * 0.8, sign * (28 + row * 2)], materials.black);
        geometry.box('audience-silhouette-x', [0.38, 0.95, 0.54], [sign * (28 + row * 2), 1.2 + row * 0.8, offset], materials.black);
      }
    }
  }
}

/** WCVII-era BattleBox with server-owned hazard states and bounded visual extrapolation. */
export function makeStage(scene: Scene): ArenaStage {
  const geometry = new StageGeometry(scene);
  const materials = makeStageMaterials(scene);
  geometry.ground('battlebox-floor', 48, 48, [0, 0, 0], materials.floor, { keep: true });
  const walls = buildEnclosure(geometry, materials);
  buildUpperDeck(geometry, materials);
  buildProductionSurround(geometry, materials);
  const visuals = makeHardware(geometry, materials);
  const hazardNodes = new Map<string, TransformNode>();
  for (const visual of visuals) hazardNodes.set(visual.id, visual.node);
  const { stats } = geometry.finish();
  let age = 0;
  let previousTime: number | null = null;
  let disposed = false;
  return {
    walls, hazardNodes, stats,
    setState(state) {
      age = 0;
      const lookup = new Map<string, ArenaHazardState>();
      if (state) for (const hazard of state.hazards) lookup.set(hazard.id, hazard);
      for (const visual of visuals) setHardwareState(visual, lookup.get(visual.id));
    },
    pulse(time, dt) {
      const delta = dt ?? (previousTime === null ? 0 : Math.max(0, Math.min(0.05, time - previousTime)));
      previousTime = time;
      age = Math.min(0.1, age + delta);
      pulseHardware(visuals, time, age);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometry.root.dispose(false);
      const owned = [materials.floor, materials.deck, materials.steel, materials.bright, materials.black, materials.yellow, materials.red, materials.blue, materials.amberLight, materials.whiteLight, materials.redLight, materials.glass, materials.logo];
      for (const material of owned) material.dispose(false, false);
      for (const texture of materials.textures) texture.dispose();
    },
  };
}
