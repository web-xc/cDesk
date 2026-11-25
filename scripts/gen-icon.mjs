/**
 * 生成应用图标 build/icon.png（1024×1024，纯 Node，无第三方依赖）。
 * 4× 超采样绘制 + 圆角遮罩 + 渐变，供 electron-builder 转 ico / icns。
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SIZE = 1024
const SS = 4
const N = SIZE * SS

const rgba = new Uint8Array(N * N * 4)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

function insideRoundRect(x, y, rx, ry, rw, rh, r) {
  if (x < rx || y < ry || x > rx + rw || y > ry + rh) return false
  const cx = Math.max(rx + r, Math.min(x, rx + rw - r))
  const cy = Math.max(ry + r, Math.min(y, ry + rh - r))
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function blend(i, r, g, b, a) {
  if (a <= 0) return
  const dstA = rgba[i + 3] / 255
  const outA = a + dstA * (1 - a)
  if (outA <= 0) return
  rgba[i] = Math.round((r * a + rgba[i] * dstA * (1 - a)) / outA)
  rgba[i + 1] = Math.round((g * a + rgba[i + 1] * dstA * (1 - a)) / outA)
  rgba[i + 2] = Math.round((b * a + rgba[i + 2] * dstA * (1 - a)) / outA)
  rgba[i + 3] = Math.round(outA * 255)
}

function paint(mask, color) {
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!mask(x + 0.5, y + 0.5)) continue
      const i = (y * N + x) * 4
      const [r, g, b, a] = color(x, y)
      blend(i, r, g, b, a)
    }
  }
}

// 1. 背景：圆角方块 + 对角渐变
const bgRadius = 224 * SS
paint(
  (x, y) => insideRoundRect(x, y, 0, 0, N, N, bgRadius),
  (x, y) => {
    const t = clamp01((x / N) * 0.45 + (y / N) * 0.55)
    const r = Math.round(72 + (124 - 72) * t)
    const g = Math.round(124 + (94 - 124) * t)
    const b = Math.round(255 + (245 - 255) * t)
    return [r, g, b, 1]
  }
)

// 2. 左上柔光
const glowX = N * 0.3
const glowY = N * 0.18
const glowR = N * 0.62
paint(
  (x, y) => {
    const d = Math.hypot(x - glowX, y - glowY) / glowR
    return d < 1
  },
  (x, y) => {
    const d = Math.hypot(x - glowX, y - glowY) / glowR
    return [255, 255, 255, 0.22 * Math.pow(1 - d, 2)]
  }
)

// 3. 显示器机身
const s = SS
paint(
  (x, y) => insideRoundRect(x, y, 212 * s, 250 * s, 600 * s, 400 * s, 54 * s),
  () => [248, 250, 255, 1]
)

// 4. 屏幕
paint(
  (x, y) => insideRoundRect(x, y, 250 * s, 288 * s, 524 * s, 324 * s, 28 * s),
  (x, y) => {
    const t = clamp01((y - 288 * s) / (324 * s))
    return [Math.round(9 + 10 * t), Math.round(18 + 18 * t), Math.round(38 + 30 * t), 1]
  }
)

// 5. 屏幕内界面线条
paint(
  (x, y) => insideRoundRect(x, y, 300 * s, 520 * s, 210 * s, 16 * s, 8 * s),
  () => [255, 255, 255, 0.3]
)
paint(
  (x, y) => insideRoundRect(x, y, 300 * s, 552 * s, 132 * s, 16 * s, 8 * s),
  () => [255, 255, 255, 0.16]
)

// 6. 屏幕内光标（多边形近似：按点集判定）
const cursor = [
  [556, 372],
  [556, 524],
  [590, 490],
  [612, 545],
  [636, 535],
  [614, 480],
  [658, 480]
].map(([px, py]) => [px * s, py * s])

function inPolygon(x, y, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
paint((x, y) => inPolygon(x, y, cursor), () => [255, 255, 255, 1])

// 7. 支架与底座
paint((x, y) => insideRoundRect(x, y, 470 * s, 650 * s, 84 * s, 80 * s, 12 * s), () => [248, 250, 255, 1])
paint((x, y) => insideRoundRect(x, y, 366 * s, 726 * s, 292 * s, 46 * s, 23 * s), () => [248, 250, 255, 1])

// 8. 屏幕右下角在线指示点
const dotX = 726 * s
const dotY = 566 * s
const dotR = 15 * s
paint((x, y) => Math.hypot(x - dotX, y - dotY) <= dotR, () => [52, 226, 160, 1])
paint(
  (x, y) => {
    const d = Math.hypot(x - dotX, y - dotY)
    return d > dotR && d <= dotR + 5 * s
  },
  () => [255, 255, 255, 0.85]
)

/* ------------------------------ 降采样 ------------------------------ */

const out = Buffer.alloc(SIZE * SIZE * 4)
const per = SS * SS
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let sr = 0
    let sg = 0
    let sb = 0
    let sa = 0
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * N + (x * SS + dx)) * 4
        const a = rgba[i + 3]
        sr += rgba[i] * a
        sg += rgba[i + 1] * a
        sb += rgba[i + 2] * a
        sa += a
      }
    }
    const o = (y * SIZE + x) * 4
    if (sa > 0) {
      out[o] = Math.round(sr / sa)
      out[o + 1] = Math.round(sg / sa)
      out[o + 2] = Math.round(sb / sa)
      out[o + 3] = Math.round(sa / per)
    }
  }
}

/* ------------------------------ PNG 编码 ------------------------------ */

const table = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  table[n] = c >>> 0
}
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 6

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  out.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

mkdirSync(resolve(ROOT, 'build'), { recursive: true })
writeFileSync(resolve(ROOT, 'build/icon.png'), png)
console.log('icon written:', resolve(ROOT, 'build/icon.png'), png.length, 'bytes')
