// Sixshop 어댑터. Imweb과 마찬가지로 서버 HTML엔 상품 데이터가 없고 클라이언트(Next.js)에서
// 렌더링됨. 헤드리스 브라우저로 렌더 후 `.product-item` 카드에서 읽는다.
//
// 발견한 패턴 (serus.co.kr 실측):
//  - 카테고리 링크: 홈 nav의 CUID 스타일 경로(/cXXXXXXXXXXXXXXXXXXXXXXX, 메뉴 열지 않아도 DOM엔 있음)
//  - 상품 카드: div.product-item 안에 a.product-link(href="/products/{id}") + <img> + 텍스트
//    텍스트 예: "SOLD OUT\n\n[9/21] Big Pocket Bag, Charcoal\n\nKRW 73,000"
//              "Creased Scarf, Sand\n\n10%\nKRW 35,000\nKRW 31,500" (할인가는 마지막 숫자)
//
// mudule.com처럼 테마를 커스터마이징한 sixshop 스토어는 카테고리 경로가 CUID가 아니라 커스텀
// 슬러그(/per, /mer)이고 상품 링크도 /products/가 아니라 /product/(단수)라서 위 패턴만으론 못 찾음
// -> brands.json의 discovery.categoryPaths로 카테고리 목록을 직접 지정할 수 있게 함.

import { renderPage } from '../lib/browser.js';

const CATEGORY_RE = /^\/c[a-z0-9]{20,}$/i;
const PRODUCT_LINK_RE = /\/products?\/([a-z0-9_-]+)/i;


