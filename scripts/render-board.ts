/**
 * Render the board to a PNG for previewing designs: bun scripts/render-board.ts [fen] [out.png] [white|black] [scale]
 */
import { Chess } from "chess.js";
import { deflateSync } from "node:zlib";
import { PixelBuffer } from "../src/client/iso/pixels.ts";
import { renderScene, SCENE_H, SCENE_W } from "../src/client/iso/render.ts";
import { defaultTheme } from "../src/client/theme.ts";

const fen = process.argv[2] ?? new Chess().fen();
const out = process.argv[3] ?? "board.png";
const orientation = (process.argv[4] as "white" | "black") ?? "white";
const scale = Number(process.argv[5] ?? defaultTheme.scale);

const chess = new Chess(fen);
const buf = new PixelBuffer(SCENE_W, SCENE_H);
renderScene(buf, defaultTheme, { board: chess.board(), orientation, lastMove: { from: "e2", to: "e4" }, time: 1000 });

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const w = SCENE_W * scale;
const h = SCENE_H * scale;
const raw = new Uint8Array(h * (w * 4 + 1));
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const src = (Math.floor(y / scale) * SCENE_W + Math.floor(x / scale)) * 4;
    raw.set(buf.data.subarray(src, src + 4), y * (w * 4 + 1) + 1 + x * 4);
  }
}
const ihdr = new Uint8Array(13);
new DataView(ihdr.buffer).setUint32(0, w);
new DataView(ihdr.buffer).setUint32(4, h);
ihdr.set([8, 6, 0, 0, 0], 8);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", new Uint8Array()),
]);
await Bun.write(out, png);
console.log(`Wrote ${out} (${w}×${h})`);
