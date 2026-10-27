/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-611da8fa', './E:/قران مشروعي/node_modules/workbox-precaching/precacheAndRoute.mjs', './E:/قران مشروعي/node_modules/workbox-precaching/cleanupOutdatedCaches.mjs', './E:/قران مشروعي/node_modules/workbox-precaching/createHandlerBoundToURL.mjs'], (function (workbox, precacheAndRoute_mjs, cleanupOutdatedCaches_mjs, createHandlerBoundToURL_mjs) { 'use strict';

  importScripts("pwa-events.js");
  self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
      self.skipWaiting();
    }
  });

  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  precacheAndRoute_mjs.precacheAndRoute([{
    "url": "index.html",
    "revision": "0.941tqrcpkhk"
  }], {});
  cleanupOutdatedCaches_mjs.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(createHandlerBoundToURL_mjs.createHandlerBoundToURL("index.html"), {
    allowlist: [/^\/$/],
    denylist: [/\.php$/i, /\/api\//i]
  }));
  workbox.registerRoute(({
    url
  }) => url.pathname.endsWith(".php") || url.pathname.includes("/api/"), new workbox.NetworkOnly(), 'GET');
  workbox.registerRoute(({
    url
  }) => url.origin === self.location.origin && /(?:^|\/)audio\/azkar\/[^/]+\.mp3$/i.test(url.pathname), new workbox.CacheFirst({
    "cacheName": "zad-azkar-audio-v1",
    plugins: [new workbox.CacheableResponsePlugin({
      statuses: [200]
    }), new workbox.ExpirationPlugin({
      maxEntries: 24,
      maxAgeSeconds: 31536000
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/quran\.ksu\.edu\.sa\/png_big\/.+\.png(?:\?.*)?$/i, new workbox.CacheFirst({
    "cacheName": "zad-quran-pages-v1",
    plugins: [new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    }), new workbox.ExpirationPlugin({
      maxEntries: 650,
      maxAgeSeconds: 31536000
    })]
  }), 'GET');
  workbox.registerRoute(({
    url
  }) => /\/data\/tafsir-(?:muyassar|sharawi|wajiz)\.json$/i.test(url.pathname), new workbox.CacheFirst({
    "cacheName": "uns-local-tafsir-v1",
    plugins: [new workbox.CacheableResponsePlugin({
      statuses: [200]
    }), new workbox.ExpirationPlugin({
      maxEntries: 3,
      maxAgeSeconds: 31536000
    })]
  }), 'GET');
  workbox.registerRoute(({
    url
  }) => /\/quran-text\.json$/i.test(url.pathname), new workbox.CacheFirst({
    "cacheName": "zad-quran-text-v1",
    plugins: [new workbox.CacheableResponsePlugin({
      statuses: [200]
    }), new workbox.ExpirationPlugin({
      maxEntries: 4,
      maxAgeSeconds: 2592000
    })]
  }), 'GET');
  workbox.registerRoute(({
    url
  }) => /\/(?:data|duas)\.json$/i.test(url.pathname), new workbox.StaleWhileRevalidate({
    "cacheName": "zad-app-data-v1",
    plugins: [new workbox.CacheableResponsePlugin({
      statuses: [200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/(?:api\.alquran\.cloud\/v1|api\.quran-tafseer\.com\/tafseer|api\.quran\.com\/api\/v4)\/.*$/i, new workbox.NetworkFirst({
    "cacheName": "uns-quran-tafsir-api-v1",
    "networkTimeoutSeconds": 5,
    plugins: [new workbox.CacheableResponsePlugin({
      statuses: [200]
    }), new workbox.ExpirationPlugin({
      maxEntries: 2500,
      maxAgeSeconds: 15552000
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*$/i, new workbox.StaleWhileRevalidate({
    "cacheName": "uns-font-styles-v1",
    plugins: [new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    }), new workbox.ExpirationPlugin({
      maxEntries: 8,
      maxAgeSeconds: 31536000
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*$/i, new workbox.CacheFirst({
    "cacheName": "uns-font-files-v1",
    plugins: [new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    }), new workbox.ExpirationPlugin({
      maxEntries: 16,
      maxAgeSeconds: 31536000
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap@/i, new workbox.CacheFirst({
    "cacheName": "zad-cdn-bootstrap-v1",
    plugins: [new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    }), new workbox.ExpirationPlugin({
      maxEntries: 8,
      maxAgeSeconds: 2592000
    })]
  }), 'GET');

}));
