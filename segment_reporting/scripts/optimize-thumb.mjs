/**
 * Optimize thumb.png using sharp for lossless compression.
 * Run once and commit the result: npm run build:thumb
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const thumbPath = path.join(__dirname, '..', 'thumb.png');

const originalSize = fs.statSync(thumbPath).size;

const optimized = await sharp(thumbPath)
    .png({ compressionLevel: 9, palette: true, quality: 80 })
    .toBuffer();

fs.writeFileSync(thumbPath, optimized);

const newSize = optimized.length;
console.log('thumb.png: ' + (originalSize / 1024).toFixed(1) + ' KB -> ' + (newSize / 1024).toFixed(1) + ' KB');
