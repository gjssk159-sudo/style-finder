// 최신순 기준 시각 시험(#7). 실행: node scripts/test-first-seen.mjs  (npm run test:first-seen)
import { assignFirstSeen, monotonicRepair } from '../src/lib/first-seen.js';

const NOW = new Date('2026-11-08T00:00:00Z');
const t = (d) => new Date(d).toISOString();
let fail = 0;
const ok = (c, m) => { console.log((c ? '통과 ' : '실패 ') + m); if (!c) fail++; };

// 기존 상품: 번호 100(10-01), 200(10-15), 300(11-01)
const existing = [
  { source_id: 'xlim', num: 100, first_seen_at: t('2026-10-01') },
  { source_id: 'xlim', num: 200, first_seen_at: t('2026-10-15') },
  { source_id: 'xlim', num: 300, first_seen_at: t('2026-11-01') },
];
const m = assignFirstSeen(existing, [
  { key: 'back150', offers: [{ source_id: 'xlim', external_id: '150' }] },
  { key: 'back50', offers: [{ source_id: 'xlim', external_id: '50' }] },
  { key: 'new400', offers: [{ source_id: 'xlim', external_id: '400' }] },
  { key: 'noNum', offers: [{ source_id: 'xlim', external_id: 'abc' }] },
], NOW);
ok(m.get('back150') === t('2026-10-01'), '지워졌다 돌아온 옛 상품(150)은 가까운 아래 번호(100)의 날짜를 물려받는다');
ok(m.get('back50') === t('2026-10-01'), '가장 작은 번호보다 더 작은 번호도 가장 옛 날짜');
ok(!m.has('new400'), '처음 보는 큰 번호(400)는 진짜 신상품 → 날짜를 정하지 않음(DB 기본값 now)');
ok(!m.has('noNum'), '번호가 숫자가 아니면 판단하지 않음(기본값)');

const first = assignFirstSeen([], [
  { key: 'a', offers: [{ source_id: 'erc', external_id: '10' }] },
  { key: 'b', offers: [{ source_id: 'erc', external_id: '30' }] },
  { key: 'c', offers: [{ source_id: 'erc', external_id: '20' }] },
], NOW);
const days = (k) => (NOW - new Date(first.get(k))) / 86400000;
ok(first.size === 3 && days('b') < days('c') && days('c') < days('a'), '브랜드 첫 수집: 번호가 클수록 최근 순서로 흩어 둔다');
ok(days('b') >= 1 && days('a') <= 90, '브랜드 첫 수집: 모두 1~90일 전(오늘 맨 위로 몰리지 않음)');

const fixes = monotonicRepair([
  { id: 1, source_id: 'x', num: 300, first_seen_at: t('2026-11-01') },
  { id: 2, source_id: 'x', num: 200, first_seen_at: t('2026-11-07') }, // 옛 번호인데 늦게 찍힘 → 고침
  { id: 3, source_id: 'x', num: 100, first_seen_at: t('2026-10-01') },
  { id: 4, source_id: 'x', num: 400, first_seen_at: t('2026-11-07') }, // 진짜 신상품 → 그대로
]);
ok(fixes.length === 1 && fixes[0].id === 2 && fixes[0].to === t('2026-11-01'), '바로잡기: 옛 번호가 늦게 찍힌 것만 앞당긴다(신상품은 그대로)');

console.log(fail ? `실패 ${fail}건` : '모두 통과');
process.exit(fail ? 1 : 0);
