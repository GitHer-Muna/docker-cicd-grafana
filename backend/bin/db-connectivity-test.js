#!/usr/bin/env node

/**
 * Tests database connectivity and reports the exact error.
 * This is run inside the backend container during CD deployment
 * to diagnose why migrations might fail.
 *
 * Usage:
 *   node bin/db-connectivity-test.js
 *   (run from backend/ inside the container)
 */

const { Pool } = require('pg');

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  user: process.env.DB_USER || 'herwell',
  password: process.env.DB_PASSWORD ? '***SET***' : '***NOT SET***',
  database: process.env.DB_NAME || 'herwell',
  max: 1,
  connectionTimeoutMillis: 10000,
};

console.log('DB Connection Test');
console.log('==================');
console.log(`Host:     ${process.env.DB_HOST || 'localhost'}`);
console.log(`Port:     ${process.env.DB_PORT || '5432'}`);
console.log(`User:     ${process.env.DB_USER || 'herwell'}`);
console.log(`Password: ${process.env.DB_PASSWORD ? '***set***' : '***NOT SET***'}`);
console.log(`Database: ${process.env.DB_NAME || 'herwell'}`);
console.log('');

const pool = new Pool(config);

async function test() {
  try {
    const client = await pool.connect();
    console.log('✓ Database connection successful');
    const res = await client.query('SELECT NOW() AS current_time, current_database() AS db, version() AS version');
    console.log(`  Time:     ${res.rows[0].current_time}`);
    console.log(`  Database: ${res.rows[0].db}`);
    console.log(`  Version:  ${res.rows[0].version.split(',')[0]}`);
    client.release();
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('✗ Database connection FAILED');
    console.error('');
    console.error('Error details:');
    console.error(`  Code:    ${err.code || 'N/A'}`);
    console.error(`  Message: ${err.message}`);
    console.error(`  Stack:   ${err.stack ? err.stack.split('\n').slice(0, 3).join('\n    ') : 'N/A'}`);
    console.error('');
    console.error('Troubleshooting tips:');
    console.error('  - Check that the db service is running: docker compose ps');
    console.error('  - Verify DB_HOST resolves: docker compose exec backend getent hosts db');
    console.error('  - Check db logs: docker compose logs db --tail=20');
    await pool.end();
    process.exit(1);
  }
}

test();
