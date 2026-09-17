// 동시성 제한 풀: items를 최대 concurrency개씩 동시에 worker로 처리.
// 순차 처리 + 요청당 sleep 대신, "동시에 N개까지만"으로 자연스럽게 서버 부하를 제한하면서
// 훨씬 빠르게 끝냄 (브랜드 100개 등록 시나리오에서 필수).
export async function mapPool(items, worker, concurrency = 6) {
  const results = new Array(items.length);
  let i = 0;
  async function runner() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (err) {
        results[idx] = undefined;
        console.warn(`  ! [${idx}] ${err.message}`);
      }
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, runner));
  return results;
}
