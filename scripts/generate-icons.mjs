// Generates placeholder PWA icons (PNG + SVG) without external dependencies.
// Usage: node scripts/generate-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");
mkdirSync(outDir, { recursive: true });

const BRAND = [79, 70, 229]; // #4f46e5
const FG = [255, 255, 255];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Microphone glyph in normalized [0,1] coordinates.
function inMic(x, y) {
  if (distToSegment(x, y, 0.5, 0.31, 0.5, 0.45) <= 0.1) return true; // capsule
  const r = Math.hypot(x - 0.5, y - 0.45);
  if (y >= 0.45 && Math.abs(r - 0.18) <= 0.022) return true; // arc
  if (Math.abs(x - 0.5) <= 0.022 && y >= 0.62 && y <= 0.73) return true; // stem
  if (distToSegment(x, y, 0.4, 0.735, 0.6, 0.735) <= 0.022) return true; // base
  return false;
}

function inRoundedRect(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function render(size, { maskable }) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 4; // supersampling per axis
  const glyphScale = maskable ? 0.78 : 1;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bgCov = 0;
      let fgCov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const inBg = maskable ? true : inRoundedRect(x, y, 0.22);
          if (!inBg) continue;
          bgCov++;
          const gx = 0.5 + (x - 0.5) / glyphScale;
          const gy = 0.5 + (y - 0.5) / glyphScale;
          if (inMic(gx, gy)) fgCov++;
        }
      }
      const total = SS * SS;
      const a = bgCov / total;
      const f = bgCov ? fgCov / bgCov : 0;
      const i = (py * size + px) * 4;
      buf[i] = Math.round(BRAND[0] * (1 - f) + FG[0] * f);
      buf[i + 1] = Math.round(BRAND[1] * (1 - f) + FG[1] * f);
      buf[i + 2] = Math.round(BRAND[2] * (1 - f) + FG[2] * f);
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, buf);
}

const targets = [
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
  ["apple-touch-icon.png", 180, true],
  ["favicon-32.png", 32, false],
];

for (const [name, size, maskable] of targets) {
  writeFileSync(join(outDir, name), render(size, { maskable }));
  console.log("wrote", name);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#4f46e5"/>
  <rect x="205" y="107.5" width="102" height="174" rx="51" fill="#fff"/>
  <path d="M164 230.5a92 92 0 0 0 184 0" fill="none" stroke="#fff" stroke-width="22.5" stroke-linecap="round"/>
  <path d="M256 322v52M205 376.5h102" fill="none" stroke="#fff" stroke-width="22.5" stroke-linecap="round"/>
</svg>
`;
writeFileSync(join(outDir, "icon.svg"), svg);
console.log("wrote icon.svg");
