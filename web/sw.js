const CACHE = "style-finder-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);

  // 실시간 데이터(Supabase)는 항상 네트워크로 — 캐시하면 검색 결과가 안 바뀜.
  if (url.hostname.includes("supabase")) return;

  const sameOrigin = url.origin === self.location.origin;

  // 앱 코드/에셋(HTML/JS/JSON/아이콘)은 캐시가 있으면 즉시 그걸로 뜨고,
  // 백그라운드로 최신본을 받아 다음 실행부터 반영 (매번 서버 응답 기다리는 지연 제거).
  if (sameOrigin) {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(e.request);
        const network = fetch(e.request)
          .then((res) => {
            if (res && res.status === 200) cache.put(e.request, res.clone());
            return res;
          })
          .catch(() => cached || caches.match("./index.html"));
        return cached || network;
      })
    );
    return;
  }

  // 외부(폰트 등)는 stale-while-revalidate.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
