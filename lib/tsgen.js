// tsgen.js
// MIT License
// Main TSGen implementation with basic, internal-loop, and worker-node prefetch.
// Comments: English. User-facing text: Russian.

'use strict';

const path = require('path');
let WorkerCtor = null;
try {
  // try to load worker_threads (Node.js)
  ({ Worker: WorkerCtor } = require('node:worker_threads'));
} catch (e) {
  WorkerCtor = null;
}

// ASCII-sorted 64-char alphabet so lexicographic order == numeric order
const ASCII_BASE64_ALPHA =
  '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
if (ASCII_BASE64_ALPHA.length !== 64) throw new Error('Alphabet length must be 64');

// convert 48-bit timestamp (Number or BigInt) to 8-char base64url-like string
const toBase64Url48 = (v) => {
  // Accept Number or BigInt
  let n = typeof v === 'bigint' ? v : BigInt(v);
  // Mask to 48 bits
  n &= (1n << 48n) - 1n;
  const out = new Array(8);
  for (let i = 0, shift = 42n; i < 8; i++, shift -= 6n) {
    const idx = Number((n >> shift) & 0x3fn); // 6 bits
    out[i] = ASCII_BASE64_ALPHA[idx];
  }
  return out.join('');
};

// platform helpers (avoid runtime checks in hot path)
const isNode = typeof process !== 'undefined' && !!process.versions && !!process.versions.node;
const platformGetNowMs = isNode
  ? (() => Date.now())
  : (() => Date.now());
const platformGetNano = isNode
  ? (() => process.hrtime.bigint())
  : (() => BigInt(Math.floor((typeof performance !== 'undefined' ? performance.now() : Date.now()) * 1e6)));

// Default configuration
const defaultOptions = {
  thresholdCalls: 5,       // calls
  thresholdWindowUs: 5,    // microseconds
  perfCooldownMs: 1000,    // keep perf worker/loop alive this ms after last activity
  prefer: 'auto',          // 'auto' | 'basic' | 'internal' | 'worker'
  // If WorkerCtor === null then 'worker' not available
};

