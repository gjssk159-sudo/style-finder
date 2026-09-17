// Shopify 어댑터: {shopUrl}/products.json 페이지네이션으로 전 상품 수집.
// published 상품만 반환됨(플랫폼 특성). 필드가 전부 정형이라 파싱 이슈 없음.

import { fetchJson, sleep } from '../lib/http.js';

export async function collectShopify(source, { limit = Infinity } = {}) {
  const base = source.shopUrl.replace(/\/$/, '');
  const items = [];

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
        price: prices.length ? Math.round(Math.min(...prices)) : null,
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
