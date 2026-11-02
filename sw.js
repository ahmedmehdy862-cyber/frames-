/* ========================================
   FRAMEO — Service Worker (PWA / Offline)
   - الواجهة العامة والمحرر تعمل أوفلاين بعد أول زيارة
   - لوحة الإدارة لا تُخزَّن (تحتاج إنترنت دائماً)
   - صور الفريمات وإعدادات الواجهة تُخزَّن عند نجاح الطلب
   ======================================== */
'use strict';

const VERSION = 'frameo-v1.0.1';
const CORE = 'frameo-core-' + VERSION;
const RUNTIME = 'frameo-runtime-' + VERSION;

const PRECACHE = [
  './',
  './index.html',
  './editor.html',
  './about.html',
  './manifest.webmanifest',
  './css/frameo.css',
  './css/style.css',
  './css/editor.css',
  './css/responsive.css',
  './js/config.js',
  './js/app.js',
  './js/home.js',
  './js/api.js',
  './js/frames.js',
  './js/editor.js',
  './js/export.js',
  './js/importers.js',
  './js/vendor/fabric.min.js',
  './js/vendor/ag-psd.js',
  './js/vendor/UTIF.js',
  './js/vendor/pako.min.js',
  './js/vendor/supabase.js',
  './js/vendor/dompurify.min.js',
  './assets/brand/favicon-48.png',
  './assets/brand/apple-touch-icon.png',
  './assets/brand/icon-192.png',
  './assets/brand/icon-512.png',
  './assets/brand/icon-maskable-512.png',
  './assets/brand/frameo-mark.png',
  './assets/brand/frameo-wordmark.png',
  './assets/brand/frameo-logo-alpha.png',
  './assets/frames/codemakers.webp',
  './assets/frames/midnight-gold.webp',
  './assets/frames/midnight-gold.svg',
  './config/frames.json'
];

/* ---------- تثبيت: تخزين هيكل الموقع ---------- */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE);
    // كل ملف على حدة حتى لا يوقف ملفٌ ناقص التثبيت كله
    await Promise.all(PRECACHE.map(url =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

/* ---------- تنشيط: حذف النسخ القديمة ---------- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith('frameo-') && k !== CORE && k !== RUNTIME)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ---------- أدوات التخزين ---------- */
async function put(cacheName, request, response) {
  try {
    // الاستجابات opaque (صور <img> من نطاق آخر) حالتها 0 لكنها صالحة للتخزين
    const storable = response && (response.ok || response.type === 'opaque') && response.status !== 206;
    if (!storable) return;
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  } catch (e) { /* التخزين ممتلئ أو الطلب غير قابل للتخزين */ }
}

async function networkFirst(request, cacheName) {
  try {
    const res = await fetch(request);
    if (res && res.ok) put(cacheName, request, res.clone());
    return res;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  put(cacheName, request, res);
  return res;
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  const network = fetch(request).then(res => {
    put(cacheName, request, res);
    return res;
  }).catch(() => null);
  return cached || network || Response.error();
}

/* ---------- التنقل بين الصفحات ---------- */
async function handleNavigate(request) {
  const url = new URL(request.url);
  // لوحة الإدارة لا تدخل الكاش أبداً
  if (/\/admin\.html$/.test(url.pathname)) return fetch(request);

  try {
    const res = await fetch(request);
    if (res && res.ok) put(CORE, request, res.clone());
    return res;
  } catch (e) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    let fallback = './index.html';
    if (/\/editor\.html$/.test(url.pathname)) fallback = './editor.html';
    else if (/\/about\.html$/.test(url.pathname)) fallback = './about.html';
    const page = await caches.match(fallback);
    return page || new Response(
      '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>FRAMEO</title>' +
      '<body style="background:#0a0d1c;color:#f5f6fb;font-family:sans-serif;text-align:center;padding:20vh 20px">' +
      '<h1>أنت غير متصل بالإنترنت</h1><p>افتح الموقع مرة واحدة وأنت متصل ليُخزَّن، ثم يعمل أوفلاين.</p></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

/* ---------- اعتراض الطلبات ---------- */
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try { url = new URL(request.url); } catch (e) { return; }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request));
    return;
  }

  // مكتبات الخطوط (اختياري — تعمل أوفلاين بعد أول تحميل)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, RUNTIME));
    return;
  }

  if (url.origin !== location.origin) {
    // صور الفريمات وإعدادات الواجهة من Supabase
    if (/\/storage\/v1\/object\/public\//.test(url.pathname)) {
      event.respondWith(cacheFirst(request, RUNTIME));
    } else if (/\/rest\/v1\/(frames|site_settings)/.test(url.pathname)) {
      event.respondWith(networkFirst(request, RUNTIME));
    }
    return;
  }

  // بيانات الفريمات: الأحدث من الشبكة ثم الكاش عند الانقطاع
  if (/\/config\/frames\.json$/.test(url.pathname) || /\/rest\/v1\//.test(url.pathname)) {
    event.respondWith(networkFirst(request, RUNTIME));
    return;
  }

  // ملفات الموقع الثابتة
  event.respondWith(staleWhileRevalidate(request, CORE));
});