// 쇼핑몰 메뉴에 보이는 카테고리 이름 — 우리 분류의 1순위 근거. 새 상품/세일/베스트 같은 종류가 아닌 이름은 제외.
const NON_TYPE_LABEL = /(best|new|sale|hot|event|special|collab|sold ?out|season|restock|lookbook|coupon|%|신상|세일|이벤트|베스트|예약|기획)/i;
function cleanLabel(text) {
  const t = String(text || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return t && t.length <= 30 && !NON_TYPE_LABEL.test(t) ? t : null;
}

export async function collectSixshop(source, { limit = Infinity } = {}) {
  const base = source.shopUrl.replace(/\/$/, '');

  const labels = new Map(); // 카테고리 경로 -> 메뉴 이름
  const catsOf = new Map(); // 상품 id -> 들어있는 카테고리 이름들
  const discovered = await discoverCategories(base, labels);
  const categoryPaths = source.discovery?.categoryPaths?.length ? source.discovery.categoryPaths : discovered;
  if (categoryPaths.length === 0) return [];

  const items = new Map(); // product id -> item

  for (const catPath of categoryPaths) {
    if (items.size >= limit) break;
    let page = 1;
    let emptyStreak = 0;
    while (page <= 15) {
      if (items.size >= limit) break;
      // sixshop 테마 커스텀 슬러그 카테고리는 실제 페이지네이션 파라미터가 productListPage다
      // (?page=는 그냥 무시되고 항상 1페이지만 나옴 — mudule.com에서 실측 확인).
      const url = `${base}${catPath}?productListPage=${page}`;
      let cards = [];
      // 타임아웃/일시적 네트워크 에러로 카테고리 전체를 포기하면, 하필 그 페이지에서 끊겼는지에 따라
      // 실행할 때마다 결과 개수가 들쭉날쭉해짐. 몇 번 재시도해보고 그래도 안 되면 이 페이지만
      // 빈 것으로 치고 다음 페이지로 넘어간다(카테고리 전체는 안 버림).
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          const { page: pw, context } = await renderPage(url, { waitForSelector: '.product-item, .shopProductWrapper, a[href*="/products/"], a[href*="/product/"], .empty' });
          cards = await extractCards(pw);
          // 상품이 많은 카테고리(mudule.com의 mudule0/mer 등 여러 페이지짜리)는 waitForSelector가
          // 먼저 뜨는 스켈레톤(제목/가격 placeholder)에 반응해버려서 카드가 0개로 잡히는 경우가 있었음.
          // 진짜 빈 페이지(.empty 존재)가 아니면 하이드레이션이 끝날 때까지 몇 번 더 기다려본다.
          for (let hydrateAttempt = 0; cards.length === 0 && hydrateAttempt < 5; hydrateAttempt++) {
            const isEmpty = await pw.$('.empty').then(Boolean).catch(() => false);
            if (isEmpty) break;
            await pw.waitForTimeout(700);
            cards = await extractCards(pw);
          }
          await context.close();
          ok = true;
        } catch (err) {
          if (attempt === 2) console.warn(`  ! ${url} -> ${err.message}`);
        }
      }

      let found = 0;
      for (const c of cards) {
        const id = c.href.match(PRODUCT_LINK_RE)?.[1];
        if (!id) continue;
        const lab = labels.get(catPath);
        if (lab) { if (!catsOf.has(id)) catsOf.set(id, new Set()); catsOf.get(id).add(lab); }
        if (items.has(id)) continue;
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

  for (const [id, it] of items) {
    const labs = catsOf.get(id);
    if (labs && labs.size) it.raw_category = [...labs].join(' > ');
  }
  return [...items.values()].slice(0, Number.isFinite(limit) ? limit : undefined);
}

async function discoverCategories(base, labelsOut = new Map()) {
  // 여기서 실패하면 브랜드 전체가 통째로 죽으므로, 일시적 타임아웃/네트워크 에러는 재시도한다.
  let page, context;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      ({ page, context } = await renderPage(base + '/'));
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  try {
    const links = await page.$$eval('a[href]', (as) => as.map((a) => [a.getAttribute('href'), a.textContent]));
    for (const [h, text] of links) {
      if (!h) continue;
      const path = h.split('?')[0];
      const lab = cleanLabel(text);
      if (lab && !labelsOut.has(path)) labelsOut.set(path, lab);
    }
    return [...new Set(links.map((l) => l[0]).filter((h) => h && CATEGORY_RE.test(h)))];
  } finally {
    await context.close();
  }
}

async function extractCards(page) {
  const known = await page.$$eval('.product-item, .shopProductWrapper', (divs) =>
    divs
      .map((div) => {
        const a = div.querySelector('a[href*="/products/"], a[href*="/product/"]');
        if (!a) return null;
        // 일부 테마는 <img>가 아니라 background-image div(imgsrc 속성 또는 style)로 썸네일을 넣음
        const thumb = div.querySelector('.thumb.img, [imgsrc]');
        const bgImg = thumb
          ? thumb.getAttribute('imgsrc') ||
            thumb.style.backgroundImage?.match(/url\(["']?(.*?)["']?\)/)?.[1]
          : null;
        return {
          href: a.getAttribute('href'),
          text: div.innerText || '',
          img: div.querySelector('img')?.getAttribute('src') || bgImg || null,
        };
      })
      .filter(Boolean)
  );
  if (known.length) return known;

  // 위 두 클래스 다 없는 테마(예: Next.js CSS 모듈 해시 클래스, yinandyang 등) -> 상품 링크
  // 자체를 기준점 삼아 가장 가까운 <li>(없으면 부모)를 카드 컨테이너로 취급.
  return page.$$eval('a[href*="/products/"], a[href*="/product/"]', (links) => {
    const seen = new Set();
    const out = [];
    for (const a of links) {
      const href = a.getAttribute('href');
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const container = a.closest('li') || a.parentElement;
      const thumb = container.querySelector('.thumb.img, [imgsrc]');
      const bgImg = thumb
        ? thumb.getAttribute('imgsrc') ||
          thumb.style.backgroundImage?.match(/url\(["']?(.*?)["']?\)/)?.[1]
        : null;
      out.push({
        href,
        text: container.innerText || '',
        img: container.querySelector('img')?.getAttribute('src') || bgImg || null,
      });
    }
    return out;
  });
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
