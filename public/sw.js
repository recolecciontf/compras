const CACHE_NAME = "compras-de-campo-offline-v6-clean-2026-08-18";
const CACHE_PREFIX = "compras-de-campo-";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./app-config.json",
  "./tonifruit-logo.png",
  "./app-icon-192.png",
  "./app-icon-512.png",
  "./vendor/reamkit-1.27.0.js",
  "./vendor/tesseract-7.0.0.min.js",
  "./vendor/tesseract-worker-7.0.0.min.js",
  "./contract-templates/tonifruit-uva.docx",
];

function scopedUrl(path) {
  return new URL(path, self.registration.scope).toString();
}

async function cacheResponse(cache, request) {
  try {
    const response = await fetch(request, { cache: "reload" });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return null;
  }
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(APP_SHELL.map((path) => cacheResponse(cache, scopedUrl(path))));

  const indexUrl = scopedUrl("./index.html");
  const indexResponse = (await cache.match(indexUrl)) || (await cacheResponse(cache, indexUrl));
  if (!indexResponse) return;
  const html = await indexResponse.clone().text();
  const linkedAssets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => new URL(match[1], indexUrl))
    .filter((url) => url.origin === self.location.origin)
    .map((url) => url.toString());
  await Promise.all([...new Set(linkedAssets)].map((url) => cacheResponse(cache, url)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME && !key.includes("contract-templates")).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CACHE_APP_SHELL") event.waitUntil(cacheAppShell());
});

function sameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request))
      || (await cache.match(scopedUrl("./index.html")))
      || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !sameOrigin(request)) return;
  const url = new URL(request.url);
  if (url.pathname.includes("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (/\.(?:js|mjs|css|png|jpg|jpeg|webp|woff2?|docx|json|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});
