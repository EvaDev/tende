// src/db.ts
// Thin pg pool wrapper. Import this everywhere — never create pools inline.
// Pool is created lazily on first use so test files can import without a live DB.

import pg from 'pg';
import config from './config.js';

const { Pool } = pg;

let _pool: pg.Pool | null = null;

function pool(): pg.Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString:        config.db.url,
      max:                     10,
      idleTimeoutMillis:       30_000,
      connectionTimeoutMillis: 5_000,
    });

    _pool.on('error', (err: Error) => {
      console.error('[db] Unexpected pool error:', err.message);
    });
  }
  return _pool;
}

const db = {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<T>> {
    return pool().query<T>(text, params);
  },

  connect(): Promise<pg.PoolClient> {
    return pool().connect();
  },

  async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool().connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  end(): Promise<void> | undefined {
    return _pool?.end();
  },
};

export default db;
