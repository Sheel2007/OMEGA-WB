// What a scanned code means for the grocery list. Pure, so node can test it.
//
// Product barcodes (EAN-13, UPC-A, EAN-8, UPC-E) name a product by its GTIN.
// Newer packaging carries a QR code instead: a GS1 Digital Link, which is a web
// address with the GTIN in it (https://id.gs1.org/01/04056489011293), or a GS1
// element string ("01" then 14 digits). Trader Joe's product pages have the
// product's name in the address. Anything else becomes something to search for.

export const STORES = ['traderjoes', 'lidl'];

export function checkDigit(body) {
  let total = 0;
  for (let i = 0; i < body.length; i++) {
    total += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  }
  return String((10 - (total % 10)) % 10);
}

// Matches board/grocery.py: EAN-8 as is, everything else as 13 digits. Null if invalid.
export function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  let code = raw.trim();
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return null;
  if (checkDigit(code.slice(0, -1)) !== code.at(-1)) return null;
  if (code.length === 12) code = `0${code}`;
  else if (code.length === 14) {
    if (code[0] !== '0') return null;
    code = code.slice(1);
  }
  if (code.length === 13 && code.startsWith('00000')) code = code.slice(5);
  return code;
}

// UPC-E (number system, six digits, check digit) written out as the UPC-A it stands for.
export function expandUpcE(upce) {
  if (!/^[01]\d{7}$/.test(upce)) return null;
  const [ns, d1, d2, d3, d4, d5, d6, check] = upce;
  let body;
  if (d6 <= '2') body = `${ns}${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === '3') body = `${ns}${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === '4') body = `${ns}${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${ns}${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return checkDigit(body) === check ? body + check : null;
}

function titleFromSlug(slug) {
  const words = slug.split('-').filter((w) => w && !/^\d+$/.test(w));
  if (!words.length) return null;
  const text = words.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// { code } for a product barcode, { name, store } for a store's product page,
// { query } for words worth searching, or { unknown } for anything else.
// `format` is what the scanner says it read (BarcodeDetector's names).
export function readScan(text, format = null) {
  const raw = String(text ?? '').trim();
  if (!raw) return { unknown: raw };

  if (/^\d+$/.test(raw)) {
    const code = format === 'upc_e' ? normalizeCode(expandUpcE(raw) ?? '') : normalizeCode(raw);
    return code ? { code } : { unknown: raw };
  }

  // A GS1 element string, maybe after a symbology identifier (]Q3, ]d2, ]C1) or a GS.
  const element = /^(?:\][A-Za-z]\d)?\x1d?01(\d{14})/.exec(raw);
  if (element) {
    const code = normalizeCode(element[1]);
    if (code) return { code };
  }

  let url = null;
  try {
    url = /^https?:\/\//i.test(raw) ? new URL(raw) : null;
  } catch {
    url = null;
  }
  if (url) {
    const gtin = /\/01\/(\d{8,14})(?:\/|$)/.exec(url.pathname);
    const code = gtin && normalizeCode(gtin[1].padStart(14, '0'));
    if (code) return { code };
    if (/(^|\.)traderjoes\.com$/i.test(url.hostname)) {
      const page = /\/pdp\/([a-z0-9-]+)/i.exec(url.pathname);
      const name = page && titleFromSlug(decodeURIComponent(page[1]));
      if (name) return { name, store: 'traderjoes' };
    }
    return { unknown: raw };
  }

  if (raw.length <= 60 && /[a-z]/i.test(raw) && !/[\x00-\x1f]/.test(raw)) return { query: raw };
  return { unknown: raw };
}
