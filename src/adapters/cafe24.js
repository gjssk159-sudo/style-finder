// Cafe24 어댑터
// 상품 URL 수집: (1) sitemap.xml  →  없으면 (2) 카테고리 목록 페이지 크롤링
// 각 상품 페이지는 JSON-LD(Product) → Open Graph → Cafe24 마크업 순으로 파싱.
// 스킨(디자인)이 달라도 이 경로들은 대체로 동일해서 안정적.

import * as cheerio from 'cheerio';
import { fetchText, sleep } from '../lib/http.js';
import { mapPool } from '../lib/concurrency.js';
import { resolveBrand } from '../lib/brand-alias.js';

// 한 브랜드 서버에 동시에 날릴 요청 수.
const CONCURRENCY = 10;

// 반드시 경로에 /product/ 가 있어야 함 (Cafe24의 /gallery/, /collection/, /board/ 는 상품 아님)
const isProductUrl = (u) => {
  const path = u.split(/[?#]/)[0];
  if (!/\/product\//i.test(path)) return false;
  return (
    /[?&]product_no=\d+/i.test(u) || // /product/detail.html?product_no=123
    /\/product\/[^/?#]+\/\d+(?:\/|$)/i.test(path) // /product/{slug}/{id}/...
  );
};

const absUrl = (base, href) => {
  try {
    return new URL(href, base).href.split('#')[0];
  } catch {
    return null;
  }
};

export async function collectCafe24(source, { limit = Infinity } = {}) {
  const catsOut = new Map(); // 상품번호 -> 쇼핑몰 카테고리 이름들
  const base = source.shopUrl.replace(/\/$/, '');
  const sitemapPath = source.discovery?.path || '/sitemap.xml';

  let productUrls = [];
  // brands.json에서 명시적으로 카테고리 크롤링을 지정한 경우(예: yiyae — sitemap이 로그인 필요한
  // 오래된 상품들만 가리켜서 신뢰 불가) sitemap 시도 자체를 건너뜀.
  const forceCategories = source.discovery?.method === 'cafe24_categories';
  const allUrls = forceCategories ? [] : await collectSitemapUrls(base + sitemapPath);
  const baseHost = new URL(base).hostname;
  // sitemap.xml이 (도메인 이전/공유 호스팅 등의 이유로) 완전히 다른 도메인을 가리키는 경우가 실제로
  // 있음(실측: saros.kr의 sitemap이 sgnt.co.kr — 다른 회사 가구 쇼핑몰 — 상품만 나열하고 있었음).
  // 그런 sitemap을 그대로 믿으면 전혀 다른 브랜드의 상품이 섞여 들어가므로, base와 호스트가 다른
  // URL은 무조건 버린다.
  const sameHost = allUrls.filter((u) => {
    try { return new URL(u).hostname === baseHost; } catch { return false; }
  });
  if (sameHost.length < allUrls.length) {
    console.log(`  sitemap에 다른 도메인 URL ${allUrls.length - sameHost.length}개 발견 → 제외`);
  }
  productUrls = [...new Set(sameHost.filter(isProductUrl))];
  // sitemap이 있어도 상품이 너무 적으면(예: 61개 URL 중 상품 1개) 실제로는 오래됐거나
  // 비공개 상품이 대부분 빠진 불완전한 sitemap일 가능성이 큼 -> 카테고리 크롤링으로 보정.
  if (!forceCategories && productUrls.length >= 5) {
    console.log(`  sitemap: ${allUrls.length} urls, ${productUrls.length} products`);
    // sitemap은 갱신이 늦거나 일부만 담는 경우가 많아서 sitemap만 믿으면 쇼핑몰에 있는 상품이 앱에서 빠짐
    // (실측: byeunoia 72개↔실제 508개, 999humanity 584↔772, costperkilo 156↔206). 카테고리 목록도 같이 훑어서
    // 합친다. 같은 상품이 두 방식에서 다른 URL 형태로 나오므로 상품 번호(product_no/숫자 id)로 중복 제거.
    try {
      const idOf = (u) => u.match(/product_no=(\d+)/i)?.[1] || u.match(/\/product\/[^/?#]+\/(\d+)/i)?.[1] || u;
      const known = new Set(productUrls.map(idOf));
      const stopAt = Number.isFinite(limit) ? limit * 4 : Infinity;
      const viaCats = await discoverViaCategories(base, { stopAt, catsOut });
      const extra = viaCats.filter((u) => !known.has(idOf(u)));
      if (extra.length) {
        console.log(`  카테고리 크롤링으로 sitemap에 없는 상품 ${extra.length}개 추가`);
        productUrls = [...productUrls, ...extra];
      }
    } catch (err) {
      console.warn(`  ! 카테고리 보강 실패(sitemap만 사용): ${err.message}`);
    }
  } else {
    console.log('  sitemap 없음 → 카테고리 크롤링으로 전환');
    const stopAt = Number.isFinite(limit) ? limit * 4 : Infinity;
    productUrls = await discoverViaCategories(base, { stopAt, catsOut });
    console.log(`  카테고리 크롤링: ${productUrls.length} products`);
  }

  // 같은 상품이 /product/{slug}/{id}/ 와 detail.html?product_no={id} 두 가지 주소로 다 나오는 몰이 있어(yiyae) 번호로 한 번 더 합친다.
  {
    const seenIds = new Set();
    productUrls = productUrls.filter((u) => {
      const id = u.match(/product_no=(\d+)/i)?.[1] || u.match(/\/product\/[^/?#]+\/(\d+)/i)?.[1] || u;
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });
  }
  const targets = Number.isFinite(limit) ? productUrls.slice(0, limit) : productUrls;
  const results = [];
  // 일부 쇼핑몰은 서버(CI)에서 한꺼번에 요청하면 HTTP 403/429로 막는다(실측: the-museum-visitor 444개, xlim 305개가
  // 한 번에 막혀서 상품이 앱에서 통째로 빠졌음). 실패한 것만 모아서 동시성을 낮추고 잠깐 쉬었다가 다시 시도한다.
  let pending = targets;
  const PASSES = [
    { concurrency: CONCURRENCY, wait: 0 },
    { concurrency: 3, wait: 15000 },
    { concurrency: 1, wait: 30000 },
  ];
  for (let pass = 0; pass < PASSES.length && pending.length; pass++) {
    if (pass > 0) {
      console.log(`  ${pending.length}개 실패 → ${PASSES[pass].wait / 1000}초 쉬고 동시성 ${PASSES[pass].concurrency}로 재시도`);
      await sleep(PASSES[pass].wait);
    }
    const failed = [];
    await mapPool(
      pending,
      async (url) => {
        let r;
        try {
          r = await fetchText(url, { retries: pass === 0 ? 1 : 2 });
        } catch {
          failed.push(url);
          return;
        }
        if (r.status === 404 || !r.text) return;
        const item = parseProductPage(r.text, url, source);
        if (item) {
          // 상품 페이지에 경로(breadcrumb)가 없어도, 쇼핑몰 메뉴의 어느 카테고리에 들어있는지로 raw_category를 채운다
          const labs = catsOut.get(productIdOf(url) || item.external_id);
          if (labs && labs.size) item.raw_category = [...labs, item.raw_category].filter(Boolean).join(' > ');
          results.push(item);
        }
        if (pass > 0) await sleep(300);
      },
      PASSES[pass].concurrency,
    );
    pending = failed;
  }
  if (pending.length) console.warn(`  ! 끝까지 못 가져온 상품 ${pending.length}개 (차단/네트워크)`);
  return results;
}

export async function collectSitemapUrls(sitemapUrl, depth = 0) {
  if (depth > 3) return [];
  let text;
  try {
    ({ text } = await fetchText(sitemapUrl));
  } catch {
    return [];
  }
  if (!text) return [];

  const locs = [...text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeXml(m[1].trim()));

  if (/<sitemapindex/i.test(text)) {
    const out = [];
    for (const sm of locs) {
      out.push(...(await collectSitemapUrls(sm, depth + 1)));
      await sleep(300);
    }
    return out;
  }
  return locs;
}

function decodeXml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// sitemap이 없는 Cafe24 shop용 폴백:
//  홈에서 카테고리 링크를 전부 긁어서, 각 카테고리를 페이지네이션하며 상품 URL 수집.
//  Cafe24 스킨마다 카테고리 URL 형식이 다름 — 구형은 /product/list.html?cate_no=N,
//  신형(친화적 URL)은 /category/{slug}/{N}/ 만 쓰고 구형 쿼리는 아예 404가 남
//  (실측: curatedparade.com). 그래서 cate_no 숫자만 뽑아 재조립하지 않고
//  실제 <a href> 그대로 사용하고, 페이지네이션만 뒤에 붙인다.
//  (상품은 여러 카테고리에 중복 등장하므로 Set으로 정리)
const CATEGORY_HREF_RE = /^\/product\/list\.html\?cate_no=\d+(&|$)|^\/category\/[^/]+\/\d+\/?$/i;

function withPage(href, page) {
  return href.includes('?') ? `${href}&page=${page}` : `${href}${href.endsWith('/') ? '' : '/'}?page=${page}`;
}

// 쇼핑몰이 상품을 어떤 카테고리에 넣어뒀는지(메뉴 이름)를 우리 카테고리 분류의 1순위 근거로 쓴다.
// 새 상품/세일/베스트 같은 '종류가 아닌' 메뉴 이름은 걸러서 기록한다.
const NON_TYPE_LABEL = /(best|new|sale|hot|event|special|collab|sold ?out|season|restock|lookbook|coupon|%|신상|세일|이벤트|베스트|예약|기획)/i;
export const productIdOf = (u) => String(u).match(/product_no=(\d+)/i)?.[1] || String(u).match(/\/product\/[^/?#]+\/(\d+)/i)?.[1] || null;

export async function discoverViaCategories(base, { maxPagesPerCat = 60, stopAt = Infinity, catsOut = null } = {}) {
  const seedPages = [base + '/', base + '/product/list.html', base + '/index.html'];
  const categoryHrefs = new Set();
  const categoryLabel = new Map(); // href -> 메뉴에 보이는 카테고리 이름
  const noteLabel = (href, text) => {
    // 메뉴 이름 뒤에 붙는 상품 개수/재고 표시("TOP (12)", "ALL (In Stock)")는 지운다
    const t = String(text || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (t && t.length <= 30 && !NON_TYPE_LABEL.test(t) && !categoryLabel.has(href)) categoryLabel.set(href, t);
  };

  for (const p of seedPages) {
    try {
      const { text } = await fetchText(p);
      if (!text) continue;
      const $ = cheerio.load(text);
      $('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const path = href.split('#')[0];
        if (CATEGORY_HREF_RE.test(path)) { const k = path.replace(/&page=\d+/i, ''); categoryHrefs.add(k); noteLabel(k, $(a).text()); }
      });
    } catch {
      /* skip */
    }
    await sleep(400);
  }
  // 정적 HTML에서 카테고리 링크를 하나도 못 찾으면 (Cafe24 신형 GNB가 JS로 렌더되는 경우 —
  // 실측: chemehc.com 등) 헤드리스 브라우저로 홈만 렌더해서 카테고리 링크를 뽑는다.
  // 상품 목록/상세 페이지 자체는 표준 Cafe24라 plain fetch로 계속 처리 가능(실측 확인함).
  if (categoryHrefs.size === 0) {
    try {
      const { renderPage } = await import('../lib/browser.js');
      const { page, context } = await renderPage(base + '/');
      const links = await page.$$eval('a[href]', (as) => as.map((a) => [a.getAttribute('href'), a.textContent]));
      await context.close();
      for (const [href, text] of links) {
        const path = (href || '').split('#')[0];
        if (CATEGORY_HREF_RE.test(path)) { const k = path.replace(/&page=\d+/i, ''); categoryHrefs.add(k); noteLabel(k, text); }
      }
      if (categoryHrefs.size) console.log(`  GNB가 JS 렌더라 브라우저로 최상위 카테고리 ${categoryHrefs.size}개 찾음`);
    } catch (err) {
      console.warn(`  ! 브라우저 카테고리 탐색 실패: ${err.message}`);
    }
  }
  // 찾은 카테고리가 실제로는 상품 없는 상위 껍데기고, 진짜 상품은 그 안의 하위 탭(ALL/OUTER/TOP...)에
  // 있는 경우가 있음(실측: chemehc.com cate_no=24 -> 71,85,86...). 하위 탭은 카테고리 페이지 안에서는
  // plain fetch로도 보이므로, 찾아둔 카테고리마다 한 번 더 훑어서 하위 카테고리까지 합친다.
  if (categoryHrefs.size > 0) {
    const before = categoryHrefs.size;
    for (const top of [...categoryHrefs]) {
      try {
        const { text } = await fetchText(base + top);
        if (!text) continue;
        const $$ = cheerio.load(text);
        $$('a[href]').each((_, a) => {
          const href = $$(a).attr('href') || '';
          const path = href.split('#')[0];
          if (CATEGORY_HREF_RE.test(path)) { const k = path.replace(/&page=\d+/i, ''); categoryHrefs.add(k); noteLabel(k, $$(a).text()); }
        });
      } catch {
        /* skip */
      }
      await sleep(300);
    }
    if (categoryHrefs.size > before) console.log(`  하위 카테고리 포함 총 ${categoryHrefs.size}개`);
  }
  if (categoryHrefs.size === 0) categoryHrefs.add('/product/list.html?cate_no=1'); // 최후: 루트 카테고리

  // 카테고리끼리는 동시에(별개 목록이라 서로 안 부딪힘), 카테고리 안 페이지는 순차(끝 감지 필요).
  const products = new Set();
  await mapPool(
    [...categoryHrefs],
    async (catHref) => {
      let emptyStreak = 0;
      let failStreak = 0;
      for (let page = 1; page <= maxPagesPerCat; page++) {
        if (products.size >= stopAt) break;
        const listUrl = base + withPage(catHref, page);
        let text, status;
        try {
          ({ text, status } = await fetchText(listUrl, { retries: 4 }));
        } catch {
          // 일시적 차단/네트워크 오류로 카테고리를 중간에 끊어버리면(예전 동작) 뒤쪽 상품이 전부 빠진다 —
          // 이 페이지만 건너뛰고 계속하되, 연속으로 3번 실패하면 포기.
          if (++failStreak >= 3) break;
          await sleep(3000);
          continue;
        }
        failStreak = 0;
        if (status === 404 || !text) break;

        const $ = cheerio.load(text);
        let found = 0;
        $('a[href]').each((_, a) => {
          const abs = absUrl(base, $(a).attr('href'));
          if (abs && abs.startsWith(base) && isProductUrl(abs)) {
            const canon = canonicalProductUrl(abs);
            if (!products.has(canon)) found++;
            products.add(canon);
            const lab = categoryLabel.get(catHref);
            const pid = productIdOf(canon);
            if (catsOut && lab && pid) { if (!catsOut.has(pid)) catsOut.set(pid, new Set()); catsOut.get(pid).add(lab); }
          }
        });

        if (found === 0) {
          if (++emptyStreak >= 2) break;
        } else {
          emptyStreak = 0;
        }
        await sleep(100);
      }
    },
    8
  );
  return [...products];
}

// detail.html?product_no=123&cate_no=45 -> .../product/detail.html?product_no=123 (product_no 보존)
// slug 형태(/product/{slug}/{id}/...)는 뒤에 /category/N/display/M/ 같은 게 붙기도 해서
// 반드시 /product/{slug}/{id} 까지만 잘라야 함 — 안 그러면 같은 상품이 카테고리마다
// 다른 URL(=다른 상품)로 취급돼서 중복 폭증 + 상품 ID를 display 번호로 잘못 읽는 사고가 남.
function canonicalProductUrl(u) {
  const pn = u.match(/[?&]product_no=(\d+)/i);
  if (pn) {
    const origin = u.split('/product/')[0];
    return `${origin}/product/detail.html?product_no=${pn[1]}`;
  }
  const clean = u.replace(/[?#].*$/, '');
  const m = clean.match(/^(.*\/product\/[^/]+\/\d+)/);
  return m ? m[1] + '/' : clean;
}

export function parseProductPage(html, url, source) {
  const $ = cheerio.load(html);

  // --- 1. JSON-LD Product ---
  // 일부 카페24 사이트는 사이즈별 변형을 표현하려고 최신 구글 스키마인 ProductGroup(+hasVariant)을
  // 씀. 이 경우 최상위엔 Product 노드가 없어서 기존 방식대론 ld가 항상 null이 되고, 이미지/가격이
  // 예전 og:image 같은 낡은 폴백 값으로 새서 사고가 남(heritagefloss에서 실측: 대표 이미지가
  // 몇 달 전 깨진 사진으로 고정돼 있었음). hasVariant[0]을 사실상 Product처럼 취급하되,
  // 이름은 사이즈가 안 붙은 그룹 이름을 우선한다.
  let ld = null;
  let ldFromVariant = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (ld) return;
    try {
      const json = JSON.parse($(el).contents().text().trim());
      const nodes = Array.isArray(json) ? json : json['@graph'] || [json];
      for (const node of nodes) {
        const t = node['@type'];
        if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) {
          ld = node;
          break;
        }
        if (t === 'ProductGroup' && Array.isArray(node.hasVariant) && node.hasVariant.length) {
          ld = { ...node.hasVariant[0], name: node.name || node.hasVariant[0].name };
          ldFromVariant = true;
          break;
        }
      }
    } catch {
      /* 잘못된 JSON-LD 무시 */
    }
  });

  const meta = (prop) =>
    $(`meta[property="${prop}"]`).attr('content') ||
    $(`meta[name="${prop}"]`).attr('content') ||
    null;

  // --- title ---
  // 주의: 페이지 <title> 태그까지 폴백하면 안 됨 -> 삭제/비공개된 product_no가 실제 상품 데이터
  // 없이 "사이트명 온라인 스토어" 같은 일반 타이틀만 갖고 있을 때 그걸 상품명으로 잘못 채택해서
  // "상품"으로 집계됨(eburneanstairs에서 실측: 12849개 중 다수가 이런 유령 항목이었음).
  // ld.name(JSON-LD Product) 또는 og:title처럼 상품 페이지에서만 채워지는 값만 신뢰한다.
  let title = ld?.name || meta('og:title') || null;
  if (title) title = title.replace(/\s+/g, ' ').trim();
  // 상품이 아니라 상품에 딸린 개별 이미지 파일이 별도 product_no로 등록된 경우
  // ("Bag in Bag image 1/2/3/4") -> 진짜 상품이 아니므로 스킵
  if (title && /\bimage\s*\d+\s*$/i.test(title)) return null;

  // --- images ---
  let imgList = ld?.image ?? meta('og:image') ?? [];
  if (!Array.isArray(imgList)) imgList = [imgList];
  let images = [...new Set(imgList.map(fixUrl).filter(Boolean))]
    .filter((u) => !/\/images\/[a-z0-9_-]+\.(png|jpg|svg)$/i.test(u)) // 로고 등 스킨 이미지 제외
    .slice(0, 8);
  // heritagefloss: 원사이즈 상품(구식 Product 스키마)은 대표(첫) 이미지 슬롯이 사이트 쪽에서 깨져서
  // 50~200px짜리 "이미지 없음" 자리표시자만 내려줌(실측 확인됨) — 실제 사진은 두 번째(extra
  // 갤러리)부터. ProductGroup 변형에서 온 경우는 이미 fresh한 단일 이미지라 그대로 둔다.
  // 그런데 ProductGroup 쪽도 마찬가지로 옛 상품(202402 등)의 대표 이미지가 50×50~209×209 자리표시자라서
  // 앱에서 사진이 통째로 흰색으로 나왔다(실측: 헤리티지플로스 상품 대부분). 구조화 데이터 대신 상품 페이지의
  // 실제 대표 이미지(.big-img)와 갤러리(.product-images ul)를 쓴다 — 이쪽은 전부 진짜 사진.
  if (source.id === 'heritagefloss') {
    const real = $('.product-images .big-img img, .product-images ul img')
      .map((_, el) => $(el).attr('src'))
      .get()
      .map(fixUrl)
      .filter(Boolean);
    if (real.length) images = [...new Set(real)].slice(0, 8);
    else if (!ldFromVariant && images.length > 1) images = images.slice(1);
  }

  // --- price ---
  const offers = Array.isArray(ld?.offers) ? ld.offers[0] : ld?.offers;
  let priceRaw =
    offers?.price ??
    offers?.priceSpecification?.price ??
    meta('product:price:amount') ??
    $('#span_product_price_text').first().text() ??
    null;
  let price =
    priceRaw != null ? parseInt(String(priceRaw).replace(/[^\d]/g, ''), 10) : null;
  if (Number.isNaN(price)) price = null;
  // 달러 등 외화로 파는 쇼핑몰(실측: saengin — "$75.00")은 아래 "1,000원 미만은 가짜 상품" 필터에 걸려서 상품이 통째로
  // 앱에서 빠졌다. JSON-LD priceCurrency가 KRW로 잘못 적힌 경우도 있어서 화면에 보이는 가격 표기($)로 통화를 판단하고,
  // shopify 어댑터와 같은 근사 환율로 원화 환산한다.
  if (price != null) {
    const domPrice = $('#span_product_price_text').first().text() + ' ' + ($('#span_product_price_text').first().html() || '');
    const isUsd = /[$]|&#36;|USD/i.test(domPrice);
    const cur = String(isUsd ? 'USD' : offers?.priceCurrency || meta('product:price:currency') || 'KRW').toUpperCase();
    const FX = { USD: 1400, EUR: 1550, JPY: 9.3, GBP: 1800 };
    if (cur !== 'KRW' && FX[cur]) {
      const num = parseFloat((isUsd ? domPrice.match(/\d[\d,]*(?:\.\d+)?/)?.[0] : String(priceRaw)).replace(/,/g, ''));
      if (!Number.isNaN(num)) price = Math.round(num * FX[cur]);
    }
  }

  // --- brand (편집샵이면 상품의 실제 브랜드, 자사몰이면 소스명) ---
  let brand = source.name;
  if (source.type === 'select_shop') {
    const ldBrand = typeof ld?.brand === 'object' ? ld.brand?.name : ld?.brand;
    const domBrand = $('.brand').first().text().trim() || $('.xans-product-detail .brand, .product-brand, [class*="brand"] a').first().text().trim();
    brand = domBrand || ldBrand || null;
    // 편집샵 JSON-LD name은 "브랜드명 상품명"으로 붙어 나오는 경우가 많아서
    // ("산산기어 GRID ZIP-UP HOODIE") 자사몰 표기("GRID ZIP-UP HOODIE")와 안 겹쳐짐 -> 브랜드 접두어 제거
    if (brand && title) title = stripLeadingBrand(title, brand);
  }

  // --- stock ---
  // 품절 판정: 첫 번째 옵션 하나의 JSON-LD 값만 보면 틀리는 경우가 많았다(사이즈 중 일부만 품절이거나, JSON-LD 자체가 없는 몰은
  // "재고 있음"으로 잘못 남음 — 실측: heritagefloss 품절 12개 전부, coyseio 일부). 카페24는 상품 페이지에 옵션별 실제 재고가
  // option_stock_data로 들어 있으니 그걸 1순위로 쓰고(판매 가능한 옵션이 하나라도 있으면 재고 있음), 없으면 페이지 안 모든
  // JSON-LD availability를 종합한다.
  let in_stock = true;
  let optionsKnown = false;
  const stockM = html.match(/option_stock_data\s*=\s*'((?:\\.|[^'\\])*)'/) || html.match(/option_stock_data\s*=\s*"((?:\\.|[^"\\])*)"/);
  if (stockM) {
    try {
      const parsed = JSON.parse(stockM[1].replace(/\\(.)/g, '$1'));
      const opts = Object.values(parsed || {});
      if (opts.length) {
        optionsKnown = true;
        const sellable = opts.filter((o) => {
          if (!o || o.is_selling === 'F' || o.is_display === 'F') return false;
          if (o.use_stock && Number(o.stock_number) <= 0) return false;
          return true;
        });
        in_stock = sellable.length > 0;
      }
    } catch {
      /* 형식이 다르면 아래 JSON-LD 방식으로 */
    }
  }
  if (!optionsKnown) {
    const avail = [...html.matchAll(/"availability"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    if (avail.length) in_stock = avail.some((v) => /InStock|LimitedAvailability|PreOrder|BackOrder|OnlineOnly/i.test(v));
  }

  // --- id ---
  // 주의: 마지막 숫자 세그먼트를 그냥 잡으면 안 됨 -> .../category/146/display/1/ 같은 꼬리가 붙으면
  // "1"(display 번호)을 상품ID로 오인함. 반드시 /product/{slug}/ 바로 다음 숫자를 잡아야 함.
  const external_id =
    url.match(/product_no=(\d+)/i)?.[1] ||
    url.match(/\/product\/[^/?#]+\/(\d+)/)?.[1] ||
    url;

  // --- breadcrumb → raw_category ---
  // 주의: `.xans-layout-category`는 사이트 전체 GNB(전체 카테고리 목록)라 상품별 경로가 아님.
  // 이걸 넣으면 모든 상품에 모든 카테고리명이 섞여 들어가서 전상품이 모든 카테고리로 오분류됨
  // (실측: labrosseoul 전 상품이 재킷+스웻셔츠+니트+셔츠+팬츠+모자로 동시 분류되는 사고).
  // 진짜 breadcrumb은 보통 2~5단계라, 그보다 길면(=GNB 오염 의심) 통째로 버린다.
  const crumbsRaw = $('.xans-product-headcategory a, .path a, .location a')
    .map((_, a) => $(a).text().trim())
    .get()
    .filter(Boolean);
  const crumbs = crumbsRaw.length <= 6 ? crumbsRaw.join(' > ') : '';

  if (!title) return null;
  // 편집샵에 흔한 룩북/공지사항이 상품 URL을 씀(가격 1원짜리 가짜 "상품") -> 걸러냄
  // 브랜드 자사몰에서 가격이 0으로 나오는 건 품절/가격 비공개 상품인 경우가 대부분이라(실측: heritagefloss 53개, ojos 22개
  // 등이 이 필터 때문에 앱에서 빠졌음) 가격 없음(null)으로 두고 살린다. 가짜 1원짜리 룩북/공지가 흔한 건 편집샵뿐.
  if (price === 0 && source.type !== 'select_shop') price = null;
  if (price != null && price < 1000) return null;

  const description = (ld?.description || meta('og:description') || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || null;

  return {
    external_id,
    url: canonicalProductUrl(url),
    title,
    brand,
    price,
    currency: 'KRW',
    images,
    in_stock,
    raw_category: crumbs || null,
    description,
  };
}

// title 맨 앞에 붙은 브랜드명 제거. brand 원문("SANSAN GEAR")과 표준 표기(한글 "산산기어")
// 둘 다 시도하고, 공백 유무 차이는 무시하고 매칭한다.
function stripLeadingBrand(title, brand) {
  const candidates = [brand];
  const { display } = resolveBrand(brand);
  if (display && display !== brand) candidates.push(display);

  for (const cand of candidates) {
    const target = String(cand).replace(/\s+/g, '').toUpperCase();
    if (!target) continue;
    let ti = 0;
    let ci = 0;
    while (ti < title.length && ci < target.length) {
      if (/\s/.test(title[ti])) { ti++; continue; }
      if (title[ti].toUpperCase() === target[ci]) { ti++; ci++; }
      else break;
    }
    if (ci === target.length) {
      const rest = title.slice(ti).replace(/^[\s\-:|]+/, '').trim();
      if (rest) return rest;
    }
  }
  return title;
}

// Cafe24가 뱉는 깨진 이미지 URL 정리:
//  "https:https://cdn..."  ->  "https://cdn..."   (999humanity 케이스)
//  "//cdn..."              ->  "https://cdn..."
//  "http://cdn..."         ->  "https://cdn..."
function fixUrl(u) {
  if (!u) return null;
  u = String(u).trim();
  u = u.replace(/^https?:(https?:\/\/)/i, '$1');
  if (u.startsWith('//')) u = 'https:' + u;
  u = u.replace(/^http:\/\//i, 'https://');
  return /^https:\/\//i.test(u) ? u : null;
}
