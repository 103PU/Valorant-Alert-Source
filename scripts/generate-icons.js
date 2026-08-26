const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const rootDir = path.join(__dirname, '..');
const assetsDir = path.join(rootDir, 'assets');
const publicDir = path.join(rootDir, 'public');

if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

// 1. Generate 256x256 High-Res PNG for PWA & Browser
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

// Draw Dark Background with chamfered corners
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
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
fs.writeFileSync(path.join(assetsDir, 'icon.png'), pngBuffer);
fs.writeFileSync(path.join(publicDir, 'icon.png'), pngBuffer);

// 2. Generate 100% Native Windows GDI+ 32x32 & 16x16 DIB-encoded .ICO binary
function createDibIco(w, h) {
  const icoSize = w;
  const icoPng = new PNG({ width: icoSize, height: icoSize });
  
  // Scale down rendering to 32x32
  const icx = icoSize / 2;
  const icy = icoSize / 2;
  for (let y = 0; y < icoSize; y++) {
    for (let x = 0; x < icoSize; x++) {
      const dist = Math.sqrt((x - icx) ** 2 + (y - icy) ** 2);
      const isInside = (x + y >= 3) && (icoSize - 1 - x + y >= 3) && (x + icoSize - 1 - y >= 3) && (icoSize - 1 - x + icoSize - 1 - y >= 3);
      if (isInside) {
        if (dist <= 4) {
          // White center
          setIcoPixel(icoPng, icoSize, x, y, 255, 255, 255, 255);
        } else if (dist <= 8) {
          // Red core
          setIcoPixel(icoPng, icoSize, x, y, 255, 70, 85, 255);
        } else if (dist >= 11 && dist <= 13) {
          // Cyan ring
          setIcoPixel(icoPng, icoSize, x, y, 0, 245, 212, 255);
        } else {
          // Dark BG
          setIcoPixel(icoPng, icoSize, x, y, 15, 25, 35, 255);
        }
      } else {
        setIcoPixel(icoPng, icoSize, x, y, 0, 0, 0, 0);
      }
    }
  }

  // Build raw DIB Bitmap
  const headerSize = 40;
  const xorSize = icoSize * icoSize * 4;
  const andRowBytes = Math.ceil(icoSize / 32) * 4;
  const andSize = andRowBytes * icoSize;
  const imageSize = headerSize + xorSize + andSize;

  const dib = Buffer.alloc(imageSize);
  // BITMAPINFOHEADER
  dib.writeUInt32LE(headerSize, 0);
  dib.writeInt32LE(icoSize, 4);
  dib.writeInt32LE(icoSize * 2, 8); // Double height for XOR + AND
  dib.writeUInt16LE(1, 12); // Planes
  dib.writeUInt16LE(32, 14); // BitCount
  dib.writeUInt32LE(0, 16); // BI_RGB
  dib.writeUInt32LE(xorSize + andSize, 20);

  // Bottom-up BGRA pixel data
  let offset = 40;
  for (let y = icoSize - 1; y >= 0; y--) {
    for (let x = 0; x < icoSize; x++) {
      const idx = (icoSize * y + x) << 2;
      const r = icoPng.data[idx];
      const g = icoPng.data[idx + 1];
      const b = icoPng.data[idx + 2];
      const a = icoPng.data[idx + 3];
      dib.writeUInt8(b, offset);
      dib.writeUInt8(g, offset + 1);
      dib.writeUInt8(r, offset + 2);
      dib.writeUInt8(a, offset + 3);
      offset += 4;
    }
  }

  return { dib, imageSize, w: icoSize, h: icoSize };
}

function setIcoPixel(p, s, x, y, r, g, b, a) {
  const idx = (s * y + x) << 2;
  p.data[idx] = r;
  p.data[idx + 1] = g;
  p.data[idx + 2] = b;
  p.data[idx + 3] = a;
}

const ico32 = createDibIco(32, 32);
const ico16 = createDibIco(16, 16);

// Build multi-image ICO binary (16x16 and 32x32)
const icoFileHeader = Buffer.alloc(6);
icoFileHeader.writeUInt16LE(0, 0); // Reserved
icoFileHeader.writeUInt16LE(1, 2); // Type 1 = ICO
icoFileHeader.writeUInt16LE(2, 4); // 2 images

const dir32 = Buffer.alloc(16);
dir32.writeUInt8(32, 0);
dir32.writeUInt8(32, 1);
dir32.writeUInt8(0, 2);
dir32.writeUInt8(0, 3);
dir32.writeUInt16LE(1, 4);
dir32.writeUInt16LE(32, 6);
dir32.writeUInt32LE(ico32.imageSize, 8);
dir32.writeUInt32LE(6 + 16 + 16, 12); // Offset = 38

const dir16 = Buffer.alloc(16);
dir16.writeUInt8(16, 0);
dir16.writeUInt8(16, 1);
dir16.writeUInt8(0, 2);
dir16.writeUInt8(0, 3);
dir16.writeUInt16LE(1, 4);
dir16.writeUInt16LE(32, 6);
dir16.writeUInt32LE(ico16.imageSize, 8);
dir16.writeUInt32LE(38 + ico32.imageSize, 12);

const finalIcoBuffer = Buffer.concat([
  icoFileHeader,
  dir32,
  dir16,
  ico32.dib,
  ico16.dib
]);

fs.writeFileSync(path.join(assetsDir, 'icon.ico'), finalIcoBuffer);
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), finalIcoBuffer);

console.log('✅ Generated 100% native GDI+ compliant multi-resolution Windows Icon (icon.ico)');
