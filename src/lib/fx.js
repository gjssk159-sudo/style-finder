// 해외 쇼핑몰 가격을 원화로 바꾸는 환율.
// 수집할 때마다 그날 환율(유럽중앙은행 기준, frankfurter.dev — 무료·가입 없음)을 한 번 받아 쓰고,
// 받지 못하면 아래 대략치로 바꾼다. 표시용 근사값이지 실제 결제 금액은 아니다.

import { fetchJson } from './http.js';

// 환율을 못 받았을 때 쓰는 대략치(1 외화 = 원). 2026-11-18 유럽중앙은행 기준(TWD는 그 목록에 없어 대략)
export const FALLBACK_KRW_RATE = { USD: 1332, EUR: 1461, JPY: 8.36, GBP: 1754, CAD: 931, AUD: 897, CNY: 200, TWD: 44, HKD: 170 };

const cache = new Map();

export async function krwRate(currency) {
  const cur = String(currency || 'KRW').toUpperCase();
  if (cur === 'KRW') return { rate: 1, source: 'KRW' };
  if (cache.has(cur)) return cache.get(cur);
  let result = null;
  try {
    const data = await fetchJson(`https://api.frankfurter.dev/v1/latest?from=${cur}&to=KRW`, { retries: 1, timeout: 10000 });
    const r = Number(data?.rates?.KRW);
    if (r > 0) result = { rate: r, source: `frankfurter ${data.date}` };
  } catch {
    /* 아래 대략치로 */
  }
  if (!result && FALLBACK_KRW_RATE[cur]) result = { rate: FALLBACK_KRW_RATE[cur], source: '대략치' };
  if (!result) result = { rate: null, source: '모르는 통화' };
  cache.set(cur, result);
  return result;
}

// 외화 금액 → 원(10원 단위 반올림). 환율을 모르면 null(가격 없음으로 두어 엉뚱한 숫자를 보이지 않게).
export function toKrw(amount, rate) {
  if (amount == null || !Number.isFinite(amount) || !rate) return null;
  return Math.round((amount * rate) / 10) * 10;
}
