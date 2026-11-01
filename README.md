# FRAMEO — إطارك بطريقتك

أداة لإنشاء صور تكريمية داخل فريمات مخصصة. معالجة صورة المستخدم تتم بالكامل داخل المتصفح (لا تُرفع لأي خادم)،
ولوحة إدارة آمنة لرفع الفريمات وإدارتها.

- **الموقع العام:** `index.html` · `editor.html` · `about.html`
- **الإدارة:** `admin.html` (دخول بحسابات حقيقية، رفع PNG/SVG/WEBP/JPG، عام/خاص، إدارة الحسابات)
- **الواجهة:** RTL كاملة، هوية FRAMEO، موشن (Splash، لوجو متحرك، Reveal، Tilt، Marquee) مع احترام `prefers-reduced-motion`

## الإعداد
اتبع **[SETUP-AR.md](SETUP-AR.md)** (Supabase مجاني، حوالي 15 دقيقة). بدون إعداد: الموقع العام يعمل من `config/frames.json`
واللوحة تعرض رسالة «تحتاج ربطاً بالخادم».

## البنية
```
index.html / editor.html / about.html / admin.html
css/    frameo.css (الهوية + الموشن) · style.css, editor.css, responsive.css (المحرر) · admin.css
js/     config.js (إعدادات الاتصال) · api.js (Supabase) · frames.js · editor.js · export.js · admin.js · app.js
supabase/schema.sql                       الجداول + RLS + التخزين
supabase/functions/admin-users/index.ts   إدارة الحسابات (service_role على السيرفر فقط)
assets/brand/   اللوجو (mark / wordmark / icons)
config/frames.json   نسخة احتياطية عامة للفريمات الأصلية
```

## نموذج الأمان باختصار
- الصلاحيات في **قاعدة البيانات (RLS)**: الزائر يقرأ العام فقط ولا يقدر يقرأ عمود `access_key`؛ الكتابة والرفع للإدارة النشطة فقط.
- الفريم الخاص يُجلب عبر دالة `get_private_frame(id, key)` ولا يظهر في أي قائمة.
- إنشاء/تعطيل/حذف الحسابات عبر Edge Function تتحقق أن المتصل `owner`.
- SVG يُنظَّف بـ DOMPurify قبل الرفع، وتُفحص بصمة PNG/JPG/WEBP للتأكد أن المحتوى يطابق الامتداد.
- مفتاح `anon` في `js/config.js` عام بطبيعته؛ **لا تضع `service_role` في الكود أبداً**.
