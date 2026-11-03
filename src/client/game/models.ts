import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { BotId, PaintId } from '../../shared/protocol';
import type { DamagePartId, RobotDamage } from '../../shared/damage';
import { ModelBuilder } from './models/geometry';
import { createLiveries, makeMaterials } from './models/materials';
import { buildWitchDoctor } from './models/witchdoctor';
import { buildTombstone } from './models/tombstone';
import { DamageVisuals } from './models/damage';

export interface BotModel {
  root: TransformNode;
  wheels: TransformNode[];
  weapon: TransformNode;
  selfRighter?: TransformNode;
  accent: PBRMaterial;
  glow: StandardMaterial;
  meshes: Mesh[];
  parts: ReadonlyMap<DamagePartId, TransformNode>;
  botId: BotId;
  paint: PaintId;
  setDamage(damage: RobotDamage, hullDamage: number): void;
  pulseDamage(time: number, dt: number): void;
  dispose(): void;
}

/** Arena materials stay inexpensive; reconstructed robot surfaces use PBR. */
export function material(scene: Scene, name: string, color: string, shine = 0.25): StandardMaterial {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = Color3.FromHexString(color);
  result.specularColor = new Color3(shine, shine, shine);
  result.specularPower = 80;
  return result;
}

/** Photo-derived models. References and provenance live in assets/reference. */
export function makeBot(scene: Scene, botId: BotId, paint: PaintId, id: string): BotModel {
  const builder = new ModelBuilder(scene, id);
  const liveries = createLiveries(scene, id, botId, paint);
  const mats = makeMaterials(scene, id, botId, paint, liveries);
  const selfRighter = botId === 'witchdoctor'
    ? buildWitchDoctor(builder, mats)
    : (buildTombstone(builder, mats), undefined);
  const meshes = builder.finish();
  const damageVisuals = new DamageVisuals(scene, builder.root, botId, builder.parts, id);
  meshes.push(...damageVisuals.artifacts);
  const glow = material(scene, `${id}-status`, '#343832', 0);
  glow.emissiveColor = Color3.Black();
  return {
    root: builder.root, wheels: builder.wheels, weapon: builder.weapon,
    ...(selfRighter ? { selfRighter } : {}), accent: mats.paint, glow, meshes, parts: builder.parts, botId, paint,
    setDamage(damage, hullDamage) { damageVisuals.setDamage(damage, hullDamage); },
    pulseDamage(time, dt) { damageVisuals.pulseDamage(time, dt); },
    dispose() {
      damageVisuals.dispose();
      builder.root.dispose(false);
      glow.dispose();
      for (const mat of Object.values(mats)) mat.dispose(false, false);
      for (const texture of liveries.textures) texture.dispose();
    },
  };
}
