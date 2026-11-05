/* ========================================
   FRAMEO — لوحة الإدارة (V4 — آمنة)
   - دخول حقيقي عبر Supabase Auth (إيميل + كلمة مرور)
   - الصلاحيات تُفرض في قاعدة البيانات (RLS) وليس هنا
   - رفع PNG / SVG / WEBP / JPG للإدارة فقط (SVG يُنظَّف قبل الرفع)
   - إدارة الحسابات (للمالك owner فقط) عبر Edge Function
   ======================================== */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t = 'info', d = 4500) => App.showToast(m, t, d);
  const show = (id, on = true) => { const el = $(id); if (el) el.hidden = !on; };

  const MAX_IMG = 15 * 1024 * 1024;
  const ID_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;
  const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;
  const IDLE_MS = 30 * 60 * 1000;

  let me = null;                // ملف الحساب الحالي
  let frames = [];              // كل الإطارات (عامة + خاصة)
  let current = null;           // الإطار قيد التعديل (النسخة المحفوظة)
  let isDraft = false;          // إطار جديد لم يُحفظ بعد
  let filter = 'all';
  let searchQuery = '';
  let dirty = false;
  let pending = null;           // صورة الإطار المختارة ولم تُرفع بعد { blob, ext, url, w, h, size }
  let hiddenLayers = [];        // طبقات مخفية من التصميم
  let lockedLayers = [];        // طبقات مقفولة ضد التحريك
  const sessionUploaded = new Set();
  const imgCache = {};
  let dragTarget = null;
  let dragOffset = { x: 0, y: 0 };
  let idleTimer = null;
  let hero = { image: '' };     // صورة واجهة الصفحة الرئيسية

  const ERRORS = {
    weak_password: 'كلمة المرور يجب ألا تقل عن 10 أحرف.',
    invalid_email: 'البريد الإلكتروني غير صالح.',
    last_owner: 'لا يمكن إزالة آخر مالك (owner) للنظام.',
    cannot_disable_self: 'لا يمكنك تعطيل حسابك بنفسك.',
    cannot_delete_self: 'لا يمكنك حذف حسابك بنفسك.',
    forbidden: 'ليست لديك صلاحية لهذه العملية.',
    unauthorized: 'انتهت الجلسة، سجّل الدخول من جديد.',
    not_found: 'الحساب غير موجود.'
  };
  function errText(e) {
    const m = (e && e.message) || String(e || '');
    if (ERRORS[m]) return ERRORS[m];
    if (/already.*registered|already been registered|exists/i.test(m)) return 'هذا البريد مسجّل مسبقاً.';
    if (/Failed to send a request|FunctionsFetchError|404|not found/i.test(m) && /function|Edge|Failed/i.test(m)) return 'تعذّر الوصول لدالة إدارة الحسابات (admin-users). تأكد من نشرها في Supabase.';
    if (/duplicate key|already exists/i.test(m)) return 'المعرّف (id) مستخدم لإطار آخر.';
    if (/row-level security|permission denied|violates row/i.test(m)) return 'ليست لديك صلاحية لهذه العملية (RLS).';
    if (/mime|not supported|invalid_mime/i.test(m)) return 'نوع الملف غير مسموح به في التخزين.';
    if (/exceeded|too large|size/i.test(m)) return 'حجم الملف أكبر من المسموح.';
    return m || 'حدث خطأ غير متوقع.';
  }

  /* ======================================================
     الدخول والجلسة
     ====================================================== */
  async function boot() {
    bindStatic();
    if (!Api.configured) { show('setupNotice'); return; }
    if (!Api.client()) { showLoginMsg('تعذّر تحميل مكتبة الاتصال. تأكد من الإنترنت وأعد تحميل الصفحة.'); show('loginScreen'); return; }
    Api.client().auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT' && me) location.reload(); });
    try {
      const prof = await Api.getProfile();
      if (prof) { me = prof; await enterApp(); return; }
      if (await Api.getSession()) { await Api.signOut(); showLoginMsg('هذا الحساب ليس له صلاحية إدارة أو تم تعطيله.'); }
    } catch (e) { console.warn(e); }
    show('loginScreen');
  }

  function showLoginMsg(t) { const el = $('loginErr'); el.textContent = t; el.hidden = !t; }

  async function doLogin(e) {
    if (e) e.preventDefault();
    const email = $('loginEmail').value.trim(), pw = $('loginPass').value;
    if (!email || !pw) { showLoginMsg('أدخل البريد الإلكتروني وكلمة المرور.'); return; }
    const btn = $('loginBtn'); btn.disabled = true; showLoginMsg('');
    try {
      await Api.signIn(email, pw);
      const prof = await Api.getProfile();
      if (!prof) { await Api.signOut(); throw new Error('noadmin'); }
      me = prof; $('loginPass').value = '';
      await enterApp();
    } catch (err) {
      showLoginMsg(err.message === 'noadmin'
        ? 'هذا الحساب ليس له صلاحية إدارة أو تم تعطيله.'
        : 'البريد الإلكتروني أو كلمة المرور غير صحيحة.');
    } finally { btn.disabled = false; }
  }

  async function enterApp() {
    show('loginScreen', false); show('app');
    $('meName').textContent = me.display_name || me.email;
    $('meRole').textContent = me.role === 'owner' ? 'مالك' : 'مدير';
    show('tabAccountsBtn', me.role === 'owner');
    resetIdle();
    ['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, resetIdle, { passive: true }));
    await loadFrames();
    await loadHero();
    switchTab('frames');
  }

  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => { await Api.signOut(); location.reload(); }, IDLE_MS);
  }

  async function logout() {
    if (dirty && !confirm('لديك تعديلات غير محفوظة. تسجيل الخروج الآن؟')) return;
    dirty = false;
    await Api.signOut(); location.reload();
  }

  function switchTab(name) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    show('tabFrames', name === 'frames');
    show('tabAccounts', name === 'accounts');
    if (name === 'accounts') loadAccounts();
  }

  /* ======================================================
     الإطارات: تحميل وقائمة
     ====================================================== */
  async function loadFrames(selectId) {
    try { frames = await Api.listAll(); }
    catch (e) { toast('تعذّر تحميل الإطارات: ' + errText(e), 'error'); frames = []; }
    renderList();
    const target = (selectId && frames.find(f => f.id === selectId)) || frames[0];
    if (target) selectFrame(target.id, true); else clearSelection();
  }

  function clearSelection() {
    current = null; isDraft = false; pending = null; dirty = false;
    $('frameForm').hidden = true; $('emptyState').hidden = false;
  }

  function renderList() {
    const list = $('framesList'); list.textContent = '';
    const q = searchQuery.trim().toLowerCase();
    const shown = frames.filter(f =>
      (filter === 'all' || f.visibility === filter) &&
      (!q || (f.name || '').toLowerCase().includes(q) || (f.id || '').toLowerCase().includes(q))
    );
    $('framesCount').textContent = shown.length + ' / ' + frames.length;
    if (!shown.length) {
      const p = document.createElement('p'); p.className = 'admin-hint'; p.textContent = q ? 'لا توجد نتائج مطابقة للبحث.' : 'لا توجد إطارات هنا.'; list.appendChild(p); return;
    }
    shown.forEach(f => {
      const row = document.createElement('div');
      row.className = 'admin-frame-item' + (current && !isDraft && current.id === f.id ? ' active' : '');
      const img = document.createElement('img'); img.src = f.image; img.alt = ''; img.loading = 'lazy';
      const meta = document.createElement('div'); meta.className = 'admin-frame-item__meta';
      const nm = document.createElement('strong'); nm.textContent = f.name;
      const sm = document.createElement('small'); sm.textContent = f.id + ' • ' + f.canvasWidth + '×' + f.canvasHeight;
      const badge = document.createElement('span'); badge.className = 'badge ' + (f.visibility === 'public' ? 'badge--public' : 'badge--private');
      badge.textContent = f.visibility === 'public' ? 'عام' : 'خاص';
      const bw = document.createElement('div'); bw.appendChild(badge);
      meta.append(nm, sm, bw);
      const cp = document.createElement('button'); cp.type = 'button'; cp.className = 'btn btn--ghost btn--sm'; cp.title = 'نسخ الرابط'; cp.textContent = '🔗';
      cp.addEventListener('click', ev => { ev.stopPropagation(); copyText(frameLink(f)); });
      row.append(img, meta, cp);
      row.addEventListener('click', () => selectFrame(f.id));
      list.appendChild(row);
    });
  }

  function selectFrame(id, force) {
    if (!force && dirty && !confirm('لديك تعديلات غير محفوظة. تجاهلها؟')) return;
    const f = frames.find(x => x.id === id);
    if (!f) { clearSelection(); return; }
    current = JSON.parse(JSON.stringify(f)); isDraft = false; pending = null; dirty = false;
    $('emptyState').hidden = true; $('frameForm').hidden = false;
    fillForm(current); renderList(); drawPreview();
  }

  /* ======================================================
     النموذج
     ====================================================== */
  function fillForm(f) {
    $('fName').value = f.name || '';
    $('fId').value = f.id || '';
    $('fW').value = f.canvasWidth || 2500;
    $('fH').value = f.canvasHeight || 2500;
    $('fImageFile').value = '';
    $('pX').value = f.photoArea ? f.photoArea.x : 0;
    $('pY').value = f.photoArea ? f.photoArea.y : 0;
    $('pW').value = f.photoArea ? f.photoArea.width : 500;
    $('pH').value = f.photoArea ? f.photoArea.height : 500;
    $('fColors').value = (f.textColors || []).join(', ');
    hiddenLayers = Array.isArray(f.layerHidden) ? [...f.layerHidden] : [];
    lockedLayers = Array.isArray(f.layerLocked) ? [...f.layerLocked] : [];
    selectedLayer = null;
    if ($('layerInspector')) $('layerInspector').hidden = true;
    document.querySelectorAll('input[name="vis"]').forEach(r => { r.checked = r.value === (f.visibility || 'public'); });
    $('fKey').value = f.accessKey || '';
    updateVisUI(); updateImageInfo();
    renderTexts(f.text || {});
    renderStickers(f.stickers || []);
    renderLayers(f);
    updateLinks();
    $('frameTitle').textContent = isDraft ? 'إطار جديد (غير محفوظ)' : f.name;
  }

  function updateImageInfo() {
    const box = $('imagePreview'), img = box.querySelector('img');
    const src = pending ? pending.url : (current && current.image) || '';
    box.hidden = !src;
    if (src) img.src = src;
    const info = $('imgInfo');
    const w = +$('fW').value, h = +$('fH').value;
    if (pending) {
      info.textContent = 'صورة جديدة جاهزة للرفع: ' + pending.w + '×' + pending.h + ' • ' + pending.ext.toUpperCase() + ' • ' + Math.round(pending.size / 1024) + 'KB';
      show('btnFitCanvas', pending.w !== w || pending.h !== h);
    } else {
      info.textContent = current && current.imagePath ? 'الصورة الحالية محفوظة على الخادم.' : 'لم تُرفع صورة بعد — PNG, SVG, WEBP, JPG حتى 15MB، وPSD/TIFF حتى 500MB (يُحوَّل تلقائياً إلى PNG عالي الجودة).';
      show('btnFitCanvas', false);
    }
  }

  function genKey() { return Api.genKey(); }

  function updateVisUI() {
    const vis = (document.querySelector('input[name="vis"]:checked') || {}).value;
    show('privateBox', vis === 'private');
    if (vis === 'private' && !$('fKey').value) $('fKey').value = genKey();
  }

  function frameLink(f) {
    const u = new URL('editor.html', location.href);
    u.search = '';
    u.searchParams.set('frame', f.id);
    if (f.visibility === 'private' && f.accessKey) u.searchParams.set('key', f.accessKey);
    return u.toString();
  }
  function updateLinks() {
    const f = collectForm(); if (!f) return;
    const link = frameLink(f);
    $('publicLink').textContent = link; $('privateLink').textContent = link;
    show('publicLinkBox', f.visibility === 'public');
  }
  function copyText(t) {
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('تم نسخ الرابط', 'success'), () => prompt('انسخ الرابط:', t));
  }

  /* ---------- النصوص ---------- */
  function renderTexts(textObj) {
    const c = $('textsContainer'); c.textContent = '';
    Object.entries(textObj).forEach(([k, cfg]) => c.appendChild(createTextRow(k, cfg)));
  }
  function createTextRow(key, cfg) {
    const div = document.createElement('div');
    div.className = 'text-field'; div.dataset.key = key;
    const v = x => esc(x == null ? '' : x);
    div.innerHTML = `
      <div class="text-field__head"><strong>المفتاح: <input value="${v(key)}" data-field="key" class="input input--inline" dir="ltr" maxlength="40"></strong>
        <button type="button" class="btn btn--danger btn--sm" data-del>حذف</button></div>
      <div class="admin-grid2">
        <label>التسمية<input data-field="label" class="input" value="${v(cfg.label)}" maxlength="80"></label>
        <label>النص الإرشادي<input data-field="placeholder" class="input" value="${v(cfg.placeholder)}" maxlength="80"></label>
      </div>
      <div class="admin-grid2">
        <label>قيمة ثابتة <small>اتركه فارغاً للسماح بالإدخال</small><input data-field="value" class="input" value="${v(cfg.value)}" maxlength="120"></label>
        <label>خيارات مفصولة بفاصلة<input data-field="options" class="input" value="${v((cfg.options || []).join(', '))}"></label>
      </div>
      <div class="admin-grid4">
        <label>X <input data-field="x" type="number" class="input" value="${+cfg.x || 0}"></label>
        <label>Y <input data-field="y" type="number" class="input" value="${+cfg.y || 0}"></label>
        <label>حجم الخط <input data-field="fontSize" type="number" class="input" value="${+cfg.fontSize || 50}"></label>
        <label>سماكة الخط <select data-field="fontWeight" class="input"><option value="normal"${cfg.fontWeight === 'normal' ? ' selected' : ''}>عادي</option><option value="bold"${cfg.fontWeight !== 'normal' ? ' selected' : ''}>عريض</option></select></label>
      </div>
      <div class="admin-grid2">
        <label>اللون <input data-field="color" type="color" class="input input--color" value="${/^#[0-9a-fA-F]{6}$/.test(cfg.color || '') ? cfg.color : '#FFFFFF'}"></label>
        <label>المحاذاة <select data-field="align" class="input"><option value="center"${cfg.align === 'center' || !cfg.align ? ' selected' : ''}>وسط</option><option value="left"${cfg.align === 'left' ? ' selected' : ''}>يسار</option><option value="right"${cfg.align === 'right' ? ' selected' : ''}>يمين</option></select></label>
      </div>`;
    div.querySelector('[data-del]').addEventListener('click', () => { div.remove(); markDirty(); refreshLayers(); drawPreview(); });
    div.querySelectorAll('input,select').forEach(inp => {
      const h = () => { markDirty(); drawPreview(); };
      inp.addEventListener('input', h); inp.addEventListener('change', h);
    });
    return div;
  }

  /* ---------- الملصقات ---------- */
  function renderStickers(list) {
    const box = $('stickersBox'); box.textContent = '';
    list.forEach(s => box.appendChild(createStickerRow(s)));
  }
  function createStickerRow(s) {
    const d = document.createElement('div');
    d.className = 'text-field'; d.dataset.sid = s.id; d.dataset.path = s.imagePath || '';
    d.innerHTML = `<div class="text-field__head"><strong>ملصق: ${esc(s.id)}</strong><button type="button" class="btn btn--danger btn--sm" data-del>حذف</button></div>
      <label>الاسم<input data-f="name" class="input" value="${esc(s.name)}" maxlength="60"></label>
      <label>الصورة (PNG / SVG / WEBP / PSD / TIFF)<input type="file" data-file accept=".png,.svg,.webp,.jpg,.jpeg,.psd,.tif,.tiff,image/png,image/svg+xml,image/webp,image/jpeg" class="input"></label>
      <small data-state>${s.imagePath ? 'صورة محفوظة.' : 'لم تُرفع صورة بعد.'}</small>
      <div class="admin-grid4">
        <label>X<input data-f="x" type="number" class="input" value="${+s.x || 0}"></label>
        <label>Y<input data-f="y" type="number" class="input" value="${+s.y || 0}"></label>
        <label>العرض<input data-f="w" type="number" class="input" value="${+s.w || 200}"></label>
        <label>الارتفاع<input data-f="h" type="number" class="input" value="${+s.h || 200}"></label>
      </div>`;
    if (s.image) d.dataset.url = s.image;
    d.querySelector('[data-del]').addEventListener('click', () => {
      const li = document.querySelector('#layersList [data-id="' + s.id + '"]'); if (li) li.remove();
      if (selectedLayer === s.id) selectLayer(null);
      d.remove(); markDirty(); drawPreview();
    });
    d.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('input', () => {
      markDirty(); drawPreview();
      if (inp.dataset.f === 'name') { const li = document.querySelector('#layersList [data-id="' + s.id + '"] .layer-item__name'); if (li) li.textContent = inp.value || s.id; }
    }));
    d.querySelector('[data-file]').addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      const st = d.querySelector('[data-state]'); st.textContent = 'جارٍ التجهيز والرفع…';
      try {
        const prep = await prepareImage(file);
        if (!prep) { st.textContent = ''; e.target.value = ''; return; }
        const path = await Api.uploadImage(prep.blob, prep.ext);
        sessionUploaded.add(path);
        d.dataset.path = path; d.dataset.url = Api.imageUrl(path);
        st.textContent = 'تم الرفع (' + prep.w + '×' + prep.h + ').';
        if (!+d.querySelector('[data-f="w"]').value || +d.querySelector('[data-f="w"]').value === 200) {
          const k = 300 / Math.max(prep.w, prep.h);
          d.querySelector('[data-f="w"]').value = Math.round(prep.w * k); d.querySelector('[data-f="h"]').value = Math.round(prep.h * k);
        }
        markDirty(); drawPreview();
      } catch (err) { st.textContent = 'فشل: ' + errText(err); toast(errText(err), 'error'); e.target.value = ''; }
    });
    return d;
  }

  /* ---------- الطبقات ---------- */
  let selectedLayer = null;

  function defaultLayerOrder(f) {
    return ['photo', 'frame', ...Object.keys(f.text || {}), ...(f.stickers || []).map(s => s.id)];
  }
  function layerKind(f, id) {
    if (id === 'photo') return 'photo';
    if (id === 'frame') return 'frame';
    if ((f.stickers || []).some(s => s.id === id)) return 'sticker';
    return 'text';
  }
  const LAYER_TYPE = { photo: 'صورة', frame: 'إطار', sticker: 'ملصق', text: 'نص' };
  const LAYER_ICON = { photo: '🧑', frame: '🖼️', sticker: '⭐', text: 'T' };
  function layerLabel(f, id) {
    if (id === 'photo') return 'صورة المستخدم';
    if (id === 'frame') return 'الإطار';
    const s = (f.stickers || []).find(x => x.id === id);
    if (s) return s.name || id;
    const t = (f.text || {})[id];
    return t && t.label ? t.label : id;
  }
  function layerBounds(f, id) {
    if (!f) return null;
    if (id === 'photo') { const a = f.photoArea; return { x: a.x, y: a.y, w: a.width, h: a.height }; }
    const s = (f.stickers || []).find(x => x.id === id);
    if (s) return { x: s.x, y: s.y, w: s.w, h: s.h };
    const t = (f.text || {})[id];
    if (t) return { x: t.x, y: t.y, w: null, h: null };
    return null;
  }

  function renderLayers(f) {
    const box = $('layersList'); if (!box) return; box.textContent = '';
    const all = defaultLayerOrder(f);
    const order = (f.layerOrder && f.layerOrder.length ? f.layerOrder : all).filter(id => all.includes(id));
    const full = [...order, ...all.filter(x => !order.includes(x))];
    full.forEach(id => {
      const type = layerKind(f, id);
      const hidden = hiddenLayers.includes(id);
      const locked = lockedLayers.includes(id);
      const div = document.createElement('div');
      div.className = 'layer-item layer-item--' + type
        + (selectedLayer === id ? ' is-selected' : '')
        + (hidden ? ' is-hidden' : '')
        + (locked ? ' is-locked' : '');
      div.draggable = true; div.dataset.id = id;
      div.innerHTML = `<span class="layer-item__icon">${LAYER_ICON[type]}</span>`
        + `<span class="layer-item__name">${esc(layerLabel(f, id))}</span>`
        + `<span class="layer-item__type">${LAYER_TYPE[type]}</span>`
        + `<span class="layer-item__actions">`
        + `<button type="button" data-vis title="${hidden ? 'إظهار الطبقة' : 'إخفاء الطبقة'}" aria-label="${hidden ? 'إظهار الطبقة' : 'إخفاء الطبقة'}" aria-pressed="${hidden}">${hidden ? '🚫' : '👁'}</button>`
        + `<button type="button" data-lock title="${locked ? 'فتح الطبقة' : 'قفل الطبقة'}" aria-label="${locked ? 'فتح الطبقة' : 'قفل الطبقة'}" aria-pressed="${locked}">${locked ? '🔒' : '🔓'}</button>`
        + `<button type="button" data-up title="للأعلى" aria-label="للأعلى">↑</button>`
        + `<button type="button" data-down title="للأسفل" aria-label="للأسفل">↓</button>`
        + `</span>`;
      div.addEventListener('click', e => { if (e.target.closest('button')) return; selectLayer(id); });
      div.querySelector('[data-vis]').addEventListener('click', () => toggleLayerHidden(id));
      div.querySelector('[data-lock]').addEventListener('click', () => toggleLayerLocked(id));
      box.appendChild(div);
    });
    bindLayerDrag();
    if (selectedLayer && !full.includes(selectedLayer)) selectedLayer = null;
    renderInspector();
  }
  function bindLayerDrag() {
    const list = $('layersList'); let drag = null;
    list.querySelectorAll('.layer-item').forEach(it => {
      it.addEventListener('dragstart', () => { drag = it; it.classList.add('dragging'); });
      it.addEventListener('dragend', () => { it.classList.remove('dragging'); drag = null; markDirty(); drawPreview(); });
      it.addEventListener('dragover', e => {
        e.preventDefault();
        if (drag && drag !== it) { const kids = [...list.children]; if (kids.indexOf(it) > kids.indexOf(drag)) it.after(drag); else it.before(drag); }
      });
      it.querySelector('[data-up]').addEventListener('click', () => { if (it.previousElementSibling) it.previousElementSibling.before(it); markDirty(); drawPreview(); });
      it.querySelector('[data-down]').addEventListener('click', () => { if (it.nextElementSibling) it.nextElementSibling.after(it); markDirty(); drawPreview(); });
    });
  }
  function refreshLayers() { const f = collectForm(true); f.layerOrder = layerOrderFromDOM(); renderLayers(f); }
  const layerOrderFromDOM = () => [...document.querySelectorAll('#layersList .layer-item')].map(x => x.dataset.id);

  function toggleLayerHidden(id) {
    const i = hiddenLayers.indexOf(id);
    if (i >= 0) hiddenLayers.splice(i, 1); else hiddenLayers.push(id);
    markDirty();
    if (id === selectedLayer) renderInspector();
    renderLayers(collectForm());
    drawPreview();
  }
  function toggleLayerLocked(id) {
    const i = lockedLayers.indexOf(id);
    if (i >= 0) lockedLayers.splice(i, 1); else lockedLayers.push(id);
    markDirty();
    if (id === selectedLayer) renderInspector();
    renderLayers(collectForm());
  }

  /* ---------- لوجة تحكم الطبقة المحددة ---------- */
  function selectLayer(id) {
    selectedLayer = id || null;
    document.querySelectorAll('#layersList .layer-item').forEach(it =>
      it.classList.toggle('is-selected', it.dataset.id === selectedLayer));
    const box = $('layerInspector');
    if (box) box.hidden = !selectedLayer;
    renderInspector();
    drawPreview();
  }
  function renderInspector() {
    if (!selectedLayer || !current) return;
    const f = collectForm(true); if (!f) return;
    const id = selectedLayer, kind = layerKind(f, id), b = layerBounds(f, id);
    if (!b) { selectedLayer = null; if ($('layerInspector')) $('layerInspector').hidden = true; return; }
    const locked = lockedLayers.includes(id) || kind === 'frame';
    $('layerInspectorName').textContent = layerLabel(f, id);
    $('layerInspectorType').textContent = kind === 'photo'
      ? 'منطقة صورة المستخدم — حرّكها أو غيّر أبعادها بدقة'
      : kind === 'frame'
        ? 'صورة الإطار — الطبقة الخلفية، لا تُحرَّك'
        : kind === 'sticker'
          ? 'ملصق — حرّك أو غيّر الحجم بدقة'
          : 'نص — اضبط موضع مركز النص بدقة';
    const showWH = kind === 'photo' || kind === 'sticker';
    $('layerWLabel').hidden = !showWH;
    $('layerHLabel').hidden = !showWH;
    $('layerX').value = Math.round(b.x);
    $('layerY').value = Math.round(b.y);
    if (showWH) { $('layerW').value = Math.round(b.w); $('layerH').value = Math.round(b.h); }
    ['layerX', 'layerY', 'layerW', 'layerH'].forEach(x => { const el = $(x); if (el) el.disabled = locked; });
    document.querySelectorAll('#layerInspector .nudge__btn, #layerInspector [data-center]').forEach(btn => { btn.disabled = locked; });
    const note = $('layerLockNote');
    if (note) { note.hidden = !locked; note.textContent = kind === 'frame' ? 'طبقة الخلفية ثابتة بطبيعتها.' : 'الطبقة مقفولة — افتحها من أيقونة القفل في القائمة أعلاه.'; }
  }
  function writeLayerField(id, field, value) {
    const f = collectForm(true); if (!f || !id) return false;
    const v = Math.round(Number(value) || 0);
    const min = (field === 'w' || field === 'h') ? 5 : -100000;
    if (id === 'photo') {
      const map = { x: 'pX', y: 'pY', w: 'pW', h: 'pH' };
      if (!map[field]) return false;
      $(map[field]).value = Math.max(min, v); return true;
    }
    if ((f.stickers || []).some(s => s.id === id)) {
      const row = [...document.querySelectorAll('#stickersBox [data-sid]')].find(r => r.dataset.sid === id);
      const inp = row && row.querySelector('[data-f="' + field + '"]');
      if (!inp) return false;
      inp.value = Math.max(min, v); return true;
    }
    if (f.text[id]) {
      if (field !== 'x' && field !== 'y') return false;
      const row = [...document.querySelectorAll('#textsContainer .text-field')].find(r => r.querySelector('[data-field="key"]').value === id);
      const inp = row && row.querySelector('[data-field="' + field + '"]');
      if (!inp) return false;
      inp.value = v; return true;
    }
    return false;
  }
  function setLayerField(field, value) {
    if (!selectedLayer) return;
    if (writeLayerField(selectedLayer, field, value)) { markDirty(); drawPreview(); updateLinks(); }
  }
  function nudgeLayer(dx, dy) {
    if (!selectedLayer) return;
    const f = collectForm(true); if (!f) return;
    if (lockedLayers.includes(selectedLayer) || selectedLayer === 'frame') return;
    const b = layerBounds(f, selectedLayer); if (!b) return;
    writeLayerField(selectedLayer, 'x', b.x + dx);
    writeLayerField(selectedLayer, 'y', b.y + dy);
    markDirty(); drawPreview(); updateLinks(); renderInspector();
  }
  function centerLayer(axis) {
    if (!selectedLayer) return;
    const f = collectForm(true); if (!f) return;
    if (lockedLayers.includes(selectedLayer) || selectedLayer === 'frame') return;
    const b = layerBounds(f, selectedLayer); if (!b) return;
    const kind = layerKind(f, selectedLayer);
    if (kind === 'text') setLayerField(axis, axis === 'x' ? f.canvasWidth / 2 : f.canvasHeight / 2);
    else setLayerField(axis, axis === 'x' ? (f.canvasWidth - b.w) / 2 : (f.canvasHeight - b.h) / 2);
    renderInspector();
  }
  function nudgeStep() { const el = $('nudgeStep'); return Math.max(1, +(el && el.value) || 10); }
  function isTypingTarget(el) {
    return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|OPTION)$/.test(el.tagName));
  }

  /* ======================================================
     جمع بيانات النموذج
     ====================================================== */
  function collectForm(forLayers) {
    if (!current) return null;
    const vis = (document.querySelector('input[name="vis"]:checked') || {}).value || 'public';
    const text = {};
    document.querySelectorAll('#textsContainer .text-field').forEach(row => {
      const k = row.querySelector('[data-field="key"]').value.trim();
      if (!k) return;
      const get = f => { const el = row.querySelector('[data-field="' + f + '"]'); return el ? el.value : ''; };
      const o = { x: +get('x') || 0, y: +get('y') || 0, fontSize: +get('fontSize') || 50, fontWeight: get('fontWeight'), color: get('color') || '#FFFFFF', align: get('align'), label: get('label'), placeholder: get('placeholder') };
      if (get('value')) o.value = get('value');
      const opts = get('options').split(',').map(s => s.trim()).filter(Boolean);
      if (opts.length) o.options = opts;
      text[k] = o;
    });
    const stickers = [];
    document.querySelectorAll('#stickersBox [data-sid]').forEach(row => {
      const get = f => { const el = row.querySelector('[data-f="' + f + '"]'); return el ? el.value : ''; };
      stickers.push({ id: row.dataset.sid, name: get('name') || row.dataset.sid, imagePath: row.dataset.path || '', image: row.dataset.url || '', x: +get('x') || 0, y: +get('y') || 0, w: +get('w') || 200, h: +get('h') || 200 });
    });
    const colors = $('fColors').value.split(',').map(s => s.trim()).filter(s => /^#[0-9a-fA-F]{3,8}$/.test(s));
    const base = { text, stickers };
    return {
      id: $('fId').value.trim().replace(/\s+/g, '-').toLowerCase(),
      name: $('fName').value.trim(),
      visibility: vis,
      accessKey: vis === 'private' ? $('fKey').value.trim() : null,
      imagePath: current.imagePath || '',
      image: pending ? pending.url : current.image || '',
      canvasWidth: +$('fW').value || 2500,
      canvasHeight: +$('fH').value || 2500,
      photoArea: { x: +$('pX').value || 0, y: +$('pY').value || 0, width: +$('pW').value || 500, height: +$('pH').value || 500 },
      textColors: colors.length ? colors : ['#FFFFFF'],
      text: base.text, stickers: base.stickers,
      layerOrder: forLayers ? undefined : layerOrderFromDOM(),
      layerHidden: [...hiddenLayers],
      layerLocked: [...lockedLayers],
      sortOrder: current.sortOrder || 0
    };
  }

  function markDirty() { dirty = true; }

  /* ======================================================
     المعاينة الحية على الكانفس
     ====================================================== */
  function loadImg(src, cb) {
    if (!src) return null;
    const c = imgCache[src];
    if (c && c.complete && c.naturalWidth) return c;
    if (!c) { const im = new Image(); im.onload = () => { imgCache[src] = im; drawPreview(); }; im.onerror = () => { imgCache[src] = { complete: false, failed: true }; }; imgCache[src] = im; im.src = src; }
    return null;
  }
  function drawPreview() {
    const canvas = $('adminCanvas'); if (!canvas || !current) return;
    const f = collectForm(); if (!f) return;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e8e6e1'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = canvas.width / f.canvasWidth;
    canvas.height = Math.round(f.canvasHeight * scale);
    ctx.fillStyle = '#e8e6e1'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const order = layerOrderFromDOM();
    order.forEach(id => {
      if (hiddenLayers.includes(id)) return;
      if (id === 'photo') {
        ctx.save(); ctx.strokeStyle = '#5E3BFF'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.fillStyle = 'rgba(94,59,255,0.22)';
        const a = f.photoArea;
        ctx.fillRect(a.x * scale, a.y * scale, a.width * scale, a.height * scale);
        ctx.strokeRect(a.x * scale, a.y * scale, a.width * scale, a.height * scale);
        ctx.fillStyle = '#5E3BFF'; ctx.font = '12px Cairo, sans-serif'; ctx.fillText('الصورة', a.x * scale + 6, a.y * scale + 16); ctx.restore();
      } else if (id === 'frame') {
        const im = loadImg(f.image);
        if (im) ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
        else { ctx.save(); ctx.strokeStyle = '#999'; ctx.setLineDash([8, 6]); ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8); ctx.fillStyle = '#777'; ctx.font = '14px Cairo, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('ارفع صورة الإطار', canvas.width / 2, canvas.height / 2); ctx.restore(); }
      } else if (f.stickers.some(s => s.id === id)) {
        const s = f.stickers.find(x => x.id === id); const im = loadImg(s.image);
        if (im) ctx.drawImage(im, s.x * scale, s.y * scale, s.w * scale, s.h * scale);
        else { ctx.save(); ctx.strokeStyle = '#2d8a4e'; ctx.strokeRect(s.x * scale, s.y * scale, s.w * scale, s.h * scale); ctx.restore(); }
      } else if (f.text[id]) {
        const t = f.text[id];
        ctx.save(); ctx.fillStyle = t.color; ctx.beginPath(); ctx.arc(t.x * scale, t.y * scale, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('T', t.x * scale, t.y * scale + 3);
        ctx.fillStyle = '#0D1020'; ctx.font = '11px Cairo, sans-serif'; ctx.fillText(id, t.x * scale, t.y * scale - 11); ctx.restore();
      }
    });
    if (selectedLayer) {
      const b = layerBounds(f, selectedLayer);
      if (b) {
        ctx.save();
        ctx.strokeStyle = '#FF8A00'; ctx.lineWidth = 3; ctx.setLineDash([8, 5]);
        if (b.w == null) { ctx.beginPath(); ctx.arc(b.x * scale, b.y * scale, 18, 0, Math.PI * 2); ctx.stroke(); }
        else ctx.strokeRect(b.x * scale, b.y * scale, Math.max(4, b.w * scale), Math.max(4, b.h * scale));
        ctx.setLineDash([]); ctx.fillStyle = 'rgba(255,138,0,.14)';
        if (b.w != null) ctx.fillRect(b.x * scale, b.y * scale, Math.max(4, b.w * scale), Math.max(4, b.h * scale));
        ctx.restore();
      }
    }
  }

  function mouseFrame(e) {
    const canvas = $('adminCanvas'); const rect = canvas.getBoundingClientRect(); const f = collectForm();
    const scale = canvas.width / f.canvasWidth;
    const xC = (e.clientX - rect.left) * (canvas.width / rect.width);
    const yC = (e.clientY - rect.top) * (canvas.height / rect.height);
    return { x: xC / scale, y: yC / scale, xC, yC, scale };
  }
  function hitTestLayer(f, pos) {
    const order = layerOrderFromDOM();
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i];
      if (id === 'frame' || hiddenLayers.includes(id)) continue;
      const b = layerBounds(f, id);
      if (!b) continue;
      if (layerKind(f, id) === 'text') {
        if (Math.hypot(pos.x - b.x, pos.y - b.y) < 55) return { id, kind: 'text' };
      } else if (pos.x >= b.x && pos.x <= b.x + b.w && pos.y >= b.y && pos.y <= b.y + b.h) {
        return { id, kind: layerKind(f, id) };
      }
    }
    return null;
  }
  function initCanvasDrag() {
    const canvas = $('adminCanvas');
    canvas.addEventListener('pointerdown', e => {
      if (!current) return;
      const pos = mouseFrame(e), f = collectForm();
      if (!f) return;
      const hit = hitTestLayer(f, pos);
      if (!hit) { selectLayer(null); return; }
      selectLayer(hit.id);
      const b = layerBounds(f, hit.id);
      if (!b || lockedLayers.includes(hit.id) || hit.kind === 'frame') return;
      dragTarget = hit.id;
      dragOffset = hit.kind === 'text' ? { x: 0, y: 0 } : { x: pos.x - b.x, y: pos.y - b.y };
      try { canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; } catch (_) { }
    });
    canvas.addEventListener('pointermove', e => {
      if (!dragTarget) return;
      const pos = mouseFrame(e), f = collectForm(); if (!f) return;
      const kind = layerKind(f, dragTarget);
      let nx = pos.x - dragOffset.x, ny = pos.y - dragOffset.y;
      if (kind === 'text') { nx = pos.x; ny = pos.y; }
      writeLayerField(dragTarget, 'x', nx);
      writeLayerField(dragTarget, 'y', ny);
      markDirty(); drawPreview(); updateLinks(); renderInspector();
    });
    const end = () => {
      if (dragTarget) { updateLinks(); renderInspector(); }
      dragTarget = null;
      try { canvas.style.cursor = 'crosshair'; } catch (_) { }
    };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  }

  /* ======================================================
     تجهيز الصور (PNG / SVG / WEBP / JPG) + تنظيف SVG
     ====================================================== */
  async function readHead(file, n) { return new Uint8Array(await file.slice(0, n).arrayBuffer()); }
  function sniff(head) {
    const h = i => head[i];
    if (h(0) === 0x89 && h(1) === 0x50 && h(2) === 0x4E && h(3) === 0x47) return 'png';
    if (h(0) === 0xFF && h(1) === 0xD8 && h(2) === 0xFF) return 'jpg';
    if (h(0) === 0x52 && h(1) === 0x49 && h(2) === 0x46 && h(3) === 0x46 && h(8) === 0x57 && h(9) === 0x45 && h(10) === 0x42 && h(11) === 0x50) return 'webp';
    return null;
  }
  function sanitizeSvg(text) {
    if (!window.DOMPurify) throw new Error('تعذّر تحميل أداة تنظيف SVG. تأكد من الإنترنت وأعد المحاولة.');
    const clean = DOMPurify.sanitize(text, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'animate', 'set', 'animateTransform', 'animateMotion'],
      FORBID_ATTR: ['onload', 'onclick', 'onerror'],
      ADD_ATTR: ['viewBox', 'preserveAspectRatio']
    });
    const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('ملف SVG غير صالح.');
    if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    let w = parseFloat(root.getAttribute('width')), h = parseFloat(root.getAttribute('height'));
    const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if ((!w || !h || /%/.test(root.getAttribute('width') || '')) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) { w = vb[2]; h = vb[3]; }
    if (!w || !h) throw new Error('الـ SVG يحتاج viewBox أو width/height.');
    if (vb.length !== 4 || !(vb[2] > 0)) root.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    root.setAttribute('width', String(w)); root.setAttribute('height', String(h));
    return { text: new XMLSerializer().serializeToString(root), w: Math.round(w), h: Math.round(h) };
  }
  async function prepareImage(file) {
    const name = (file.name || '').toLowerCase();
    let ext = name.includes('.') ? name.split('.').pop() : '';
    if (ext === 'jpeg') ext = 'jpg';
    if (ext === 'tif') ext = 'tiff';
    if (['psd', 'tiff'].includes(ext)) {
      if (!window.Importers) throw new Error('وحدة استيراد PSD/TIFF لم تُحمَّل.');
      return Importers.importFile(file);   // يرجع PNG جاهز، أو null لو أُلغي
    }
    if (!['png', 'svg', 'webp', 'jpg'].includes(ext)) throw new Error('الصيغة غير مدعومة — ارفع PNG أو SVG أو WEBP أو JPG أو PSD أو TIFF.');
    if (file.size > MAX_IMG) throw new Error('حجم الملف أكبر من 15MB.');
    if (ext === 'svg') {
      const s = sanitizeSvg(await file.text());
      const blob = new Blob([s.text], { type: 'image/svg+xml' });
      return { blob, ext, w: s.w, h: s.h, size: blob.size };
    }
    const real = sniff(await readHead(file, 16));
    if (real !== ext) throw new Error('محتوى الملف لا يطابق امتداده (' + ext.toUpperCase() + ').');
    const url = URL.createObjectURL(file);
    try {
      const dims = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => rej(new Error('تعذّر قراءة الصورة.')); im.src = url; });
      return { blob: file, ext, w: dims.w, h: dims.h, size: file.size };
    } finally { URL.revokeObjectURL(url); }
  }

  async function onFrameImagePicked(e) {
    const file = e.target.files[0]; if (!file) return;
    try {
      const prep = await prepareImage(file);
      if (!prep) { e.target.value = ''; return; }
      if (pending) URL.revokeObjectURL(pending.url);
      pending = { ...prep, url: URL.createObjectURL(prep.blob) };
      if (isDraft || !current.imagePath) { $('fW').value = prep.w; $('fH').value = prep.h; }
      if (prep.photoArea) {
        $('pX').value = prep.photoArea.x; $('pY').value = prep.photoArea.y; $('pW').value = prep.photoArea.width; $('pH').value = prep.photoArea.height;
        toast('تم ضبط منطقة الصورة من طبقة «' + (prep.photoName || '') + '».', 'success');
      }
      if (prep.note) toast(prep.note, 'info', 8000);
      markDirty(); updateImageInfo(); drawPreview();
    } catch (err) { toast(errText(err), 'error'); e.target.value = ''; }
  }

  /* ======================================================
     حفظ / نسخ / حذف
     ====================================================== */
  function validate(f) {
    if (!f.name) return 'اسم الإطار مطلوب.';
    if (!ID_RE.test(f.id)) return 'المعرّف (id): حروف إنجليزية صغيرة وأرقام وشرطة فقط (2–63 حرفاً).';
    if (frames.some(x => x.id === f.id && (isDraft || x.id !== current.id))) return 'المعرّف مستخدم لإطار آخر.';
    if (!pending && !current.imagePath) return 'ارفع صورة الإطار أولاً.';
    const keys = Object.keys(f.text);
    if (keys.some(k => !KEY_RE.test(k))) return 'مفاتيح النصوص: حروف إنجليزية وأرقام و _ - فقط.';
    if (document.querySelectorAll('#textsContainer [data-field="key"]').length !== keys.length) return 'مفتاح نص مكرر أو فارغ.';
    if (f.stickers.some(s => !s.imagePath)) return 'أحد الملصقات بلا صورة — ارفع صورته أو احذفه.';
    return '';
  }

  async function saveFrame(e) {
    e.preventDefault();
    const f = collectForm(); if (!f) return;
    const bad = validate(f); if (bad) { toast(bad, 'error'); return; }
    const btn = $('btnSave'); btn.disabled = true;
    const oldPath = current.imagePath || ''; let newPath = null;
    const previous = current;
    try {
      if (pending) { newPath = await Api.uploadImage(pending.blob, pending.ext); f.imagePath = newPath; }
      else f.imagePath = oldPath;
      if (f.visibility === 'private' && (!f.accessKey || f.accessKey.length < 16)) f.accessKey = genKey();
      if (isDraft) await Api.insertFrame(f); else await Api.updateFrame(previous.id, f);
    } catch (err) {
      if (newPath) Api.removeImages([newPath]).catch(() => { });
      toast('تعذّر الحفظ: ' + errText(err), 'error'); btn.disabled = false; return;
    }
    // تنظيف الملفات التي لم تعد مستخدمة
    const keep = new Set([f.imagePath, ...f.stickers.map(s => s.imagePath)]);
    const drop = new Set();
    if (newPath && oldPath && oldPath !== newPath) drop.add(oldPath);
    (previous.stickers || []).forEach(s => { if (s.imagePath && !keep.has(s.imagePath)) drop.add(s.imagePath); });
    sessionUploaded.forEach(p => { if (!keep.has(p)) drop.add(p); });
    sessionUploaded.clear();
    if (drop.size) Api.removeImages([...drop]).catch(() => { });
    if (pending) { URL.revokeObjectURL(pending.url); pending = null; }
    dirty = false; btn.disabled = false;
    toast('تم الحفظ — الإطار ' + (f.visibility === 'public' ? 'ظاهر للجميع' : 'خاص (برابطه السري فقط)'), 'success');
    await loadFrames(f.id);
  }

  async function duplicateFrame() {
    if (!current || isDraft) { toast('احفظ الإطار أولاً ثم انسخه.', 'info'); return; }
    if (dirty && !confirm('سيتم نسخ النسخة المحفوظة (بدون تعديلاتك الحالية). متابعة؟')) return;
    const btn = $('btnDuplicate'); btn.disabled = true;
    const copies = [];
    try {
      const src = frames.find(x => x.id === current.id);
      const copy = JSON.parse(JSON.stringify(src));
      let id = src.id + '-copy', n = 2; while (frames.some(x => x.id === id)) id = src.id + '-copy' + n++;
      copy.id = id; copy.name = src.name + ' (نسخة)'; copy.visibility = 'private'; copy.accessKey = genKey();
      const cp = async p => { const np = await Api.copyImage(p); copies.push(np); return np; };
      copy.imagePath = await cp(src.imagePath);
      for (const s of copy.stickers) s.imagePath = await cp(s.imagePath);
      await Api.insertFrame(copy);
      toast('تم إنشاء نسخة (خاصة افتراضياً — غيّر الخصوصية متى شئت).', 'success');
      await loadFrames(copy.id);
    } catch (err) {
      if (copies.length) Api.removeImages(copies).catch(() => { });
      toast('تعذّر النسخ: ' + errText(err), 'error');
    } finally { btn.disabled = false; }
  }

  async function deleteFrame() {
    if (!current) return;
    if (isDraft) { if (confirm('تجاهل هذا الإطار الجديد؟')) { dirty = false; await loadFrames(); } return; }
    if (!confirm('حذف الإطار "' + current.name + '" نهائياً مع صوره؟ لا يمكن التراجع.')) return;
    const paths = [current.imagePath, ...(current.stickers || []).map(s => s.imagePath)];
    try { await Api.deleteFrame(current.id); } catch (err) { toast('تعذّر الحذف: ' + errText(err), 'error'); return; }
    Api.removeImages(paths).catch(() => { });
    dirty = false; toast('تم الحذف', 'info'); await loadFrames();
  }

  function newFrame() {
    if (dirty && !confirm('لديك تعديلات غير محفوظة. تجاهلها وإنشاء إطار جديد؟')) return;
    const id = 'frame-' + Date.now().toString(36).slice(-5);
    current = {
      id, name: 'إطار جديد', visibility: 'public', accessKey: null, imagePath: '', image: '',
      canvasWidth: 2500, canvasHeight: 2500, photoArea: { x: 877, y: 881, width: 748, height: 748 },
      textColors: ['#FFFFFF', '#FBAE42'],
      text: { name: { x: 1250, y: 1873, fontSize: 72, fontWeight: 'bold', color: '#FFFFFF', align: 'center', label: 'الاسم', placeholder: 'أدخل اسمك' } },
      stickers: [], layerOrder: undefined, layerHidden: [], layerLocked: [], sortOrder: 0
    };
    isDraft = true; pending = null; dirty = true;
    $('emptyState').hidden = true; $('frameForm').hidden = false;
    fillForm(current); renderList(); drawPreview();
  }

  /* ======================================================
     الحسابات (owner)
     ====================================================== */
  async function loadAccounts() {
    const body = $('accountsBody'); body.textContent = '';
    let list = [];
    try { list = await Api.listProfiles(); } catch (e) { toast(errText(e), 'error'); return; }
    list.forEach(p => {
      const tr = document.createElement('tr');
      const td = t => { const c = document.createElement('td'); if (t != null) c.textContent = t; return c; };
      const mine = p.id === me.id;
      const tdName = td(p.display_name || '—');
      const tdMail = td(p.email); tdMail.dir = 'ltr'; tdMail.style.textAlign = 'right';
      const tdRole = td(p.role === 'owner' ? 'مالك' : 'مدير');
      const tdState = document.createElement('td');
      const b = document.createElement('span'); b.className = 'badge ' + (p.active ? 'badge--public' : 'badge--private'); b.textContent = p.active ? 'نشِط' : 'معطّل'; tdState.appendChild(b);
      const tdAct = document.createElement('td'); tdAct.className = 'acc-actions';
      const mk = (txt, cls, fn, disabled) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn btn--sm ' + cls; x.textContent = txt; x.disabled = !!disabled; x.addEventListener('click', fn); tdAct.appendChild(x); };
      mk(p.active ? 'تعطيل' : 'تفعيل', 'btn--ghost', () => accAction({ action: 'set_active', id: p.id, active: !p.active }, p.active ? 'تم التعطيل' : 'تم التفعيل'), mine);
      mk('كلمة مرور', 'btn--ghost', () => {
        const pw = prompt('كلمة المرور الجديدة لـ ' + p.email + ' (10 أحرف على الأقل):');
        if (pw) accAction({ action: 'reset_password', id: p.id, password: pw }, 'تم تغيير كلمة المرور');
      });
      mk(p.role === 'owner' ? 'خفض لمدير' : 'ترقية لمالك', 'btn--ghost', () => {
        if (confirm(p.role === 'owner' ? 'خفض هذا الحساب إلى مدير؟' : 'منح هذا الحساب صلاحيات المالك الكاملة (بما فيها إدارة الحسابات)؟'))
          accAction({ action: 'set_role', id: p.id, role: p.role === 'owner' ? 'admin' : 'owner' }, 'تم تغيير الدور');
      }, mine);
      mk('حذف', 'btn--danger', () => { if (confirm('حذف حساب ' + p.email + ' نهائياً؟')) accAction({ action: 'delete', id: p.id }, 'تم حذف الحساب'); }, mine);
      tr.append(tdName, tdMail, tdRole, tdState, tdAct); body.appendChild(tr);
    });
  }
  async function accAction(payload, okMsg) {
    try { await Api.adminUsers(payload); toast(okMsg, 'success'); await loadAccounts(); }
    catch (e) { toast(errText(e), 'error'); }
  }
  function genPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    const b = new Uint32Array(16); crypto.getRandomValues(b);
    return [...b].map(n => chars[n % chars.length]).join('');
  }
  async function createAccount(e) {
    e.preventDefault();
    const btn = $('btnCreateAcc'); btn.disabled = true;
    try {
      await Api.adminUsers({
        action: 'create', email: $('accEmail').value.trim(), display_name: $('accName').value.trim(),
        password: $('accPass').value, role: $('accRole').value
      });
      toast('تم إنشاء الحساب. سلّم كلمة المرور لصاحبه بطريقة آمنة.', 'success', 6000);
      $('accountForm').reset(); await loadAccounts();
    } catch (err) { toast(errText(err), 'error'); }
    finally { btn.disabled = false; }
  }

  /* ======================================================
     صورة واجهة الصفحة الرئيسية
     ====================================================== */
  const HERO_DEFAULT = 'assets/frames/codemakers.webp';

  function heroSrc() { return hero.image ? Api.imageUrl(hero.image) : HERO_DEFAULT; }

  function renderHeroBox() {
    const src = heroSrc();
    ['heroThumb', 'heroPreview'].forEach(id => { const im = $(id); if (im) { im.src = src; im.hidden = false; } });
    const st = $('heroState');
    if (st) st.textContent = hero.image ? 'صورة مخصّصة منشورة الآن.' : 'الصورة الافتراضية المنشورة.';
    show('btnHeroReset', !!hero.image);
  }

  async function loadHero() {
    try { hero = await Api.getHero(); }
    catch (e) { console.warn('hero settings:', e); hero = { image: '' }; }
    renderHeroBox();
  }

  function openHero() { $('heroFile').value = ''; renderHeroBox(); show('heroModal'); }

  function previewHeroPick(e) {
    const file = e.target.files[0];
    const pv = $('heroPreview');
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'psd' || ext === 'psb' || ext === 'tif' || ext === 'tiff') {
      if (pv) { pv.removeAttribute('src'); pv.hidden = true; }
      toast('ملف بطبقات — ستظهر المعاينة بعد الحفظ والتحويل إلى PNG.', 'info', 6000);
      return;
    }
    if (pv) { pv.src = URL.createObjectURL(file); pv.hidden = false; }
  }

  async function saveHeroImage() {
    const file = $('heroFile').files[0];
    if (!file) { toast('اختر صورة أولاً.', 'info'); return; }
    const btn = $('btnHeroSave'); btn.disabled = true;
    try {
      const prep = await prepareImage(file);
      if (!prep) return;
      if (prep.note) toast(prep.note, 'info', 8000);
      if (prep.size > 45 * 1024 * 1024) throw new Error('صورة الواجهة كبيرة جداً (الحد 45MB) — اختر صورة أصغر.');
      const path = await Api.uploadImage(prep.blob, prep.ext);
      const old = hero.image;
      await Api.saveHero({ image: path, alt: 'إطار من FRAMEO' });
      hero = { image: path, alt: 'إطار من FRAMEO' };
      if (old && old !== path) Api.removeImages([old]).catch(() => { });
      show('heroModal', false);
      renderHeroBox();
      toast('تم تحديث صورة الواجهة — تظهر الآن في الصفحة الرئيسية.', 'success');
    } catch (err) {
      toast(errText(err), 'error');
    } finally {
      btn.disabled = false; $('heroFile').value = '';
    }
  }

  async function resetHero() {
    if (!hero.image) { show('heroModal', false); return; }
    if (!confirm('استعادة صورة الواجهة الافتراضية وحذف الصورة المرفوعة؟')) return;
    const btn = $('btnHeroReset'); btn.disabled = true;
    const old = hero.image;
    try {
      await Api.saveHero({ image: '' });
      hero = { image: '' };
      if (old) Api.removeImages([old]).catch(() => { });
      show('heroModal', false);
      renderHeroBox();
      toast('تمت استعادة صورة الواجهة الافتراضية.', 'info');
    } catch (err) {
      toast(errText(err), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  /* ======================================================
     كلمة مروري
     ====================================================== */
  async function saveMyPassword() {
    const p = $('setPass').value, p2 = $('setPass2').value;
    if (p.length < 10) { toast('كلمة المرور يجب ألا تقل عن 10 أحرف.', 'error'); return; }
    if (p !== p2) { toast('كلمتا المرور غير متطابقتين.', 'error'); return; }
    try { await Api.changeOwnPassword(p); toast('تم تغيير كلمة المرور', 'success'); $('settingsModal').hidden = true; $('setPass').value = ''; $('setPass2').value = ''; }
    catch (e) { toast(errText(e), 'error'); }
  }

  /* ======================================================
     ربط الأحداث
     ====================================================== */
  function bindStatic() {
    $('loginForm').addEventListener('submit', doLogin);
    $('btnLogout').addEventListener('click', logout);
    document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    $('btnNewFrame').addEventListener('click', newFrame);
    $('frameForm').addEventListener('submit', saveFrame);
    $('btnDuplicate').addEventListener('click', duplicateFrame);
    $('btnDelete').addEventListener('click', deleteFrame);
    $('btnPreviewEditor').addEventListener('click', () => { const f = collectForm(); if (f) window.open(frameLink(f), '_blank', 'noopener'); });
    $('fImageFile').addEventListener('change', onFrameImagePicked);
    $('btnFitCanvas').addEventListener('click', () => { if (pending) { $('fW').value = pending.w; $('fH').value = pending.h; markDirty(); updateImageInfo(); drawPreview(); updateLinks(); } });
    document.querySelectorAll('input[name="vis"]').forEach(r => r.addEventListener('change', () => { markDirty(); updateVisUI(); updateLinks(); }));
    $('btnGenKey').addEventListener('click', () => { $('fKey').value = genKey(); markDirty(); updateLinks(); });
    $('btnCopyPrivate').addEventListener('click', () => copyText($('privateLink').textContent));
    $('btnCopyPublic').addEventListener('click', () => copyText($('publicLink').textContent));
    ['fName', 'fId', 'fW', 'fH', 'pX', 'pY', 'pW', 'pH', 'fColors', 'fKey'].forEach(id => {
      $(id).addEventListener('input', () => { markDirty(); if (id === 'fW' || id === 'fH') updateImageInfo(); drawPreview(); updateLinks(); });
    });
    $('btnAddText').addEventListener('click', () => {
      const c = $('textsContainer'); let n = c.children.length + 1; let key = 'field' + n;
      while ([...c.querySelectorAll('[data-field="key"]')].some(i => i.value === key)) key = 'field' + (++n);
      c.appendChild(createTextRow(key, { x: 1250, y: 2000, fontSize: 48, fontWeight: 'bold', color: '#FFFFFF', align: 'center', label: 'حقل جديد', placeholder: '' }));
      markDirty(); refreshLayers(); drawPreview();
    });
    $('btnAddSticker').addEventListener('click', () => {
      const s = { id: 'sticker_' + Date.now().toString(36).slice(-5), name: 'ملصق جديد', imagePath: '', image: '', x: 1000, y: 500, w: 300, h: 300 };
      $('stickersBox').appendChild(createStickerRow(s));
      refreshLayers(); markDirty(); drawPreview();
    });
    $('btnResetLayers').addEventListener('click', () => { const f = collectForm(true); renderLayers(f); markDirty(); drawPreview(); toast('تمت إعادة ضبط الترتيب', 'info'); });
    $('btnShowAllLayers').addEventListener('click', () => { hiddenLayers = []; markDirty(); renderLayers(collectForm()); drawPreview(); });
    $('btnUnlockAllLayers').addEventListener('click', () => { lockedLayers = []; markDirty(); renderLayers(collectForm()); renderInspector(); });
    const search = $('framesSearch');
    if (search) search.addEventListener('input', () => { searchQuery = search.value; renderList(); });
    if ($('btnLayerDeselect')) $('btnLayerDeselect').addEventListener('click', () => selectLayer(null));
    [['layerX', 'x'], ['layerY', 'y'], ['layerW', 'w'], ['layerH', 'h']].forEach(([id, field]) => {
      const el = $(id); if (el) el.addEventListener('input', () => setLayerField(field, el.value));
    });
    document.querySelectorAll('#layerInspector [data-nudge]').forEach(b => b.addEventListener('click', () => {
      const s = nudgeStep();
      const d = { up: [0, -s], down: [0, s], left: [-s, 0], right: [s, 0] }[b.dataset.nudge];
      if (d) nudgeLayer(d[0], d[1]);
    }));
    document.querySelectorAll('#layerInspector [data-center]').forEach(b => b.addEventListener('click', () => centerLayer(b.dataset.center)));
    document.addEventListener('keydown', e => {
      if (!selectedLayer || isTypingTarget(document.activeElement)) return;
      if (e.key === 'Escape') { selectLayer(null); return; }
      const s = nudgeStep() * (e.shiftKey ? 10 : 1);
      const d = { ArrowUp: [0, -s], ArrowDown: [0, s], ArrowLeft: [-s, 0], ArrowRight: [s, 0] }[e.key];
      if (!d) return;
      e.preventDefault(); nudgeLayer(d[0], d[1]);
    });
    $('frameForm').addEventListener('input', e => {
      if (selectedLayer && !e.target.closest('#layerInspector')) renderInspector();
    });
    document.querySelectorAll('.filter-btn').forEach(b => b.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); filter = b.dataset.filter; renderList();
    }));
    $('btnSettings').addEventListener('click', () => { $('settingsModal').hidden = false; });
    $('btnCloseSettings').addEventListener('click', () => { $('settingsModal').hidden = true; });
    $('btnSavePass').addEventListener('click', saveMyPassword);
    $('accountForm').addEventListener('submit', createAccount);
    $('btnGenPass').addEventListener('click', () => { $('accPass').value = genPassword(); $('accPass').type = 'text'; });
    $('btnHeroOpen').addEventListener('click', openHero);
    $('heroFile').addEventListener('change', previewHeroPick);
    $('btnHeroSave').addEventListener('click', saveHeroImage);
    $('btnHeroReset').addEventListener('click', resetHero);
    $('btnHeroClose').addEventListener('click', () => show('heroModal', false));
    window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    initCanvasDrag();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
