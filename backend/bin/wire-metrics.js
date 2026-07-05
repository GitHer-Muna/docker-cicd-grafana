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
// === Prometheus app metrics (injected by deploy pipeline) ===
// Starts the DB pool monitor and fixes trust proxy for rate limiting.
// (HTTP request metrics are already handled by the HerWellness app's metrics.js)

// Fix trust proxy so express-rate-limit works behind Nginx
app.set('trust proxy', 1);

(() => {
  try {
    const client = require('prom-client');
    try { client.collectDefaultMetrics({ prefix: 'herwell_' }); } catch (_) {}

    // Start the pool monitor to update herwell_db_connection_pool_size gauge
    const { startPoolMonitor } = require('./metrics-addon');
    const pool = require('./db/pool');
    startPoolMonitor(pool);

    console.log('  ✓ Prometheus app metrics initialized (pool monitor started)');
  } catch (err) {
    console.warn('  ⚠ Prometheus app metrics unavailable:', err.message);
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
