// 웹사이트에서 사용자가 등록한 브랜드(status='pending')를 자동 판별해서 상태 갱신.
// 프론트엔드는 브라우저(CORS 제약)라 실시간 판별을 못 하므로, 등록은 접수만 하고
// 이 스크립트가 (수동 또는 크론으로) 주기적으로 돌면서 실제 판별을 처리한다.
//   node src/process-pending.js

import { detectPlatform } from './detect.js';
import { getSupabaseAdmin } from './lib/supabase.js';

const sb = getSupabaseAdmin();

const { data: pending, error } = await sb.from('brands').select('id, shop_url').eq('status', 'pending');
if (error) throw error;

if (!pending.length) {
  console.log('처리할 pending 브랜드 없음.');
  process.exit(0);
}

console.log(`pending 브랜드 ${pending.length}개 판별 시작`);

for (const b of pending) {
  const result = await detectPlatform(b.shop_url);
  const update =
    result.status === 'ready'
      ? { status: 'ready', platform: result.platform, discovery: result.discovery, notes: `자동 판별됨 (${result.discovery?.method}).` }
      : { status: 'needs_review', platform: result.platform || 'unknown', notes: result.reason || '판별 실패' };

  const { error: uerr } = await sb.from('brands').update(update).eq('id', b.id);
  if (uerr) console.error(`  ! ${b.id} 업데이트 실패: ${uerr.message}`);
  else console.log(`  ${b.id}: ${update.status} (${update.platform})`);
}

console.log('완료. 다음 전체 수집 때 ready로 바뀐 브랜드도 같이 처리됨.');
