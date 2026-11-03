import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Scene } from '@babylonjs/core/scene';
import { ARENA_LAYOUT, KILLSAWS } from '../../../shared/arena';

export interface StageMaterials {
  floor: PBRMaterial; deck: PBRMaterial; steel: PBRMaterial; bright: PBRMaterial;
  black: PBRMaterial; yellow: PBRMaterial; red: PBRMaterial; blue: PBRMaterial;
  amberLight: StandardMaterial; whiteLight: StandardMaterial; redLight: StandardMaterial;
  glass: StandardMaterial; logo: StandardMaterial; textures: DynamicTexture[];
}

function canvasTexture(scene: Scene, name: string, width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): DynamicTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  draw(context);
  const result = new DynamicTexture(name, canvas, scene, true);
  result.anisotropicFilteringLevel = 4;
  result.update(false);
  return result;
}

function random(seed: number): () => number {
  let state = seed;
  return () => { state = state * 16807 % 2147483647; return state / 2147483647; };
}

export function makeStageMaterials(scene: Scene): StageMaterials {
  const floorMap = canvasTexture(scene, 'battlebox-floor-map', 1024, 1024, (ctx) => {
    const rand = random(53819); const size = 1024; const scale = size / 48;
    ctx.fillStyle = '#505658'; ctx.fillRect(0, 0, size, size);
    for (let n = 0; n < 10000; n += 1) {
      const x = rand() * size; const y = rand() * size;
      ctx.fillStyle = n % 2 ? 'rgba(18,23,24,.09)' : 'rgba(202,210,207,.07)';
      ctx.fillRect(x, y, 0.5 + rand() * 9, 0.5 + rand() * 1.1);
    }
    // Individual floor plates, weld seams and countersunk fixing marks.
    for (let n = 0; n <= 12; n += 1) {
      const p = n * size / 12;
      ctx.strokeStyle = '#282e31'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
      for (let m = 0; m <= 12; m += 1) {
        const q = m * size / 12;
        ctx.fillStyle = 'rgba(15,20,22,.65)'; ctx.beginPath(); ctx.arc(p + 4, q + 4, 1.3, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (let n = 0; n < 850; n += 1) {
      const x = rand() * size; const y = rand() * size;
      ctx.strokeStyle = n % 3 ? 'rgba(198,201,192,.11)' : 'rgba(12,16,18,.20)';
      ctx.lineWidth = 0.3 + rand() * 1.7; ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x + rand() * 80 - 40, y + rand() * 50 - 25); ctx.stroke();
    }
    for (const [z, color, label] of [[-ARENA_LAYOUT.spawnZ, '#9a282a', 'RED SQUARE'], [ARENA_LAYOUT.spawnZ, '#234e83', 'BLUE SQUARE']] satisfies [number, string, string][]) {
      const y = (z / 48 + 0.5) * size;
      ctx.fillStyle = color; ctx.fillRect(size / 2 - 3 * scale, y - 3 * scale, 6 * scale, 6 * scale);
      ctx.strokeStyle = '#b9b5a6'; ctx.lineWidth = 1.5; ctx.strokeRect(size / 2 - 3 * scale, y - 3 * scale, 6 * scale, 6 * scale);
      ctx.fillStyle = 'rgba(239,234,214,.65)'; ctx.font = 'bold 11px Arial'; ctx.textAlign = 'center';
      ctx.fillText(label, size / 2, y + 5);
    }
    ctx.fillStyle = 'rgba(239,239,224,.75)'; ctx.textAlign = 'center';
    ctx.font = '900 75px Arial Black, Arial'; ctx.fillText('BATTLEBOTS', 512, 510);
    ctx.font = 'bold 15px Arial'; ctx.fillText('ROBOT FIGHTING TIME', 512, 537);
    for (const saw of KILLSAWS) {
      ctx.save(); ctx.translate((saw.position.x / 48 + 0.5) * size, (saw.position.z / 48 + 0.5) * size); ctx.rotate(-saw.yaw);
      ctx.strokeStyle = '#c4a332'; ctx.lineWidth = 2.3;
      ctx.strokeRect(-0.9 * scale, -1.3 * scale, 1.8 * scale, 2.6 * scale);
      ctx.fillStyle = '#121719';
      for (const side of [-1, 1]) ctx.fillRect(side * saw.bladeSpacing / 2 * scale - 1.7, -0.9 * scale, 3.4, 1.8 * scale);
      ctx.restore();
    }
    // Worn yellow safety stripe remains a paint mark, avoiding hundreds of draw calls.
    ctx.strokeStyle = '#b6a03b'; ctx.lineWidth = 3;
    ctx.strokeRect(14, 14, 996, 996);
  });
  // Ground-builder U runs opposite the north-side viewing direction. Flip U only:
  // red/blue Z coordinates and the symmetric paired saw markings stay unchanged.
  if (floorMap) { floorMap.uScale = -1; floorMap.uOffset = 1; }
  const brushedMap = canvasTexture(scene, 'battlebox-brushed-steel', 256, 256, (ctx) => {
    const rand = random(145); ctx.fillStyle = '#c9cdcc'; ctx.fillRect(0, 0, 256, 256);
    for (let n = 0; n < 420; n += 1) {
      const y = rand() * 256; ctx.strokeStyle = `rgba(43,51,52,${rand() * 0.19})`;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y + 0.7); ctx.stroke();
    }
  });
  const deckMap = canvasTexture(scene, 'upper-deck-metal', 512, 256, (ctx) => {
    const rand = random(91); ctx.fillStyle = '#757a7b'; ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#4b5254'; ctx.lineWidth = 2;
    for (let x = 0; x <= 512; x += 128) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 256); ctx.stroke(); }
    for (let y = 0; y <= 256; y += 128) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke(); }
    for (let n = 0; n < 250; n += 1) {
      const x = rand() * 512; const y = rand() * 256; ctx.strokeStyle = 'rgba(27,32,34,.18)';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rand() * 42 - 21, y + 12); ctx.stroke();
    }
  });
  const logoMap = canvasTexture(scene, 'battlebox-wall-signs', 1024, 128, (ctx) => {
    ctx.fillStyle = '#080c10'; ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = '#e8ece7'; ctx.font = '900 100px Arial Black, Arial'; ctx.textAlign = 'center';
    ctx.fillText('BATTLEBOTS', 512, 102);
  });
  function pbr(name: string, color: string, metallic: number, roughness: number, map: DynamicTexture | null = brushedMap): PBRMaterial {
    const mat = new PBRMaterial(`stage-${name}`, scene);
    mat.albedoColor = Color3.FromHexString(color); mat.metallic = metallic; mat.roughness = roughness;
    mat.environmentIntensity = 0.55;
    if (map) mat.albedoTexture = map;
    return mat;
  }
  function light(name: string, color: string): StandardMaterial {
    const mat = new StandardMaterial(`stage-${name}`, scene);
    mat.diffuseColor = Color3.FromHexString(color); mat.emissiveColor = mat.diffuseColor.clone();
    mat.disableLighting = true;
    return mat;
  }
  const glass = new StandardMaterial('stage-clear-polycarbonate', scene);
  glass.diffuseColor = new Color3(0.55, 0.7, 0.75); glass.specularColor = new Color3(0.7, 0.8, 0.85);
  glass.specularPower = 96; glass.alpha = 0.045; glass.backFaceCulling = false; glass.disableDepthWrite = true;
  const logo = new StandardMaterial('stage-wall-logo', scene);
  logo.diffuseColor = Color3.White(); logo.emissiveColor = new Color3(0.18, 0.18, 0.18);
  logo.specularColor = Color3.Black(); logo.backFaceCulling = false;
  if (logoMap) logo.diffuseTexture = logoMap;
  return {
    floor: pbr('worn-floor', '#ffffff', 0.56, 0.68, floorMap),
    deck: pbr('deck', '#ffffff', 0.7, 0.52, deckMap),
    steel: pbr('steel', '#687477', 0.9, 0.38), bright: pbr('machined-steel', '#adb7b8', 0.95, 0.28),
    black: pbr('black-frames', '#171d21', 0.65, 0.54), yellow: pbr('yellow-safety', '#c8a72d', 0.35, 0.58),
    red: pbr('red-hardware', '#9d292c', 0.4, 0.48), blue: pbr('blue-hardware', '#2e5795', 0.4, 0.48),
    amberLight: light('amber-warning', '#ffb640'), whiteLight: light('white-light', '#dbe3e5'), redLight: light('red-warning', '#e13c31'),
    glass, logo,
    textures: [floorMap, brushedMap, deckMap, logoMap].filter((item): item is DynamicTexture => item !== null),
  };
}
