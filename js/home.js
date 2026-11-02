/* ========================================
   FRAMEO — صورة واجهة الصفحة الرئيسية
   تقرأ إعداد «hero» من Supabase (قراءة عامة فقط) وتستبدل صورة الهيرو.
   أي فشل أو عدم اتصال = تبقى الصورة الافتراضية بدون أي خطأ ظاهر.
   ======================================== */
'use strict';

(() => {
  const cfg = window.FRAMEO_CONFIG || {};
  const base = String(cfg.SUPABASE_URL || '').replace(/\/$/, '');
  const key = cfg.SUPABASE_ANON_KEY;
  if (!base || !key) return;

  const isAbsolute = p => /^(https?:|data:|blob:|assets\/|\.\/|\/)/.test(p);

  function heroImage() {
    const plate = document.getElementById('heroPlate');
    return plate ? plate.querySelector('img') : null;
  }

  function apply(value) {
    const path = value && String(value.image || '');
    const img = heroImage();
    if (!path || !img) return;
    const src = isAbsolute(path) ? path : base + '/storage/v1/object/public/frames/' + encodeURI(path);
    if (img.getAttribute('src') !== src) img.src = src;
    if (value.alt) img.alt = String(value.alt).slice(0, 120);
  }

  async function load() {
    try {
      const res = await fetch(base + '/rest/v1/site_settings?key=eq.hero&select=value', {
        headers: { apikey: key, Authorization: 'Bearer ' + key },
        cache: 'no-store'
      });
      if (!res.ok) return;
      const rows = await res.json();
      if (Array.isArray(rows) && rows[0]) apply(rows[0].value);
    } catch (e) {
      /* الصورة الافتراضية */
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
