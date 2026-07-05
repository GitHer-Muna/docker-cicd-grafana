#!/usr/bin/env node

// Wires app-specific metric increments into route handlers.
// Patches cycles.js to increment cycleLogsTotal after mutations.
// Patches dailyLogs.js to increment dailyLogsTotal after mutations.
// Runs during CD build after HerWellness app code is merged.

const fs = require('fs');
const path = require('path');

const CYCLES_PATH = path.resolve(__dirname, '..', 'src', 'routes', 'cycles.js');
const DAILYLOGS_PATH = path.resolve(__dirname, '..', 'src', 'routes', 'dailyLogs.js');

// ── Patch cycles.js ────────────────────────────────────────────
if (fs.existsSync(CYCLES_PATH)) {
  let code = fs.readFileSync(CYCLES_PATH, 'utf8');
  const lines = code.split('\n');

  if (!lines.some(l => l.includes('cycleLogsTotal'))) {
    // Add metric import after the last require() line
    let lastRequireLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/require\s*\(/.test(lines[i])) lastRequireLine = i;
    }
    if (lastRequireLine >= 0) {
      lines.splice(lastRequireLine + 1, 0, "const { cycleLogsTotal } = require('../metrics');");
    }

    // Add .inc() calls after success responses
    // POST created
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("res.status(201).json(rows[0])")) {
        lines.splice(i + 1, 0, '      cycleLogsTotal.inc({ action: \'created\' });');
        break;
      }
    }

    // PATCH updated (res.json(rows[0]) without explicit status)
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("res.json(rows[0])") && !lines[i].includes("status")) {
        lines.splice(i + 1, 0, '      cycleLogsTotal.inc({ action: \'updated\' });');
        break;
      }
    }

    // DELETE deleted
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("res.status(204).send()")) {
        lines.splice(i + 1, 0, '      cycleLogsTotal.inc({ action: \'deleted\' });');
        break;
      }
    }

    fs.writeFileSync(CYCLES_PATH, lines.join('\n'));
    console.log('✓ Patched cycles.js with cycleLogsTotal metric increments');
  } else {
    console.log('- cycles.js already patched');
  }
} else {
  console.warn('⚠ cycles.js not found at', CYCLES_PATH);
}

// ── Patch dailyLogs.js ─────────────────────────────────────────
if (fs.existsSync(DAILYLOGS_PATH)) {
  let code = fs.readFileSync(DAILYLOGS_PATH, 'utf8');
  const lines = code.split('\n');

  if (!lines.some(l => l.includes('dailyLogsTotal'))) {
    // Add metric import after the last require() line
    let lastRequireLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/require\s*\(/.test(lines[i])) lastRequireLine = i;
    }
    if (lastRequireLine >= 0) {
      lines.splice(lastRequireLine + 1, 0, "const { dailyLogsTotal } = require('../metrics');");
    }

    // POST upsert success
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("res.status(201).json(rows[0])")) {
        lines.splice(i + 1, 0, '      dailyLogsTotal.inc();');
        break;
      }
    }

    fs.writeFileSync(DAILYLOGS_PATH, lines.join('\n'));
    console.log('✓ Patched dailyLogs.js with dailyLogsTotal metric increments');
  } else {
    console.log('- dailyLogs.js already patched');
  }
} else {
  console.warn('⚠ dailyLogs.js not found at', DAILYLOGS_PATH);
}

console.log('App metrics wiring complete');
