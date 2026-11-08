/**
 * Pure-Node 256x256 RGBA PNG Badge Generator + ATProto Raw Multihash CIDv1 Builder.
 * Produces spec-compliant `image/png` blobs (accept: ["image/png", "image/jpeg", "image/webp"])
 * with zero native C++ image dependencies.
 */

import { deflateSync } from 'node:zlib';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';

const RAW_CODEC = 0x55;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, crcInput, crcBuf]);
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * Math.max(0, Math.min(1, t)));
}

function insideMotif(motif, nx, ny) {
  // Normalized coordinates centered at (0, 0) within [-1, 1]
  switch (motif) {
    case 'grass': {
      // Iconic three curved grass blades matching Touch Grass badge
      if (ny < -0.45 || ny > 0.48) return false;
      const t = (0.48 - ny) / 0.93;
      const blade1 = -0.34 + 0.16 * t * t;
      const blade2 = -0.02 + 0.22 * t * t;
      const blade3 = 0.24 + 0.18 * t * t;
      return (
        (t < 0.78 && Math.abs(nx - blade1) < 0.055) ||
        (t < 0.95 && Math.abs(nx - blade2) < 0.058) ||
        (t < 0.72 && Math.abs(nx - blade3) < 0.055)
      );
    }
    case 'heart': {
      const x = nx * 1.65;
      const y = -ny * 1.65 + 0.12;
      const eq = Math.pow(x * x + y * y - 0.36, 3) - x * x * y * y * y;
      return eq <= 0;
    }
    case 'star': {
      const r = Math.hypot(nx, ny);
      const a = Math.atan2(ny, nx) + Math.PI / 2;
      const starR = 0.34 + 0.18 * Math.cos(5 * a);
      return r <= starR;
    }
    case 'bolt': {
      return (
        (ny >= -0.52 && ny <= 0.05 && nx >= -0.25 - ny * 0.45 && nx <= 0.14 - ny * 0.35) ||
        (ny >= -0.06 && ny <= 0.52 && nx >= -0.14 - ny * 0.35 && nx <= 0.25 - ny * 0.45)
      );
    }
    case 'crown': {
      if (ny > 0.24 && ny < 0.38 && Math.abs(nx) < 0.46) return true;
      if (ny >= -0.28 && ny <= 0.24 && Math.abs(nx) < 0.46) {
        const wave = -0.04 - 0.24 * Math.abs(Math.cos(nx * Math.PI * 2.15));
        return ny >= wave;
      }
      return false;
    }
    case 'desktop': {
      const frame = Math.abs(nx) < 0.48 && ny > -0.38 && ny < 0.18;
      const screen = Math.abs(nx) < 0.39 && ny > -0.29 && ny < 0.09;
      const bar = Math.abs(nx) < 0.38 && ny > 0.28 && ny < 0.4;
      return (frame && !screen) || bar;
    }
    case 'mobile': {
      const body = Math.abs(nx) < 0.5 && Math.abs(ny) < 0.31;
      const inner = Math.abs(nx + 0.03) < 0.37 && Math.abs(ny) < 0.22;
      return body && !inner;
    }
    case 'scale': {
      const pillar = Math.abs(nx) < 0.045 && ny > -0.36 && ny < 0.42;
      const base = Math.abs(nx) < 0.28 && ny >= 0.36 && ny < 0.45;
      const beam = Math.abs(ny - (-0.18 - nx * 0.22)) < 0.04 && Math.abs(nx) < 0.46;
      const leftPan = Math.hypot(nx + 0.34, ny - 0.08) < 0.15;
      const rightPan = Math.hypot(nx - 0.34, ny + 0.06) < 0.13;
      return pillar || base || beam || leftPan || rightPan;
    }
    case 'wings':
    case 'butterfly':
    default: {
      const body = Math.abs(nx) < 0.04 && Math.abs(ny) < 0.34;
      const upper =
        Math.hypot((Math.abs(nx) - 0.25) * 1.15, (ny + 0.12) * 1.35) < 0.28;
      const lower =
        Math.hypot((Math.abs(nx) - 0.18) * 1.35, (ny - 0.18) * 1.45) < 0.21;
      return body || upper || lower;
    }
  }
}

export async function generatePngIconBlob(palette = {}, size = 256) {
  const bg1 = palette.bg1 || [12, 74, 110];
  const bg2 = palette.bg2 || [2, 132, 199];
  const accent = palette.accent || [255, 255, 255];
  const motif = palette.motif || 'butterfly';

  const stride = 1 + size * 4;
  const raw = Buffer.alloc(stride * size);
  const cornerR = size * 0.2;
  const half = size / 2;

  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // Filter type 0 (None)

    for (let x = 0; x < size; x++) {
      const pxOffset = rowStart + 1 + x * 4;

      // Rounded-square alpha mask
      const qx = Math.max(0, Math.abs(x + 0.5 - half) - (half - cornerR));
      const qy = Math.max(0, Math.abs(y + 0.5 - half) - (half - cornerR));
      const distCorner = Math.hypot(qx, qy);
      if (distCorner > cornerR) {
        raw[pxOffset] = 0;
        raw[pxOffset + 1] = 0;
        raw[pxOffset + 2] = 0;
        raw[pxOffset + 3] = 0;
        continue;
      }

      const gradT = (x + y) / (2 * size);
      let r = mix(bg1[0], bg2[0], gradT);
      let g = mix(bg1[1], bg2[1], gradT);
      let b = mix(bg1[2], bg2[2], gradT);

      const nx = (x + 0.5 - half) / half;
      const ny = (y + 0.5 - half) / half;
      const rad = Math.hypot(nx, ny);

      // Medallion ring
      if (rad >= 0.68 && rad <= 0.75) {
        r = accent[0];
        g = accent[1];
        b = accent[2];
      } else if (rad < 0.68) {
        r = mix(r, bg2[0], 0.35);
        g = mix(g, bg2[1], 0.35);
        b = mix(b, bg2[2], 0.35);
      }

      if (rad < 0.64 && insideMotif(motif, nx / 0.68, ny / 0.68)) {
        r = accent[0];
        g = accent[1];
        b = accent[2];
      }

      raw[pxOffset] = r;
      raw[pxOffset + 1] = g;
      raw[pxOffset + 2] = b;
      raw[pxOffset + 3] = 255;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = deflateSync(raw, { level: 6 });
  const pngBytes = Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);

  const digest = await sha256.digest(pngBytes);
  const cid = CID.createV1(RAW_CODEC, digest).toString();

  return {
    bytes: pngBytes,
    cid,
    size: pngBytes.length,
    mimeType: 'image/png',
    blobRef: {
      $type: 'blob',
      ref: { $link: cid },
      mimeType: 'image/png',
      size: pngBytes.length
    }
  };
}
