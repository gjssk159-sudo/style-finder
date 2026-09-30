// 브랜드 등록 즉시 처리용 Edge Function.
// 예전엔 등록 -> pending 상태로만 저장 -> 매일 새벽 정기 수집(cron)이 판별+수집까지 한 번에
// 처리해서, 등록 시점에 따라 최대 24시간 가까이 기다려야 검색에 나왔음. 이 함수는:
//   1) URL(또는 인스타 핸들로 best-effort 찾은 URL)로 플랫폼을 즉시 판별
//   2) brands 테이블에 바로 반영 (ready/needs_review)
//   3) ready면 이 브랜드 하나만 수집하는 GitHub Actions(collect-single.yml)를 바로 트리거
// 를 몇 초~몇십 초 안에 끝내서, 실제 상품은 그 GitHub Actions가 끝나는 1~2분 뒤에 반영된다.
//
// 프론트엔드(브라우저)는 CORS 제약 때문에 대상 쇼핑몰에 직접 fetch를 못 하므로
// (다른 도메인이라 브라우저가 막음), 서버 쪽인 여기서 대신 판별한다.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 style-finder-bot/0.1';

const GITHUB_REPO = 'gjssk159-sudo/style-finder';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url: string, { retries = 1, timeout = 8000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' },
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      });
      if (res.status === 404 || res.status === 410) return { status: res.status, text: null as string | null };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, text: await res.text() };
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      await sleep(500 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function fetchJson(url: string, opts?: { retries?: number; timeout?: number }) {
  const { text, status } = await fetchText(url, opts);
  if (status === 404 || status === 410 || !text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeUrl(u: string): string | null {
  try {
    const withProto = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    const url = new URL(withProto);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function slugify(hostname: string) {
  return hostname
    .replace(/^www\./, '')
    .replace(/\.(com|co\.kr|kr|link|net|store|shop)$/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
}

function sniffUnknownPlatform(html: string): string | null {
  if (/imweb\.me|_imwebApp|imweb_editor/i.test(html)) return 'imweb';
  if (/sixshop\.com|__sixshop/i.test(html)) return 'sixshop';
  if (/smartstore\.naver\.com/i.test(html)) return 'naver_smartstore';
  if (/godo\.co\.kr|godomall/i.test(html)) return 'godomall';
  return null;
}

type DetectResult = {
  status: 'ready' | 'needs_review' | 'error';
  shopUrl?: string;
  platform?: string;
  discovery?: Record<string, unknown>;
  reason?: string;
};

async function tryShopify(shopUrl: string): Promise<DetectResult | null> {
  try {
    const data = await fetchJson(`${shopUrl}/products.json?limit=1`, { retries: 1, timeout: 8000 });
    if (data?.products) {
      return {
        status: 'ready',
        shopUrl,
        platform: 'shopify',
        discovery: { method: 'shopify_products_json', path: '/products.json?limit=250' },
      };
    }
  } catch {
    /* Shopify 아님 */
  }
  return null;
}

async function tryCafe24(shopUrl: string): Promise<DetectResult | null> {
  try {
    const { text, status } = await fetchText(`${shopUrl}/sitemap.xml`, { retries: 1, timeout: 8000 });
    if (status !== 404 && text && /<url|<sitemapindex/i.test(text) && /\/product\//i.test(text)) {
      return { status: 'ready', shopUrl, platform: 'cafe24', discovery: { method: 'cafe24_sitemap', path: '/sitemap.xml' } };
    }
  } catch {
    /* sitemap 없음 */
  }
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

async function detectPlatform(rawUrl: string): Promise<DetectResult> {
  const shopUrl = normalizeUrl(rawUrl);
  if (!shopUrl) return { status: 'error', reason: 'invalid_url' };

  const shopify = await tryShopify(shopUrl);
  if (shopify) return shopify;

  const cafe24 = await tryCafe24(shopUrl);
  if (cafe24) return cafe24;

  const home = await fetchText(shopUrl, { retries: 1 }).catch(() => null);
  const hint = home?.text ? sniffUnknownPlatform(home.text) : null;

  return {
    status: 'needs_review',
    shopUrl,
    platform: hint || 'unknown',
    reason: hint ? `${hint} 감지됨 — 아직 전용 어댑터 없음` : '알려진 플랫폼 시그니처를 못 찾음 (자체 제작 또는 새 플랫폼)',
  };
}

// 인스타그램 공개 프로필 페이지에서 바이오의 외부 링크를 best-effort로 추출.
// 정식 API가 아니라 페이지 안에 심어진 값을 정규식으로 긁는 방식이라 인스타 쪽이
// 마크업을 바꾸면 깨질 수 있음 — 실패하면 그냥 null 반환하고 프론트에서 URL을 다시 요청함.
async function resolveInstagramUrl(handle: string): Promise<string | null> {
  const clean = handle.replace(/^@/, '').trim();
  if (!clean) return null;
  try {
    const { text } = await fetchText(`https://www.instagram.com/${encodeURIComponent(clean)}/`, {
      retries: 1,
      timeout: 6000,
    });
    if (!text) return null;
    const m =
      text.match(/"external_url":"([^"]+)"/) ||
      text.match(/<meta property="al:ios:url" content="[^"]*url=([^"&]+)/);
    if (m) return decodeURIComponent(m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/'));
  } catch {
    /* 인스타 접근 실패 — 프론트에서 URL 직접 요청하도록 함 */
  }
  return null;
}

async function dispatchCollectWorkflow(brandId: string, token: string) {
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/collect-single.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main', inputs: { brand_id: brandId } }),
  });
  return res.ok;
}

Deno.serve(async (req: Request) => {
  // supabase-js의 functions.invoke()는 apikey/x-client-info 헤더도 같이 보내는데,
  // 여기 허용 목록에 없으면 브라우저가 CORS 위반으로 보고 응답 자체를 막아버림
  // (curl은 CORS를 안 따지니 정상 응답이 와서 처음엔 원인을 못 봤음 — 실측 확인됨).
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  let body: { url?: string; instagram?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, reason: 'bad_request', message: '요청 형식이 올바르지 않아요.' }, { status: 400, headers: cors });
  }

  // added_by는 body가 주장하는 값이 아니라, 이 요청의 JWT로 실제 인증된 사용자만 신뢰한다
  // (서비스 롤 키를 쓰는 함수라 RLS를 안 거치므로, 여기서 직접 확인 안 하면 아무나 다른
  // 사람 명의로 브랜드를 등록시킬 수 있음).
  const authClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
  });
  const { data: authData } = await authClient.auth.getUser();
  const userId = authData?.user?.id || null;
  if (!userId) {
    return Response.json({ ok: false, reason: 'unauthorized', message: '로그인이 필요해요.' }, { status: 401, headers: cors });
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let targetUrl = (body.url || '').trim();
  let resolvedFromInstagram = false;
  if (!targetUrl && body.instagram) {
    const found = await resolveInstagramUrl(body.instagram);
    if (found) {
      targetUrl = found;
      resolvedFromInstagram = true;
    }
  }
  if (!targetUrl) {
    return Response.json(
      {
        ok: false,
        reason: 'no_url',
        message: body.instagram
          ? '인스타 프로필에서 쇼핑몰 링크를 못 찾았어요. 쇼핑몰 URL을 직접 입력해주세요.'
          : 'URL 또는 인스타 아이디 중 하나는 입력해주세요.',
      },
      { headers: cors },
    );
  }

  const normalized = normalizeUrl(targetUrl);
  if (!normalized) {
    return Response.json({ ok: false, reason: 'invalid_url', message: 'URL 형식이 올바르지 않아요.' }, { headers: cors });
  }
  const id = slugify(new URL(normalized).hostname);

  // 이미 등록된 브랜드면 재판별하지 않는다 — 예전에 자동판별 오류를 수동으로 고쳐둔 브랜드가
  // (실측: saros — sitemap이 엉뚱한 회사 상품을 가리켜서 discovery.method를 수동 지정해둠)
  // 누가 같은 URL로 다시 "등록"하는 순간 그 수동 설정이 자동판별 결과로 덮어써지는 사고를
  // 막기 위함. 이미 있으면 그냥 그 정보 그대로 알려주고 내 폴더 추가만 프론트에서 진행.
  const { data: existing } = await sb.from('brands').select('id, name, status, platform').eq('id', id).maybeSingle();
  if (existing) {
    return Response.json(
      { ok: true, id: existing.id, name: existing.name, status: existing.status, platform: existing.platform, resolvedFromInstagram, dispatched: false, alreadyExisted: true },
      { headers: cors },
    );
  }

  const result = await detectPlatform(normalized);
  if (result.status === 'error' || !result.shopUrl) {
    return Response.json({ ok: false, reason: 'invalid_url', message: 'URL 형식이 올바르지 않아요.' }, { headers: cors });
  }

  // 브랜드 표시 이름은 클라이언트 입력을 받지 않고 URL에서 자동으로 뽑는다 — 자유 입력을
  // 허용하면 장난스럽거나 부적절한 이름으로 등록하는 걸 막을 수 없어서.
  const displayName = id;

  const { error: insertErr } = await sb.from('brands').insert({
    id,
    name: displayName,
    name_en: displayName,
    type: 'brand',
    instagram: body.instagram || null,
    shop_url: result.shopUrl,
    platform: result.platform,
    discovery: result.discovery || {},
    status: result.status,
    notes:
      result.status === 'ready'
        ? `자동 판별됨 (${(result.discovery as any)?.method}).`
        : result.reason || '판별 실패',
    added_by: userId,
  });
  if (insertErr) {
    return Response.json({ ok: false, reason: 'db_error', message: insertErr.message }, { headers: cors });
  }

  let dispatched = false;
  if (result.status === 'ready') {
    const ghToken = Deno.env.get('GH_DISPATCH_TOKEN');
    if (ghToken) {
      try {
        dispatched = await dispatchCollectWorkflow(id, ghToken);
      } catch {
        dispatched = false;
      }
    }
  }

  return Response.json(
    { ok: true, id, name: displayName, status: result.status, platform: result.platform, resolvedFromInstagram, dispatched, alreadyExisted: false },
    { headers: cors },
  );
});
