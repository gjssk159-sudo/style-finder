// Supabase 연결 헬퍼. 로컬 스크립트(수집/마이그레이션)에서만 씀 — 프론트엔드는 브라우저에서
// anon key로 직접 Supabase JS를 쓰므로 이 파일은 안 씀.
//
// .env 파일에 SUPABASE_URL / SUPABASE_SERVICE_KEY 필요 (.env.example 참고).
// service_role 키는 RLS를 무시하고 쓸 수 있어서 서버(로컬 스크립트)에서만 쓰고 절대
// 브라우저/프론트엔드 코드에 넣지 않는다.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const envPath = join(root, '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath); // Node 20.6+ 내장, dotenv 패키지 불필요
}

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      '.env에 SUPABASE_URL / SUPABASE_SERVICE_KEY 없음. .env.example 참고해서 .env 만들 것.'
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
