import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bank = JSON.parse(readFileSync(new URL('../questions.json', import.meta.url), 'utf8'));

const YESNO_KEYS = ['isBible', 'note', 'quote', 'source', 'type'];
const CHOOSE_KEYS = ['note', 'options', 'type'];
const OPTION_KEYS = ['isBible', 'quote', 'source'];

function checkKeys(obj, allowed, required, where) {
  assert.equal(typeof obj, 'object', `${where}: must be an object`);
  assert.ok(obj !== null && !Array.isArray(obj), `${where}: must be a plain object`);
  for (const key of Object.keys(obj)) {
    assert.ok(allowed.includes(key), `${where}: unexpected key "${key}"`);
  }
  for (const key of required) {
    assert.ok(Object.hasOwn(obj, key), `${where}: missing key "${key}"`);
  }
}

function checkQuote(quote, where) {
  assert.equal(typeof quote, 'string', `${where}: quote must be a string`);
  assert.ok(quote.length > 0, `${where}: quote is empty`);
  assert.equal(quote, quote.trim(), `${where}: quote has leading/trailing whitespace`);
  assert.ok(quote.length <= 160, `${where}: quote is ${quote.length} chars (max 160)`);
}

function checkSource(source, isBible, where) {
  assert.equal(typeof source, 'string', `${where}: source must be a string`);
  assert.ok(source.trim().length > 0, `${where}: source is empty`);
  if (isBible) {
    assert.ok(source.endsWith('(KJV)'), `${where}: Bible source must end with "(KJV)"`);
  } else {
    assert.ok(!source.endsWith('(KJV)'), `${where}: non-Bible source must not end with "(KJV)"`);
  }
}

function checkNote(item, where) {
  if (!Object.hasOwn(item, 'note')) return;
  assert.equal(typeof item.note, 'string', `${where}: note must be a string`);
  assert.ok(item.note.trim().length > 0, `${where}: note is empty`);
  assert.ok(item.note.length <= 140, `${where}: note is ${item.note.length} chars (max 140)`);
}

test('top-level shape', () => {
  assert.deepEqual(Object.keys(bank).sort(), ['choose', 'translation', 'yesno']);
  assert.equal(bank.translation, 'KJV');
  assert.ok(Array.isArray(bank.yesno), 'yesno must be an array');
  assert.ok(Array.isArray(bank.choose), 'choose must be an array');
});

test('bank sizes: at least 10 yes/no and 13 choose items', () => {
  assert.ok(bank.yesno.length >= 10, `only ${bank.yesno.length} yes/no items`);
  assert.ok(bank.choose.length >= 13, `only ${bank.choose.length} choose items`);
});

test('yes/no items match the schema', () => {
  bank.yesno.forEach((item, i) => {
    const where = `yesno[${i}]`;
    checkKeys(item, YESNO_KEYS, ['type', 'quote', 'isBible', 'source'], where);
    assert.equal(item.type, 'yesno', `${where}: type`);
    assert.equal(typeof item.isBible, 'boolean', `${where}: isBible must be boolean`);
    checkQuote(item.quote, where);
    checkSource(item.source, item.isBible, where);
    checkNote(item, where);
  });
});

test('choose items match the schema with exactly one Bible option', () => {
  bank.choose.forEach((item, i) => {
    const where = `choose[${i}]`;
    checkKeys(item, CHOOSE_KEYS, ['type', 'options'], where);
    assert.equal(item.type, 'choose', `${where}: type`);
    assert.ok(Array.isArray(item.options), `${where}: options must be an array`);
    assert.equal(item.options.length, 4, `${where}: must have exactly 4 options`);
    item.options.forEach((opt, j) => {
      const w = `${where}.options[${j}]`;
      checkKeys(opt, OPTION_KEYS, OPTION_KEYS, w);
      assert.equal(typeof opt.isBible, 'boolean', `${w}: isBible must be boolean`);
      checkQuote(opt.quote, w);
      checkSource(opt.source, opt.isBible, w);
    });
    const bibleCount = item.options.filter((o) => o.isBible === true).length;
    assert.equal(bibleCount, 1, `${where}: must have exactly one isBible: true option`);
    checkNote(item, where);
  });
});

test('no duplicate quotes anywhere in the file', () => {
  const normalise = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const quotes = [
    ...bank.yesno.map((item) => item.quote),
    ...bank.choose.flatMap((item) => item.options.map((o) => o.quote)),
  ];
  const seen = new Map();
  for (const q of quotes) {
    const key = normalise(q);
    assert.ok(!seen.has(key), `duplicate quote: "${q}"`);
    seen.set(key, q);
  }
});

test('yes/no Bible share is between 40% and 60%', () => {
  const share = bank.yesno.filter((item) => item.isBible).length / bank.yesno.length;
  assert.ok(share >= 0.4 && share <= 0.6, `Bible share is ${(share * 100).toFixed(1)}%`);
});
