/* ========================================
   FRAMEO — استيراد الملفات ذات الطبقات (PSD / TIFF)
   المتصفح لا يفتح هذه الصيغ، فنحوّلها داخل متصفح الأدمن إلى PNG ثم يُرفع الـ PNG فقط
   (التخزين والصلاحيات لم تتغيّر). المكتبات تُحمَّل عند الحاجة فقط:
     PSD  ← ag-psd   (يدعم RGB 8-bit فقط؛ لا CMYK ولا 16-bit ولا PSB)
     TIFF ← UTIF.js  (الصفحة الأولى = الصورة المدمجة، أو اختيار صفحة)
   ======================================== */
'use strict';

const Importers = (() => {
  // المحلي أولاً (يعمل أوفلاين) ثم CDN كاحتياط
  const LIBS = {
    psd: [
      'js/vendor/ag-psd.js',
      'https://cdn.jsdelivr.net/npm/ag-psd@28.0.1/dist/bundle.js'
    ],
    tiff: [
      'js/vendor/pako.min.js',
      'js/vendor/UTIF.js',
      'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js',
      'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js'
    ]
  };
  const MAX_SRC = 500 * 1024 * 1024;       // الملف الأصلي (يُقرأ محلياً فقط)
  const MAX_PIXELS = 120e6;                // حماية الذاكرة
  const MAX_SIDE = 8000;                   // أكبر ضلع للناتج
  const MAX_PNG = 45 * 1024 * 1024;        // أقل من حد الرفع في التخزين (50MB)
  const PH_RE = /(photo|picture|portrait|avatar|face|person|placeholder|صورة|شخص|وجه)/i;

  const BLEND = {
    multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
    'color dodge': 'color-dodge', 'color burn': 'color-burn', 'hard light': 'hard-light', 'soft light': 'soft-light',
    difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity',
    'linear dodge': 'lighter'
  };

  /* ---------- أدوات ---------- */
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  const fail = m => { throw new Error(m); };

  const loaded = {};
  function loadScript(url) {
    if (!loaded[url]) loaded[url] = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = url; s.async = true;
      s.onload = () => res();
      s.onerror = () => { delete loaded[url]; s.remove(); rej(new Error('تعذّر تحميل مكتبة التحويل من الإنترنت — تأكد من الاتصال وأعد المحاولة.')); };
      document.head.appendChild(s);
    });
    return loaded[url];
  }
  async function ensure(kind) {
    const ready = () => kind === 'psd'
      ? !!(window.agPsd && window.agPsd.readPsd)
      : !!(window.UTIF && window.UTIF.decode);
    for (const u of LIBS[kind]) {
      if (ready()) break;
      try { await loadScript(u); } catch (e) { /* جرّب المصدر التالي */ }
    }
    if (kind === 'psd' && !ready()) fail('مكتبة PSD لم تُحمَّل بشكل صحيح — تأكد من الاتصال بالإنترنت أول مرة.');
    if (kind === 'tiff' && !ready()) fail('مكتبة TIFF لم تُحمَّل بشكل صحيح — تأكد من الاتصال بالإنترنت أول مرة.');
  }

  function sniff(h) {
    if (h[0] === 0x38 && h[1] === 0x42 && h[2] === 0x50 && h[3] === 0x53) return h[5] === 2 ? 'psb' : 'psd';
    if (h[0] === 0x49 && h[1] === 0x49 && h[2] === 0x2A && h[3] === 0) return 'tiff';
    if (h[0] === 0x4D && h[1] === 0x4D && h[2] === 0 && h[3] === 0x2A) return 'tiff';
    if ((h[0] === 0x49 && h[1] === 0x49 && h[2] === 0x2B) || (h[0] === 0x4D && h[1] === 0x4D && h[2] === 0 && h[3] === 0x2B)) return 'bigtiff';
    return null;
  }

  async function toPng(canvas) {
    let c = canvas;
    if (Math.max(c.width, c.height) > MAX_SIDE) c = shrink(c, MAX_SIDE / Math.max(c.width, c.height));
    for (let i = 0; i < 5; i++) {
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      if (!blob) fail('تعذّر إنشاء ملف PNG (الصورة كبيرة جداً على هذا المتصفح).');
      if (blob.size <= MAX_PNG) return { blob, w: c.width, h: c.height, scale: c.width / canvas.width };
      c = shrink(c, Math.max(0.3, Math.sqrt(MAX_PNG / blob.size) * 0.92));
    }
    fail('الصورة كبيرة جداً حتى بعد التصغير (الحد 45MB) — قلّل أبعادها أو عدد الطبقات ثم أعد المحاولة.');
  }
  function shrink(c, f) { const n = mk(c.width * f, c.height * f); const x = n.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, n.width, n.height); return n; }

  /* ---------- نافذة الحوار ---------- */
  function shell(title, sub) {
    const ov = el('div', 'imp-overlay'); ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', title);
    const card = el('div', 'imp-card');
    const head = el('div', 'imp-head'); head.append(el('h3', null, title)); if (sub) head.append(el('small', null, sub));
    const body = el('div', 'imp-body'); const foot = el('div', 'imp-foot');
    card.append(head, body, foot); ov.append(card); document.body.append(ov);
    return { ov, body, foot, close: () => ov.remove() };
  }
  function footerButtons(sh, okText, onOk, onCancel) {
    const ok = el('button', 'btn btn--amber', okText); ok.type = 'button';
    const cancel = el('button', 'btn btn--ghost', 'إلغاء'); cancel.type = 'button';
    ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel);
    sh.foot.append(ok, cancel);
    const key = e => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', key);
    sh.onClose = () => document.removeEventListener('keydown', key);
    setTimeout(() => ok.focus(), 30);
    return ok;
  }

  /* ======================================================
     PSD
     ====================================================== */
  function annotate(nodes, depth, list, parent) {
    // ag-psd: children مرتبة من الأسفل للأعلى؛ نعرض الأعلى أولاً
    for (let i = (nodes || []).length - 1; i >= 0; i--) {
      const n = nodes[i];
      n.__id = list.length; n.__depth = depth; n.__parent = parent;
      list.push(n);
      if (n.children) annotate(n.children, depth + 1, list, n);
    }
  }
  const opac = o => (o == null ? 1 : (o > 1 ? o / 255 : o));
  // حدود الطبقة (بعض الملفات لا تحمل right/bottom — نحسبها من المقاس)
  function bounds(n) {
    const x = n.left || 0, y = n.top || 0;
    return {
      x, y,
      width: n.right != null ? n.right - x : (n.width || 0),
      height: n.bottom != null ? n.bottom - y : (n.height || 0)
    };
  }

  function applyMask(n, src) {
    try {
      const m = n.mask; const mc = m.canvas; const w = src.width, h = src.height;
      const out = mk(w, h); const octx = out.getContext('2d'); octx.drawImage(src, 0, 0);
      const id = octx.getImageData(0, 0, w, h);
      const md = mc.getContext('2d').getImageData(0, 0, mc.width, mc.height);
      const ox = m.positionRelativeToLayer ? (n.left || 0) + (m.left || 0) : (m.left || 0);
      const oy = m.positionRelativeToLayer ? (n.top || 0) + (m.top || 0) : (m.top || 0);
      const def = m.defaultColor == null ? 255 : m.defaultColor;
      for (let y = 0; y < h; y++) {
        const my = (n.top || 0) + y - oy;
        for (let x = 0; x < w; x++) {
          const mx = (n.left || 0) + x - ox;
          const v = (mx >= 0 && my >= 0 && mx < mc.width && my < mc.height) ? md.data[(my * mc.width + mx) * 4] : def;
          const i = (y * w + x) * 4 + 3; id.data[i] = (id.data[i] * v) / 255;
        }
      }
      octx.putImageData(id, 0, 0);
      return out;
    } catch (e) { return src; }
  }

  function composeLayers(psd, vis, skipId) {
    const cv = mk(psd.width, psd.height); const ctx = cv.getContext('2d');
    const draw = (n, alpha) => {
      if (vis.get(n.__id) === false) return;
      const a = alpha * opac(n.opacity);
      if (n.children) { n.children.forEach(c => draw(c, a)); return; }
      if (n.__id === skipId || !n.canvas) return;
      const src = (n.mask && !n.mask.disabled && n.mask.canvas) ? applyMask(n, n.canvas) : n.canvas;
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.globalCompositeOperation = BLEND[n.blendMode] || 'source-over';
      ctx.drawImage(src, n.left || 0, n.top || 0); ctx.restore();
    };
    (psd.children || []).forEach(c => draw(c, 1));
    return cv;
  }

  function pickPsd(psd, list, fileName) {
    return new Promise(resolve => {
      const sh = shell('استيراد ملف PSD', fileName + ' — ' + psd.width + '×' + psd.height);
      const left = el('div', 'imp-left'); const right = el('div', 'imp-right');
      const prev = mk(10, 10); prev.className = 'imp-preview'; left.append(prev);
      const warn = el('p', 'imp-warn'); left.append(warn);
      sh.body.append(left, right);

      const vis = new Map(list.map(n => [n.__id, !n.hidden]));
      const hasComposite = !!(psd.canvas && psd.canvas.width);
      let mode = hasComposite ? 'embedded' : 'layers';
      let ph = null;
      const auto = list.find(n => !n.children && n.canvas && PH_RE.test(n.name || ''));
      if (auto) { ph = auto.__id; mode = 'layers'; }
      const special = list.some(n => n.clipping || (n.effects && Object.keys(n.effects).length));

      // وضع التركيب
      const modes = el('div', 'imp-modes');
      const mkMode = (val, label, disabled) => {
        const l = el('label', 'radio'); const r = document.createElement('input'); r.type = 'radio'; r.name = 'impmode'; r.value = val; r.disabled = !!disabled;
        r.checked = mode === val; r.addEventListener('change', () => { mode = val; render(); }); l.append(r, document.createTextNode(' ' + label)); modes.append(l); return r;
      };
      const rEmb = mkMode('embedded', 'استخدم التركيب المدمج في الملف (الأدق — يتطلب Maximize Compatibility)', !hasComposite);
      const rLay = mkMode('layers', 'أعد التركيب من الطبقات المحددة', false);
      right.append(modes);

      const phHead = el('label', 'radio imp-ph'); const phNone = document.createElement('input'); phNone.type = 'radio'; phNone.name = 'impph'; phNone.value = ''; phNone.checked = ph == null;
      phNone.addEventListener('change', () => { ph = null; render(); });
      phHead.append(phNone, document.createTextNode(' لا توجد طبقة «مكان الصورة»')); right.append(phHead);
      right.append(el('small', 'imp-hint', 'ظلّل طبقة «مكان الصورة» (اللي هتتحط فيها صورة المستخدم) لتُستخدم مقاسها كمنطقة الصورة، وتُستبعد من الفريم.'));

      const rows = el('div', 'imp-rows'); right.append(rows);
      list.forEach(n => {
        const row = el('div', 'imp-row'); row.style.paddingInlineStart = (n.__depth * 16) + 'px';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = vis.get(n.__id); cb.setAttribute('aria-label', 'إظهار ' + (n.name || ''));
        cb.addEventListener('change', () => { vis.set(n.__id, cb.checked); if (mode === 'embedded') { mode = 'layers'; rLay.checked = true; } render(); });
        const nm = el('span', 'imp-name', (n.children ? '📁 ' : '') + (n.name || 'بدون اسم')); row.append(cb, nm);
        if (n.mask && !n.mask.disabled) row.append(el('em', 'imp-tag', 'قناع'));
        if (n.blendMode && n.blendMode !== 'normal' && n.blendMode !== 'pass through') row.append(el('em', 'imp-tag', n.blendMode));
        if (!n.children && n.canvas) {
          const r = document.createElement('input'); r.type = 'radio'; r.name = 'impph'; r.title = 'هذه طبقة مكان الصورة'; r.checked = ph === n.__id; r.className = 'imp-phr';
          r.setAttribute('aria-label', 'طبقة مكان الصورة: ' + (n.name || ''));
          r.addEventListener('change', () => { ph = n.__id; mode = 'layers'; rLay.checked = true; render(); }); row.append(r);
        }
        rows.append(row);
      });

      let timer = null;
      function current() { return mode === 'embedded' && hasComposite ? psd.canvas : composeLayers(psd, vis, ph); }
      function render() {
        clearTimeout(timer);
        timer = setTimeout(() => {
          try {
            const c = current(); const f = Math.min(1, 420 / Math.max(c.width, c.height));
            prev.width = Math.max(1, Math.round(c.width * f)); prev.height = Math.max(1, Math.round(c.height * f));
            const x = prev.getContext('2d'); x.clearRect(0, 0, prev.width, prev.height); x.drawImage(c, 0, 0, prev.width, prev.height);
            if (ph != null) { const n = list[ph]; const b = bounds(n); x.save(); x.strokeStyle = '#5E3BFF'; x.setLineDash([6, 4]); x.lineWidth = 2; x.fillStyle = 'rgba(94,59,255,.2)';
              const rx = b.x * f, ry = b.y * f, rw = b.width * f, rh = b.height * f; x.fillRect(rx, ry, rw, rh); x.strokeRect(rx, ry, rw, rh); x.restore(); }
          } catch (e) { /* ignore preview errors */ }
        }, 60);
        warn.textContent = (mode === 'layers' && special) ? '⚠️ في الملف تأثيرات/قصّ طبقات لا يدعمها التركيب اليدوي، فقد يختلف الناتج عن Photoshop. قارن المعاينة بالتركيب المدمج.' : '';
      }
      render();

      const finish = v => { clearTimeout(timer); if (sh.onClose) sh.onClose(); sh.close(); resolve(v); };
      footerButtons(sh, 'استيراد', () => {
        let result = null;
        try {
          const comp = current();
          const phNode = ph != null ? list[ph] : null;
          const b = phNode ? bounds(phNode) : null;
          result = { canvas: comp, photo: b ? { x: b.x, y: b.y, width: b.width, height: b.height, name: phNode.name } : null };
        } catch (e) { result = { error: e }; }
        finish(result);
      }, () => finish(null));
      void rEmb;
    });
  }

  async function importPsd(file, buf) {
    await ensure('psd');
    let psd;
    try { psd = window.agPsd.readPsd(buf, { skipThumbnail: true }); }
    catch (e) {
      const m = String((e && e.message) || e);
      if (/color mode|colorMode|unsupported|not supported/i.test(m)) fail('وضع ألوان الملف غير مدعوم. احفظ الـ PSD بوضع RGB و8-bit ثم أعد المحاولة. (' + m + ')');
      fail('تعذّر قراءة ملف PSD: ' + m);
    }
    if (!psd || !psd.width || !psd.height) fail('ملف PSD فارغ أو تالف.');
    if (psd.width * psd.height > MAX_PIXELS) fail('أبعاد الملف كبيرة جداً (' + psd.width + '×' + psd.height + '). قلّلها إلى أقل من 120 ميجابكسل.');
    const list = []; annotate(psd.children, 0, list, null);
    const picked = await pickPsd(psd, list, file.name);
    if (!picked) return null;
    if (picked.error) fail('تعذّر تركيب الطبقات: ' + (picked.error.message || picked.error));
    const png = await toPng(picked.canvas);
    const photoArea = picked.photo ? {
      x: Math.round(picked.photo.x * png.scale), y: Math.round(picked.photo.y * png.scale),
      width: Math.round(picked.photo.width * png.scale), height: Math.round(picked.photo.height * png.scale)
    } : null;
    return { blob: png.blob, ext: 'png', w: png.w, h: png.h, size: png.blob.size, photoArea, photoName: picked.photo ? picked.photo.name : '', source: 'PSD' };
  }

  /* ======================================================
     TIFF
     ====================================================== */
  function tiffToCanvas(buf, ifd) {
    window.UTIF.decodeImage(buf, ifd);
    if (!ifd.width || !ifd.height) fail('تعذّر فك ضغط صفحة TIFF (الضغط أو نظام الألوان غير مدعوم). جرّب حفظه بدون ضغط أو كـ PNG/PSD.');
    if (ifd.width * ifd.height > MAX_PIXELS) fail('أبعاد الملف كبيرة جداً.');
    const rgba = window.UTIF.toRGBA8(ifd);
    const c = mk(ifd.width, ifd.height);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, ifd.width * ifd.height * 4), ifd.width, ifd.height), 0, 0);
    return c;
  }

  function pickTiffPage(buf, pages, fileName) {
    return new Promise(resolve => {
      const sh = shell('استيراد ملف TIFF', fileName + ' — ' + pages.length + ' صفحات');
      const left = el('div', 'imp-left'); const right = el('div', 'imp-right');
      const prev = mk(10, 10); prev.className = 'imp-preview'; left.append(prev);
      sh.body.append(left, right);
      right.append(el('small', 'imp-hint', 'اختر الصفحة المطلوبة. ملاحظة: TIFF المحفوظ من Photoshop بطبقات يُستورد كصورة مدمجة، والطبقات الداخلية غير متاحة — احفظه PSD لو محتاج طبقات.'));
      let sel = 0; const cache = {};
      const show = i => {
        sel = i;
        try {
          const c = cache[i] || (cache[i] = tiffToCanvas(buf, pages[i])); const f = Math.min(1, 420 / Math.max(c.width, c.height));
          prev.width = Math.round(c.width * f); prev.height = Math.round(c.height * f); prev.getContext('2d').drawImage(c, 0, 0, prev.width, prev.height);
        } catch (e) { const x = prev.getContext('2d'); x.clearRect(0, 0, prev.width, prev.height); }
      };
      pages.forEach((p, i) => {
        const l = el('label', 'radio'); const r = document.createElement('input'); r.type = 'radio'; r.name = 'tpage'; r.checked = i === 0;
        r.addEventListener('change', () => show(i)); l.append(r, document.createTextNode(' صفحة ' + (i + 1))); right.append(l);
      });
      show(0);
      const finish = v => { if (sh.onClose) sh.onClose(); sh.close(); resolve(v); };
      footerButtons(sh, 'استيراد', () => { try { finish({ canvas: cache[sel] || tiffToCanvas(buf, pages[sel]) }); } catch (e) { finish({ error: e }); } }, () => finish(null));
    });
  }

  async function importTiff(file, buf) {
    await ensure('tiff');
    let ifds;
    try { ifds = window.UTIF.decode(buf); } catch (e) { fail('تعذّر قراءة ملف TIFF: ' + ((e && e.message) || e)); }
    const pages = (ifds || []).filter(i => i && i.t256 && i.t257 && i.t256[0] > 16 && i.t257[0] > 16);   // نتجاهل المصغّرات الصغيرة جداً
    if (!pages.length) fail('لم أجد صورة قابلة للاستيراد داخل ملف TIFF.');
    let canvas;
    if (pages.length === 1) canvas = tiffToCanvas(buf, pages[0]);
    else {
      const r = await pickTiffPage(buf, pages, file.name);
      if (!r) return null;
      if (r.error) throw r.error;
      canvas = r.canvas;
    }
    const png = await toPng(canvas);
    return { blob: png.blob, ext: 'png', w: png.w, h: png.h, size: png.blob.size, photoArea: null, source: 'TIFF' };
  }

  /* ======================================================
     الواجهة العامة
     ====================================================== */
  async function importFile(file) {
    if (file.size > MAX_SRC) fail('حجم الملف أكبر من 500MB.');
    const buf = await file.arrayBuffer();
    const kind = sniff(new Uint8Array(buf, 0, Math.min(16, buf.byteLength)));
    if (kind === 'psb') fail('صيغة PSB (المستندات الكبيرة) غير مدعومة. احفظ الملف كـ PSD عادي.');
    if (kind === 'bigtiff') fail('صيغة BigTIFF غير مدعومة. احفظ الملف كـ TIFF عادي.');
    if (kind === 'psd') return importPsd(file, buf);
    if (kind === 'tiff') return importTiff(file, buf);
    fail('محتوى الملف ليس PSD ولا TIFF صالحاً.');
  }

  return { importFile, sniff, _compose: composeLayers };
})();
