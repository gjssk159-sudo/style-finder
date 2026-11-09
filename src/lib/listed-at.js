// "최신순" = 각 브랜드 홈페이지에 상품이 올라온 날짜 (#8, 2026-11-09)
//
// 우리 수집기가 처음 본 시각은 홈페이지 등록일이 아니다(수집에서 빠졌다가 다시 잡히면 옛 상품이 "방금"이 됨 —
// 실측: 11-09 HATCHINGROOM Restock 상품 139개가 한꺼번에 맨 위). 그래서 쇼핑몰이 남긴 흔적으로 등록일을 구한다.
//  - 쇼피파이: products.json 의 published_at(없으면 created_at) — 정확한 일시
//  - 식스샵:   사진 파일 이름 image_<13자리 ms>_ — 사진을 올린 시각
//  - 카페24:   사진 주소 /web/product/.../YYYYMM/ — 올린 "달". 같은 달 안에서는 상품 번호 순서대로 고르게 나눈다
//              (번호가 클수록 나중 등록). 우리가 처음 본 날보다 늦을 수는 없으므로 그 날로 한 번 더 누른다.
//  - 아임웹 등 흔적이 없는 상품: 날짜를 정하지 않음(null) → 기존 방식(first-seen.js) 그대로.
import { numOf } from './first-seen.js';

const DAY = 24 * 60 * 60 * 1000;
const KST = 9 * 60 * 60 * 1000;
const MIN_T = Date.UTC(2005, 0, 1);
const okTime = (t, now) => Number.isFinite(t) && t >= MIN_T && t <= now + DAY;

// 상품(offer) 하나에서 등록 흔적 찾기 → { exact: ms } | { month: 'YYYY-MM' } | null
export function hintOf(offer, now = Date.now()) {
  if (offer.listed_at) {
    const t = Date.parse(offer.listed_at);
    if (okTime(t, now)) return { exact: t };
  }
  const img = String(offer.image || '');
  const six = img.match(/\/image_(\d{13})(?:_|\.)/);
  if (six && okTime(Number(six[1]), now)) return { exact: Number(six[1]) };
  const c24 = img.match(/\/web\/product\/(?:[a-z_]+\/)*(20\d{2})(0[1-9]|1[0-2])\//);
  if (c24) {
    const start = Date.UTC(+c24[1], +c24[2] - 1, 1) - KST;
    if (okTime(start, now)) return { month: `${c24[1]}-${c24[2]}` };
  }
  return null;
}

const monthRange = (ym, now) => {
  const [y, m] = ym.split('-').map(Number);
  const start = Date.UTC(y, m - 1, 1) - KST;
  const end = Math.min(Date.UTC(y, m, 1) - KST, now);
  return [start, Math.max(start, end)];
};

// rows: [{ key, offers:[{ source_id, external_id, image, listed_at }], seen: ISO|null }] — 한 브랜드의 상품들
// seen = 우리가 처음 본 시각(새 상품이면 null → 지금).
// 반환: Map(key -> ISO). 흔적이 없는 상품은 Map 에 없다.
export function estimateListedAt(rows, now = new Date()) {
  const nowMs = now.getTime();
  const out = new Map();
  const monthly = new Map(); // "쇼핑몰|YYYY-MM" -> [{ key, num, seen }]
  for (const r of rows) {
    let exact = null;
    let month = null;
    for (const o of r.offers || []) {
      const h = hintOf(o, nowMs);
      if (!h) continue;
      if (h.exact != null) exact = exact == null ? h.exact : Math.min(exact, h.exact);
      else if (!month || h.month < month.ym) month = { ym: h.month, source: o.source_id, num: numOf(o.external_id) };
    }
    if (exact != null) { out.set(r.key, new Date(Math.min(exact, nowMs)).toISOString()); continue; }
    if (!month) continue;
    const k = `${month.source}|${month.ym}`;
    if (!monthly.has(k)) monthly.set(k, []);
    const seen = r.seen ? Date.parse(r.seen) : nowMs;
    monthly.get(k).push({ key: r.key, num: month.num, seen: Number.isFinite(seen) ? seen : nowMs, ym: month.ym });
  }
  for (const list of monthly.values()) {
    // 번호 순서(작은 번호 = 먼저 등록)대로 그 달 안에 고르게. 번호 없는 상품은 그 달 가운데.
    const ranked = list.filter((x) => x.num != null).sort((a, b) => a.num - b.num);
    const [start, end] = monthRange(list[0].ym, nowMs);
    const place = (x, i, n) => {
      let t = start + ((i + 1) / (n + 1)) * (end - start);
      t = Math.max(start, Math.min(t, x.seen, nowMs)); // 처음 본 날보다 늦을 수 없음(단, 그 달 안)
      out.set(x.key, new Date(Math.round(t)).toISOString());
    };
    ranked.forEach((x, i) => place(x, i, ranked.length));
    for (const x of list.filter((y) => y.num == null)) place(x, 0, 1);
  }
  return out;
}
