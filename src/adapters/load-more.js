// "더 보기" 화면 어댑터(#21): 겉은 자체 제작 앱이라 첫 HTML이 빈 껍데기이고, 상품 목록 화면 맨 아래 "Load More" 버튼을
// 눌러야 다음 상품이 나오는 쇼핑몰. 일반 방문자처럼 브라우저로 목록 화면을 열고, 팝업을 닫고, 버튼을 끝까지 누른 뒤 카드를 읽는다.
// 예: thisisneverthat.com (/collections/all, "Load More Products (25 of 242)")
//
// - 등록 일시는 화면에 없다 → listed_at 없음. 최신순은 결정 D-16 ③④(브랜드 첫 수집 = 등록일 모름, 이후 새로 발견 = 발견 시각).
// - 설정(선택): brands.discovery.listPath(기본 /collections/all), discovery.loadMore(버튼 글자 정규식, 기본 load more|더 ?보기)
import { renderPage } from '../lib/browser.js';

export async function collectLoadMore(source, { limit = Infinity } = {}) {
  const base = source.shopUrl.replace(/\/$/, '');
  const d = source.discovery || {};
  const listUrl = base + (d.listPath || '/collections/all');
  const loadMore = new RegExp(d.loadMore || 'load more|더\\s?보기', 'i');
  const { page, context } = await renderPage(listUrl, { waitForSelector: 'a[href*="/products/"]', timeout: 45000 });
  try {
    await page.waitForTimeout(1500);
    // 첫 화면 팝업(행사 안내 등) 닫기 — 닫지 않으면 화면이 잠겨 버튼을 못 누른다
    for (const name of ['Close', '닫기', '오늘 하루 보지 않기']) {
      const b = page.getByText(name, { exact: true }).first();
      if (await b.count().catch(() => 0)) await b.click({ timeout: 2000 }).catch(() => {});
    }
    const count = () => page.$$eval('a[href*="/products/"]', (a) => new Set(a.map((x) => (x.getAttribute('href') || '').split('?')[0])).size);
    // 버튼 글자 "(25 of 242)"가 있으면 끝까지 갔는지 그 숫자로 판단한다. 상품이 늦게 뜨면 기다렸다가 다시 누른다(최대 3번).
    const progress = async (btn) => { const m = ((await btn.textContent().catch(() => '')) || '').match(/(\d+)\s*(?:of|\/)\s*(\d+)/i); return m ? { shown: +m[1], total: +m[2] } : null; };
    let last = await count();
    let tries = 0;
    for (let i = 0; i < 300 && last < limit; i++) {
      const btn = page.locator('button, a').filter({ hasText: loadMore }).first();
      if (!(await btn.count())) break; // 버튼이 없어지면 끝
      const pg = await progress(btn);
      if (pg && pg.shown >= pg.total) break;
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ timeout: 8000 }).catch(() => {});
      let grew = false;
      for (let t = 0; t < 40; t++) { await page.waitForTimeout(500); const n = await count(); if (n > last) { last = n; grew = true; break; } }
      if (grew) { tries = 0; continue; }
      if (++tries >= 3) break; // 세 번 눌러도 안 늘면 끝
    }
    // 카드 읽기: 카드 = <article> 하나(색상마다 카드가 따로). 안에 [사진 링크] [이름 링크: 이름 칸·색상 칸 / 사이즈 칸들 / 가격]
    const cards = await page.$$eval('article', (arts) => arts.map((art) => {
      const a = art.querySelector('a[href*="/products/"]');
      if (!a) return null;
      const nameLink = [...art.querySelectorAll('a[href*="/products/"]')].find((x) => !x.querySelector('img')) || a;
      const first = nameLink.querySelector('div'); // 이름·색상
      const name = first ? [...first.children].map((s) => s.textContent.trim()).filter(Boolean).join(' ') : '';
      const sizeBox = first ? first.nextElementSibling : null; // 사이즈 칸들(S M L…)
      const sizes = sizeBox && sizeBox.children.length ? [...sizeBox.children].map((s) => s.textContent.trim()).filter((s) => s && !/out of stock|sold out|품절/i.test(s)) : null;
      const all = (art.innerText || '').replace(/\s+/g, ' ');
      return {
        href: a.getAttribute('href') || '',
        name: name || (nameLink.innerText || '').split('\n')[0].trim(),
        sizes,
        price: (all.match(/₩\s?([\d,]+)/) || [])[1] || null,
        soldOut: /out of stock|sold out|품절/i.test(all),
        imgs: [...art.querySelectorAll('img')].map((i) => i.currentSrc || i.src).filter((s) => /^https?:/.test(s)),
      };
    }).filter(Boolean));
    const seen = new Set();
    const items = [];
    for (const c of cards) {
      const path = c.href.split('?')[0];
      const handle = path.split('/products/')[1];
      const variant = (c.href.match(/variantId=(\d+)/) || [])[1] || null;
      const key = handle + '|' + (variant || '');
      if (!handle || !c.name || seen.has(key)) continue;
      seen.add(key);
      items.push({
        external_id: variant || handle,
        url: base + (variant ? `${path}?variantId=${variant}` : path),
        title: c.name,
        brand: source.name,
        price: c.price ? Number(c.price.replace(/,/g, '')) : null,
        currency: 'KRW',
        images: [...new Set(c.imgs)].slice(0, 6),
        in_stock: !c.soldOut,
        raw_category: null,
        sizes: c.sizes,
        description: null,
      });
    }
    return items.slice(0, limit === Infinity ? undefined : limit);
  } finally {
    await context.close().catch(() => {});
  }
}
