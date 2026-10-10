// Grocery list wording and sums. Pure, so node can test it (and the phone's home
// screen can use it without loading the app).

export const STORE_LABELS = { traderjoes: 'Trader Joe’s', lidl: 'Lidl' };
export const STORE_ORDER = ['traderjoes', 'lidl', null];

const formats = new Map();

export function money(cents, currency = 'USD') {
  if (cents == null) return '';
  if (!formats.has(currency)) {
    formats.set(currency, new Intl.NumberFormat(undefined, { style: 'currency', currency }));
  }
  return formats.get(currency).format(cents / 100);
}

// What someone typed as a price, in cents: "3.49", "$3.49", "3,49" or "3". Blank is
// null (no price); anything else is NaN.
export function parsePrice(text) {
  const clean = String(text ?? '').replace(/[^\d.,]/g, '');
  if (!clean) return String(text ?? '').trim() ? NaN : null;
  const match = /^(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(clean);
  if (!match) return NaN;
  return Number(match[1]) * 100 + Number((match[2] ?? '0').padEnd(2, '0'));
}

// The price as a person would type it back in: 3.49, or blank for none.
export function priceInput(cents) {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

// Where an item's picture comes from: a photo someone took, else the product's own
// photo (fetched and kept by the Pi), else null for the illustration.
export function pictureUrl(product) {
  if (product.photo) return `/api/grocery/photo?name=${encodeURIComponent(product.photo)}`;
  if (product.code && product.image !== false) return `/api/grocery/image?code=${encodeURIComponent(product.code)}`;
  return null;
}

export const toGetOf = (items) => items.filter((item) => !item.done);
export const boughtOf = (items) => items.filter((item) => item.done);

export function countLabel(count) {
  if (count === 0) return 'Nothing to get';
  return count === 1 ? '1 item' : `${count} items`;
}

// Everything still to get: how many, what it comes to, and split by store and by who asked.
export function totals(items) {
  const toGet = toGetOf(items);
  const sum = { count: toGet.length, cents: 0, unpriced: 0, stores: [], people: [] };
  const stores = new Map();
  const people = new Map();
  for (const item of toGet) {
    const line = item.price == null ? null : item.price * item.qty;
    if (line == null) sum.unpriced++;
    else sum.cents += line;
    for (const [map, key] of [[stores, item.store ?? null], [people, item.by ?? null]]) {
      const entry = map.get(key) ?? { key, count: 0, cents: 0, unpriced: 0 };
      entry.count++;
      if (line == null) entry.unpriced++;
      else entry.cents += line;
      map.set(key, entry);
    }
  }
  sum.stores = STORE_ORDER.filter((key) => stores.has(key)).map((key) => stores.get(key));
  sum.people = [...people.values()].sort((a, b) => b.cents - a.cents || (a.key ?? '').localeCompare(b.key ?? ''));
  return sum;
}

// "6 items · $23.40", or "about $23.40" when some prices aren't known yet.
export function summaryLabel(items, currency) {
  const sum = totals(items);
  if (!sum.count) return countLabel(0);
  if (sum.cents === 0) return countLabel(sum.count);
  return `${countLabel(sum.count)} · ${sum.unpriced ? 'about ' : ''}${money(sum.cents, currency)}`;
}

// A line under an item's name: who asked, where from, how big.
export function detailLabel(item) {
  return [item.by, STORE_LABELS[item.store], item.size].filter(Boolean).join(' · ');
}

export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words.at(-1)[0]).toUpperCase();
}

// People to offer under "Who's asking?": the Roommate Cup's roommates, then anyone
// else who has asked for something, without repeats.
export function askers(roommates, people, limit = 8) {
  const seen = new Set();
  const names = [];
  for (const name of [...roommates, ...people]) {
    const key = String(name ?? '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(name.trim());
    if (names.length >= limit) break;
  }
  return names;
}
