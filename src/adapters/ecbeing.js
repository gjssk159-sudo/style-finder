// ecbeing 어댑터(일본 쇼핑몰 프로그램, 주소가 /shop/default.aspx · /shop/g/g<상품번호> 모양). 예: CA4LA(ca4la.com)
// 분류 화면의 상품 목록은 화면이 열린 뒤 /shop/goods/goodslightningsearchajax.aspx 로 불러온다.
// 그 주소에 type=all 을 주면 전 상품을 페이지(ps=한 번에 몇 개, p=몇 쪽)로 준다 → 빈 쪽이 나올 때까지 읽는다.
// 목록에 이름·가격(엔화 "¥12,100")·사진·상품 주소가 다 있어서 상품 페이지는 따로 열지 않는다.
// 분류: 쇼핑몰 메뉴(/shop/c/c<번호>)의 일본어 이름을 영어로 바꿔 분류별로 먼저 읽고(raw_category), 어느 분류에도 없는 상품은 type=all 로 채운다.
// 목록에는 품절 표시가 없어 재고 있음으로 둔다. 가격은 그날 환율로 원화로 바꾼다(src/lib/fx.js).
// robots.txt: 검색(/shop/goods/search.aspx)은 막혀 있고 이 목록 주소는 허용. 쪽 사이 1.5초 쉰다.

import * as cheerio from 'cheerio';
import { fetchText, sleep } from '../lib/http.js';
import { krwRate, toKrw } from '../lib/fx.js';

const PAGE_SIZE = 100;
const MAX_PAGES = 80;

// 일본어 분류 이름 → 분류기(src/lib/taxonomy.js)가 알아듣는 영어. 앞에서부터 먼저 맞는 것.
const JP_CATEGORY = [
  [/ニットキャップ|ニット帽|ビーニー/, 'Hats > Beanie'],
  [/ベレー/, 'Hats > Beret'],
  [/ハンチング/, 'Hats > Hunting cap'],
  [/キャスケット/, 'Hats > Newsboy cap'],
  [/バケット|バケハ/, 'Hats > Bucket hat'],
  [/キャップ/, 'Hats > Cap'],
  [/ハット|帽子/, 'Hats > Hat'],
  [/バッグ|鞄|かばん/, 'Bags'],
  [/シューズ|靴|スニーカー|ブーツ/, 'Shoes'],
  [/ヘアバンド|カチューシャ|ヘッドドレス|ヘア|小物|雑貨|アクセサリー|ケア/, 'Acc'],
  [/アウター|ジャケット|コート/, 'Outer'],
  [/パンツ|ボトム|スカート/, 'Bottoms'],
  [/トップス|シャツ|ニット|カットソー|スウェット/, 'Tops'],
];
export function jpCategory(name) {
  for (const [re, en] of JP_CATEGORY) if (re.test(name)) return en;
  return null;
}

// 첫 화면 메뉴에서 분류 번호와 이름을 읽는다 → [{ id: '61', name: 'ハット', raw: 'Hats > Hat' }]
async function readCategories(base) {
  try {
    const { text } = await fetchText(`${base}/shop/`, { retries: 1 });
    const $ = cheerio.load(text || '');
    const seen = new Map();
    $('a[href*="/shop/c/c"]').each((_, a) => {
      const id = ($(a).attr('href') || '').match(/\/shop\/c\/c(\d+)\/?$/)?.[1];
      const name = $(a).text().replace(/\s+/g, ' ').trim();
      if (id && name && !seen.has(id)) seen.set(id, { id, name, raw: jpCategory(name) });
    });
    return [...seen.values()].filter((c) => c.raw);
  } catch {
    return [];
  }
}

