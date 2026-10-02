// Grocery vocabulary: emoji for item names, typing suggestions, and staples.

const GROUPS = [
  ['🍎', 'apple'],
  ['🍏', 'green apple', 'granny smith'],
  ['🍌', 'banana'],
  ['🍊', 'orange', 'clementine', 'mandarin', 'tangerine', 'cutie'],
  ['🍋', 'lemon', 'lime'],
  ['🍇', 'grape'],
  ['🍓', 'strawberry', 'raspberry', 'berry', 'jam', 'jelly'],
  ['🫐', 'blueberry', 'blackberry'],
  ['🍒', 'cherry'],
  ['🍑', 'peach', 'nectarine', 'apricot'],
  ['🍐', 'pear'],
  ['🍍', 'pineapple'],
  ['🥭', 'mango'],
  ['🍉', 'watermelon'],
  ['🍈', 'melon', 'cantaloupe', 'honeydew'],
  ['🥝', 'kiwi'],
  ['🥥', 'coconut'],
  ['🥑', 'avocado', 'guacamole'],
  ['🍅', 'tomato', 'tomatoes', 'passata'],
  ['🥔', 'potato', 'potatoes', 'chip', 'crisp'],
  ['🍠', 'sweet potato', 'yam'],
  ['🥕', 'carrot'],
  ['🌽', 'corn'],
  ['🥦', 'broccoli', 'cauliflower', 'brussels sprout'],
  ['🥬', 'lettuce', 'spinach', 'kale', 'cabbage', 'bok choy', 'arugula', 'greens', 'chard', 'romaine', 'celery'],
  ['🥒', 'cucumber', 'zucchini', 'pickle'],
  ['🫑', 'pepper', 'bell pepper', 'capsicum'],
  ['🌶️', 'chili', 'chilli', 'jalapeno', 'hot sauce', 'sriracha'],
  ['🧄', 'garlic'],
  ['🧅', 'onion', 'shallot', 'scallion', 'leek'],
  ['🫚', 'ginger'],
  ['🍄', 'mushroom'],
  ['🍆', 'eggplant', 'aubergine'],
  ['🫘', 'bean', 'chickpea', 'lentil', 'hummus'],
  ['🫛', 'pea', 'edamame', 'snap pea'],
  ['🫒', 'olive', 'olive oil', 'oil'],
  ['🌿', 'herb', 'basil', 'cilantro', 'coriander', 'parsley', 'mint', 'thyme', 'rosemary', 'dill'],
  ['🥗', 'salad'],
  ['🧆', 'falafel'],
  ['🥛', 'milk', 'cream', 'half and half', 'yogurt', 'yoghurt', 'kefir', 'creamer'],
  ['🥚', 'egg'],
  ['🧀', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'feta', 'brie', 'cream cheese', 'cottage cheese'],
  ['🧈', 'butter', 'margarine', 'tofu'],
  ['🍨', 'ice cream', 'gelato'],
  ['🍞', 'bread', 'loaf', 'toast', 'sourdough', 'bun', 'roll'],
  ['🥖', 'baguette'],
  ['🥯', 'bagel'],
  ['🥐', 'croissant'],
  ['🫓', 'tortilla', 'pita', 'naan', 'wrap', 'flatbread'],
  ['🥞', 'pancake', 'pancake mix'],
  ['🧇', 'waffle'],
  ['🧁', 'muffin', 'cupcake'],
  ['🍰', 'cake'],
  ['🍪', 'cookie', 'biscuit'],
  ['🍩', 'donut', 'doughnut'],
  ['🥧', 'pie'],
  ['🍗', 'chicken', 'turkey', 'drumstick', 'wing'],
  ['🥩', 'beef', 'steak', 'ground beef', 'mince', 'pork', 'lamb', 'meat'],
  ['🥓', 'bacon'],
  ['🌭', 'sausage', 'hot dog', 'bratwurst', 'chorizo'],
  ['🍖', 'ham', 'ribs'],
  ['🐟', 'fish', 'salmon', 'tuna', 'cod', 'tilapia'],
  ['🦐', 'shrimp', 'prawn'],
  ['🦀', 'crab'],
  ['🍚', 'rice'],
  ['🍝', 'pasta', 'spaghetti', 'penne', 'linguine', 'macaroni', 'lasagna'],
  ['🍜', 'noodle', 'ramen', 'udon', 'pho'],
  ['🥣', 'cereal', 'oat', 'oatmeal', 'granola', 'porridge'],
  ['🌾', 'flour', 'quinoa', 'couscous'],
  ['🍯', 'honey', 'maple syrup', 'syrup'],
  ['🫙', 'salsa', 'pesto', 'mayo', 'mayonnaise', 'mustard'],
  ['🥜', 'peanut', 'peanut butter', 'nut', 'almond', 'cashew', 'walnut', 'pistachio', 'pecan'],
  ['🍫', 'chocolate', 'cocoa', 'chocolate chip'],
  ['🍿', 'popcorn'],
  ['🥨', 'pretzel', 'cracker'],
  ['🍬', 'candy', 'sweets', 'gum', 'sugar'],
  ['🧂', 'salt', 'black pepper', 'spice', 'seasoning', 'cumin', 'paprika', 'cinnamon', 'oregano'],
  ['🥫', 'soup', 'broth', 'stock', 'sauce', 'tomato sauce', 'ketchup', 'canned'],
  ['🍕', 'pizza'],
  ['🌯', 'burrito'],
  ['🌮', 'taco'],
  ['🥟', 'dumpling', 'gyoza', 'potsticker'],
  ['🍣', 'sushi'],
  ['🥪', 'sandwich'],
  ['🍟', 'fries'],
  ['🧊', 'ice'],
  ['🧃', 'juice', 'orange juice', 'apple juice', 'kombucha'],
  ['☕', 'coffee', 'espresso', 'coffee beans'],
  ['🍵', 'tea', 'matcha', 'green tea'],
  ['🥤', 'soda', 'coke', 'sprite', 'ginger ale', 'seltzer', 'sparkling water', 'la croix', 'energy drink'],
  ['💧', 'water'],
  ['🍺', 'beer', 'cider'],
  ['🍷', 'wine'],
  ['🍾', 'champagne', 'prosecco'],
  ['🧻', 'toilet paper', 'paper towel', 'tissue', 'napkin', 'kleenex'],
  ['🧼', 'soap', 'dish soap', 'hand soap', 'dishwasher tab', 'dishwasher pod'],
  ['🧺', 'laundry', 'detergent', 'fabric softener', 'dryer sheet'],
  ['🧽', 'sponge', 'scrubber'],
  ['🧹', 'broom', 'cleaner', 'bleach', 'wipes', 'disinfectant'],
  ['🗑️', 'trash bag', 'garbage bag', 'bin bag', 'bin liner'],
  ['🧴', 'shampoo', 'conditioner', 'lotion', 'sunscreen', 'body wash', 'moisturizer', 'deodorant'],
  ['🪥', 'toothpaste', 'toothbrush', 'floss', 'mouthwash'],
  ['🪒', 'razor'],
  ['🍽️', 'paper plate', 'plate', 'plastic cup', 'cutlery', 'utensil'],
  ['💡', 'light bulb', 'lightbulb', 'bulb'],
  ['🔋', 'battery', 'batteries'],
  ['🕯️', 'candle'],
  ['💐', 'flower'],
  ['💊', 'medicine', 'vitamin', 'ibuprofen', 'tylenol', 'advil', 'painkiller'],
  ['🐶', 'dog food', 'dog treat'],
  ['🐱', 'cat food', 'cat litter', 'litter'],
];

