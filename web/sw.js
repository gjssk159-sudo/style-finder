const CACHE = "style-finder-v2";

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

  // 앱 코드(HTML/JS/JSON)는 캐시 우선이면 배포해도 "한 번 늦게" 반영되는 게 계속 헷갈림을
  // 일으켰음(실측: Vercel 캐시까지 고쳤는데도 폰에서 계속 옛 코드가 뜸) -> 네트워크 우선으로
  // 바꿔서 항상 최신을 받고, 오프라인일 때만 캐시로 대체. 아이콘 등 안 바뀌는 에셋만 캐시 우선 유지.
  const isAppCode = /\.(html|js|json)$/i.test(url.pathname) || url.pathname === '/';
  if (sameOrigin && isAppCode) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => caches.open(CACHE).then((c) => c.match(e.request)).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

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
