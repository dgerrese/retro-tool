import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, normalizeCode } from '../src/code.js';

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

test('generateCode returns a dashed Crockford code', () => {
  assert.match(generateCode(), CODE_RE);
});

test('generateCode yields distinct codes', () => {
  const codes = new Set();
  for (let i = 0; i < 1000; i++) codes.add(generateCode());
  assert.equal(codes.size, 1000);
});

test('normalizeCode strips separators, uppercases and dashes', () => {
  assert.equal(normalizeCode('7kq4 m9xd-2htp_wrz6'), '7KQ4-M9XD-2HTP-WRZ6');
});

test('normalizeCode maps confusable letters', () => {
  assert.equal(normalizeCode('OIL0-0000-0000-0000'), '0110-0000-0000-0000');
});

test('normalizeCode rejects wrong length', () => {
  assert.equal(normalizeCode('ABC'), null);
});

test('normalizeCode rejects letters outside the alphabet', () => {
  assert.equal(normalizeCode('7KQ4-M9XD-2HTP-WRZU'), null);
});
