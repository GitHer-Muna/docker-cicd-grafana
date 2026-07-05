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

const METRICS_BLOCK = `
// === Prometheus metrics (injected by deploy pipeline) ===
// Provides /metrics for Prometheus scraping and tracks HTTP request
// metrics (count, duration, errors) via middleware.
//
// Requires the "prom-client" npm package (installed during build).

const prometheusClient = (() => {
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
    function middleware(req, res, next) {
      const start = Date.now();
      res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const route = req.route ? req.baseUrl + req.route.path : req.path;
        httpRequestsTotal.inc({ method: req.method, route, status_code: res.statusCode });
        httpRequestDuration.observe({ method: req.method, route }, duration);
      });
      next();
    }

    // ── Route handler: serves Prometheus-formatted metrics ──────
    async function metricsRoute(req, res) {
      res.set('Content-Type', client.register.contentType);
      res.end(await client.register.metrics());
    }

    console.log('  ✓ Prometheus metrics initialized');
    return { middleware, metricsRoute };
  } catch (err) {
    console.warn('  ⚠ Prometheus metrics unavailable:', err.message);
    // Return no-op middleware and route so the app doesn't crash
    return {
      middleware: (_req, _res, next) => next(),
      metricsRoute: (_req, res) => res.status(501).json({ error: 'metrics disabled' }),
    };
  }
})();

app.use(prometheusClient.middleware);
app.get('/metrics', prometheusClient.metricsRoute);
`;

// ── Insert the block right before the first require() line ──────
// We insert early so the metrics setup's own require() is grouped with
// the app's other imports.
let insertAt = 0;
for (let i = 0; i < lines.length; i++) {
  if (/require\s*\(/.test(lines[i]) && !lines[i].includes('prom-client')) {
    insertAt = i;
    break;
  }
}

// If we found a require line, insert BEFORE it to keep things at the top
// Otherwise insert after 'use strict' or at the very top
let insertionIndex = insertAt > 0 ? insertAt : 0;

lines.splice(insertionIndex, 0, METRICS_BLOCK);
fs.writeFileSync(SERVER_PATH, lines.join('\n'));

console.log(`✓ Patched ${SERVER_PATH}`);
console.log(`  Inserted Prometheus metrics block at line ${insertionIndex + 1}`);
