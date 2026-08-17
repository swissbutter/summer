const CACHE_NAME = 'summer-editor-v1.2';

// 캐시할 핵심 파일 목록
const CORE_ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './sagak_icon.png',
    './src/styles.css',
    './src/data.js',
    './src/google-drive.js',
    './src/sagak-crypto.js',
    './src/app.compiled.js',
];

// 설치: 핵심 파일 캐시
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(CORE_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

// 활성화: 구버전 캐시 삭제
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

// 요청 처리: 네트워크 우선 및 캐시 폴백, CDN 캐싱
self.addEventListener('fetch', (e) => {
    const url = e.request.url;

    // GET 요청만 캐싱
    if (e.request.method !== 'GET') return;

    // 외부 CDN 리소스 (React, Tailwind, Dagre, CryptoJS, Fonts 등)
    if (!url.startsWith(self.location.origin)) {
        e.respondWith(
            caches.match(e.request).then((cached) => {
                const networkFetch = fetch(e.request).then((response) => {
                    if (response && response.status === 200) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
                    }
                    return response;
                }).catch(() => cached);

                // 이미 캐시에 있으면 즉시 반환(0초 로딩) + 백그라운드 갱신 (Stale-While-Revalidate)
                return cached || networkFetch;
            })
        );
        return;
    }

    // 로컬 파일 (app.compiled.js, styles.css 등)은 항상 네트워크 최신 우선 + 실패시 캐시
    e.respondWith(
        fetch(e.request).then((response) => {
            if (response && response.status === 200 && response.type === 'basic') {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
            }
            return response;
        }).catch(() => caches.match(e.request))
    );
});