// 목록 HTML 한 쪽 → 상품들 (시험에서도 쓰려고 따로 뺌)
export function parseEcbeingList(html, base) {
  const $ = cheerio.load(html);
  const out = [];
  $('.js-enhanced-ecommerce-item').each((_, el) => {
    const box = $(el);
    const link = box.find('a.js-enhanced-ecommerce-goods-name').first();
    const href = link.attr('href') || box.find('a[href*="/shop/g/"]').first().attr('href');
    if (!href) return;
    const url = new URL(href, base).href.replace(/\/$/, '');
    const code = url.match(/\/shop\/g\/g([^/?#]+)/)?.[1];
    const title = (link.text() || box.find('img').first().attr('alt') || '').replace(/\s+/g, ' ').trim();
    const priceText = box.find('.js-enhanced-ecommerce-goods-price').first().text();
    const yen = parseInt(priceText.replace(/[^\d]/g, ''), 10);
    const images = [];
    const main = box.find('img[data-src]').first().attr('data-src') || box.find('img').first().attr('src');
    if (main && !/lazyloading/.test(main)) images.push(new URL(main, base).href);
    box.find('[data-img-src]').each((_, c) => {
      const src = $(c).attr('data-img-src');
      if (src && !images.includes(src)) images.push(new URL(src, base).href);
    });
    // 색상 칩의 사진 이름(CLB00637_YELLOW_S.jpg)에서 색 이름을 읽는다
    const colors = [...new Set(images.map((s) => s.match(/_([A-Z][A-Z0-9-]*)_[A-Z]\.(?:jpe?g|png|webp)$/i)?.[1]).filter(Boolean))];
    if (!title || !code) return;
    // 목록 사진은 작은 판(…_S.jpg, 336px). 끝의 _S 를 떼면 큰 판(500px)이 있다
    const big = images.map((s) => s.replace(/_S(\.(?:jpe?g|png|webp))$/i, '$1'));
    out.push({ code, url, title, yen: Number.isFinite(yen) ? yen : null, images: big, colors });
  });
  return out;
}

export async function collectEcbeing(source, { limit = Infinity } = {}) {
  const base = source.shopUrl.replace(/\/$/, '');
  const currency = source.currency || 'JPY';
  const { rate, source: rateSrc } = await krwRate(currency);
  console.log(`  [${source.id}] 통화 ${currency} → 원화(환율 ${rate} · ${rateSrc})`);

  const items = [];
  const seen = new Set();
  // 한 목록(분류 하나 또는 전체)을 빈 쪽이 나올 때까지 읽어 items 에 더한다
  async function readList(query, raw) {
    for (let p = 1; p <= MAX_PAGES && items.length < limit; p++) {
      const url = `${base}/shop/goods/goodslightningsearchajax.aspx?${query}&ps=${PAGE_SIZE}&p=${p}`;
      const { text } = await fetchText(url);
      const list = text ? parseEcbeingList(text, base) : [];
      if (!list.length) break;
      let fresh = 0;
      for (const it of list) {
        if (seen.has(it.code)) continue;
        seen.add(it.code);
        fresh++;
        items.push({
          external_id: it.code,
          url: it.url,
          title: it.title,
          brand: source.name,
          price: toKrw(it.yen, rate),
          currency: 'KRW',
          images: it.images,
          in_stock: true,
          raw_category: raw,
          sizes: null,
          description: it.colors.length ? `color: ${it.colors.join(', ')}` : null,
        });
      }
      await sleep(1500);
      if (!fresh && p > 1) break; // 같은 쪽이 되풀이되면 멈춤
      if (list.length < PAGE_SIZE) break; // 마지막 쪽
    }
  }

  const cats = await readCategories(base);
  console.log(`  [${source.id}] 분류 ${cats.length}개: ${cats.map((c) => c.name).join(', ')}`);
  for (const c of cats) await readList(`type=category&LScategory=${c.id}&pagename=c${c.id}`, c.raw);
  await readList('type=all&pagename=all', null); // 어느 분류에도 없는 상품
  return items.slice(0, limit === Infinity ? undefined : limit);
}