// Factory: createTSGen(options)
const createTSGen = (opts = {}) => {
  const cfg = Object.assign({}, defaultOptions, opts);

  // State
  let cached = toBase64Url48(platformGetNowMs());
  let lastMs = platformGetNowMs();

  // telemetry
  let callsInWindow = 0;
  let windowStartNano = platformGetNano();

  // internal loop controller
  let internalRunning = false;
  let internalController = null;
  let lastHighActivityAt = 0;

  // worker controller
  let workerRunning = false;
  let worker = null;
  let workerPath = path.join(__dirname, 'tsgen-worker.js');

  // mark call frequency - returns whether threshold exceeded
  const markCall = () => {
    callsInWindow++;
    const nowN = platformGetNano();
    const elapsedUs = Number((nowN - windowStartNano) / 1000n);
    if (elapsedUs >= cfg.thresholdWindowUs) {
      const calls = callsInWindow;
      callsInWindow = 0;
      windowStartNano = nowN;
      return calls >= cfg.thresholdCalls;
    }
    return false;
  };

  const updateCachedNow = () => {
    const ms = platformGetNowMs();
    lastMs = ms;
    cached = toBase64Url48(ms);
  };

  // BASIC get: compute on each call
  const basicGet = () => toBase64Url48(platformGetNowMs());

  // INTERNAL LOOP (same-thread) - updates cached every ms
  const startInternalLoop = () => {
    if (internalRunning) return;
    internalRunning = true;
    lastHighActivityAt = Date.now();
    internalController = { stopRequested: false };

    (async () => {
      let localLastMs = platformGetNowMs();
      cached = toBase64Url48(localLastMs);
      while (!internalController.stopRequested) {
        const nowMs = platformGetNowMs();
        if (nowMs !== localLastMs) {
          localLastMs = nowMs;
          cached = toBase64Url48(localLastMs);
        } else {
          // yield to event loop, small pause
          await new Promise((res) => (typeof setImmediate === 'function' ? setImmediate(res) : setTimeout(res, 0)));
        }
        // auto-stop if idle
        if (Date.now() - lastHighActivityAt > cfg.perfCooldownMs) {
          internalController.stopRequested = true;
        }
      }
      internalRunning = false;
    })().catch((e) => {
      internalRunning = false;
      console.error('tsgen internal loop error', e);
    });
  };

  const stopInternalLoop = () => {
    if (internalController) internalController.stopRequested = true;
    internalRunning = false;
  };

  // WORKER-NODE (worker_threads) - prefetch in separate thread and postMessage encoded strings
  const startWorker = () => {
    if (workerRunning) {
      lastHighActivityAt = Date.now();
      return;
    }
    if (!WorkerCtor) {
      // fallback to internal loop if Worker not supported
      startInternalLoop();
      return;
    }
    lastHighActivityAt = Date.now();
    try {
      worker = new WorkerCtor(workerPath, { eval: false });
    } catch (e) {
      // Worker failed to start -> fallback
      console.error('tsgen: worker start failed, falling back to internal loop', e);
      startInternalLoop();
      return;
    }
    workerRunning = true;
    // On message update cache
    worker.on('message', (msg) => {
      if (typeof msg === 'string') {
        cached = msg;
      }
      // keep lastHighActivityAt alive when messages flow
      lastHighActivityAt = Date.now();
    });
    worker.on('error', (err) => {
      console.error('tsgen worker error', err);
      // fallback
      stopWorker();
      startInternalLoop();
    });
    worker.on('exit', (code) => {
      workerRunning = false;
      worker = null;
      if (code !== 0) {
        // spawn internal loop as fallback
        startInternalLoop();
      }
    });
  };

  const stopWorker = () => {
    try {
      if (worker) worker.terminate();
    } catch (e) {
      // ignore
    } finally {
      worker = null;
      workerRunning = false;
    }
  };

  // decide which perf mode to use
  const requestPerf = () => {
    lastHighActivityAt = Date.now();
    if (cfg.prefer === 'basic') return; // don't start perf
    if (cfg.prefer === 'worker') {
      startWorker();
      return;
    }
    if (cfg.prefer === 'internal') {
      startInternalLoop();
      return;
    }
    // prefer == 'auto'
    if (WorkerCtor) startWorker();
    else startInternalLoop();
  };

  // public get() - hot path optimized
  const get = () => {
    // Hot path: if worker or internal loop active, return cached string
    if (workerRunning) {
      lastHighActivityAt = Date.now();
      markCall();
      return cached;
    }
    if (internalRunning) {
      lastHighActivityAt = Date.now();
      markCall();
      return cached;
    }

    // Not in perf mode - check telemetry whether to start perf
    const shouldStartPerf = markCall();
    if (shouldStartPerf) requestPerf();

    // return computed value (fallback)
    return basicGet();
  };

  // explicit control
  const start = (mode) => {
    // mode optional: 'worker'|'internal'|'auto'
    if (mode === 'worker') {
      startWorker();
      return;
    }
    if (mode === 'internal') {
      startInternalLoop();
      return;
    }
    // default: request according to prefer
    requestPerf();
  };

  const stop = () => {
    stopInternalLoop();
    stopWorker();
  };

  // expose internals for tests
  return Object.freeze({
    get,
    start,
    stop,
    _internal: {
      toBase64Url48,
      ASCII_BASE64_ALPHA,
      cfg,
      _getCached: () => cached,
      _isWorkerAvailable: () => !!WorkerCtor,
      _isWorkerRunning: () => workerRunning,
      _isInternalRunning: () => internalRunning,
    },
  });
};

// default instance
const defaultInstance = createTSGen();

module.exports = { createTSGen, defaultInstance, toBase64Url48 };
