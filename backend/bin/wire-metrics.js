#!/usr/bin/env node

/**
 * wires a self-contained Prometheus metrics block into server.js.
 *
 * This is run during the CD build, AFTER the HerWellness app code has
 * been merged into ./backend/ but BEFORE the Docker image is built.
 *
 * Instead of requiring an external metrics.js file (which can fail due
 * to scope/module-resolution issues), this injects the metrics setup
 * directly into server.js. The injected code:
 *
 *   1. Requires prom-client directly
 *   2. Initializes default metrics & custom counters/histograms
 *   3. Mounts a middleware to track HTTP request count & duration
 *   4. Exposes GET /metrics for Prometheus scraping
 *
 * Usage:
 *   node bin/wire-metrics.js
 *   (run from backend/ after HerWellness code is merged)
 */

const fs = require('fs');
const path = require('path');

const SERVER_PATH = path.resolve(__dirname, '..', 'src', 'server.js');

if (!fs.existsSync(SERVER_PATH)) {
  console.error(`✗ server.js not found at ${SERVER_PATH}`);
  process.exit(1);
}

let code = fs.readFileSync(SERVER_PATH, 'utf8');
const lines = code.split('\n');

// Guard: skip if already patched
const MARKER = '// === Prometheus metrics (injected by deploy pipeline) ===';
if (lines.some(l => l.includes(MARKER))) {
  console.log('- Already patched, skipping');
  process.exit(0);
}

// ── The self-contained Prometheus setup block ─────────────────────
// NOTE: This block includes app.use()/app.get() INSIDE an IIFE so it
// can be inserted anywhere — `app` doesn't need to be defined yet
// because the IIFE is lazily applied via process.nextTick or it's placed
// AFTER the app definition (see insertion logic below).

const METRICS_BLOCK = `
// === Prometheus metrics (injected by deploy pipeline) ===
// Provides /metrics for Prometheus scraping and tracks HTTP request
// metrics (count, duration, errors) via middleware.
//
// Requires the "prom-client" npm package (installed during build).

(() => {
  try {
    const client = require('prom-client');

    // Collect default Node.js metrics (event loop, memory, CPU, etc.)
    try { client.collectDefaultMetrics({ prefix: 'herwell_' }); } catch (_) {
      // collectDefaultMetrics may fail in restricted containers — non-fatal
    }

    // ── Custom metrics ──────────────────────────────────────────
    const httpRequestsTotal = new client.Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    });

    const httpRequestDuration = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route'],
      buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    });

    // ── Middleware: tracks every request ────────────────────────
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const route = req.route ? req.baseUrl + req.route.path : req.path;
        httpRequestsTotal.inc({ method: req.method, route, status_code: res.statusCode });
        httpRequestDuration.observe({ method: req.method, route }, duration);
      });
      next();
    });

    // ── Route handler: serves Prometheus-formatted metrics ──────
    app.get('/metrics', async (req, res) => {
      res.set('Content-Type', client.register.contentType);
      res.end(await client.register.metrics());
    });

    console.log('  ✓ Prometheus metrics initialized');
  } catch (err) {
    console.warn('  ⚠ Prometheus metrics unavailable:', err.message);
  }
})();
`;

// ── Insert the block AFTER the app is defined ────────────────────
// Search for `const app = express()` or `app = express()` and insert
// right after that line, so `app` is guaranteed to be in scope.

let insertionIndex = -1;

for (let i = 0; i < lines.length; i++) {
  if (/app\s*=\s*express\s*\(/.test(lines[i]) || /app\s*=\s*require\s*express/.test(lines[i])) {
    insertionIndex = i;
    break;
  }
}

if (insertionIndex === -1) {
  // Fallback: find the first app.use() line
  for (let i = 0; i < lines.length; i++) {
    if (/app\.use\(/.test(lines[i])) {
      insertionIndex = i - 1; // insert right before it
      break;
    }
  }
}

if (insertionIndex === -1) {
  // Last resort: find the first require() and insert after it
  for (let i = 0; i < lines.length; i++) {
    if (/require\s*\(/.test(lines[i])) {
      insertionIndex = i;
      break;
    }
  }
}

if (insertionIndex === -1) {
  insertionIndex = 0;
}

lines.splice(insertionIndex + 1, 0, METRICS_BLOCK);
fs.writeFileSync(SERVER_PATH, lines.join('\n'));

console.log(`✓ Patched ${SERVER_PATH}`);
console.log(`  Inserted after line ${insertionIndex + 1}`);
