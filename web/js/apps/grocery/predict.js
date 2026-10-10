// Predicting what's being typed in the grocery search. Pure, so node can test it.
//
// Every typed word has to start a word of the name, so "oat mi" finds "Oat milk"
// and "chick" finds "Mandarin Orange Chicken". Things the household has bought
// before come first, most bought first; then everyday groceries and well-known
// things from the two stores. The board adds online products a moment later.
import { COMMON } from '../../groceries.js';

// Names people look for at Trader Joe's and Lidl, so they're predicted before the
// first one is ever added.
const STORE_FAVORITES = [
  // Trader Joe's
  'Everything but the Bagel Seasoning', 'Mandarin Orange Chicken', 'Cauliflower Gnocchi',
  'Dark Chocolate Peanut Butter Cups', 'Speculoos Cookie Butter', 'Unexpected Cheddar',
  'Chili Lime Rolled Corn Tortilla Chips', 'Chicken Tikka Masala', 'Butter Chicken', 'Chicken Gyoza Potstickers',
  'Pork & Ginger Soup Dumplings', 'Kimbap', 'Garlic Naan', 'Mini Chicken Tacos', 'Elote Chips', 'Joe-Joe’s Cookies',
  'Peanut Butter Filled Pretzels', 'Chili Onion Crunch', 'Green Goddess Dressing', 'Zhoug Sauce', 'Bomba Sauce',
  'Organic Tomato Basil Marinara', 'Marinara Sauce', 'Pizza Dough', 'Mochi Ice Cream', 'Hash Browns',
  'Riced Cauliflower Stir Fry', 'Cold Brew Coffee Concentrate', 'Plantain Chips', 'Fig Butter', 'Brioche Bread',
  'Chocolate Croissants', 'Mac & Cheese', 'Turkey Meatballs', 'Shawarma Chicken Thighs', 'Ricotta Ravioli',
  'Sparkling Water', 'Hold the Cone Mini Ice Cream Cones',
  // Lidl
  'Butter Croissants', 'Pretzel Rolls', 'Pretzel Baguette', 'Pain au Chocolat', 'Cheese Danish', 'Apple Strudel',
  'Brioche Buns', 'Multigrain Bread', 'Stroopwafels', 'Stone Baked Pizza', 'Greek Yogurt', 'Rotisserie Chicken',
  'European Chocolate', 'Milk Chocolate Hazelnut Spread', 'Sliced Cheese', 'Smoked Salmon', 'Gnocchi', 'Pesto',
];

export const VOCABULARY = [...new Set([...COMMON, ...STORE_FAVORITES])];

export function fold(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

const WORD = /[\p{L}\p{N}]+/gu;
const wordsOf = (text) => fold(text).match(WORD) ?? [];

// How well `name` fits what's typed, lower being better; null if it doesn't fit.
export function matchScore(name, typed) {
  const want = wordsOf(typed);
  if (!want.length) return null;
  const words = wordsOf(name);
  let score = 0;
  for (const typedWord of want) {
    const at = words.findIndex((word) => word.startsWith(typedWord));
    if (at < 0) return null;
    score += at;
  }
  // A name that starts with exactly what was typed is the likeliest.
  if (fold(name).startsWith(fold(typed).trim())) score -= 10;
  return score + words.length / 10;
}

// [{ kind: 'known', name, product }] for things bought before, then [{ kind: 'word', name }].
export function predict(typed, { catalog = [], vocabulary = VOCABULARY, limit = 6 } = {}) {
  const rank = (list, nameOf, extra = () => 0) =>
    list
      .map((entry) => ({ entry, score: matchScore(nameOf(entry), typed) }))
      .filter((m) => m.score !== null)
      .sort((a, b) => a.score - b.score || extra(a.entry, b.entry) || nameOf(a.entry).length - nameOf(b.entry).length)
      .map((m) => m.entry);
  const known = rank(catalog, (p) => p.name, (a, b) => (b.count ?? 0) - (a.count ?? 0));
  const seen = new Set(known.map((p) => fold(p.name)));
  const words = rank(vocabulary.filter((n) => !seen.has(fold(n))), (n) => n);
  return [
    ...known.map((product) => ({ kind: 'known', name: product.name, product })),
    ...words.map((name) => ({ kind: 'word', name })),
  ].slice(0, limit);
}

// `name` split into [{ text, match }] parts, the typed beginnings of words marked.
export function highlight(name, typed) {
  const want = wordsOf(typed);
  const parts = [];
  let at = 0;
  for (const found of String(name).matchAll(WORD)) {
    const word = found[0];
    const folded = fold(word);
    const typedWord = want.filter((w) => folded.startsWith(w)).sort((a, b) => b.length - a.length)[0];
    if (!typedWord) continue;
    const start = found.index;
    const end = start + Math.min(word.length, typedWord.length);
    if (start > at) parts.push({ text: name.slice(at, start), match: false });
    parts.push({ text: name.slice(start, end), match: true });
    at = end;
  }
  if (at < name.length) parts.push({ text: name.slice(at), match: false });
  return parts;
}
