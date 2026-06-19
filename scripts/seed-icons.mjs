import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import pg from 'pg';
import { config } from 'dotenv';

config({ path: new URL('../server/.env', import.meta.url).pathname });

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ICONS_DIR = new URL('../icons', import.meta.url).pathname;

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function labelFromFilename(filename) {
  return basename(filename, '.png')
    .replace(/ copy$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

const files = readdirSync(ICONS_DIR).filter(f => f.endsWith('.png') && !f.includes(' copy'));

let inserted = 0, skipped = 0;

for (const file of files) {
  const label = labelFromFilename(file);
  const slug  = slugify(label);
  const data  = readFileSync(join(ICONS_DIR, file));
  const b64   = `data:image/png;base64,${data.toString('base64')}`;

  const r = await pool.query(
    `INSERT INTO icons (name, slug, mime_type, data_base64)
     VALUES ($1, $2, 'image/png', $3)
     ON CONFLICT (slug) DO UPDATE SET data_base64 = EXCLUDED.data_base64
     RETURNING icon_id, name, slug`,
    [label, slug, b64],
  );
  console.log(`✓ ${r.rows[0].icon_id.toString().padStart(3)} ${r.rows[0].name} (${slug})`);
  inserted++;
}

console.log(`\nDone — ${inserted} icons upserted, ${skipped} skipped.`);
await pool.end();
