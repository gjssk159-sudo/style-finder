// 상품 썸네일을 이미지 CDN(Photon)에 미리 요청해서 캐시를 데워둔다.
// 처음 보는 이미지는 CDN이 원본을 받아 리사이즈하느라 장당 1~2초 걸리는데, 미리 한 번 요청해두면
// 실제 사용자는 항상 캐시된 썸네일(~100ms)을 받는다. 프론트(web/app.js)의 thumbUrl()과 URL이 똑같아야 함.
//   node src/warm-thumbs.js                 -> 전체
//   node src/warm-thumbs.js --since-days=2  -> 최근 N일 안에 갱신된 상품만 (정기 수집 뒤에 사용)

import { getSupabaseAdmin } from './lib/supabase.js';

const THUMB_W = 480;
function thumbUrl(u) {
  const x = new URL(u);
  if (!/^https?:$/.test(x.protocol)) return u;
  let h = 0;
  for (let i = 0; i < u.length; i++) h = (h * 31 + u.charCodeAt(i)) >>> 0;
  return `https://i${h % 3}.wp.com/${x.host}${x.pathname}${x.search}${x.search ? '&' : '?'}w=${THUMB_W}&quality=75&strip=all`;
}

const sinceArg = process.argv.find((a) => a.startsWith('--since-days='));
const sinceDays = sinceArg ? Number(sinceArg.split('=')[1]) : null;
const CONCURRENCY = 6; // CDN에 부담 안 주게 적당히

const sb = getSupabaseAdmin();
const urls = new Set();
for (let from = 0; ; from += 1000) {
  let q = sb.from('product_group').select('image').not('image', 'is', null).range(from, from + 999);
  if (sinceDays) q = q.gte('updated_at', new Date(Date.now() - sinceDays * 86400000).toISOString());
  const { data, error } = await q;
  if (error) throw error;
  for (const r of data) {
    try { urls.add(thumbUrl(r.image)); } catch { /* 이상한 URL은 건너뜀 */ }
  }
  if (data.length < 1000) break;
}
const list = [...urls];
console.log(`썸네일 ${list.length}개 워밍 시작 (동시 ${CONCURRENCY})`);

let done = 0, fail = 0, idx = 0;
const started = Date.now();
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (idx < list.length) {
      const u = list[idx++];
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
        await r.arrayBuffer();
        if (!r.ok) fail++;
      } catch {
        fail++;
      }
      if (++done % 500 === 0) console.log(`  ${done}/${list.length} (실패 ${fail}, ${Math.round((Date.now() - started) / 1000)}s)`);
    }
  }),
);
console.log(`완료: ${done}개, 실패 ${fail}개, ${Math.round((Date.now() - started) / 1000)}s`);
