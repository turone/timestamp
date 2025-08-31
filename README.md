# 48-bit Timestamp Generator (UUIDv7-style)
Generated https://chatgpt.com/share/68b4b510-ef8c-8006-8a2f-3b086ca9e301

This project implements a **fast 48-bit timestamp generator** encoded into **Base64URL** (8 characters).
Goal: **performance + correctness + maintainability**.

## Variants

- **basic** — every call directly uses `Date.now()` + encode.
- **internal loop** — background loop prefetches timestamp batches.
- **worker-node** — Node.js WorkerThread maintains cached timestamps, main thread reads from cache.
- *(WIP)* `atomics` — planned version with `SharedArrayBuffer` + `Atomics.wait/notify`.

## Files

- `tsgen.js` — main implementation, includes `basic`, `internal`, and `worker-node`.
- `bench.js` — benchmark runner with multiple loop counts and percentiles.
- `worker-node.js` — helper worker file for cache prefetching (used by `tsgen.js`).

## Usage

Generate a timestamp:

```js
const { tsgen } = require('./tsgen');

// Basic
console.log(tsgen.basic());

// Internal loop
console.log(tsgen.internal());

// Worker-thread
(async () => {
  await tsgen.worker.init();
  console.log(tsgen.worker.next());
})();
