// SQLite (Node 내장 node:sqlite, 의존성 0). 파일: data/style-finder.db
// 나중에 Postgres/Supabase로 옮길 때 스키마 거의 그대로 사용 가능.

import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'data'), { recursive: true });

export const DB_PATH = join(root, 'data', 'style-finder.db');

export function openDb() {
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS product_group (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      brand       TEXT NOT NULL,
      title_norm  TEXT NOT NULL,
      title       TEXT NOT NULL,
      categories  TEXT NOT NULL DEFAULT '[]',   -- JSON 배열
      colors      TEXT NOT NULL DEFAULT '[]',   -- JSON 배열 (표준 색상 id)
      sizes       TEXT NOT NULL DEFAULT '[]',   -- JSON 배열
      min_price   INTEGER,
      max_price   INTEGER,
      image       TEXT,
      in_stock    INTEGER NOT NULL DEFAULT 0,
      offer_count INTEGER NOT NULL DEFAULT 0,
      updated_at  TEXT,
      UNIQUE (brand, title_norm)
    );

    CREATE TABLE IF NOT EXISTS offer (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id    INTEGER NOT NULL REFERENCES product_group(id) ON DELETE CASCADE,
      source_id   TEXT NOT NULL,
      source_type TEXT,
      external_id TEXT NOT NULL,
      url         TEXT NOT NULL,
      title       TEXT NOT NULL,
      price       INTEGER,
      image       TEXT,
      in_stock    INTEGER NOT NULL DEFAULT 0,
      colors      TEXT NOT NULL DEFAULT '[]',
      sizes       TEXT NOT NULL DEFAULT '[]',
      updated_at  TEXT,
      UNIQUE (source_id, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_group_brand ON product_group(brand);
    CREATE INDEX IF NOT EXISTS idx_offer_group ON offer(group_id);
  `);
  return db;
}
