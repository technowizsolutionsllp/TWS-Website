import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const rootDir = process.cwd();
const publicDir = join(process.cwd(), 'public');
const productLogoDir = join(rootDir, 'docs', 'marketing-package', 'products');

function iconBackground({ size, fill, stroke }) {
  const radius = Math.round(size * 0.2);
  const inset = Math.max(2, Math.round(size * 0.018));

  return Buffer.from(`
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${radius}" fill="${fill}"/>
      <rect x="${inset}" y="${inset}" width="${size - inset * 2}" height="${size - inset * 2}" rx="${radius - inset}" fill="none" stroke="${stroke}" stroke-width="${Math.max(2, Math.round(size * 0.012))}"/>
    </svg>
  `);
}

async function renderIcon({ source, output, size, fill, stroke, logoScale = 0.72 }) {
  const logoSize = Math.round(size * logoScale);
  const logo = await sharp(readFileSync(join(publicDir, source)))
    .resize(logoSize, logoSize, { fit: 'contain' })
    .png()
    .toBuffer();

  await sharp(iconBackground({ size, fill, stroke }))
    .composite([
      {
        input: logo,
        left: Math.round((size - logoSize) / 2),
        top: Math.round((size - logoSize) / 2),
      },
    ])
    .png()
    .toFile(join(publicDir, output));
}

await renderIcon({
  source: 'technowiz-mark.svg',
  output: 'apple-touch-icon.png',
  size: 180,
  fill: '#F8FAFC',
  stroke: '#D9E1EA',
  logoScale: 0.74,
});

await renderIcon({
  source: 'technowiz-mark.svg',
  output: 'icon-192.png',
  size: 192,
  fill: '#F8FAFC',
  stroke: '#D9E1EA',
  logoScale: 0.74,
});

await renderIcon({
  source: 'technowiz-mark.svg',
  output: 'icon-512.png',
  size: 512,
  fill: '#F8FAFC',
  stroke: '#D9E1EA',
  logoScale: 0.74,
});

copyFileSync(
  join(productLogoDir, 'nodupe', 'logos', 'nodupe-n1c-light-bg.svg'),
  join(publicDir, 'nodupe-n1c-light-bg.svg'),
);

copyFileSync(
  join(productLogoDir, 'pdf-compressor', 'logos', 'pdf-compressor-p4e-light-bg.svg'),
  join(publicDir, 'pdf-compressor-p4e-light-bg.svg'),
);
