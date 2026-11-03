import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Scene } from '@babylonjs/core/scene';
import { paintColor, type BotId, type PaintId } from '../../../shared/protocol';
import { projectReferenceLivery } from './photo-livery';

export interface Liveries {
  textures: DynamicTexture[];
  steel: DynamicTexture | null;
  ribs: DynamicTexture | null;
  cheek: DynamicTexture | null;
  rotor: DynamicTexture | null;
  deck: DynamicTexture | null;
  side: DynamicTexture | null;
  rear: DynamicTexture | null;
}

export interface ModelMaterials {
  paint: PBRMaterial;
  cover: PBRMaterial;
  cheek: PBRMaterial;
  rotor: PBRMaterial;
  deck: PBRMaterial;
  side: PBRMaterial;
  rear: PBRMaterial;
  steel: PBRMaterial;
  bright: PBRMaterial;
  black: PBRMaterial;
  purple: PBRMaterial;
  rubber: PBRMaterial;
  gold: PBRMaterial;
  red: PBRMaterial;
}

function texture(scene: Scene, name: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): DynamicTexture | null {
  // Headless physics/geometry tests have no canvas. The browser owns texture rendering.
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  draw(context);
  const result = new DynamicTexture(name, canvas, scene, true);
  result.anisotropicFilteringLevel = 4;
  result.update(false);
  return result;
}

function randomSource(seed: number): () => number {
  let state = seed;
  return () => { state = (state * 16807) % 2147483647; return state / 2147483647; };
}

function wear(ctx: CanvasRenderingContext2D, width: number, height: number, seed: number, density = 350): void {
  const random = randomSource(seed);
  for (let n = 0; n < density; n += 1) {
    const x = random() * width; const y = random() * height;
    ctx.strokeStyle = n % 3 ? 'rgba(215,219,209,.16)' : 'rgba(7,10,8,.22)';
    ctx.lineWidth = 0.5 + random() * 1.4;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + 3 + random() * 40, y + random() * 10 - 5); ctx.stroke();
  }
}

function crackle(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const random = randomSource(8159);
  ctx.strokeStyle = 'rgba(57,109,28,.28)'; ctx.lineWidth = 0.7;
  for (let n = 0; n < 1600; n += 1) {
    const x = random() * width; const y = random() * height;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let p = 0; p < 3; p += 1) ctx.lineTo(x + (random() - 0.5) * 22, y + (random() - 0.5) * 22);
    ctx.stroke();
  }
}

