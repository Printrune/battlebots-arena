import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ARENA_HAZARDS, ARENA_LAYOUT, KILLSAWS, PULVERIZERS } from '../src/shared/arena';
import type { ArenaHazardState, ArenaState } from '../src/shared/arena';
import { makeStage } from '../src/client/game/stage';

const engine = new NullEngine();
const scene = new Scene(engine);
try {
  const existingMesh = MeshBuilder.CreateBox('existing-robot-sentinel', {}, scene);
  existingMesh.material = new StandardMaterial('existing-robot-material', scene);
  const stage = makeStage(scene);
  assert.ok(!existingMesh.isDisposed(), 'Building an arena must preserve existing robot geometry.');
  const floor = scene.getMeshByName('battlebox-floor');
  const deck = scene.getMeshByName('upper-deck-platform');
  assert.ok(floor && deck, 'The driving floor and physical Upper Deck must exist.');
  floor.computeWorldMatrix(true); deck.computeWorldMatrix(true);
  const floorBounds = floor.getBoundingInfo().boundingBox;
  assert.ok(Math.abs(floorBounds.maximumWorld.x - floorBounds.minimumWorld.x - ARENA_LAYOUT.halfWidth * 2) < 0.01);
  assert.ok(Math.abs(floorBounds.maximumWorld.z - floorBounds.minimumWorld.z - ARENA_LAYOUT.halfDepth * 2) < 0.01);
  assert.ok(Math.abs(deck.getBoundingInfo().boundingBox.maximumWorld.y - ARENA_LAYOUT.upperDeck.height) < 0.01);
  assert.equal(stage.hazardNodes.size, ARENA_HAZARDS.length);

  const state: ArenaState = { elapsed: 0, hazards: ARENA_HAZARDS.map((definition): ArenaHazardState => {
    switch (definition.kind) {
      case 'screw': return { id: definition.id, kind: 'screw', active: false, angle: 0, direction: 1 };
      case 'pulverizer': return { id: definition.id, kind: 'pulverizer', phase: 'idle', progress: 0, cooldown: 0 };
      case 'killsaw': return { id: definition.id, kind: 'killsaw', phase: 'locked', extension: 0, angle: 0 };
    }
  }) };
  stage.setState(state);
  stage.pulse(10_000, 10_000);
  const sawHeights = new Map(KILLSAWS.map((definition) => {
    const node = stage.hazardNodes.get(definition.id);
    assert.ok(node);
    return [definition.id, node.position.y];
  }));
  const hammerAngles = new Map(PULVERIZERS.map((definition) => {
    const node = stage.hazardNodes.get(definition.id);
    assert.ok(node);
    return [definition.id, node.rotation.x];
  }));
  for (const hazard of state.hazards) {
    if (hazard.kind === 'killsaw') { hazard.phase = 'cutting'; hazard.extension = 1; hazard.angle = 1; }
    if (hazard.kind === 'pulverizer') { hazard.phase = 'strike'; hazard.progress = 1; }
  }
  state.elapsed = 121;
  stage.setState(state);
  for (const definition of KILLSAWS) {
    const node = stage.hazardNodes.get(definition.id);
    const lockedHeight = sawHeights.get(definition.id);
    assert.ok(node && lockedHeight !== undefined);
    assert.ok(node.position.y - lockedHeight > 0.3, 'Armed saw blades must physically rise through their slots.');
  }
  for (const definition of PULVERIZERS) {
    const node = stage.hazardNodes.get(definition.id);
    assert.ok(node && node.rotation.x !== hammerAngles.get(definition.id), 'The pulverizer arm must swing through its strike.');
  }
  stage.setState(null);
  for (const definition of KILLSAWS) {
    assert.equal(stage.hazardNodes.get(definition.id)?.position.y, sawHeights.get(definition.id), 'Garage reset must retract every saw.');
  }
  assert.ok(stage.stats.meshes < 180, `Arena mesh budget exceeded: ${stage.stats.meshes}`);
  assert.ok(stage.stats.triangles < 150_000, `Arena triangle budget exceeded: ${stage.stats.triangles}`);
  process.stdout.write(`${JSON.stringify({ check: 'PASS: BattleBox geometry and moving mechanisms', ...stage.stats, hazards: stage.hazardNodes.size })}\n`);
  stage.dispose();
  assert.equal(scene.meshes.length, 1, 'Arena disposal must release only its own geometry.');
  assert.equal(scene.materials.length, 1, 'Arena disposal must preserve the robot material.');
} finally {
  scene.dispose();
  assert.equal(scene.meshes.length, 0);
  assert.equal(scene.materials.length, 0);
  engine.dispose();
}
