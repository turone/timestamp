// tsgen-worker.js
// Worker thread script for TSGen (Node).
// This file MUST be in the same folder as tsgen.js.
// It prefetches encoded timestamps and sends them to main thread.

'use strict';
const { parentPort } = require('node:worker_threads');

// Same alphabet as main
const ASCII_BASE64_ALPHA =
  '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

// local encoder (same algorithm)
const toBase64Url48 = (v) => {
  let n = typeof v === 'bigint' ? v : BigInt(v);
  n &= (1n << 48n) - 1n;
  const out = new Array(8);
  for (let i = 0, shift = 42n; i < 8; i++, shift -= 6n) {
    out[i] = ASCII_BASE64_ALPHA[Number((n >> shift) & 0x3fn)];
  }
  return out.join('');
};

// initial send
let lastMs = Date.now();
parentPort.postMessage(toBase64Url48(lastMs));

// loop: detect ms boundary, send new encoded timestamp
const loop = async () => {
  while (true) {
    const now = Date.now();
    if (now !== lastMs) {
      lastMs = now;
      parentPort.postMessage(toBase64Url48(now));
    } else {
      // yield
      await new Promise((r) => (typeof setImmediate === 'function' ? setImmediate(r) : setTimeout(r, 0)));
    }
  }
};

loop().catch((e) => {
  // if anything fails, exit
  try { parentPort.postMessage({ __error: String(e) }); } catch (e2) {}
  process.exit(1);
});
