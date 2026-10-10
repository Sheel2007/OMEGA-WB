// Reads a product code out of a picture: barcodes first (quick), then QR codes.
// Pure, so node can test it; the scanner hands it camera frames and photos.
import { decodeBarcode } from './ean.js';
import { decodeQR } from './qr.js';

export function toLuminance(rgba, width, height) {
  const lum = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }
  return lum;
}

const formatOf = (code) => (code.length === 8 ? 'ean_8' : 'ean_13');

// { text, format } for what's in `image` (an ImageData, or anything shaped like
// one), or null. `agree` is how many lines a barcode must read the same on.
export function decodeImage({ data, width, height }, { agree = 2 } = {}) {
  const lum = toLuminance(data, width, height);
  const code = decodeBarcode(lum, width, height, { agree });
  if (code) return { text: code, format: formatOf(code) };
  const text = decodeQR(lum, width, height);
  return text == null ? null : { text, format: 'qr_code' };
}
