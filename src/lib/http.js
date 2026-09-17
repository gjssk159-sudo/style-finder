// 공용 HTTP 유틸: UA 지정, 재시도, 요청 간 딜레이(예의상)

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 style-finder-bot/0.1';

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchText(url, { retries = 3, timeout = 20000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      });
      if (res.status === 404 || res.status === 410) return { status: res.status, text: null };
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return { status: res.status, text: await res.text() };
    } catch (err) {
      lastErr = err;
      if (attempt === retries) break;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts) {
  const { text, status } = await fetchText(url, opts);
  if (status === 404 || status === 410 || !text) return null;
  return JSON.parse(text);
}
