// "최신순" 기준 시각(first_seen_at) 정하기 (#7, 2026-11-08)
//
// 문제: 수집이 어떤 날 일부 상품을 놓치면 load-supabase 가 그 상품을 지우고, 다음 날 다시 보이면 새 행으로 넣으면서
//       first_seen_at 이 "방금"으로 찍혔다 → 옛날 상품이 최신순 맨 위를 차지(실측: XLIM 옛 상품 279개가 11-07 00:13 한꺼번에).
// 해결: 쇼핑몰 상품 번호(카페24 product_no·아임웹 idx·쇼피파이 id — 등록 순서대로 커짐)를 기준으로
//  - 이미 본 번호보다 작거나 같은 번호로 "돌아온" 상품은 가까운 기존 상품의 날짜를 물려받는다(신상품 아님)
//  - 처음 보는 큰 번호만 진짜 신상품 → 날짜를 정하지 않고 DB 기본값(now) 그대로
//  - 브랜드 첫 수집(기존 상품 0개)은 번호 순서대로 지난 90일에 고르게 흩어 둔다(옛 상품이 한꺼번에 맨 위로 오지 않게)

const DAY = 24 * 60 * 60 * 1000;
export const numOf = (externalId) => (/^\d{1,15}$/.test(String(externalId ?? '')) ? Number(externalId) : null);

// existing: [{ source_id, num, first_seen_at }] — 같은 브랜드의 기존 상품(번호가 숫자인 것)
// fresh: [{ key, offers: [{ source_id, external_id }] }] — 이번에 새로 들어갈 상품(기존에 없던 것)
// 반환: Map(key -> ISO 시각). Map 에 없는 key 는 DB 기본값(now)을 쓰라는 뜻(진짜 신상품).
export function assignFirstSeen(existing, fresh, now = new Date()) {
  const out = new Map();
  if (!fresh.length) return out;
  if (!existing.length) {
    // 브랜드 첫 수집: 번호가 클수록 최근 → 0~90일 전에 고르게(번호 없는 상품은 맨 뒤 순서)
    const ranked = fresh
      .map((f) => ({ key: f.key, n: Math.max(-1, ...f.offers.map((o) => numOf(o.external_id) ?? -1)) }))
      .sort((a, b) => b.n - a.n);
    ranked.forEach((r, i) => {
      const pr = ranked.length > 1 ? i / (ranked.length - 1) : 0;
      out.set(r.key, new Date(now.getTime() - DAY - pr * 89 * DAY).toISOString()); // 1~90일 전
    });
    return out;
  }
  const bySource = new Map();
  for (const e of existing) {
    if (e.num == null) continue;
    if (!bySource.has(e.source_id)) bySource.set(e.source_id, []);
    bySource.get(e.source_id).push(e);
  }
  for (const list of bySource.values()) list.sort((a, b) => a.num - b.num);
  for (const f of fresh) {
    let inherit = null;
    for (const o of f.offers) {
      const n = numOf(o.external_id);
      const list = bySource.get(o.source_id);
      if (n == null || !list || !list.length) continue;
      if (n > list[list.length - 1].num) continue; // 처음 보는 큰 번호 → 신상품 쪽
      // n 이하 중 가장 가까운 기존 상품(없으면 가장 작은 번호)의 날짜
      let pick = list[0];
      for (const e of list) { if (e.num <= n) pick = e; else break; }
      if (!inherit || pick.first_seen_at < inherit) inherit = pick.first_seen_at;
    }
    if (inherit) out.set(f.key, new Date(inherit).toISOString());
  }
  return out;
}

// 이미 들어가 버린 데이터 바로잡기: 같은 쇼핑몰 안에서 번호가 작은(더 옛날) 상품이 번호가 큰 상품보다 늦은 날짜를
// 갖고 있으면, 그 상품 날짜를 "자기보다 큰 번호들 중 가장 이른 날짜"로 당긴다. 날짜는 앞당기기만 한다(진짜 신상품은 그대로).
// rows: [{ id, source_id, num, first_seen_at }] → 반환: [{ id, from, to }]
export function monotonicRepair(rows) {
  const fixes = [];
  const bySource = new Map();
  for (const r of rows) {
    if (r.num == null) continue;
    if (!bySource.has(r.source_id)) bySource.set(r.source_id, []);
    bySource.get(r.source_id).push(r);
  }
  for (const list of bySource.values()) {
    list.sort((a, b) => b.num - a.num); // 큰 번호(최근)부터
    let earliest = null;
    for (const r of list) {
      const t = new Date(r.first_seen_at).getTime();
      if (earliest != null && t > earliest) fixes.push({ id: r.id, from: r.first_seen_at, to: new Date(earliest).toISOString() });
      else earliest = earliest == null ? t : Math.min(earliest, t);
    }
  }
  return fixes;
}
