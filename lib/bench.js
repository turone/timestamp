'use strict';
// bench.js
// Benchmark basic vs worker-node prefetched cached get().
// Usage: node bench.js

const { createTSGen } = require('./tsgen');
const { performance } = require('perf_hooks');

const LOOPS = 1000000;

// helper
const bench = (name, gen, loops = LOOPS) => {
  // warmup
  for (let i = 0; i < 2000; i++) gen.get();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < loops; i++) gen.get();
  const t1 = process.hrtime.bigint();
  const ns = Number(t1 - t0);
  console.log(`${name.padEnd(12)} loops=${loops} total ${(ns/1e6).toFixed(3)} ms avg ${(ns/loops).toFixed(1)} ns/op`);
};

(async () => {
  console.log('TSGen benchmark (basic vs worker-node)');
  // Basic instance (prefer basic -> will never auto-start perf)
  const basicInst = createTSGen({ prefer: 'basic' });
  bench('basic', basicInst, LOOPS);

  // Worker-node instance: prefer worker, start explicitly and wait for worker to populate cache
  const workerInst = createTSGen({ prefer: 'worker' });
  workerInst.start('worker');
  // wait a bit for worker to post initial value
  await new Promise((r) => setTimeout(r, 50));
  bench('worker-node', workerInst, LOOPS);
  workerInst.stop();
})();