export const STAPLES = [
  'Milk', 'Eggs', 'Bread', 'Bananas', 'Coffee', 'Toilet paper',
  'Paper towels', 'Dish soap', 'Butter', 'Rice', 'Pasta', 'Onions',
];

const COMMON = [
  'Apples', 'Avocados', 'Bacon', 'Bagels', 'Bananas', 'Basil', 'Beer', 'Bell peppers', 'Black beans',
  'Blueberries', 'Bread', 'Broccoli', 'Butter', 'Carrots', 'Cereal', 'Cheddar', 'Chicken breast', 'Chickpeas',
  'Chips', 'Chocolate', 'Cilantro', 'Coffee', 'Cream cheese', 'Cucumbers', 'Dish soap', 'Eggs', 'Flour',
  'Frozen pizza', 'Garlic', 'Ginger', 'Granola', 'Grapes', 'Greek yogurt', 'Ground beef', 'Ham', 'Honey',
  'Hot sauce', 'Hummus', 'Ice cream', 'Jam', 'Ketchup', 'Laundry detergent', 'Lemons', 'Lettuce', 'Limes',
  'Mayo', 'Milk', 'Mushrooms', 'Mustard', 'Oat milk', 'Oats', 'Olive oil', 'Onions', 'Oranges',
  'Paper towels', 'Pasta', 'Pasta sauce', 'Peanut butter', 'Pears', 'Potatoes', 'Rice', 'Salmon', 'Salsa',
  'Salt', 'Sausages', 'Shampoo', 'Soy sauce', 'Sparkling water', 'Spinach', 'Sponges', 'Strawberries',
  'Sugar', 'Tea', 'Toilet paper', 'Tofu', 'Tomatoes', 'Toothpaste', 'Tortillas', 'Trash bags', 'Tuna',
  'Vegetable oil', 'Water', 'Wine', 'Yogurt', 'Zucchini',
];

