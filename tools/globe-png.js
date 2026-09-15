/* ==========================================================================
   tools/globe-png.js —— 把程序化地球仪渲染成 PNG，用来"真的看一眼"颜色对不对
   纯调试工具，不参与发布产物。
   用法：node tools/globe-png.js [输出路径] [角度]
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { loadGame } = require('../tests/helpers.js');

const game = loadGame();
const P = game.TC.Pixel;
const spec = P.GLOBE_SPEC;

const OUT = process.argv[2] || path.join(__dirname, 'globe-preview.png');
const THETA = process.argv[3] ? Number(process.argv[3]) : 0;

/* ---------- 1) 画到 RGBA 缓冲 ---------- */
const SIZE = spec.size;              // 32
const BLOCK = 4;                     // 每格 4px → 128px
const SCALE = 3;                     // 再放大 3 倍便于观察 → 384px
const W = SIZE * BLOCK;

function hex2rgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

const px = new Uint8Array(W * W * 4);              // 默认全透明
function set(cx, cy, rgb) {
  const o = (cy * W + cx) * 4;
  px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = 255;
}

for (let gy = 0; gy < SIZE; gy++) {
  for (let gx = 0; gx < SIZE; gx++) {
    const ch = P.globeBit(gx, gy, THETA, spec);
    if (ch === '.') continue;
    const col = P.PALETTE[ch];
    if (!col) continue;
    const rgb = hex2rgb(col);
    for (let y = 0; y < BLOCK; y++) {
      for (let x = 0; x < BLOCK; x++) set(gx * BLOCK + x, gy * BLOCK + y, rgb);
    }
  }
}
P.globePlaneCells(THETA, spec).forEach((c) => {
  const col = P.PALETTE[c.ch];
  if (!col) return;
  const rgb = hex2rgb(col);
  for (let y = 0; y < BLOCK; y++) {
    for (let x = 0; x < BLOCK; x++) set(c.x * BLOCK + x, c.y * BLOCK + y, rgb);
  }
});

/* 放到奶油底色上（和游戏里的卡片底一致），否则透明区看不出对比 */
const CREAM = hex2rgb('#FFFCF2');
for (let i = 0; i < W * W; i++) {
  if (px[i * 4 + 3] === 0) { px[i * 4] = CREAM[0]; px[i * 4 + 1] = CREAM[1]; px[i * 4 + 2] = CREAM[2]; px[i * 4 + 3] = 255; }
}

/* ---------- 2) 最近邻放大 ---------- */
const WS = W * SCALE;
const big = Buffer.alloc(WS * WS * 4);
for (let y = 0; y < WS; y++) {
  for (let x = 0; x < WS; x++) {
    const so = ((y / SCALE | 0) * W + (x / SCALE | 0)) * 4;
    const dof = (y * WS + x) * 4;
    big[dof] = px[so]; big[dof + 1] = px[so + 1];
    big[dof + 2] = px[so + 2]; big[dof + 3] = 255;
  }
}

/* ---------- 3) 手写 PNG（零依赖） ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WS, 0);
ihdr.writeUInt32BE(WS, 4);
ihdr[8] = 8;      // bit depth
ihdr[9] = 6;      // RGBA
const raw = Buffer.alloc((WS * 4 + 1) * WS);
for (let y = 0; y < WS; y++) {
  raw[y * (WS * 4 + 1)] = 0;                       // filter: none
  big.copy(raw, y * (WS * 4 + 1) + 1, y * WS * 4, (y + 1) * WS * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);
fs.writeFileSync(OUT, png);
console.log('已输出 ' + OUT + '  (' + WS + 'x' + WS + 'px, theta=' + THETA + ')');
