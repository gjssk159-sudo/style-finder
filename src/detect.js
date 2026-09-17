// 브랜드 URL 자동 판별기: 사용자가 쇼핑몰 URL만 넣으면 플랫폼을 자동으로 찔러보고
// 바로 수집 가능한지 판정한다. (지금까지 8개 브랜드를 손으로 조사하던 과정의 자동화 버전)
//
//   node src/detect.js https://xxxx.com
//
// 반환 형태는 brands.json의 source 항목과 호환됨 -> 성공하면 그대로 등록 가능.

import { pathToFileURL } from 'node:url';
import { fetchText, fetchJson } from './lib/http.js';

export async function detectPlatform(rawUrl) {
  const shopUrl = normalizeUrl(rawUrl);
  if (!shopUrl) return { status: 'error', reason: 'invalid_url', input: rawUrl };

  // 1) Shopify: /products.json 이 유효한 JSON을 주는지
  const shopify = await tryShopify(shopUrl);
  if (shopify) return shopify;

  // 2) Cafe24: sitemap.xml 또는 페이지 소스의 cafe24 시그니처
  const cafe24 = await tryCafe24(shopUrl);
  if (cafe24) return cafe24;

  // 3) 그 외 (아임웹/식스샵/자체제작): 아직 어댑터 없음 -> 검토 대기열
  const home = await fetchText(shopUrl, { retries: 1 }).catch(() => null);
  const hint = home?.text ? sniffUnknownPlatform(home.text) : null;

  return {
    status: 'needs_review',
    shopUrl,
    platform: hint || 'unknown',
    reason: hint
      ? `${hint} 감지됨 — 아직 전용 어댑터 없음`
      : '알려진 플랫폼 시그니처를 못 찾음 (자체 제작 또는 새 플랫폼)',
  };
}

async function tryShopify(shopUrl) {
  try {
    const data = await fetchJson(`${shopUrl}/products.json?limit=1`, { retries: 1, timeout: 8000 });
    if (data?.products) {
      return {
        status: 'ready',
        shopUrl,
        platform: 'shopify',
        discovery: { method: 'shopify_products_json', path: '/products.json?limit=250' },
        sampleProductCount: data.products.length,
      };
    }
  } catch {
    /* Shopify 아님 */
  }
  return null;
}

async function tryCafe24(shopUrl) {
  // sitemap 먼저 (더 빠르고 확실함)
  try {
    const { text, status } = await fetchText(`${shopUrl}/sitemap.xml`, { retries: 1, timeout: 8000 });
    if (status !== 404 && text && /<url|<sitemapindex/i.test(text)) {
      const looksLikeShop = /\/product\//i.test(text);
      if (looksLikeShop) {
        return {
          status: 'ready',
          shopUrl,
          platform: 'cafe24',
          discovery: { method: 'cafe24_sitemap', path: '/sitemap.xml' },
        };
      }
    }
  } catch {
    /* sitemap 없음 */
  }

  // sitemap 없으면 홈페이지에서 cafe24 시그니처 확인 (카테고리 크롤링 폴백 대상)
  try {
    const { text } = await fetchText(shopUrl, { retries: 1, timeout: 8000 });
    if (text && /cafe24\.(poxo|co)|echosting\.cafe24|xans-/i.test(text)) {
      return {
        status: 'ready',
        shopUrl,
        platform: 'cafe24',
        discovery: { method: 'cafe24_categories', note: 'sitemap.xml 없음 → 카테고리 목록 크롤링 폴백 사용' },
      };
    }
  } catch {
    /* 접속 실패 */
  }
  return null;
}

function sniffUnknownPlatform(html) {
  if (/imweb\.me|_imwebApp|imweb_editor/i.test(html)) return 'imweb';
  if (/sixshop\.com|__sixshop/i.test(html)) return 'sixshop';
  if (/smartstore\.naver\.com/i.test(html)) return 'naver_smartstore';
  if (/godo\.co\.kr|godomall/i.test(html)) return 'godomall';
  return null;
}

function normalizeUrl(u) {
  try {
    const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    const url = new URL(withProto);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

// CLI로 직접 실행했을 때
// (Windows에서 file://${process.argv[1]} 식 문자열 비교는 경로 인코딩이 달라 항상 실패하므로
//  pathToFileURL로 정규화해서 비교)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2];
  if (!url) {
    console.error('사용법: node src/detect.js <쇼핑몰 URL>');
    process.exit(1);
  }
  const result = await detectPlatform(url);
  console.log(JSON.stringify(result, null, 2));
}
