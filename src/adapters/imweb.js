// 아임웹(Imweb) 어댑터. 서버 HTML엔 상품 데이터가 없고 클라이언트에서 렌더링되므로
// 헤드리스 브라우저(lib/browser.js)로 실제 렌더된 DOM에서 읽는다.
//
// 발견한 패턴 (label-archive.com 실측):
//  - 상품 카드 = <a href="/{페이지ID}/?idx={상품ID}"> 안에 <img> + "제목\n\n가격원\n\n[할인가]" 텍스트
//  - 카테고리 페이지 자체가 이미 목록+가격을 다 보여줌 -> 상세페이지 따로 안 가도 됨
//  - 카테고리 목록은 홈 GNB의 최상위 숫자 경로(/123)들

import { renderPage } from '../lib/browser.js';
import { mapPool } from '../lib/concurrency.js';
import { sleep } from '../lib/http.js';

const CATEGORY_CONCURRENCY = 4;


// 쇼핑몰 메뉴에 보이는 카테고리 이름 — 우리 분류의 1순위 근거. 새 상품/세일/베스트 같은 종류가 아닌 이름은 제외.
const NON_TYPE_LABEL = /(best|new|sale|hot|event|special|collab|sold ?out|season|restock|lookbook|coupon|%|신상|세일|이벤트|베스트|예약|기획)/i;
function cleanLabel(text) {
  const t = String(text || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  return t && t.length <= 30 && !NON_TYPE_LABEL.test(t) ? t : null;
}

export async function collectImweb(source, { limit = Infinity } = {}) {
  const base = source.shopUrl.replace(/\/$/, '');

  // 홈이 아직 하이드레이션되기 전에 링크를 읽으면 0개로 나오는 일이 있어(실측: earthjigu·bordr·studiosalloy가
  // 한국 PC에서도 2초 만에 0개) 몇 번 더 시도한다.
  let categoryHrefs = [];
  const labels = new Map(); // 카테고리 경로 -> 메뉴 이름
  const catsOf = new Map(); // 상품 idx -> 들어있는 카테고리 이름들
  for (let attempt = 0; attempt < 4 && categoryHrefs.length === 0; attempt++) {
    if (attempt > 0) await sleep(3000 * attempt);
    categoryHrefs = await discoverCategories(base, labels);
  }
  if (categoryHrefs.length === 0) {
    console.warn(`  ? ${base} 카테고리 링크를 하나도 못 찾음`);
    return [];
  }
  console.log(`  카테고리 ${categoryHrefs.length}개 발견`);

  const items = new Map(); // idx -> item (여러 카테고리에 중복 등장 방지)

  // 카테고리끼리는 서로 독립적(다른 목록)이라 동시에 처리 가능 — 순차로 하나씩 돌면
  // 카테고리 많은 브랜드(label-archive 등)가 지나치게 오래 걸림. 카테고리 안 페이지 순서는
  // emptyStreak 판정 때문에 순차 유지.
  await mapPool(categoryHrefs, async (catHref) => {
    if (items.size >= limit) return;
    let page = 1;
    let emptyStreak = 0;
    while (page <= 20) {
      if (items.size >= limit) break;
      const url = `${base}${catHref}${catHref.includes('?') ? '&' : '?'}page=${page}`;
      let cards = [];
      // 타임아웃/일시적 네트워크 에러로 카테고리 전체를 포기하면, 하필 그 페이지에서 끊겼는지에 따라
      // 실행할 때마다 결과 개수가 들쭉날쭉해짐(실측: earthjigu 214개↔81개). 몇 번 재시도해보고
      // 그래도 안 되면 이 페이지만 빈 것으로 치고 다음 페이지로 넘어간다(카테고리 전체는 안 버림).
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        try {
          // waitForSelector를 안 주면 매 페이지마다 무조건 2초씩 고정으로 기다려서(브랜드마다
          // 페이지 수십 개면 그것만으로도 크게 느려짐) 상품 카드가 뜨는 즉시 넘어가게 지정.
          // 진짜 빈 페이지(더 없음)면 8초 타임아웃 후 그냥 진행(=found 0으로 자연 처리).
          const { page: pw, context } = await renderPage(url, { waitForSelector: 'a[href*="idx="]', timeout: 45000 });
          cards = await extractCards(pw);
          // 카테고리 첫 페이지가 0개인 건 "진짜 빈 카테고리"일 수도, 서버/네트워크가 느려서 카드가 아직 안 뜬 것일
          // 수도 있다. 후자를 "끝"으로 오판하면 브랜드 전체가 0개로 수집되므로(실측: CI에서 mono-prive·asien·
          // mascompany 등이 0개) 페이지 내용을 로그로 남기고 몇 번 더 다시 시도한다.
          if (cards.length === 0 && page === 1) {
            const snippet = await pw.evaluate(() => `${document.title} | ${document.body.innerText.replace(/\s+/g, ' ').slice(0, 140)}`).catch(() => '');
            await context.close();
            if (attempt < 2) {
              console.warn(`  ? ${url} 카드 0개 (시도 ${attempt + 1}/3) — ${snippet}`);
              await sleep(3000 * (attempt + 1));
              continue;
            }
            console.warn(`  ? ${url} 카드 0개 (최종) — ${snippet}`);
            ok = true;
            break;
          }
          await context.close();
          ok = true;
        } catch (err) {
          if (attempt === 2) console.warn(`  ! ${url} -> ${err.message}`);
        }
      }

      let found = 0;
      for (const c of cards) {
        const idx = c.href.match(/idx=(\d+)/)?.[1] || c.href.match(/\/(\d+)\/?$/)?.[1];
        if (!idx) continue;
        const lab = labels.get(catHref);
        if (lab) { if (!catsOf.has(idx)) catsOf.set(idx, new Set()); catsOf.get(idx).add(lab); }
        if (items.has(idx)) continue;
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
  }, CATEGORY_CONCURRENCY);

  for (const [idx, it] of items) {
    const labs = catsOf.get(idx);
    if (labs && labs.size) it.raw_category = [...labs].join(' > ');
  }
  return [...items.values()].slice(0, Number.isFinite(limit) ? limit : undefined);
}

// 아임웹은 사이트마다 카테고리 URL 형식이 다름 — 숫자 ID(/123, label-archive.com)를 쓰는 곳도,
// 친화적 슬러그(/outerwear, /pants, earthjigu.com)를 쓰는 곳도 있어서 패턴 하나로 못 잡음.
// 그래서 로그인/장바구니/문의 같은 뻔한 비카테고리 경로만 걸러내고 나머지 최상위 경로를
// 전부 후보로 시도한다 (진짜 카테고리가 아니면 상품이 0개 나와서 자연히 스킵됨).
const NON_CATEGORY = /^(login|logout|shop_cart|cart|faq|home|mypage|join|order|board|event|notice|search|member|about|contact|terms|privacy|shipping|stockist|site_join)/i;

async function discoverCategories(base, labelsOut = new Map()) {
  // 여기서 실패하면 브랜드 전체가 통째로 죽으므로(카테고리 자체를 못 찾음), 일시적
  // 타임아웃/네트워크 에러는 몇 번 재시도한다.
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
    // 메뉴 링크가 하이드레이션/스플래시 화면 뒤에 뜨는 사이트가 있어서(studiosalloy) 링크가 충분히 생길 때까지 기다린다.
    await page.waitForFunction(() => document.querySelectorAll('a[href]').length > 10, null, { timeout: 20000 }).catch(() => {});
    const links = await page.$$eval('a[href]', (as) => as.map((a) => [a.getAttribute('href'), a.textContent]));
    const out = new Set();
    for (const [h, text] of links) {
      if (!h || /^(#|javascript|mailto|tel|http)/i.test(h)) continue;
      const path = h.split('?')[0].replace(/^\/+|\/+$/g, '');
      if (!path || path.includes('.') || NON_CATEGORY.test(path)) continue;
      out.add('/' + path);
      const lab = cleanLabel(text);
      if (lab && !labelsOut.has('/' + path)) labelsOut.set('/' + path, lab);
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
      // 지연 로딩 자리표시자("/placeholder_image.cm?...", data: URI)는 진짜 사진이 아니라서 건너뛰고 다음 img를 쓴다
      // (실측: bluesf — 상품 20% 가량이 자리표시자 주소로 저장돼 앱에서 사진이 안 나왔음).
      const img = [...a.querySelectorAll('img')]
        .map((i) => i.getAttribute('src') || '')
        .find((src) => src && !/placeholder|^data:/i.test(src));
      if (img && !entry.img) entry.img = img;
      if (/sold ?out|품절/i.test(text) || a.querySelector('[class*="soldout" i]')) entry.soldOut = true;
      byIdx.set(idx, entry);
    }
    return [...byIdx.values()];
  });
}

function toItem(card, idx, base, source) {
  // "3개 남았어요!"(재고 알림), SOLD OUT, NEW 같은 배지 문구가 첫 줄이면 그게 상품명으로 잡혀버리므로 건너뛴다(실측: bluesf).
  const BADGE = /^(\d+\s*개\s*남았어요!?|sold\s*out|품절|new|best|sale|\d+%)$/i;
  const lines = card.text.split('\n').map((s) => s.trim()).filter((l) => l && !BADGE.test(l));
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
  if (image && !/^https?:\/\//i.test(image)) image = null; // 상대경로는 앱에서 열 수 없음

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
