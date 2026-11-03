import type { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
const witchDoctorPhoto = new URL('../../../../assets/reference/witch-doctor-wcvii/studio-front-three-quarter.jpg', import.meta.url).href;
const tombstonePhoto = new URL('../../../../assets/reference/tombstone-2021/studio-front-three-quarter.jpg', import.meta.url).href;

type PixelPoint = readonly [number, number];
type Quad = readonly [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
type Bot = 'witchdoctor' | 'tombstone';
const projectedPatches = new Map<Bot, Promise<HTMLCanvasElement | null>>();

/** Map a photographed planar decal into a rectangular UV patch with a homography. */
function rectify(image: HTMLImageElement, quad: Quad, width: number, height: number): HTMLCanvasElement | null {
  const source = document.createElement('canvas');
  source.width = image.naturalWidth; source.height = image.naturalHeight;
  const sourceContext = source.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) return null;
  sourceContext.drawImage(image, 0, 0);
  const pixels = sourceContext.getImageData(0, 0, source.width, source.height);
  const result = document.createElement('canvas'); result.width = width; result.height = height;
  const context = result.getContext('2d');
  if (!context) return null;
  const output = context.createImageData(width, height);
  const [p0, p1, p2, p3] = quad.map((p) => [p[0] * source.width, p[1] * source.height]);
  if (!p0 || !p1 || !p2 || !p3) return null;
  const [x0 = 0, y0 = 0] = p0; const [x1 = 0, y1 = 0] = p1;
  const [x2 = 0, y2 = 0] = p2; const [x3 = 0, y3 = 0] = p3;
  const dx1 = x1 - x2; const dx2 = x3 - x2; const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2; const dy2 = y3 - y2; const dy3 = y0 - y1 + y2 - y3;
  const divisor = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(divisor) < 0.000001 ? 0 : (dx3 * dy2 - dx2 * dy3) / divisor;
  const h = Math.abs(divisor) < 0.000001 ? 0 : (dx1 * dy3 - dx3 * dy1) / divisor;
  const a = x1 - x0 + g * x1; const b = x3 - x0 + h * x3;
  const d = y1 - y0 + g * y1; const e = y3 - y0 + h * y3;
  for (let y = 0; y < height; y += 1) {
    const v = y / Math.max(1, height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = x / Math.max(1, width - 1); const denominator = g * u + h * v + 1;
      const sx = Math.max(0, Math.min(source.width - 2, (a * u + b * v + x0) / denominator));
      const sy = Math.max(0, Math.min(source.height - 2, (d * u + e * v + y0) / denominator));
      const ix = Math.floor(sx); const iy = Math.floor(sy); const fx = sx - ix; const fy = sy - iy;
      const dst = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const tl = pixels.data[(iy * source.width + ix) * 4 + channel] ?? 0;
        const tr = pixels.data[(iy * source.width + ix + 1) * 4 + channel] ?? 0;
        const bl = pixels.data[((iy + 1) * source.width + ix) * 4 + channel] ?? 0;
        const br = pixels.data[((iy + 1) * source.width + ix + 1) * 4 + channel] ?? 0;
        output.data[dst + channel] = (tl * (1 - fx) + tr * fx) * (1 - fy) + (bl * (1 - fx) + br * fx) * fy;
      }
      output.data[dst + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);
  return result;
}

function projectedPatch(bot: Bot): Promise<HTMLCanvasElement | null> {
  const existing = projectedPatches.get(bot);
  if (existing) return existing;
  const pending = new Promise<HTMLCanvasElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => {
      const quad: Quad = bot === 'witchdoctor'
        ? [[0.214, 0.338], [0.474, 0.247], [0.532, 0.441], [0.340, 0.563]]
        // Pixel corners (209,113),(468,50),(625,160),(351,228) stay
        // inside the classic rear roof. The far white studio background is excluded.
        : [[209 / 1140, 113 / 760], [468 / 1140, 50 / 760], [625 / 1140, 160 / 760], [351 / 1140, 228 / 760]];
      resolve(rectify(image, quad, bot === 'witchdoctor' ? 512 : 1024, 1024));
    };
    image.onerror = () => resolve(null);
    image.src = bot === 'witchdoctor' ? witchDoctorPhoto : tombstonePhoto;
  });
  projectedPatches.set(bot, pending);
  return pending;
}

export function projectReferenceLivery(bot: Bot, target: DynamicTexture | null): void {
  if (!target || typeof document === 'undefined') return;
  void projectedPatch(bot).then((patch) => {
    if (!target.getInternalTexture()) return;
    if (!patch) return;
    const context = target.getContext();
    if (bot === 'witchdoctor') {
      context.drawImage(patch, 0, 0, 512, 1024);
      context.save(); context.translate(1024, 0); context.scale(-1, 1);
      context.drawImage(patch, 0, 0, 512, 1024); context.restore();
    } else context.drawImage(patch, 0, 0, 1024, 1024);
    target.update(false);
  });
}
