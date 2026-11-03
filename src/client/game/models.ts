import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { BotId, PaintId } from '../../shared/protocol';
import { ModelBuilder } from './models/geometry';
import { createLiveries, makeMaterials } from './models/materials';
import { buildWitchDoctor } from './models/witchdoctor';
import { buildTombstone } from './models/tombstone';

export interface BotModel {
  root: TransformNode;
  wheels: TransformNode[];
  weapon: TransformNode;
  selfRighter?: TransformNode;
  accent: PBRMaterial;
  glow: StandardMaterial;
  meshes: Mesh[];
  botId: BotId;
  paint: PaintId;
  setDamage(damage: number): void;
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
  const glow = material(scene, `${id}-status`, '#343832', 0);
  glow.emissiveColor = Color3.Black();
  const coatings = [mats.paint, mats.cover, mats.deck, mats.side, mats.rear];
  const originalCoatings = coatings.map((coating) => coating.albedoColor.clone());
  return {
    root: builder.root, wheels: builder.wheels, weapon: builder.weapon,
    ...(selfRighter ? { selfRighter } : {}), accent: mats.paint, glow, meshes, botId, paint,
    setDamage(damage) {
      const amount = Math.max(0, Math.min(1, damage));
      for (let index = 0; index < coatings.length; index += 1) {
        const coating = coatings[index]; const original = originalCoatings[index];
        if (coating && original) coating.albedoColor = original.scale(1 - amount * 0.26);
      }
      mats.paint.roughness = 0.38 + amount * 0.35;
      mats.cover.roughness = 0.52 + amount * 0.25;
      mats.black.roughness = 0.44 + amount * 0.28;
      mats.steel.roughness = 0.36 + amount * 0.20;
    },
    dispose() {
      builder.root.dispose(false);
      glow.dispose();
      for (const mat of Object.values(mats)) mat.dispose(false, false);
      for (const texture of liveries.textures) texture.dispose();
    },
  };
}
