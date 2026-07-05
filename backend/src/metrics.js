'use strict';

/**
 * ── WIRING INSTRUCTIONS ─────────────────────────────────────────────
 *
 * These additions are already present in server.js (HerWellness repo):
 *
 * 1. Import at the top of server.js:
 *    const { register: metricsRegister, metricsMiddleware } = require('./metrics');
 *
 * 2. Mount middleware early (after body parser, before routes):
 *    app.use(metricsMiddleware);
 *
 * 3. Add metrics endpoint (anywhere before error handler):
 *    app.get('/metrics', async (req, res) => {
 *      res.set('Content-Type', metricsRegister.contentType);
 *      res.end(await metricsRegister.metrics());
 *    });
 *
 * ── Wiring into routes/cycles.js ─────────────────────────────────────
 *
 * Add this import at the top:
 *    const { cycleLogsTotal } = require('../metrics');
 *
 * Then add these `.inc()` calls at the relevant response points:
 *
 * // Inside POST / handler, after res.status(201).json(rows[0]):
 *   cycleLogsTotal.inc({ action: 'created' });
 *
 * // Inside PATCH /:id handler, after res.json(rows[0]):
 *   cycleLogsTotal.inc({ action: 'updated' });
 *
 * // Inside DELETE /:id handler, after res.status(204).send():
 *   cycleLogsTotal.inc({ action: 'deleted' });
 *
 * ── Wiring into routes/dailyLogs.js ──────────────────────────────────
 *
 * Add this import at the top:
 *    const { dailyLogsTotal } = require('../metrics');
 *
 * Then add this `.inc()` call at the response point:
 *
 * // Inside POST / handler, after res.status(201).json(rows[0]):
 *   dailyLogsTotal.inc();
 *
 * ── Wiring the Pool Monitor ──────────────────────────────────────────
 *
 * In server.js, import startPoolMonitor and call it after creating the pool:
 *
 *    const { startPoolMonitor } = require('./metrics');
 *    const pool = require('./db/pool');
 *
 *    // At the end of server startup, after everything is wired up:
 *    startPoolMonitor(pool);
 *
 * This polls pool.totalCount every 15s and updates the
 * herwell_db_connection_pool_size gauge.
 *
 * ── NOTE ─────────────────────────────────────────────────────────────
 * If server.js in THIS directory (docker-cicd-grafana) doesn't exist
 * yet, copy or create it using the existing HerWellness repo's server.js.
 * The wiring described above is already done in the HerWellness server.js.
 */

const client = require('prom-client');

// ── Default Node.js metrics (event loop lag, memory, CPU, etc.) ────
// Prefix with 'herwell_' to namespace them alongside app-specific metrics
client.collectDefaultMetrics({ prefix: 'herwell_' });

// ── HTTP request count ──────────────────────────────────────────────
// Tracks every HTTP request by method, route pattern, and status code
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

// ── HTTP request duration histogram ─────────────────────────────────
// Measures request latency at the specified bucket boundaries
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

// ── Cycle logs counter ──────────────────────────────────────────────
// Tracks created / updated / deleted actions on cycle records
// This is meaningful operational data specific to the app's core feature
const cycleLogsTotal = new client.Counter({
  name: 'herwell_cycle_logs_total',
  help: 'Total number of cycle log actions (created/updated/deleted)',
  labelNames: ['action'],
});

// ── Daily symptom logs counter ──────────────────────────────────────
// Tracks daily symptom log submissions (upsert)
const dailyLogsTotal = new client.Counter({
  name: 'herwell_daily_logs_total',
  help: 'Total number of daily symptom log submissions',
});

// ── Active DB connection pool gauge ─────────────────────────────────
// Reports the current PostgreSQL connection pool size
const activeUsersGauge = new client.Gauge({
  name: 'herwell_db_connection_pool_size',
  help: 'Current PostgreSQL connection pool size',
});

/**
 * Express middleware: records HTTP request count and duration.
 *
 * - Counter labels include method, route pattern, and status code.
 * - Histogram labels include method and route pattern (without status_code
 *   to keep label cardinality manageable).
 */
function metricsMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    // Use the route pattern if available, fall back to the request path
    const route = req.route ? req.baseUrl + req.route.path : req.path;
    const countLabels = { method: req.method, route, status_code: res.statusCode };
    const durationLabels = { method: req.method, route };

    httpRequestsTotal.inc(countLabels);
    httpRequestDuration.observe(durationLabels, duration);
  });

  next();
}

/**
 * Initialises a timer that periodically reads the PostgreSQL connection pool
 * size and updates the activeUsersGauge.
 * Call once after creating the pool (e.g. in server.js startup).
 *
 * @param {import('pg').Pool} pool - The pg connection pool instance
 * @param {number} [intervalMs=15000] - Polling interval in milliseconds
 * @returns {NodeJS.Timeout}
 */
function startPoolMonitor(pool, intervalMs = 15000) {
  async function refresh() {
    try {
      activeUsersGauge.set(pool.totalCount);
    } catch (_) {
      // Pool not yet ready — next tick will retry
    }
  }
  refresh();
  return setInterval(refresh, intervalMs);
}

/**
 * Express route handler for GET /metrics.
 * Returns Prometheus-formatted metrics with the correct content type.
 */
async function metricsRoute(req, res) {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
}

module.exports = {
  register: client.register,
  metricsMiddleware,
  metricsRoute,
  startPoolMonitor,
  httpRequestsTotal,
  httpRequestDuration,
  cycleLogsTotal,
  dailyLogsTotal,
  activeUsersGauge,
};
