'use strict';

// Prometheus metrics for HerWell backend
// Custom counters, histograms, and gauges for application monitoring

const client = require('prom-client');

client.collectDefaultMetrics({ prefix: 'herwell_' });

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

const cycleLogsTotal = new client.Counter({
  name: 'herwell_cycle_logs_total',
  help: 'Total number of cycle log actions (created/updated/deleted)',
  labelNames: ['action'],
});

const dailyLogsTotal = new client.Counter({
  name: 'herwell_daily_logs_total',
  help: 'Total number of daily symptom log submissions',
});

const activeUsersGauge = new client.Gauge({
  name: 'herwell_db_connection_pool_size',
  help: 'Current PostgreSQL connection pool size',
});

function metricsMiddleware(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route ? req.baseUrl + req.route.path : req.path;

    httpRequestsTotal.inc({ method: req.method, route, status_code: res.statusCode });
    httpRequestDuration.observe({ method: req.method, route }, duration);
  });

  next();
}

function startPoolMonitor(pool, intervalMs = 15000) {
  async function refresh() {
    try {
      activeUsersGauge.set(pool.totalCount);
    } catch (_) {}
  }
  refresh();
  return setInterval(refresh, intervalMs);
}

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
