// test_tsgen.js
// Simple asserts for toBase64Url48 and behaviors.
// Run: node test_tsgen.js
'use strict';
const assert = require('assert');
const { createTSGen, toBase64Url48 } = require('./tsgen');

(() => {
  console.log('Unit tests: start');

  // length 8
  const s = toBase64Url48(0n);
  assert.strictEqual(typeof s, 'string');
  assert.strictEqual(s.length, 8, 'encoded length must be 8');

  // zero -> first alphabet char repeated
  const firstChar = '-';
  assert.strictEqual(s, firstChar.repeat(8), 'zero encoding check');

  // increasing timestamps -> lexicographically increasing or equal
  const t = createTSGen({ prefer: 'basic' });
  const a = t.get();
  // small sleep to ensure next ms
  const wait = ms => new Promise(r => setTimeout(r, ms));
  wait(1).then(() => {
    const b = t.get();
    assert.ok(b >= a, 'lexicographic order must not decrease for increasing times');
    console.log('Unit tests: ok');
  }).catch((e) => {
    console.error('Unit tests failed', e);
    process.exit(1);
  });

})();
