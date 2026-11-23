// PNG-Kodierung ohne Abhängigkeiten und „Farbe zu Alpha“ für weiße Hintergründe.
import zlib from 'node:zlib';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// rgba: Buffer mit w*h*4 Bytes
export function encodePNG(rgba, w, h) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// PPM (P6, 8 Bit) einlesen
export function parsePPM(buf) {
  let pos = 0;
  const token = () => {
    while (pos < buf.length) {
      const c = buf[pos];
      if (c === 0x23) { while (pos < buf.length && buf[pos] !== 0x0a) pos++; } // Kommentar
      else if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) pos++;
      else break;
    }
    const s = pos; while (pos < buf.length && ![0x20, 0x0a, 0x0d, 0x09].includes(buf[pos])) pos++;
    return buf.toString('ascii', s, pos);
  };
  if (token() !== 'P6') throw new Error('Kein PPM-Bild');
  const w = +token(), h = +token(), max = +token();
  pos++; // genau ein Trennzeichen
  if (max !== 255) throw new Error('Nur 8-Bit-PPM wird unterstützt');
  return { w, h, rgb: buf.subarray(pos, pos + w * h * 3) };
}

// Weiß → transparent (Farbe-zu-Alpha wie in GIMP). Linienfarben bleiben erhalten.
export function whiteToAlpha(rgb, w, h, { floor = 0.06 } = {}) {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    const r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    let a = Math.max(255 - r, 255 - g, 255 - b) / 255;
    if (a < floor) { out[j + 3] = 0; continue; }
    a = Math.min(1, (a - floor) / (1 - floor) * 1.15); // etwas kräftiger, damit dünne Linien sichtbar bleiben
    const un = (c) => Math.max(0, Math.min(255, Math.round(255 - (255 - c) / Math.max(a, 0.01))));
    out[j] = un(r); out[j + 1] = un(g); out[j + 2] = un(b); out[j + 3] = Math.round(a * 255);
  }
  return out;
}
export function rgbToRGBA(rgb, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) { out[j] = rgb[i]; out[j + 1] = rgb[i + 1]; out[j + 2] = rgb[i + 2]; out[j + 3] = 255; }
  return out;
}
