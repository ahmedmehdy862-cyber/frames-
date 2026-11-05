/* ========================================
   FRAMEO — نظام الفريمات (V4)
   المصدر: Supabase (الفريمات العامة فقط للزوار).
   الفريم الخاص لا يظهر في أي قائمة؛ يُفتح فقط برابط
   ?frame=ID&key=KEY وتتحقق منه قاعدة البيانات نفسها.
   عند عدم ضبط الخادم أو تعذّر الاتصال: نقرأ config/frames.json
   (فريمات عامة فقط).
   ======================================== */
'use strict';

const FramesManager = (() => {
  let framesData = [];
  let selectedFrame = null;
  let privateFrame = null;       // فريم خاص مفتوح بمفتاح صحيح
  let privateDenied = false;     // طُلب فريم خاص بمفتاح خاطئ

  const params = () => { try { return new URLSearchParams(location.search); } catch (e) { return new URLSearchParams(); } };

  async function loadStatic() {
    const resp = await fetch('config/frames.json', { cache: 'no-cache' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const list = await resp.json();
    return (Array.isArray(list) ? list : [])
      .filter(f => !f.visibility || f.visibility === 'public')
      .map(f => ({ ...f, visibility: 'public', accessKey: null }));
  }

  async function loadFrames() {
    framesData = [];
    privateFrame = null;
    privateDenied = false;

    // 1) الفريمات العامة
    try {
      framesData = Api.configured ? await Api.listPublic() : await loadStatic();
    } catch (e) {
      console.warn('تعذّر تحميل الفريمات من الخادم، سيتم استخدام النسخة الثابتة:', e.message || e);
      try { framesData = await loadStatic(); } catch (e2) { framesData = []; }
    }

    // 2) فريم خاص مطلوب برابطه؟
    const p = params();
    const fid = p.get('frame'), key = p.get('key');
    if (fid && key && Api.configured) {
      try {
        privateFrame = await Api.getPrivate(fid, key);
        if (!privateFrame) privateDenied = true;
      } catch (e) { privateDenied = true; }
    }
  }

  // قائمة العرض: لو فُتح فريم خاص بمفتاح صحيح نعرضه وحده، غير ذلك العامة فقط
  function getVisibleFrames() {
    if (privateFrame) return [privateFrame];
    return framesData.filter(f => f.visibility === 'public');
  }
  function getAll() { return framesData.concat(privateFrame ? [privateFrame] : []); }
  function getAllVisible() { return getVisibleFrames(); }
  function getFrameById(id) { return getVisibleFrames().find(f => f.id === id) || null; }
  function wasPrivateDenied() { return privateDenied; }

  function selectFrame(container, card, frame) {
    if (container) {
      container.querySelectorAll('.frame-card').forEach(c => {
        c.classList.remove('active');
        c.setAttribute('aria-pressed', 'false');
      });
    }
    card.classList.add('active');
    card.setAttribute('aria-pressed', 'true');
    selectedFrame = frame;
  }

  function renderFrameCards(container, onSelect, opts = {}) {
    if (!container) return;
    container.innerHTML = '';
    const list = getVisibleFrames();
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'frames-empty';
      p.textContent = 'لا توجد إطارات متاحة حالياً.';
      container.appendChild(p);
      return;
    }
    list.forEach(frame => {
      const card = document.createElement('div');
      card.className = 'frame-card';
      card.dataset.frameId = frame.id;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-pressed', 'false');
      card.setAttribute('aria-label', 'اختر ' + frame.name);

      const imgWrap = document.createElement('div');
      imgWrap.className = 'frame-card__img';
      const img = document.createElement('img');
      img.crossOrigin = 'anonymous';   // ضروري لتصدير الكانفس من صور على نطاق آخر
      img.src = frame.image;
      img.alt = frame.name;
      img.loading = 'lazy';
      imgWrap.appendChild(img);

      const label = document.createElement('div');
      label.className = 'frame-card__label';
      label.textContent = frame.name;

      card.appendChild(imgWrap);
      card.appendChild(label);

      const choose = () => {
        selectFrame(container, card, frame);
        if (onSelect) onSelect(frame);
      };
      card.addEventListener('click', choose);
      card.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
      });
      container.appendChild(card);
    });
  }

  function markActive(container, id) {
    if (!container) return;
    container.querySelectorAll('.frame-card').forEach(c => {
      const on = c.dataset.frameId === id;
      c.classList.toggle('active', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function getSelectedFrame() { return selectedFrame; }

  return {
    loadFrames, renderFrameCards, markActive,
    getAll, getAllVisible, getVisibleFrames, getFrameById,
    getSelectedFrame, wasPrivateDenied
  };
})();
