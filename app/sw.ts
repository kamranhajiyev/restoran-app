import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { CacheFirst, NetworkFirst, StaleWhileRevalidate, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      matcher: /^\/_next\/static\/.*/i,
      handler: new CacheFirst({ cacheName: "nextjs-static" }),
    },
    {
      matcher: /^\/api\/public-menu(\?.*)?$/,
      handler: new StaleWhileRevalidate({ cacheName: "api-public-menu" }),
    },
    {
      matcher: /^\/api\/public-categories(\?.*)?$/,
      handler: new StaleWhileRevalidate({ cacheName: "api-public-categories" }),
    },
    {
      matcher: /^\/api\/public-tables(\?.*)?$/,
      handler: new StaleWhileRevalidate({ cacheName: "api-public-tables" }),
    },
    {
      matcher: /^\/api\/public-staff(\?.*)?$/,
      handler: new StaleWhileRevalidate({ cacheName: "api-public-staff" }),
    },
    {
      matcher: /^\/api\/public-shift(\?.*)?$/,
      handler: new NetworkFirst({ cacheName: "api-public-shift" }),
    },
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({ cacheName: "pages" }),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();
