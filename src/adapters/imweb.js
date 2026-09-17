// 아임웹(Imweb) 어댑터. 서버 HTML엔 상품 데이터가 없고 클라이언트에서 렌더링되므로
// 헤드리스 브라우저(lib/browser.js)로 실제 렌더된 DOM에서 읽는다.
//
// 발견한 패턴 (label-archive.com 실측):
//  - 상품 카드 = <a href="/{페이지ID}/?idx={상품ID}"> 안에 <img> + "제목\n\n가격원\n\n[할인가]" 텍스트
//  - 카테고리 페이지 자체가 이미 목록+가격을 다 보여줌 -> 상세페이지 따로 안 가도 됨
//  - 카테고리 목록은 홈 GNB의 최상위 숫자 경로(/123)들

import { renderPage } from '../lib/browser.js';

export async function collectImweb(source, { limit = Infinity } = {}) {
  const base = source.shopUrl.replace(/\/$/, '');

  const categoryHrefs = await discoverCategories(base);
  if (categoryHrefs.length === 0) return [];

  const items = new Map(); // idx -> item (여러 카테고리에 중복 등장 방지)

  for (const catHref of categoryHrefs) {
    if (items.size >= limit) break;
    let page = 1;
    let emptyStreak = 0;
    while (page <= 20) {
      if (items.size >= limit) break;
      const url = `${base}${catHref}${catHref.includes('?') ? '&' : '?'}page=${page}`;
      let cards = [];
      try {
        const { page: pw, context } = await renderPage(url);
        cards = await extractCards(pw);
        await context.close();
      } catch (err) {
        console.warn(`  ! ${url} -> ${err.message}`);
        break;
      }

      let found = 0;
      for (const c of cards) {
        const idx = c.href.match(/idx=(\d+)/)?.[1] || c.href.match(/\/(\d+)\/?$/)?.[1];
        if (!idx || items.has(idx)) continue;
        found++;
        items.set(idx, toItem(c, idx, base, source));
      }
      if (found === 0) {
        if (++emptyStreak >= 2) break;
      } else {
        emptyStreak = 0;
      }
      page++;
    }
  }

  return [...items.values()].slice(0, Number.isFinite(limit) ? limit : undefined);
}

// 아임웹은 사이트마다 카테고리 URL 형식이 다름 — 숫자 ID(/123, label-archive.com)를 쓰는 곳도,
// 친화적 슬러그(/outerwear, /pants, earthjigu.com)를 쓰는 곳도 있어서 패턴 하나로 못 잡음.
// 그래서 로그인/장바구니/문의 같은 뻔한 비카테고리 경로만 걸러내고 나머지 최상위 경로를
// 전부 후보로 시도한다 (진짜 카테고리가 아니면 상품이 0개 나와서 자연히 스킵됨).
const NON_CATEGORY = /^(login|logout|shop_cart|cart|faq|home|mypage|join|order|board|event|notice|search|member|about|contact|terms|privacy|shipping)/i;

async function discoverCategories(base) {
  const { page, context } = await renderPage(base + '/');
  try {
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
    const out = new Set();
    for (const h of hrefs) {
      if (!h || /^(#|javascript|mailto|tel|http)/i.test(h)) continue;
      const path = h.split('?')[0].replace(/^\/+|\/+$/g, '');
      if (!path || path.includes('.') || NON_CATEGORY.test(path)) continue;
      out.add('/' + path);
    }
    return [...out];
  } finally {
    await context.close();
  }
}

// 상품 하나가 이미지 전용 <a>와 제목/가격 전용 <a> 두 개로 따로 나오는 스킨이 있어서
// (실측: label-archive.com — 같은 idx인데 하나는 img만, 하나는 텍스트만) idx로 묶어서 합친다.
async function extractCards(page) {
  return page.$$eval('a[href*="idx="]', (as) => {
    const byIdx = new Map();
    for (const a of as) {
      const href = a.getAttribute('href') || '';
      const idx = href.match(/idx=(\d+)/)?.[1];
      if (!idx) continue;
      const entry = byIdx.get(idx) || { href, text: '', img: null, soldOut: false };
      const text = a.innerText || '';
      if (text.length > entry.text.length) entry.text = text;
      const img = a.querySelector('img')?.getAttribute('src');
      if (img && !entry.img) entry.img = img;
      if (/sold ?out|품절/i.test(text) || a.querySelector('[class*="soldout" i]')) entry.soldOut = true;
      byIdx.set(idx, entry);
    }
    return [...byIdx.values()];
  });
}

function toItem(card, idx, base, source) {
  const lines = card.text.split('\n').map((s) => s.trim()).filter(Boolean);
  const title = lines[0] || null;
  // 가격 표기가 사이트마다 다름: "113,000원" / "KRW 113,000" / "₩113,000"
  const priceMatches = card.text.match(/(?:₩|KRW)?\s?[\d,]{4,}\s*(?:원|KRW)?/gi) || [];
  const priceNums = priceMatches
    .map((s) => parseInt(s.replace(/[^\d]/g, ''), 10))
    .filter((n) => !Number.isNaN(n) && n >= 1000);
  // "138,000원 10% 124,200원" 처럼 할인가가 있으면 마지막(더 낮은 실판매가)을 채택
  const price = priceNums.length ? priceNums[priceNums.length - 1] : null;

  let image = card.img;
  if (image?.startsWith('//')) image = 'https:' + image;

  return {
    external_id: idx,
    url: new URL(card.href, base).href,
    title,
    brand: source.type === 'select_shop' ? null : source.name,
    price: Number.isNaN(price) ? null : price,
    currency: 'KRW',
    images: image ? [image] : [],
    in_stock: !card.soldOut,
    raw_category: null,
  };
}