function skeletonHand(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const bones: [number, number, number, number][] = [
    [0, 46, -5, 9], [-5, 9, -30, -7], [-30, -7, -48, -43],
    [-5, 9, -8, -31], [-8, -31, -18, -72], [0, 8, 13, -35],
    [13, -35, 10, -80], [5, 9, 32, -20], [32, -20, 38, -57],
    [12, 18, 48, 8], [48, 8, 61, -16],
  ];
  for (const color of ['#111613', '#f0eddc']) {
    ctx.strokeStyle = color; ctx.lineWidth = color === '#111613' ? 15 : 9;
    for (const [ax, ay, bx, by] of bones) { ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
  }
  ctx.restore();
}

function skull(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.fillStyle = '#e5ebd8';
  ctx.beginPath(); ctx.ellipse(0, -8, 53, 62, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(-31, 24, 62, 40);
  ctx.fillStyle = '#17221b';
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.ellipse(side * 23, -7, 15, 22, side * -0.25, 0, Math.PI * 2); ctx.fill();
  }
  ctx.beginPath(); ctx.moveTo(0, 9); ctx.lineTo(-9, 31); ctx.lineTo(9, 31); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#17221b'; ctx.lineWidth = 4;
  for (let p = -23; p <= 23; p += 11) { ctx.beginPath(); ctx.moveTo(p, 43); ctx.lineTo(p, 65); ctx.stroke(); }
  ctx.restore();
}

export function createLiveries(scene: Scene, id: string, botId: BotId, paint: PaintId): Liveries {
  const lime = paint === 'signature' ? '#42d52a' : paintColor(botId, paint);
  const pale = Color3.FromHexString(paint === 'signature' ? '#c9e4ac' : paintColor(botId, paint)).scale(0.45).add(new Color3(0.5, 0.5, 0.5)).toHexString();
  const steel = texture(scene, `${id}-machined-wear`, 512, 512, (ctx) => {
    ctx.fillStyle = '#d0d2d0'; ctx.fillRect(0, 0, 512, 512);
    const random = randomSource(118);
    for (let n = 0; n < 700; n += 1) {
      ctx.strokeStyle = `rgba(40,47,44,${random() * 0.13})`;
      const y = random() * 512; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y + 1); ctx.stroke();
    }
    wear(ctx, 512, 512, 359, 220);
  });
  const ribs = botId === 'witchdoctor' ? texture(scene, `${id}-ribcage-livery`, 1024, 1024, (ctx) => {
    ctx.fillStyle = pale; ctx.fillRect(0, 0, 1024, 1024); crackle(ctx, 1024, 1024);
    ctx.fillStyle = '#1a1e22';
    for (const side of [-1, 1]) {
      for (let n = 0; n < 4; n += 1) {
        ctx.save(); ctx.translate(512 + side * 235, 190 + n * 201); ctx.rotate(side * (-0.18 + n * 0.035));
        ctx.beginPath(); ctx.moveTo(-90, -62); ctx.bezierCurveTo(-130, -30, -127, 42, -87, 64);
        ctx.bezierCurveTo(-42, 86, 85, 53, 143, -4); ctx.bezierCurveTo(164, -36, 142, -71, 86, -75);
        ctx.bezierCurveTo(19, -67, -34, -71, -90, -62); ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
    ctx.save(); ctx.translate(512, 928); ctx.rotate(Math.PI);
    ctx.font = 'bold 55px Georgia'; ctx.textAlign = 'center'; ctx.fillText('WITCH DOCTOR', 0, 0); ctx.restore();
    wear(ctx, 1024, 1024, 547, 90);
  }) : null;
  const cheek = botId === 'witchdoctor' ? texture(scene, `${id}-front-hand-livery`, 1024, 512, (ctx) => {
    ctx.fillStyle = lime; ctx.fillRect(0, 0, 1024, 512);
    skeletonHand(ctx, 660, 260, 2.2);
    ctx.fillStyle = '#121710'; ctx.font = 'bold italic 86px Arial'; ctx.fillText('Mastercam', 52, 448);
    ctx.font = 'bold 34px Arial'; ctx.fillText('LYNX Technik', 52, 85);
    wear(ctx, 1024, 512, 55, 100);
  }) : null;
  const rotor = botId === 'witchdoctor' ? texture(scene, `${id}-skull-rotor-livery`, 1024, 512, (ctx) => {
    ctx.fillStyle = '#10251b'; ctx.fillRect(0, 0, 1024, 512);
    skull(ctx, 260, 240, 2.6); skull(ctx, 775, 240, 2.6);
    skeletonHand(ctx, 500, 380, 1.5);
    ctx.fillStyle = '#9eb650'; ctx.font = 'bold 65px Georgia'; ctx.fillText('WITCH DOCTOR', 115, 85);
    wear(ctx, 1024, 512, 441, 200);
  }) : null;
  const deck = botId === 'tombstone' ? texture(scene, `${id}-tombstone-deck-livery`, 1024, 1024, (ctx) => {
    ctx.fillStyle = '#25282a'; ctx.fillRect(0, 0, 1024, 1024);
    ctx.fillStyle = '#75807d'; ctx.fillRect(45, 65, 934, 167);
    ctx.fillStyle = '#e8eeeb'; ctx.font = 'bold 104px Georgia'; ctx.textAlign = 'center';
    ctx.fillText('TOMBSTONE', 512, 185);
    // Painted hood, skull, scythe, and robe reproduce the reaper placement on the rear deck.
    ctx.strokeStyle = '#c5cecb'; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(337, 750); ctx.quadraticCurveTo(500, 294, 663, 750); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(350, 744); ctx.bezierCurveTo(350, 466, 670, 466, 667, 744); ctx.stroke();
    skull(ctx, 507, 585, 1.2);
    for (let n = 0; n < 9; n += 1) {
      ctx.beginPath(); ctx.moveTo(504, 660); ctx.lineTo(325 + n * 46, 905 - Math.abs(n - 4) * 18); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(740, 848); ctx.lineTo(650, 358); ctx.quadraticCurveTo(502, 320, 398, 419); ctx.stroke();
    ctx.fillStyle = '#0b0e0f';
    for (const side of [-1, 1]) for (let n = 0; n < 5; n += 1) {
      ctx.beginPath(); ctx.roundRect(512 + side * 330 - 11, 350 + n * 42, 22, 92, 10); ctx.fill();
    }
    wear(ctx, 1024, 1024, 519, 500);
  }) : null;
  const side = texture(scene, `${id}-side-sponsors`, 1024, 384, (ctx) => {
    ctx.fillStyle = botId === 'witchdoctor' ? '#321d39' : '#171b1d'; ctx.fillRect(0, 0, 1024, 384);
    ctx.fillStyle = '#e2e4da';
    if (botId === 'witchdoctor') {
      ctx.font = 'bold 68px Georgia'; ctx.fillText('WITCH DOCTOR', 50, 100);
      ctx.font = 'italic bold 48px Arial'; ctx.fillText('DS SOLIDWORKS', 70, 204);
      ctx.font = 'bold 44px Arial'; ctx.fillText('KALAMAZOO   Magnmotor', 70, 290);
    } else {
      ctx.font = 'bold 67px Georgia'; ctx.fillText('HARDCORE ROBOTICS', 70, 105);
      ctx.font = 'bold 44px Arial'; ctx.fillText('NPC     PRINTKITS', 95, 225);
      ctx.strokeStyle = '#a62e2b'; ctx.lineWidth = 13; ctx.beginPath(); ctx.arc(750, 240, 75, 0, Math.PI * 2); ctx.stroke();
    }
    wear(ctx, 1024, 384, 907, 140);
  });
  const rear = texture(scene, `${id}-rear-sponsors`, 1024, 384, (ctx) => {
    ctx.fillStyle = botId === 'witchdoctor' ? lime : '#1c1d1d'; ctx.fillRect(0, 0, 1024, 384);
    ctx.fillStyle = botId === 'witchdoctor' ? '#172014' : '#d4dbd7';
    ctx.font = 'bold 75px Arial'; ctx.fillText(botId === 'witchdoctor' ? 'Mastercam' : 'TOMBSTONE', 70, 108);
    ctx.font = 'bold 49px Arial'; ctx.fillText(botId === 'witchdoctor' ? 'LYNX Technik AG' : 'HARDCORE ROBOTICS', 70, 212);
    ctx.font = '38px Arial'; ctx.fillText(botId === 'witchdoctor' ? 'WitchDoctor.Store' : 'NPC     PRINTKITS', 70, 309);
    wear(ctx, 1024, 384, 88, 80);
  });
  const textures = [steel, ribs, cheek, rotor, deck, side, rear].filter((item): item is DynamicTexture => item !== null);
  if (paint === 'signature') projectReferenceLivery(botId, botId === 'witchdoctor' ? ribs : deck);
  return { textures, steel, ribs, cheek, rotor, deck, side, rear };
}

export function makeMaterials(scene: Scene, id: string, botId: BotId, paint: PaintId, maps: Liveries): ModelMaterials {
  function pbr(name: string, color: string, metallic: number, roughness: number, map: DynamicTexture | null = null): PBRMaterial {
    const mat = new PBRMaterial(`${id}-${name}`, scene);
    mat.albedoColor = Color3.FromHexString(color); mat.metallic = metallic; mat.roughness = roughness;
    mat.environmentIntensity = 0.9;
    mat.backFaceCulling = false;
    if (map) mat.albedoTexture = map;
    return mat;
  }
  return {
    paint: pbr('paint', paint === 'signature' ? (botId === 'witchdoctor' ? '#42d52a' : '#252a28') : paintColor(botId, paint), 0.42, 0.38, maps.steel),
    cover: pbr('ribcage-coating', '#ffffff', 0.25, 0.52, botId === 'witchdoctor' ? maps.ribs : maps.deck),
    cheek: pbr('front-hand-coating', '#ffffff', 0.35, 0.48, maps.cheek),
    rotor: pbr('rotor-coating', '#ffffff', 0.55, 0.44, maps.rotor),
    deck: pbr('deck-coating', '#ffffff', 0.65, 0.44, maps.deck),
    side: pbr('side-sponsors', '#ffffff', 0.4, 0.53, maps.side),
    rear: pbr('rear-sponsors', '#ffffff', 0.4, 0.5, maps.rear),
    steel: pbr('worn-steel', '#777e80', 0.92, 0.36, maps.steel),
    bright: pbr('machined-edge', '#c2c8c7', 0.97, 0.25, maps.steel),
    black: pbr('blackened-steel', '#1c2022', 0.82, 0.44, maps.steel),
    purple: pbr('anodized-purple', '#64205e', 0.7, 0.34, maps.steel),
    rubber: pbr('solid-rubber', botId === 'witchdoctor' ? '#62635a' : '#30312e', 0, 0.95, maps.steel),
    gold: pbr('zinc-fasteners', '#b9a46b', 0.95, 0.3),
    red: pbr('insulated-cable', '#7d2929', 0.1, 0.68),
  };
}
