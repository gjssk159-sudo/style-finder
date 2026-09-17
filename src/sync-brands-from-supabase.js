// Supabase의 brands 테이블(웹에서 사용자가 등록한 것 포함)을 로컬 brands.json으로 내려받음.
// 이후 기존 run.js/detect.js 파이프라인은 그대로 brands.json을 보고 동작 —
// Supabase가 최종 원본, brands.json은 로컬 수집용 캐시가 되는 구조.
//   node src/sync-brands-from-supabase.js

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getSupabaseAdmin } from './lib/supabase.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sb = getSupabaseAdmin();

const { data, error } = await sb.from('brands').select('*').order('id');
if (error) throw error;

const registry = {
  version: 1,
  updated: new Date().toISOString().slice(0, 10),
  note: 'Supabase brands 테이블에서 동기화됨 (src/sync-brands-from-supabase.js). 직접 수정하지 말 것 — Supabase가 원본.',
  sources: data.map((b) => ({
    id: b.id,
    name: b.name,
    nameEn: b.name_en,
    type: b.type,
    instagram: b.instagram,
    shopUrl: b.shop_url,
    platform: b.platform,
    discovery: b.discovery,
    status: b.status,
    notes: b.notes,
  })),
};

writeFileSync(join(root, 'brands.json'), JSON.stringify(registry, null, 2));
console.log(`brands.json 갱신: ${registry.sources.length}개 브랜드`);
