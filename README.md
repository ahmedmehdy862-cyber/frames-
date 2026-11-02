# FRAMEO — إطارك بطريقتك

أداة لإنشاء صور تكريمية داخل فريمات مخصصة. معالجة صورة المستخدم تتم بالكامل داخل المتصفح (لا تُرفع لأي خادم)،
ولوحة إدارة آمنة لرفع الفريمات وإدارتها.

- **الموقع العام:** `index.html` · `editor.html` · `about.html`
- **الإدارة:** `admin.html` (دخول بحسابات حقيقية، رفع PNG/SVG/WEBP/JPG واستيراد PSD/TIFF، عام/خاص، إدارة الحسابات، صورة واجهة الرئيسية)
- **الواجهة:** RTL كاملة، هوية FRAMEO، موشن (Splash، لوجو متحرك، Reveal، Tilt، Marquee) مع احترام `prefers-reduced-motion`
- **PWA:** يثبَّت على الهاتف ويعمل أوفلاين بعد أول زيارة (الواجهة + المحرر). الإدارة تحتاج إنترنت.

## الإعداد
اتبع **[SETUP-AR.md](SETUP-AR.md)** (Supabase مجاني، حوالي 15 دقيقة). بدون إعداد: الموقع العام يعمل من `config/frames.json`
واللوحة تعرض رسالة «تحتاج ربطاً بالخادم».

## البنية
```
index.html / editor.html / about.html / admin.html
sw.js · manifest.webmanifest               العمل أوفلاين + التثبيت على الهاتف
css/    frameo.css (الهوية + الموشن) · style.css, editor.css, responsive.css (المحرر) · admin.css
js/     config.js (إعدادات الاتصال) · home.js (صورة الواجهة) · api.js (Supabase) · frames.js · editor.js
        · export.js · admin.js · importers.js (PSD/TIFF) · app.js
js/vendor/   مكتبات محلية: fabric · supabase-js · DOMPurify · ag-psd · UTIF · pako
supabase/schema.sql                       الجداول + RLS + التخزين + إعدادات الموقع
supabase/functions/admin-users/index.ts   إدارة الحسابات (service_role على السيرفر فقط)
assets/brand/   اللوجو (mark / wordmark / icons)
config/frames.json   نسخة احتياطية عامة للفريمات الأصلية
```

## العمل أوفلاين والتثبيت
- بعد أول زيارة كاملة، يعمل الموقع العام والمحرر بدون إنترنت (تصميم + تصدير PNG/JPG).
- التثبيت على أندرويد: قائمة المتصفح ← «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».
- التثبيت على iPhone: افتح الموقع في **Safari** ← زر المشاركة ← «إضافة إلى الشاشة الرئيسية».
- لوحة الإدارة والحسابات تحتاج إنترنت دائماً؛ لا تُخزَّن في الكاش.
- أي تحديث جديد للملفات يرفع رقم `VERSION` في `sw.js` لإلغاء الكاش القديم.

## نموذج الأمان باختصار
- الصلاحيات في **قاعدة البيانات (RLS)**: الزائر يقرأ العام فقط ولا يقدر يقرأ عمود `access_key`؛ الكتابة والرفع للإدارة النشطة فقط.
- الفريم الخاص يُجلب عبر دالة `get_private_frame(id, key)` ولا يظهر في أي قائمة.
- إنشاء/تعطيل/حذف الحسابات عبر Edge Function تتحقق أن المتصل `owner`.
- SVG يُنظَّف بـ DOMPurify قبل الرفع، وتُفحص بصمة PNG/JPG/WEBP للتأكد أن المحتوى يطابق الامتداد.
- مفتاح `anon` في `js/config.js` عام بطبيعته؛ **لا تضع `service_role` في الكود أبداً**.
