#!/usr/bin/env node

/**
 * wires Prometheus metrics into the HerWellness Express server.
 *
 * This script is run during the CD build, AFTER the HerWellness app code
 * has been copied into ./backend/ but BEFORE the Docker image is built.
 *
 * It modifies src/server.js to:
 *   1. Import the metrics module (metrics.js)
 *   2. Mount the metrics middleware (tracks request count & duration)
 *   3. Expose the /metrics endpoint for Prometheus scraping
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

// ── 1. Add metrics import ──────────────────────────────────────────
// Find the last require() line and insert the metrics import after it
const IMPORT_LINE = `const { register: metricsRegister, metricsMiddleware, metricsRoute } = require('./metrics');`;

let lastRequireIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (/require\s*\(/.test(lines[i])) {
    lastRequireIdx = i;
  }
}

// Only insert if not already present
const alreadyImported = lines.some(line => line.includes("require('./metrics')") || line.includes('require("./metrics")'));

if (!alreadyImported && lastRequireIdx >= 0) {
  lines.splice(lastRequireIdx + 1, 0, IMPORT_LINE);
  modified = true;
  console.log('  ✓ Added metrics import');
} else if (alreadyImported) {
  console.log('  - Metrics import already present, skipping');
} else {
  console.warn('  ⚠ Could not find a require() statement to anchor the import');
}

// ── 2. Add metrics middleware ──────────────────────────────────────
// Find app.use(bodyParser...) or app.use(express.json...) and insert after
const MIDDLEWARE_LINE = `app.use(metricsMiddleware);`;

let middlewareInserted = false;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Match typical body-parser / express.json usage
  if (
    (line.includes('app.use') || line.trim().startsWith('app.use(')) &&
    (line.includes('bodyParser') || line.includes('express.json') || line.includes("express.urlencoded") || line.includes("express.raw") || line.includes("express.text")) &&
    !line.includes('metricsMiddleware')
  ) {
    // Check next line doesn't already have the middleware
    if (!lines[i + 1] || !lines[i + 1].includes('metricsMiddleware')) {
      lines.splice(i + 1, 0, MIDDLEWARE_LINE);
      middlewareInserted = true;
      modified = true;
      console.log('  ✓ Added metrics middleware');
      break;
    }
  }
}

if (!middlewareInserted) {
  // Fallback: insert after any app.use that isn't error handler, router, or metrics
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      /app\.use\(/.test(line) &&
      !line.includes('metricsMiddleware') &&
      !line.includes('errorHandler') &&
      !line.includes('(err,') &&
      !/router/i.test(lines[i + 1] || '') && // avoid router imports
      !line.trimStart().startsWith('//')
    ) {
      const nextLine = lines[i + 1] || '';
      if (!nextLine.includes('metricsMiddleware') && !nextLine.includes(MIDDLEWARE_LINE.trim())) {
        lines.splice(i + 1, 0, MIDDLEWARE_LINE);
        middlewareInserted = true;
        modified = true;
        console.log('  ✓ Added metrics middleware (fallback position)');
        break;
      }
    }
  }
}

if (!middlewareInserted) {
  console.warn('  ⚠ Could not find a suitable position for metrics middleware');
}

// ── 3. Add /metrics route ─────────────────────────────────────────
// Insert before app.listen() or server.listen() or module.exports
const ROUTE_LINE = `app.get('/metrics', metricsRoute);`;

let routeInserted = false;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (
    (line.includes('app.listen') || line.includes('.listen(') || line.includes('module.exports')) &&
    !line.includes('metricsRoute')
  ) {
    // Check previous line doesn't already have the route
    if (!lines[i - 1] || !lines[i - 1].includes('metricsRoute')) {
      lines.splice(i, 0, ROUTE_LINE);
      routeInserted = true;
      modified = true;
      console.log('  ✓ Added /metrics route');
      break;
    }
  }
}

if (!routeInserted) {
  // Fallback: append at the very end, before the last closing brace/backtick
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === '})' || trimmed === '}' || trimmed === ');' || trimmed === '`)') {
      if (!lines[i - 1] || !lines[i - 1].includes('metricsRoute')) {
        lines.splice(i, 0, ROUTE_LINE);
        routeInserted = true;
        modified = true;
        console.log('  ✓ Added /metrics route (fallback: end of file)');
        break;
      }
    }
  }
}

if (!routeInserted) {
  // Last resort: just append
  lines.push('');
  lines.push(ROUTE_LINE);
  modified = true;
  routeInserted = true;
  console.log('  ✓ Added /metrics route (appended to end of file)');
}

// ── 4. Write result ────────────────────────────────────────────────
if (modified) {
  fs.writeFileSync(SERVER_PATH, lines.join('\n'));
  console.log(`\n✓ server.js patched successfully`);
  
  // Show a diff summary
  const addedLines = lines.length - originalLines.length;
  console.log(`  ${addedLines} line(s) added`);
} else {
  console.log('\n- No changes needed');
}
