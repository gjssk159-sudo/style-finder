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
  const base = source.shopUrl.replace(/\/$/, '');
  const sitemapPath = source.discovery?.path || '/sitemap.xml';

  let productUrls = [];
  // brands.json에서 명시적으로 카테고리 크롤링을 지정한 경우(예: yiyae — sitemap이 로그인 필요한
  // 오래된 상품들만 가리켜서 신뢰 불가) sitemap 시도 자체를 건너뜀.
  const forceCategories = source.discovery?.method === 'cafe24_categories';
  const allUrls = forceCategories ? [] : await collectSitemapUrls(base + sitemapPath);
  productUrls = [...new Set(allUrls.filter(isProductUrl))];
  // sitemap이 있어도 상품이 너무 적으면(예: 61개 URL 중 상품 1개) 실제로는 오래됐거나
  // 비공개 상품이 대부분 빠진 불완전한 sitemap일 가능성이 큼 -> 카테고리 크롤링으로 보정.
  if (!forceCategories && productUrls.length >= 5) {
    console.log(`  sitemap: ${allUrls.length} urls, ${productUrls.length} products`);
  } else {
    console.log('  sitemap 없음 → 카테고리 크롤링으로 전환');
    const stopAt = Number.isFinite(limit) ? limit * 4 : Infinity;
    productUrls = await discoverViaCategories(base, { stopAt });
    console.log(`  카테고리 크롤링: ${productUrls.length} products`);
  }

  const targets = Number.isFinite(limit) ? productUrls.slice(0, limit) : productUrls;
  const parsed = await mapPool(
    targets,
    async (url) => {
      const { text, status } = await fetchText(url);
      if (status === 404 || !text) return null;
      return parseProductPage(text, url, source);
    },
    CONCURRENCY
  );
  return parsed.filter(Boolean);
}

async function collectSitemapUrls(sitemapUrl, depth = 0) {
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

async function discoverViaCategories(base, { maxPagesPerCat = 60, stopAt = Infinity } = {}) {
  const seedPages = [base + '/', base + '/product/list.html', base + '/index.html'];
  const categoryHrefs = new Set();

  for (const p of seedPages) {
    try {
      const { text } = await fetchText(p);
      if (!text) continue;
      const $ = cheerio.load(text);
      $('a[href]').each((_, a) => {
        const href = $(a).attr('href') || '';
        const path = href.split('#')[0];
        if (CATEGORY_HREF_RE.test(path)) categoryHrefs.add(path.replace(/&page=\d+/i, ''));
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
      const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
      await context.close();
      for (const href of hrefs) {
        const path = (href || '').split('#')[0];
        if (CATEGORY_HREF_RE.test(path)) categoryHrefs.add(path.replace(/&page=\d+/i, ''));
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
          if (CATEGORY_HREF_RE.test(path)) categoryHrefs.add(path.replace(/&page=\d+/i, ''));
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
      for (let page = 1; page <= maxPagesPerCat; page++) {
        if (products.size >= stopAt) break;
        const listUrl = base + withPage(catHref, page);
        let text, status;
        try {
          ({ text, status } = await fetchText(listUrl));
        } catch {
          break;
        }
        if (status === 404 || !text) break;

        const $ = cheerio.load(text);
        let found = 0;
        $('a[href]').each((_, a) => {
          const abs = absUrl(base, $(a).attr('href'));
          if (abs && abs.startsWith(base) && isProductUrl(abs)) {
            const canon = canonicalProductUrl(abs);
            if (!products.has(canon)) found++;
            products.add(canon);
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

function parseProductPage(html, url, source) {
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
  if (source.id === 'heritagefloss' && !ldFromVariant && images.length > 1) images = images.slice(1);

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
  const availability = offers?.availability || '';
  const in_stock = !/OutOfStock|SoldOut|Discontinued/i.test(availability);

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
