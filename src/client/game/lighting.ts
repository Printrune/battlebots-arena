import { Engine } from '@babylonjs/core/Engines/engine';
import '@babylonjs/core/Engines/Extensions/engine.rawTexture';
import { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import '@babylonjs/core/Materials/Textures/baseTexture.polynomial';
import { CubeMapToSphericalPolynomialTools } from '@babylonjs/core/Misc/HighDynamicRange/cubemapToSphericalPolynomial';
import type { Scene } from '@babylonjs/core/scene';

/** Arena softboxes baked into a small, local reflection map. No remote HDR dependency. */
export function createArenaEnvironment(scene: Scene): RawCubeTexture {
  const size = 128;
  const faces = Array.from({ length: 6 }, (_, face) => {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const u = x / (size - 1);
        const v = y / (size - 1);
        const ceiling = face === 2;
        const floor = face === 3;
        const horizon = Math.exp(-Math.pow((v - 0.5) * 3.5, 2));
        let light = floor ? 0.075 : ceiling ? 0.28 : 0.085 + horizon * 0.055;
        const upperSoftbox = v > 0.12 && v < 0.29 && u > 0.12 && u < 0.88;
        const sideSoftbox = u > 0.73 && u < 0.82 && v > 0.32 && v < 0.86;
        const ceilingPanel = ceiling && (Math.abs(u - 0.3) < 0.12 || Math.abs(u - 0.72) < 0.1) && v > 0.17 && v < 0.83;
        if (!floor && (upperSoftbox || sideSoftbox || ceilingPanel)) light = 0.92;
        const offset = (y * size + x) * 4;
        data[offset] = Math.round(light * 255);
        data[offset + 1] = Math.round(light * (ceiling ? 0.97 : 0.99) * 255);
        data[offset + 2] = Math.round(light * (ceiling ? 0.90 : 1) * 255);
        data[offset + 3] = 255;
      }
    }
    return data;
  });
  const texture = new RawCubeTexture(scene, faces, size, Engine.TEXTUREFORMAT_RGBA,
    Engine.TEXTURETYPE_UNSIGNED_BYTE, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = 'arena-softbox-reflections';
  texture.coordinatesMode = Texture.CUBIC_MODE;
  texture.gammaSpace = false;
  const [right, left, up, down, front, back] = faces;
  if (right && left && up && down && front && back) {
    texture.sphericalPolynomial = CubeMapToSphericalPolynomialTools.ConvertCubeMapToSphericalPolynomial({
      size, right, left, up, down, front, back, format: Engine.TEXTUREFORMAT_RGBA,
      type: Engine.TEXTURETYPE_UNSIGNED_BYTE, gammaSpace: false,
    }, 32);
  }
  return texture;
}
