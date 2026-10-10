import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  askers,
  countLabel,
  detailLabel,
  initials,
  money,
  parsePrice,
  priceInput,
  summaryLabel,
  totals,
} from '../../web/js/apps/grocery/format.js';

const item = (fields) => ({ done: false, qty: 1, price: null, store: null, by: null, ...fields });

test('prices typed in become cents, and go back out the same way', () => {
  assert.equal(parsePrice('3.49'), 349);
  assert.equal(parsePrice('$3.4'), 340);
  assert.equal(parsePrice('3,49 €'), 349);
  assert.equal(parsePrice('12'), 1200);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('  '), null);
  assert.ok(Number.isNaN(parsePrice('3.4.9')));
  assert.ok(Number.isNaN(parsePrice('cheap')));
  assert.equal(priceInput(349), '3.49');
  assert.equal(priceInput(null), '');
  assert.match(money(349, 'USD'), /3\.49/);
});

test('totals add up what is still to get, by store and by who asked', () => {
  const items = [
    item({ name: 'Marinara', price: 299, qty: 2, store: 'traderjoes', by: 'Sam' }),
    item({ name: 'Yogurt', price: 129, store: 'lidl', by: 'Alex' }),
    item({ name: 'Basil', store: 'traderjoes', by: 'Sam' }),
    item({ name: 'Bread', price: 500, done: true, store: 'lidl', by: 'Alex' }),
  ];
  const sum = totals(items);
  assert.equal(sum.count, 3);
  assert.equal(sum.cents, 727);
  assert.equal(sum.unpriced, 1);
  assert.deepEqual(sum.stores.map((s) => [s.key, s.count, s.cents]), [['traderjoes', 2, 598], ['lidl', 1, 129]]);
  assert.deepEqual(sum.people.map((p) => [p.key, p.cents, p.unpriced]), [['Sam', 598, 1], ['Alex', 129, 0]]);
  assert.match(summaryLabel(items, 'USD'), /^3 items · about \$7\.27$/);
  assert.equal(summaryLabel([item({ name: 'Basil' })], 'USD'), '1 item');
  assert.equal(summaryLabel([], 'USD'), 'Nothing to get');
});

test('labels for rows, avatars and the people to ask on behalf of', () => {
  assert.equal(countLabel(2), '2 items');
  assert.equal(detailLabel(item({ by: 'Sam', store: 'traderjoes', size: '25 oz' })), 'Sam · Trader Joe’s · 25 oz');
  assert.equal(detailLabel(item({})), '');
  assert.equal(initials('Sam'), 'SA');
  assert.equal(initials('Alex Kim'), 'AK');
  assert.equal(initials(''), '?');
  assert.deepEqual(askers(['Sam', 'Alex'], ['alex', 'Jo', ' '], 3), ['Sam', 'Alex', 'Jo']);
});

test('predictions: every typed word starts a word, bought-before first', async () => {
  const { predict, highlight, matchScore } = await import('../../web/js/apps/grocery/predict.js');
  const catalog = [
    { name: 'Marinara Sauce', count: 3, code: '00016285' },
    { name: 'Organic marinara', count: 1 },
    { name: 'Bananas', count: 9 },
  ];
  const marin = predict('marin', { catalog, limit: 5 });
  assert.deepEqual(marin.slice(0, 2).map((p) => [p.kind, p.name]), [['known', 'Marinara Sauce'], ['known', 'Organic marinara']]);
  assert.ok(marin.some((p) => p.kind === 'word' && p.name === 'Organic Tomato Basil Marinara'));
  assert.ok(!marin.some((p) => p.kind === 'word' && p.name === 'Marinara Sauce'), 'no repeat of a bought-before name');
  assert.equal(predict('oat mi')[0].name, 'Oat milk');
  assert.ok(predict('chick', { limit: 10 }).some((p) => p.name === 'Mandarin Orange Chicken'));
  assert.deepEqual(predict('  '), []);
  assert.equal(matchScore('Crème fraîche', 'creme fr') !== null, true);
  assert.equal(matchScore('Oat bars', 'oat mi'), null);
  assert.deepEqual(highlight('Mandarin Orange Chicken', 'chick or'), [
    { text: 'Mandarin ', match: false },
    { text: 'Or', match: true },
    { text: 'ange ', match: false },
    { text: 'Chick', match: true },
    { text: 'en', match: false },
  ]);
});

test('pictures: a taken photo, else the product photo, else the illustration', async () => {
  const { pictureUrl } = await import('../../web/js/apps/grocery/format.js');
  assert.equal(pictureUrl({ photo: '0123456789abcdef.jpg', code: '00016285' }), '/api/grocery/photo?name=0123456789abcdef.jpg');
  assert.equal(pictureUrl({ code: '00016285' }), '/api/grocery/image?code=00016285');
  assert.equal(pictureUrl({ code: '00016285', image: false }), null);
  assert.equal(pictureUrl({ name: 'Bananas' }), null);
});
