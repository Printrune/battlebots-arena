import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { BOTS, PAINTS } from '../src/shared/protocol';
import type { BotId } from '../src/shared/protocol';
import { makeBot } from '../src/client/game/models';
import { pristineDamage } from '../src/shared/damage';

const engine = new NullEngine();
const scene = new Scene(engine);
try {
  for (const botId of ['witchdoctor', 'tombstone'] satisfies BotId[]) {
    for (const paint of PAINTS) {
      const model = makeBot(scene, botId, paint.id, `verify-${botId}-${paint.id}`);
      const minimum = { x: Infinity, y: Infinity, z: Infinity };
      const maximum = { x: -Infinity, y: -Infinity, z: -Infinity };
      let triangles = 0;
      for (const mesh of model.meshes) {
        triangles += mesh.getTotalIndices() / 3;
        if (!mesh.isVisible || !mesh.isEnabled()) continue;
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        for (const axis of ['x', 'y', 'z'] satisfies ('x' | 'y' | 'z')[]) {
          minimum[axis] = Math.min(minimum[axis], box.minimumWorld[axis]);
          maximum[axis] = Math.max(maximum[axis], box.maximumWorld[axis]);
        }
      }
      const definition = BOTS[botId];
      assert.equal(model.wheels.length, definition.physics.wheelZ.length * 2);
      assert.equal(Boolean(model.selfRighter), definition.physics.selfRight);
      assert.ok(minimum.z < -1 && maximum.z > 1.3, 'The rear frame and weapon must have real depth.');
      assert.ok(maximum.x - minimum.x >= 2.3, 'The silhouette must include the exposed wheels or bar.');
      assert.ok(Math.abs(minimum.y + definition.physics.wheelRadius) < 0.03,
        `Tires must meet the physical floor: ${botId} lowest=${minimum.y}`);
      assert.ok(triangles < 45_000, `Mobile geometry budget exceeded: ${triangles}`);
      assert.ok(model.meshes.length < 110, `Too many mesh submissions: ${model.meshes.length}`);
      const damage = pristineDamage(botId);
      damage.revision = 1;
      for (const part of damage.parts) part.integrity = 0.3;
      model.setDamage(damage, 0.7);
      model.setDamage(pristineDamage(botId), 0);
      process.stdout.write(`${JSON.stringify({ botId, paint: paint.id, triangles, meshes: model.meshes.length, wheels: model.wheels.length, minimum, maximum })}\n`);
      model.dispose();
      assert.equal(scene.meshes.length, 0, 'Replacing a bot must release its meshes.');
      assert.equal(scene.materials.length, 0, 'Replacing a bot must release its materials.');
    }
  }
} finally { scene.dispose(); engine.dispose(); }
