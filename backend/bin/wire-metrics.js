#!/usr/bin/env node

/**
 * wires Prometheus metrics into the HerWellness Express server.
 *
 * This script is run during the CD build, AFTER the HerWellness app code
 * has been copied into ./backend/ but BEFORE the Docker image is built.
 *
 * It modifies src/server.js to:
 *   1. Mount the metrics middleware (tracks request count & duration)
 *   2. Expose the /metrics endpoint for Prometheus scraping
 *
 * Uses inline require() calls to avoid scope issues — the HerWellness
 * server.js may wrap its require()s inside an async IIFE or function,
 * so a top-level import wouldn't be visible at the call sites.
 *
 * Usage:
 *   node bin/wire-metrics.js
 *   (run from the backend/ directory with the HerWellness code already present)
 */

const fs = require('fs');
const path = require('path');

const SERVER_PATH = path.resolve(__dirname, '..', 'src', 'server.js');

if (!fs.existsSync(SERVER_PATH)) {
  console.error(`✗ server.js not found at ${SERVER_PATH}`);
  process.exit(1);
}

let code = fs.readFileSync(SERVER_PATH, 'utf8');
const originalLines = code.split('\n');
const lines = [...originalLines];

let modified = false;

// ── Helpers ────────────────────────────────────────────────────────

function alreadyContains(str) {
  return lines.some(line => line.includes(str));
}

function insertAfter(markerIndex, text) {
  lines.splice(markerIndex + 1, 0, text);
  modified = true;
}

// ── 1. Add metrics middleware (inline require) ─────────────────────
// Inserts app.use(require('./metrics').metricsMiddleware) right after
// the body parser / express.json middleware so all requests are tracked.

if (!alreadyContains('metricsMiddleware')) {
  const INLINE_MIDDLEWARE = `app.use(require('./metrics').metricsMiddleware);`;

  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match body parser patterns: app.use(bodyParser...), app.use(express.json), etc.
    if (
      (line.includes('app.use') &&
       (line.includes('bodyParser') ||
        line.includes('express.json') ||
        line.includes('express.urlencoded') ||
        line.includes('express.raw') ||
        line.includes('express.text'))) &&
      !line.includes(INLINE_MIDDLEWARE)
    ) {
      insertAfter(i, INLINE_MIDDLEWARE);
      inserted = true;
      modified = true;
      console.log('  ✓ Added metrics middleware');
      break;
    }
  }

  if (!inserted) {
    // Fallback: insert after the first non-comment app.use()
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (
        /app\.use\(/.test(line) &&
        !line.trimStart().startsWith('//') &&
        !line.includes('metricsMiddleware')
      ) {
        insertAfter(i, INLINE_MIDDLEWARE);
        inserted = true;
        modified = true;
        console.log('  ✓ Added metrics middleware (fallback)');
        break;
      }
    }
  }

  if (!inserted) {
    console.warn('  ⚠ Could not find a suitable position for metrics middleware');
  }
} else {
  console.log('  - Metrics middleware already present, skipping');
}

// ── 2. Add /metrics route (inline require) ─────────────────────────
// Inserts app.get('/metrics', require('./metrics').metricsRoute) before
// app.listen() or similar.

if (!alreadyContains('metricsRoute')) {
  const INLINE_ROUTE = `app.get('/metrics', require('./metrics').metricsRoute);`;

  let inserted = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      (line.includes('app.listen') || line.includes('.listen(') || line.includes('module.exports')) &&
      !line.includes('metricsRoute')
    ) {
      insertAfter(i - 1, INLINE_ROUTE);
      inserted = true;
      modified = true;
      console.log('  ✓ Added /metrics route');
      break;
    }
  }

  if (!inserted) {
    // Fallback: append at the end
    lines.push('');
    lines.push(INLINE_ROUTE);
    inserted = true;
    modified = true;
    console.log('  ✓ Added /metrics route (appended to end)');
  }
} else {
  console.log('  - /metrics route already present, skipping');
}

// ── 3. Write result ────────────────────────────────────────────────
if (modified) {
  fs.writeFileSync(SERVER_PATH, lines.join('\n'));
  console.log(`\n✓ server.js patched successfully`);
  const addedLines = lines.length - originalLines.length;
  console.log(`  ${addedLines} line(s) added`);
} else {
  console.log('\n- No changes needed');
}

