// 브랜드 등록 때 "쇼핑몰인지" 가려내는 기준 시험(#21). 인터넷에 접속하지 않고 짧은 예시 HTML로 본다.
// 기준: 처음 보는 쇼핑몰 프로그램이면 첫 화면에 쇼핑몰 흔적(상품 링크·가격·장바구니/구매·상품 정보)이 2가지 이상이어야 등록.
// 실행: node scripts/test-shop-signals.mjs   (npm run test:shop-signals)
import { shopSignals, isAppShell } from '../supabase/functions/register-brand/signals.ts';

const CASES = [
  ['쇼핑몰(상품 링크+가격+장바구니)', '<a href="/product/wool-coat/12/">Wool coat</a><span>128,000원</span><a href="/order/basket.html">장바구니</a>', (n) => n >= 2],
  ['해외 쇼핑몰(products 링크+₩ 가격+add to cart)', '<a href="/products/tee">Tee</a><span class="price">₩ 59,000</span><button>Add to cart</button>', (n) => n >= 2],
  ['상품 정보(JSON-LD)+가격만 있는 쇼핑몰', '<script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":"59000"}}</script>', (n) => n >= 2],
  ['블로그 글', '<h1>오늘의 일기</h1><p>날씨가 좋아서 산책을 했다.</p><a href="/post/123">다음 글</a>', (n) => n < 2],
  ['회사 소개 사이트', '<h1>About us</h1><p>We build software.</p><a href="/careers">Careers</a>', (n) => n < 2],
  ['빈 페이지', '<html><body></body></html>', (n) => n === 0],
];
// 빈 껍데기(나중에 그리는 앱) 판단: 껍데기면 '쇼핑몰 아님'으로 거절하지 않는다
const SHELL = [
  ['자체 제작 앱 쇼핑몰(thisisneverthat 첫 화면과 같은 모양)', '<!doctype html><html lang="ko"><head><title>thisisneverthat</title><script type="module" crossorigin src="/assets/index-D8UT7we3.js"></script></head><body><div id="root"></div></body></html>', true],
  ['Next.js 앱 껍데기', '<html><body><div id="__next"></div><script src="/_next/static/chunks/main-abc.js"></script></body></html>', true],
  ['글이 많은 블로그(스크립트가 있어도 껍데기 아님)', '<html><body><div id="app"><h1>오늘의 일기</h1><p>' + '날씨가 좋아서 산책을 했다. '.repeat(20) + '</p></div><script type="module" src="/main.js"></script></body></html>', false],
  ['스크립트 없는 빈 페이지(껍데기 아님 → 쇼핑몰 아님으로 거절)', '<html><body></body></html>', false],
];
let fail = 0;
for (const [name, html, want] of SHELL) { const got = isAppShell(html); const pass = got === want; if (!pass) fail++; console.log(`${pass ? '통과' : '실패'} ${name} — 껍데기 ${got}`); }
for (const [name, html, ok] of CASES) {
  const n = shopSignals(html);
  const pass = ok(n);
  if (!pass) fail++;
  console.log(`${pass ? '통과' : '실패'} ${name} — 흔적 ${n}개`);
}
console.log(fail ? `실패 ${fail}건 / ${CASES.length + SHELL.length}` : `모두 통과 ${CASES.length + SHELL.length}건`);
process.exitCode = fail ? 1 : 0;
