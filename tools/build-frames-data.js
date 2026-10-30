/* ========================================
   FRAME STUDIO — Build js/frames-data.js
   Embeds every frame image as a base64 data
   URL so the editor can export while running
   from file:// (where relative <img> files
   would taint the canvas).

   Usage:
     node tools/build-frames-data.js
   ======================================== */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frames = {
  codemakers: 'assets/frames/codemakers.webp',
  'midnight-gold': 'assets/frames/midnight-gold.webp'
};

const mimeByExt = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

let out = `/* ========================================
   FRAME STUDIO — Embedded frame data (base64)
   Used ONLY on file:// to avoid canvas taint.
   On http(s) the normal image files are used.

   AUTO-GENERATED — do not edit by hand.
   Regenerate with: node tools/build-frames-data.js
   ======================================== */

window.FRAME_DATA = window.FRAME_DATA || {};
`;

for (const [id, rel] of Object.entries(frames)) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.error('Missing frame image:', file);
    process.exit(1);
  }
  const mime = mimeByExt[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const b64 = fs.readFileSync(file).toString('base64');
  out += `window.FRAME_DATA['${id}'] = 'data:${mime};base64,${b64}';\n`;
}

const target = path.join(root, 'js/frames-data.js');
fs.writeFileSync(target, out);
console.log('Wrote', path.relative(root, target), '-', fs.statSync(target).size, 'bytes');
