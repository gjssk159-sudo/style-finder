// Shopify 어댑터: {shopUrl}/products.json 페이지네이션으로 전 상품 수집.
// published 상품만 반환됨(플랫폼 특성). 필드가 전부 정형이라 파싱 이슈 없음.
// products.json 자체엔 통화 정보가 없어서(스토어 기본 통화로만 옴), 해외 스토어(예: 미국 스토어)가
// 달러로 파는 걸 그대로 원화 숫자로 써버리는 사고가 났었음 -> 홈페이지의 Shopify.currency로 실제 통화
// 확인해서 원화가 아니면 환산.

import { fetchJson, fetchText, sleep } from '../lib/http.js';

// 대략치(주기적으로 갱신 필요) — 정확한 결제 환율이 아니라 표시용 근사 환산.
const KRW_RATE = { USD: 1400, EUR: 1550, JPY: 9.3, GBP: 1800, CAD: 1020, AUD: 930 };

async function detectCurrency(base) {
  try {
    const { text } = await fetchText(base + '/', { retries: 1, timeout: 10000 });
    const m = text?.match(/Shopify\.currency\s*=\s*\{[^}]*"active"\s*:\s*"([A-Z]{3})"/);
    return m ? m[1] : 'KRW';
  } catch {
    return 'KRW';
  }
}

export async function collectShopify(source, { limit = Infinity } = {}) {
  const base = source.shopUrl.replace(/\/$/, '');
  const items = [];
  const currency = await detectCurrency(base);
  const rate = KRW_RATE[currency] || 1;
  if (currency !== 'KRW') console.log(`  [${source.id}] 통화 감지: ${currency} (환율 ${rate}로 원화 환산)`);

  for (let page = 1; page <= 100; page++) {
    if (items.length >= limit) break;
    const url = `${base}/products.json?limit=250&page=${page}`;
    const data = await fetchJson(url);
    const products = data?.products ?? [];
    if (products.length === 0) break;

    for (const p of products) {
      const prices = (p.variants ?? [])
        .map((v) => parseFloat(v.price))
        .filter((n) => !Number.isNaN(n));
      // 자사몰(type:brand)은 브랜드가 항상 소스명. 편집샵일 때만 vendor 신뢰.
      const vendor = (p.vendor ?? '').trim();
      const isPlaceholder = !vendor || /^(my store|내 스토어|스토어|store)$/i.test(vendor);
      const brand = source.type === 'select_shop' && !isPlaceholder ? vendor : source.name;

      // Shopify는 옵션명을 알려줌(Size/사이즈, Color/컬러) -> 있으면 그대로 사이즈 목록 추출
      const sizeOpt = (p.options ?? []).find((o) => /size|사이즈/i.test(o.name ?? ''));
      const sizes = sizeOpt?.values?.length ? sizeOpt.values : null;

      items.push({
        external_id: String(p.id),
        url: `${base}/products/${p.handle}`,
        title: (p.title ?? '').replace(/\s+/g, ' ').trim(),
        brand,
        price: prices.length ? Math.round(Math.min(...prices) * rate) : null,
        currency: 'KRW',
        images: (p.images ?? []).map((i) => i.src),
        in_stock: (p.variants ?? []).some((v) => v.available),
        raw_category: [p.product_type, ...(p.tags ?? [])].filter(Boolean).join(', ') || null,
        sizes,
        description: (p.body_html ?? '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&[a-z]+;/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 500) || null,
      });
    }
    await sleep(600);
  }

  return items.slice(0, limit === Infinity ? undefined : limit);
}
