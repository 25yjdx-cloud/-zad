import { createReadStream, existsSync } from 'node:fs';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { createFeedbackHandler } from './api/feedback.js';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.join(projectRoot, 'dist');
const isGithubPagesBuild = process.env.GITHUB_PAGES === 'true';

function mimeForRuntimeFile(fileName) {
  if (fileName.endsWith('.json')) return 'application/json; charset=utf-8';
  if (fileName.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function serveRootRuntimeFiles() {
  const files = new Set(['data.json', 'duas.json', 'manifest.json', 'quran-text.json']);
  function middleware(req, res, next) {
    const name = (req.url ?? '').split('?')[0].replace(/^\//, '');
    if (!files.has(name)) {
      next();
      return;
    }
    const filePath = path.join(projectRoot, name);
    if (!existsSync(filePath)) {
      next();
      return;
    }
    res.setHeader('Content-Type', mimeForRuntimeFile(name));
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(filePath).pipe(res);
  }
  return {
    name: 'serve-root-runtime-files',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function serveLocalFeedbackApi() {
  return {
    name: 'serve-local-feedback-api',
    configureServer(server) {
      const feedbackEnvironment = loadEnv(server.config.mode, projectRoot, '');
      const handler = createFeedbackHandler(feedbackEnvironment);
      server.middlewares.use('/api/feedback', async (req, res, next) => {
        const route = (req.url ?? '').split('?')[0];
        if (route && route !== '/' && route !== '/feedback') {
          next();
          return;
        }

        if (req.method === 'POST') {
          const chunks = [];
          let totalBytes = 0;
          let tooLarge = false;
          try {
            for await (const chunk of req) {
              totalBytes += chunk.length;
              if (totalBytes > 16_384) tooLarge = true;
              else chunks.push(chunk);
            }
          } catch {
            res.statusCode = 400;
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ success: false, error: 'Invalid request body' }));
            return;
          }
          if (tooLarge) {
            res.statusCode = 413;
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ success: false, error: 'Feedback request is too large' }));
            return;
          }
          req.body = Buffer.concat(chunks).toString('utf8');
        }

        const apiResponse = {
          setHeader: (...args) => res.setHeader(...args),
          status(code) {
            res.statusCode = code;
            return this;
          },
          json(payload) {
            res.end(JSON.stringify(payload));
            return this;
          },
        };
        await handler(req, apiResponse);
      });
    },
  };
}

function obfuscateProductionAssets() {
  return {
    name: 'obfuscate-production-assets',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const outputFile of Object.values(bundle)) {
        // Obfuscating the application entry roughly doubles its size. Keep that
        // chunk compact so the offline shell remains lightweight; retain the
        // existing obfuscation on smaller feature chunks.
        const chunkName = path.posix.basename(outputFile.fileName);
        if (outputFile.type !== 'chunk' || chunkName.startsWith('react-vendor')
          || chunkName.startsWith('index-')) continue;
        outputFile.code = JavaScriptObfuscator.obfuscate(outputFile.code, {
          compact: true,
          controlFlowFlattening: false,
          identifierNamesGenerator: 'hexadecimal',
          numbersToExpressions: false,
          renameGlobals: false,
          selfDefending: false,
          stringArray: true,
          stringArrayEncoding: [],
          stringArrayThreshold: 0.75,
        }).getObfuscatedCode();
      }
    },

    async writeBundle() {
      const runtimeFiles = [
        'data.json',
        'duas.json',
        'manifest.json',
        'quran-text.json',
      ];
      if (!isGithubPagesBuild) {
        runtimeFiles.push(
          'api.php',
          'auth.php',
          'create-payment.php',
          'feedback.php',
          'paymob-webhook.php',
          'security.php',
          '.htaccess',
        );
      }
      await Promise.all(runtimeFiles.map((name) => cp(
        path.join(projectRoot, name),
        path.join(outputRoot, name),
      )));
      await cp(
        path.join(projectRoot, 'public', 'assets', 'icons'),
        path.join(outputRoot, 'assets', 'icons'),
        { recursive: true },
      );
      await cp(
        path.join(projectRoot, 'public', 'audio'),
        path.join(outputRoot, 'audio'),
        { recursive: true },
      );
      const htmlPath = path.join(outputRoot, 'index.html');
      const html = await readFile(htmlPath, 'utf8');
      await writeFile(
        htmlPath,
        html.replace(/(<link rel="manifest" href=")[^"]+(")/, '$1./manifest.json$2'),
      );
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: 'public',
  plugins: [
    react(),
    serveLocalFeedbackApi(),
    serveRootRuntimeFiles(),
    obfuscateProductionAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      devOptions: { enabled: true, type: 'classic' },
      includeAssets: [
        'icon-192.png',
        'icon-512.png',
        'apple-touch-icon.png',
        'favicon.svg',
      ],
      manifest: false,
      workbox: {
        importScripts: ['pwa-events.js'],
        globPatterns: ['**/*.{js,css,html,svg,jpg,json,ico,webmanifest,mp3}'],
        globIgnores: [
          '**/*.php',
          '**/.htaccess',
          '**/quran-text.json',
          '**/data/tafsir-muyassar.json',
          '**/data/tafsir-sharawi.json',
          '**/data/tafsir-wajiz.json',
        ],
        // Keep Quran text and tafsir out of install-time precache. The Quran
        // reader starts from its page image; text and commentary load on demand.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\.php$/i, /\/api\//i],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('.php') || url.pathname.includes('/api/'),
            handler: 'NetworkOnly',
          },
          {
            urlPattern: ({ url }) => url.origin === self.location.origin
              && /(?:^|\/)audio\/azkar\/(?:20|22)\.mp3$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'zad-azkar-audio-v1',
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: 2,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: /^https:\/\/quran\.ksu\.edu\.sa\/png_big\/.+\.png(?:\?.*)?$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'zad-quran-pages-v1',
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 650,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: ({ url }) => /\/data\/tafsir-(?:muyassar|sharawi|wajiz)\.json$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'uns-local-tafsir-v1',
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: 3,
                maxAgeSeconds: 365 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: ({ url }) => /\/quran-text\.json$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'zad-quran-text-v1',
              cacheableResponse: { statuses: [200] },
              expiration: {
                maxEntries: 4,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
          {
            urlPattern: ({ url }) => /\/(?:data|duas)\.json$/i.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'zad-app-data-v1',
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/(?:api\.alquran\.cloud\/v1|api\.quran-tafseer\.com\/tafseer|api\.quran\.com\/api\/v4)\/.*$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'uns-quran-tafsir-api-v1',
              networkTimeoutSeconds: 5,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 2500, maxAgeSeconds: 180 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'uns-font-styles-v1',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 8, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'uns-font-files-v1',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 16, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap@/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'zad-cdn-bootstrap-v1',
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 8,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
  ],
  define: {
    __GITHUB_PAGES__: JSON.stringify(isGithubPagesBuild),
  },
  esbuild: {
    drop: ['debugger'],
    pure: ['console.log', 'console.debug'],
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')
            || id.includes('/node_modules/scheduler/')) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
});
