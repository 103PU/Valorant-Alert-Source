const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const rootDir = path.join(__dirname, '..');
const assetsDir = path.join(rootDir, 'assets');
const publicDir = path.join(rootDir, 'public');

if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

// 1. Generate 256x256 Valorant Brand Icon PNG
const size = 256;
const png = new PNG({ width: size, height: size });

function setPixel(x, y, r, g, b, a) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const idx = (size * y + x) << 2;
  png.data[idx] = r;
  png.data[idx + 1] = g;
  png.data[idx + 2] = b;
  png.data[idx + 3] = a;
}

const cx = size / 2;
const cy = size / 2;

// Draw Dark Background with rounded/chamfered corners
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    // Chamfered corner check
    const isInside = (x + y >= 30) && (size - 1 - x + y >= 30) && (x + size - 1 - y >= 30) && (size - 1 - x + size - 1 - y >= 30);
    if (isInside) {
      setPixel(x, y, 15, 25, 35, 255); // #0F1923
    } else {
      setPixel(x, y, 0, 0, 0, 0); // Transparent
    }
  }
}

// Draw Cyan Circle Outline
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (dist >= 85 && dist <= 92) {
      setPixel(x, y, 0, 245, 212, 180); // #00F5D4
    }
    if (dist >= 60 && dist <= 66) {
      setPixel(x, y, 255, 70, 85, 220); // #FF4655
    }
  }
}

// Draw Red Crosshair lines
for (let i = 25; i <= 60; i++) {
  for (let w = -3; w <= 3; w++) {
    setPixel(cx + w, cy - i, 255, 70, 85, 255);
    setPixel(cx + w, cy + i, 255, 70, 85, 255);
    setPixel(cx - i, cy + w, 255, 70, 85, 255);
    setPixel(cx + i, cy + w, 255, 70, 85, 255);
  }
}

// Draw Red Center Target & White Center
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (dist <= 25) {
      setPixel(x, y, 255, 70, 85, 255); // #FF4655
    }
    if (dist <= 10) {
      setPixel(x, y, 255, 255, 255, 255); // White
    }
  }
}

const pngBuffer = PNG.sync.write(png);

// Save PNG icons
fs.writeFileSync(path.join(assetsDir, 'icon.png'), pngBuffer);
fs.writeFileSync(path.join(publicDir, 'icon.png'), pngBuffer);

// 2. Build Windows .ICO binary wrapping the PNG buffer
// ICO Header: 6 bytes
const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0); // Reserved
icoHeader.writeUInt16LE(1, 2); // Type 1 = ICO
icoHeader.writeUInt16LE(1, 4); // Number of images = 1

// ICO Directory Entry: 16 bytes
const icoDir = Buffer.alloc(16);
icoDir.writeUInt8(0, 0); // Width 256 (0 means 256)
icoDir.writeUInt8(0, 1); // Height 256 (0 means 256)
icoDir.writeUInt8(0, 2); // Color palette
icoDir.writeUInt8(0, 3); // Reserved
icoDir.writeUInt16LE(1, 4); // Color planes
icoDir.writeUInt16LE(32, 6); // Bits per pixel
icoDir.writeUInt32LE(pngBuffer.length, 8); // Size of image data
icoDir.writeUInt32LE(22, 12); // Offset = 6 + 16 = 22

const icoBuffer = Buffer.concat([icoHeader, icoDir, pngBuffer]);

// Save .ico files
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), icoBuffer);
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuffer);

// 3. Save SVG Icon
const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="50" fill="#0F1923" stroke="#2B3844" stroke-width="4"/>
  <circle cx="128" cy="128" r="88" fill="none" stroke="#00F5D4" stroke-width="8" opacity="0.5"/>
  <circle cx="128" cy="128" r="62" fill="none" stroke="#FF4655" stroke-width="10"/>
  <line x1="128" y1="38" x2="128" y2="78" stroke="#FF4655" stroke-width="10" stroke-linecap="round"/>
  <line x1="128" y1="178" x2="128" y2="218" stroke="#FF4655" stroke-width="10" stroke-linecap="round"/>
  <line x1="38" y1="128" x2="78" y2="128" stroke="#FF4655" stroke-width="10" stroke-linecap="round"/>
  <line x1="178" y1="128" x2="218" y2="128" stroke="#FF4655" stroke-width="10" stroke-linecap="round"/>
  <circle cx="128" cy="128" r="24" fill="#FF4655"/>
  <circle cx="128" cy="128" r="10" fill="#FFFFFF"/>
</svg>`;

fs.writeFileSync(path.join(assetsDir, 'app-icon.svg'), logoSvg, 'utf8');
fs.writeFileSync(path.join(publicDir, 'icon.svg'), logoSvg, 'utf8');

console.log('✅ Successfully generated multi-format binary icons:');
console.log('   - assets/icon.ico (Windows Desktop Icon)');
console.log('   - public/favicon.ico (Browser Favicon)');
console.log('   - public/icon.png & public/icon.svg');
