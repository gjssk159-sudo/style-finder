// 최신순 = 홈페이지 등록일 시험(#8). 실행: node scripts/test-listed-at.mjs  (npm run test:listed-at)
import { hintOf, estimateListedAt } from '../src/lib/listed-at.js';

const NOW = new Date('2026-11-09T03:00:00Z');
let fail = 0;
const ok = (c, m) => { console.log((c ? '통과 ' : '실패 ') + m); if (!c) fail++; };
const day = (iso) => iso.slice(0, 10);

ok(hintOf({ listed_at: '2026-10-20T10:00:00+09:00' }, NOW.getTime()).exact === Date.parse('2026-10-20T01:00:00Z'), '쇼피파이 등록 일시를 그대로 쓴다');
ok(hintOf({ image: 'https://contents.sixshop.com/thumbnails/uploadedFiles/1/product/image_1789704756282_1000.jpg' }, NOW.getTime()).exact === 1789704756282, '식스샵 사진 이름의 시각을 쓴다');
ok(hintOf({ image: 'https://a.kr/web/product/big/202310/abc.jpg' }).month === '2023-10', '카페24 사진 주소의 년월을 쓴다');
ok(hintOf({ image: 'https://a.kr/web/product/extra/small/202611/abc.jpg' }, NOW.getTime()).month === '2026-11', '카페24 extra/small 경로도 읽는다');
ok(hintOf({ image: 'https://cdn-optimized.imweb.me/upload/S2025082/61150c.jpg' }) === null, '아임웹은 흔적 없음 → null');
ok(hintOf({ image: 'https://a.kr/web/product/big/203012/abc.jpg' }, NOW.getTime()) === null, '미래 년월은 무시');

const img = (ym) => `https://a.kr/web/product/big/${ym}/x.jpg`;
const m = estimateListedAt([
  // 오늘 처음 잡힌 Restock 옛 상품(사진 2025-03) → 2025-03 안으로
  { key: 'restock', offers: [{ source_id: 'h', external_id: '3600', image: img('202503') }], seen: '2026-11-08T23:43:00Z' },
  // 10월 상품 3개: 번호 순서대로 10월 안에 고르게
  { key: 'oct1', offers: [{ source_id: 'h', external_id: '3001', image: img('202610') }], seen: '2026-11-01T00:00:00Z' },
  { key: 'oct3', offers: [{ source_id: 'h', external_id: '3003', image: img('202610') }], seen: '2026-11-01T00:00:00Z' },
  { key: 'oct2', offers: [{ source_id: 'h', external_id: '3002', image: img('202610') }], seen: '2026-11-01T00:00:00Z' },
  // 이번 달 상품인데 11-03 에 처음 봄 → 11-03 보다 늦을 수 없음
  { key: 'nov', offers: [{ source_id: 'h', external_id: '3900', image: img('202611') }], seen: '2026-11-03T00:00:00Z' },
  // 이번 달 새 상품(처음 봄) → 지금 이하
  { key: 'novNew', offers: [{ source_id: 'h', external_id: '3999', image: img('202611') }], seen: null },
  { key: 'imweb', offers: [{ source_id: 'i', external_id: '5', image: 'https://cdn.imweb.me/upload/x.jpg' }], seen: null },
], NOW);
ok(day(m.get('restock')).startsWith('2025-03'), 'Restock 옛 상품은 오늘이 아니라 사진의 달(2025-03)');
ok(m.get('oct1') < m.get('oct2') && m.get('oct2') < m.get('oct3') && day(m.get('oct1')) >= '2026-10-01' && day(m.get('oct3')) <= '2026-10-31', '같은 달은 번호 순서대로 그 달 안에');
ok(m.get('nov') <= '2026-11-03T00:00:00.000Z' && m.get('nov') >= '2026-10-31T15:00:00.000Z', '처음 본 날(11-03)보다 늦지 않게, 그 달 안에');
ok(m.get('novNew') <= NOW.toISOString(), '새 상품도 지금보다 늦지 않음');
ok(!m.has('imweb'), '흔적 없는 상품은 정하지 않음(기존 방식)');

console.log(fail ? `실패 ${fail}건` : '모두 통과');
process.exit(fail ? 1 : 0);
