#!/usr/bin/env node

// Injects a self-contained Prometheus metrics IIFE into server.js.
// Runs during CD build after HerWellness app code is merged.

const fs = require('fs');
const path = require('path');

const SERVER_PATH = path.resolve(__dirname, '..', 'src', 'server.js');

if (!fs.existsSync(SERVER_PATH)) {
  console.error('✗ server.js not found at', SERVER_PATH);
  process.exit(1);
}

let code = fs.readFileSync(SERVER_PATH, 'utf8');
const lines = code.split('\n');

// Skip if already patched
const MARKER = '// === Prometheus metrics (injected by deploy pipeline) ===';
if (lines.some(l => l.includes(MARKER))) {
  console.log('- Already patched, skipping');
  process.exit(0);
}

const METRICS_BLOCK = `
// === Prometheus metrics (injected by deploy pipeline) ===

(() => {
  try {
    const client = require('prom-client');

    try { client.collectDefaultMetrics({ prefix: 'herwell_' }); } catch (_) {}

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

// Insert after app = express() line
let insertionIndex = -1;

for (let i = 0; i < lines.length; i++) {
  if (/app\s*=\s*express\s*\(/.test(lines[i]) || /app\s*=\s*require\s*express/.test(lines[i])) {
    insertionIndex = i;
    break;
  }
}

if (insertionIndex === -1) {
  for (let i = 0; i < lines.length; i++) {
    if (/app\.use\(/.test(lines[i])) {
      insertionIndex = i - 1;
      break;
    }
  }
}

if (insertionIndex === -1) {
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

console.log('✓ Patched', SERVER_PATH);
console.log('  Inserted after line', insertionIndex + 1);
