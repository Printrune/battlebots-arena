import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { damageParts, pristineDamage } from '../src/shared/damage';
import type { DebrisSnapshot } from '../src/shared/damage';
import type { BotId } from '../src/shared/protocol';
import { makeBot } from '../src/client/game/models';
import { DebrisRenderer } from '../src/client/game/debris';

function geometry(node: TransformNode): string {
  return createHash('sha256').update(JSON.stringify({ position: node.position.asArray(), rotation: node.rotation.asArray(), scaling: node.scaling.asArray(),
    meshes: node.getChildMeshes().filter((mesh): mesh is Mesh => mesh instanceof Mesh).map((mesh) => ({
      position: mesh.position.asArray(), rotation: mesh.rotation.asArray(), scaling: mesh.scaling.asArray(),
      vertices: Array.from(mesh.getVerticesData(VertexBuffer.PositionKind) ?? []),
    })) })).digest('hex');
}

const engine = new NullEngine();
const scene = new Scene(engine);
try {
  for (const botId of ['witchdoctor', 'tombstone'] satisfies BotId[]) {
    const model = makeBot(scene, botId, 'signature', 'damage-proof');
    const expected = damageParts(botId);
    assert.equal(model.parts.size, expected.length);
    for (const part of expected) assert.ok(model.parts.has(part.id), `Missing ${part.id} assembly.`);
    const wheel = expected.find((part) => part.kind === 'wheel');
    const armor = model.parts.get('armor-right');
    assert.ok(wheel && armor);
    const originalArmor = geometry(armor);
    const damage = pristineDamage(botId);
    damage.revision = 1;
    for (const part of damage.parts) {
      if (part.id === wheel.id || part.id === 'armor-left') part.integrity = 0;
      if (part.id === 'armor-right') part.integrity = 0.3;
      if (part.id === 'weapon') part.integrity = 0.2;
    }
    damage.marks.push({ id: 1, partId: 'armor-right', point: { x: 1, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 }, severity: 0.75 });
    model.setDamage(damage, 0.6);
    model.pulseDamage(1, 0.016);
    assert.equal(model.parts.get(wheel.id)?.isEnabled(), false, 'A detached wheel must leave the attached model.');
    assert.equal(model.parts.get('armor-left')?.isEnabled(), false, 'Torn armor must expose the remaining chassis.');
    assert.ok(model.parts.get('weapon')?.isEnabled(), 'A damaged weapon stays physically attached.');
    assert.notEqual(geometry(armor), originalArmor, 'Dented armor must alter visible geometry, not only its color.');

    const fragment: DebrisSnapshot = {
      id: 1, ownerId: 'owner', botId, partId: wheel.id, localOrigin: { x: 0, y: 0, z: 0 },
      position: { x: 3, y: 1, z: 2 }, rotation: { x: 0, y: 0, z: 0, w: 1 },
      velocity: { x: 1, y: 0, z: 0 }, angularVelocity: { x: 2, y: 0, z: 0 }, remaining: 10,
    };
    const debris = new DebrisRenderer(scene, (id) => id === 'owner' ? model : undefined);
    const beforeDebris = scene.meshes.length;
    debris.update([fragment]); debris.pulse(0.016, 0.05);
    assert.equal(debris.size, 1);
    assert.ok(scene.meshes.length > beforeDebris, 'Detached geometry must exist independently from the hidden wheel.');
    assert.ok(scene.getTransformNodeByName('debris-1')?.isEnabled());
    debris.update([]);
    assert.equal(scene.meshes.length, beforeDebris, 'Expired fragments must release their cloned geometry.');

    model.setDamage(pristineDamage(botId), 0);
    model.pulseDamage(2, 0);
    assert.ok(model.parts.get(wheel.id)?.isEnabled(), 'A rematch restores every wheel.');
    assert.equal(geometry(armor), originalArmor, 'A rematch restores undeformed armor.');
    const scarMeshes = model.meshes.filter((mesh) => mesh.name.includes('damage-scar-'));
    const missed = pristineDamage(botId); missed.revision = 2;
    missed.marks.push({ id: 2, partId: 'armor-right', point: { x: 99, y: 99, z: 99 }, normal: { x: 1, y: 0, z: 0 }, severity: 0.8 });
    model.setDamage(missed, 0);
    assert.ok(scarMeshes.every((mesh) => !mesh.isEnabled()), 'A missed surface projection cannot leave a floating scar.');
    if (botId === 'tombstone') {
      missed.revision = 3;
      missed.marks = [{ id: 3, partId: 'armor-right', point: { x: 1, y: 0, z: 0.7 }, normal: { x: 1, y: 0, z: 0 }, severity: 0.8 }];
      model.setDamage(missed, 0);
      const scar = scarMeshes.find((mesh) => mesh.isEnabled());
      assert.ok(scar?.parent instanceof Mesh, 'A forward-frame scar must attach to an actual surface mesh.');
    }
    model.dispose();
    assert.equal(scene.meshes.length, 0); assert.equal(scene.materials.length, 0);
    process.stdout.write(`${JSON.stringify({ check: 'PASS: visible damage and debris cleanup', botId, components: expected.length })}\n`);
  }
} finally { scene.dispose(); engine.dispose(); }
