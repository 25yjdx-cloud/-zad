import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

/* === Start Section: توليد أيقونات أُنْس === */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logoPath = path.join(root, 'src', 'assets', 'uns-logo.svg');
const iconsDir = path.join(root, 'public', 'assets', 'icons');
const publicDir = path.join(root, 'public');
await mkdir(iconsDir, { recursive: true });
const logo = sharp(logoPath);
await Promise.all([
  logo.clone().resize(192, 192, { fit: 'cover' }).png().toFile(path.join(publicDir, 'icon-192.png')),
  logo.clone().resize(512, 512, { fit: 'cover' }).png().toFile(path.join(publicDir, 'icon-512.png')),
  logo.clone().resize(180, 180, { fit: 'cover' }).png().toFile(path.join(publicDir, 'apple-touch-icon.png')),
  logo.clone().resize(192, 192, { fit: 'cover' }).png().toFile(path.join(iconsDir, 'icon-192x192.png')),
  logo.clone().resize(512, 512, { fit: 'cover' }).png().toFile(path.join(iconsDir, 'icon-512x512.png')),
]);
/* === End Section: توليد أيقونات أُنْس === */
