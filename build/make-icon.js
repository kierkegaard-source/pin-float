// Draws the tray icon design and writes build/icon.ico (for the shortcut) and build/icon.png: node build/make-icon.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function draw(size) {
  const k = size / 32;
  const px = Buffer.alloc(size * size * 4); // RGBA
  const inRound = (x, y, x0, y0, x1, y1, r) => {
    [x0, y0, x1, y1, r] = [x0 * k, y0 * k, x1 * k, y1 * k, r * k];
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 4x4 supersampling for smooth edges
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const X = x + (sx + 0.5) / 4, Y = y + (sy + 0.5) / 4;
        let c = null;
        if (inRound(X, Y, 1, 1, 31, 31, 7)) c = [0x7c, 0x5c, 0xf2];
        if (inRound(X, Y, 8, 10, 24, 23, 2) && !inRound(X, Y, 10.5, 12.5, 21.5, 20.5, 1)) c = [255, 255, 255];
        if (inRound(X, Y, 13, 5, 19, 10, 1.5)) c = [255, 255, 255];
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      }
      const i = (y * size + x) * 4;
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; px[i + 3] = (a / 16) * 255; }
    }
  }
  return png(size, px);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const byte of buf) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map(draw);
const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
fs.writeFileSync(path.join(__dirname, 'icon.ico'), Buffer.concat([header, ...dir, ...pngs]));
fs.writeFileSync(path.join(__dirname, 'icon.png'), pngs[pngs.length - 1]);
console.log('build/icon.ico');