const SINGLE = new Map();
const MULTI = [];
for (const [emoji, ...keys] of GROUPS) {
  for (const key of keys) {
    if (key.includes(' ')) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      MULTI.push({ pattern: new RegExp(`(?:^| )${escaped}(?:s|es)?(?= |$)`), emoji, length: key.length });
    } else {
      SINGLE.set(key, emoji);
    }
  }
}
MULTI.sort((a, b) => b.length - a.length);

// Names seen on the board, newest last. Bounded so weeks of uptime can't grow it forever.
const CACHE_LIMIT = 500;
const cache = new Map();

function simplify(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

function singularForms(word) {
  const forms = [word];
  if (word.endsWith('ies')) forms.push(word.slice(0, -3) + 'y');
  if (word.endsWith('es')) forms.push(word.slice(0, -2));
  if (word.endsWith('s')) forms.push(word.slice(0, -1));
  return forms;
}

// Multi-word names win ("peanut butter"); otherwise the last recognised word does,
// because in English the last noun usually names the thing ("oat milk" is milk).
export function emojiFor(name) {
  if (cache.has(name)) return cache.get(name);
  const text = simplify(name || '');
  let found = null;
  if (text) {
    const multi = MULTI.find((entry) => entry.pattern.test(text));
    if (multi) {
      found = multi.emoji;
    } else {
      const words = text.split(' ');
      for (let i = words.length - 1; i >= 0 && !found; i--) {
        const form = singularForms(words[i]).find((f) => SINGLE.has(f));
        if (form) found = SINGLE.get(form);
      }
    }
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(name, found);
  return found;
}

export function nameKey(name) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function suggest(prefix, { recent = [], exclude = new Set(), limit = 4 } = {}) {
  const query = nameKey(prefix);
  if (!query) return [];
  const startsWord = (name) => {
    const key = nameKey(name);
    return key.startsWith(query) || key.includes(' ' + query);
  };
  const ranked = [...recent].sort((a, b) => b.count - a.count).map((r) => r.name);
  const seen = new Set();
  const results = [];
  for (const name of [...ranked, ...COMMON]) {
    const key = nameKey(name);
    if (seen.has(key) || exclude.has(key) || key === query || !startsWord(name)) continue;
    seen.add(key);
    results.push(name);
    if (results.length >= limit) break;
  }
  return results;
}

export function buyAgain(recent, exclude, limit = 10) {
  const ranked = [...recent].sort((a, b) => b.count - a.count || String(b.last).localeCompare(String(a.last)));
  const seen = new Set();
  const results = [];
  for (const name of [...ranked.map((r) => r.name), ...STAPLES]) {
    const key = nameKey(name);
    if (seen.has(key) || exclude.has(key)) continue;
    seen.add(key);
    results.push(name);
    if (results.length >= limit) break;
  }
  return results;
}
