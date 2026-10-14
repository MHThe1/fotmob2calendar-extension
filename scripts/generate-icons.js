// scripts/generate-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function createPng(width, height, drawFn) {
  const rowSize = width * 4;
  const rawData = Buffer.alloc((rowSize + 1) * height);
  for (let y = 0; y < height; y++) {
    rawData[y * (rowSize + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const idx = y * (rowSize + 1) + 1 + x * 4;
      const [r, g, b, a] = drawFn(x, y, width, height);
      rawData[idx] = r;
      rawData[idx + 1] = g;
      rawData[idx + 2] = b;
      rawData[idx + 3] = a;
    }
  }
  const idatData = zlib.deflateSync(rawData);
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
    table[i] = c;
  }
  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
    }
    return (crc ^ (-1)) >>> 0;
  }
  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type);
    const typeAndData = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([len, typeAndData, crcBuf]);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([signature, makeChunk('IHDR', ihdr), makeChunk('IDAT', idatData), makeChunk('IEND', Buffer.alloc(0))]);
}

function drawIconPixel(x, y, w, h) {
  // Normalized coords [0, 1]
  const nx = x / w;
  const ny = y / h;
  const cx = 0.5;
  const cy = 0.5;

  // Rounded rectangle bounds
  const r = 0.22;
  const dx = Math.abs(nx - cx) - (0.5 - r);
  const dy = Math.abs(ny - cy) - (0.5 - r);
  const dist = Math.sqrt(Math.max(0, dx) ** 2 + Math.max(0, dy) ** 2);
  const isOutside = (dx > 0 && dy > 0 && dist > r);

  if (isOutside) return [0, 0, 0, 0];

  // Base gradient: Deep rich stadium green to emerald
  const grad = ny;
  let bgR = Math.round(10 + grad * 14);   // ~10 to 24
  let bgG = Math.round(135 + grad * 40);  // ~135 to 175
  let bgB = Math.round(75 + grad * 30);   // ~75 to 105

  // Calendar top header bar (top 32% of inner area)
  // Calendar card bounds
  const calLeft = 0.18, calRight = 0.82, calTop = 0.18, calBottom = 0.82;
  if (nx >= calLeft && nx <= calRight && ny >= calTop && ny <= calBottom) {
    if (ny < calTop + 0.22) {
      // Header: vibrant coral/red or Google Calendar blue/green accent
      return [37, 99, 235, 255]; // Royal Blue
    } else {
      // Calendar body: crisp white / light gray
      // Inside calendar, let's draw a soccer ball or calendar date grid
      const ballCx = 0.5, ballCy = 0.55;
      const bDist = Math.sqrt((nx - ballCx) ** 2 + (ny - ballCy) ** 2);
      if (bDist < 0.16) {
        // Football icon circle
        if (bDist < 0.06) {
          // Central pentagon black spot
          return [30, 41, 59, 255];
        } else if (bDist >= 0.13 && bDist <= 0.16) {
          // Ball outline
          return [51, 65, 85, 255];
        }
        return [255, 255, 255, 255]; // white ball
      }
      return [248, 250, 252, 255]; // clean white card
    }
  }

  // Border highlight
  return [bgR, bgG, bgB, 255];
}

const iconsDir = path.join(__dirname, '..', 'icons');
ensureDir(iconsDir);

[16, 32, 48, 128].forEach(size => {
  const buf = createPng(size, size, drawIconPixel);
  fs.writeFileSync(path.join(iconsDir, `icon${size}.png`), buf);
  console.log(`Generated icon${size}.png`);
});

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#059669" />
      <stop offset="100%" stop-color="#10B981" />
    </linearGradient>
    <linearGradient id="calHeader" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563EB" />
      <stop offset="100%" stop-color="#1D4ED8" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-opacity="0.25"/>
    </filter>
  </defs>
  <!-- Background Stadium Pill -->
  <rect width="128" height="128" rx="28" fill="url(#bgGrad)" />
  
  <!-- Calendar Body with Shadow -->
  <g filter="url(#shadow)">
    <!-- Calendar Body -->
    <rect x="22" y="24" width="84" height="82" rx="14" fill="#FFFFFF" />
    
    <!-- Calendar Header Bar -->
    <path d="M22 38 C22 30.268 28.268 24 36 24 L92 24 C99.732 24 106 30.268 106 38 L106 46 L22 46 Z" fill="url(#calHeader)" />
    
    <!-- Calendar Rings -->
    <circle cx="42" cy="22" r="3.5" fill="#E2E8F0" stroke="#0F172A" stroke-width="2"/>
    <circle cx="86" cy="22" r="3.5" fill="#E2E8F0" stroke="#0F172A" stroke-width="2"/>
    
    <!-- Football in Center -->
    <g transform="translate(64, 76)">
      <circle r="22" fill="#F8FAFC" stroke="#0F172A" stroke-width="2.5"/>
      <!-- Center polygon -->
      <polygon points="0,-7 6.6,-2.2 4.1,5.7 -4.1,5.7 -6.6,-2.2" fill="#0F172A"/>
      <!-- Seam lines -->
      <line x1="0" y1="-7" x2="0" y2="-18" stroke="#0F172A" stroke-width="2" stroke-linecap="round"/>
      <line x1="6.6" y1="-2.2" x2="16.5" y2="-7" stroke="#0F172A" stroke-width="2" stroke-linecap="round"/>
      <line x1="4.1" y1="5.7" x2="12" y2="15" stroke="#0F172A" stroke-width="2" stroke-linecap="round"/>
      <line x1="-4.1" y1="5.7" x2="-12" y2="15" stroke="#0F172A" stroke-width="2" stroke-linecap="round"/>
      <line x1="-6.6" y1="-2.2" x2="-16.5" y2="-7" stroke="#0F172A" stroke-width="2" stroke-linecap="round"/>
    </g>
  </g>
</svg>`;

fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svgContent);
console.log('Generated icon.svg');
