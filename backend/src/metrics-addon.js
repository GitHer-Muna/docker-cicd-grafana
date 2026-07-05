'use strict';

// Additional Prometheus metrics not present in the HerWellness app's metrics.js.
// This file survives the HerWellness code copy in the CD pipeline because
// HerWellness doesn't have a src/metrics-addon.js.
// Wired into route handlers by wire-app-metrics.js.

const client = require('prom-client');

const cycleLogsTotal = new client.Counter({
  name: 'herwell_cycle_logs_total',
  help: 'Total number of cycle log actions (created/updated/deleted)',
  labelNames: ['action'],
});

const dailyLogsTotal = new client.Counter({
  name: 'herwell_daily_logs_total',
  help: 'Total number of daily symptom log submissions',
});

const dbConnectionPoolSize = new client.Gauge({
  name: 'herwell_db_connection_pool_size',
  help: 'Current PostgreSQL connection pool size',
});

function startPoolMonitor(pool, intervalMs = 15000) {
  async function refresh() {
    try {
      dbConnectionPoolSize.set(pool.totalCount);
    } catch (_) {}
  }
  refresh();
  return setInterval(refresh, intervalMs);
}

module.exports = {
  cycleLogsTotal,
  dailyLogsTotal,
  dbConnectionPoolSize,
  startPoolMonitor,
};
