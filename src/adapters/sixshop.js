// Sixshop 어댑터. Imweb과 마찬가지로 서버 HTML엔 상품 데이터가 없고 클라이언트(Next.js)에서
// 렌더링됨. 헤드리스 브라우저로 렌더 후 `.product-item` 카드에서 읽는다.
//
// 발견한 패턴 (serus.co.kr 실측):
//  - 카테고리 링크: 홈 nav의 CUID 스타일 경로(/cXXXXXXXXXXXXXXXXXXXXXXX, 메뉴 열지 않아도 DOM엔 있음)
//  - 상품 카드: div.product-item 안에 a.product-link(href="/products/{id}") + <img> + 텍스트
//    텍스트 예: "SOLD OUT\n\n[9/21] Big Pocket Bag, Charcoal\n\nKRW 73,000"
//              "Creased Scarf, Sand\n\n10%\nKRW 35,000\nKRW 31,500" (할인가는 마지막 숫자)

import { renderPage } from '../lib/browser.js';

const CATEGORY_RE = /^\/c[a-z0-9]{20,}$/i;

export async function collectSixshop(source, { limit = Infinity } = {}) {
  const base = source.shopUrl.replace(/\/$/, '');

  const categoryPaths = await discoverCategories(base);
  if (categoryPaths.length === 0) return [];

  const items = new Map(); // product id -> item

  for (const catPath of categoryPaths) {
    if (items.size >= limit) break;
    let page = 1;
    let emptyStreak = 0;
    while (page <= 15) {
      if (items.size >= limit) break;
      const url = `${base}${catPath}?page=${page}`;
      let cards = [];
      try {
        const { page: pw, context } = await renderPage(url, { waitForSelector: '.product-item, .empty' });
        cards = await extractCards(pw);
        await context.close();
      } catch (err) {
        console.warn(`  ! ${url} -> ${err.message}`);
        break;
      }

      let found = 0;
      for (const c of cards) {
        const id = c.href.match(/\/products\/([a-z0-9]+)/i)?.[1];
        if (!id || items.has(id)) continue;
        found++;
        items.set(id, toItem(c, id, base, source));
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

async function discoverCategories(base) {
  const { page, context } = await renderPage(base + '/');
  try {
    const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
    return [...new Set(hrefs.filter((h) => h && CATEGORY_RE.test(h)))];
  } finally {
    await context.close();
  }
}

async function extractCards(page) {
  return page.$$eval('.product-item', (divs) =>
    divs
      .map((div) => {
        const a = div.querySelector('a[href*="/products/"]');
        if (!a) return null;
        return {
          href: a.getAttribute('href'),
          text: div.innerText || '',
          img: div.querySelector('img')?.getAttribute('src') || null,
        };
      })
      .filter(Boolean)
  );
}

function toItem(card, id, base, source) {
  const lines = card.text.split('\n').map((s) => s.trim()).filter(Boolean);
  const soldOut = /sold ?out|품절/i.test(card.text);
  const nonBadgeLines = lines.filter((l) => !/^sold ?out$/i.test(l) && !/^\d+%$/.test(l));
  const title = nonBadgeLines[0] || null;

  const priceMatches = card.text.match(/(?:₩|KRW)?\s?[\d,]{4,}\s*(?:원|KRW)?/gi) || [];
  const priceNums = priceMatches
    .map((s) => parseInt(s.replace(/[^\d]/g, ''), 10))
    .filter((n) => !Number.isNaN(n) && n >= 1000);
  const price = priceNums.length ? priceNums[priceNums.length - 1] : null;

  let image = card.img;
  if (image?.startsWith('//')) image = 'https:' + image;

  return {
    external_id: id,
    url: new URL(card.href, base).href,
    title,
    brand: source.type === 'select_shop' ? null : source.name,
    price,
    currency: 'KRW',
    images: image ? [image] : [],
    in_stock: !soldOut,
    raw_category: null,
  };
}
