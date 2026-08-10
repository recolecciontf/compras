const LEGACY_CACHE_PREFIX = "compras-de-campo-";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      const legacyKeys = keys.filter((key) => key.startsWith(LEGACY_CACHE_PREFIX));
      await Promise.all(legacyKeys.map((key) => caches.delete(key)));
      await self.clients.claim();

      // Las versiones antiguas podían conservar JavaScript obsoleto. Si esta
      // actualización encuentra uno de esos cachés, recarga una sola vez las
      // ventanas abiertas después de eliminarlo.
      if (legacyKeys.length) {
        const clients = await self.clients.matchAll({ type: "window" });
        await Promise.allSettled(clients.map((client) => client.navigate(client.url)));
      }
    }),
  );
});
