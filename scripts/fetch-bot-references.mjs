import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const references = [
  {
    bot: 'witch-doctor-wcvii',
    file: 'studio-front-three-quarter.jpg',
    imageUrl: 'https://battlebots.com/wp-content/uploads/2022/11/BB2022-witch-doctor-bot.jpg',
    pageUrl: 'https://battlebots.com/robot/witch-doctor-wcvii/',
    caption: 'Official World Championship VII studio robot portrait, photographed in 2022 for the 2023 broadcast season.',
    angle: 'Front three-quarter, elevated',
  },
  {
    bot: 'tombstone-2021',
    file: 'studio-front-three-quarter.jpg',
    imageUrl: 'https://battlebots.com/wp-content/uploads/2021/10/Tombstone-bot-2021.jpg',
    pageUrl: 'https://battlebots.com/robot/tombstone-2021/',
    caption: 'Official 2021 season classic Tombstone studio robot portrait.',
    angle: 'Front three-quarter, elevated',
  },
  {
    bot: 'witch-doctor-wcvii',
    file: 'pit-front-top-damaged.webp',
    imageUrl: 'https://images.squarespace-cdn.com/content/v1/5d365e89644809000105ce08/c2de8347-6efa-464c-b0e9-3620d62e4006/20221028_152001.jpg',
    pageUrl: 'https://hugebattlebots.com/team-huge-battlebots-blog/huge-vs-witch-doctor',
    caption: 'Witch Doctor after the WCVII quarterfinal against HUGE, showing battle damage. Team HUGE pit photograph, 2022 filming; published May 25, 2023.',
    angle: 'Front and top detail, damaged robot',
  },
  {
    bot: 'witch-doctor-wcvii',
    file: 'pit-weapon-detail-damaged.webp',
    imageUrl: 'https://images.squarespace-cdn.com/content/v1/5d365e89644809000105ce08/fc914277-1295-4969-9ff4-fd5f8c0efc4e/20221028_152006.jpg',
    pageUrl: 'https://hugebattlebots.com/team-huge-battlebots-blog/huge-vs-witch-doctor',
    caption: 'WCVII quarterfinal damage close-up of the weapon rails, hub, pulley, and bearings. Do not reproduce the damaged geometry as the intact model.',
    angle: 'Weapon assembly close-up',
  },
  {
    bot: 'witch-doctor-wcvii',
    file: 'pit-ribcage-chain-detail.webp',
    imageUrl: 'https://images.squarespace-cdn.com/content/v1/5d365e89644809000105ce08/ea362931-6235-4dcd-bcb8-ef2f879ee7d6/20221028_152042.jpg',
    pageUrl: 'https://hugebattlebots.com/team-huge-battlebots-blog/huge-vs-witch-doctor',
    caption: 'Detached WCVII ribcage self-righting plate, wheels, and broken self-righter chain after the HUGE fight.',
    angle: 'Side wheel and detached ribcage detail',
  },
  {
    bot: 'witch-doctor-wcvii',
    file: 'action-versus-jackpot.jpg',
    imageUrl: 'https://www.teamwitchdoctor.com/cdn/shop/files/BB2022-Ep716-WitchDoctor-vs-Jackpot-_JB07433-11-SPOILER-photographer-Jon-C-R-Bennett2.jpg?v=1770232431&width=3840',
    pageUrl: 'https://www.teamwitchdoctor.com/',
    caption: 'WCVII Witch Doctor versus Jackpot, published on Team Witch Doctor homepage. Photo filename credits Jon C. R. Bennett.',
    angle: 'Rear three-quarter, elevated arena action',
  },
  {
    bot: 'tombstone-2021',
    file: 'team-portrait-bot-front.jpg',
    imageUrl: 'https://battlebots.com/wp-content/uploads/2021/10/Tombstone-Team-2021.jpg',
    pageUrl: 'https://battlebots.com/robot/tombstone-2021/',
    caption: 'Official 2021 team portrait with the complete robot, retained for its different robot view and scale.',
    angle: 'Robot front view within team portrait',
  },
  {
    bot: 'tombstone-2021',
    file: 'action-versus-jackpot-2021.jpg',
    imageUrl: 'https://hardcorerobotics.com/img/portfolio/l-thumb-07.jpg',
    pageUrl: 'https://hardcorerobotics.com/',
    caption: 'Hardcore Robotics explicitly labels this Tombstone versus Jackpot in the 2021 season.',
    angle: 'Arena action, sparks and weapon contact',
  },
  {
    bot: 'tombstone-2021',
    file: 'classic-one-wheel-action.jpg',
    imageUrl: 'https://hardcorerobotics.com/img/portfolio/l-thumb-02.jpg',
    pageUrl: 'https://hardcorerobotics.com/',
    caption: 'Hardcore Robotics caption: Tombstone on one wheel, again. Exact season unspecified; supplemental recoil and ground-clearance reference only.',
    angle: 'Classic robot elevated on one wheel during action',
  },
];

function imageDimensions(bytes) {
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.toString('ascii', 12, 16) === 'VP8X') {
    return { format: 'webp', width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Expected JPEG reference file');
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error('Malformed JPEG marker');
    const marker = bytes[offset + 1];
    offset += 2;
    if (frameMarkers.has(marker)) return { format: 'jpeg', width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    const length = bytes.readUInt16BE(offset);
    if (length < 2) throw new Error('Malformed JPEG segment');
    offset += length;
  }
  throw new Error('No JPEG frame dimensions found');
}

const manifest = [];
for (const reference of references) {
  const destination = resolve(root, 'assets/reference', reference.bot, reference.file);
  await mkdir(dirname(destination), { recursive: true });
  let bytes;
  try {
    bytes = await readFile(destination);
    if (bytes.length < 1000) throw new Error('Incomplete local image');
  } catch {
    const response = await fetch(reference.imageUrl, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error(`${response.status} while downloading ${reference.imageUrl}`);
    if (!response.headers.get('content-type')?.startsWith('image/')) throw new Error(`Expected image: ${reference.imageUrl}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(destination, bytes);
  }
  manifest.push({ ...reference, path: `assets/reference/${reference.bot}/${reference.file}`, ...imageDimensions(bytes), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  console.log(`${reference.bot}/${reference.file}: ${bytes.length} bytes`);
}
await writeFile(resolve(root, 'assets/reference/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
