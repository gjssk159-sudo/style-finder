// 브랜드 등록 즉시 처리용 Edge Function.
// 예전엔 등록 -> pending 상태로만 저장 -> 매일 새벽 정기 수집(cron)이 판별+수집까지 한 번에
// 처리해서, 등록 시점에 따라 최대 24시간 가까이 기다려야 검색에 나왔음. 이 함수는:
//   1) 입력받은 쇼핑몰 URL로 플랫폼을 즉시 판별
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

function parseInstagramHandle(input: string): string | null {
  let s = (input || '').trim();
  const m = s.match(/instagram\.com\/(?:_u\/)?([A-Za-z0-9._]{1,30})/i);
  if (m) s = m[1];
  s = s.replace(/^@/, '').replace(/[/?#].*$/, '');
  return /^[A-Za-z0-9._]{2,30}$/.test(s) ? s.toLowerCase() : null;
}

function candidateHosts(handle: string): string[] {
  const bases = new Set<string>();
  const squash = (x: string) => x.replace(/[._-]+/g, '');
  const strip = (x: string) => x.replace(/[._-]?(official|offical|kr|korea|seoul|store|shop|studios?|clothing|archive|brand|world|hub|online|mall|wear|project)$/i, '').replace(/^(official|the)[._-]?/i, '');
  for (const b of [handle, squash(handle), handle.replace(/[._]+/g, '-')]) {
    bases.add(b);
    const s = strip(b);
    if (s.length >= 3) { bases.add(s); bases.add(squash(s)); }
  }
  const tlds = ['com', 'co.kr', 'kr', 'net', 'shop', 'store', 'link', 'co'];
  const hosts: string[] = [];
  // 아이디 자체가 도메인 모양(예: aieul.co, 17end.kr)이면 그걸 그대로 먼저 시도
  if (/^[a-z0-9-]+(.[a-z0-9-]+)*.(com|co.kr|kr|net|co|shop|store|link)$/.test(handle)) hosts.push(handle, `www.${handle}`);
  // 아이디 끝이 도메인 끝말인 경우(예: buttonynet → buttony.net)
  const tm = handle.replace(/[._-]+/g, '').match(/^([a-z0-9]{3,})(net|kr|co|com)$/);
  if (tm) { hosts.push(`${tm[1]}.${tm[2]}`, `www.${tm[1]}.${tm[2]}`); }
  for (const b of bases) {
    if (!/^[a-z0-9-]+$/.test(b) || b.startsWith('-') || b.endsWith('-')) continue; // 도메인에 쓸 수 없는 문자(_)가 있으면 제외
    for (const t of tlds) { hosts.push(`${b}.${t}`, `www.${b}.${t}`); }
  }
  return [...new Set(hosts)].slice(0, 80);
}

// 후보 도메인을 열어서, 페이지에 이 인스타그램 계정으로 가는 링크가 있는 곳만 공식 홈페이지로 인정
async function resolveInstagramSite(handle: string): Promise<{ url: string; host: string } | null> {
  const esc = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`instagram\\.com/(?:_u/)?${esc}(?![A-Za-z0-9._])`, 'i');
  const hosts = candidateHosts(handle);
  const found: { idx: number; origin: string }[] = [];
  const deadline = Date.now() + 25000;
  let next = 0;
  async function worker() {
    while (next < hosts.length && Date.now() < deadline) {
      const idx = next++;
      try {
        const res = await fetch(`https://${hosts[idx]}/`, {
          headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8' },
          signal: AbortSignal.timeout(5000),
          redirect: 'follow',
        });
        if (!res.ok) continue;
        const html = (await res.text()).slice(0, 500000);
        if (re.test(html)) found.push({ idx, origin: new URL(res.url).origin });
      } catch { /* 열리지 않는 도메인은 건너뜀 */ }
    }
  }
  await Promise.all(Array.from({ length: 10 }, worker));
  if (!found.length) return null;
  found.sort((x, y) => x.idx - y.idx);
  return { url: found[0].origin, host: new URL(found[0].origin).host };
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
  let via: { handle: string; url: string } | null = null;
  if (!targetUrl && body.instagram) {
    const handle = parseInstagramHandle(body.instagram);
    if (!handle) {
      return Response.json({ ok: false, reason: 'invalid_handle', message: '인스타그램 아이디 형식이 올바르지 않아요.' }, { headers: cors });
    }
    const site = await resolveInstagramSite(handle);
    if (!site) {
      return Response.json(
        { ok: false, reason: 'site_not_found', message: `@${handle} 계정의 공식 홈페이지를 찾지 못했어요. 쇼핑몰 주소(URL)로 등록해주세요.` },
        { headers: cors },
      );
    }
    targetUrl = site.url;
    via = { handle, url: site.url };
  }
  if (!targetUrl) {
    return Response.json(
      { ok: false, reason: 'no_url', message: '쇼핑몰 URL을 입력해주세요.' },
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
      { ok: true, id: existing.id, name: existing.name, status: existing.status, platform: existing.platform, dispatched: false, alreadyExisted: true, via },
      { headers: cors },
    );
  }

  const result = await detectPlatform(normalized);
  if (result.status === 'error' || !result.shopUrl) {
    return Response.json({ ok: false, reason: 'invalid_url', message: 'URL 형식이 올바르지 않아요.' }, { headers: cors });
  }

  // 브랜드 표시 이름은 클라이언트 입력을 받지 않고 URL에서 자동으로 뽑는다 — 자유 입력을
  // 허용하면 장난스럽거나 부적절한 이름으로 등록하는 걸 막을 수 없어서.
  const displayName = id.replace(/-/g, ' ').toUpperCase();

  // 이 서버(Supabase Edge) IP가 쇼핑몰에 막혀서 판별을 못 한 경우일 수 있으니, 단정하지 않고
  // pending으로 두고 GitHub Actions(다른 IP)에서 다시 판별+수집하게 넘긴다.
  const retryOnRunner = result.status === 'needs_review' && result.platform === 'unknown';

  const { error: insertErr } = await sb.from('brands').insert({
    id,
    name: displayName,
    name_en: displayName,
    type: 'brand',
    shop_url: result.shopUrl,
    platform: result.platform,
    discovery: result.discovery || {},
    status: retryOnRunner ? 'pending' : result.status,
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
  if (result.status === 'ready' || retryOnRunner) {
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
    { ok: true, id, name: displayName, status: retryOnRunner ? 'pending' : result.status, platform: result.platform, dispatched, alreadyExisted: false, via },
    { headers: cors },
  );
});
